'use strict';

const crypto = require('crypto');
const { verifyIdToken } = require('./firebase');
const permissions = require('./permissions');

const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), useSalt, SCRYPT_KEYLEN, SCRYPT_OPTIONS);
  return { hash: derived.toString('hex'), salt: useSalt };
}

function verifyPassword(password, hash, salt) {
  if (!hash || !salt) return false;
  let derived;
  try {
    derived = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS);
  } catch (error) {
    void error;
    return false;
  }
  const expected = Buffer.from(hash, 'hex');
  if (expected.length !== derived.length) return false;
  return crypto.timingSafeEqual(expected, derived);
}

class LoginThrottle {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.buckets = new Map();
  }

  key(ip, login) {
    return String(ip || 'unknown') + '|' + String(login || '').toLowerCase();
  }

  check(ip, login) {
    const key = this.key(ip, login);
    const bucket = this.buckets.get(key);
    const now = Date.now();
    if (!bucket || now > bucket.resetAt) return { blocked: false, retryAfterMs: 0 };
    if (bucket.count < this.limit) return { blocked: false, retryAfterMs: 0 };
    return { blocked: true, retryAfterMs: bucket.resetAt - now };
  }

  fail(ip, login) {
    const key = this.key(ip, login);
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }
    bucket.count += 1;
  }

  clear(ip, login) {
    this.buckets.delete(this.key(ip, login));
  }

  sweep() {
    const now = Date.now();
    const buckets = this.buckets;
    buckets.forEach(function (bucket, key) {
      if (now > bucket.resetAt) buckets.delete(key);
    });
  }
}

class AuthService {
  constructor(context) {
    this.db = context.db;
    this.users = context.users;
    this.sessions = context.sessions;
    this.audit = context.audit;
    this.config = context.config;
    this.verifyFirebaseToken = context.verifyFirebaseToken || verifyIdToken;
    this.throttle = new LoginThrottle(
      context.config.security.loginMaxAttempts,
      context.config.security.loginWindowMs
    );
  }

  async ensureBootstrapAdmin() {
    if ((await this.users.count()) > 0) return false;
    const admin = this.config.bootstrapAdmin;
    if (typeof admin.password !== 'string' || admin.password.length < 12) {
      throw new Error('Set ADMIN_PASSWORD to a unique password of at least 12 characters before the first start.');
    }
    const credentials = hashPassword(admin.password);
    const now = new Date().toISOString();
    const self = this;
    this.db.write(function () {
      self.users.create(
        {
          id: 'USR-' + crypto.randomBytes(8).toString('hex'),
          username: admin.username,
          email: admin.email,
          name: admin.name,
          role: 'Administrator',
          doctorId: admin.doctorId,
          passwordHash: credentials.hash,
          passwordSalt: credentials.salt,
          active: true
        },
        now
      );
      self.audit.record({ at: now, action: 'user.bootstrap', entity: 'user', entityId: admin.username });
    });
    return true;
  }

  async login(login, password, meta) {
    const throttled = this.throttle.check(meta.ip, login);
    if (throttled.blocked) {
      throw httpError(429, 'too_many_attempts', 'Too many sign-in attempts. Try again in a few minutes.', {
        retryAfter: Math.ceil(throttled.retryAfterMs / 1000)
      });
    }
    const user = await this.users.findByLogin(login);
    const valid = user && user.active === 1 && verifyPassword(password, user.password_hash, user.password_salt);
    if (!valid) {
      this.throttle.fail(meta.ip, login);
      const self = this;
      this.db.write(function () {
        self.audit.record({
          at: new Date().toISOString(),
          userId: user ? user.id : null,
          action: 'auth.login.failed',
          entity: 'user',
          entityId: String(login || '').slice(0, 120)
        });
      });
      throw httpError(401, 'invalid_credentials', 'Incorrect username or password.');
    }
    this.throttle.clear(meta.ip, login);
    return this.createSession(user, meta);
  }

