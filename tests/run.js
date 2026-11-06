'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const SQLiteDatabase = require('../server/db/sqlite');
const { migrate } = require('../server/db/migrate');
const { AuthService } = require('../server/services/auth');
const { UserRepository, SessionRepository, AuditRepository } = require('../server/repositories/accounts');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'braganza-clinic-test-'));
process.env.SQLITE_PATH = path.join(testDataDir, 'test.sqlite');

process.env.PORT = '0';
process.env.HOST = '127.0.0.1';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'test-admin-password';
process.env.NODE_ENV = 'test';
process.env.FIREBASE_API_KEY = '';
process.env.FIREBASE_AUTH_DOMAIN = '';
process.env.FIREBASE_PROJECT_ID = '';
process.env.FIREBASE_APP_ID = '';
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '';
process.env.OTP_SECRET = 'test-secret-with-more-than-thirty-two-bytes';
process.env.SMTP_HOST = 'smtp.test.invalid';
process.env.SMTP_USER = 'test-user';
process.env.SMTP_PASSWORD = 'test-password';
process.env.SMTP_FROM = 'clinic@test.invalid';
process.env.TWILIO_ACCOUNT_SID = 'AC00000000000000000000000000000000';
process.env.TWILIO_AUTH_TOKEN = 'test-twilio-token';
process.env.TWILIO_FROM_NUMBER = '+15005550006';
process.env.OTP_IP_LIMIT = '50';

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    process.stdout.write('  PASS  ' + label + '\n');
  } else {
    failed += 1;
    process.stdout.write('  FAIL  ' + label + (detail ? ' :: ' + detail : '') + '\n');
  }
}

function freshRequire() {
  Object.keys(require.cache).forEach(function (key) {
    if (key.indexOf(path.join(__dirname, '..', 'server')) === 0) delete require.cache[key];
  });
  return require('../server/app');
}

async function boot() {
  const { createApp } = freshRequire();
  const app = await createApp();
  await new Promise(function (resolve) { app.server.listen(0, '127.0.0.1', resolve); });
  const port = app.server.address().port;
  return { app: app, base: 'http://127.0.0.1:' + port };
}

function client(base) {
  let cookie = null;
  return async function call(method, url, body) {
    const headers = { Accept: 'application/json' };
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + url, {
      method: method,
      headers: headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch (error) { void error; data = text; }
    }
    return { status: res.status, data: data, headers: res.headers };
  };
}

