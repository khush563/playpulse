'use strict';

const CATEGORIES = Object.freeze(['food', 'merchandise', 'experiences']);
const DISCOUNT_TYPES = Object.freeze(['percentage', 'fixed_amount']);
const FUNDING_SOURCES = Object.freeze(['vendor', 'sponsor', 'co-funded']);
const FULFILMENT_MODES = Object.freeze(['delivery', 'pickup', 'digital']);
const OFFER_STATUSES = Object.freeze(['scheduled', 'active', 'paused', 'exhausted', 'expired', 'cancelled']);

function createDemoCatalogue(now = Date.now()) {
  const startsAt = new Date(now - 86_400_000).toISOString();
  const endsAt = new Date(now + 365 * 86_400_000).toISOString();
  const shared = {
    currency: 'GBP',
    campaign_start_at: startsAt,
    campaign_end_at: endsAt,
    claim_deadline_at: endsAt,
    supported_match_ids: ['arsenal-chelsea-local-demo'],
    claim_window_seconds: 300,
    status: 'active'
  };
  const vendors = [
    { vendor_id: 'demo-kit-studio', name: 'Matchday Kit Studio', demo: true },
    { vendor_id: 'demo-comfort-kitchen', name: 'Comfort Kitchen', demo: true },
    { vendor_id: 'demo-matchday-cafe', name: 'Matchday Café', demo: true }
  ];
  const products = [
    { product_id: 'demo-ars-home-kit', vendor_id: 'demo-kit-studio', name: 'Arsenal Matchday Kit', category: 'merchandise', unit_price_minor: 8000 },
    { product_id: 'demo-che-home-kit', vendor_id: 'demo-kit-studio', name: 'Chelsea Matchday Kit', category: 'merchandise', unit_price_minor: 8000 },
    { product_id: 'demo-ars-scarf', vendor_id: 'demo-kit-studio', name: 'Arsenal Matchday Scarf', category: 'merchandise', unit_price_minor: 3000 },
    { product_id: 'demo-che-scarf', vendor_id: 'demo-kit-studio', name: 'Chelsea Matchday Scarf', category: 'merchandise', unit_price_minor: 3000 },
    { product_id: 'demo-comfort-meal', vendor_id: 'demo-comfort-kitchen', name: 'Comfort Meal', category: 'food', unit_price_minor: 2400 },
    { product_id: 'demo-goal-snack-box', vendor_id: 'demo-comfort-kitchen', name: 'Goal-time Snack Box', category: 'food', unit_price_minor: 2000 },
    { product_id: 'demo-cafe-table', vendor_id: 'demo-matchday-cafe', name: 'Matchday Café Table', category: 'experiences', unit_price_minor: 2000 }
  ];
  const offers = [
    makeOffer(shared, {
      offer_id: 'demo-ars-kit-40', vendor_id: 'demo-kit-studio', title: '40% off Arsenal matchday kit',
      category: 'merchandise', description: 'A clearly labelled demo saving on the Arsenal matchday kit.',
      original_price_minor: 8000, discount_type: 'percentage', discount_value: 40, minimum_basket_minor: 0,
      eligible_product_ids: ['demo-ars-home-kit'], supported_teams: ['Arsenal'],
      supported_events: ['goal', 'penalty_scored', 'spotlight', 'win'], supported_moods: ['celebrate'],
      quantity_cap: 6, remaining_quantity: 6, fulfilment_mode: 'delivery',
      fulfilment_estimate: '2–4 demo business days', funding_source: 'co-funded', vendor_funding_percent: 50,
      checkout_url: 'https://www.adidas.com/', product_icon: '👕'
    }),
    makeOffer(shared, {
      offer_id: 'demo-che-kit-40', vendor_id: 'demo-kit-studio', title: '40% off Chelsea matchday kit',
      category: 'merchandise', description: 'A clearly labelled demo saving on the Chelsea matchday kit.',
      original_price_minor: 8000, discount_type: 'percentage', discount_value: 40, minimum_basket_minor: 0,
      eligible_product_ids: ['demo-che-home-kit'], supported_teams: ['Chelsea'],
      supported_events: ['goal', 'penalty_scored', 'spotlight', 'win'], supported_moods: ['celebrate'],
      quantity_cap: 6, remaining_quantity: 6, fulfilment_mode: 'delivery',
      fulfilment_estimate: '2–4 demo business days', funding_source: 'co-funded', vendor_funding_percent: 50,
      checkout_url: 'https://www.nike.com/', product_icon: '👕'
    }),
    makeOffer(shared, {
      offer_id: 'demo-ars-scarf-10', vendor_id: 'demo-kit-studio', title: '£10 off Arsenal matchday scarf',
      category: 'merchandise', description: 'A fixed demo discount on an Arsenal matchday scarf.',
      original_price_minor: 3000, discount_type: 'fixed_amount', discount_value: 1000, minimum_basket_minor: 2500,
      eligible_product_ids: ['demo-ars-scarf'], supported_teams: ['Arsenal'],
      supported_events: ['goal', 'penalty_scored', 'spotlight', 'win'], supported_moods: ['celebrate'],
      quantity_cap: 8, remaining_quantity: 8, fulfilment_mode: 'delivery',
      fulfilment_estimate: '2–4 demo business days', funding_source: 'vendor',
      checkout_url: 'https://www.adidas.com/', product_icon: '🧣'
    }),
    makeOffer(shared, {
      offer_id: 'demo-che-scarf-10', vendor_id: 'demo-kit-studio', title: '£10 off Chelsea matchday scarf',
      category: 'merchandise', description: 'A fixed demo discount on a Chelsea matchday scarf.',
      original_price_minor: 3000, discount_type: 'fixed_amount', discount_value: 1000, minimum_basket_minor: 2500,
      eligible_product_ids: ['demo-che-scarf'], supported_teams: ['Chelsea'],
      supported_events: ['goal', 'penalty_scored', 'spotlight', 'win'], supported_moods: ['celebrate'],
      quantity_cap: 8, remaining_quantity: 8, fulfilment_mode: 'delivery',
      fulfilment_estimate: '2–4 demo business days', funding_source: 'vendor',
      checkout_url: 'https://www.nike.com/', product_icon: '🧣'
    }),
    makeOffer(shared, {
      offer_id: 'demo-comfort-meal-20', vendor_id: 'demo-comfort-kitchen', title: '20% off a comfort meal',
      category: 'food', description: 'A warm demo meal for a difficult match moment.',
      original_price_minor: 2400, discount_type: 'percentage', discount_value: 20, minimum_basket_minor: 2000,
      eligible_product_ids: ['demo-comfort-meal'], supported_teams: ['Arsenal', 'Chelsea'],
      supported_events: ['trailing', 'penalty_trailing', 'penalty_missed', 'loss'], supported_moods: ['comfort'],
      quantity_cap: 10, remaining_quantity: 10, fulfilment_mode: 'delivery',
      fulfilment_estimate: '25–40 demo minutes', funding_source: 'vendor',
      checkout_url: 'https://www.swiggy.com/', product_icon: '🍜'
    }),
    makeOffer(shared, {
      offer_id: 'demo-goal-snack-25', vendor_id: 'demo-comfort-kitchen', title: '25% off a goal-time snack box',
      category: 'food', description: 'A seeded celebration alternative for fans who prefer food.',
      original_price_minor: 2000, discount_type: 'percentage', discount_value: 25, minimum_basket_minor: 1500,
      eligible_product_ids: ['demo-goal-snack-box'], supported_teams: ['Arsenal', 'Chelsea'],
      supported_events: ['goal', 'penalty_scored', 'spotlight', 'win'], supported_moods: ['celebrate'],
      quantity_cap: 10, remaining_quantity: 10, fulfilment_mode: 'delivery',
      fulfilment_estimate: '25–40 demo minutes', funding_source: 'sponsor',
      checkout_url: 'https://www.swiggy.com/', product_icon: '🍿'
    }),
    makeOffer(shared, {
      offer_id: 'demo-cafe-reset-5', vendor_id: 'demo-matchday-cafe', title: '£5 off a matchday café table',
      category: 'experiences', description: 'A local demo pickup alternative for either match mood.',
      original_price_minor: 2000, discount_type: 'fixed_amount', discount_value: 500, minimum_basket_minor: 1500,
      eligible_product_ids: ['demo-cafe-table'], supported_teams: ['Arsenal', 'Chelsea'],
      supported_events: ['goal', 'penalty_scored', 'spotlight', 'win', 'trailing', 'penalty_trailing', 'penalty_missed', 'loss'],
      supported_moods: ['celebrate', 'comfort'], quantity_cap: null, remaining_quantity: null,
      fulfilment_mode: 'pickup', fulfilment_estimate: 'Ready in 20 demo minutes',
      funding_source: 'co-funded', vendor_funding_percent: 50, checkout_url: 'https://example.com/', product_icon: '☕'
    })
  ];
  const catalogue = {
    label: 'Seeded local demo catalogue',
    demo: true,
    vendors,
    products,
    offers,
    reservations: new Map(),
    reservationKeys: new Map()
  };
  const checked = validateCatalogue(catalogue);
  if (!checked.ok) throw new Error(`Invalid demo catalogue: ${checked.errors.join(' ')}`);
  return catalogue;
}

