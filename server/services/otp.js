'use strict';

const crypto = require('crypto');

class OtpService {
  constructor(context) {
    this.db = context.db;
    this.users = context.users;
    this.sessions = context.sessions;
    this.audit = context.audit;
    this.config = context.config;
    this.auth = context.auth;
  }

  digest(value) {
    const secret = this.config.otp.secret;
    if (!secret || Buffer.byteLength(secret) < 32) {
      throw httpError(503, 'otp_unavailable', 'Verification is not configured on this server.');
    }
    return crypto.createHmac('sha256', secret).update(String(value)).digest('hex');
  }

  availability() {
    const otp = this.config.otp;
    const hasSecret = typeof otp.secret === 'string' && Buffer.byteLength(otp.secret) >= 32;
    const smtp = otp.smtp;
    const twilio = otp.twilio;
    return {
      email: hasSecret && !!(smtp.host && smtp.user && smtp.password && smtp.from),
      sms: hasSecret && !!(twilio.accountSid && twilio.authToken && twilio.fromNumber)
    };
  }

  async request(identifier, meta) {
    const destination = normalizeIdentifier(identifier);
    if (!destination) throw httpError(400, 'invalid_identifier', 'Enter a Gmail address or an international phone number.');
    const channel = destination.indexOf('@') !== -1 ? 'email' : 'sms';
    const availability = this.availability();
    if (!availability[channel]) {
      throw httpError(503, 'otp_unavailable', 'Verification delivery is not configured for this destination.');
    }

    const now = Date.now();
    const destinationHash = this.digest('destination:' + destination);
    this.enforceRateLimit(destinationHash, this.config.otp.destinationLimit, now, true);
    const ipHash = this.digest('ip:' + String(meta && meta.ip || 'unknown'));
    this.enforceRateLimit(ipHash, this.config.otp.ipLimit, now, false);

    const challengeId = crypto.randomBytes(24).toString('hex');
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const expiresAt = now + this.config.otp.expiresMs;
    const codeHash = this.digest('otp:' + challengeId + ':' + code);
    this.db.prepare(
      'UPDATE auth_otp_challenges SET consumed_at = ? WHERE destination_hash = ? AND consumed_at IS NULL'
    ).run(now, destinationHash);
    this.db.prepare(
      'INSERT INTO auth_otp_challenges ' +
      '(id, channel, destination_hash, code_hash, created_at, expires_at, attempts, consumed_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, 0, NULL)'
    ).run(challengeId, channel, destinationHash, codeHash, now, expiresAt);
    this.recordRateLimit(destinationHash, now);
    this.recordRateLimit(ipHash, now);

    try {
      const delivery = {
        to: destination,
        code: code,
        expiresInMinutes: Math.max(1, Math.ceil(this.config.otp.expiresMs / 60000))
      };
      if (channel === 'email') await this.sendEmail(this.config.otp, delivery);
      else await this.sendSms(this.config.otp, delivery);
    } catch (cause) {
      this.db.prepare('DELETE FROM auth_otp_challenges WHERE id = ?').run(challengeId);
      const error = httpError(503, 'otp_delivery_failed', 'The verification code could not be delivered. Try again later.');
      error.cause = cause;
      throw error;
    }

    return {
      challengeId: challengeId,
      channel: channel,
      expiresInSeconds: Math.ceil(this.config.otp.expiresMs / 1000),
      resendAfterSeconds: Math.ceil(this.config.otp.resendCooldownMs / 1000)
    };
  }

  async verify(input, meta) {
    const body = input || {};
    const destination = normalizeIdentifier(body.identifier);
    const code = String(body.code || '').trim();
    const challengeId = String(body.challengeId || '');
    if (!destination || !/^[a-f0-9]{48}$/.test(challengeId) || !/^\d{6}$/.test(code)) {
      throw httpError(400, 'invalid_code', 'Enter the six-digit verification code.');
    }

    const destinationHash = this.digest('destination:' + destination);
    const challenge = this.db.prepare(
      'SELECT * FROM auth_otp_challenges WHERE id = ? AND destination_hash = ?'
    ).get(challengeId, destinationHash);
    const now = Date.now();
    if (!challenge || challenge.consumed_at !== null || challenge.expires_at <= now) {
      throw httpError(410, 'otp_expired', 'This verification code has expired. Request a new code.');
    }
    if (challenge.attempts >= this.config.otp.maxAttempts) {
      throw httpError(429, 'otp_attempts_exceeded', 'Too many incorrect codes. Request a new code.');
    }

    const actual = Buffer.from(this.digest('otp:' + challengeId + ':' + code), 'hex');
    const expected = Buffer.from(challenge.code_hash, 'hex');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      const attempts = challenge.attempts + 1;
      this.db.prepare('UPDATE auth_otp_challenges SET attempts = ? WHERE id = ?').run(attempts, challengeId);
      if (attempts >= this.config.otp.maxAttempts) {
        throw httpError(429, 'otp_attempts_exceeded', 'Too many incorrect codes. Request a new code.');
      }
      throw httpError(400, 'invalid_code', 'That verification code is incorrect.');
    }

