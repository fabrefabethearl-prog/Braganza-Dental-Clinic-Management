'use strict';

let firebaseAuth = null;
let firebaseProjectId = null;

function verifyIdToken(token, config) {
  if (!config || !config.firebase || !config.firebase.serviceAccountJson) {
    throw httpError(503, 'authentication_unavailable', 'Phone and Google sign-in are not configured.');
  }
  if (firebaseAuth && firebaseProjectId === config.firebase.projectId) {
    return firebaseAuth.verifyIdToken(token, true);
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(config.firebase.serviceAccountJson);
  } catch (error) {
    throw configurationError(error);
  }
  if (!serviceAccount.project_id || serviceAccount.project_id !== config.firebase.projectId) {
    throw httpError(503, 'authentication_unavailable', 'Firebase server credentials do not match the configured project.');
  }

  try {
    const appSdk = require('firebase-admin/app');
    const authSdk = require('firebase-admin/auth');
    const appName = 'braganza-clinic-firebase-auth';
    const app = appSdk.getApps().find(function (candidate) { return candidate.name === appName; }) ||
      appSdk.initializeApp({
        credential: appSdk.cert(serviceAccount),
        projectId: config.firebase.projectId
      }, appName);
    firebaseAuth = authSdk.getAuth(app);
    firebaseProjectId = config.firebase.projectId;
  } catch (error) {
    throw configurationError(error);
  }

  return firebaseAuth.verifyIdToken(token, true);
}

function configurationError(cause) {
  const error = httpError(503, 'authentication_unavailable', 'Firebase server credentials are invalid or unavailable.');
  error.cause = cause;
  return error;
}

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

module.exports = { verifyIdToken: verifyIdToken };