function makeOffer(shared, offer) {
  const merged = { ...shared, ...offer };
  const discountMinor = calculatePrice(merged).discount_minor;
  const maxRedemptions = merged.max_redemptions ?? merged.quantity_cap ?? 20;
  return {
    ...merged,
    vendor_funding_percent: merged.funding_source === 'vendor' ? 100 : merged.funding_source === 'sponsor' ? 0 : merged.vendor_funding_percent,
    max_redemptions: maxRedemptions,
    campaign_budget_minor: merged.campaign_budget_minor ?? discountMinor * maxRedemptions
  };
}

function validateCatalogue(catalogue) {
  const errors = [];
  if (!catalogue || !Array.isArray(catalogue.vendors) || !Array.isArray(catalogue.products) || !Array.isArray(catalogue.offers)) {
    return { ok: false, errors: ['Catalogue must contain vendor, product, and offer arrays.'] };
  }
  const vendorIds = new Set(catalogue.vendors.map(vendor => vendor.vendor_id));
  const products = new Map(catalogue.products.map(product => [product.product_id, product]));
  const ids = new Set();
  for (const offer of catalogue.offers) {
    const prefix = offer?.offer_id || 'unknown offer';
    if (!/^[a-z0-9-]{3,80}$/.test(prefix)) errors.push('Every offer needs a stable lowercase ID.');
    if (ids.has(prefix)) errors.push(`Duplicate offer ID: ${prefix}.`);
    ids.add(prefix);
    if (!vendorIds.has(offer.vendor_id)) errors.push(`${prefix} has an unknown vendor.`);
    if (!CATEGORIES.includes(offer.category)) errors.push(`${prefix} has an invalid category.`);
    if (!DISCOUNT_TYPES.includes(offer.discount_type)) errors.push(`${prefix} has an invalid discount type.`);
    if (!FUNDING_SOURCES.includes(offer.funding_source)) errors.push(`${prefix} has an invalid funding source.`);
    if (!Number.isSafeInteger(offer.vendor_funding_percent) || offer.vendor_funding_percent < 0 || offer.vendor_funding_percent > 100) errors.push(`${prefix} has an invalid vendor funding percentage.`);
    if (offer.funding_source === 'vendor' && offer.vendor_funding_percent !== 100) errors.push(`${prefix} vendor funding must be 100%.`);
    if (offer.funding_source === 'sponsor' && offer.vendor_funding_percent !== 0) errors.push(`${prefix} sponsor funding must be 0% vendor-funded.`);
    if (offer.funding_source === 'co-funded' && (offer.vendor_funding_percent <= 0 || offer.vendor_funding_percent >= 100)) errors.push(`${prefix} co-funding needs a vendor share between 1% and 99%.`);
    if (!FULFILMENT_MODES.includes(offer.fulfilment_mode)) errors.push(`${prefix} has an invalid fulfilment mode.`);
    if (!OFFER_STATUSES.includes(offer.status)) errors.push(`${prefix} has an invalid campaign status.`);
    for (const field of ['original_price_minor', 'minimum_basket_minor']) {
      if (!Number.isSafeInteger(offer[field]) || offer[field] < 0) errors.push(`${prefix} has an invalid ${field}.`);
    }
    if (!Number.isSafeInteger(offer.discount_value) || offer.discount_value <= 0) errors.push(`${prefix} has an invalid discount value.`);
    if (!Number.isSafeInteger(offer.claim_window_seconds) || offer.claim_window_seconds < 30 || offer.claim_window_seconds > 86_400) errors.push(`${prefix} has an invalid claim window.`);
    if (!Number.isSafeInteger(offer.campaign_budget_minor) || offer.campaign_budget_minor < 0 || offer.campaign_budget_minor > 100_000_000) errors.push(`${prefix} has an invalid campaign budget.`);
    if (!Number.isSafeInteger(offer.max_redemptions) || offer.max_redemptions < 1) errors.push(`${prefix} has an invalid maximum redemption count.`);
    if (offer.discount_type === 'percentage' && offer.discount_value > 100) errors.push(`${prefix} percentage discount cannot exceed 100.`);
    if (offer.discount_type === 'fixed_amount' && offer.discount_value > offer.original_price_minor) errors.push(`${prefix} fixed discount cannot exceed original price.`);
    if (!Array.isArray(offer.eligible_product_ids) || !offer.eligible_product_ids.length) errors.push(`${prefix} needs eligible products.`);
    for (const productId of offer.eligible_product_ids || []) {
      const product = products.get(productId);
      if (!product) errors.push(`${prefix} has an unknown product.`);
      else if (product.vendor_id !== offer.vendor_id || product.category !== offer.category) errors.push(`${prefix} product does not match its vendor/category.`);
      else if (product.unit_price_minor !== offer.original_price_minor) errors.push(`${prefix} original price does not match its eligible product.`);
    }
    for (const field of ['supported_teams', 'supported_events', 'supported_moods', 'supported_match_ids']) {
      if (!Array.isArray(offer[field]) || !offer[field].length) errors.push(`${prefix} needs ${field}.`);
    }
    const start = Date.parse(offer.campaign_start_at);
    const end = Date.parse(offer.campaign_end_at);
    const deadline = Date.parse(offer.claim_deadline_at);
    if (![start, end, deadline].every(Number.isFinite) || start >= end || deadline < start || deadline > end) {
      errors.push(`${prefix} has inconsistent campaign dates.`);
    }
    const tracked = offer.quantity_cap !== null || offer.remaining_quantity !== null;
    if (tracked && (!Number.isSafeInteger(offer.quantity_cap) || offer.quantity_cap < 0 || !Number.isSafeInteger(offer.remaining_quantity) || offer.remaining_quantity < 0 || offer.remaining_quantity > offer.quantity_cap)) {
      errors.push(`${prefix} has invalid tracked inventory.`);
    }
    try {
      const price = calculatePrice(offer);
      if (tracked && offer.max_redemptions > offer.quantity_cap) errors.push(`${prefix} maximum redemptions exceed inventory.`);
      if (price.discount_minor * offer.max_redemptions > offer.campaign_budget_minor) errors.push(`${prefix} maximum redemptions exceed its budget.`);
    } catch (error) { errors.push(`${prefix}: ${error.message}`); }
  }
  return { ok: errors.length === 0, errors };
}

