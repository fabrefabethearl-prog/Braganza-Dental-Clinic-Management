'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm'
};

function createStaticHandler(rootDir) {
  const root = path.resolve(rootDir);

  return async function serve(req, res, pathname) {
    let relative = decodeURIComponent(pathname);
    if (relative === '/' || relative === '') relative = '/index.html';
    const target = path.resolve(path.join(root, relative));
    if (target !== root && !target.startsWith(root + path.sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return true;
    }

    let stat;
    try {
      stat = await fsp.stat(target);
    } catch (error) {
      void error;
      return false;
    }
    if (stat.isDirectory()) return false;

    const ext = path.extname(target).toLowerCase();
    const etag = '"' + crypto.createHash('sha1').update(stat.mtimeMs + ':' + stat.size).digest('hex') + '"';
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      ETag: etag,
      'Last-Modified': stat.mtime.toUTCString(),
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    };

    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': headers['Cache-Control'] });
      res.end();
      return true;
    }

    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      res.end();
      return true;
    }

    res.writeHead(200, headers);
    fs.createReadStream(target).pipe(res);
    return true;
  };
}

module.exports = { createStaticHandler: createStaticHandler, MIME: MIME };
