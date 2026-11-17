'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFlashServer } = require('../server');
const { createDemoCatalogue } = require('../lib/offer-catalogue');
const { validateMerchantCampaign } = require('../lib/merchant-campaigns');

async function start(t, options = {}) {
  const app = createFlashServer({ ...options, demoMode: true });
  t.after(() => app.close());
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return async (path, body) => {
    const response = await fetch(base + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
}
const orderPath = claim => `/api/merchant/claims/${encodeURIComponent(claim.claim_id)}/order`;
const walletPath = user => `/api/wallet?user_id=${user}`;
const claimOffer = async (request, campaign, user = 'local-matchday-fan') => {
  assert.equal((await request('/api/fan/team', { user_id: user, team: campaign.targeted_team })).status, 200);
  return request(`/api/campaigns/${campaign.campaign_id}/claim`, { user_id: user });
};

test('food and café coupons get a two-hour deadline from confirmed full time while jerseys keep twenty-four hours from claiming', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const request = await start(t);
  const goal = await request('/api/events/goal', { team: 'Arsenal' });
  const claims = [];
  for (const id of ['demo-ars-kit-40', 'demo-goal-snack-25', 'demo-cafe-reset-5']) {
    const activation = goal.body.deals.find(item => item.catalogue_offer_id === id);
    const result = await claimOffer(request, activation);
    assert.equal(result.status, 200);
    claims.push(result.body.claim);
  }
  const [kit, food, cafe] = claims;
  assert.equal(kit.fulfilment_expires_at, now + 86400000);
  for (const claim of [food, cafe]) {
    assert.equal(claim.fulfilment_expires_at, null);
    assert.equal(claim.awaiting_match_end, true);
    assert.equal(claim.coupon_status, 'available');
  }
  // A long match must not make an early food coupon expire before the final whistle.
  now += 150 * 60000;
  assert.equal((await request(orderPath(food), { action: 'complete_order' })).status, 200);
  const fullTime = await request('/api/events/full-time', { event_id: 'matchday-fulltime-001' });
  assert.equal(fullTime.status, 200);
  assert.equal(fullTime.body.match.ended_at, now);
  let wallet = (await request(walletPath('local-matchday-fan'))).body.claims;
  for (const original of [food, cafe]) {
    const updated = wallet.find(item => item.claim_id === original.claim_id);
    assert.equal(updated.fulfilment_expires_at, now + 7200000);
    assert.equal(updated.awaiting_match_end, false);
  }
  assert.equal(wallet.find(item => item.claim_id === kit.claim_id).fulfilment_expires_at, kit.fulfilment_expires_at);
  const deadline = now + 7200000;
  now += 60000;
  assert.equal((await request('/api/events/full-time', { event_id: 'matchday-fulltime-001' })).body.duplicate, true);
  wallet = (await request(walletPath('local-matchday-fan'))).body.claims;
  assert.equal(wallet.find(item => item.claim_id === food.claim_id).fulfilment_expires_at, deadline);
  now = deadline;
  const rejected = await request(orderPath(food), { action: 'redeem' });
  assert.equal(rejected.status, 409);
  assert.match(rejected.body.error, /expired/);
  assert.equal((await request(orderPath(cafe), { action: 'complete_order' })).status, 409);
  assert.equal((await request(orderPath(kit), { action: 'complete_order' })).status, 200);
});

test('match-only food expires exactly at full time and a café can use a shorter one-hour grace', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const request = await start(t, { catalogueFactory(timestamp) {
    const catalogue = createDemoCatalogue(timestamp);
    catalogue.offers.find(item => item.offer_id === 'demo-goal-snack-25').redemption_grace_seconds = 0;
    catalogue.offers.find(item => item.offer_id === 'demo-cafe-reset-5').redemption_grace_seconds = 3600;
    return catalogue;
  } });
  const goal = await request('/api/events/goal', { team: 'Arsenal' });
  const food = (await claimOffer(request, goal.body.deals.find(item => item.catalogue_offer_id === 'demo-goal-snack-25'))).body.claim;
  const cafe = (await claimOffer(request, goal.body.deals.find(item => item.catalogue_offer_id === 'demo-cafe-reset-5'))).body.claim;
  assert.equal((await request(orderPath(food), { action: 'complete_order' })).status, 200);
  now += 60000;
  const fullTime = await request('/api/events/full-time', {});
  assert.ok(!fullTime.body.deals.some(item => item.catalogue_offer_id === food.offer_id));
  assert.equal((await request(orderPath(food), { action: 'redeem' })).status, 409);
  assert.equal((await request(orderPath(cafe), { action: 'complete_order' })).status, 200);
  now += 3600000;
  assert.equal((await request(orderPath(cafe), { action: 'redeem' })).status, 409);
});

