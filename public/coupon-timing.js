(function exposeCouponTiming(root) {
  'use strict';
  function duration(seconds) {
    if (seconds % 3600 === 0) return `${seconds / 3600} hour${seconds === 3600 ? '' : 's'}`;
    if (seconds % 60 === 0) return `${seconds / 60} minute${seconds === 60 ? '' : 's'}`;
    return `${seconds} seconds`;
  }
  function isExpired(claim, now = Date.now()) {
    return Number.isFinite(claim.fulfilment_expires_at) && now >= claim.fulfilment_expires_at;
  }
  function policyLabel(value) {
    if (value.coupon_validity_policy === 'match_end') {
      return value.redemption_grace_seconds === 0 ? 'Use during the match · expires at full time'
        : `Use during the match and up to ${duration(value.redemption_grace_seconds)} after full time`;
    }
    return `Use within ${duration(value.fulfilment_window_seconds ?? 86400)} of claiming`;
  }
  function deadlineLabel(claim, now = Date.now()) {
    if (Number.isFinite(claim.fulfilment_expires_at)) {
      const date = new Date(claim.fulfilment_expires_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
      return `${claim.coupon_status !== 'redeemed' && isExpired(claim, now) ? 'Expired' : 'Use before'} ${date}`;
    }
    if (claim.coupon_validity_policy === 'match_end' && claim.awaiting_match_end) {
      return claim.redemption_grace_seconds === 0 ? 'Until full time · exact time pending'
        : `Until full time + ${duration(claim.redemption_grace_seconds)} · exact time pending`;
    }
    return 'Use-by time unavailable';
  }
  root.PlayPulseCouponTiming = { duration, isExpired, policyLabel, deadlineLabel };
})(globalThis);