  createAccount(input, actorId) {
    const account = input || {};
    const username = String(account.username || '').trim();
    const email = String(account.email || '').trim().toLowerCase();
    const name = String(account.name || '').trim();
    const password = String(account.password || '');
    const role = String(account.role || 'Receptionist').trim();
    const phone = String(account.phone || '').trim();

    if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) {
      throw httpError(422, 'invalid_username', 'Username must be 3–40 characters and use letters, numbers, dots, underscores or hyphens.');
    }
    if (name.length < 2 || name.length > 120) {
      throw httpError(422, 'invalid_name', 'Enter a name between 2 and 120 characters.');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      throw httpError(422, 'invalid_email', 'Enter a valid email address.');
    }
    if (phone && !/^\+[1-9]\d{7,14}$/.test(phone)) {
      throw httpError(422, 'invalid_phone', 'Enter a phone number in international format, such as +14155552671.');
    }
    if (password.length < 8 || password.length > 128) {
      throw httpError(422, 'weak_password', 'Password must be between 8 and 128 characters.');
    }
    if (!permissions.isAccountRole(role)) {
      throw httpError(422, 'invalid_role', 'Choose an authorized clinic role.');
    }
    if (this.users.findByLogin(username) || this.users.findByLogin(email) ||
        (phone && this.users.findByPhone(phone))) {
      throw httpError(409, 'account_exists', 'That username or email is already in use.');
    }