test('a late post-match claim cannot extend food validity beyond full time plus two hours', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const request = await start(t, { catalogueFactory(timestamp) {
    const catalogue = createDemoCatalogue(timestamp);
    for (const offer of catalogue.offers) offer.claim_window_seconds = 86400;
    return catalogue;
  } });
  await request('/api/events/goal', { team: 'Arsenal' });
  const fullTime = await request('/api/events/full-time', {});
  const activation = fullTime.body.deals.find(item => item.catalogue_offer_id === 'demo-goal-snack-25');
  assert.equal(activation.claim_expires_at, now + 7200000);
  now += 7200000 - 1;
  const claimed = await claimOffer(request, activation);
  assert.equal(claimed.status, 200);
  assert.equal(claimed.body.claim.fulfilment_expires_at, fullTime.body.match.ended_at + 7200000);
  now += 1;
  assert.equal((await request(orderPath(claimed.body.claim), { action: 'complete_order' })).status, 409);
  assert.equal((await claimOffer(request, activation, 'local-too-late-fan')).status, 409);
});

test('global merchandise validity overrides do not give food a twenty-four-hour claim-based deadline', async t => {
  const request = await start(t, { fulfilmentWindowSeconds: 86400 });
  const event = await request('/api/events/goal', { team: 'Arsenal' });
  const food = (await claimOffer(request, event.body.deals.find(item => item.catalogue_offer_id === 'demo-goal-snack-25'))).body.claim;
  assert.equal(food.coupon_validity_policy, 'match_end');
  assert.equal(food.redemption_grace_seconds, 7200);
  assert.equal(food.fulfilment_expires_at, null);
});

test('a suspended match blocks pending food coupons for review rather than leaving them usable without an end time', async t => {
  const request = await start(t);
  const event = await request('/api/events/goal', { team: 'Arsenal' });
  const food = (await claimOffer(request, event.body.deals.find(item => item.catalogue_offer_id === 'demo-goal-snack-25'))).body.claim;
  const kit = (await claimOffer(request, event.body.deals.find(item => item.catalogue_offer_id === 'demo-ars-kit-40'))).body.claim;
  await request('/api/simulator/event', { event_id: 'matchday-suspended', type: 'suspended', minute: 30 });
  const wallet = (await request(walletPath('local-matchday-fan'))).body.claims;
  assert.equal(wallet.find(item => item.claim_id === food.claim_id).coupon_status, 'review_required');
  assert.equal(wallet.find(item => item.claim_id === kit.claim_id).coupon_status, 'available');
  assert.equal((await request(orderPath(food), { action: 'complete_order' })).status, 409);
});

test('merchant food/café settings enforce the two-hour maximum and cannot bypass the policy with a request field', () => {
  const now = Date.now();
  const catalogue = createDemoCatalogue(now);
  const input = {
    title: 'Matchday snack offer', description: 'Food valid during this match and shortly afterward.',
    vendor_id: 'demo-comfort-kitchen', product_id: 'demo-goal-snack-box', supported_events: ['goal'], supported_teams: ['Arsenal'], supported_match_ids: ['arsenal-chelsea-local-demo'],
    discount_type: 'percentage', discount_value: 20, minimum_basket_minor: 0, claim_window_seconds: 300, quantity_cap: 10, max_redemptions: 10,
    campaign_budget_minor: 4000, campaign_start_at: new Date(now - 60000).toISOString(), campaign_end_at: new Date(now + 86400000).toISOString(),
    fulfilment_mode: 'pickup', fulfilment_estimate: 'Ready in 20 minutes', funding_source: 'vendor', coupon_validity_policy: 'after_claim'
  };
  for (const seconds of [0, 1800, 3600, 7200]) {
    const result = validateMerchantCampaign({ ...input, redemption_grace_seconds: seconds }, catalogue);
    assert.equal(result.ok, true);
    assert.equal(result.value.coupon_validity_policy, 'match_end');
    assert.equal(result.value.redemption_grace_seconds, seconds);
  }
  for (const seconds of [-1, 7201, 86400, 'invalid']) {
    const result = validateMerchantCampaign({ ...input, redemption_grace_seconds: seconds }, catalogue);
    assert.equal(result.ok, false);
    assert.match(result.errors.redemption_grace_seconds, /two hours/);
  }
  const cafe = validateMerchantCampaign({ ...input, vendor_id: 'demo-matchday-cafe', product_id: 'demo-cafe-table', redemption_grace_seconds: 1800 }, catalogue);
  assert.equal(cafe.ok, true);
  assert.equal(cafe.value.coupon_validity_policy, 'match_end');
});
