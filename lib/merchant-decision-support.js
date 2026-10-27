'use strict';

const { fundingSplit } = require('./merchant-analytics');

const MIN_OBSERVED_SAMPLES = 3;
const GOALS = new Set(['awareness', 'claims', 'orders', 'protect_margin']);
const ILLUSTRATIVE_SAMPLES = Object.freeze([
  Object.freeze({ sample_id: 'illustrative-a', impressions: 50, claims: 4, completed_orders: 2 }),
  Object.freeze({ sample_id: 'illustrative-b', impressions: 80, claims: 8, completed_orders: 5 }),
  Object.freeze({ sample_id: 'illustrative-c', impressions: 120, claims: 9, completed_orders: 6 })
]);

function buildDecisionSupport(input = {}, observedSamples = []) {
  const checked = validateInputs(input);
  if (!checked.ok) return checked;
  const value = checked.value;
  const baseline = selectBaseline(observedSamples);
  const claimRates = baseline.samples.map(sample => sample.claims / sample.impressions);
  const orderRates = baseline.samples.map(sample => sample.completed_orders / sample.claims);
  const claimRange = rangeFromRates(value.expected_reach, claimRates);
  const orderRange = {
    low: Math.floor(claimRange.low * Math.min(...orderRates)),
    high: Math.ceil(claimRange.high * Math.max(...orderRates))
  };
  const budgetCapacity = Math.floor(value.campaign_budget_minor / value.discount_minor);
  const hardLimit = Math.min(value.available_stock, budgetCapacity, value.campaign_max_redemptions);
  const recommendedStockCap = Math.min(hardLimit, claimRange.high);
  if (value.stock_cap_override !== null && value.stock_cap_override > hardLimit) {
    return {
      ok: false,
      errors: { stock_cap_override: `Override cannot exceed the safe campaign limit of ${hardLimit} units from stock, budget, and maximum redemptions.` }
    };
  }
  const appliedStockCap = value.stock_cap_override ?? recommendedStockCap;
  const contribution = contributionPerOrder(value);

  return {
    ok: true,
    engine: 'deterministic_templates_v1',
    assistant_label: 'Demo assistant · deterministic rules',
    source: {
      type: baseline.type,
      label: baseline.type === 'observed_local'
        ? 'Observed local demo records'
        : 'Illustrative demo dataset',
      sample_count: baseline.samples.length,
      sufficient_local_history: baseline.type === 'observed_local'
    },
    method: 'The range applies the lowest and highest observed sample rates to the merchant-entered eligible reach. This is scenario planning, not a statistical confidence interval.',
    inputs: value,
    estimates: {
      label: 'Simulated estimate',
      expected_claims: claimRange,
      expected_completed_orders: orderRange,
      claim_rate_range: decimalRange(claimRates),
      completed_order_per_claim_rate_range: decimalRange(orderRates)
    },
    stock: {
      recommended_cap: recommendedStockCap,
      applied_cap: appliedStockCap,
      hard_safe_limit: hardLimit,
      budget_supported_units: budgetCapacity,
      overridden: value.stock_cap_override !== null,
      rationale: 'The conservative cap is the smallest of available stock, budget-supported units, maximum redemptions, and the upper claim scenario.'
    },
    contribution,
    recommendations: recommendations(value, baseline, appliedStockCap, contribution),
    assumptions: [
      `Eligible reach is the merchant-entered value of ${value.expected_reach}; the app does not estimate audience size.`,
      `Each claim uses ${value.discount_minor} minor currency units of campaign budget.`,
      baseline.type === 'observed_local'
        ? 'Rates come from at least three completed local demo samples for this offer.'
        : 'Local history was insufficient, so the range uses clearly labelled illustrative samples.'
    ],
    limitations: [
      'The range is not a forecast of real customer behaviour and has no claimed confidence level.',
      'The demo does not estimate lift, incrementality, seasonality, match importance, or real conversion.',
      'A restart clears observed local history because this prototype stores records in memory.'
    ]
  };
}

function validateInputs(input) {
  const errors = {};
  const expectedReach = requiredInteger(input.expected_reach, 1, 1_000_000, 'Expected eligible reach', errors, 'expected_reach');
  const stock = requiredInteger(input.available_stock, 0, 100_000, 'Available stock', errors, 'available_stock');
  const budget = requiredInteger(input.campaign_budget_minor, 0, 1_000_000_000, 'Campaign budget', errors, 'campaign_budget_minor');
  const discount = requiredInteger(input.discount_minor, 1, 100_000_000, 'Discount amount', errors, 'discount_minor');
  const maxRedemptions = requiredInteger(input.campaign_max_redemptions, 0, 100_000, 'Remaining maximum redemptions', errors, 'campaign_max_redemptions');
  const finalPrice = requiredInteger(input.final_price_minor, 0, 100_000_000, 'Final price', errors, 'final_price_minor');
  const goal = typeof input.goal === 'string' ? input.goal : '';
  if (!GOALS.has(goal)) errors.goal = 'Choose awareness, claims, orders, or protect margin.';

  const override = optionalInteger(input.stock_cap_override, 0, 100_000, 'Stock cap override', errors, 'stock_cap_override');
  const unitCost = optionalInteger(input.unit_cost_minor, 0, 100_000_000, 'Unit product cost', errors, 'unit_cost_minor');
  const fulfilmentCost = optionalInteger(input.unit_fulfilment_cost_minor, 0, 100_000_000, 'Unit fulfilment cost', errors, 'unit_fulfilment_cost_minor');
  if ((unitCost === null) !== (fulfilmentCost === null)) {
    errors.costs = 'Provide both unit product cost and unit fulfilment cost, or leave both blank.';
  }
  const source = input.funding_source;
  if (!['vendor', 'sponsor', 'co-funded'].includes(source)) errors.funding_source = 'Funding source is invalid.';
  const vendorPercent = requiredInteger(input.vendor_funding_percent, 0, 100, 'Vendor funding percentage', errors, 'vendor_funding_percent');

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      expected_reach: expectedReach,
      available_stock: stock,
      campaign_budget_minor: budget,
      discount_minor: discount,
      campaign_max_redemptions: maxRedemptions,
      final_price_minor: finalPrice,
      goal,
      stock_cap_override: override,
      unit_cost_minor: unitCost,
      unit_fulfilment_cost_minor: fulfilmentCost,
      funding_source: source,
      vendor_funding_percent: vendorPercent
    }
  };
}

