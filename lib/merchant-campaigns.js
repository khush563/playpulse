'use strict';

const { calculatePrice, offerMetrics } = require('./offer-catalogue');

const MERCHANT_STATES = Object.freeze(['scheduled', 'active', 'paused', 'exhausted', 'expired', 'cancelled']);
const TRANSITIONS = Object.freeze({
  scheduled: new Set(['active', 'cancelled']),
  active: new Set(['paused', 'cancelled']),
  paused: new Set(['active', 'cancelled']),
  exhausted: new Set(),
  expired: new Set(),
  cancelled: new Set()
});
const EVENT_TYPES = Object.freeze(['goal', 'penalty_scored', 'penalty_missed', 'spotlight', 'win', 'loss', 'trailing', 'penalty_trailing']);
const TEAMS = Object.freeze(['Arsenal', 'Chelsea']);
const MATCH_IDS = Object.freeze(['arsenal-chelsea-local-demo']);
const FUNDING = Object.freeze(['vendor', 'sponsor', 'co-funded']);
const FULFILMENT = Object.freeze(['delivery', 'pickup', 'digital']);

function validateMerchantCampaign(input, catalogue, options = {}) {
  const errors = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: { form: 'Campaign must be an object.' }, value: null };
  const existing = options.existing || null;
  const product = catalogue.products.find(item => item.product_id === input.product_id);
  const vendor = catalogue.vendors.find(item => item.vendor_id === input.vendor_id);
  const title = cleanText(input.title);
  const description = cleanText(input.description);
  const supportedEvents = uniqueAllowed(input.supported_events, EVENT_TYPES);
  const supportedTeams = uniqueAllowed(input.supported_teams, TEAMS);
  const supportedMatches = uniqueAllowed(input.supported_match_ids, MATCH_IDS);
  const discountType = input.discount_type;
  const discountValue = Number(input.discount_value);
  const minimumBasketMinor = Number(input.minimum_basket_minor);
  const claimWindowSeconds = Number(input.claim_window_seconds);
  const quantityCap = input.quantity_cap === null || input.quantity_cap === '' ? null : Number(input.quantity_cap);
  const campaignBudgetMinor = Number(input.campaign_budget_minor);
  const maxRedemptions = Number(input.max_redemptions);
  const startsAt = Date.parse(input.campaign_start_at);
  const endsAt = Date.parse(input.campaign_end_at);
  const vendorFundingPercent = input.funding_source === 'vendor' ? 100
    : input.funding_source === 'sponsor' ? 0 : Number(input.vendor_funding_percent);

  if (title.length < 4 || title.length > 100) errors.title = 'Title must contain 4–100 characters.';
  if (description.length < 10 || description.length > 240) errors.description = 'Description must contain 10–240 characters.';
  if (!vendor) errors.vendor_id = 'Choose a demo vendor.';
  if (!product) errors.product_id = 'Choose an eligible demo product.';
  else if (vendor && product.vendor_id !== vendor.vendor_id) errors.product_id = 'Product must belong to the selected vendor.';
  if (!supportedEvents.length) errors.supported_events = 'Choose at least one participating event.';
  if (!supportedTeams.length) errors.supported_teams = 'Choose at least one supported team.';
  if (!supportedMatches.length) errors.supported_match_ids = 'Choose the supported demo match.';
  if (!['percentage', 'fixed_amount'].includes(discountType)) errors.discount_type = 'Choose a supported discount type.';
  if (!Number.isSafeInteger(discountValue) || discountValue <= 0) errors.discount_value = 'Discount must be a positive whole number.';
  if (discountType === 'percentage' && discountValue > 90) errors.discount_value = 'Percentage discount cannot exceed 90%.';
  if (discountType === 'fixed_amount' && product && discountValue > product.unit_price_minor) errors.discount_value = 'Fixed discount cannot exceed the product price.';
  if (!Number.isSafeInteger(minimumBasketMinor) || minimumBasketMinor < 0 || minimumBasketMinor > 10_000_000) errors.minimum_basket_minor = 'Minimum basket must be between £0 and £100,000.';
  if (!Number.isSafeInteger(claimWindowSeconds) || claimWindowSeconds < 30 || claimWindowSeconds > 86_400) errors.claim_window_seconds = 'Claim window must be 30 seconds to 24 hours.';
  if (quantityCap !== null && (!Number.isSafeInteger(quantityCap) || quantityCap < 1 || quantityCap > 100_000)) errors.quantity_cap = 'Inventory cap must be 1–100,000 or left untracked.';
  if (!Number.isSafeInteger(campaignBudgetMinor) || campaignBudgetMinor < 0 || campaignBudgetMinor > 100_000_000) errors.campaign_budget_minor = 'Budget must be between £0 and £1,000,000.';
  if (!Number.isSafeInteger(maxRedemptions) || maxRedemptions < 1 || maxRedemptions > 100_000) errors.max_redemptions = 'Maximum redemptions must be 1–100,000.';
  if (!Number.isFinite(startsAt)) errors.campaign_start_at = 'Enter a valid start time.';
  if (!Number.isFinite(endsAt)) errors.campaign_end_at = 'Enter a valid end time.';
  if (Number.isFinite(startsAt) && Number.isFinite(endsAt) && endsAt <= startsAt) errors.campaign_end_at = 'End time must follow start time.';
  if (!FULFILMENT.includes(input.fulfilment_mode)) errors.fulfilment_mode = 'Choose delivery, pickup, or digital fulfilment.';
  if (!cleanText(input.fulfilment_estimate)) errors.fulfilment_estimate = 'Add a fulfilment estimate.';
  if (!FUNDING.includes(input.funding_source)) errors.funding_source = 'Choose a funding source.';
  if (input.funding_source === 'co-funded' && (!Number.isSafeInteger(vendorFundingPercent) || vendorFundingPercent < 1 || vendorFundingPercent > 99)) {
    errors.vendor_funding_percent = 'For co-funded campaigns, enter a vendor share between 1% and 99%.';
  }

  const base = {
    offer_id: existing?.offer_id || input.offer_id,
    vendor_id: input.vendor_id,
    title,
    category: product?.category,
    description,
    original_price_minor: product?.unit_price_minor,
    discount_type: discountType,
    discount_value: discountValue,
    minimum_basket_minor: minimumBasketMinor,
    eligible_product_ids: product ? [product.product_id] : [],
    supported_teams: supportedTeams,
    supported_events: supportedEvents,
    supported_moods: moodsForEvents(supportedEvents),
    supported_match_ids: supportedMatches,
    campaign_start_at: Number.isFinite(startsAt) ? new Date(startsAt).toISOString() : input.campaign_start_at,
    campaign_end_at: Number.isFinite(endsAt) ? new Date(endsAt).toISOString() : input.campaign_end_at,
    claim_deadline_at: Number.isFinite(endsAt) ? new Date(endsAt).toISOString() : input.campaign_end_at,
    claim_window_seconds: claimWindowSeconds,
    quantity_cap: quantityCap,
    remaining_quantity: quantityCap,
    campaign_budget_minor: campaignBudgetMinor,
    max_redemptions: maxRedemptions,
    fulfilment_mode: input.fulfilment_mode,
    fulfilment_estimate: cleanText(input.fulfilment_estimate),
    funding_source: input.funding_source,
    vendor_funding_percent: vendorFundingPercent,
    checkout_url: existing?.checkout_url || 'https://example.com/',
    product_icon: product?.category === 'food' ? '🍽️' : product?.category === 'experiences' ? '☕' : '🛍️',
    status: existing?.status || 'scheduled'
  };

  let price = null;
  if (product && ['percentage', 'fixed_amount'].includes(discountType) && Number.isSafeInteger(discountValue) && discountValue > 0) {
    try { price = calculatePrice(base); } catch (error) { errors.discount_value = error.message; }
  }
  if (price && Number.isSafeInteger(maxRedemptions)) {
    if (quantityCap !== null && maxRedemptions > quantityCap) errors.max_redemptions = 'Maximum redemptions cannot exceed tracked inventory.';
    if (price.discount_minor * maxRedemptions > campaignBudgetMinor) {
      errors.max_redemptions = 'Maximum redemptions exceed the campaign budget.';
    }
  }

  const used = existing ? offerMetrics(catalogue, existing) : { reservation_count: 0, budget_consumed_minor: 0 };
  if (quantityCap !== null && quantityCap < used.reservation_count) errors.quantity_cap = 'Inventory cannot be lower than existing reservations.';
  if (Number.isSafeInteger(maxRedemptions) && maxRedemptions < used.reservation_count) errors.max_redemptions = 'Maximum redemptions cannot be lower than existing reservations.';
  if (Number.isSafeInteger(campaignBudgetMinor) && campaignBudgetMinor < used.budget_consumed_minor) errors.campaign_budget_minor = 'Budget cannot be lower than committed demo spend.';

  if (Object.keys(errors).length) return { ok: false, errors, value: null };
  base.remaining_quantity = quantityCap === null ? null : quantityCap - used.reservation_count;
  return { ok: true, errors: {}, value: base };
}