function calculatePrice(offer) {
  if (!Number.isSafeInteger(offer?.original_price_minor) || offer.original_price_minor < 0) throw new Error('Original price must be a non-negative integer in minor units.');
  if (!Number.isSafeInteger(offer.discount_value) || offer.discount_value <= 0) throw new Error('Discount value must be a positive integer.');
  let discountMinor;
  if (offer.discount_type === 'percentage') {
    if (offer.discount_value > 100) throw new Error('Percentage discount cannot exceed 100.');
    discountMinor = Math.round(offer.original_price_minor * offer.discount_value / 100);
  } else if (offer.discount_type === 'fixed_amount') {
    if (offer.discount_value > offer.original_price_minor) throw new Error('Fixed discount cannot exceed original price.');
    discountMinor = offer.discount_value;
  } else {
    throw new Error('Unsupported discount type.');
  }
  const finalPriceMinor = offer.original_price_minor - discountMinor;
  return { original_price_minor: offer.original_price_minor, discount_minor: discountMinor, final_price_minor: finalPriceMinor };
}

function offerEligibility(offer, context = {}, now = Date.now()) {
  const reasons = [];
  if (!offer || offer.status !== 'active') reasons.push('campaign_not_active');
  if (offer && (now < Date.parse(offer.campaign_start_at) || now >= Date.parse(offer.campaign_end_at))) reasons.push('campaign_outside_window');
  if (offer && now >= Date.parse(offer.claim_deadline_at)) reasons.push('claim_deadline_elapsed');
  if (context.matchId && !offer?.supported_match_ids.includes(context.matchId)) reasons.push('unsupported_match');
  if (context.team && !offer?.supported_teams.includes(context.team)) reasons.push('unsupported_team');
  if (context.event && !offer?.supported_events.includes(context.event)) reasons.push('unsupported_event');
  if (context.mood && !offer?.supported_moods.includes(context.mood)) reasons.push('unsupported_mood');
  if (offer?.remaining_quantity !== null && offer?.remaining_quantity <= 0) reasons.push('inventory_exhausted');
  if (context.basketSubtotalMinor !== undefined && (!Number.isSafeInteger(context.basketSubtotalMinor) || context.basketSubtotalMinor < offer.minimum_basket_minor)) reasons.push('minimum_basket_not_met');
  return { eligible: reasons.length === 0, reasons };
}

