'use strict';

function parseValue(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return value;
  }
}

class SettingsRepository {
  constructor(db) {
    this.db = db;
  }

  all() {
    const out = {};
    this.db.prepare('SELECT "key", value FROM settings').all().forEach(function (row) {
      out[row.key] = parseValue(row.value);
    });
    return out;
  }

  get(key) {
    const row = this.db.prepare('SELECT value FROM settings WHERE "key" = ?').get(key);
    return row ? parseValue(row.value) : undefined;
  }

  set(key, value, timestamp) {
    this.db.prepare(
      'INSERT INTO settings ("key", value, updated_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT("key") DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    ).run(key, JSON.stringify(value === undefined ? null : value), timestamp || new Date().toISOString());
  }

  replaceAll(map, timestamp) {
    const source = map && typeof map === 'object' ? map : {};
    const keep = new Set(Object.keys(source));
    Object.keys(source).forEach((key) => this.set(key, source[key], timestamp));
    this.db.prepare('SELECT "key" FROM settings').all().forEach((row) => {
      if (!keep.has(row.key)) this.db.prepare('DELETE FROM settings WHERE "key" = ?').run(row.key);
    });
  }
}

class CountersRepository {
  constructor(db) {
    this.db = db;
  }

  all() {
    const out = {};
    this.db.prepare('SELECT "key", value FROM counters').all().forEach(function (row) {
      out[row.key] = Number(row.value) || 0;
    });
    return out;
  }

  set(key, value, timestamp) {
    const numeric = Number(value);
    this.db.prepare(
      'INSERT INTO counters ("key", value, updated_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT("key") DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    ).run(key, Number.isFinite(numeric) ? Math.trunc(numeric) : 0, timestamp || new Date().toISOString());
  }

  replaceAll(map, timestamp) {
    const source = map && typeof map === 'object' ? map : {};
    const keep = new Set(Object.keys(source));
    Object.keys(source).forEach((key) => this.set(key, source[key], timestamp));
    this.db.prepare('SELECT "key" FROM counters').all().forEach((row) => {
      if (!keep.has(row.key)) this.db.prepare('DELETE FROM counters WHERE "key" = ?').run(row.key);
    });
  }
}

module.exports = { SettingsRepository: SettingsRepository, CountersRepository: CountersRepository };
