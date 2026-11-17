'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { createFlashServer } = require('../server');
const { createDemoCatalogue, validateCatalogue } = require('../lib/offer-catalogue');

function twentyMerchants(now) {
  const catalogue = createDemoCatalogue(now);
  const templates = [catalogue.offers.find(item => item.category === 'food'), catalogue.offers[0]];
  const products = [catalogue.products.find(item => item.product_id === templates[0].eligible_product_ids[0]), catalogue.products[0]];
  catalogue.vendors = [];
  catalogue.products = [];
  catalogue.offers = Array.from({ length: 20 }, (_, index) => {
    const key = String(index + 1).padStart(2, '0');
    const kind = index < 10 ? 0 : 1;
    const template = templates[kind];
    const vendorId = `demo-merchant-${key}`;
    const productId = `demo-product-${key}`;
    catalogue.vendors.push({ vendor_id: vendorId, name: `Demo merchant ${key}`, demo: true });
    catalogue.products.push({ ...products[kind], product_id: productId, vendor_id: vendorId });
    return {
      ...template, offer_id: `demo-offer-${key}`, vendor_id: vendorId, eligible_product_ids: [productId],
      title: `Demo merchant ${key} goal offer`, supported_teams: ['Chelsea'], supported_events: ['goal', 'penalty_scored', 'win'], supported_moods: ['celebrate'],
      quantity_cap: 2, remaining_quantity: 2, max_redemptions: 2,
      campaign_budget_minor: template.original_price_minor * template.discount_value / 100 * 2,
      claim_window_seconds: index === 0 ? 30 : 90
    };
  });
  assert.equal(validateCatalogue(catalogue).ok, true);
  return catalogue;
}

