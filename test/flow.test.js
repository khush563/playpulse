const test = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { createFlashServer } = require('../server');

function waitFor(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 3000);
    socket.once(event, value => { clearTimeout(timer); resolve(value); });
  });
}

async function post(url, path, body = {}) {
  const response = await fetch(`${url}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

async function jsonRequest(url, path, method, body = {}) {
  const response = await fetch(`${url}${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

function selectTeam(socket, team) {
  return new Promise(resolve => socket.emit('fan:select', team, resolve));
}

function clearTeam(socket) {
  return new Promise(resolve => socket.emit('fan:clear', resolve));
}

test('penalty offers wait for the result and reach only the right fans', async () => {
  const app = createFlashServer();
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const arsenal = io(url, { transports: ['websocket'], autoConnect: false });
  const chelsea = io(url, { transports: ['websocket'], autoConnect: false });
  const unselected = io(url, { transports: ['websocket'], autoConnect: false });
  let lateFan;
  let unselectedOffers = 0;
  unselected.on('deal:flash', () => unselectedOffers++);

  try {
    const initial = waitFor(arsenal, 'match:state');
    arsenal.connect();
    chelsea.connect();
    unselected.connect();
    assert.deepEqual(await initial, {
      minutes: 14, home_team: 'Arsenal', away_team: 'Chelsea', competition: 'Premier League',
      fixture_kind: 'local_demo', data_source: 'seeded_simulator', demo_fixture_id: 'arsenal-chelsea-demo-001', kickoff_at: null, score: '0-0',
      prediction: {
        match_id: 'arsenal-chelsea-local-demo', mode: 'simulated', window_state: 'open', lock_at: null,
        reward_cap: 5000, edit_policy: 'before_lock', reward_label: 'PlayPulse Early Bird'
      },
      offer_catalogue: { label: 'Seeded local demo catalogue', demo: true, inventory_persistence: 'in_memory' },
      campaign_config: { claim_window_seconds: 300, fulfilment_window_seconds: 86400 },
      status: 'LIVE', pending_penalty: null, last_event: 'none', last_event_player: null, last_event_minute: null, timeline: [], campaigns: []
    });
    await Promise.all([selectTeam(arsenal, 'Arsenal'), selectTeam(chelsea, 'Chelsea')]);

    const lockedState = waitFor(arsenal, 'match:state');
    const locked = await post(url, '/api/predictions/window', { state: 'locked' });
    assert.equal(locked.status, 200);
    assert.equal((await lockedState).prediction.window_state, 'locked');
    const openState = waitFor(arsenal, 'match:state');
    assert.equal((await post(url, '/api/predictions/window', { state: 'open' })).status, 200);
    assert.equal((await openState).prediction.window_state, 'open');

    const arsenalGoalDeal = waitFor(arsenal, 'deal:flash');
    const chelseaTrailingDeal = waitFor(chelsea, 'deal:flash');
    const goal = await post(url, '/api/events/goal', { team: 'Arsenal' });
    assert.equal(goal.status, 200);
    assert.equal(goal.body.match.score, '1-0');
    assert.equal(goal.body.deals.length, 2);
    const celebration = await arsenalGoalDeal;
    const comfort = await chelseaTrailingDeal;
    assert.equal(celebration.targeted_team, 'Arsenal');
    assert.equal(celebration.mood, 'celebrate');
    assert.equal(celebration.event_type, 'goal');
    assert.match(celebration.product_name, /Arsenal/);
    assert.equal(celebration.offer_category, 'merchandise');
    assert.equal(comfort.targeted_team, 'Chelsea');
    assert.equal(comfort.mood, 'comfort');
    assert.equal(comfort.product_name, 'Comfort Meal');
    assert.equal(comfort.offer_category, 'food');
    assert.equal(celebration.expires_at - celebration.issued_at, 300_000);
    assert.equal(unselectedOffers, 0);

    lateFan = io(url, { transports: ['websocket'], autoConnect: false });
    const lateState = waitFor(lateFan, 'match:state');
    lateFan.connect();
    await lateState;
    const replay = waitFor(lateFan, 'deal:flash');
    assert.deepEqual(await selectTeam(lateFan, 'Arsenal'), { team: 'Arsenal' });
    assert.deepEqual(await replay, celebration);
    const switchedReplay = waitFor(lateFan, 'deal:flash');
    await selectTeam(lateFan, 'Chelsea');
    assert.deepEqual(await switchedReplay, comfort);

    const oldChelseaOfferExpired = waitFor(chelsea, 'deal:expired');
    const penalty = await post(url, '/api/events/penalty', { team: 'Chelsea', player: 'Cole Palmer' });
    assert.equal(penalty.status, 200);
    assert.deepEqual(penalty.body.deals, []);
    assert.equal(penalty.body.match.score, '1-0');
    assert.equal(penalty.body.match.last_event, 'PENALTY awarded to Chelsea');
    assert.equal(penalty.body.match.last_event_player, 'Cole Palmer');
    assert.deepEqual(penalty.body.match.pending_penalty, { team: 'Chelsea', player: 'Cole Palmer' });
    assert.equal((await oldChelseaOfferExpired).deal_id, comfort.deal_id);
    assert.equal((await post(url, '/api/events/goal', { team: 'Arsenal' })).status, 409);
    assert.equal((await post(url, '/api/events/penalty-result', { team: 'Arsenal', outcome: 'scored' })).status, 400);
    const chelseaMissed = waitFor(chelsea, 'deal:flash');
    const lateMissed = waitFor(lateFan, 'deal:flash');
    const miss = await post(url, '/api/events/penalty-result', { team: 'Chelsea', outcome: 'missed' });
    assert.equal(miss.status, 200);
    assert.equal(miss.body.match.score, '1-0');
    assert.equal(miss.body.match.pending_penalty, null);
    assert.equal(miss.body.match.last_event, 'PENALTY MISSED by Chelsea');
    const missedDeal = await chelseaMissed;
    assert.equal(missedDeal.mood, 'comfort');
    assert.equal(missedDeal.player_name, 'Cole Palmer');
    assert.equal((await lateMissed).event_type, 'penalty_missed');
    assert.equal(unselectedOffers, 0);

    let clearedFanOffers = 0;
    lateFan.on('deal:flash', () => clearedFanOffers++);
    assert.deepEqual(await clearTeam(lateFan), { team: null });

    const arsenalSpotlight = waitFor(arsenal, 'deal:flash');
    const spotlight = await post(url, '/api/events/spotlight', { team: 'Arsenal', player: 'Bukayo Saka' });
    assert.equal(spotlight.status, 200);
    assert.equal(spotlight.body.match.score, '1-0');
    assert.equal(spotlight.body.match.last_event_player, 'Bukayo Saka');
    assert.equal((await arsenalSpotlight).event_type, 'spotlight');
    assert.equal((await post(url, '/api/events/spotlight', { team: 'Arsenal', player: 'Kylian Mbappé' })).status, 400);

    const arsenalSpotlightExpired = waitFor(arsenal, 'deal:expired');
    const awarded = await post(url, '/api/events/penalty', { team: 'Arsenal', player: 'Bukayo Saka' });
    assert.equal(awarded.status, 200);
    assert.deepEqual(awarded.body.deals, []);
    assert.equal(awarded.body.match.score, '1-0');
    assert.equal((await arsenalSpotlightExpired).deal_id, spotlight.body.deals[0].deal_id);
    const arsenalPenaltyGoal = waitFor(arsenal, 'deal:flash');
    const chelseaTrailingAgain = waitFor(chelsea, 'deal:flash');
    const scored = await post(url, '/api/events/penalty-result', { team: 'Arsenal', outcome: 'scored' });
    assert.equal(scored.status, 200);
    assert.equal(scored.body.match.score, '2-0');
    assert.equal(scored.body.match.last_event, 'PENALTY SCORED by Arsenal');
    const scoredDeal = await arsenalPenaltyGoal;
    assert.equal(scoredDeal.event_type, 'penalty_scored');
    assert.match(scoredDeal.title, /Bukayo Saka converts/);
    assert.equal(scoredDeal.expires_in_seconds, 300);
    assert.equal((await chelseaTrailingAgain).mood, 'comfort');
    assert.equal((await post(url, '/api/events/penalty-result', { team: 'Arsenal', outcome: 'scored' })).status, 409);

    const arsenalWin = waitFor(arsenal, 'deal:flash');
    const chelseaLoss = waitFor(chelsea, 'deal:flash');
    const final = await post(url, '/api/events/full-time');
    assert.equal(final.status, 200);
    assert.equal(final.body.match.status, 'FT');
    assert.equal((await arsenalWin).event_type, 'win');
    assert.equal((await chelseaLoss).event_type, 'loss');
    assert.equal((await post(url, '/api/events/goal', { team: 'Arsenal' })).status, 409);
    assert.equal((await post(url, '/api/match/reset')).body.match.score, '0-0');
    const arsenalAfterReset = waitFor(arsenal, 'deal:flash');
    const chelseaAfterReset = waitFor(chelsea, 'deal:flash');
    const chelseaGoal = await post(url, '/api/events/goal', { team: 'Chelsea', player: 'Cole Palmer' });
    assert.equal(chelseaGoal.status, 200);
    assert.equal((await arsenalAfterReset).mood, 'comfort');
    assert.match((await chelseaAfterReset).title, /Cole Palmer/);
    assert.equal(clearedFanOffers, 0);
    assert.equal((await post(url, '/api/events/goal', { team: 'Liverpool' })).status, 400);
  } finally {
    arsenal.disconnect();
    chelsea.disconnect();
    unselected.disconnect();
    lateFan?.disconnect();
    await app.close();
  }
});

test('Early Bird capacity is shared in the running local server without blocking later users', async () => {
  const app = createFlashServer({ earlyBirdCap: 1 });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const first = await post(url, '/api/rewards/early-bird/claim', { match_id: 'arsenal-chelsea-local-demo', user_id: 'local-user-one' });
    assert.equal(first.status, 200);
    assert.equal(first.body.granted, true);
    assert.equal(first.body.status, 'granted');

    const duplicate = await post(url, '/api/rewards/early-bird/claim', { match_id: 'arsenal-chelsea-local-demo', user_id: 'local-user-one' });
    assert.equal(duplicate.body.granted, true);
    assert.equal(duplicate.body.status, 'already_claimed');

    const later = await post(url, '/api/rewards/early-bird/claim', { match_id: 'arsenal-chelsea-local-demo', user_id: 'local-user-two' });
    assert.equal(later.status, 200);
    assert.equal(later.body.granted, false);
    assert.equal(later.body.status, 'cap_reached');
    assert.equal((await post(url, '/api/rewards/early-bird/claim', { match_id: 'wrong-match', user_id: 'local-user-three' })).status, 400);
  } finally {
    await app.close();
  }
});

test('simulator orders events, ignores duplicate IDs, validates payloads, overturns, and resets', async () => {
  const app = createFlashServer();
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const red = await post(url, '/api/simulator/event', { event_id: 'demo-red-test', type: 'red_card', team: 'Chelsea', minute: 30 });
    assert.equal(red.status, 200);
    assert.equal(red.body.event.offer_state, 'none');

    const goal = await post(url, '/api/simulator/event', { event_id: 'demo-goal-test', type: 'goal', team: 'Arsenal', player: 'Bukayo Saka', minute: 20 });
    assert.equal(goal.status, 200);
    assert.equal(goal.body.match.score, '1-0');
    assert.deepEqual(goal.body.match.timeline.map(event => event.id), ['demo-goal-test', 'demo-red-test']);
    assert.equal(goal.body.event.offer_state, 'active');

    const duplicate = await post(url, '/api/simulator/duplicate', { event_id: 'demo-goal-test' });
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.duplicate, true);
    assert.equal(duplicate.body.match.score, '1-0');
    assert.equal(duplicate.body.match.timeline.length, 2);

    const overturned = await post(url, '/api/simulator/overturn', { event_id: 'demo-goal-test' });
    assert.equal(overturned.status, 200);
    assert.equal(overturned.body.match.score, '0-0');
    assert.equal(overturned.body.overturned_event.status, 'overturned');
    assert.equal(overturned.body.overturned_event.offer_state, 'cancelled');

    assert.equal((await post(url, '/api/simulator/event', { type: 'goal', team: 'Arsenal', minute: 22 })).status, 400);
    assert.equal((await post(url, '/api/simulator/event', { event_id: 'bad-team', type: 'red_card', team: 'Liverpool', minute: 22 })).status, 400);
    assert.equal((await post(url, '/api/simulator/event', { event_id: 'bad-type', type: 'var_review', minute: 22 })).status, 400);
    assert.equal((await post(url, '/api/simulator/advance', { minutes: 2.5 })).status, 400);

    const reset = await post(url, '/api/match/reset');
    assert.equal(reset.status, 200);
    assert.equal(reset.body.match.score, '0-0');
    assert.deepEqual(reset.body.match.timeline, []);

    const halfTime = await post(url, '/api/simulator/event', { event_id: 'demo-half-test', type: 'half_time', minute: 45 });
    assert.equal(halfTime.body.match.status, 'HT');
    await post(url, '/api/match/reset');
    const suspended = await post(url, '/api/simulator/event', { event_id: 'demo-suspend-test', type: 'suspended', minute: 52 });
    assert.equal(suspended.body.match.status, 'SUSPENDED');
    await post(url, '/api/match/reset');
    const postponed = await post(url, '/api/simulator/event', { event_id: 'demo-postponed-test', type: 'postponed', minute: 14 });
    assert.equal(postponed.body.match.status, 'POSTPONED');
  } finally {
    await app.close();
  }
});

