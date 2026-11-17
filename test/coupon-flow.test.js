'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFlashServer } = require('../server');

async function start(t, options = {}) {
  const app = createFlashServer({ ...options, demoMode: true });
  t.after(() => app.close());
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return async (path, body) => {
    const response = await fetch(base + path, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
}

async function goal(request, eventId = 'coupon-goal-001') {
  const result = await request('/api/events/goal', { team: 'Arsenal', event_id: eventId });
  assert.equal(result.status, 200);
  return result.body.deals.find(item => item.targeted_team === 'Arsenal');
}

const orderPath = claim => `/api/merchant/claims/${encodeURIComponent(claim.claim_id)}/order`;
const detailsPath = (claim, userId = claim.user_id) => `/api/claims/${encodeURIComponent(claim.claim_id)}?user_id=${encodeURIComponent(userId)}`;

test('a last-second claim remains usable after its offer window closes, without extending on retries', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const request = await start(t);
  const campaign = await goal(request);
  now = campaign.claim_expires_at - 1;
  await request('/api/fan/team', { user_id: 'local-coupon-late', team: 'Arsenal' });
  const first = await request(`/api/campaigns/${campaign.campaign_id}/claim`, { user_id: 'local-coupon-late' });
  assert.equal(first.status, 200);
  const claim = first.body.claim;
  assert.equal(claim.fulfilment_expires_at - claim.claimed_at, 86_400_000);

  now = campaign.claim_expires_at;
  await request('/api/fan/team', { user_id: 'local-coupon-other', team: 'Arsenal' });
  const tooLate = await request(`/api/campaigns/${campaign.campaign_id}/claim`, { user_id: 'local-coupon-other' });
  assert.equal(tooLate.status, 409);
  const retry = await request(`/api/campaigns/${campaign.campaign_id}/claim`, { user_id: claim.user_id });
  assert.equal(retry.body.duplicate, true);
  assert.equal(retry.body.claim.fulfilment_expires_at, claim.fulfilment_expires_at);
  assert.equal(retry.body.claim.coupon_code, claim.coupon_code);
  assert.equal(retry.body.claim.coupon_status, 'available');
  assert.equal((await request(orderPath(claim), { action: 'complete_order' })).status, 200);
  assert.equal((await request(orderPath(claim), { action: 'redeem' })).status, 200);

  now = claim.fulfilment_expires_at;
  const duplicateRedemption = await request(orderPath(claim), { action: 'redeem' });
  assert.equal(duplicateRedemption.body.duplicate, true);
  assert.equal(duplicateRedemption.body.claim.coupon_status, 'redeemed');
});

test('coupon expiry blocks both a new completed order and redemption of an existing order at the deadline', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const request = await start(t, { fulfilmentWindowSeconds: 600 });
  const campaign = await goal(request);
  const claimed = [];
  for (const user_id of ['local-coupon-unused', 'local-coupon-ordered']) {
    await request('/api/fan/team', { user_id, team: 'Arsenal' });
    const response = await request(`/api/campaigns/${campaign.campaign_id}/claim`, { user_id });
    assert.equal(response.status, 200);
    claimed.push(response.body.claim);
  }
  assert.equal((await request(orderPath(claimed[1]), { action: 'complete_order' })).status, 200);
  now = claimed[0].fulfilment_expires_at;
  for (const [claim, action] of [[claimed[0], 'complete_order'], [claimed[1], 'redeem']]) {
    const rejected = await request(orderPath(claim), { action });
    assert.equal(rejected.status, 409);
    assert.match(rejected.body.error, /expired/);
    assert.equal(rejected.body.claim.coupon_status, 'expired');
    const details = await request(detailsPath(claim));
    assert.equal(details.body.claim.coupon_status, 'expired');
    assert.equal(details.body.claim.redemption_status, 'not_redeemed');
    assert.equal(details.body.claim.fulfilment_expires_at, claim.fulfilment_expires_at);
  }
  const retry = await request(`/api/campaigns/${campaign.campaign_id}/claim`, { user_id: claimed[0].user_id });
  assert.equal(retry.body.duplicate, true);
  assert.equal(retry.body.claim.coupon_status, 'expired');
  assert.equal(retry.body.claim.fulfilment_expires_at, claimed[0].fulfilment_expires_at);
});