function selectBaseline(observedSamples) {
  const valid = Array.isArray(observedSamples) ? observedSamples.filter(validSample).map(copySample) : [];
  if (valid.length >= MIN_OBSERVED_SAMPLES) return { type: 'observed_local', samples: valid };
  return { type: 'illustrative_demo', samples: ILLUSTRATIVE_SAMPLES.map(copySample) };
}

function validSample(sample) {
  return sample && Number.isSafeInteger(sample.impressions) && sample.impressions > 0
    && Number.isSafeInteger(sample.claims) && sample.claims > 0 && sample.claims <= sample.impressions
    && Number.isSafeInteger(sample.completed_orders) && sample.completed_orders >= 0 && sample.completed_orders <= sample.claims;
}

function copySample(sample) {
  return { sample_id: String(sample.sample_id || 'local-sample'), impressions: sample.impressions, claims: sample.claims, completed_orders: sample.completed_orders };
}

function rangeFromRates(base, rates) {
  return { low: Math.floor(base * Math.min(...rates)), high: Math.ceil(base * Math.max(...rates)) };
}

function decimalRange(rates) {
  return { low: Math.min(...rates), high: Math.max(...rates) };
}

function contributionPerOrder(value) {
  if (value.unit_cost_minor === null) {
    return {
      available: false,
      label: 'Not calculated',
      reason: 'Add both unit product cost and fulfilment cost to estimate contribution.'
    };
  }
  const split = fundingSplit(value.discount_minor, value.funding_source, value.vendor_funding_percent);
  const estimate = value.final_price_minor + split.sponsor_funded_discount_minor
    - value.unit_cost_minor - value.unit_fulfilment_cost_minor;
  return {
    available: true,
    label: 'Estimated contribution per completed order',
    estimated_contribution_minor: estimate,
    final_price_minor: value.final_price_minor,
    sponsor_reimbursement_minor: split.sponsor_funded_discount_minor,
    unit_product_cost_minor: value.unit_cost_minor,
    unit_fulfilment_cost_minor: value.unit_fulfilment_cost_minor,
    formula: 'final price + sponsor-funded discount − unit product cost − unit fulfilment cost'
  };
}

function recommendations(value, baseline, appliedCap, contribution) {
  const items = [{
    code: 'capacity',
    text: `Start with a cap of ${appliedCap} unit${appliedCap === 1 ? '' : 's'} for this demo run; it stays within the supplied stock, budget, and redemption limit.`
  }];
  const goalAdvice = {
    awareness: 'Track recorded impressions and claims separately. This demo has no evidence for awareness or brand lift.',
    claims: 'Use claims as the primary demo outcome and keep ordinary eligible offers available if this cap is reached.',
    orders: 'Track completed demo orders after claims; do not treat a claim as a completed order.',
    protect_margin: contribution.available
      ? (contribution.estimated_contribution_minor >= 0
          ? 'The supplied costs produce a non-negative contribution estimate before fixed overheads.'
          : 'The supplied costs produce a negative contribution estimate; reduce the discount or review costs before activation.')
      : 'Contribution is not calculated until both unit product cost and fulfilment cost are supplied.'
  };
  items.push({ code: value.goal, text: goalAdvice[value.goal] });
  if (baseline.type === 'illustrative_demo') items.push({ code: 'fallback', text: 'Treat the range as an interface demo until at least three valid local campaign samples exist.' });
  return items;
}

function requiredInteger(raw, min, max, label, errors, key) {
  if (!Number.isSafeInteger(raw) || raw < min || raw > max) {
    errors[key] = `${label} must be a whole number from ${min} to ${max}.`;
    return null;
  }
  return raw;
}

function optionalInteger(raw, min, max, label, errors, key) {
  if (raw === null || raw === undefined || raw === '') return null;
  return requiredInteger(raw, min, max, label, errors, key);
}

module.exports = {
  ILLUSTRATIVE_SAMPLES,
  MIN_OBSERVED_SAMPLES,
  buildDecisionSupport,
  selectBaseline,
  validateInputs
};
