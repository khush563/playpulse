'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { createFlashServer } = require('../server');
const { poolState, validateSchedule } = require('../lib/match-pool');
const ids = { fan: '11111111-1111-4111-8111-111111111111', other: '22222222-2222-4222-8222-222222222222', admin: '33333333-3333-4333-8333-333333333333' };

async function start(t, settings = {}) {
  const members = new Map(); const registrations = []; const calls = [];
  const state = { closes: Date.now() + 100000, dbDown: false, providerDown: false, ...settings };
  const clientFactory = req => {
    const who = /test-account=(fan|other|admin|unverified)/.exec(req.headers.cookie || '')?.[1];
    const user = who ? { id: ids[who] || ids.fan, email: `${who}@example.test`, email_confirmed_at: who === 'unverified' ? null : new Date().toISOString(), user_metadata: { display_name: who, role: 'admin' } } : null;
    const view = () => ({ server_now: Date.now(), pool: { match_id: 'arsenal-chelsea-local-demo', opens_at: new Date(state.closes - 7200000).toISOString(), closes_at: new Date(state.closes).toISOString(), kickoff_at: new Date(state.closes + 7200000).toISOString() }, membership: members.get(user?.id) || null, total_members: members.size, team_counts: { Arsenal: [...members.values()].filter(item => item.team === 'Arsenal').length, Chelsea: [...members.values()].filter(item => item.team === 'Chelsea').length } });
    return {
      auth: {
        getUser: async () => state.providerDown ? { error: { name: 'AuthApiError', status: 503 }, data: {} } : { data: { user }, error: null },
        signUp: async payload => { registrations.push(payload); return { data: { user: null }, error: null }; },
        signInWithPassword: async () => ({ data: { user }, error: user ? null : { status: 400 } }),
        resetPasswordForEmail: async () => ({ data: {}, error: null }),
        updateUser: async () => ({ data: { user }, error: null }),
        signOut: async () => ({ data: {}, error: null })
      },
      rpc: async (name, input) => {
        calls.push({ name, input, who });
        if (state.dbDown) return { data: null, error: { code: 'PGRST202' } };
        if (name === 'playpulse_my_role') return { data: who === 'admin' ? 'admin' : 'fan', error: null };
        if (name === 'playpulse_join_pool') {
          const existing = members.get(user.id);
          if (existing && existing.team !== input.p_team) return { error: { code: '23514', message: 'Your team is locked for this match.' } };
          if (!existing && Date.now() >= state.closes) return { error: { code: '23514', message: 'Registration is not open for this match.' } };
          if (!existing) members.set(user.id, { match_id: input.p_match_id, team: input.p_team, joined_at: new Date().toISOString() });
          return { data: { ...view(), duplicate: Boolean(existing) }, error: null };
        }
        return { data: view(), error: null };
      }
    };
  };
  const app = createFlashServer({ auth: { url: 'https://example.supabase.co', key: 'test-key', clientFactory } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (path, { who, body, method, origin } = {}) => {
    const response = await fetch(base + path, { method: method || (body ? 'POST' : 'GET'), redirect: 'manual', headers: { ...(who ? { Cookie: `test-account=${who}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(origin ? { Origin: origin } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await response.text();
    return { status: response.status, body: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text, headers: response.headers };
  };
  return { request, base, members, registrations, calls, state };
}

test('guests cannot discover private matches, pools, wallets or administrative pages', async t => {
  const { request } = await start(t);
  for (const path of ['/api/match', '/api/pool', '/api/catalogue', '/api/offers', '/api/campaigns']) assert.equal((await request(path)).status, 401);
  for (const path of ['/', '/index.html', '/INDEX.HTML', '/%69ndex.html', '/x%2f..%2findex.html', '/x%2f..%2fadmin.html', '/demo-checkout.html', '/invitations', '/invitations.html']) {
    const response = await request(path); assert.equal(response.status, 302); assert.equal(response.headers.get('location'), '/auth');
  }
  for (const path of ['/api/wallet?user_id=local-pretend-user', '/api/merchant/dashboard']) assert.equal((await request(path)).status, 401);
  for (const path of ['/api/pool/join', '/api/events/goal', '/api/match/reset', '/api/campaigns/arbitrary/claim']) assert.equal((await request(path, { body: { team: 'Arsenal', user_id: 'local-pretend-user' } })).status, 401);
  for (const path of ['/admin', '/admin.html', '/admin/', '/ADMIN.HTML', '/%61dmin.html']) assert.equal((await request(path)).status, 302);
  const auth = await request('/auth'); assert.equal(auth.status, 200); assert.doesNotMatch(auth.body, /Explore the match/);
  for (const path of ['/API/events/goal', '/api/Events/goal', '/api/events/goal/']) assert.notEqual((await request(path, { body: { team: 'Arsenal' } })).status, 200);
});

test('user metadata and supplied roles cannot grant staff access; fans cannot reach administrative operations', async t => {
  const { request } = await start(t);
  assert.equal((await request('/api/account', { who: 'fan' })).body.role, 'fan');
  assert.equal((await request('/admin', { who: 'fan' })).status, 403);
  for (const path of ['/api/events/goal', '/api/match/reset', '/api/admin/pool/schedule', '/api/merchant/campaigns']) assert.equal((await request(path, { who: 'fan', body: { role: 'admin', team: 'Arsenal' } })).status, 403);
  assert.equal((await request('/api/merchant/dashboard', { who: 'admin' })).status, 200);
});

test('signup forwards only permitted profile data and requires strong input; responses do not expose sessions', async t => {
  const { request, registrations } = await start(t);
  assert.equal((await request('/api/auth/register', { body: { name: 'Fan', email: 'bad', password: 'short' } })).status, 400);
  const result = await request('/api/auth/register', { body: { name: 'Fan', email: 'Fan@Example.test', password: 'long-enough-password', role: 'admin', app_metadata: { role: 'admin' } } });
  assert.equal(result.status, 202);
  assert.deepEqual(registrations[0].options.data, { display_name: 'Fan' });
  assert.equal(registrations[0].email, 'fan@example.test');
  assert.equal(registrations[0].options.emailRedirectTo, 'http://127.0.0.1:3000/auth/callback');
  assert.equal(result.body.access_token, undefined);
  assert.equal((await request('/api/pool/join', { who: 'unverified', body: { team: 'Arsenal' } })).status, 403);
});

test('membership gates claims, a joined account cannot switch sides, and another account cannot steal its wallet', async t => {
  const { request } = await start(t);
  const event = await request('/api/events/goal', { who: 'admin', body: { team: 'Arsenal' } });
  const kit = event.body.deals.find(item => item.catalogue_offer_id === 'demo-ars-kit-40');
  const path = `/api/campaigns/${kit.campaign_id}/claim`;
  assert.equal((await request(path, { who: 'fan', body: { user_id: `local-${ids.admin}` } })).status, 403);
  assert.equal((await request('/api/fan/team', { who: 'fan', body: { team: 'Arsenal' } })).status, 403);
  assert.equal((await request('/api/pool/join', { who: 'fan', body: { team: 'Arsenal' } })).status, 200);
  const claim = await request(path, { who: 'fan', body: { user_id: `local-${ids.admin}` } });
  assert.equal(claim.status, 200);
  assert.equal(claim.body.claim.user_id, `local-${ids.fan}`);
  assert.equal((await request('/api/pool/join', { who: 'fan', body: { team: 'Chelsea' } })).status, 409);
  assert.equal((await request('/api/wallet?user_id=local-anybody', { who: 'fan' })).body.claims.length, 1);
  assert.equal((await request('/api/wallet?user_id=local-anybody', { who: 'fan' })).body.user_id, `local-${ids.fan}`);
  assert.equal((await request(`/api/wallet?user_id=local-${ids.fan}`, { who: 'other' })).status, 403);
  await request('/api/pool/join', { who: 'other', body: { team: 'Chelsea' } });
  assert.equal((await request(`/api/wallet?user_id=local-${ids.fan}`, { who: 'other' })).body.claims.length, 0);
  assert.equal((await request(`/api/claims/${encodeURIComponent(claim.body.claim.claim_id)}?user_id=local-${ids.fan}`, { who: 'other' })).status, 404);
});

test('deadline closes new registration, retries retain membership and admin demo reset cannot unlock it', async t => {
  const { request, state, members } = await start(t);
  const first = await request('/api/pool/join', { who: 'fan', body: { team: 'Arsenal' } });
  state.closes = Date.now() - 1;
  const duplicate = await request('/api/pool/join', { who: 'fan', body: { team: 'Arsenal' } });
  assert.equal(duplicate.body.duplicate, true);
  assert.deepEqual(duplicate.body.membership, first.body.membership);
  assert.equal((await request('/api/pool/join', { who: 'other', body: { team: 'Chelsea' } })).status, 409);
  await request('/api/match/reset', { who: 'admin', body: {} });
  assert.equal(members.size, 1);
  assert.equal((await request('/api/wallet', { who: 'fan' })).body.team_choice.team, 'Arsenal');
});

test('cross-site writes and provider/database failures fail closed without enabling legacy identity', async t => {
  const { request, state } = await start(t);
  assert.equal((await request('/api/pool/join', { who: 'fan', origin: 'https://evil.example', body: { team: 'Arsenal' } })).status, 403);
  state.dbDown = true;
  assert.equal((await request('/api/wallet', { who: 'fan' })).status, 503);
  assert.equal((await request('/api/events/goal', { who: 'admin', body: { team: 'Arsenal' } })).status, 503);
  state.providerDown = true;
  assert.equal((await request('/api/pool/join', { who: 'fan', body: { team: 'Arsenal' } })).status, 503);
});

test('socket identification ignores a spoofed browser user ID and cannot subscribe to another account wallet', async t => {
  const { base, request } = await start(t);
  await request('/api/pool/join', { who: 'fan', body: { team: 'Arsenal' } });
  const socket = io(base, { transports: ['websocket'], extraHeaders: { Cookie: 'test-account=fan' }, autoConnect: false });
  t.after(() => socket.disconnect());
  await new Promise(resolve => { socket.once('connect', resolve); socket.connect(); });
  const result = await new Promise(resolve => socket.emit('fan:identify', `local-${ids.admin}`, resolve));
  assert.equal(result.team_choice.team, 'Arsenal');
  const denied = await new Promise(resolve => socket.emit('fan:select', 'Chelsea', resolve));
  assert.match(denied.error, /locked/);
});

test('pool clock boundaries use an inclusive opening and exclusive closing; schedules reject invalid windows', () => {
  const pool = { kickoff_at: '2030-01-01T20:00:00Z', opens_at: '2030-01-01T16:00:00Z', closes_at: '2030-01-01T18:00:00Z' };
  const open = Date.parse(pool.opens_at), close = Date.parse(pool.closes_at);
  assert.equal(poolState(null, open), 'unscheduled');
  assert.equal(poolState(pool, open - 1), 'upcoming');
  assert.equal(poolState(pool, open), 'open');
  assert.equal(poolState(pool, close - 1), 'open');
  assert.equal(poolState(pool, close), 'closed');
  for (const duration of [2, 59, 121, 1.5, 'bad']) assert.equal(validateSchedule({ kickoff_at: pool.kickoff_at, registration_minutes: duration }, open).ok, false);
  assert.equal(validateSchedule({ kickoff_at: pool.kickoff_at, registration_minutes: 120 }, close).ok, true);
  assert.equal(validateSchedule({ kickoff_at: pool.opens_at, registration_minutes: 60 }, close).ok, false);
});

test('repeated account attempts are limited without blocking a different fan behind the same network', async t => {
  const { request } = await start(t);
  for (let count = 0; count < 12; count++) assert.equal((await request('/api/auth/login', { body: { email: 'one@example.test', password: 'wrong-password' } })).status, 400);
  assert.equal((await request('/api/auth/login', { body: { email: 'one@example.test', password: 'wrong-password' } })).status, 429);
  assert.equal((await request('/api/auth/login', { body: { email: 'another@example.test', password: 'wrong-password' } })).status, 400);
});


test('non-members have invitations only; joining unlocks lobby and match APIs after registration closes', async t => {
  const { request, state } = await start(t);
  assert.equal((await request('/invitations', { who: 'fan' })).status, 200);
  assert.equal((await request('/api/pool', { who: 'fan' })).status, 200);
  for (const path of ['/', '/index.html', '/INDEX.HTML/', '/x%2f..%2findex.html', '/demo-checkout.html']) {
    const response = await request(path, { who: 'fan' });
    assert.equal(response.status, 302); assert.equal(response.headers.get('location'), '/invitations');
  }
  for (const path of ['/api/match', '/api/catalogue', '/api/offers', '/api/campaigns', '/api/wallet', '/api/claims/anything']) assert.equal((await request(path, { who: 'fan' })).status, 403);
  await request('/api/pool/join', { who: 'fan', body: { team: 'Arsenal' } });
  state.closes = Date.now() - 1;
  for (const path of ['/', '/index.html', '/api/match', '/api/catalogue', '/api/offers', '/api/campaigns', '/api/wallet']) assert.equal((await request(path, { who: 'fan' })).status, 200);
  assert.equal((await request('/api/match', { who: 'other' })).status, 403);
  assert.equal((await request('/', { who: 'admin' })).status, 200);
});

test('sockets reject guests and keep non-members outside live match, offers and analytics streams', async t => {
  const { base, request } = await start(t);
  const guest = io(base, { transports: ['websocket'], reconnection: false, autoConnect: false });
  t.after(() => guest.disconnect());
  const denied = await new Promise(resolve => { guest.once('connect_error', resolve); guest.connect(); });
  assert.match(denied.message, /unavailable|sign/i);
  await request('/api/pool/join', { who: 'fan', body: { team: 'Arsenal' } });
  const seen = { fan: [], other: [] }; const sockets = {};
  for (const who of ['fan', 'other']) {
    const socket = io(base, { transports: ['websocket'], extraHeaders: { Cookie: `test-account=${who}` }, autoConnect: false });
    sockets[who] = socket; t.after(() => socket.disconnect());
    socket.onAny(event => seen[who].push(event));
    await new Promise(resolve => { socket.once('connect', resolve); socket.connect(); });
  }
  assert.ok((await new Promise(resolve => sockets.other.emit('fan:identify', `local-${ids.fan}`, resolve))).error);
  assert.ok((await new Promise(resolve => sockets.other.emit('fan:select', 'Arsenal', resolve))).error);
  await new Promise(resolve => sockets.fan.emit('fan:identify', 'spoof', resolve));
  await new Promise(resolve => sockets.fan.emit('fan:select', 'Arsenal', resolve));
  const updated = new Promise(resolve => sockets.fan.once('match:state', resolve));
  await request('/api/events/goal', { who: 'admin', body: { team: 'Arsenal' } });
  await updated;
  assert.ok(seen.fan.includes('offers:state'));
  assert.ok(seen.fan.includes('match:state'));
  assert.equal(seen.fan.includes('analytics:state'), false);
  assert.deepEqual(seen.other, []);
  // An outside account is still connected to the invitation channel.
  const invitation = new Promise(resolve => sockets.other.once('pool:changed', resolve));
  assert.equal((await request('/api/admin/pool/schedule', { who: 'admin', body: { kickoff_at: new Date(Date.now() + 10800000).toISOString(), registration_minutes: 120 } })).status, 200);
  await invitation;
  assert.deepEqual(seen.other, ['pool:changed']);
  await request('/api/pool/join', { who: 'other', body: { team: 'Chelsea' } });
  sockets.other.disconnect();
  const stateReceived = new Promise(resolve => sockets.other.once('match:state', resolve));
  sockets.other.connect();
  assert.equal((await stateReceived).score, '1-0');
});


test('explicit two-minute demo windows open and close at their database timestamps', () => {
  const pool = { opens_at: '2026-11-17T23:48:00+05:30', closes_at: '2026-11-17T23:50:00+05:30', kickoff_at: '2026-11-18T01:50:00+05:30' };
  const opening = Date.parse(pool.opens_at), closing = Date.parse(pool.closes_at);
  assert.equal(poolState(pool, opening - 1), 'upcoming');
  assert.equal(poolState(pool, opening), 'open');
  assert.equal(poolState(pool, closing - 1), 'open');
  assert.equal(poolState(pool, closing), 'closed');
  assert.equal(poolState({ ...pool, cancelled: true }, opening), 'cancelled');
});