test('generated IDs remain distinct after reset so persistent clients see a new demo run', async () => {
  const app = createFlashServer();
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const first = await post(url, '/api/events/goal', { team: 'Arsenal' });
    assert.equal(first.status, 200);
    const firstCampaign = first.body.deals.find(deal => deal.targeted_team === 'Arsenal');
    assert.equal((await post(url, '/api/match/reset')).status, 200);
    const second = await post(url, '/api/events/goal', { team: 'Arsenal' });
    assert.equal(second.status, 200);
    const secondCampaign = second.body.deals.find(deal => deal.targeted_team === 'Arsenal');
    assert.notEqual(second.body.event.id, first.body.event.id);
    assert.notEqual(secondCampaign.campaign_id, firstCampaign.campaign_id);
  } finally {
    await app.close();
  }
});

test('pending events cannot activate campaigns; confirmation, claims, duplicates, and overturns are audited', async () => {
  const app = createFlashServer({ campaignCapacity: 2 });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const pending = await post(url, '/api/simulator/event', {
      event_id: 'state-goal-001',
      type: 'goal',
      team: 'Arsenal',
      player: 'Bukayo Saka',
      minute: 12,
      lifecycle_state: 'pending_confirmation'
    });
    assert.equal(pending.status, 200);
    assert.equal(pending.body.event.state, 'pending_confirmation');
    assert.equal(pending.body.event.offer_state, 'blocked_until_confirmed');
    assert.equal(pending.body.match.score, '0-0');
    assert.equal(pending.body.match.campaigns.length, 0);

    const confirmed = await post(url, '/api/simulator/confirm', { event_id: 'state-goal-001' });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.event.state, 'confirmed');
    assert.equal(confirmed.body.match.score, '1-0');
    assert.equal(confirmed.body.deals.length, 2);
    assert.equal(confirmed.body.match.campaigns.length, 2);
    assert.deepEqual(confirmed.body.match.campaigns[0].state_history.map(step => step.to), ['scheduled', 'active']);

    const duplicateConfirmation = await post(url, '/api/simulator/confirm', { event_id: 'state-goal-001' });
    assert.equal(duplicateConfirmation.status, 200);
    assert.equal(duplicateConfirmation.body.duplicate, true);
    assert.equal(duplicateConfirmation.body.match.campaigns.length, 2);

    const campaignId = confirmed.body.deals.find(deal => deal.targeted_team === 'Arsenal').campaign_id;
    const firstClaim = await post(url, `/api/campaigns/${campaignId}/claim`, { user_id: 'local-state-user' });
    assert.equal(firstClaim.status, 200);
    assert.equal(firstClaim.body.claim.status, 'claimed');
    assert.ok(firstClaim.body.claim.fulfilment_expires_at > firstClaim.body.claim.claimed_at);
    const duplicateClaim = await post(url, `/api/campaigns/${campaignId}/claim`, { user_id: 'local-state-user' });
    assert.equal(duplicateClaim.body.duplicate, true);
    assert.equal(duplicateClaim.body.campaign.claim_count, 1);
    assert.equal(duplicateClaim.body.claim.coupon_code, firstClaim.body.claim.coupon_code);
    assert.equal(duplicateClaim.body.claim.redemption_status, 'not_redeemed');

    const overturned = await post(url, '/api/simulator/overturn', { event_id: 'state-goal-001' });
    assert.equal(overturned.status, 200);
    assert.equal(overturned.body.match.score, '0-0');
    const cancelled = overturned.body.match.campaigns.find(campaign => campaign.campaign_id === campaignId);
    assert.equal(cancelled.state, 'cancelled');
    assert.equal(cancelled.claims[0].status, 'review_required');
    assert.ok(cancelled.claims[0].status_history.some(step => step.reason === 'source_event_overturned'));

    const delayed = await post(url, '/api/simulator/event', {
      event_id: 'state-delayed-red',
      type: 'red_card',
      team: 'Chelsea',
      minute: 5,
      lifecycle_state: 'confirmed'
    });
    assert.equal(delayed.status, 200);
    assert.equal(delayed.body.event.delayed, true);
    assert.equal(delayed.body.match.timeline[0].id, 'state-delayed-red');

    const final = await post(url, '/api/simulator/event', { event_id: 'state-final-001', type: 'full_time', minute: 90 });
    assert.equal(final.body.match.status, 'FT');
    const afterFinal = await post(url, '/api/simulator/event', {
      event_id: 'state-late-goal', type: 'goal', team: 'Chelsea', player: 'Cole Palmer', minute: 88
    });
    assert.equal(afterFinal.status, 200);
    assert.equal(afterFinal.body.event.state, 'ignored');
    assert.equal(afterFinal.body.match.score, final.body.match.score);
    assert.equal(afterFinal.body.deals.length, 0);
  } finally {
    await app.close();
  }
});

