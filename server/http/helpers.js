'use strict';

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  String(header).split(';').forEach(function (part) {
    const index = part.indexOf('=');
    if (index < 1) return;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) return;
    try {
      out[key] = decodeURIComponent(value);
    } catch (error) {
      void error;
      out[key] = value;
    }
  });
  return out;
}

function serializeCookie(name, value, options) {
  const opts = options || {};
  const parts = [name + '=' + encodeURIComponent(value)];
  parts.push('Path=' + (opts.path || '/'));
  if (opts.maxAge !== undefined) parts.push('Max-Age=' + Math.floor(opts.maxAge));
  if (opts.expires) parts.push('Expires=' + opts.expires.toUTCString());
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  parts.push('SameSite=' + (opts.sameSite || 'Strict'));
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

function readBody(req, limit) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on('data', function (chunk) {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settled = true;
        const error = new Error('Request body is too large.');
        error.status = 413;
        error.code = 'payload_too_large';
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', function () {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', function (error) {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function parseJsonBody(buffer) {
  if (!buffer || !buffer.length) return {};
  let text = buffer.toString('utf8').trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object') {
      const error = new Error('Request body must be a JSON object.');
      error.status = 400;
      error.code = 'invalid_body';
      throw error;
    }
    return parsed;
  } catch (error) {
    if (error.status) throw error;
    const parseError = new Error('Request body is not valid JSON.');
    parseError.status = 400;
    parseError.code = 'invalid_json';
    throw parseError;
  }
}

function sendJson(res, status, payload, headers) {
  const body = Buffer.from(JSON.stringify(payload === undefined ? null : payload), 'utf8');
  const base = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  };
  res.writeHead(status, Object.assign(base, headers || {}));
  res.end(body);
}

function sendError(res, error) {
  const status = error && error.status ? error.status : 500;
  const payload = {
    error: {
      code: (error && error.code) || 'internal_error',
      message: status >= 500 ? 'The server could not complete the request.' : error.message
    }
  };
  if (error && error.extra) payload.error.details = error.extra;
  const headers = {};
  if (status === 429 && error.extra && error.extra.retryAfter) headers['Retry-After'] = String(error.extra.retryAfter);
  sendJson(res, status, payload, headers);
}

function clientIp(req) {
  const socket = req.socket;
  return (socket && (socket.remoteAddress || '')) || '';
}

module.exports = {
  parseCookies: parseCookies,
  serializeCookie: serializeCookie,
  readBody: readBody,
  parseJsonBody: parseJsonBody,
  sendJson: sendJson,
  sendError: sendError,
  clientIp: clientIp
};
