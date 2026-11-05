'use strict';

const { createClient } = require('@supabase/supabase-js');

class Supabase {
  constructor(client) {
    this.client = client;
  }

  static async open(url, key) {
    if (!url || !key) {
      throw new Error('SUPABASE_URL and SUPABASE_KEY must be set (see .env.example).');
    }
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    return new Supabase(client);
  }

  // Thin pass-through so repositories keep calling `this.db.from(...)`,
  // the same shape they used to call `this.db.all/get/run(...)` with.
  from(table) {
    return this.client.from(table);
  }

  // Postgres/PostgREST has no client-side multi-statement transaction API like
  // sql.js's synchronous in-memory transactions did. `write` now just awaits the
  // group of Supabase calls in order; see README "Migration notes" for the
  // atomicity trade-off this implies.
  async write(fn) {
    return await fn();
  }

  async close() {
    // The Supabase client is stateless HTTP; nothing to close.
    return true;
  }
}

module.exports = Supabase;