test('claim window expiry and suspended match campaign pause are separate states', async () => {
  const app = createFlashServer({ claimWindowSeconds: 0.04 });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const goal = await post(url, '/api/simulator/event', {
      event_id: 'expiry-goal-001', type: 'goal', team: 'Arsenal', player: 'Bukayo Saka', minute: 20
    });
    const campaignId = goal.body.deals.find(deal => deal.targeted_team === 'Arsenal').campaign_id;
    await new Promise(resolve => setTimeout(resolve, 90));
    const expired = await fetch(`${url}/api/campaigns`).then(response => response.json());
    assert.equal(expired.campaigns.find(campaign => campaign.campaign_id === campaignId).state, 'expired');

    await post(url, '/api/match/reset');
    const active = await post(url, '/api/simulator/event', {
      event_id: 'pause-goal-001', type: 'goal', team: 'Chelsea', player: 'Cole Palmer', minute: 30
    });
    const pausedId = active.body.deals.find(deal => deal.targeted_team === 'Chelsea').campaign_id;
    const suspended = await post(url, '/api/simulator/event', {
      event_id: 'pause-match-001', type: 'suspended', minute: 31
    });
    assert.equal(suspended.body.match.status, 'SUSPENDED');
    assert.equal(suspended.body.match.campaigns.find(campaign => campaign.campaign_id === pausedId).state, 'paused');
  } finally {
    await app.close();
  }
});

