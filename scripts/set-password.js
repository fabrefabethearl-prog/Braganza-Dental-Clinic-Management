'use strict';

const path = require('path');
const config = require(path.join(__dirname, '..', 'server', 'config'));
const Supabase = require(path.join(__dirname, '..', 'server', 'db', 'supabase'));
const { migrate } = require(path.join(__dirname, '..', 'server', 'db', 'migrate'));
const { UserRepository, SessionRepository, AuditRepository } = require(path.join(__dirname, '..', 'server', 'repositories', 'accounts'));
const { hashPassword } = require(path.join(__dirname, '..', 'server', 'services', 'auth'));

async function main() {
  const login = process.argv[2];
  const password = process.argv[3];

  if (!login || !password) {
    process.stdout.write('Usage: npm run set-password -- <username-or-email> <new-password>\n');
    process.exit(1);
  }
  if (String(password).length < 8) {
    process.stderr.write('The new password must be at least 8 characters long.\n');
    process.exit(1);
  }

  const db = await Supabase.open(config.supabaseUrl, config.supabaseKey);
  await migrate(db);

  const users = new UserRepository(db);
  const sessions = new SessionRepository(db);
  const audit = new AuditRepository(db);

  const user = await users.findByLogin(login);
  if (!user) {
    process.stderr.write('No account found for "' + login + '".\n');
    await db.close();
    process.exit(1);
    return;
  }

  const credentials = hashPassword(password);
  const now = new Date().toISOString();

  await db.write(async function () {
    await users.updatePassword(user.id, credentials.hash, credentials.salt, now);
    await sessions.destroyForUser(user.id);
    await audit.record({ at: now, userId: user.id, action: 'auth.password.reset', entity: 'user', entityId: user.id });
  });

  await db.close();
  process.stdout.write('Password updated for ' + user.username + '. All active sessions were signed out.\n');
}

main().catch(function (error) {
  process.stderr.write('Failed to update password: ' + (error && error.stack ? error.stack : error) + '\n');
  process.exit(1);
});