async function start(t, options = {}) {
  const app = createFlashServer({ ...options, demoMode: true });
  t.after(() => app.close());
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (path, body) => {
    const response = await fetch(base + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  return { base, request };
}

const claimPath = campaign => `/api/campaigns/${campaign.campaign_id}/claim`;
const walletPath = user => `/api/wallet?user_id=${encodeURIComponent(user)}`;
const goal = (request, id = 'multi-goal-001', team = 'Chelsea') => request('/api/events/goal', { team, event_id: id });

test('one moment activates twenty independent merchants and one fan can claim all twenty', async t => {
  const { request } = await start(t, { catalogueFactory: twentyMerchants });
  const first = await goal(request);
  assert.equal(first.status, 200);
  assert.equal(first.body.deals.length, 20);
  assert.equal(new Set(first.body.deals.map(item => item.vendor_id)).size, 20);
  assert.ok(first.body.deals.every(item => item.eligible_offers.length === 1));
  assert.equal((await request('/api/fan/team', { user_id: 'local-twenty-fan', team: 'Chelsea' })).status, 200);
  const responses = await Promise.all(first.body.deals.map(campaign => request(claimPath(campaign), { user_id: 'local-twenty-fan' })));
  assert.ok(responses.every(response => response.status === 200));
  const wallet = await request(walletPath('local-twenty-fan'));
  assert.equal(wallet.body.claims.length, 20);
  assert.equal(new Set(wallet.body.claims.map(item => item.coupon_code)).size, 20);
  assert.equal(new Set(wallet.body.claims.map(item => item.reservation_id)).size, 20);
  assert.ok(wallet.body.claims.every(item => item.match_id && item.source_event_id && item.vendor_name && item.product_name && item.coupon_status === 'available'));
  assert.deepEqual((await request(walletPath('local-another-fan'))).body.claims, []);

  const second = await goal(request, 'multi-goal-002');
  assert.equal(second.body.deals.length, 20);
  for (const campaign of second.body.deals) {
    const rejected = await request(claimPath(campaign), { user_id: 'local-twenty-fan' });
    assert.equal(rejected.status, 409);
    assert.ok(wallet.body.claims.some(item => item.claim_id === rejected.body.existing_claim_id));
  }
  const catalogue = await request('/api/catalogue');
  assert.ok(catalogue.body.offers.every(offer => offer.remaining_quantity === 1));
  assert.equal((await request(walletPath('local-twenty-fan'))).body.claims.length, 20);
});

test('simultaneous same-merchant offers allow only one claim across offers, events, and teams', async t => {
  const { request } = await start(t);
  const first = await goal(request, 'multi-ars-goal', 'Arsenal');
  const sameMerchant = first.body.deals.filter(item => item.vendor_id === 'demo-kit-studio');
  assert.equal(sameMerchant.length, 2);
  assert.equal((await request('/api/fan/team', { user_id: 'local-racing-fan', team: 'Arsenal' })).status, 200);
  const raced = await Promise.all(sameMerchant.map(item => request(claimPath(item), { user_id: 'local-racing-fan' })));
  assert.deepEqual(raced.map(item => item.status).sort(), [200, 409]);
  const successful = raced.find(item => item.status === 200);
  const activation = sameMerchant.find(item => item.campaign_id === successful.body.claim.campaign_id);
  const retry = await request(claimPath(activation), { user_id: 'local-racing-fan' });
  assert.equal(retry.body.duplicate, true);
  assert.equal(retry.body.claim.coupon_code, successful.body.claim.coupon_code);
  await goal(request, 'multi-che-equalizer', 'Chelsea');
  const next = await goal(request, 'multi-che-goal', 'Chelsea');
  const otherTeam = next.body.deals.find(item => item.vendor_id === 'demo-kit-studio');
  assert.equal((await request(claimPath(otherTeam), { user_id: 'local-racing-fan' })).status, 409);
  await request(`/api/reservations/${successful.body.claim.reservation_id}/release`, { user_id: 'local-racing-fan' });
  assert.equal((await request(claimPath(otherTeam), { user_id: 'local-racing-fan' })).status, 409);
  assert.equal((await request(walletPath('local-racing-fan'))).body.claims.length, 1);
  assert.equal((await request(walletPath('local-racing-fan'))).body.claims[0].coupon_status, 'cancelled');
});

test('one merchant exhausting inventory and budget does not exhaust another merchant', async t => {
  const { request } = await start(t, { catalogueFactory: twentyMerchants });
  const event = await goal(request);
  const [first, second] = event.body.deals;
  assert.equal((await request('/api/fan/team', { user_id: 'local-stock-one', team: 'Chelsea' })).status, 200);
  assert.equal((await request('/api/fan/team', { user_id: 'local-stock-two', team: 'Chelsea' })).status, 200);
  assert.equal((await request('/api/fan/team', { user_id: 'local-stock-three', team: 'Chelsea' })).status, 200);
  const raced = await Promise.all(['local-stock-one', 'local-stock-two', 'local-stock-three'].map(user_id => request(claimPath(first), { user_id })));
  assert.equal(raced.filter(item => item.status === 200).length, 2);
  assert.equal(raced.filter(item => item.status === 409).length, 1);
  assert.equal((await request(claimPath(second), { user_id: 'local-stock-three' })).status, 200);
  const catalogue = (await request('/api/catalogue')).body;
  const exhausted = catalogue.offers.find(item => item.offer_id === first.catalogue_offer_id);
  const independent = catalogue.offers.find(item => item.offer_id === second.catalogue_offer_id);
  assert.equal(exhausted.remaining_quantity, 0);
  assert.equal(exhausted.metrics.budget_remaining_minor, 0);
  assert.equal(independent.remaining_quantity, 1);
  assert.ok(independent.metrics.budget_remaining_minor > 0);
  const next = await goal(request, 'multi-goal-002');
  assert.ok(!next.body.deals.some(item => item.catalogue_offer_id === first.catalogue_offer_id));
  assert.ok(next.body.deals.some(item => item.catalogue_offer_id === second.catalogue_offer_id));
});

test('each offer keeps its own expiry and earlier activations survive later moments', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const { request } = await start(t, { catalogueFactory: twentyMerchants });
  const first = await goal(request);
  const short = first.body.deals.find(item => item.catalogue_offer_id === 'demo-offer-01');
  const long = first.body.deals.find(item => item.catalogue_offer_id === 'demo-offer-02');
  assert.equal(short.claim_expires_at - short.issued_at, 30_000);
  assert.equal(long.claim_expires_at - long.issued_at, 90_000);
  assert.equal((await request('/api/fan/team', { user_id: 'local-window-fan', team: 'Chelsea' })).status, 200);
  assert.equal((await request('/api/fan/team', { user_id: 'local-window-other', team: 'Chelsea' })).status, 200);
  const saved = await request(claimPath(short), { user_id: 'local-window-fan' });
  now += 10_000;
  await goal(request, 'multi-goal-002');
  let snapshot = (await request('/api/campaigns')).body;
  assert.equal(snapshot.campaigns.find(item => item.campaign_id === short.campaign_id).state, 'active');
  now = short.claim_expires_at;
  assert.equal((await request(claimPath(short), { user_id: 'local-window-other' })).status, 409);
  assert.equal((await request(claimPath(long), { user_id: 'local-window-fan' })).status, 200);
  const wallet = (await request(walletPath('local-window-fan'))).body;
  assert.equal(wallet.claims.length, 2);
  assert.equal(wallet.claims.find(item => item.claim_id === saved.body.claim.claim_id).coupon_status, 'available');
  snapshot = (await request('/api/campaigns')).body;
  assert.equal(snapshot.campaigns.find(item => item.campaign_id === long.campaign_id).state, 'active');
});

test('no eligible offers is a valid event outcome and duplicate delivery creates no activations', async t => {
  const { request } = await start(t, { catalogueFactory(now) {
    const catalogue = twentyMerchants(now);
    for (const offer of catalogue.offers) offer.status = 'paused';
    return catalogue;
  } });
  const first = await goal(request);
  assert.equal(first.status, 200);
  assert.equal(first.body.match.score, '0-1');
  assert.equal(first.body.event.state, 'confirmed');
  assert.equal(first.body.event.offer_state, 'none');
  assert.deepEqual(first.body.deals, []);
  const replay = await goal(request);
  assert.equal(replay.body.duplicate, true);
  assert.equal(replay.body.match.score, '0-1');
  assert.deepEqual(replay.body.match.campaigns, []);
});

function waitFor(socket, name) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${name}`)), 2000);
    socket.once(name, data => { clearTimeout(timeout); resolve(data); });
  });
}

test('wallet updates are scoped to local identity, public snapshots contain no coupons, and reconnect recovers all offers', async t => {
  const { request, base } = await start(t, { catalogueFactory: twentyMerchants });
  const owner = io(base, { transports: ['websocket'], autoConnect: false });
  const stranger = io(base, { transports: ['websocket'], autoConnect: false });
  t.after(() => { owner.disconnect(); stranger.disconnect(); });
  const connected = waitFor(owner, 'match:state');
  owner.connect();
  stranger.connect();
  await connected;
  await Promise.all([
    new Promise(resolve => owner.emit('fan:identify', 'local-private-owner', resolve)),
    new Promise(resolve => stranger.emit('fan:identify', 'local-private-stranger', resolve))
  ]);
  await new Promise(resolve => owner.emit('fan:select', 'Chelsea', resolve));
  let otherUpdates = 0;
  stranger.on('wallet:changed', () => otherUpdates++);
  const collection = waitFor(owner, 'offers:activated');
  const event = await goal(request);
  assert.equal((await collection).campaigns.length, 20);
  const changed = waitFor(owner, 'wallet:changed');
  const claimed = await request(claimPath(event.body.deals[0]), { user_id: 'local-private-owner' });
  assert.equal((await changed).claim_id, claimed.body.claim.claim_id);
  assert.equal(otherUpdates, 0);
  const publicMatch = await request('/api/match');
  assert.equal(JSON.stringify(publicMatch.body).includes(claimed.body.claim.coupon_code), false);
  assert.equal(JSON.stringify(publicMatch.body).includes('local-private-owner'), false);
  assert.equal((await request('/api/catalogue')).body.reservations, undefined);
  assert.equal((await request(walletPath('local-private-stranger'))).body.claims.length, 0);
  assert.equal((await request('/api/wallet')).status, 400);

  owner.disconnect();
  const reconnected = waitFor(owner, 'match:state');
  owner.connect();
  await reconnected;
  await new Promise(resolve => owner.emit('fan:identify', 'local-private-owner', resolve));
  const replay = waitFor(owner, 'offers:state');
  await new Promise(resolve => owner.emit('fan:select', 'Chelsea', resolve));
  assert.equal((await replay).campaigns.length, 20);
  assert.equal((await request(walletPath('local-private-owner'))).body.claims[0].coupon_code, claimed.body.claim.coupon_code);
  const duplicate = await goal(request);
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(duplicate.body.match.campaigns.length, 20);
  await request('/api/match/reset', {});
  assert.deepEqual((await request(walletPath('local-private-owner'))).body.claims, []);
});