test('catalogue claims enforce minimum basket and release tracked inventory without underflow', async () => {
  const app = createFlashServer();
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const discovery = await fetch(`${url}/api/offers?team=Arsenal&event=goal&mood=celebrate&categories=food`).then(response => response.json());
    assert.deepEqual(discovery.preferred.map(offer => offer.offer_id), ['demo-goal-snack-25']);
    assert.ok(discovery.alternatives.some(offer => offer.offer_id === 'demo-ars-kit-40'));

    const goal = await post(url, '/api/simulator/event', {
      event_id: 'catalogue-goal-001', type: 'goal', team: 'Arsenal', player: 'Bukayo Saka', minute: 23
    });
    const campaign = goal.body.deals.find(deal => deal.targeted_team === 'Arsenal');
    assert.equal(campaign.original_price_minor, 8000);
    assert.equal(campaign.final_price_minor, 4800);
    assert.equal(campaign.discount_minor, 3200);
    const scarf = campaign.eligible_offers.find(offer => offer.offer_id === 'demo-ars-scarf-10');
    assert.equal(scarf.remaining_quantity, 8);

    const tooSmall = await post(url, `/api/campaigns/${campaign.campaign_id}/claim`, {
      user_id: 'local-catalogue-user', offer_id: scarf.offer_id, basket_subtotal_minor: 2499
    });
    assert.equal(tooSmall.status, 409);
    assert.match(tooSmall.body.error, /minimum basket/i);

    const claimed = await post(url, `/api/campaigns/${campaign.campaign_id}/claim`, {
      user_id: 'local-catalogue-user', offer_id: scarf.offer_id, basket_subtotal_minor: 3000
    });
    assert.equal(claimed.status, 200);
    assert.equal(claimed.body.claim.final_price_minor, 2000);
    assert.equal(claimed.body.claim.offer_id, scarf.offer_id);
    const duplicate = await post(url, `/api/campaigns/${campaign.campaign_id}/claim`, {
      user_id: 'local-catalogue-user', offer_id: scarf.offer_id, basket_subtotal_minor: 3000
    });
    assert.equal(duplicate.body.duplicate, true);

    let catalogue = await fetch(`${url}/api/catalogue`).then(response => response.json());
    assert.equal(catalogue.offers.find(offer => offer.offer_id === scarf.offer_id).remaining_quantity, 7);
    const released = await post(url, `/api/reservations/${claimed.body.claim.reservation_id}/release`, {
      user_id: 'local-catalogue-user'
    });
    assert.equal(released.status, 200);
    catalogue = await fetch(`${url}/api/catalogue`).then(response => response.json());
    assert.equal(catalogue.offers.find(offer => offer.offer_id === scarf.offer_id).remaining_quantity, 8);
    const duplicateRelease = await post(url, `/api/reservations/${claimed.body.claim.reservation_id}/release`, {
      user_id: 'local-catalogue-user'
    });
    assert.equal(duplicateRelease.body.duplicate, true);
    catalogue = await fetch(`${url}/api/catalogue`).then(response => response.json());
    assert.equal(catalogue.offers.find(offer => offer.offer_id === scarf.offer_id).remaining_quantity, 8);
  } finally {
    await app.close();
  }
});

