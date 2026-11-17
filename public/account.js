(function exposeAccounts(root) {
  'use strict';
  async function load() {
    const response = await fetch('/api/account', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Account services are unavailable.');
    return data;
  }
  function storageFor(user) {
    const prefix = `playpulse-account:${user?.id || 'guest'}:`;
    return {
      getItem(key) { return user && key === 'playpulse-local-user-v1' ? `local-${user.id}` : localStorage.getItem(prefix + key); },
      setItem(key, value) { if (user && key === 'playpulse-local-user-v1') return; localStorage.setItem(prefix + key, value); },
      removeItem(key) { if (user && key === 'playpulse-local-user-v1') return; localStorage.removeItem(prefix + key); }
    };
  }
  async function logout() {
    const response = await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!response.ok) throw new Error('Sign-out failed. Please try again.');
    try { localStorage.setItem('playpulse-auth-changed', String(Date.now())); } catch (_) { /* Visibility checks also restore identity. */ }
    location.replace('/');
  }
  function watch(user) {
    let checking = false;
    async function check() {
      if (checking) return;
      checking = true;
      try { const current = await load(); if (current.user?.id !== user?.id) location.replace('/'); }
      catch (_) { /* Protected APIs fail closed during a connection error. */ }
      finally { checking = false; }
    }
    window.addEventListener('storage', event => { if (event.key === 'playpulse-auth-changed') location.replace('/'); });
    window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    window.addEventListener('focus', check);
  }
  root.PlayPulseAccount = { load, storageFor, logout, watch };
})(globalThis);
