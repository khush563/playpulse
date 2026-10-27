'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EVENT_STATES,
  CAMPAIGN_STATES,
  transitionEvent,
  transitionCampaign,
  campaignClaimability
} = require('../lib/state-machine');

test('event transitions are explicit, audited, idempotent, and reject invalid moves', () => {
  assert.deepEqual(EVENT_STATES, ['detected', 'pending_confirmation', 'confirmed', 'overturned', 'ignored']);
  const event = { state: 'detected', status: 'detected', state_history: [] };
  assert.equal(transitionEvent(event, 'pending_confirmation', { at: 10, reason: 'awaiting_feed' }).changed, true);
  assert.equal(event.status, 'pending_confirmation');
  assert.equal(transitionEvent(event, 'confirmed', { at: 20, reason: 'feed_confirmed' }).changed, true);
  assert.equal(transitionEvent(event, 'confirmed', { at: 30, reason: 'duplicate' }).idempotent, true);
  assert.equal(event.state_history.length, 2);
  assert.throws(() => transitionEvent(event, 'ignored'), /Invalid event transition/);
  transitionEvent(event, 'overturned', { at: 40, reason: 'decision_reversed' });
  assert.throws(() => transitionEvent(event, 'confirmed'), /Invalid event transition/);
});

test('campaign transitions and claim eligibility keep expiry and capacity deterministic', () => {
  assert.deepEqual(CAMPAIGN_STATES, ['scheduled', 'active', 'paused', 'exhausted', 'expired', 'cancelled']);
  const campaign = {
    state: 'scheduled',
    state_history: [],
    claim_expires_at: 2_000,
    claim_count: 0,
    capacity: 1
  };
  transitionCampaign(campaign, 'active', { at: 1_000, reason: 'event_confirmed' });
  assert.deepEqual(campaignClaimability(campaign, 1_500), { claimable: true, reason: null });
  assert.deepEqual(campaignClaimability(campaign, 2_000), { claimable: false, reason: 'claim_window_elapsed' });
  campaign.claim_count = 1;
  assert.deepEqual(campaignClaimability(campaign, 1_500), { claimable: false, reason: 'capacity_reached' });
  transitionCampaign(campaign, 'exhausted', { at: 1_600, reason: 'capacity_reached' });
  assert.throws(() => transitionCampaign(campaign, 'active'), /Invalid campaign transition/);
});

