'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createFlashServer } = require('../server');

test('the real Supabase cookie adapter signs in, verifies identity, rotates no browser-readable tokens and signs out', async t => {
  const id = '44444444-4444-4444-8444-444444444444';
  const user = { id, email: 'session@example.test', email_confirmed_at: new Date().toISOString(), app_metadata: {}, user_metadata: { display_name: 'Session fan' }, aud: 'authenticated', created_at: new Date().toISOString() };
  const claims = { sub: id, exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000), role: 'authenticated', session_id: '55555555-5555-4555-8555-555555555555' };
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify(claims)).toString('base64url'), 'test-signature'].join('.');
  let verificationRequests = 0;
  const provider = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/auth/v1/token')) return res.end(JSON.stringify({ access_token: token, refresh_token: 'test-refresh-token', token_type: 'bearer', expires_in: 3600, expires_at: claims.exp, user }));
    if (req.url === '/auth/v1/user') {
      verificationRequests++;
      assert.equal(req.headers.authorization, `Bearer ${token}`);
      return res.end(JSON.stringify(user));
    }
    if (req.url === '/rest/v1/rpc/playpulse_my_role') return res.end('"fan"');
    if (req.url.startsWith('/auth/v1/logout')) { res.statusCode = 204; return res.end(); }
    res.statusCode = 404; res.end(JSON.stringify({ error: 'Unexpected provider request' }));
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => provider.close(resolve)));
  const app = createFlashServer({ auth: { url: `http://127.0.0.1:${provider.address().port}`, key: 'test-publishable-key', origin: 'https://playpulse.example' } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.email, password: 'long-session-test-password' }) });
  assert.equal(login.status, 200);
  assert.deepEqual(await login.json(), { ok: true });
  const cookies = login.headers.getSetCookie();
  assert.ok(cookies.length > 0);
  assert.ok(cookies.every(cookie => /HttpOnly/i.test(cookie) && /Secure/i.test(cookie) && /SameSite=Lax/i.test(cookie)));
  assert.ok(cookies.some(cookie => /Max-Age=34560000/.test(cookie)), 'SDK cookie seconds must be converted to Express milliseconds');
  const cookie = cookies.map(value => value.split(';')[0]).join('; ');
  const account = await fetch(base + '/api/account', { headers: { Cookie: cookie } });
  assert.equal(account.status, 200);
  const details = await account.json();
  assert.equal(details.user.id, id);
  assert.equal(details.role, 'fan');
  assert.ok(verificationRequests > 0, 'The server must call the provider to verify the cookie-backed identity');
  assert.equal(details.access_token, undefined);
  const logout = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(logout.status, 200);
  assert.ok(logout.headers.getSetCookie().some(value => /Max-Age=0/.test(value)));
});
