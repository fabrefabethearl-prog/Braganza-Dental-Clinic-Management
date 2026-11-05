'use strict';

const { sendJson } = require('../http/helpers');
const { NAMES, definition } = require('../repositories/collections');

const ID_SCHEMES = {
  appointments: { prefix: 'AP-', counter: 'ap' },
  treatments: { prefix: 'TR-', counter: 'tr' },
  invoices: { prefix: 'INV-', counter: 'inv' },
  prescriptions: { prefix: 'RX-', counter: 'rx' }
};

function generateId(app, collection) {
  const scheme = ID_SCHEMES[collection];
  if (scheme) {
    const counters = app.counters.all();
    const next = (Number(counters[scheme.counter]) || 0) + 1;
    app.counters.set(scheme.counter, next);
    return scheme.prefix + next;
  }
  if (collection === 'patients') {
    const counters = app.counters.all();
    const next = (Number(counters.pt) || 0) + 1;
    app.counters.set('pt', next);
    return 'PT-' + new Date().getFullYear() + '-' + String(next).padStart(4, '0');
  }
  if (collection === 'doctors') {
    const counters = app.counters.all();
    const next = (Number(counters.staff) || 0) + 1;
    app.counters.set('staff', next);
    return 'ST-' + String(next).padStart(2, '0');
  }
  const prefixes = { inventory: 'IT-', procedures: 'PR-', threads: 'MS-', notifications: 'NT-' };
  return (prefixes[collection] || 'ID-') + Date.now();
}

function register(router, app) {
  NAMES.forEach(function (collection) {
    const base = '/api/' + collection;

    router.get(base, async function (ctx) {
      const def = definition(collection);
      const filters = {};
      Object.keys(def.columns).forEach(function (column) {
        const alias = def.columns[column];
        if (ctx.query[alias] !== undefined) filters[column] = ctx.query[alias];
        else if (ctx.query[column] !== undefined) filters[column] = ctx.query[column];
      });
      const limit = clampInt(ctx.query.limit, 0);
      const offset = clampInt(ctx.query.offset, 0);
      const items = await app.records.list(collection, { filters: filters, limit: limit, offset: offset });
      sendJson(ctx.res, 200, { items: items, total: await app.records.count(collection) });
    }, { resource: collection });

    router.get(base + '/:id', async function (ctx) {
      const record = await app.records.find(collection, ctx.params.id);
      if (!record) throw missing(collection, ctx.params.id);
      sendJson(ctx.res, 200, { item: record });
    }, { resource: collection });

    router.post(base, async function (ctx) {
      const payload = ctx.body && ctx.body.item ? ctx.body.item : ctx.body;
      assertObject(payload);
      let created = null;
      app.db.write(function () {
        const id = payload.id || generateId(app, collection);
        if (app.records.find(collection, id)) throw conflict(collection, id);
        const record = Object.assign({}, payload, { id: id });
        app.records.upsert(collection, record, app.records.nextOrdinal(collection));
        app.audit.record({ userId: ctx.user.id, action: 'record.create', entity: collection, entityId: id });
        created = record;
      });
      sendJson(ctx.res, 201, { item: created });
    }, { resource: collection });

    router.put(base + '/:id', async function (ctx) {
      const payload = ctx.body && ctx.body.item ? ctx.body.item : ctx.body;
      assertObject(payload);
      const existing = await app.records.find(collection, ctx.params.id);
      if (!existing) throw missing(collection, ctx.params.id);
      const record = Object.assign({}, payload, { id: ctx.params.id });
      app.db.write(function () {
        app.records.upsert(collection, record);
        app.audit.record({ userId: ctx.user.id, action: 'record.replace', entity: collection, entityId: ctx.params.id });
      });
      sendJson(ctx.res, 200, { item: record });
    }, { resource: collection });

    router.patch(base + '/:id', async function (ctx) {
      const payload = ctx.body && ctx.body.item ? ctx.body.item : ctx.body;
      assertObject(payload);  
      const existing = await app.records.find(collection, ctx.params.id);
      if (!existing) throw missing(collection, ctx.params.id);
      const record = Object.assign({}, existing, payload, { id: ctx.params.id });
      app.db.write(function () {
        app.records.upsert(collection, record);
        app.audit.record({ userId: ctx.user.id, action: 'record.update', entity: collection, entityId: ctx.params.id });
      });
      sendJson(ctx.res, 200, { item: record });
    }, { resource: collection });

    router.delete(base + '/:id', async function (ctx) {
      const existing = await app.records.find(collection, ctx.params.id);
      if (!existing) throw missing(collection, ctx.params.id);
      app.db.write(function () {
        app.records.remove(collection, ctx.params.id);
        app.audit.record({ userId: ctx.user.id, action: 'record.delete', entity: collection, entityId: ctx.params.id });
      });
      sendJson(ctx.res, 200, { ok: true, id: ctx.params.id });
    }, { resource: collection });
  });

  router.get('/api/settings', async function (ctx) {
    sendJson(ctx.res, 200, { settings: (await app.state.read(ctx.user.role)).settings });
  }, { adminOnly: true });

  router.patch('/api/settings', async function (ctx) {
    const payload = ctx.body && ctx.body.settings ? ctx.body.settings : ctx.body;
    assertObject(payload);
    app.db.write(function () {
      const keys = Object.keys(payload);
      for (let i = 0; i < keys.length; i += 1) {
        app.settings.set(keys[i], payload[keys[i]]);
      }
      app.audit.record({ userId: ctx.user.id, action: 'settings.update', entity: 'settings' });
    });
    sendJson(ctx.res, 200, { settings: (await app.state.read(ctx.user.role)).settings });
  }, { adminOnly: true });

  router.get('/api/counters', async function (ctx) {
    sendJson(ctx.res, 200, { counters: (await app.state.read(ctx.user.role)).counters });
  }, { adminOnly: true });

  router.patch('/api/counters', async function (ctx) {
    const payload = ctx.body && ctx.body.counters ? ctx.body.counters : ctx.body;
    assertObject(payload);
    app.db.write(function () {
      const keys = Object.keys(payload);
      for (let i = 0; i < keys.length; i += 1) {
        app.counters.set(keys[i], payload[keys[i]]);
      }
      app.audit.record({ userId: ctx.user.id, action: 'counters.update', entity: 'counters' });
    });
    sendJson(ctx.res, 200, { counters: (await app.state.read(ctx.user.role)).counters });
  }, { adminOnly: true });
}

function clampInt(value, fallback) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, 5000);
}

function assertObject(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    const error = new Error('A JSON object is required.');
    error.status = 422;
    error.code = 'invalid_payload';
    throw error;
  }
}

function missing(collection, id) {
  const error = new Error('No ' + collection + ' record with id ' + id + '.');
  error.status = 404;
  error.code = 'not_found';
  return error;
}

function conflict(collection, id) {
  const error = new Error('A ' + collection + ' record with id ' + id + ' already exists.');
  error.status = 409;
  error.code = 'conflict';
  return error;
}

module.exports = { register: register };