test('merchant dashboard previews, creates, edits, transitions, and reports actual local consumption', async () => {
  const app = createFlashServer();
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const now = Date.now();
  const input = {
    title: 'Merchant match moment kit',
    description: 'A complete local campaign created by the demo merchant.',
    vendor_id: 'demo-kit-studio',
    product_id: 'demo-ars-home-kit',
    supported_events: ['goal', 'penalty_scored'],
    supported_teams: ['Arsenal'],
    supported_match_ids: ['arsenal-chelsea-local-demo'],
    discount_type: 'percentage',
    discount_value: 20,
    minimum_basket_minor: 0,
    claim_window_seconds: 300,
    quantity_cap: 3,
    campaign_budget_minor: 4800,
    max_redemptions: 3,
    campaign_start_at: new Date(now - 60_000).toISOString(),
    campaign_end_at: new Date(now + 3_600_000).toISOString(),
    fulfilment_mode: 'delivery',
    fulfilment_estimate: '2–4 demo business days',
    funding_source: 'vendor'
  };
  try {
    const initial = await fetch(`${url}/api/merchant/dashboard`).then(response => response.json());
    assert.equal(initial.account.label, 'Demo merchant account');
    assert.equal(initial.account.authenticated, false);
    assert.equal(initial.totals.active_reservations, 0);

    const invalid = await post(url, '/api/merchant/campaigns/preview', { ...input, discount_value: 95 });
    assert.equal(invalid.status, 400);
    assert.match(invalid.body.errors.discount_value, /90/);

    const preview = await post(url, '/api/merchant/campaigns/preview', input);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.campaign.offer_id, 'unsaved-preview');
    assert.equal(preview.body.campaign.final_price_minor, 6400);

    const created = await post(url, '/api/merchant/campaigns', input);
    assert.equal(created.status, 201);
    assert.equal(created.body.campaign.status, 'scheduled');
    const id = created.body.campaign.offer_id;

    const edited = await jsonRequest(url, `/api/merchant/campaigns/${id}`, 'PUT', { ...input, title: 'Edited merchant match kit' });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.campaign.title, 'Edited merchant match kit');
    assert.equal((await post(url, `/api/merchant/campaigns/${id}/state`, { state: 'active' })).status, 200);
    assert.equal((await post(url, `/api/merchant/campaigns/${id}/state`, { state: 'paused' })).body.campaign.status, 'paused');
    assert.equal((await post(url, `/api/merchant/campaigns/${id}/state`, { state: 'active' })).body.campaign.status, 'active');
    assert.equal((await post(url, `/api/merchant/campaigns/${id}/state`, { state: 'cancelled' })).body.campaign.status, 'cancelled');
    assert.equal((await post(url, `/api/merchant/campaigns/${id}/state`, { state: 'active' })).status, 409);

    const goal = await post(url, '/api/simulator/event', {
      event_id: 'merchant-consumption-goal', type: 'goal', team: 'Arsenal', player: 'Bukayo Saka', minute: 25
    });
    const fanCampaign = goal.body.deals.find(deal => deal.targeted_team === 'Arsenal');
    const firstImpression = await post(url, `/api/campaigns/${fanCampaign.campaign_id}/impressions`, {
      user_id: 'local-merchant-metrics', offer_id: fanCampaign.catalogue_offer_id
    });
    assert.equal(firstImpression.status, 201);
    assert.equal((await post(url, `/api/campaigns/${fanCampaign.campaign_id}/impressions`, {
      user_id: 'local-merchant-metrics', offer_id: fanCampaign.catalogue_offer_id
    })).body.duplicate, true);
    const claim = await post(url, `/api/campaigns/${fanCampaign.campaign_id}/claim`, { user_id: 'local-merchant-metrics' });
    assert.equal(claim.status, 200);
    const completed = await post(url, `/api/merchant/claims/${encodeURIComponent(claim.body.claim.claim_id)}/order`, { action: 'complete_order' });
    assert.equal(completed.body.claim.order_status, 'completed');
    assert.equal((await post(url, `/api/merchant/claims/${encodeURIComponent(claim.body.claim.claim_id)}/order`, { action: 'complete_order' })).body.duplicate, true);
    const redeemed = await post(url, `/api/merchant/claims/${encodeURIComponent(claim.body.claim.claim_id)}/order`, { action: 'redeem' });
    assert.equal(redeemed.body.claim.redemption_status, 'redeemed');
    assert.equal((await post(url, `/api/merchant/claims/${encodeURIComponent(claim.body.claim.claim_id)}/order`, { action: 'cancel_order' })).status, 409);

    await post(url, `/api/campaigns/${fanCampaign.campaign_id}/impressions`, {
      user_id: 'local-merchant-cancel', offer_id: fanCampaign.catalogue_offer_id
    });
    const cancelledClaim = await post(url, `/api/campaigns/${fanCampaign.campaign_id}/claim`, { user_id: 'local-merchant-cancel' });
    await post(url, `/api/merchant/claims/${encodeURIComponent(cancelledClaim.body.claim.claim_id)}/order`, { action: 'complete_order' });
    const cancelled = await post(url, `/api/merchant/claims/${encodeURIComponent(cancelledClaim.body.claim.claim_id)}/order`, { action: 'cancel_order' });
    assert.equal(cancelled.body.claim.order_status, 'cancelled');
    const dashboard = await fetch(`${url}/api/merchant/dashboard`).then(response => response.json());
    assert.equal(dashboard.totals.active_reservations, 1);
    assert.equal(dashboard.totals.budget_committed_minor, claim.body.claim.discount_minor);
    const transaction = dashboard.transactions.find(item => item.reservation_id === claim.body.claim.reservation_id);
    assert.equal(transaction.discount_minor, claim.body.claim.discount_minor);
    assert.equal(transaction.final_price_minor, claim.body.claim.final_price_minor);

    const analytics = await fetch(`${url}/api/merchant/analytics?offer_id=${fanCampaign.catalogue_offer_id}`).then(response => response.json());
    const metrics = analytics.campaigns[0];
    assert.equal(metrics.impressions, 2);
    assert.equal(metrics.claims, 2);
    assert.equal(metrics.completed_orders, 1);
    assert.equal(metrics.redemptions, 1);
    assert.equal(metrics.order_cancellations, 1);
    assert.equal(metrics.gross_order_value_minor, claim.body.claim.final_price_minor);
    assert.equal(metrics.redemption_rate, 0.5);
    assert.equal(metrics.claim_rate, 1);
    assert.equal(metrics.merchant_funded_discount_minor, claim.body.claim.discount_minor / 2);
    assert.equal(metrics.sponsor_funded_discount_minor, claim.body.claim.discount_minor / 2);
    const estimate = await post(url, '/api/merchant/analytics/estimate', {
      offer_id: fanCampaign.catalogue_offer_id, unit_cost_minor: 2000, fulfilment_cost_minor: 300
    });
    assert.equal(estimate.status, 200);
    assert.equal(estimate.body.estimate.estimated_contribution_minor,
      metrics.gross_order_value_minor + metrics.sponsor_funded_discount_minor - 2300);
    assert.equal((await post(url, '/api/merchant/analytics/estimate', { offer_id: fanCampaign.catalogue_offer_id })).status, 400);
  } finally {
    await app.close();
  }
});

