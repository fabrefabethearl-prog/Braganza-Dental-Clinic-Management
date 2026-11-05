'use strict';

const http = require('http');
const { URL } = require('url');

const config = require('./config');
const SQLiteDatabase = require('./db/sqlite');
const { migrate } = require('./db/migrate');
const RecordRepository = require('./repositories/records');
const { SettingsRepository, CountersRepository } = require('./repositories/keyvalue');
const { UserRepository, SessionRepository, AuditRepository } = require('./repositories/accounts');
const { StateService } = require('./services/state');
const { AuthService } = require('./services/auth');
const { OtpService } = require('./services/otp');
const permissions = require('./services/permissions');
const Router = require('./http/router');
const { createStaticHandler } = require('./http/static');
const helpers = require('./http/helpers');

const authRoutes = require('./routes/auth');
const stateRoutes = require('./routes/state');
const resourceRoutes = require('./routes/resources');
const systemRoutes = require('./routes/system');

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.gstatic.com; " +
    "style-src 'self' 'unsafe-inline' https://www.gstatic.com; " +
    "img-src 'self' data: https://lh3.googleusercontent.com; " +
    "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com " +
    "https://www.googleapis.com https://firebaseinstallations.googleapis.com https://www.google.com https://recaptcha.net; " +
    "frame-src https://*.firebaseapp.com https://accounts.google.com https://www.google.com https://recaptcha.google.com https://recaptcha.net; " +
    "base-uri 'none'; frame-ancestors 'none'"
};

function originAllowed(req, appConfig) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers.host;
  try {
    const originUrl = new URL(origin);
    if (host && originUrl.host === host) return true;
  } catch (error) {
    void error;
    return false;
  }
  return appConfig.security.trustedOrigins.indexOf(origin) !== -1;
}

async function handle(req, res, app, router, serveStatic) {
  Object.keys(SECURITY_HEADERS).forEach(function (name) {
    res.setHeader(name, SECURITY_HEADERS[name]);
  });

  const parsedUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = parsedUrl.pathname;

  if (pathname.indexOf('/api/') !== 0) {
    const served = await serveStatic(req, res, pathname);
    if (served) return;
    helpers.sendJson(res, 404, { error: { code: 'not_found', message: 'Not found.' } });
    return;
  }

  const matched = router.match(req.method, pathname);
  if (!matched) {
    helpers.sendJson(res, 404, { error: { code: 'not_found', message: 'Not found.' } });
    return;
  }
  if (matched.methodNotAllowed) {
    helpers.sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'Method not allowed.' } });
    return;
  }

  const route = matched.route;
  const isMutating = req.method !== 'GET' && req.method !== 'HEAD';
  if (isMutating && !originAllowed(req, app.config)) {
    helpers.sendJson(res, 403, { error: { code: 'origin_not_allowed', message: 'Request origin is not allowed.' } });
    return;
  }

  const cookies = helpers.parseCookies(req.headers.cookie);
  const sessionId = cookies[app.config.session.cookieName] || null;
  const resolved = sessionId ? await app.auth.resolve(sessionId) : null;

  if (!route.options.public && !resolved) {
    helpers.sendJson(res, 401, { error: { code: 'unauthorized', message: 'Sign in required.' } });
    return;
  }

  if (route.options.adminOnly && (!resolved || !permissions.isAdmin(resolved.user.role))) {
    helpers.sendJson(res, 403, {
      error: { code: 'forbidden', message: 'Administrator access is required for this action.' }
    });
    return;
  }

  if (route.options.resource && resolved) {
    const write = req.method !== 'GET' && req.method !== 'HEAD';
    const allowed = write
      ? permissions.canWriteCollection(resolved.user.role, route.options.resource)
      : permissions.canAccessCollection(resolved.user.role, route.options.resource);
    if (!allowed) {
      helpers.sendJson(res, 403, {
        error: { code: 'forbidden', message: 'Your account does not have access to this clinic resource.' }
      });
      return;
    }
  }

  if (resolved) await app.auth.refresh(sessionId);

  const query = {};
  parsedUrl.searchParams.forEach(function (value, key) { query[key] = value; });

  let body = {};
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    const buffer = await helpers.readBody(req, app.config.security.maxBodyBytes);
    body = helpers.parseJsonBody(buffer);
  }

  const ctx = {
    req: req,
    res: res,
    params: matched.params,
    query: query,
    body: body,
    user: resolved ? resolved.user : null,
    sessionId: sessionId
  };

  await route.handler(ctx);
}

async function createApp() {
  const db = await SQLiteDatabase.open(config.databasePath);
  await migrate(db);

  const app = {
    config: config,
    db: db,
    records: new RecordRepository(db),
    settings: new SettingsRepository(db),
    counters: new CountersRepository(db),
    users: new UserRepository(db),
    sessions: new SessionRepository(db),
    audit: new AuditRepository(db)
  };

  app.state = new StateService(app);
  app.auth = new AuthService({
    db: db,
    users: app.users,
    sessions: app.sessions,
    audit: app.audit,
    config: config
  });
  app.otp = new OtpService({
    db: db,
    users: app.users,
    sessions: app.sessions,
    audit: app.audit,
    config: config,
    auth: app.auth
  });

  await app.state.ensureSeed();
  await app.auth.ensureBootstrapAdmin();

  const router = new Router();
  authRoutes.register(router, app);
  stateRoutes.register(router, app);
  resourceRoutes.register(router, app);
  systemRoutes.register(router, app);

  const serveStatic = createStaticHandler(config.publicDir);

  const server = http.createServer(function (req, res) {
    handle(req, res, app, router, serveStatic).catch(function (error) {
      if (!res.headersSent) helpers.sendError(res, error);
      else res.end();
    });
  });

  app.server = server;
  app.close = async function () {
    await new Promise(function (resolve) { server.close(resolve); });
    await db.close();
  };

  return app;
}

module.exports = { createApp: createApp };