    this.db.prepare('UPDATE auth_otp_challenges SET consumed_at = ? WHERE id = ?').run(now, challengeId);
    const provider = challenge.channel === 'email' ? 'otp-email' : 'otp-sms';
    const subject = destination;
    let user = this.users.findByIdentity(provider, subject);
    if (!user) {
      user = challenge.channel === 'email'
        ? this.users.findByEmail(destination)
        : this.users.findByPhone(destination);
    }

    const timestamp = new Date(now).toISOString();
    if (!user) {
      throw httpError(403, 'account_not_found', 'No clinic account matches this address or phone number. Ask an administrator to create your account.');
    }

    this.users.linkIdentity(provider, subject, user.id, {
      email: challenge.channel === 'email' ? destination : user.email,
      phone: challenge.channel === 'sms' ? destination : user.phone,
      timestamp: timestamp
    });
    this.audit.record({
      at: timestamp,
      userId: user.id,
      action: 'auth.otp.verified',
      entity: 'user',
      entityId: user.id
    });
    user = this.users.findById(user.id);
    if (user.active !== 1) {
      throw httpError(403, 'account_pending', 'Your account is awaiting clinic administrator approval.');
    }

    const login = await this.auth.createSession(user, meta || {});
    return login;
  }

  enforceRateLimit(bucketHash, limit, now, checkCooldown) {
    const row = this.db.prepare(
      'SELECT attempts, window_started_at, last_sent_at FROM auth_otp_rate_limits WHERE bucket_hash = ?'
    ).get(bucketHash);
    if (!row) return;
    const cooldown = this.config.otp.resendCooldownMs;
    if (checkCooldown && cooldown > 0 && now - row.last_sent_at < cooldown) {
      throw rateLimited(Math.ceil((cooldown - (now - row.last_sent_at)) / 1000));
    }
    if (now - row.window_started_at < this.config.otp.rateWindowMs && row.attempts >= limit) {
      throw rateLimited(Math.ceil((this.config.otp.rateWindowMs - (now - row.window_started_at)) / 1000));
    }
  }

  recordRateLimit(bucketHash, now) {
    const row = this.db.prepare(
      'SELECT attempts, window_started_at FROM auth_otp_rate_limits WHERE bucket_hash = ?'
    ).get(bucketHash);
    const windowStartedAt = row && now - row.window_started_at < this.config.otp.rateWindowMs
      ? row.window_started_at
      : now;
    const attempts = row && windowStartedAt === row.window_started_at ? row.attempts + 1 : 1;
    this.db.prepare(
      'INSERT INTO auth_otp_rate_limits (bucket_hash, attempts, window_started_at, last_sent_at) ' +
      'VALUES (?, ?, ?, ?) ON CONFLICT(bucket_hash) DO UPDATE SET attempts = excluded.attempts, ' +
      'window_started_at = excluded.window_started_at, last_sent_at = excluded.last_sent_at'
    ).run(bucketHash, attempts, windowStartedAt, now);
  }

  async sendEmail(config, delivery) {
    const nodemailer = require('nodemailer');
    const transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: { user: config.smtp.user, pass: config.smtp.password }
    });
    await transport.sendMail({
      from: config.smtp.from,
      to: delivery.to,
      subject: 'Your Braganza Dental Clinic verification code',
      text: 'Your verification code is ' + delivery.code + '. It expires in ' +
        delivery.expiresInMinutes + ' minute(s).'
    });
  }

  async sendSms(config, delivery) {
    const twilio = config.twilio;
    const body = new URLSearchParams({
      To: delivery.to,
      From: twilio.fromNumber,
      Body: 'Your Braganza Dental Clinic verification code is ' + delivery.code +
        '. It expires in ' + delivery.expiresInMinutes + ' minute(s).'
    });
    const response = await fetch(
      'https://api.twilio.com/2010-04-01/Accounts/' + encodeURIComponent(twilio.accountSid) + '/Messages.json',
      {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(twilio.accountSid + ':' + twilio.authToken).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body
      }
    );
    if (!response.ok) throw new Error('SMS provider rejected the delivery request.');
  }
}

function normalizeIdentifier(value) {
  const input = String(value || '').trim();
  const email = input.toLowerCase();
  if (/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:gmail\.com|googlemail\.com)$/i.test(email)) {
    return email.replace(/@googlemail\.com$/, '@gmail.com');
  }
  const phone = input.replace(/[()\s.-]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(phone)) return phone;
  return '';
}

function rateLimited(retryAfter) {
  const error = httpError(429, 'otp_rate_limited', 'Please wait before requesting another verification code.');
  error.extra = { retryAfter: Math.max(1, retryAfter) };
  return error;
}

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

module.exports = { OtpService: OtpService };