function discoverOffers(catalogue, context = {}, now = Date.now()) {
  const categories = Array.isArray(context.categories) ? context.categories.filter(value => CATEGORIES.includes(value)) : [];
  const base = catalogue.offers.filter(offer => offerEligibility(offer, context, now).eligible && offerCapacity(catalogue, offer).eligible);
  const preferred = categories.length ? base.filter(offer => categories.includes(offer.category)) : base;
  const alternatives = categories.length ? base.filter(offer => !categories.includes(offer.category)) : [];
  return {
    preferred: preferred.map(offer => publicOffer(catalogue, offer)),
    alternatives: alternatives.map(offer => publicOffer(catalogue, offer)),
    rejected: catalogue.offers.filter(offer => !base.includes(offer)).map(offer => ({
      offer_id: offer.offer_id,
      reasons: [...offerEligibility(offer, context, now).reasons, ...offerCapacity(catalogue, offer).reasons]
    }))
  };
}

function reserveInventory(catalogue, input, now = Date.now()) {
  const existingId = catalogue.reservationKeys.get(input.reservation_key);
  if (existingId) return { ok: true, duplicate: true, reservation: publicReservation(catalogue.reservations.get(existingId)) };
  const offer = catalogue.offers.find(item => item.offer_id === input.offer_id);
  if (!offer) return { ok: false, code: 'unknown_offer', error: 'Offer was not found.' };
  const eligibility = offerEligibility(offer, {
    matchId: input.match_id,
    team: input.team,
    event: input.event,
    mood: input.mood,
    basketSubtotalMinor: input.basket_subtotal_minor
  }, now);
  if (!eligibility.eligible) return { ok: false, code: eligibility.reasons[0], error: eligibilityError(eligibility.reasons[0]) };
  const capacity = offerCapacity(catalogue, offer);
  if (!capacity.eligible) return { ok: false, code: capacity.reasons[0], error: eligibilityError(capacity.reasons[0]) };
  const price = calculatePrice(offer);
  // This synchronous check-and-decrement is atomic within this single Node process.
  if (offer.remaining_quantity !== null) {
    if (offer.remaining_quantity <= 0) return { ok: false, code: 'inventory_exhausted', error: eligibilityError('inventory_exhausted') };
    offer.remaining_quantity -= 1;
  }
  const reservation = {
    reservation_id: input.reservation_id,
    reservation_key: input.reservation_key,
    offer_id: offer.offer_id,
    user_id: input.user_id,
    basket_subtotal_minor: input.basket_subtotal_minor,
    original_price_minor: price.original_price_minor,
    discount_minor: price.discount_minor,
    final_price_minor: price.final_price_minor,
    currency: offer.currency,
    state: 'reserved',
    reserved_at: now,
    released_at: null,
    release_reason: null
  };
  catalogue.reservations.set(reservation.reservation_id, reservation);
  catalogue.reservationKeys.set(reservation.reservation_key, reservation.reservation_id);
  return { ok: true, duplicate: false, reservation: publicReservation(reservation) };
}