test('later match moments and the final whistle preserve saved coupons', async t => {
  const request = await start(t);
  const campaign = await goal(request);
  await request('/api/fan/team', { user_id: 'local-coupon-preserved', team: 'Arsenal' });
  const first = await request(`/api/campaigns/${campaign.campaign_id}/claim`, { user_id: 'local-coupon-preserved' });
  const claim = first.body.claim;
  await goal(request, 'coupon-goal-002');
  await request('/api/events/penalty', { team: 'Arsenal' });
  await request('/api/events/penalty-result', { team: 'Arsenal', outcome: 'missed' });
  await request('/api/events/full-time', {});
  const details = await request(detailsPath(claim));
  assert.equal(details.body.claim.status, 'claimed');
  assert.equal(details.body.claim.coupon_status, 'available');
  assert.equal(details.body.claim.fulfilment_expires_at, claim.fulfilment_expires_at);
  assert.equal((await request(orderPath(claim), { action: 'complete_order' })).status, 200);
  assert.equal((await request(orderPath(claim), { action: 'redeem' })).status, 200);
});

test('overturning an earlier event blocks its coupon even after its runtime campaign has closed', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const request = await start(t);
  const campaign = await goal(request);
  await request('/api/fan/team', { user_id: 'local-coupon-review', team: 'Arsenal' });
  const response = await request(`/api/campaigns/${campaign.campaign_id}/claim`, { user_id: 'local-coupon-review' });
  const claim = response.body.claim;
  await request(orderPath(claim), { action: 'complete_order' });
  now = campaign.claim_expires_at;
  await request('/api/fan/team', { user_id: 'local-coupon-expire-window', team: 'Arsenal' });
  await request(`/api/campaigns/${campaign.campaign_id}/claim`, { user_id: 'local-coupon-expire-window' });
  await goal(request, 'coupon-goal-002');
  assert.equal((await request('/api/simulator/overturn', { event_id: 'coupon-goal-001' })).status, 200);
  assert.equal((await request(detailsPath(claim))).body.claim.coupon_status, 'review_required');
  const rejected = await request(orderPath(claim), { action: 'redeem' });
  assert.equal(rejected.status, 409);
  assert.match(rejected.body.error, /review/);
});

test('completed and redeemed orders cannot release inventory through the fan reservation endpoint', async t => {
  const request = await start(t);
  const campaign = await goal(request);
  await request('/api/fan/team', { user_id: 'local-coupon-release', team: 'Arsenal' });
  const response = await request(`/api/campaigns/${campaign.campaign_id}/claim`, { user_id: 'local-coupon-release' });
  const claim = response.body.claim;
  await request(orderPath(claim), { action: 'complete_order' });
  const releasePath = `/api/reservations/${claim.reservation_id}/release`;
  assert.equal((await request(releasePath, { user_id: claim.user_id })).status, 409);
  await request(orderPath(claim), { action: 'redeem' });
  assert.equal((await request(releasePath, { user_id: claim.user_id })).status, 409);
  const catalogue = await request('/api/catalogue');
  assert.equal(catalogue.body.offers.find(item => item.offer_id === claim.offer_id).remaining_quantity, campaign.remaining_quantity - 1);
  assert.equal((await request(detailsPath(claim))).body.claim.redemption_status, 'redeemed');
});

test('claim confirmation returns authoritative details for the local owner and handles reset', async t => {
  const request = await start(t);
  const campaign = await goal(request);
  await request('/api/fan/team', { user_id: 'local-coupon-confirm', team: 'Arsenal' });
  const response = await request(`/api/campaigns/${campaign.campaign_id}/claim`, { user_id: 'local-coupon-confirm' });
  const claim = response.body.claim;
  const details = await request(detailsPath(claim) + '&coupon=FAKE&fulfilment_expires_at=9999999999999');
  assert.equal(details.status, 200);
  assert.equal(details.headers.get('cache-control'), 'no-store');
  assert.equal(details.body.claim.coupon_code, claim.coupon_code);
  assert.equal(details.body.claim.fulfilment_expires_at, claim.fulfilment_expires_at);
  assert.equal(details.body.offer.product_name, campaign.product_name);
  assert.equal(typeof details.body.server_now, 'number');
  assert.equal((await request(detailsPath(claim, 'local-coupon-stranger'))).status, 404);
  assert.equal((await request(`/api/claims/${encodeURIComponent(claim.claim_id)}`)).status, 400);
  await request('/api/match/reset', {});
  assert.equal((await request(detailsPath(claim))).status, 404);
});
