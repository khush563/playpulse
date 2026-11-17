(function accountScreen() {
  'use strict';
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  if (params.has('auth_changed')) { try { localStorage.setItem('playpulse-auth-changed', String(Date.now())); } catch (_) { /* Session cookies are authoritative. */ } }
  let mode = ['signup', 'recover', 'password'].includes(params.get('mode')) ? params.get('mode') : 'login';
  function message(text, error = false) { $('auth-message').textContent = text; $('auth-message').dataset.error = String(error); $('auth-message').hidden = !text; }
  function render() {
    const copy = { login: ['Back for matchday?', 'Sign in to join offer pools and access your wallet.', 'Sign in →'], signup: ['Your side. Your account.', 'Create an account, then confirm your email to join a matchday pool.', 'Create account →'], recover: ['Get back in the game.', 'We’ll email a link to reset your password.', 'Send reset link →'], password: ['A fresh start.', 'Choose a new password for your PlayPulse account.', 'Save new password →'] }[mode];
    $('auth-title').textContent = copy[0]; $('auth-copy').textContent = copy[1]; $('auth-submit').textContent = copy[2];
    $('name-field').hidden = mode !== 'signup'; $('auth-name').required = mode === 'signup';
    $('email-field').hidden = mode === 'password'; $('auth-email').required = mode !== 'password';
    $('password-field').hidden = mode === 'recover'; $('auth-password').required = mode !== 'recover';
    $('auth-password').minLength = ['signup', 'password'].includes(mode) ? 12 : 1;
    $('auth-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    $('password-hint').hidden = !['signup', 'password'].includes(mode);
    $('auth-forgot').hidden = mode !== 'login';
    $('tab-login').setAttribute('aria-selected', String(mode === 'login')); $('tab-signup').setAttribute('aria-selected', String(mode === 'signup'));
  }
  $('tab-login').onclick = () => { mode = 'login'; message(''); render(); };
  $('tab-signup').onclick = () => { mode = 'signup'; message(''); render(); };
  $('auth-forgot').onclick = () => { mode = 'recover'; message(''); render(); };
  $('auth-form').onsubmit = async event => {
    event.preventDefault();
    const button = $('auth-submit'); button.disabled = true; button.textContent = 'Please wait…'; message('');
    try {
      const endpoint = { login: 'login', signup: 'register', recover: 'recover', password: 'password' }[mode];
      const response = await fetch(`/api/auth/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: $('auth-email').value, password: $('auth-password').value, name: $('auth-name').value }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to continue. Try again.');
      if (mode === 'login' || mode === 'password') {
        try { localStorage.setItem('playpulse-auth-changed', String(Date.now())); } catch (_) { /* No session tokens are stored in browser storage. */ }
        location.replace(params.get('next') === 'admin' ? '/admin' : '/?view=lobby');
      }
      else { message(data.message); $('auth-password').value = ''; }
    } catch (error) { message(error.message, true); }
    finally { button.disabled = false; render(); }
  };
  fetch('/api/auth/config', { cache: 'no-store' }).then(response => response.json()).then(config => {
    $('auth-google').hidden = !config.google;
    if (!config.configured) { message('Account services are not available yet. Please try again later.', true); $('auth-submit').disabled = true; }
  }).catch(() => message('Unable to connect. Check your connection and try again.', true));
  if (params.has('error')) message(params.get('error') === 'provider' ? 'This sign-in method is not available yet. Use your email instead.' : 'This confirmation link could not be used. Open the latest email in the browser where you requested it, or request another reset link.', true);
  render();
})();