test('merchant decision support exposes safe illustrative fallback and validates local constraints', async () => {
  const app = createFlashServer();
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const guidance = await post(url, '/api/merchant/decision-support', {
      offer_id: 'demo-ars-kit-40', goal: 'protect_margin', expected_reach: 100,
      available_stock: 6, campaign_budget_minor: 19_200, stock_cap_override: null,
      unit_cost_minor: 3_000, unit_fulfilment_cost_minor: 500
    });
    assert.equal(guidance.status, 200);
    assert.equal(guidance.body.engine, 'deterministic_templates_v1');
    assert.equal(guidance.body.source.type, 'illustrative_demo');
    assert.deepEqual(guidance.body.estimates.expected_claims, { low: 7, high: 10 });
    assert.equal(guidance.body.stock.recommended_cap, 6);
    assert.equal(guidance.body.contribution.estimated_contribution_minor, 2_900);

    const invalid = await post(url, '/api/merchant/decision-support', {
      offer_id: 'demo-ars-kit-40', goal: 'claims', expected_reach: 100,
      available_stock: -1, campaign_budget_minor: -1
    });
    assert.equal(invalid.status, 400);
    assert.ok(invalid.body.errors.available_stock);
    assert.ok(invalid.body.errors.campaign_budget_minor);
    const exceedsCampaign = await post(url, '/api/merchant/decision-support', {
      offer_id: 'demo-ars-kit-40', goal: 'claims', expected_reach: 100,
      available_stock: 7, campaign_budget_minor: 19_201
    });
    assert.equal(exceedsCampaign.status, 400);
    assert.match(exceedsCampaign.body.errors.available_stock, /current 6 units/);
    assert.match(exceedsCampaign.body.errors.campaign_budget_minor, /current remaining budget/);
    assert.equal((await post(url, '/api/merchant/decision-support', { offer_id: 'missing' })).status, 404);
  } finally {
    await app.close();
  }
});

