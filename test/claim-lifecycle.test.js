'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { couponStatus, couponUseError, claimValidity } = require('../lib/claim-lifecycle');

const claim = { status: 'claimed', redemption_status: 'not_redeemed', fulfilment_expires_at: 2000 };

test('coupon validity ends exactly at its own deadline and fails closed for missing deadlines', () => {
  assert.equal(couponStatus(claim, 1999), 'available');
  assert.equal(couponUseError(claim, 1999), null);
  assert.equal(couponStatus(claim, 2000), 'expired');
  assert.match(couponUseError(claim, 2000), /expired/);
  assert.equal(couponStatus({ ...claim, fulfilment_expires_at: null }, 1000), 'expired');
});

test('redeemed, cancelled, and review claims never become available regardless of deadline', () => {
  assert.equal(couponStatus({ ...claim, redemption_status: 'redeemed' }, 3000), 'redeemed');
  assert.match(couponUseError({ ...claim, status: 'review_required' }, 1000), /review/);
  assert.equal(couponStatus({ ...claim, status: 'released', redemption_status: 'cancelled' }, 3000), 'cancelled');
  assert.equal(couponStatus({ ...claim, status: 'unknown' }, 1000), 'unavailable');
});

test('only explicitly pending match-day coupons can be available without an absolute deadline', () => {
  const validity = claimValidity({ category: 'food' }, null, 86400, 1000);
  const pending = { ...claim, ...validity };
  assert.equal(pending.fulfilment_expires_at, null);
  assert.equal(couponStatus(pending, 100000000), 'available');
  assert.equal(couponStatus({ ...pending, awaiting_match_end: false }, 1000), 'expired');
  assert.equal(couponStatus({ ...pending, redemption_grace_seconds: 86400 }, 1000), 'expired');
  assert.equal(couponStatus({ ...pending, status: 'review_required' }, 1000), 'review_required');
  assert.equal(couponStatus({ ...pending, redemption_status: 'redeemed' }, 1000), 'redeemed');
});

test('food validity uses full time while merchandise uses the successful claim time', () => {
  const food = claimValidity({ category: 'food', redemption_grace_seconds: 1800 }, 10000, 86400, 20000);
  assert.equal(food.fulfilment_expires_at, 1810000);
  assert.equal(food.awaiting_match_end, false);
  const capped = claimValidity({ category: 'food', redemption_grace_seconds: 86400 }, 10000, 86400, 20000);
  assert.equal(capped.fulfilment_expires_at, 7210000);
  const kit = claimValidity({ category: 'merchandise' }, 10000, 86400, 20000);
  assert.equal(kit.fulfilment_expires_at, 86420000);
});
