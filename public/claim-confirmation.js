(async function showClaimConfirmation() {
  'use strict';
  const $ = id => document.getElementById(id);
  const account = await window.PlayPulseAccount.load();
  if (!account.user) { location.replace('/auth'); return; }
  const accountStorage = window.PlayPulseAccount.storageFor(account.user);
  window.PlayPulseAccount.watch(account.user);
  const claimId = new URLSearchParams(window.location.search).get('claim');
  let savedClaim = null;
  let serverTimeOffset = 0;
  let loading = false;
  let reloadPending = false;

  function showValidity() {
    if (!savedClaim) return;
    const now = Date.now() + serverTimeOffset;
    const status = savedClaim.coupon_status === 'available' && window.PlayPulseCouponTiming.isExpired(savedClaim, now)
      ? 'expired' : savedClaim.coupon_status;
    const labels = {
      available: ['Your offer is claimed.', 'Demo coupon available', 'Your claim is saved. You did not need to purchase during the offer countdown. Use the coupon before the deadline above.'],
      expired: ['Your coupon has expired.', 'Expired · cannot be used', 'The coupon use-by deadline has passed. Completing an order or redeeming this coupon is no longer allowed.'],
      redeemed: ['Your coupon was redeemed.', 'Already redeemed', 'This demo coupon has already been used and cannot be redeemed again.'],
      review_required: ['Your claim needs review.', 'Coupon unavailable · review required', 'The claim is preserved for review. Its coupon cannot be used until the issue is resolved.'],
      cancelled: ['Your coupon was cancelled.', 'Cancelled · cannot be used', 'This claim was released or its demo order was cancelled. Its coupon cannot be used.'],
      unavailable: ['Your coupon is unavailable.', 'Cannot be used', 'This demo coupon is not available to use.']
    };
    const [heading, label, explanation] = labels[status] || labels.unavailable;
    $('claim-heading').textContent = heading;
    $('claim-status').textContent = label;
    $('coupon-validity').textContent = status === 'available' && savedClaim.awaiting_match_end
      ? `${window.PlayPulseCouponTiming.policyLabel(savedClaim)}. The exact use-by time will appear when full time is confirmed.` : explanation;
  }

  function showTime(id, timestamp) {
    const date = new Date(timestamp);
    $(id).dateTime = date.toISOString();
    $(id).textContent = date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'long' });
  }

  async function loadClaim() {
    if (loading) { reloadPending = true; return; }
    loading = true;
    $('refresh-claim').disabled = true;
    try {
      if (!claimId) throw new Error('No claim reference was provided. Open a saved claim from your PlayPulse inbox.');
      const user = window.PlayPulsePredictions.getOrCreateLocalUserId(accountStorage);
      if (!user.ok) throw new Error(user.errors.join(' '));
      const response = await fetch(`/api/claims/${encodeURIComponent(claimId)}?user_id=${encodeURIComponent(user.value)}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Your saved claim could not be loaded.');
      savedClaim = data.claim;
      serverTimeOffset = data.server_now - Date.now();
      $('offer').textContent = data.offer.product_name;
      $('vendor').textContent = data.offer.vendor_name;
      $('coupon').textContent = savedClaim.coupon_code;
      $('claim').textContent = savedClaim.claim_id;
      showTime('claimed-at', savedClaim.claimed_at);
      if (Number.isFinite(savedClaim.fulfilment_expires_at)) showTime('use-by', savedClaim.fulfilment_expires_at);
      else {
        $('use-by').removeAttribute('datetime');
        $('use-by').textContent = window.PlayPulseCouponTiming.deadlineLabel(savedClaim);
      }
      $('claim-details').hidden = false;
      showValidity();
    } catch (error) {
      savedClaim = null;
      $('claim-details').hidden = true;
      $('claim-heading').textContent = 'Claim unavailable.';
      $('claim-status').textContent = error.message;
      $('coupon-validity').textContent = 'Try refreshing. Claims belong to your signed-in account and exist only for the current demo run.';
    } finally {
      loading = false;
      $('refresh-claim').disabled = false;
      if (reloadPending) { reloadPending = false; loadClaim(); }
    }
  }

  $('refresh-claim').addEventListener('click', loadClaim);
  window.addEventListener('focus', loadClaim);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadClaim(); });
  setInterval(showValidity, 1000);
  const socket = io();
  socket.on('connect', () => {
    const user = window.PlayPulsePredictions.getOrCreateLocalUserId(accountStorage);
    if (user.ok) socket.emit('fan:identify', user.value, loadClaim);
  });
  socket.on('wallet:changed', loadClaim);
  loadClaim();
})().catch(() => { document.getElementById('claim-status').textContent = 'Account services are unavailable. Please refresh.'; });
