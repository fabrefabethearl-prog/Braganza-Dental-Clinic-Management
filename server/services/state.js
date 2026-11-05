'use strict';

const { NAMES } = require('../repositories/collections');
const { collectionsForRole, canWriteCollection, isAdmin } = require('./permissions');

const DEFAULT_SETTINGS = {
  clinicName: 'Braganza Dental Clinic',
  tagline: 'DENTAL CLINIC',
  address: '',
  phone: '',
  email: '',
  currency: '₱',
  taxRate: 0,
  openTime: '08:00',
  closeTime: '18:00',
  slotMinutes: 30,
  workDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  notifyAppointments: true,
  notifyLowStock: true,
  notifyPayments: true,
  autoConfirm: false,
  currentUser: 'DR-01'
};

const DEFAULT_COUNTERS = { ap: 1000, tr: 2000, inv: 5000, rx: 3000, pt: 0, staff: 1 };

const DEFAULT_DOCTOR = {
  id: 'DR-01',
  name: 'Demo acc',
  role: 'Administrator',
  specialty: 'General Dentistry',
  license: '',
  email: 'Demo@braganzadental.ph',
  phone: '',
  active: true
};

async function countRows(db, table) {
  const allowedTables = ['settings', 'counters', 'doctors'];
  if (allowedTables.indexOf(table) === -1) throw new Error('Unknown database table.');
  return db.prepare('SELECT COUNT(*) AS count FROM "' + table + '"').get().count;
}

class StateService {
  constructor(context) {
    this.db = context.db;
    this.records = context.records;
    this.settings = context.settings;
    this.counters = context.counters;
    this.audit = context.audit;
  }

  async read(role) {
    const state = {};
    const accessible = collectionsForRole(role);
    for (let i = 0; i < NAMES.length; i += 1) {
      state[NAMES[i]] = accessible.indexOf(NAMES[i]) === -1
        ? []
        : await this.records.list(NAMES[i]);
    }
    state.settings = Object.assign({}, DEFAULT_SETTINGS, await this.settings.all());
    state.counters = Object.assign({}, DEFAULT_COUNTERS, await this.counters.all());
    return state;
  }

  validate(state) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      throw invalid('A state object is required');
    }
    if (!Array.isArray(state.patients)) throw invalid('state.patients must be an array');
    if (!state.settings || typeof state.settings !== 'object' || Array.isArray(state.settings)) {
      throw invalid('state.settings must be an object');
    }
    NAMES.forEach(function (name) {
      if (state[name] !== undefined && !Array.isArray(state[name])) {
        throw invalid('state.' + name + ' must be an array');
      }
      const list = Array.isArray(state[name]) ? state[name] : [];
      const seen = Object.create(null);
      list.forEach(function (record, index) {
        if (!record || typeof record !== 'object' || Array.isArray(record)) {
          throw invalid('state.' + name + '[' + index + '] must be an object');
        }
        if (!record.id || typeof record.id !== 'string') {
          throw invalid('state.' + name + '[' + index + '] is missing a string id');
        }
        if (seen[record.id]) throw invalid('Duplicate id in state.' + name + ': ' + record.id);
        seen[record.id] = true;
      });
    });
  }

  async replace(state, userId, role) {
    this.validate(state);
    const now = new Date().toISOString();
    const self = this;
    const administrator = isAdmin(role);
    this.db.write(function () {
      for (let i = 0; i < NAMES.length; i += 1) {
        const name = NAMES[i];
        if (administrator || canWriteCollection(role, name)) {
          if (Array.isArray(state[name])) self.records.replaceAll(name, state[name], now);
        }
      }
      if (administrator) {
        self.settings.replaceAll(Object.assign({}, DEFAULT_SETTINGS, state.settings || {}), now);
        self.counters.replaceAll(Object.assign({}, DEFAULT_COUNTERS, state.counters || {}), now);
      }
      self.audit.record({
        at: now,
        userId: userId || null,
        action: 'state.replace',
        entity: 'state',
        detail: countsOf(state)
      });
    });
    return this.read(role);
  }

  async ensureSeed() {
    const self = this;
    const now = new Date().toISOString();
    const hasSettings = (await countRows(this.db, 'settings')) > 0;
    const hasCounters = (await countRows(this.db, 'counters')) > 0;
    const hasDoctors = (await this.records.count('doctors')) > 0;
    if (hasSettings && hasCounters && hasDoctors) return false;
    this.db.write(function () {
      if (!hasSettings) {
        const keys = Object.keys(DEFAULT_SETTINGS);
        for (let i = 0; i < keys.length; i += 1) {
          self.settings.set(keys[i], DEFAULT_SETTINGS[keys[i]], now);
        }
      }
      if (!hasCounters) {
        const keys = Object.keys(DEFAULT_COUNTERS);
        for (let i = 0; i < keys.length; i += 1) {
          self.counters.set(keys[i], DEFAULT_COUNTERS[keys[i]], now);
        }
      }
      if (!hasDoctors) {
        self.records.upsert('doctors', Object.assign({}, DEFAULT_DOCTOR), 0, now);
      }
      self.audit.record({ at: now, action: 'state.seed', entity: 'state' });
    });
    return true;
  }
}

function countsOf(state) {
  const detail = {};
  NAMES.forEach(function (name) {
    detail[name] = Array.isArray(state[name]) ? state[name].length : 0;
  });
  return detail;
}

function invalid(message) {
  const error = new Error(message);
  error.status = 422;
  error.code = 'invalid_state';
  return error;
}

module.exports = {
  StateService: StateService,
  DEFAULT_SETTINGS: DEFAULT_SETTINGS,
  DEFAULT_COUNTERS: DEFAULT_COUNTERS,
  DEFAULT_DOCTOR: DEFAULT_DOCTOR
};
