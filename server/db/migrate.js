'use strict';

const fs = require('fs');
const path = require('path');

const SCHEMA_FILE = path.join(__dirname, 'schema.sql');

function migrate(db) {
  db.exec(fs.readFileSync(SCHEMA_FILE, 'utf8'));
  const recordVersion = db.prepare(
    'INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)'
  );
  recordVersion.run(1, new Date().toISOString());
  db.write(function () {
    const userColumns = db.prepare('PRAGMA table_info(users)').all()
      .map(function (column) { return column.name; });
    if (userColumns.indexOf('phone') === -1) db.exec('ALTER TABLE users ADD COLUMN phone TEXT');
    if (userColumns.indexOf('photo_url') === -1) db.exec('ALTER TABLE users ADD COLUMN photo_url TEXT');
    db.exec(
      'CREATE TABLE IF NOT EXISTS auth_identities (' +
      'provider TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL, email TEXT, phone TEXT, ' +
      'created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (provider, subject), ' +
      'FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE)'
    );
    db.exec('CREATE INDEX IF NOT EXISTS idx_auth_identities_user ON auth_identities (user_id)');
    db.exec(
      'CREATE TABLE IF NOT EXISTS auth_otp_challenges (' +
      'id TEXT PRIMARY KEY, channel TEXT NOT NULL CHECK (channel IN (\'email\', \'sms\')), ' +
      'destination_hash TEXT NOT NULL, code_hash TEXT NOT NULL, created_at INTEGER NOT NULL, ' +
      'expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, consumed_at INTEGER)'
    );
    db.exec(
      'CREATE TABLE IF NOT EXISTS auth_otp_rate_limits (' +
      'bucket_hash TEXT PRIMARY KEY, attempts INTEGER NOT NULL, window_started_at INTEGER NOT NULL, ' +
      'last_sent_at INTEGER NOT NULL)'
    );
    db.exec('CREATE INDEX IF NOT EXISTS idx_auth_otp_challenges_destination ON auth_otp_challenges (destination_hash, created_at)');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_users_phone ON users (phone) WHERE phone IS NOT NULL');
    recordVersion.run(2, new Date().toISOString());
    recordVersion.run(3, new Date().toISOString());
  });
  return [];
}

module.exports = { migrate: migrate };
