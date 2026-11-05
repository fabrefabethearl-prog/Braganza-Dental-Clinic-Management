'use strict';

const { sendJson } = require('../http/helpers');
const { NAMES } = require('../repositories/collections');

function register(router, app) {
  router.get('/api/health', function (ctx) {
    sendJson(ctx.res, 200, {
      status: 'ok',
      serverTime: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime())
    });
  }, { public: true });

  router.get('/api/stats', async function (ctx) {
    const counts = {};
    for (let i = 0; i < NAMES.length; i += 1) {
      counts[NAMES[i]] = await app.records.count(NAMES[i]);
    }
    sendJson(ctx.res, 200, { counts: counts });
  }, { adminOnly: true });

  router.get('/api/audit', async function (ctx) {
    const rows = await app.audit.recent(ctx.query.limit);
    const entries = rows.map(function (row) {
      let detail = null;
      if (row.detail) {
        try {
          detail = JSON.parse(row.detail);
        } catch (error) {
          void error;
          detail = row.detail;
        }
      }
      return {
        id: row.id,
        at: row.at,
        userId: row.user_id,
        action: row.action,
        entity: row.entity,
        entityId: row.entity_id,
        detail: detail
      };
    });
    sendJson(ctx.res, 200, { entries: entries });
  }, { adminOnly: true });

  // The original SQLite backend served the live database file as a raw
  // download here. Supabase is a hosted Postgres service reached over
  // PostgREST, so there is no local file to stream; this exports the same
  // full snapshot the app already assembles for GET /api/state as JSON
  // instead. See README "Migration notes".
  router.get('/api/backup', async function (ctx) {
    const state = await app.state.read(ctx.user.role);
    const buffer = Buffer.from(JSON.stringify({ exportedAt: new Date().toISOString(), state: state }, null, 2), 'utf8');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    ctx.res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': buffer.length,
      'Content-Disposition': 'attachment; filename="braganza-clinic-' + stamp + '.json"',
      'Cache-Control': 'no-store'
    });
    ctx.res.end(buffer);
  }, { adminOnly: true });
}

module.exports = { register: register };