test('local watch parties count real joins, expose eligible progress, support leaving, and reset', async () => {
  const app = createFlashServer();
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const created = await post(url, '/api/watch-parties', {
      user_id: 'local-owner-user', name: 'North London crew', match_id: 'arsenal-chelsea-local-demo', team: 'Arsenal', notifications_enabled: false
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.group.member_count, 1);
    assert.equal(created.body.group.reward.campaign_eligible, true);
    assert.equal(created.body.group.reward.unlocked, false);
    const code = created.body.group.code;

    assert.equal((await post(url, `/api/watch-parties/${code}/join`, { user_id: 'local-member-two' })).body.group.member_count, 2);
    const third = await post(url, `/api/watch-parties/${code}/join`, { user_id: 'local-member-three' });
    assert.equal(third.body.group.member_count, 3);
    assert.equal(third.body.group.reward.unlocked, true);
    const duplicate = await post(url, `/api/watch-parties/${code}/join`, { user_id: 'local-member-three' });
    assert.equal(duplicate.body.duplicate, true);
    assert.equal(duplicate.body.group.member_count, 3);
    const left = await post(url, `/api/watch-parties/${code}/leave`, { user_id: 'local-member-three' });
    assert.equal(left.body.group.member_count, 2);
    assert.equal(left.body.group.reward.unlocked, false);

    await post(url, '/api/match/reset');
    const afterReset = await fetch(`${url}/api/watch-parties/${code}`);
    assert.equal(afterReset.status, 404);
  } finally {
    await app.close();
  }
});
