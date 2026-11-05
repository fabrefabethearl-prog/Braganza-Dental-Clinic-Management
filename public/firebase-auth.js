'use strict';

const FIREBASE_VERSION = '11.10.0';
const FIREBASE_CDN = 'https://www.gstatic.com/firebasejs/' + FIREBASE_VERSION;

let auth = null;
let enabled = false;
let busy = false;

window.updateFirebaseAuthUi = function () {
  const control = document.getElementById('google-auth-control');
  if (control) control.hidden = !enabled;
};

document.addEventListener('click', function (event) {
  const button = event.target.closest('[data-auth-action="google"]');
  if (!button || !auth || busy) return;
  event.preventDefault();
  signInWithGoogle();
});

initializeFirebase();

async function initializeFirebase() {
  try {
    const response = await fetch('/api/auth/config', { credentials: 'same-origin' });
    const result = await response.json();
    if (!response.ok || !result.firebaseEnabled || !result.firebase) {
      window.updateFirebaseAuthUi();
      return;
    }

    const appSdk = await import(FIREBASE_CDN + '/firebase-app.js');
    const authSdk = await import(FIREBASE_CDN + '/firebase-auth.js');
    const app = appSdk.initializeApp(result.firebase);
    auth = authSdk.getAuth(app);
    auth.languageCode = navigator.language || 'en';
    window.firebaseAuthSdk = authSdk;
    enabled = true;
    window.updateFirebaseAuthUi();
  } catch (error) {
    window.updateFirebaseAuthUi();
  }
}

async function signInWithGoogle() {
  busy = true;
  const button = document.querySelector('[data-auth-action="google"]');
  if (button) {
    button.disabled = true;
    button.dataset.originalLabel = button.textContent;
    button.textContent = 'Connecting to Google...';
  }
  try {
    const provider = new window.firebaseAuthSdk.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const result = await window.firebaseAuthSdk.signInWithPopup(auth, provider);
    const idToken = await result.user.getIdToken();
    const response = await fetch('/api/auth/firebase', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: idToken })
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error && body.error.message
        ? body.error.message
        : 'Google sign-in could not be completed.');
    }
    await window.firebaseAuthSdk.signOut(auth);
    await window.completeClinicSignIn(body.user);
  } catch (error) {
    if (auth && auth.currentUser) {
      try {
        await window.firebaseAuthSdk.signOut(auth);
      } catch (signOutError) {
        void signOutError;
      }
    }
    showMessage(messageFor(error));
  } finally {
    busy = false;
    if (button) {
      button.disabled = false;
      button.textContent = button.dataset.originalLabel || 'Continue with Google';
      delete button.dataset.originalLabel;
    }
  }
}

function messageFor(error) {
  const messages = {
    'auth/popup-closed-by-user': 'Google sign-in was cancelled.',
    'auth/popup-blocked': 'Your browser blocked the Google sign-in window. Allow pop-ups and try again.',
    'auth/account-exists-with-different-credential': 'This email already uses another sign-in method.',
    'auth/network-request-failed': 'Network error. Check your connection and try again.'
  };
  return messages[error && error.code] ||
    (error && error.message) || 'Google sign-in could not be completed.';
}

function showMessage(message) {
  const element = document.getElementById('firebase-auth-message');
  if (!element) return;
  element.textContent = message;
  element.classList.add('error');
}
