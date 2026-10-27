'use strict';

const EVENT_STATES = Object.freeze([
  'detected',
  'pending_confirmation',
  'confirmed',
  'overturned',
  'ignored'
]);

const CAMPAIGN_STATES = Object.freeze([
  'scheduled',
  'active',
  'paused',
  'exhausted',
  'expired',
  'cancelled'
]);

const EVENT_TRANSITIONS = Object.freeze({
  detected: new Set(['pending_confirmation', 'confirmed', 'overturned', 'ignored']),
  pending_confirmation: new Set(['confirmed', 'overturned', 'ignored']),
  confirmed: new Set(['overturned']),
  overturned: new Set(),
  ignored: new Set()
});

const CAMPAIGN_TRANSITIONS = Object.freeze({
  scheduled: new Set(['active', 'paused', 'cancelled']),
  active: new Set(['paused', 'exhausted', 'expired', 'cancelled']),
  paused: new Set(['active', 'expired', 'cancelled']),
  exhausted: new Set(),
  expired: new Set(),
  cancelled: new Set()
});

function transition(entity, to, transitions, kind, options = {}) {
  if (!entity || typeof entity !== 'object') throw new TypeError(`${kind} must be an object.`);
  const from = entity.state;
  if (!transitions[from]) throw new Error(`Unknown ${kind} state: ${from}`);
  if (!transitions[to]) throw new Error(`Unknown ${kind} state: ${to}`);
  if (from === to) return { changed: false, idempotent: true, from, to };
  if (!transitions[from].has(to)) throw new Error(`Invalid ${kind} transition: ${from} -> ${to}`);

  const at = options.at ?? Date.now();
  entity.state = to;
  entity.state_history ||= [];
  entity.state_history.push({
    from,
    to,
    at,
    reason: options.reason || 'state transition'
  });
  return { changed: true, idempotent: false, from, to };
}

function transitionEvent(event, to, options) {
  const result = transition(event, to, EVENT_TRANSITIONS, 'event', options);
  // `status` is retained for the existing timeline UI and API clients.
  event.status = event.state;
  return result;
}

function transitionCampaign(campaign, to, options) {
  return transition(campaign, to, CAMPAIGN_TRANSITIONS, 'campaign', options);
}

function campaignClaimability(campaign, now = Date.now()) {
  if (!campaign || campaign.state !== 'active') {
    return { claimable: false, reason: `campaign_${campaign?.state || 'missing'}` };
  }
  if (!Number.isFinite(campaign.claim_expires_at) || now >= campaign.claim_expires_at) {
    return { claimable: false, reason: 'claim_window_elapsed' };
  }
  if (campaign.claim_count >= campaign.capacity) {
    return { claimable: false, reason: 'capacity_reached' };
  }
  return { claimable: true, reason: null };
}

module.exports = {
  EVENT_STATES,
  CAMPAIGN_STATES,
  transitionEvent,
  transitionCampaign,
  campaignClaimability
};