function releaseInventory(catalogue, reservationId, reason = 'user_released', now = Date.now()) {
  const reservation = catalogue.reservations.get(reservationId);
  if (!reservation) return { ok: false, code: 'unknown_reservation', error: 'Reservation was not found.' };
  if (reservation.state === 'released') return { ok: true, duplicate: true, reservation: publicReservation(reservation) };
  const offer = catalogue.offers.find(item => item.offer_id === reservation.offer_id);
  if (offer?.remaining_quantity !== null) offer.remaining_quantity = Math.min(offer.quantity_cap, offer.remaining_quantity + 1);
  reservation.state = 'released';
  reservation.released_at = now;
  reservation.release_reason = reason;
  return { ok: true, duplicate: false, reservation: publicReservation(reservation) };
}

function publicOffer(catalogue, offer) {
  const eligibleProducts = catalogue.products.filter(item => offer.eligible_product_ids.includes(item.product_id));
  const product = eligibleProducts[0];
  const vendor = catalogue.vendors.find(item => item.vendor_id === offer.vendor_id);
  return {
    ...offer,
    ...calculatePrice(offer),
    vendor_name: vendor?.name || offer.vendor_id,
    product_name: product?.name || offer.title,
    eligible_products: eligibleProducts.map(item => ({ ...item })),
    inventory_tracked: offer.remaining_quantity !== null,
    metrics: offerMetrics(catalogue, offer),
    demo: true
  };
}

