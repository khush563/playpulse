'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDecisionSupport, selectBaseline } = require('../lib/merchant-decision-support');

function validInput(overrides = {}) {
  return {
    expected_reach: 100,
    available_stock: 6,
    campaign_budget_minor: 19_200,
    discount_minor: 3_200,
    campaign_max_redemptions: 6,
    final_price_minor: 4_800,
    goal: 'claims',
    stock_cap_override: null,
    unit_cost_minor: null,
    unit_fulfilment_cost_minor: null,
    funding_source: 'co-funded',
    vendor_funding_percent: 50,
    ...overrides
  };
}

test('empty or insufficient history uses a clearly labelled illustrative fallback', () => {
  const empty = buildDecisionSupport(validInput(), []);
  assert.equal(empty.ok, true);
  assert.equal(empty.source.type, 'illustrative_demo');
  assert.equal(empty.source.label, 'Illustrative demo dataset');
  assert.equal(empty.source.sufficient_local_history, false);
  assert.deepEqual(empty.estimates.expected_claims, { low: 7, high: 10 });
  assert.deepEqual(empty.estimates.expected_completed_orders, { low: 3, high: 7 });
  assert.match(empty.limitations.join(' '), /not a forecast/i);

  assert.equal(selectBaseline([{ impressions: 20, claims: 2, completed_orders: 1 }]).type, 'illustrative_demo');
});

test('three valid local samples become the observed baseline and results are deterministic', () => {
  const samples = [
    { sample_id: 'a', impressions: 100, claims: 10, completed_orders: 5 },
    { sample_id: 'b', impressions: 100, claims: 20, completed_orders: 8 },
    { sample_id: 'c', impressions: 50, claims: 5, completed_orders: 4 }
  ];
  const first = buildDecisionSupport(validInput(), samples);
  const second = buildDecisionSupport(validInput(), samples);
  assert.deepEqual(first, second);
  assert.equal(first.source.type, 'observed_local');
  assert.equal(first.source.sample_count, 3);
  assert.deepEqual(first.estimates.expected_claims, { low: 10, high: 20 });
});

test('missing inputs and invalid budget or stock return field errors', () => {
  const missing = buildDecisionSupport({}, []);
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.expected_reach);
  assert.ok(missing.errors.available_stock);
  assert.ok(missing.errors.campaign_budget_minor);

  const invalid = buildDecisionSupport(validInput({ available_stock: -1, campaign_budget_minor: -1 }), []);
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.available_stock);
  assert.ok(invalid.errors.campaign_budget_minor);
});

test('the recommended cap obeys stock, budget, redemption, and override boundaries', () => {
  const budgetBound = buildDecisionSupport(validInput({ available_stock: 20, campaign_budget_minor: 9_600, campaign_max_redemptions: 15 }), []);
  assert.equal(budgetBound.stock.budget_supported_units, 3);
  assert.equal(budgetBound.stock.hard_safe_limit, 3);
  assert.equal(budgetBound.stock.recommended_cap, 3);

  const override = buildDecisionSupport(validInput({ stock_cap_override: 4 }), []);
  assert.equal(override.stock.applied_cap, 4);
  assert.equal(override.stock.overridden, true);

  const tooHigh = buildDecisionSupport(validInput({ stock_cap_override: 7 }), []);
  assert.equal(tooHigh.ok, false);
  assert.match(tooHigh.errors.stock_cap_override, /safe campaign limit of 6/);
});

test('contribution appears only from both explicit cost inputs', () => {
  const absent = buildDecisionSupport(validInput({ goal: 'protect_margin' }), []);
  assert.equal(absent.contribution.available, false);

  const partial = buildDecisionSupport(validInput({ unit_cost_minor: 3_000 }), []);
  assert.equal(partial.ok, false);
  assert.ok(partial.errors.costs);

  const supplied = buildDecisionSupport(validInput({ goal: 'protect_margin', unit_cost_minor: 3_000, unit_fulfilment_cost_minor: 500 }), []);
  assert.equal(supplied.contribution.available, true);
  assert.equal(supplied.contribution.sponsor_reimbursement_minor, 1_600);
  assert.equal(supplied.contribution.estimated_contribution_minor, 2_900);
  assert.match(supplied.contribution.formula, /sponsor-funded discount/);
});
