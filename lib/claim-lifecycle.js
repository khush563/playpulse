'use strict';

const MAX_FOOD_GRACE_SECONDS = 7200;

function couponPolicy(offer) {
  const matchDay = offer.category === 'food' || offer.coupon_validity_policy === 'match_end';
  const requestedGrace = offer.redemption_grace_seconds ?? MAX_FOOD_GRACE_SECONDS;
  const grace = Number.isSafeInteger(requestedGrace) ? Math.max(0, Math.min(requestedGrace, MAX_FOOD_GRACE_SECONDS)) : 0;
  return {
    coupon_validity_policy: matchDay ? 'match_end' : 'after_claim',
    redemption_grace_seconds: matchDay ? grace : null
  };
}

function claimValidity(offer, matchEndedAt, windowSeconds, claimedAt = Date.now()) {
  const policy = couponPolicy(offer);
  const matchDay = policy.coupon_validity_policy === 'match_end';
  const awaiting = matchDay && matchEndedAt === null;
  return {
    ...policy,
    awaiting_match_end: awaiting,
    match_ended_at: matchDay ? matchEndedAt : null,
    fulfilment_expires_at: matchDay ? (awaiting ? null : matchEndedAt + policy.redemption_grace_seconds * 1000) : claimedAt + windowSeconds * 1000
  };
}

// Coupon validity belongs to the saved claim, independently of its offer window.
function couponStatus(claim, now = Date.now()) {
  if (claim.redemption_status === 'redeemed') return 'redeemed';
  if (claim.status === 'released' || claim.redemption_status === 'cancelled') return 'cancelled';
  if (claim.status === 'review_required') return 'review_required';
  const awaitingMatchEnd = claim.coupon_validity_policy === 'match_end' && claim.awaiting_match_end === true
    && claim.match_ended_at === null && claim.fulfilment_expires_at === null
    && Number.isSafeInteger(claim.redemption_grace_seconds) && claim.redemption_grace_seconds >= 0 && claim.redemption_grace_seconds <= MAX_FOOD_GRACE_SECONDS;
  if (!awaitingMatchEnd && (!Number.isFinite(claim.fulfilment_expires_at) || now >= claim.fulfilment_expires_at)) return 'expired';
  return claim.status === 'claimed' && claim.redemption_status === 'not_redeemed' ? 'available' : 'unavailable';
}

function couponUseError(claim, now = Date.now()) {
  const status = couponStatus(claim, now);
  return {
    redeemed: 'This demo coupon has already been redeemed.',
    cancelled: 'This demo coupon has been cancelled.',
    review_required: 'This demo claim requires review before its coupon can be used.',
    expired: 'This demo coupon has expired. Its use-by deadline has passed.',
    unavailable: 'This demo coupon is not available to use.'
  }[status] || null;
}

module.exports = { couponStatus, couponUseError, couponPolicy, claimValidity, MAX_FOOD_GRACE_SECONDS };