function offerMetrics(catalogue, offer) {
  const price = calculatePrice(offer);
  const reservations = [...catalogue.reservations.values()].filter(item => item.offer_id === offer.offer_id && item.state === 'reserved');
  const budgetConsumedMinor = reservations.reduce((sum, item) => sum + (item.discount_minor ?? price.discount_minor), 0);
  return {
    reservation_count: reservations.length,
    budget_consumed_minor: budgetConsumedMinor,
    budget_remaining_minor: Math.max(0, offer.campaign_budget_minor - budgetConsumedMinor),
    maximum_redemptions: offer.max_redemptions
  };
}

function offerCapacity(catalogue, offer) {
  const metrics = offerMetrics(catalogue, offer);
  const reasons = [];
  if (metrics.reservation_count >= offer.max_redemptions) reasons.push('redemption_limit_reached');
  if (metrics.budget_remaining_minor < calculatePrice(offer).discount_minor) reasons.push('budget_exhausted');
  return { eligible: reasons.length === 0, reasons };
}

function publicCatalogue(catalogue) {
  return {
    label: catalogue.label,
    demo: true,
    vendors: catalogue.vendors.map(item => ({ ...item })),
    products: catalogue.products.map(item => ({ ...item })),
    offers: catalogue.offers.map(offer => publicOffer(catalogue, offer)),
    reservations: [...catalogue.reservations.values()].map(publicReservation)
  };
}

function publicReservation(reservation) { return { ...reservation }; }

function eligibilityError(reason) {
  return {
    campaign_not_active: 'This offer is not active.',
    campaign_outside_window: 'This offer is outside its campaign window.',
    claim_deadline_elapsed: 'This offer claim deadline has passed.',
    unsupported_match: 'This offer does not support this match.',
    unsupported_team: 'This offer does not support this team.',
    unsupported_event: 'This offer does not support this event.',
    unsupported_mood: 'This offer does not support this match mood.',
    inventory_exhausted: 'This tracked demo offer has no remaining inventory.',
    redemption_limit_reached: 'This campaign reached its maximum demo redemptions.',
    budget_exhausted: 'This campaign does not have enough remaining demo budget.',
    minimum_basket_not_met: 'The minimum basket for this offer has not been met.'
  }[reason] || 'This offer is not eligible.';
}

module.exports = {
  CATEGORIES,
  OFFER_STATUSES,
  createDemoCatalogue,
  validateCatalogue,
  calculatePrice,
  offerEligibility,
  discoverOffers,
  offerMetrics,
  offerCapacity,
  reserveInventory,
  releaseInventory,
  publicOffer,
  publicCatalogue
};
