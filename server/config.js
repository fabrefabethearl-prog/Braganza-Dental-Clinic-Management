'use strict';

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  text.split(/\r?\n/).forEach(function (line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.charAt(0) === '#') return;
    const eq = trimmed.indexOf('=');
    if (eq < 1) return;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.length > 1 && (value[0] === '"' || value[0] === "'") && value[value.length - 1] === value[0]) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  });
}

loadEnvFile(path.join(ROOT, '.env'));

function int(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function bool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

const dataDir = process.env.DATA_DIR ? path.resolve(ROOT, process.env.DATA_DIR) : path.join(ROOT, 'data');
const databasePath = process.env.SQLITE_PATH
  ? path.resolve(ROOT, process.env.SQLITE_PATH)
  : path.join(dataDir, 'braganza.sqlite');

module.exports = {
  root: ROOT,
  env: process.env.NODE_ENV || 'production',
  host: process.env.HOST || '127.0.0.1',
  port: int(process.env.PORT, 4400),
  publicDir: path.join(ROOT, 'public'),
  dataDir: dataDir,
  databasePath: databasePath,
  backupDir: path.join(dataDir, 'backups'),

  firebase: {
    apiKey: process.env.FIREBASE_API_KEY || '',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    appId: process.env.FIREBASE_APP_ID || '',
    serviceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || ''
  },
  otp: {
    secret: process.env.OTP_SECRET || '',
    expiresMs: int(process.env.OTP_EXPIRY_MINUTES, 5) * 60 * 1000,
    maxAttempts: int(process.env.OTP_MAX_ATTEMPTS, 5),
    resendCooldownMs: int(process.env.OTP_RESEND_COOLDOWN_SECONDS, 60) * 1000,
    destinationLimit: int(process.env.OTP_DESTINATION_LIMIT, 5),
    ipLimit: int(process.env.OTP_IP_LIMIT, 10),
    rateWindowMs: int(process.env.OTP_RATE_WINDOW_MINUTES, 60) * 60 * 1000,
    smtp: {
      host: process.env.SMTP_HOST || '',
      port: int(process.env.SMTP_PORT, 587),
      secure: bool(process.env.SMTP_SECURE, false),
      user: process.env.SMTP_USER || '',
      password: process.env.SMTP_PASSWORD || '',
      from: process.env.SMTP_FROM || ''
    },
    twilio: {
      accountSid: process.env.TWILIO_ACCOUNT_SID || '',
      authToken: process.env.TWILIO_AUTH_TOKEN || '',
      fromNumber: process.env.TWILIO_FROM_NUMBER || ''
    }
  },

  session: {
    cookieName: process.env.SESSION_COOKIE || 'bdc_session',
    ttlMs: int(process.env.SESSION_TTL_HOURS, 12) * 60 * 60 * 1000,
    secure: bool(process.env.SESSION_SECURE, false)
  },
  security: {
    maxBodyBytes: int(process.env.MAX_BODY_BYTES, 8 * 1024 * 1024),
    loginMaxAttempts: int(process.env.LOGIN_MAX_ATTEMPTS, 8),
    loginWindowMs: int(process.env.LOGIN_WINDOW_MINUTES, 10) * 60 * 1000,
    trustedOrigins: (process.env.TRUSTED_ORIGINS || '')
      .split(',')
      .map(function (s) { return s.trim(); })
      .filter(Boolean)
  },
  bootstrapAdmin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || '',
    email: process.env.ADMIN_EMAIL || 'Demo@braganzadental.ph',
    name: process.env.ADMIN_NAME || 'Demo acc',
    doctorId: process.env.ADMIN_DOCTOR_ID || 'DR-01'
  }
};
