'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDemoCatalogue, publicCatalogue } = require('../lib/offer-catalogue');
const { recommendOffers, hardEligibility, RANKER_ID } = require('../public/offer-ranking.js');

const NOW = Date.parse('2026-10-27T12:00:00Z');
const CONTEXT = {
  matchId: 'arsenal-chelsea-local-demo',
  team: 'Arsenal',
  event: 'goal',
  mood: 'celebrate'
};
const PREFERENCES = {
  favoriteClub: 'Arsenal',
  favoriteLeague: 'Premier League',
  offerPreferences: ['food'],
  noOfferPreference: false,
  matchDayMode: 'celebration'
};

test('hard eligibility removes inactive, expired, out-of-stock, over-budget, and unsupported offers before ranking', () => {
  const catalogue = publicCatalogue(createDemoCatalogue(NOW));
  const kit = catalogue.offers.find(offer => offer.offer_id === 'demo-ars-kit-40');
  const snack = catalogue.offers.find(offer => offer.offer_id === 'demo-goal-snack-25');
  const cafe = catalogue.offers.find(offer => offer.offer_id === 'demo-cafe-reset-5');
  const scarf = catalogue.offers.find(offer => offer.offer_id === 'demo-ars-scarf-10');
  kit.status = 'paused';
  snack.remaining_quantity = 0;
  cafe.claim_deadline_at = new Date(NOW - 1).toISOString();
  scarf.metrics.budget_remaining_minor = 0;

  const result = recommendOffers({ offers: catalogue.offers, context: CONTEXT, preferences: PREFERENCES, now: NOW });
  const ids = result.ranked.map(item => item.offer.offer_id);
  assert.ok(!ids.includes(kit.offer_id));
  assert.ok(!ids.includes(snack.offer_id));
  assert.ok(!ids.includes(cafe.offer_id));
  assert.ok(!ids.includes(scarf.offer_id));
  assert.ok(!ids.includes('demo-che-kit-40'));
  assert.ok(result.rejected.find(item => item.offer_id === kit.offer_id).reasons.includes('campaign_not_active'));
  assert.ok(result.rejected.find(item => item.offer_id === snack.offer_id).reasons.includes('inventory_exhausted'));
  assert.ok(result.rejected.find(item => item.offer_id === cafe.offer_id).reasons.includes('claim_deadline_elapsed'));
  assert.ok(result.rejected.find(item => item.offer_id === scarf.offer_id).reasons.includes('budget_exhausted'));
});

test('identical inputs produce deterministic personalised ranking and truthful reasons', () => {
  const offers = publicCatalogue(createDemoCatalogue(NOW)).offers;
  const input = {
    offers, context: CONTEXT, preferences: PREFERENCES, now: NOW,
    interactions: { categoryViews: { food: 2 }, categoryClaims: { food: 1 } }
  };
  const first = recommendOffers(input);
  const second = recommendOffers(input);
  assert.equal(first.ranker_id, RANKER_ID);
  assert.deepEqual(first.ranked.map(item => [item.offer.offer_id, item.score, item.reasons]),
    second.ranked.map(item => [item.offer.offer_id, item.score, item.reasons]));
  assert.equal(first.ranked[0].offer.offer_id, 'demo-goal-snack-25');
  assert.ok(first.ranked[0].reasons.includes('Matches your food preference.'));
  assert.ok(first.ranked[0].reasons.includes('Available for your selected team.'));
  assert.ok(first.ranked[0].reasons.includes('Matches your celebration deals setting.'));
  assert.ok(first.ranked[0].reasons.includes('Based on your previous food offer interactions.'));
  assert.equal(first.ranked[0].strategy, 'personalised_rules');
});

test('missing preferences use stable relevance fallback and a future ranker cannot reintroduce ineligible offers', () => {
  const offers = publicCatalogue(createDemoCatalogue(NOW)).offers;
  const fallback = recommendOffers({ offers, context: CONTEXT, preferences: null, now: NOW });
  assert.ok(fallback.ranked.length > 0);
  assert.ok(fallback.ranked.every(item => item.strategy === 'relevance_fallback'));
  assert.deepEqual(
    fallback.ranked.map(item => item.offer.offer_id),
    recommendOffers({ offers, context: CONTEXT, preferences: null, now: NOW }).ranked.map(item => item.offer.offer_id)
  );

  const ineligible = offers.find(offer => offer.offer_id === 'demo-che-kit-40');
  const unsafeRanker = { id: 'future-model', rankEligibleOffers() { return [{ offer: ineligible, score: 999, reasons: [] }]; } };
  assert.throws(() => recommendOffers({ offers, context: CONTEXT, now: NOW }, unsafeRanker), /outside the hard-eligible set/);
  assert.equal(hardEligibility(ineligible, CONTEXT, NOW).eligible, false);
});
