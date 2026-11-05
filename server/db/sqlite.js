'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

class SQLiteDatabase {
  constructor(database) {
    this.database = database;
  }

  static async open(filename) {
    const databasePath = filename || ':memory:';
    if (databasePath !== ':memory:' && databasePath !== '') {
      fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
    }
    const database = new Database(databasePath);
    database.pragma('foreign_keys = ON');
    database.pragma('busy_timeout = 5000');
    if (databasePath !== ':memory:') database.pragma('journal_mode = WAL');
    return new SQLiteDatabase(database);
  }

  prepare(sql) {
    return this.database.prepare(sql);
  }

  exec(sql) {
    return this.database.exec(sql);
  }

  write(callback) {
    return this.database.transaction(callback)();
  }

  async close() {
    if (this.database.open) this.database.close();
  }
}

module.exports = SQLiteDatabase;
