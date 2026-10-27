'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDemoCatalogue } = require('../lib/offer-catalogue');
const { fundingSplit, computeMerchantAnalytics, contributionEstimate, safeAverage, safeRate } = require('../lib/merchant-analytics');

const NOW = Date.parse('2026-10-27T12:00:00Z');

function runtimeCampaign(id, offerId, state, claim, impression) {
  return {
    campaign_id: id,
    catalogue_offer_id: offerId,
    state,
    claims: new Map(claim ? [[claim.user_id, claim]] : []),
    impressions: new Map(impression ? [[`${impression.user_id}:${offerId}`, impression]] : [])
  };
}

function claim(overrides) {
  return {
    claim_id: `claim:${overrides.user_id}`,
    offer_id: overrides.offer_id,
    user_id: overrides.user_id,
    order_status: 'completed',
    redemption_status: 'not_redeemed',
    order_value_minor: overrides.order_value_minor,
    discount_minor: overrides.discount_minor,
    funding_source: overrides.funding_source,
    vendor_funding_percent: overrides.vendor_funding_percent,
    ...overrides
  };
}

test('analytics use null for zero denominators and honest empty states', () => {
  const analytics = computeMerchantAnalytics(createDemoCatalogue(NOW), []);
  assert.equal(analytics.totals.average_order_value_minor, null);
  assert.equal(analytics.totals.redemption_rate, null);
  assert.equal(analytics.totals.claim_rate, null);
  assert.equal(analytics.totals.has_activity, false);
  assert.equal(safeAverage(0, 0), null);
  assert.equal(safeRate(0, 0), null);
});

test('completed orders, cancelled orders, rates, values, and funding splits derive from records', () => {
  const catalogue = createDemoCatalogue(NOW);
  const campaigns = [
    runtimeCampaign('runtime-kit', 'demo-ars-kit-40', 'expired', claim({
      user_id: 'local-user-kit', offer_id: 'demo-ars-kit-40', order_value_minor: 4800,
      discount_minor: 3200, funding_source: 'co-funded', vendor_funding_percent: 50, redemption_status: 'redeemed'
    }), { user_id: 'local-user-kit', offer_id: 'demo-ars-kit-40' }),
    runtimeCampaign('runtime-snack', 'demo-goal-snack-25', 'active', claim({
      user_id: 'local-user-snack', offer_id: 'demo-goal-snack-25', order_value_minor: 1500,
      discount_minor: 500, funding_source: 'sponsor', vendor_funding_percent: 0
    }), { user_id: 'local-user-snack', offer_id: 'demo-goal-snack-25' }),
    runtimeCampaign('runtime-scarf', 'demo-ars-scarf-10', 'cancelled', claim({
      user_id: 'local-user-cancel', offer_id: 'demo-ars-scarf-10', order_value_minor: 2000,
      discount_minor: 1000, funding_source: 'vendor', vendor_funding_percent: 100,
      order_status: 'cancelled', redemption_status: 'cancelled'
    }), { user_id: 'local-user-cancel', offer_id: 'demo-ars-scarf-10' })
  ];
  const totals = computeMerchantAnalytics(catalogue, campaigns).totals;
  assert.equal(totals.impressions, 3);
  assert.equal(totals.claims, 3);
  assert.equal(totals.completed_orders, 2);
  assert.equal(totals.order_cancellations, 1);
  assert.equal(totals.redemptions, 1);
  assert.equal(totals.gross_order_value_minor, 6300);
  assert.equal(totals.average_order_value_minor, 3150);
  assert.equal(totals.discount_amount_minor, 3700);
  assert.equal(totals.merchant_funded_discount_minor, 1600);
  assert.equal(totals.sponsor_funded_discount_minor, 2100);
  assert.equal(totals.claim_rate, 1);
  assert.equal(totals.redemption_rate, 1 / 3);
  assert.equal(totals.campaign_expiries, 1);
  assert.equal(totals.campaign_cancellations, 1);
});

test('funding splits round deterministically and contribution requires explicit costs', () => {
  assert.deepEqual(fundingSplit(1001, 'co-funded', 50), {
    merchant_funded_discount_minor: 501,
    sponsor_funded_discount_minor: 500
  });
  assert.deepEqual(fundingSplit(500, 'vendor', 0), {
    merchant_funded_discount_minor: 500,
    sponsor_funded_discount_minor: 0
  });
  assert.deepEqual(fundingSplit(500, 'sponsor', 100), {
    merchant_funded_discount_minor: 0,
    sponsor_funded_discount_minor: 500
  });
  assert.equal(contributionEstimate({ completed_orders: 2, gross_order_value_minor: 6300, sponsor_funded_discount_minor: 2100 }, {}).ok, false);
  const result = contributionEstimate(
    { completed_orders: 2, gross_order_value_minor: 6300, sponsor_funded_discount_minor: 2100 },
    { unit_cost_minor: 1000, fulfilment_cost_minor: 200 }
  );
  assert.equal(result.ok, true);
  assert.equal(result.estimate.total_cost_minor, 2400);
  assert.equal(result.estimate.estimated_contribution_minor, 6000);
  assert.match(result.estimate.formula, /gross order value/);
});
