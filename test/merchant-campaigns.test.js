'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDemoCatalogue, reserveInventory } = require('../lib/offer-catalogue');
const { validateMerchantCampaign, transitionMerchantCampaign } = require('../lib/merchant-campaigns');

const NOW = Date.parse('2026-10-27T12:00:00Z');

function validInput() {
  return {
    title: 'Arsenal goal kit launch',
    description: 'A seeded merchant campaign for an Arsenal goal celebration.',
    vendor_id: 'demo-kit-studio',
    product_id: 'demo-ars-home-kit',
    supported_events: ['goal', 'penalty_scored'],
    supported_teams: ['Arsenal'],
    supported_match_ids: ['arsenal-chelsea-local-demo'],
    discount_type: 'percentage',
    discount_value: 25,
    minimum_basket_minor: 0,
    claim_window_seconds: 300,
    quantity_cap: 10,
    campaign_budget_minor: 20_000,
    max_redemptions: 10,
    campaign_start_at: new Date(NOW - 60_000).toISOString(),
    campaign_end_at: new Date(NOW + 86_400_000).toISOString(),
    fulfilment_mode: 'delivery',
    fulfilment_estimate: '2–4 demo business days',
    funding_source: 'vendor'
  };
}

test('merchant campaign validation normalizes a complete campaign', () => {
  const catalogue = createDemoCatalogue(NOW);
  const checked = validateMerchantCampaign(validInput(), catalogue);
  assert.equal(checked.ok, true);
  assert.equal(checked.value.original_price_minor, 8000);
  assert.equal(checked.value.category, 'merchandise');
  assert.deepEqual(checked.value.supported_moods, ['celebrate']);
  assert.equal(checked.value.status, 'scheduled');
});

test('merchant campaign validation rejects dates, discounts, budget, inventory, and maximum redemption conflicts', () => {
  const catalogue = createDemoCatalogue(NOW);
  const checked = validateMerchantCampaign({
    ...validInput(),
    discount_value: 95,
    quantity_cap: 2,
    max_redemptions: 3,
    campaign_budget_minor: -1,
    campaign_end_at: new Date(NOW - 120_000).toISOString()
  }, catalogue);
  assert.equal(checked.ok, false);
  assert.match(checked.errors.discount_value, /90/);
  assert.match(checked.errors.campaign_budget_minor, /Budget/);
  assert.match(checked.errors.max_redemptions, /inventory|budget/);
  assert.match(checked.errors.campaign_end_at, /follow/);
});

test('editing cannot reduce inventory, redemptions, or budget below actual reservations', () => {
  const catalogue = createDemoCatalogue(NOW);
  const existing = catalogue.offers.find(offer => offer.offer_id === 'demo-ars-kit-40');
  reserveInventory(catalogue, {
    reservation_id: 'merchant-reservation',
    reservation_key: 'merchant-campaign:user',
    offer_id: existing.offer_id,
    user_id: 'local-merchant-user',
    match_id: 'arsenal-chelsea-local-demo',
    team: 'Arsenal',
    event: 'goal',
    mood: 'celebrate',
    basket_subtotal_minor: 8000
  }, NOW);
  const checked = validateMerchantCampaign({
    ...validInput(),
    discount_value: 40,
    quantity_cap: 0,
    max_redemptions: 0,
    campaign_budget_minor: 0
  }, catalogue, { existing });
  assert.equal(checked.ok, false);
  assert.match(checked.errors.quantity_cap, /Inventory/);
  assert.match(checked.errors.max_redemptions, /redemptions/);
  assert.match(checked.errors.campaign_budget_minor, /Budget/);
});

test('merchant campaign state transitions support activate, pause, resume, cancel and reject invalid moves', () => {
  const catalogue = createDemoCatalogue(NOW);
  const offer = validateMerchantCampaign(validInput(), catalogue).value;
  assert.equal(transitionMerchantCampaign(offer, 'active', { now: NOW, catalogue }).ok, true);
  assert.equal(transitionMerchantCampaign(offer, 'paused', { now: NOW, catalogue }).ok, true);
  assert.equal(transitionMerchantCampaign(offer, 'active', { now: NOW, catalogue }).ok, true);
  assert.equal(transitionMerchantCampaign(offer, 'cancelled', { now: NOW, catalogue }).ok, true);
  assert.equal(transitionMerchantCampaign(offer, 'active', { now: NOW, catalogue }).ok, false);

  const future = validateMerchantCampaign({
    ...validInput(),
    campaign_start_at: new Date(NOW + 60_000).toISOString()
  }, catalogue).value;
  assert.match(transitionMerchantCampaign(future, 'active', { now: NOW, catalogue }).error, /start and end time/);
});