function transitionMerchantCampaign(offer, to, options = {}) {
  if (!offer || !TRANSITIONS[offer.status]) return { ok: false, error: 'Campaign has an unknown state.' };
  if (!MERCHANT_STATES.includes(to)) return { ok: false, error: 'Unknown target campaign state.' };
  if (offer.status === to) return { ok: true, duplicate: true, from: offer.status, to };
  if (!TRANSITIONS[offer.status].has(to)) return { ok: false, error: `Invalid campaign transition: ${offer.status} -> ${to}.` };
  const now = options.now ?? Date.now();
  if (to === 'active') {
    if (now < Date.parse(offer.campaign_start_at) || now >= Date.parse(offer.campaign_end_at)) {
      return { ok: false, error: 'Campaign can go live only inside its configured start and end time.' };
    }
    const metrics = options.catalogue ? offerMetrics(options.catalogue, offer) : null;
    if (offer.remaining_quantity !== null && offer.remaining_quantity <= 0) return { ok: false, error: 'Campaign has no remaining tracked inventory.' };
    if (metrics && metrics.reservation_count >= offer.max_redemptions) return { ok: false, error: 'Campaign reached its maximum redemptions.' };
    if (metrics && metrics.budget_remaining_minor < calculatePrice(offer).discount_minor) return { ok: false, error: 'Campaign has insufficient remaining budget.' };
  }
  const from = offer.status;
  offer.status = to;
  offer.merchant_state_history ||= [];
  offer.merchant_state_history.push({ from, to, at: now, reason: options.reason || 'merchant_action' });
  return { ok: true, duplicate: false, from, to };
}

function moodsForEvents(events) {
  const celebration = events.some(event => ['goal', 'penalty_scored', 'spotlight', 'win'].includes(event));
  const comfort = events.some(event => ['penalty_missed', 'loss', 'trailing', 'penalty_trailing'].includes(event));
  return [...(celebration ? ['celebrate'] : []), ...(comfort ? ['comfort'] : [])];
}

function uniqueAllowed(values, allowed) {
  return [...new Set(Array.isArray(values) ? values.filter(value => allowed.includes(value)) : [])];
}

function cleanText(value) { return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''; }

module.exports = {
  MERCHANT_STATES,
  EVENT_TYPES,
  TEAMS,
  MATCH_IDS,
  validateMerchantCampaign,
  transitionMerchantCampaign
};
