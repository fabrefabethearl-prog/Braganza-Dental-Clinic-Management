'use strict';

const DEFINITIONS = {
  patients: {
    table: 'patients',
    columns: {
      name: 'name',
      phone: 'phone',
      email: 'email',
      status: 'status',
      age: 'age',
      gender: 'gender',
      last_visit: 'lastVisit'
    }
  },
  doctors: {
    table: 'doctors',
    columns: {
      name: 'name',
      role: 'role',
      specialty: 'specialty',
      email: 'email',
      phone: 'phone',
      active: 'active'
    }
  },
  appointments: {
    table: 'appointments',
    columns: {
      patient_id: 'patientId',
      doctor_id: 'doctorId',
      date: 'date',
      time: 'time',
      type: 'type',
      status: 'status'
    }
  },
  treatments: {
    table: 'treatments',
    columns: {
      patient_id: 'patientId',
      doctor_id: 'doctorId',
      date: 'date',
      procedure: 'procedure',
      category: 'category',
      status: 'status',
      cost: 'cost'
    }
  },
  invoices: {
    table: 'invoices',
    columns: {
      patient_id: 'patientId',
      treatment_id: 'treatmentId',
      date: 'date',
      due_date: 'dueDate',
      discount: 'discount',
      paid: 'paid',
      method: 'method'
    }
  },
  prescriptions: {
    table: 'prescriptions',
    columns: {
      patient_id: 'patientId',
      doctor_id: 'doctorId',
      date: 'date',
      diagnosis: 'diagnosis'
    }
  },
  inventory: {
    table: 'inventory',
    columns: {
      name: 'name',
      category: 'category',
      qty: 'qty',
      unit: 'unit',
      reorder: 'reorder',
      expiry: 'expiry'
    }
  },
  procedures: {
    table: 'procedures',
    columns: {
      name: 'name',
      cat: 'cat',
      price: 'price'
    }
  },
  threads: {
    table: 'threads',
    columns: {
      name: 'name',
      role: 'role',
      unread: 'unread'
    }
  },
  notifications: {
    table: 'notifications',
    columns: {
      route: 'route',
      read: 'read'
    }
  }
};

const NAMES = Object.keys(DEFINITIONS);

function definition(name) {
  return Object.prototype.hasOwnProperty.call(DEFINITIONS, name) ? DEFINITIONS[name] : null;
}

module.exports = { DEFINITIONS: DEFINITIONS, NAMES: NAMES, definition: definition };
