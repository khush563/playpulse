'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { createFlashServer } = require('../server');
const { createDemoCatalogue } = require('../lib/offer-catalogue');

async function start(t, options = {}) {
  const app = createFlashServer({ ...options, demoMode: true });
  t.after(() => app.close());
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (path, body) => {
    const response = await fetch(base + path, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  };
  return { request, base };
}
const choose = (request, user_id, team = 'Arsenal') => request('/api/fan/team', { user_id, team });
const score = (request, team) => request('/api/events/goal', { team });
const claim = (request, campaign, user_id) => request(`/api/campaigns/${campaign.campaign_id}/claim`, { user_id });
const emit = (socket, name, value) => new Promise((resolve, reject) => {
  socket.timeout(2000).emit(name, value, (error, result) => error ? reject(error) : resolve(result));
});

test('team selection is required, immutable and idempotent; direct claims cannot cross sides', async t => {
  const { request } = await start(t);
  const event = await score(request, 'Chelsea');
  const kit = event.body.deals.find(item => item.offer_category === 'merchandise');
  const food = event.body.deals.find(item => item.targeted_team === 'Arsenal' && item.offer_category === 'food');
  assert.equal((await claim(request, food, 'local-locked-fan')).status, 409);
  const first = await choose(request, 'local-locked-fan');
  assert.equal(first.status, 200);
  assert.deepEqual((await choose(request, 'local-locked-fan')).body.team_choice, first.body.team_choice);
  const switched = await choose(request, 'local-locked-fan', 'Chelsea');
  assert.equal(switched.status, 409);
  assert.equal(switched.body.team_choice.team, 'Arsenal');
  assert.match((await claim(request, kit, 'local-locked-fan')).body.error, /locked to Arsenal/);
  assert.equal((await claim(request, food, 'local-locked-fan')).status, 200);
  const wallet = await request('/api/wallet?user_id=local-locked-fan');
  assert.deepEqual(wallet.body.team_choice, first.body.team_choice);
  assert.equal(wallet.body.claims.length, 1);
  assert.equal((await choose(request, 'arbitrary-id')).status, 400);
  assert.equal((await choose(request, 'local-invalid-team', 'Liverpool')).status, 400);
});

test('competing team choices commit only one side and host reset starts a new selection', async t => {
  const { request } = await start(t);
  const raced = await Promise.all(['Arsenal', 'Chelsea'].map(team => choose(request, 'local-race-team', team)));
  assert.deepEqual(raced.map(item => item.status).sort(), [200, 409]);
  const winner = raced.find(item => item.status === 200).body.team_choice.team;
  assert.equal((await request('/api/wallet?user_id=local-race-team')).body.team_choice.team, winner);
  await request('/api/match/reset', {});
  assert.equal((await request('/api/wallet?user_id=local-race-team')).body.team_choice, null);
  assert.equal((await choose(request, 'local-race-team', winner === 'Arsenal' ? 'Chelsea' : 'Arsenal')).status, 200);
});

test('browsing, a second socket and reconnect cannot unlock the same local fan identity', async t => {
  const { request, base } = await start(t);
  const sockets = [io(base, { transports: ['websocket'], autoConnect: false }), io(base, { transports: ['websocket'], autoConnect: false })];
  t.after(() => sockets.forEach(socket => socket.disconnect()));
  const connect = socket => new Promise(resolve => { socket.once('connect', resolve); socket.connect(); });
  await Promise.all(sockets.map(connect));
  const [one, two] = sockets;
  assert.match((await emit(one, 'fan:select', 'Arsenal')).error, /Identify/);
  await emit(one, 'fan:identify', 'local-reconnecting-fan');
  assert.equal((await emit(one, 'fan:select', 'Arsenal')).team, 'Arsenal');
  await new Promise(resolve => one.emit('fan:clear', resolve));
  assert.match((await emit(one, 'fan:select', 'Chelsea')).error, /locked/);
  assert.equal((await emit(two, 'fan:identify', 'local-reconnecting-fan')).team_choice.team, 'Arsenal');
  assert.match((await emit(two, 'fan:select', 'Chelsea')).error, /locked/);
  one.disconnect();
  await connect(one);
  assert.equal((await emit(one, 'fan:identify', 'local-reconnecting-fan')).team_choice.team, 'Arsenal');
  assert.match((await emit(one, 'fan:select', 'Chelsea')).error, /locked/);
  assert.equal((await request('/api/wallet?user_id=local-reconnecting-fan')).body.team_choice.team, 'Arsenal');
});

test('a goal while still trailing unlocks comfort only; an equalizer unlocks neither side', async t => {
  const { request } = await start(t);
  for (let index = 0; index < 3; index++) await score(request, 'Chelsea');
  const behind = await score(request, 'Arsenal');
  assert.equal(behind.body.match.score, '1-3');
  const own = behind.body.deals.filter(item => item.targeted_team === 'Arsenal');
  assert.ok(own.length > 0);
  assert.ok(own.every(item => item.mood === 'comfort' && item.offer_category !== 'merchandise'));
  await score(request, 'Arsenal');
  const equalizer = await score(request, 'Arsenal');
  assert.equal(equalizer.body.match.score, '3-3');
  assert.deepEqual(equalizer.body.deals, []);
  assert.deepEqual(equalizer.body.match.team_sentiments, { Arsenal: 'neutral', Chelsea: 'neutral' });
  assert.ok(equalizer.body.match.campaigns.every(item => item.state !== 'active'));
  const lead = await score(request, 'Arsenal');
  assert.ok(lead.body.deals.some(item => item.targeted_team === 'Arsenal' && item.offer_category === 'merchandise'));
  assert.ok(lead.body.deals.filter(item => item.targeted_team === 'Chelsea').every(item => item.mood === 'comfort'));
});

test('score changes close stale jerseys server-side but preserve earned coupons and exact retries', async t => {
  const { request } = await start(t);
  await choose(request, 'local-earned-jersey');
  await choose(request, 'local-unclaimed-jersey');
  const event = await score(request, 'Arsenal');
  const kit = event.body.deals.find(item => item.catalogue_offer_id === 'demo-ars-kit-40');
  const saved = await claim(request, kit, 'local-earned-jersey');
  assert.equal(saved.status, 200);
  await score(request, 'Chelsea');
  const behind = await score(request, 'Chelsea');
  assert.equal(behind.body.match.campaigns.find(item => item.campaign_id === kit.campaign_id).state, 'cancelled');
  assert.equal((await claim(request, kit, 'local-unclaimed-jersey')).status, 409);
  const wallet = (await request('/api/wallet?user_id=local-earned-jersey')).body;
  assert.equal(wallet.claims[0].coupon_status, 'available');
  assert.equal(wallet.claims[0].fulfilment_expires_at, saved.body.claim.fulfilment_expires_at);
  const retry = await claim(request, kit, 'local-earned-jersey');
  assert.equal(retry.body.duplicate, true);
  assert.equal(retry.body.claim.coupon_code, saved.body.claim.coupon_code);
});

test('a missed penalty closes celebration and opens comfort food and café even for the leading team', async t => {
  const { request } = await start(t);
  await score(request, 'Arsenal');
  await request('/api/events/penalty', { team: 'Arsenal' });
  const missed = await request('/api/events/penalty-result', { team: 'Arsenal', outcome: 'missed' });
  assert.ok(missed.body.deals.length > 0);
  assert.ok(missed.body.deals.every(item => item.mood === 'comfort' && item.offer_category !== 'merchandise'));
  assert.ok(missed.body.match.campaigns.filter(item => item.targeted_team === 'Arsenal' && item.state === 'active').every(item => item.mood === 'comfort'));
  const spotlight = await request('/api/events/spotlight', { team: 'Arsenal', player: 'Bukayo Saka' });
  assert.deepEqual(spotlight.body.deals, []);
  const final = await request('/api/events/full-time', {});
  assert.ok(final.body.deals.some(item => item.targeted_team === 'Arsenal' && item.offer_category === 'merchandise'));
});

test('misconfigured comfort merchandise cannot activate, even if its campaign explicitly includes that mood', async t => {
  const { request } = await start(t, { catalogueFactory(now) {
    const catalogue = createDemoCatalogue(now);
    const kit = catalogue.offers.find(item => item.offer_id === 'demo-ars-kit-40');
    kit.supported_moods = ['comfort'];
    kit.supported_events = ['trailing', 'penalty_missed', 'loss'];
    return catalogue;
  } });
  const event = await score(request, 'Chelsea');
  assert.ok(event.body.deals.filter(item => item.targeted_team === 'Arsenal').length > 0);
  assert.ok(event.body.deals.filter(item => item.targeted_team === 'Arsenal').every(item => item.offer_category !== 'merchandise'));
});
