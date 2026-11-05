'use strict';

const { NAMES } = require('../repositories/collections');

const ADMIN_ROLE = 'Administrator';
const ACCOUNT_ROLES = [
  ADMIN_ROLE,
  'Dentist',
  'Dental Hygienist',
  'Dental Assistant',
  'Receptionist'
];

const ROLE_COLLECTIONS = {
  Dentist: [
    'patients', 'doctors', 'appointments', 'treatments', 'invoices',
    'prescriptions', 'procedures', 'threads', 'notifications'
  ],
  'Dental Hygienist': [
    'patients', 'doctors', 'appointments', 'treatments',
    'prescriptions', 'procedures', 'threads', 'notifications'
  ],
  'Dental Assistant': [
    'patients', 'doctors', 'appointments', 'treatments',
    'prescriptions', 'procedures', 'threads', 'notifications'
  ],
  Receptionist: [
    'patients', 'doctors', 'appointments', 'invoices',
    'procedures', 'threads', 'notifications'
  ],
  Staff: ['patients', 'doctors', 'appointments', 'notifications']
};

const ROLE_WRITABLE_COLLECTIONS = {
  Dentist: [
    'patients', 'appointments', 'treatments', 'invoices',
    'prescriptions', 'threads', 'notifications'
  ],
  'Dental Hygienist': [
    'patients', 'appointments', 'treatments', 'prescriptions',
    'threads', 'notifications'
  ],
  'Dental Assistant': [
    'patients', 'appointments', 'treatments', 'prescriptions',
    'threads', 'notifications'
  ],
  Receptionist: ['patients', 'appointments', 'invoices', 'threads', 'notifications'],
  Staff: ['patients', 'appointments', 'notifications']
};

function isAdmin(role) {
  return String(role || '').toLowerCase() === ADMIN_ROLE.toLowerCase();
}

function collectionsForRole(role) {
  if (isAdmin(role)) return NAMES.slice();
  return (ROLE_COLLECTIONS[role] || ROLE_COLLECTIONS.Staff).slice();
}

function canAccessCollection(role, collection) {
  return isAdmin(role) || collectionsForRole(role).indexOf(collection) !== -1;
}

function canWriteCollection(role, collection) {
  if (isAdmin(role)) return true;
  const writable = ROLE_WRITABLE_COLLECTIONS[role] || ROLE_WRITABLE_COLLECTIONS.Staff;
  return writable.indexOf(collection) !== -1;
}

function isAccountRole(role) {
  return ACCOUNT_ROLES.indexOf(role) !== -1;
}

module.exports = {
  ADMIN_ROLE: ADMIN_ROLE,
  ACCOUNT_ROLES: ACCOUNT_ROLES,
  ROLE_COLLECTIONS: ROLE_COLLECTIONS,
  ROLE_WRITABLE_COLLECTIONS: ROLE_WRITABLE_COLLECTIONS,
  isAdmin: isAdmin,
  collectionsForRole: collectionsForRole,
  canAccessCollection: canAccessCollection,
  canWriteCollection: canWriteCollection,
  isAccountRole: isAccountRole
};
