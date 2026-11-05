'use strict';

const { definition } = require('./collections');

function scalar(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value;
  return null;
}

function columnValue(column, value) {
  if (value === '' && ['patient_id', 'doctor_id', 'treatment_id'].indexOf(column) !== -1) return null;
  return scalar(value);
}

function decode(row) {
  try {
    const record = JSON.parse(row.document);
    record.id = row.id;
    return record;
  } catch (cause) {
    const error = new Error('A stored record could not be decoded.');
    error.status = 500;
    error.code = 'database_error';
    error.cause = cause;
    throw error;
  }
}

function dbError(cause) {
  const error = new Error('The database operation could not be completed.');
  error.status = 500;
  error.code = 'database_error';
  error.cause = cause;
  return error;
}

function notFound(name) {
  const error = new Error('Unknown collection: ' + name);
  error.status = 404;
  error.code = 'unknown_collection';
  return error;
}

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = 'invalid_record';
  return error;
}

class RecordRepository {
  constructor(db) {
    this.db = db;
  }

  list(name, options) {
    const def = definition(name);
    if (!def) throw notFound(name);
    const opts = options || {};
    const filters = opts.filters || {};
    const clauses = [];
    const values = [];
    Object.keys(filters).forEach(function (column) {
      if (!Object.prototype.hasOwnProperty.call(def.columns, column)) return;
      clauses.push('"' + column + '" = ?');
      values.push(scalar(filters[column]));
    });
    const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
    let sql = 'SELECT id, document FROM "' + def.table + '"' + where +
      ' ORDER BY ordinal ASC, id ASC';
    if (opts.limit) {
      sql += ' LIMIT ? OFFSET ?';
      values.push(opts.limit, opts.offset || 0);
    }
    try {
      return this.db.prepare(sql).all(...values).map(decode);
    } catch (cause) {
      throw dbError(cause);
    }
  }

  count(name) {
    const def = definition(name);
    if (!def) throw notFound(name);
    try {
      return this.db.prepare('SELECT COUNT(*) AS count FROM "' + def.table + '"').get().count;
    } catch (cause) {
      throw dbError(cause);
    }
  }

  find(name, id) {
    const def = definition(name);
    if (!def) throw notFound(name);
    try {
      const row = this.db.prepare('SELECT id, document FROM "' + def.table + '" WHERE id = ?').get(id);
      return row ? decode(row) : null;
    } catch (cause) {
      throw dbError(cause);
    }
  }

  nextOrdinal(name) {
    const def = definition(name);
    if (!def) throw notFound(name);
    const row = this.db.prepare('SELECT MAX(ordinal) AS ordinal FROM "' + def.table + '"').get();
    return (Number(row.ordinal) || 0) + 1;
  }

  upsert(name, record, ordinal, timestamp) {
    const def = definition(name);
    if (!def) throw notFound(name);
    if (!record || typeof record !== 'object' || !record.id) throw invalid('A record id is required');
    const now = timestamp || new Date().toISOString();
    const existing = this.db.prepare('SELECT created_at FROM "' + def.table + '" WHERE id = ?').get(record.id);
    const columns = ['id', 'ordinal', 'document', 'created_at', 'updated_at'];
    const values = [
      record.id,
      Number.isFinite(ordinal) ? ordinal : (existing ? undefined : this.nextOrdinal(name)),
      JSON.stringify(record),
      existing ? existing.created_at : now,
      now
    ];
    Object.keys(def.columns).forEach(function (column) {
      columns.push(column);
      values.push(columnValue(column, record[def.columns[column]]));
    });
    if (values[1] === undefined) {
      values[1] = this.db.prepare('SELECT ordinal FROM "' + def.table + '" WHERE id = ?').get(record.id).ordinal;
    }
    const placeholders = columns.map(function () { return '?'; }).join(', ');
    const updates = columns.slice(1).map(function (column) {
      return '"' + column + '" = excluded."' + column + '"';
    }).join(', ');
    try {
      this.db.prepare(
        'INSERT INTO "' + def.table + '" (' + columns.map(function (column) {
          return '"' + column + '"';
        }).join(', ') + ') VALUES (' + placeholders + ') ' +
        'ON CONFLICT(id) DO UPDATE SET ' + updates
      ).run(values);
      return record;
    } catch (cause) {
      throw dbError(cause);
    }
  }

  remove(name, id) {
    const def = definition(name);
    if (!def) throw notFound(name);
    return this.db.prepare('DELETE FROM "' + def.table + '" WHERE id = ?').run(id).changes > 0;
  }

  ids(name) {
    const def = definition(name);
    if (!def) throw notFound(name);
    return this.db.prepare('SELECT id FROM "' + def.table + '"').all().map(function (row) {
      return row.id;
    });
  }

  replaceAll(name, records, timestamp) {
    const list = Array.isArray(records) ? records : [];
    const keep = new Set();
    for (let index = 0; index < list.length; index += 1) {
      const record = list[index];
      if (!record || typeof record !== 'object' || !record.id) continue;
      keep.add(record.id);
      this.upsert(name, record, index, timestamp);
    }
    this.ids(name).forEach((id) => {
      if (!keep.has(id)) this.remove(name, id);
    });
    return list.length;
  }
}

module.exports = RecordRepository;
