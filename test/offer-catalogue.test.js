'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createDemoCatalogue,
  validateCatalogue,
  calculatePrice,
  offerEligibility,
  discoverOffers,
  reserveInventory,
  releaseInventory
} = require('../lib/offer-catalogue');

const NOW = Date.parse('2026-10-27T12:00:00Z');

test('seeded demo catalogue validates and calculates percentage and fixed prices in minor units', () => {
  const catalogue = createDemoCatalogue(NOW);
  assert.deepEqual(validateCatalogue(catalogue), { ok: true, errors: [] });
  const kit = catalogue.offers.find(offer => offer.offer_id === 'demo-ars-kit-40');
  assert.deepEqual(calculatePrice(kit), {
    original_price_minor: 8000,
    discount_minor: 3200,
    final_price_minor: 4800
  });
  const scarf = catalogue.offers.find(offer => offer.offer_id === 'demo-ars-scarf-10');
  assert.deepEqual(calculatePrice(scarf), {
    original_price_minor: 3000,
    discount_minor: 1000,
    final_price_minor: 2000
  });
  assert.throws(() => calculatePrice({ original_price_minor: 1000, discount_type: 'fixed_amount', discount_value: 1001 }), /cannot exceed/);
});

test('eligibility filters team, event, categories, dates, status, and tracked availability', () => {
  const catalogue = createDemoCatalogue(NOW);
  const context = {
    matchId: 'arsenal-chelsea-local-demo',
    team: 'Arsenal',
    event: 'goal',
    mood: 'celebrate',
    categories: ['food']
  };
  const discovered = discoverOffers(catalogue, context, NOW);
  assert.deepEqual(discovered.preferred.map(offer => offer.offer_id), ['demo-goal-snack-25']);
  assert.ok(discovered.alternatives.some(offer => offer.offer_id === 'demo-ars-kit-40'));
  assert.ok(discovered.alternatives.some(offer => offer.category === 'experiences'));

  const kit = catalogue.offers.find(offer => offer.offer_id === 'demo-ars-kit-40');
  assert.equal(offerEligibility(kit, { ...context, team: 'Chelsea' }, NOW).eligible, false);
  kit.status = 'cancelled';
  assert.ok(offerEligibility(kit, context, NOW).reasons.includes('campaign_not_active'));
  kit.status = 'active';
  kit.claim_deadline_at = new Date(NOW - 1).toISOString();
  assert.ok(offerEligibility(kit, context, NOW).reasons.includes('claim_deadline_elapsed'));
  kit.claim_deadline_at = new Date(NOW + 1000).toISOString();
  kit.remaining_quantity = 0;
  assert.ok(offerEligibility(kit, context, NOW).reasons.includes('inventory_exhausted'));
});

test('minimum basket and atomic reservation prevent duplicate decrements and inventory underflow', () => {
  const catalogue = createDemoCatalogue(NOW);
  const offer = catalogue.offers.find(item => item.offer_id === 'demo-ars-scarf-10');
  offer.quantity_cap = 1;
  offer.remaining_quantity = 1;
  const base = {
    reservation_id: 'reservation-one',
    reservation_key: 'campaign:user-one',
    offer_id: offer.offer_id,
    user_id: 'local-user-one',
    match_id: 'arsenal-chelsea-local-demo',
    team: 'Arsenal',
    event: 'goal',
    mood: 'celebrate'
  };
  const tooSmall = reserveInventory(catalogue, { ...base, basket_subtotal_minor: 2499 }, NOW);
  assert.equal(tooSmall.code, 'minimum_basket_not_met');
  assert.equal(offer.remaining_quantity, 1);

  const reserved = reserveInventory(catalogue, { ...base, basket_subtotal_minor: 3000 }, NOW);
  assert.equal(reserved.ok, true);
  assert.equal(offer.remaining_quantity, 0);
  const duplicate = reserveInventory(catalogue, { ...base, basket_subtotal_minor: 3000 }, NOW);
  assert.equal(duplicate.duplicate, true);
  assert.equal(offer.remaining_quantity, 0);

  const exhausted = reserveInventory(catalogue, {
    ...base,
    reservation_id: 'reservation-two',
    reservation_key: 'campaign:user-two',
    user_id: 'local-user-two'
  }, NOW);
  assert.equal(exhausted.code, 'inventory_exhausted');
  assert.equal(offer.remaining_quantity, 0);

  const released = releaseInventory(catalogue, 'reservation-one', 'demo_release', NOW + 10);
  assert.equal(released.ok, true);
  assert.equal(offer.remaining_quantity, 1);
  assert.equal(releaseInventory(catalogue, 'reservation-one', 'demo_release', NOW + 20).duplicate, true);
  assert.equal(offer.remaining_quantity, 1);
});