async function main() {
  process.stdout.write('Braganza Dental Clinic backend tests\n');
  process.stdout.write('SQLite database: ' + process.env.SQLITE_PATH + '\n\n');

  const legacyDb = await SQLiteDatabase.open(path.join(testDataDir, 'legacy.sqlite'));
  legacyDb.exec(
    'CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);' +
    'CREATE TABLE users (' +
    'id TEXT PRIMARY KEY, username TEXT NOT NULL, email TEXT, name TEXT NOT NULL, ' +
    'role TEXT NOT NULL DEFAULT \'Administrator\', doctor_id TEXT, password_hash TEXT NOT NULL, ' +
    'password_salt TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, ' +
    'updated_at TEXT NOT NULL, last_login_at TEXT);' +
    'INSERT INTO users (id, username, name, password_hash, password_salt, created_at, updated_at) ' +
    'VALUES (\'legacy-admin\', \'admin\', \'Legacy Admin\', \'hash\', \'salt\', \'2026-01-01\', \'2026-01-01\');'
  );
  migrate(legacyDb);
  const legacyColumns = legacyDb.prepare('PRAGMA table_info(users)').all()
    .map(function (column) { return column.name; });
  check('upgrade adds Firebase fields without losing existing accounts',
    legacyColumns.indexOf('phone') !== -1 && legacyColumns.indexOf('photo_url') !== -1 &&
    legacyDb.prepare('SELECT username FROM users WHERE id = ?').get('legacy-admin').username === 'admin');
  check('upgrade creates identity-link and OTP tables through version 3',
    legacyDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'auth_identities'").get() !== undefined &&
    legacyDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'auth_otp_challenges'").get() !== undefined &&
    legacyDb.prepare('SELECT version FROM schema_migrations WHERE version = 3').get() !== undefined);
  await legacyDb.close();

  const bootstrapDb = await SQLiteDatabase.open(path.join(testDataDir, 'bootstrap-password.sqlite'));
  migrate(bootstrapDb);
  const bootstrapAuth = new AuthService({
    db: bootstrapDb,
    users: new UserRepository(bootstrapDb),
    sessions: new SessionRepository(bootstrapDb),
    audit: new AuditRepository(bootstrapDb),
    config: {
      bootstrapAdmin: { username: 'admin', password: '', email: '', name: 'Admin', doctorId: 'DR-01' },
      security: { loginMaxAttempts: 8, loginWindowMs: 600000 }
    }
  });
  let bootstrapBlocked = false;
  try {
    await bootstrapAuth.ensureBootstrapAdmin();
  } catch (error) {
    bootstrapBlocked = /ADMIN_PASSWORD/.test(error.message);
  }
  check('fresh database refuses a default or missing administrator password', bootstrapBlocked);
  await bootstrapDb.close();

  let ctx = await boot();
  let call = client(ctx.base);

  process.stdout.write('SQLite initialization\n');
  check('schema migrations are applied', ctx.app.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version === 3);
  check('foreign-key enforcement is enabled', ctx.app.db.prepare('PRAGMA foreign_keys').get().foreign_keys === 1);

  process.stdout.write('health and authentication\n');
  let res = await call('GET', '/api/health');
  check('health endpoint responds', res.status === 200 && res.data.status === 'ok', 'status ' + res.status);

  res = await call('GET', '/api/state');
  check('state requires authentication', res.status === 401, 'status ' + res.status);

  res = await call('POST', '/api/auth/login', { username: 'admin', password: 'wrong-password' });
  check('bad password is rejected', res.status === 401, 'status ' + res.status);

  res = await call('GET', '/api/auth/session');
  check('session is empty before sign in', res.status === 200 && res.data.user === null);

  res = await call('POST', '/api/auth/login', { username: 'admin', password: 'test-admin-password' });
  check('valid credentials sign in', res.status === 200 && res.data.user.username === 'admin', 'status ' + res.status);
  check('session cookie is httpOnly and strict', /HttpOnly/i.test(res.headers.get('set-cookie') || '') && /SameSite=Strict/i.test(res.headers.get('set-cookie') || ''));

  process.stdout.write('\nrole-based account creation and access\n');
  res = await call('POST', '/api/admin/accounts', {
    name: 'Front Desk User',
    username: 'frontdesk',
    email: 'frontdesk@example.com',
    password: 'frontdesk-password',
    role: 'Receptionist'
  });
  check('administrator creates an active account with the selected non-admin role',
    res.status === 201 && res.data.account.role === 'Receptionist' &&
    ctx.app.users.findByLogin('frontdesk').active === 1);
  res = await call('POST', '/api/admin/accounts', {
    name: 'Second User',
    username: 'frontdesk',
    email: 'second@example.com',
    password: 'frontdesk-password',
    role: 'Receptionist'
  });
  check('duplicate account names are rejected', res.status === 409 && res.data.error.code === 'account_exists');
  res = await call('POST', '/api/admin/accounts', {
    name: 'Invalid Role User',
    username: 'invalidrole',
    email: 'invalidrole@example.com',
    password: 'valid-test-password',
    role: 'Superuser'
  });
  check('administrator cannot assign an unauthorized role',
    res.status === 422 && res.data.error.code === 'invalid_role');

  const receptionistCall = client(ctx.base);
  res = await receptionistCall('POST', '/api/auth/login', {
    username: 'frontdesk',
    password: 'frontdesk-password'
  });
  check('new account can sign in with its credentials', res.status === 200 && res.data.user.role === 'Receptionist');
  res = await receptionistCall('POST', '/api/admin/accounts', {
    name: 'Attempted Admin',
    username: 'attemptedadmin',
    email: 'attemptedadmin@example.com',
    password: 'attempted-password',
    role: 'Administrator'
  });
  check('non-admin account creation is denied by the API', res.status === 403);
  res = await receptionistCall('GET', '/api/treatments');
  check('non-admin is denied resources outside their role', res.status === 403);
  res = await receptionistCall('GET', '/api/inventory');
  check('inventory endpoint rejects non-admin access', res.status === 403);
  res = await receptionistCall('GET', '/api/settings');
  check('clinic settings endpoint rejects non-admin access', res.status === 403);
  res = await receptionistCall('GET', '/api/doctors');
  check('non-admin can read clinic provider names for appointment forms', res.status === 200);
  res = await receptionistCall('POST', '/api/doctors', { id: 'UNAUTHORIZED-DOCTOR', name: 'Unauthorized' });
  check('non-admin cannot manage clinic provider accounts', res.status === 403);
  res = await receptionistCall('GET', '/api/stats');
  check('administrative statistics reject non-admin access', res.status === 403);
  res = await receptionistCall('GET', '/api/audit');
  check('audit data rejects non-admin access', res.status === 403);
  res = await receptionistCall('GET', '/api/backup');
  check('database backup rejects non-admin access', res.status === 403);
  const adminOnlyRecord = { id: 'ADMIN-ONLY-INVENTORY', name: 'Private Stock' };
  ctx.app.records.upsert('inventory', adminOnlyRecord, 0);
  res = await receptionistCall('GET', '/api/state');
  check('state snapshot omits collections not authorized for the user',
    res.status === 200 && res.data.state.treatments.length === 0 &&
    res.data.state.inventory.length === 0 && Array.isArray(res.data.state.invoices));
  res = await receptionistCall('PUT', '/api/state', {
    state: {
      patients: [],
      treatments: [{ id: 'INJECTED-TREATMENT' }],
      inventory: [],
      settings: { clinicName: 'Unauthorized change' }
    }
  });
  check('scoped state sync accepts authorized data only', res.status === 200 &&
    ctx.app.records.find('inventory', adminOnlyRecord.id) !== null &&
    ctx.app.records.find('treatments', 'INJECTED-TREATMENT') === null &&
    (await ctx.app.settings.get('clinicName')) === 'Braganza Dental Clinic');

  res = await call('POST', '/api/auth/login', { username: 'Demo@braganzadental.ph', password: 'test-admin-password' });
  check('email address also signs in', res.status === 200, 'status ' + res.status);

  process.stdout.write('\nGoogle identity linking\n');
  ctx.app.auth.verifyFirebaseToken = async function (token) {
    const identities = {
      'test-google-auth-token-000000000': {
        uid: 'firebase-admin-google',
        firebase: { sign_in_provider: 'google.com' },
        email: 'Demo@braganzadental.ph',
        email_verified: true,
        name: 'Demo acc',
        picture: 'https://lh3.googleusercontent.com/admin-photo'
      },
      'test-google-new-user-token-000000000': {
        uid: 'firebase-new-google-user',
        firebase: { sign_in_provider: 'google.com' },
        email: 'googleuser@gmail.com',
        email_verified: true,
        name: 'Google User'
      },
      'test-phone-auth-token-000000000': {
        uid: 'firebase-phone-user',
        firebase: { sign_in_provider: 'phone' },
        phone_number: '+14155552670'
      }
    };
    if (!identities[token]) throw new Error('Invalid test token');
    return identities[token];
  };
  res = await call('GET', '/api/auth/config');
  check('Firebase server credentials are not exposed and unconfigured auth is disabled',
    res.status === 200 && res.data.firebaseEnabled === false && res.data.firebase === null &&
    res.data.otp.email === true && res.data.otp.sms === true);
  ctx.app.config.firebase = {
    apiKey: 'web-key',
    authDomain: 'clinic.example.firebaseapp.com',
    projectId: 'clinic-project',
    appId: 'web-app-id',
    serviceAccountJson: '{"private_key":"must-not-be-sent-to-browser"}'
  };
  res = await call('GET', '/api/auth/config');
  check('public Firebase config excludes Admin service-account credentials',
    res.status === 200 && res.data.firebaseEnabled === true &&
    res.data.firebase.apiKey === 'web-key' &&
    JSON.stringify(res.data).indexOf('must-not-be-sent-to-browser') === -1);

  res = await call('POST', '/api/auth/firebase', { idToken: 'test-google-auth-token-000000000', mode: 'login' });
  const googleAdminId = res.data.user.id;
  check('verified Google email links an existing administrator', res.status === 200 && res.data.user.email === 'Demo@braganzadental.ph');
  check('Google sign-in creates a linked identity row',
    ctx.app.users.findByFirebaseUid('firebase-admin-google').id === googleAdminId);
  check('Google profile picture is returned from the linked account',
    res.data.user.photoURL === 'https://lh3.googleusercontent.com/admin-photo');
  res = await call('POST', '/api/auth/firebase', { idToken: 'test-google-new-user-token-000000000' });
  check('Google sign-in cannot create accounts without administrator provisioning',
    res.status === 403 && res.data.error.code === 'account_not_found' &&
    ctx.app.users.findByEmail('googleuser@gmail.com') === null);
  const googleUser = ctx.app.auth.createAccount({
    name: 'Google User',
    username: 'googleuser',
    email: 'googleuser@gmail.com',
    password: 'google-user-password',
    role: 'Receptionist'
  }, ctx.app.users.findByLogin('admin').id);
  res = await call('POST', '/api/auth/firebase', { idToken: 'test-google-new-user-token-000000000' });
  check('administrator-provisioned Google account signs in and links identity',
    res.status === 200 && res.data.user.id === googleUser.id &&
    ctx.app.users.findByFirebaseUid('firebase-new-google-user').id === googleUser.id);
  res = await call('POST', '/api/auth/firebase', { idToken: 'test-phone-auth-token-000000000' });
  check('Firebase phone provider is rejected in favor of backend OTP', res.status === 401);

  process.stdout.write('\nemail and SMS OTP verification\n');
  let deliveredEmailCode = '';
  let deliveredSmsCode = '';
  ctx.app.otp.sendEmail = async function (config, delivery) { deliveredEmailCode = delivery.code; };
  ctx.app.otp.sendSms = async function (config, delivery) { deliveredSmsCode = delivery.code; };
  const emailUser = ctx.app.auth.createAccount({
    name: 'New Email User',
    username: 'newemailuser',
    email: 'newuser@gmail.com',
    password: 'new-email-password',
    role: 'Receptionist'
  }, ctx.app.users.findByLogin('admin').id);
  const phoneUser = ctx.app.auth.createAccount({
    name: 'Phone User',
    username: 'phoneuser',
    email: 'phoneuser@example.com',
    phone: '+14155552671',
    password: 'phone-user-password',
    role: 'Receptionist'
  }, ctx.app.users.findByLogin('admin').id);
  res = await call('POST', '/api/auth/otp/request', { identifier: 'invalid@example.com' });
  check('non-Gmail email identifiers are rejected', res.status === 400 && res.data.error.code === 'invalid_identifier');
  res = await call('POST', '/api/auth/otp/request', { identifier: 'newuser@gmail.com' });
  const emailChallenge = res.data && res.data.challengeId;
  check('email challenge is sent without exposing the OTP', res.status === 200 &&
    !!emailChallenge && res.data.code === undefined && /^\d{6}$/.test(deliveredEmailCode));
  const emailChallengeRow = ctx.app.db.prepare('SELECT code_hash FROM auth_otp_challenges WHERE id = ?').get(emailChallenge);
  check('OTP storage contains only a hash', !!emailChallengeRow && emailChallengeRow.code_hash !== deliveredEmailCode);
  res = await call('POST', '/api/auth/otp/request', { identifier: 'newuser@gmail.com' });
  check('resend cooldown is enforced', res.status === 429 && res.data.error.code === 'otp_rate_limited' &&
    res.data.error.details.retryAfter > 0);
  res = await call('POST', '/api/auth/otp/verify', {
    challengeId: emailChallenge, identifier: 'newuser@gmail.com',
    code: deliveredEmailCode === '000000' ? '000001' : '000000', name: 'New Email User'
  });
  check('incorrect OTP is rejected', res.status === 400 && res.data.error.code === 'invalid_code');
  res = await call('POST', '/api/auth/otp/verify', {
    challengeId: emailChallenge, identifier: 'newuser@gmail.com', code: deliveredEmailCode, name: 'New Email User'
  });
  check('verified Gmail signs in to the administrator-provisioned account',
    res.status === 200 && res.data.user.id === emailUser.id);
  check('verified Gmail identity is linked to the account',
    ctx.app.users.findByIdentity('otp-email', 'newuser@gmail.com').id === emailUser.id &&
    ctx.app.db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?').get(emailUser.id).count > 0);
  ctx.app.config.otp.resendCooldownMs = 0;
  res = await call('POST', '/api/auth/otp/request', { identifier: 'newuser@gmail.com' });
  res = await call('POST', '/api/auth/otp/verify', {
    challengeId: res.data.challengeId, identifier: 'newuser@gmail.com', code: deliveredEmailCode, name: ''
  });
  check('approved Gmail identity signs in and receives a session', res.status === 200 &&
    res.data.user.id === emailUser.id && !!res.data.expiresAt);
  res = await call('POST', '/api/auth/otp/verify', {
    challengeId: emailChallenge, identifier: 'newuser@gmail.com', code: deliveredEmailCode, name: ''
  });
  check('a verified OTP cannot be replayed', res.status === 410 && res.data.error.code === 'otp_expired');

  res = await call('POST', '/api/auth/otp/request', { identifier: 'unprovisioned@gmail.com' });
  const unprovisionedChallenge = res.data.challengeId;
  const unprovisionedCode = deliveredEmailCode;
  res = await call('POST', '/api/auth/otp/verify', {
    challengeId: unprovisionedChallenge,
    identifier: 'unprovisioned@gmail.com',
    code: unprovisionedCode
  });
  check('verified OTP cannot create a new account without an administrator',
    res.status === 403 && res.data.error.code === 'account_not_found' &&
    ctx.app.users.findByEmail('unprovisioned@gmail.com') === null);

  res = await call('POST', '/api/auth/otp/request', { identifier: '+14155552671' });
  const phoneChallenge = res.data && res.data.challengeId;
  check('international phone receives an SMS OTP', res.status === 200 && /^\d{6}$/.test(deliveredSmsCode));
  res = await call('POST', '/api/auth/otp/verify', {
    challengeId: phoneChallenge, identifier: '+14155552671', code: deliveredSmsCode, name: 'Phone User'
  });
  check('verified SMS signs in to the administrator-provisioned account', res.status === 200 &&
    res.data.user.id === phoneUser.id);

  res = await call('POST', '/api/auth/otp/request', { identifier: '+14155552672' });
  const limitedChallenge = res.data.challengeId;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    res = await call('POST', '/api/auth/otp/verify', {
      challengeId: limitedChallenge,
      identifier: '+14155552672',
      code: deliveredSmsCode === '000000' ? '000001' : '000000',
      name: 'Attempt Limit User'
    });
  }
  check('verification attempts are capped per code',
    res.status === 429 && res.data.error.code === 'otp_attempts_exceeded');

  ctx.app.config.otp.expiresMs = 2;
  res = await call('POST', '/api/auth/otp/request', { identifier: 'expired@gmail.com' });
  const expiredChallenge = res.data && res.data.challengeId;
  await new Promise(function (resolve) { setTimeout(resolve, 10); });
  res = await call('POST', '/api/auth/otp/verify', {
    challengeId: expiredChallenge, identifier: 'expired@gmail.com', code: deliveredEmailCode, name: 'Expired User'
  });
  check('expired OTP is rejected', res.status === 410 && res.data.error.code === 'otp_expired');
  ctx.app.config.otp.expiresMs = 5 * 60 * 1000;

  const sendEmail = ctx.app.otp.sendEmail;
  ctx.app.otp.sendEmail = async function () { throw new Error('test delivery failure'); };
  res = await call('POST', '/api/auth/otp/request', { identifier: 'deliveryfail@gmail.com' });
  check('delivery failures return an explicit error and remove the challenge',
    res.status === 503 && res.data.error.code === 'otp_delivery_failed' &&
    ctx.app.db.prepare("SELECT COUNT(*) AS count FROM auth_otp_challenges WHERE destination_hash = ?").get(
      ctx.app.otp.digest('destination:deliveryfail@gmail.com')
    ).count === 0);
  ctx.app.otp.sendEmail = sendEmail;

  res = await call('POST', '/api/auth/login', { username: 'admin', password: 'test-admin-password' });
  check('administrator session is restored after non-admin authentication tests',
    res.status === 200 && res.data.user.role === 'Administrator');

  process.stdout.write('\nseeded state\n');
  res = await call('GET', '/api/state');
  const seeded = res.data.state;
  check('state loads for a signed in user', res.status === 200);
  check('clinic starts with zero patients', seeded.patients.length === 0);
  check('clinic starts with zero appointments', seeded.appointments.length === 0 && seeded.invoices.length === 0);
  check('administrator record is present', seeded.doctors.length === 1 && seeded.doctors[0].id === 'DR-01');
  check('settings carry clinic defaults', seeded.settings.clinicName === 'Braganza Dental Clinic' && seeded.settings.currency === '\u20b1');
  check('work days survive as an array', Array.isArray(seeded.settings.workDays) && seeded.settings.workDays.length === 6);
  check('counters are seeded', seeded.counters.ap === 1000 && seeded.counters.inv === 5000);

  process.stdout.write('\nsnapshot synchronisation\n');
  const snapshot = JSON.parse(JSON.stringify(seeded));
  snapshot.patients = [
    { id: 'PT-2026-0002', name: 'Bea Alonzo', phone: '0917-000-0002', email: 'bea@example.com', age: 31, gender: 'Female', status: 'Active', lastVisit: '2026-09-01', notes: 'Second added, listed first' },
    { id: 'PT-2026-0001', name: 'Andres Cruz', phone: '0917-000-0001', email: 'andres@example.com', age: 44, gender: 'Male', status: 'Active', lastVisit: '2026-08-20' }
  ];
  snapshot.appointments = [
    { id: 'AP-1001', patientId: 'PT-2026-0001', doctorId: 'DR-01', date: '2026-09-10', time: '09:30', type: 'Check-up', status: 'Confirmed', notes: '' }
  ];
  snapshot.invoices = [
    {
      id: 'INV-5001',
      patientId: 'PT-2026-0001',
      treatmentId: '',
      date: '2026-09-01',
      dueDate: '2026-09-15',
      items: [{ desc: 'Prophylaxis', qty: 1, price: 1200 }, { desc: 'Fluoride', qty: 2, price: 350.5 }],
      discount: 100,
      paid: 500,
      method: 'GCash'
    }
  ];
  snapshot.counters.ap = 1001;
  snapshot.counters.pt = 2;
  snapshot.settings.address = 'M.Roxas St., Poblacion, Valencia City, Bukidnon';

  res = await call('PUT', '/api/state', { state: snapshot });
  check('snapshot is accepted', res.status === 200, 'status ' + res.status);

  res = await call('GET', '/api/state');
  const stored = res.data.state;
  check('patients persist', stored.patients.length === 2);
  check('insertion order is preserved', stored.patients[0].id === 'PT-2026-0002' && stored.patients[1].id === 'PT-2026-0001');
  check('nested invoice items persist', stored.invoices[0].items.length === 2 && stored.invoices[0].items[1].price === 350.5);
  check('numeric fields keep their type', stored.invoices[0].discount === 100 && stored.patients[1].age === 44);
  check('unmapped fields survive', stored.patients[0].notes === 'Second added, listed first');
  check('counters update', stored.counters.ap === 1001 && stored.counters.pt === 2);
  check('settings update', stored.settings.address === 'M.Roxas St., Poblacion, Valencia City, Bukidnon');

  res = await call('GET', '/api/patients?name=%27%20OR%201%3D1%20--');
  check('record filters treat SQL as a bound value', res.status === 200 && res.data.items.length === 0);

  const trimmed = JSON.parse(JSON.stringify(stored));
  trimmed.patients = trimmed.patients.filter(function (p) { return p.id !== 'PT-2026-0002'; });
  res = await call('PUT', '/api/state', trimmed);
  check('bare snapshot body is accepted', res.status === 200, 'status ' + res.status);
  res = await call('GET', '/api/state');
  check('deletes propagate to the database', res.data.state.patients.length === 1 && res.data.state.patients[0].id === 'PT-2026-0001');

  process.stdout.write('\nsnapshot validation\n');
  res = await call('PUT', '/api/state', { state: { patients: 'not-an-array', settings: {} } });
  check('malformed collections are rejected', res.status === 422, 'status ' + res.status);
  res = await call('PUT', '/api/state', { state: { patients: [{ name: 'No id' }], settings: {} } });
  check('records without an id are rejected', res.status === 422, 'status ' + res.status);
  res = await call('PUT', '/api/state', { state: { patients: [{ id: 'X' }, { id: 'X' }], settings: {} } });
  check('duplicate ids are rejected', res.status === 422, 'status ' + res.status);
  res = await call('GET', '/api/state');
  check('rejected writes leave data intact', res.data.state.patients.length === 1);

  process.stdout.write('\nrest resources\n');
  res = await call('POST', '/api/patients', { name: 'Carla Reyes', phone: '0917-000-0003', status: 'Active' });
  const createdId = res.data && res.data.item ? res.data.item.id : null;
  check('patient is created with a generated id', res.status === 201 && /^PT-\d{4}-\d{4}$/.test(createdId || ''), 'status ' + res.status);

  res = await call('GET', '/api/patients/' + createdId);
  check('patient is readable by id', res.status === 200 && res.data.item.name === 'Carla Reyes');

  res = await call('PATCH', '/api/patients/' + createdId, { status: 'Inactive' });
  check('patch merges fields', res.status === 200 && res.data.item.status === 'Inactive' && res.data.item.phone === '0917-000-0003');

  res = await call('GET', '/api/patients?status=Inactive');
  check('collection filters by indexed column', res.status === 200 && res.data.items.length === 1 && res.data.items[0].id === createdId);

  res = await call('POST', '/api/patients', { id: createdId, name: 'Duplicate' });
  check('duplicate id returns conflict', res.status === 409, 'status ' + res.status);

  res = await call('GET', '/api/patients/PT-DOES-NOT-EXIST');
  check('missing record returns not found', res.status === 404, 'status ' + res.status);

  res = await call('DELETE', '/api/patients/' + createdId);
  check('patient is deletable', res.status === 200);
  res = await call('GET', '/api/patients/' + createdId);
  check('deleted patient is gone', res.status === 404);

  res = await call('GET', '/api/appointments?patientId=PT-2026-0001');
  check('appointments filter by patient', res.status === 200 && res.data.items.length === 1);

  res = await call('PATCH', '/api/settings', { phone: '(088) 000-0000' });
  check('settings patch applies', res.status === 200 && res.data.settings.phone === '(088) 000-0000');

  res = await call('GET', '/api/stats');
  check('stats report row counts', res.status === 200 && res.data.counts.patients === 1);

  res = await call('GET', '/api/audit?limit=5');
  check('audit trail records writes', res.status === 200 && res.data.entries.length > 0);

  res = await call('GET', '/api/unknown-endpoint');
  check('unknown endpoint returns 404 json', res.status === 404 && res.data.error.code === 'not_found');

  res = await call('DELETE', '/api/state');
  check('unsupported method returns 405', res.status === 405, 'status ' + res.status);

  process.stdout.write('\nstatic frontend\n');
  const page = await fetch(ctx.base + '/');
  const html = await page.text();
  check('index page is served', page.status === 200 && /Braganza Dental Clinic/.test(html));
  check('security headers are present', page.headers.get('x-content-type-options') === 'nosniff' && !!page.headers.get('content-security-policy'));
  check('frontend has no hardcoded password', html.indexOf('ADMIN_PASSWORD') === -1);
  check('password, Google and server OTP controls are present', /Sign in/.test(html) &&
    /Continue with Google/.test(html) && /Send verification code/.test(html) && /otp-auth.js/.test(html));
  check('role-specific dashboard and admin-only account creation UI are present',
    /ROLE_NAV/.test(html) && /function teamDashboard/.test(html) &&
    /function accountForm/.test(html) && /if\(!isAdmin\(\)\)/.test(html) &&
    !/Send SMS code/.test(html) && /otpCodeStep/.test(html));
  check('account creation offers only Assistant and Dentist roles',
    /ACCOUNT_CREATION_ROLES=\[\{v:'Dentist',l:'Dentist'\},\{v:'Dental Assistant',l:'Assistant'\}\]/.test(html) &&
    /selectF\('role',ACCOUNT_CREATION_ROLES,'Dental Assistant','v','l'\)/.test(html));
  const traversal = await fetch(ctx.base + '/../package.json');
  check('path traversal is blocked', traversal.status === 404 || traversal.status === 403, 'status ' + traversal.status);

  process.stdout.write('\ndurability across restart\n');
  await ctx.app.close();
  ctx = await boot();
  call = client(ctx.base);
  res = await call('POST', '/api/auth/login', { username: 'admin', password: 'test-admin-password' });
  check('credentials survive a restart', res.status === 200, 'status ' + res.status);
  res = await call('GET', '/api/state');
  check('records survive a restart', res.status === 200 && res.data.state.patients.length === 1 && res.data.state.patients[0].name === 'Andres Cruz');
  check('nested data survives a restart', res.data.state.invoices[0].items.length === 2);
  check('settings survive a restart', res.data.state.settings.phone === '(088) 000-0000');

  process.stdout.write('\nsign out\n');
  res = await call('POST', '/api/auth/logout');
  check('sign out succeeds', res.status === 200);
  res = await call('GET', '/api/state');
  check('session is invalid after sign out', res.status === 401, 'status ' + res.status);

  await ctx.app.close();
  fs.rmSync(testDataDir, { recursive: true, force: true });

  process.stdout.write('\n' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(function (error) {
  process.stderr.write('Test run failed: ' + (error && error.stack ? error.stack : error) + '\n');
  process.exit(1);
});