    const credentials = hashPassword(password);
    const now = new Date().toISOString();
    let user;
    try {
      this.db.write(() => {
        user = this.users.create({
          id: 'USR-' + crypto.randomBytes(8).toString('hex'),
          username: username,
          email: email,
          phone: phone || null,
          name: name,
          role: role,
          passwordHash: credentials.hash,
          passwordSalt: credentials.salt,
          active: true
        }, now);
        this.audit.record({
          at: now,
          userId: actorId,
          action: 'user.create',
          entity: 'user',
          entityId: user.id,
          detail: { username: username, role: role }
        });
      });
    } catch (error) {
      if (error && String(error.code || '').indexOf('SQLITE_CONSTRAINT') === 0) {
        throw httpError(409, 'account_exists', 'That username or email is already in use.');
      }
      throw error;
    }
    return publicUser(user);
  }

  async loginWithFirebase(idToken, meta) {
    if (typeof idToken !== 'string' || idToken.length < 20 || idToken.length > 12000) {
      throw httpError(400, 'invalid_token', 'A valid Firebase sign-in token is required.');
    }
    const throttleKey = 'firebase-auth';
    const throttled = this.throttle.check(meta.ip, throttleKey);
    if (throttled.blocked) {
      throw httpError(429, 'too_many_attempts', 'Too many authentication attempts. Try again in a few minutes.', {
        retryAfter: Math.ceil(throttled.retryAfterMs / 1000)
      });
    }

    let claims;
    try {
      claims = await this.verifyFirebaseToken(idToken, this.config);
    } catch (error) {
      if (error.status) throw error;
      this.throttle.fail(meta.ip, throttleKey);
      throw httpError(401, 'invalid_token', 'The sign-in token is invalid or expired.');
    }

    const provider = claims.firebase && claims.firebase.sign_in_provider;
    const email = claims.email && claims.email_verified === true
      ? String(claims.email).trim().toLowerCase()
      : null;
    if (!claims.uid || provider !== 'google.com' || !email) {
      this.throttle.fail(meta.ip, throttleKey);
      throw httpError(401, 'unverified_identity', 'Use a Google account with a verified email address.');
    }

    const byUid = this.users.findByFirebaseUid(claims.uid);
    const byEmail = email ? this.users.findByEmail(email) : null;
    if (byUid && byEmail && byUid.id !== byEmail.id) {
      throw httpError(409, 'identity_conflict', 'This identity matches more than one clinic account. Contact the clinic administrator.');
    }

    let user = byUid || byEmail;
    if (!user) {
      throw httpError(403, 'account_not_found', 'No clinic account matches this Google account. Ask an administrator to create your account.');
    }

    const now = new Date().toISOString();
    this.db.write(() => {
      this.users.linkFirebaseIdentity(user.id, {
        uid: claims.uid,
        email: email,
        phone: null,
        photoUrl: safePhotoUrl(claims.picture),
        timestamp: now
      });
      this.audit.record({
        at: now,
        userId: user.id,
        action: byUid ? 'auth.firebase.login' : 'auth.firebase.link',
        entity: 'user',
        entityId: user.id
      });
    });

    user = this.users.findById(user.id);
    if (user.active !== 1) {
      throw httpError(403, 'account_pending', 'Your account was created and is awaiting clinic administrator approval.');
    }
    this.throttle.clear(meta.ip, throttleKey);
    return this.createSession(user, meta);
  }

  createSession(user, meta) {
    const now = new Date();
    const session = {
      id: crypto.randomBytes(32).toString('hex'),
      userId: user.id,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.config.session.ttlMs).toISOString(),
      userAgent: (meta.userAgent || '').slice(0, 255),
      ip: meta.ip || null
    };
    const self = this;
    this.db.write(function () {
      self.sessions.purgeExpired(now.toISOString());
      self.sessions.create(session);
      self.users.touchLogin(user.id, now.toISOString());
      self.audit.record({ at: now.toISOString(), userId: user.id, action: 'auth.login', entity: 'user', entityId: user.id });
    });
    return { session: session, user: publicUser(user) };
  }

  async resolve(sessionId) {
    if (!sessionId) return null;
    const session = await this.sessions.find(sessionId);
    if (!session) return null;
    if (new Date(session.expires_at).getTime() <= Date.now()) return null;
    const user = await this.users.findById(session.user_id);
    if (!user || user.active !== 1) return null;
    return { session: session, user: publicUser(user) };
  }

  async refresh(sessionId) {
    const expiresAt = new Date(Date.now() + this.config.session.ttlMs).toISOString();
    const self = this;
    this.db.write(function () {
      self.sessions.touch(sessionId, expiresAt);
    });
    return expiresAt;
  }

  async logout(sessionId, userId) {
    if (!sessionId) return;
    const self = this;
    this.db.write(function () {
      self.sessions.destroy(sessionId);
      self.audit.record({ at: new Date().toISOString(), userId: userId || null, action: 'auth.logout', entity: 'user', entityId: userId || null });
    });
  }

  async changePassword(userId, currentPassword, nextPassword) {
    const user = await this.users.findById(userId);
    if (!user) throw httpError(404, 'user_not_found', 'Account not found.');
    if (!verifyPassword(currentPassword, user.password_hash, user.password_salt)) {
      throw httpError(401, 'invalid_credentials', 'The current password is incorrect.');
    }
    if (!nextPassword || String(nextPassword).length < 8) {
      throw httpError(422, 'weak_password', 'The new password must be at least 8 characters long.');
    }
    const credentials = hashPassword(nextPassword);
    const now = new Date().toISOString();
    const self = this;
    this.db.write(function () {
      self.users.updatePassword(userId, credentials.hash, credentials.salt, now);
      self.sessions.destroyForUser(userId);
      self.audit.record({ at: now, userId: userId, action: 'auth.password.changed', entity: 'user', entityId: userId });
    });
  }
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    name: row.name,
    role: row.role,
    doctorId: row.doctor_id,
    lastLoginAt: row.last_login_at,
    photoURL: row.photo_url || null,
    phoneNumber: row.phone || null
  };
}

function safePhotoUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch (error) {
    return null;
  }
}

function httpError(status, code, message, extra) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (extra) error.extra = extra;
  return error;
}

module.exports = {
  AuthService: AuthService,
  hashPassword: hashPassword,
  verifyPassword: verifyPassword,
  publicUser: publicUser
};
