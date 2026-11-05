'use strict';

class UserRepository {
  constructor(db) {
    this.db = db;
  }

  count() {
    return this.db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  }

  findById(id) {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
  }

  findByLogin(login) {
    const value = String(login || '').trim().toLowerCase();
    if (!value) return null;
    return this.db.prepare(
      'SELECT * FROM users WHERE lower(username) = ? OR lower(email) = ? LIMIT 1'
    ).get(value, value) || null;
  }

  findByFirebaseUid(uid) {
    return this.db.prepare(
      'SELECT users.* FROM users JOIN auth_identities ON auth_identities.user_id = users.id ' +
      'WHERE auth_identities.provider = ? AND auth_identities.subject = ?'
    ).get('firebase', uid) || null;
  }

  findByIdentity(provider, subject) {
    return this.db.prepare(
      'SELECT users.* FROM users JOIN auth_identities ON auth_identities.user_id = users.id ' +
      'WHERE auth_identities.provider = ? AND auth_identities.subject = ?'
    ).get(provider, subject) || null;
  }

  findByEmail(email) {
    if (!email) return null;
    return this.db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(email.toLowerCase()) || null;
  }

  findByPhone(phone) {
    if (!phone) return null;
    return this.db.prepare('SELECT * FROM users WHERE phone = ?').get(phone) || null;
  }

  linkFirebaseIdentity(userId, identity) {
    this.linkIdentity('firebase', identity.uid, userId, {
      email: identity.email,
      phone: identity.phone,
      photoUrl: identity.photoUrl,
      timestamp: identity.timestamp
    });
  }

  linkIdentity(provider, subject, userId, identity) {
    const now = identity.timestamp || new Date().toISOString();
    this.db.prepare(
      'INSERT INTO auth_identities (provider, subject, user_id, email, phone, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(provider, subject) DO NOTHING'
    ).run(provider, subject, userId, identity.email || null, identity.phone || null, now, now);
    const linked = this.db.prepare(
      'SELECT user_id FROM auth_identities WHERE provider = ? AND subject = ?'
    ).get(provider, subject);
    if (!linked || linked.user_id !== userId) {
      const error = new Error('This identity is already linked to another account.');
      error.status = 409;
      error.code = 'identity_conflict';
      throw error;
    }
    this.db.prepare(
      'UPDATE auth_identities SET email = ?, phone = ?, updated_at = ? WHERE provider = ? AND subject = ?'
    ).run(identity.email || null, identity.phone || null, now, provider, subject);
    this.db.prepare(
      'UPDATE users SET phone = COALESCE(phone, ?), photo_url = COALESCE(?, photo_url), updated_at = ? WHERE id = ?'
    ).run(identity.phone || null, identity.photoUrl || null, now, userId);
  }

  create(user, timestamp) {
    const now = timestamp || new Date().toISOString();
    this.db.prepare(
      'INSERT INTO users (' +
      'id, username, email, name, role, doctor_id, password_hash, password_salt, active, phone, photo_url, created_at, updated_at' +
      ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      user.id, user.username, user.email || null, user.name, user.role || 'Staff',
      user.doctorId || null, user.passwordHash, user.passwordSalt, user.active === false ? 0 : 1,
      user.phone || null, user.photoUrl || null, now, now
    );
    return this.findById(user.id);
  }

  pending() {
    return this.db.prepare(
      'SELECT id, username, email, phone, name, photo_url, created_at FROM users WHERE active = 0 ORDER BY created_at ASC'
    ).all();
  }

  approve(id, timestamp) {
    return this.db.prepare('UPDATE users SET active = 1, updated_at = ? WHERE id = ? AND active = 0')
      .run(timestamp || new Date().toISOString(), id).changes > 0;
  }

  updatePassword(id, hash, salt, timestamp) {
    const now = timestamp || new Date().toISOString();
    this.db.prepare(
      'UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?'
    ).run(hash, salt, now, id);
  }

  touchLogin(id, timestamp) {
    this.db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
      .run(timestamp || new Date().toISOString(), id);
  }
}

class SessionRepository {
  constructor(db) {
    this.db = db;
  }

  create(session) {
    this.db.prepare(
      'INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      session.id, session.userId, session.createdAt, session.expiresAt,
      session.userAgent || null, session.ip || null
    );
  }

  find(id) {
    if (!id) return null;
    return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) || null;
  }

  touch(id, expiresAt) {
    this.db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(expiresAt, id);
  }

  destroy(id) {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  destroyForUser(userId) {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  purgeExpired(now) {
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?')
      .run(now || new Date().toISOString());
  }
}

class AuditRepository {
  constructor(db) {
    this.db = db;
  }

  record(entry) {
    this.db.prepare(
      'INSERT INTO audit_log (at, user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      entry.at || new Date().toISOString(), entry.userId || null, entry.action,
      entry.entity || null, entry.entityId || null,
      entry.detail ? JSON.stringify(entry.detail) : null
    );
  }

  recent(limit) {
    const max = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
    return this.db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(max);
  }
}

module.exports = {
  UserRepository: UserRepository,
  SessionRepository: SessionRepository,
  AuditRepository: AuditRepository
};
