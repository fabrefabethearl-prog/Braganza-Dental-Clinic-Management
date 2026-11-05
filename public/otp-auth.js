'use strict';

let challengeId = '';
let challengeIdentifier = '';
let resendTimer = null;
let busy = false;
let otpAvailability = null;
let otpSettingsError = false;

window.updateOtpAuthUi = function () {
  const controls = document.getElementById('otp-auth-controls');
  const unavailable = document.getElementById('otp-auth-unavailable');
  if (!controls || !unavailable) return;
  if (otpSettingsError) {
    controls.hidden = true;
    unavailable.hidden = false;
    return;
  }
  if (otpAvailability !== null) {
    const available = !!(otpAvailability.email || otpAvailability.sms);
    controls.hidden = !available;
    unavailable.hidden = available;
  }
};

document.addEventListener('click', function (event) {
  const button = event.target.closest('[data-otp-action]');
  if (!button || busy) return;
  event.preventDefault();
  if (button.dataset.otpAction === 'request') requestCode();
  if (button.dataset.otpAction === 'verify') verifyCode();
  if (button.dataset.otpAction === 'resend') requestCode();
});

loadOtpConfiguration();

async function loadOtpConfiguration() {
  try {
    const response = await fetch('/api/auth/config', {
      credentials: 'same-origin',
      signal: AbortSignal.timeout(10000)
    });
    const result = await response.json();
    if (!response.ok) throw new Error('Verification settings are unavailable.');
    otpAvailability = result.otp || { email: false, sms: false };
  } catch (error) {
    otpSettingsError = true;
  }
  window.updateOtpAuthUi();
}

async function requestCode() {
  const identifierField = document.getElementById('otpIdentifier');
  const identifier = normalizeIdentifier(identifierField && identifierField.value);
  if (!identifier) {
    showMessage('Enter a Gmail address or an international phone number with country code.', true);
    if (identifierField) identifierField.focus();
    return;
  }
  challengeIdentifier = identifier;
  showBusy(true, 'Sending verification code...');
  try {
    const result = await api('/api/auth/otp/request', { identifier: identifier });
    challengeId = result.challengeId;
    const otpStep = document.getElementById('otpCodeStep');
    const codeField = document.getElementById('otpCode');
    if (otpStep) otpStep.hidden = false;
    if (codeField) {
      codeField.value = '';
      codeField.focus();
    }
    showMessage('Verification code sent by ' +
      (result.channel === 'email' ? 'email' : 'SMS') + '. It expires in ' +
      Math.ceil(result.expiresInSeconds / 60) + ' minutes.', false);
    startResendCountdown(result.resendAfterSeconds);
  } catch (error) {
    if (error.code === 'account_pending') {
      showMessage(error.message, true);
    } else {
      showMessage(error.message, true);
      if (error.retryAfter) startResendCountdown(error.retryAfter);
    }
  } finally {
    showBusy(false);
  }
}

async function verifyCode() {
  const identifierField = document.getElementById('otpIdentifier');
  const nameField = document.getElementById('otpDisplayName');
  const codeField = document.getElementById('otpCode');
  const identifier = normalizeIdentifier(identifierField && identifierField.value);
  const code = String(codeField && codeField.value || '').trim();
  const name = String(nameField && nameField.value || '').trim();
  if (!challengeId || identifier !== challengeIdentifier) {
    challengeId = '';
    showMessage('Request a new code for this address or phone number.', true);
    return;
  }
  if (!/^\d{6}$/.test(code)) {
    showMessage('Enter the six-digit verification code.', true);
    if (codeField) codeField.focus();
    return;
  }

  showBusy(true, 'Verifying code...');
  try {
    const result = await api('/api/auth/otp/verify', {
      challengeId: challengeId,
      identifier: identifier,
      code: code,
      name: name
    });
    challengeId = '';
    clearInterval(resendTimer);
    showMessage('Verified. Signing you in...', false);
    await window.completeClinicSignIn(result.user);
  } catch (error) {
    if (error.code === 'account_pending') {
      challengeId = '';
      clearInterval(resendTimer);
      showMessage(error.message, true);
      return;
    }
    if (error.code === 'otp_expired' || error.code === 'otp_attempts_exceeded' ||
        error.code === 'account_not_found') {
      challengeId = '';
      const step = document.getElementById('otpCodeStep');
      if (step) step.hidden = true;
    }
    showMessage(error.message, true);
  } finally {
    showBusy(false);
  }
}

async function api(url, body) {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000)
    });
  } catch (error) {
    if (error.name === 'TimeoutError') throw new Error('The request took too long. Check your connection and try again.');
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  let result;
  try {
    result = await response.json();
  } catch (error) {
    throw new Error('The server returned an invalid response. Try again.');
  }
  if (!response.ok) {
    const apiError = result && result.error ? result.error : {};
    const failure = new Error(apiError.message || 'Verification could not be completed.');
    failure.code = apiError.code;
    failure.retryAfter = apiError.details && apiError.details.retryAfter;
    throw failure;
  }
  return result;
}

function normalizeIdentifier(value) {
  const input = String(value || '').trim();
  const email = input.toLowerCase();
  if (/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:gmail\.com|googlemail\.com)$/i.test(email)) {
    return email.replace(/@googlemail\.com$/, '@gmail.com');
  }
  const phone = input.replace(/[()\s.-]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(phone)) return phone;
  return '';
}

function startResendCountdown(seconds) {
  const button = document.getElementById('otpResend');
  if (!button) return;
  clearInterval(resendTimer);
  let remaining = Math.max(1, Math.floor(Number(seconds) || 60));
  button.disabled = true;
  button.textContent = 'Resend code in ' + remaining + 's';
  resendTimer = setInterval(function () {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(resendTimer);
      resendTimer = null;
      button.disabled = false;
      button.textContent = 'Resend code';
      return;
    }
    button.textContent = 'Resend code in ' + remaining + 's';
  }, 1000);
}

function showBusy(value, label) {
  busy = value;
  const request = document.querySelector('[data-otp-action="request"]');
  const verify = document.querySelector('[data-otp-action="verify"]');
  const resend = document.getElementById('otpResend');
  const controls = [request, verify, resend].filter(Boolean);
  controls.forEach(function (button) {
    if (value) {
      button.dataset.originalText = button.textContent;
      button.disabled = true;
      if (button === request || button === verify) button.textContent = label;
    } else {
      button.disabled = button === resend && !!resendTimer;
      if (button.dataset.originalText !== undefined) {
        button.textContent = button.dataset.originalText;
        delete button.dataset.originalText;
      }
    }
  });
}

function showMessage(message, isError) {
  const element = document.getElementById('firebase-auth-message');
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('error', !!isError);
  element.classList.toggle('success', !isError && !!message);
}
