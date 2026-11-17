(function exposeCommerce(root) {
  'use strict';

  const money = (value, currency = 'GBP') => new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(value / 100);
  const Timing = root.PlayPulseCouponTiming;
  const statusLabels = { available: 'Ready to use', redeemed: 'Redeemed', expired: 'Expired', review_required: 'Needs review', cancelled: 'Cancelled', unavailable: 'Unavailable' };
  const categoryLabels = { food: 'Food', merchandise: 'Jerseys & merch', experiences: 'Experiences' };

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function create(options) {
    const $ = id => document.getElementById(id);
    let match = null;
    let claims = [];
    let walletReady = false;
    let loading = false;
    let refreshPending = false;
    let walletError = '';
    let category = 'all';
    let walletFilter = 'all';
    let clockOffset = 0;
    let timeSignature = '';
    const pendingClaims = new Set();
    const recordedImpressions = new Set();
    const seenMoments = new Set();
    const now = () => Date.now() + clockOffset;
    const stateOf = claim => claim.coupon_status === 'available' && Timing.isExpired(claim, now()) ? 'expired' : claim.coupon_status;
    const merchantClaim = campaign => claims.find(claim => claim.match_id === campaign.match_id && claim.vendor_id === campaign.vendor_id);

    function visibleCampaigns() {
      if (!match || !options.getTeam()) return [];
      return (match.campaigns || []).filter(campaign => campaign.targeted_team === options.getTeam()
        && root.PlayPulseMatchSentiment.allows(match.team_sentiments, campaign)
        && ['active', 'paused'].includes(campaign.state) && campaign.claim_expires_at > now()
        && root.PlayPulsePreferences.allowsDeal(options.getPreferences(), campaign)
        && (category === 'all' || campaign.offer_category === category));
    }

    function offerAvailability(campaign) {
      if (merchantClaim(campaign)) return { label: 'View saved coupon', saved: true };
      if (!options.canClaim()) return { label: 'Pool membership required', disabled: true };
      if (!walletReady) return { label: 'Load wallet to claim', disabled: true };
      if (!options.socket.connected) return { label: 'Reconnecting…', disabled: true };
      if (pendingClaims.has(campaign.campaign_id)) return { label: 'Claiming…', disabled: true };
      if (campaign.state === 'paused') return { label: 'Offer paused', disabled: true };
      const offer = campaign.eligible_offers[0];
      const eligible = root.PlayPulseOfferRanking.hardEligibility(offer, {}, now());
      if (!eligible.eligible) return { label: offer.remaining_quantity === 0 ? 'Sold out' : 'Offer unavailable', disabled: true };
      if (campaign.claim_count >= campaign.capacity) return { label: 'Claim limit reached', disabled: true };
      return { label: 'Claim offer' };
    }

    function action(label, className, handler, disabled = false) {
      const button = element('button', className, label);
      button.type = 'button';
      button.disabled = disabled;
      button.addEventListener('click', handler);
      return button;
    }

    function createOfferCard(campaign) {
      const offer = campaign.eligible_offers[0];
      const saved = merchantClaim(campaign);
      const availability = offerAvailability(campaign);
      const card = element('article', 'commerce-card offer-card');
      card.dataset.campaignId = campaign.campaign_id;
      card.dataset.vendorId = campaign.vendor_id;
      const header = element('div', 'commerce-card-head');
      header.append(element('span', 'commerce-icon', offer.product_icon), element('span', 'commerce-merchant', offer.vendor_name));
      const countdown = element('span', 'commerce-countdown');
      countdown.dataset.deadline = campaign.claim_expires_at;
      header.append(countdown);
      const price = element('div', 'commerce-price');
      price.append(element('del', '', money(offer.original_price_minor, offer.currency)), element('strong', '', money(offer.final_price_minor, offer.currency)));
      const saving = offer.discount_type === 'percentage' ? `${offer.discount_value}% off` : `${money(offer.discount_minor, offer.currency)} off`;
      price.append(element('span', 'commerce-saving', saving));
      const terms = element('p', 'commerce-terms', `${categoryLabels[offer.category]} · ${offer.fulfilment_mode} · ${offer.fulfilment_estimate}`);
      const stock = offer.inventory_tracked ? ` · ${offer.remaining_quantity} remaining` : '';
      const limit = element('p', 'commerce-terms', `One coupon per merchant per match${stock}`);
      const actions = element('div', 'commerce-actions');
      actions.append(action(availability.label, 'commerce-primary', () => saved ? options.openCoupon(saved.claim_id) : claim(campaign), availability.disabled));
      actions.append(action('Details', 'commerce-secondary', () => options.viewOffer(campaign), campaign.state !== 'active' || Boolean(saved)));
      card.append(header, element('h3', '', offer.title), price, terms, limit);
      card.append(element('p', 'commerce-terms', Timing.policyLabel(campaign)));
      if (saved) card.append(element('p', 'commerce-saved', saved.campaign_id === campaign.campaign_id ? 'Saved in your wallet' : 'You already claimed from this merchant for this match.'));
      card.append(actions);
      return card;
    }

    function renderOffers() {
      const list = $('offer-groups');
      list.replaceChildren();
      const campaigns = visibleCampaigns();
      const merchants = new Set(campaigns.map(campaign => campaign.vendor_id)).size;
      $('offers-count').textContent = `${campaigns.length} offer${campaigns.length === 1 ? '' : 's'} · ${merchants} merchant${merchants === 1 ? '' : 's'}`;
      const sentiment = match?.team_sentiments?.[options.getTeam()];
      $('offers-status').textContent = !match ? 'Connecting to the match…' : !options.getTeam() ? 'Choose and lock your club to discover its match offers.'
        : sentiment === 'comfort' ? 'A tough moment for your side. Comfort food and café offers only, within your preferences.'
        : sentiment === 'neutral' ? 'The sides are level. Waiting for the next confirmed moment. Saved coupons stay in Wallet.'
        : !campaigns.length ? 'Your side is ahead. No active celebration offers match your preferences yet.'
        : 'Your side is ahead. Celebration offers unlocked · one coupon per merchant per match.';
      if (!options.canClaim()) $('offers-status').textContent += ' Preview only · join the pool during its registration window to claim.';
      else if (!walletReady && walletError) $('offers-status').textContent = 'Your wallet could not be loaded. Refresh Wallet before claiming.';
      const groups = new Map();
      for (const campaign of [...campaigns].sort((a, b) => b.moment_sequence - a.moment_sequence)) {
        const key = `${campaign.source_event_id}:${campaign.targeted_team}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(campaign);
      }
      for (const group of groups.values()) {
        const section = element('section', 'offer-moment');
        const first = group[0];
        const event = match.timeline?.find(item => item.id === first.source_event_id);
        const heading = element('div', 'offer-moment-head');
        heading.append(element('span', 'commerce-kicker', `${event?.minute ?? match.minutes}′ · ${first.mood === 'celebrate' ? 'CELEBRATION' : 'COMFORT'} · DEMO`), element('h3', '', first.title));
        const grid = element('div', 'commerce-grid');
        for (const campaign of group) grid.append(createOfferCard(campaign));
        section.append(heading, grid);
        list.append(section);
      }
      updateCountdowns();
      recordVisibleImpressions();
    }

    function createWalletCard(savedClaim) {
      const state = stateOf(savedClaim);
      const card = element('article', 'commerce-card wallet-card');
      card.dataset.claimId = savedClaim.claim_id;
      const head = element('div', 'commerce-card-head');
      head.append(element('span', 'commerce-icon', savedClaim.product_icon), element('span', 'commerce-merchant', savedClaim.vendor_name));
      const badge = element('span', 'coupon-status', statusLabels[state] || 'Unavailable');
      badge.dataset.status = state;
      card.append(head, badge, element('h2', '', savedClaim.offer_title), element('p', 'commerce-trigger', `${savedClaim.source_event_label} · ${savedClaim.source_event_minute}′`));
      const code = element('code', 'wallet-code', savedClaim.coupon_code);
      const expiry = element('p', 'wallet-expiry', Timing.deadlineLabel(savedClaim, now()));
      const actions = element('div', 'commerce-actions');
      actions.append(action('View coupon', 'commerce-primary', () => options.openCoupon(savedClaim.claim_id)));
      if (state === 'available') actions.append(action('Copy code', 'commerce-secondary', async () => {
        try { await navigator.clipboard.writeText(savedClaim.coupon_code); options.toast('Coupon code copied'); }
        catch (_) { options.toast('Copy is unavailable. Open the coupon to select its code.'); }
      }));
      card.append(code, expiry, element('p', 'commerce-terms', `${savedClaim.fulfilment_mode} · ${savedClaim.fulfilment_estimate}`), actions);
      return card;
    }

    function renderWallet() {
      const list = $('wallet-list');
      list.replaceChildren();
      const readyCount = claims.filter(item => stateOf(item) === 'available').length;
      $('wallet-count').textContent = readyCount;
      $('wallet-count').hidden = readyCount === 0;
      $('wallet-error').hidden = !walletError;
      $('wallet-error').textContent = walletError;
      $('wallet-refresh').disabled = loading;
      const filtered = claims.filter(item => walletFilter === 'all' || (walletFilter === 'other' ? ['review_required', 'cancelled', 'unavailable'].includes(stateOf(item)) : stateOf(item) === walletFilter));
      $('wallet-summary').textContent = !walletReady ? (loading ? 'Loading your coupons…' : 'Refresh to load your coupons.') : `${claims.length} saved coupon${claims.length === 1 ? '' : 's'}. One per merchant per match.`;
      if (!filtered.length) {
        list.append(element('div', 'commerce-empty', !walletReady ? 'Your saved coupons will appear here.' : claims.length ? 'No coupons in this filter.' : 'Your wallet is waiting for its first match moment. Claim an offer from the Match tab.'));
      }
      for (const savedClaim of filtered) list.append(createWalletCard(savedClaim));
    }

    async function refreshWallet() {
      if (loading) { refreshPending = true; return; }
      const user = options.getUser();
      if (!user.ok) { walletError = user.errors.join(' '); renderWallet(); return; }
      loading = true;
      renderWallet();
      try {
        const response = await fetch(`/api/wallet?user_id=${encodeURIComponent(user.value)}`, { cache: 'no-store' });
        const data = await response.json();
        if (response.status === 401) { claims = []; walletReady = false; options.sessionExpired(); }
        if (!response.ok) throw new Error(data.error || 'Your wallet could not be loaded.');
        if (data.user_id !== user.value) { claims = []; walletReady = false; options.sessionExpired(); return; }
        // A welcome-screen reset may change browser identity while this request is running.
        if (options.getUser().value !== user.value) { refreshPending = true; return; }
        claims = data.claims;
        clockOffset = data.server_now - Date.now();
        walletReady = true;
        walletError = '';
        options.teamChoiceUpdated(data.team_choice);
        options.walletUpdated(claims);
      } catch (error) {
        walletError = `${error.message} ${walletReady ? 'Showing the last received coupons.' : 'Try refreshing.'}`;
      } finally {
        loading = false;
        render();
        if (refreshPending) { refreshPending = false; refreshWallet(); }
      }
    }

    async function claim(campaign) {
      if (!options.canClaim()) { options.toast('Join this match’s offer pool before claiming.'); return null; }
      if (pendingClaims.has(campaign.campaign_id)) return null;
      const user = options.getUser();
      if (!user.ok) { options.toast(user.errors.join(' ')); return null; }
      const saved = merchantClaim(campaign);
      if (saved) { options.toast('You already have a coupon from this merchant. Find it in Wallet.'); return null; }
      pendingClaims.add(campaign.campaign_id);
      renderOffers();
      try {
        const response = await fetch(`/api/campaigns/${encodeURIComponent(campaign.campaign_id)}/claim`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: user.value, offer_id: campaign.catalogue_offer_id, basket_subtotal_minor: campaign.eligible_offers[0].original_price_minor })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'This offer could not be claimed.');
        if (data.claim.user_id !== user.value) { options.sessionExpired(); return null; }
        claims = [data.claim, ...claims.filter(item => item.claim_id !== data.claim.claim_id)];
        walletReady = true;
        options.claimed(campaign, data.claim, data.duplicate);
        options.walletUpdated(claims);
        options.toast(data.duplicate ? 'Your coupon is already in Wallet' : 'Coupon saved to Wallet · keep exploring other merchants');
        return data.claim;
      } catch (error) {
        options.toast(error.message);
        return null;
      } finally {
        pendingClaims.delete(campaign.campaign_id);
        render();
        refreshWallet();
      }
    }

    function recordVisibleImpressions() {
      const user = options.getUser();
      if (!user.ok) return;
      for (const card of document.querySelectorAll('.offer-card')) {
        const box = card.getBoundingClientRect();
        if (!box.width || !box.height || box.bottom <= 0 || box.top >= window.innerHeight) continue;
        const key = `${user.value}:${card.dataset.campaignId}`;
        if (recordedImpressions.has(key)) continue;
        recordedImpressions.add(key);
        fetch(`/api/campaigns/${encodeURIComponent(card.dataset.campaignId)}/impressions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: user.value })
        }).then(response => { if (!response.ok) recordedImpressions.delete(key); }).catch(() => recordedImpressions.delete(key));
      }
    }

    function updateCountdowns() {
      for (const node of document.querySelectorAll('[data-deadline]')) {
        const seconds = Math.max(0, Math.ceil((Number(node.dataset.deadline) - now()) / 1000));
        node.textContent = `Claim ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      }
    }

    function render() { renderOffers(); renderWallet(); }
    function updateMatch(value) { match = value; renderOffers(); }
    function receiveMoment(data) {
      if (data.team !== options.getTeam()) return;
      const visible = data.campaigns.filter(campaign => root.PlayPulsePreferences.allowsDeal(options.getPreferences(), campaign));
      if (!visible.length) return;
      const first = visible[0];
      const key = `${data.event_id}:${first.issued_at}:${data.team}`;
      if (seenMoments.has(key)) return;
      seenMoments.add(key);
      options.momentUnlocked(key, first.title, visible.length);
    }

    for (const button of document.querySelectorAll('[data-offer-category]')) button.addEventListener('click', () => {
      category = button.dataset.offerCategory;
      for (const item of document.querySelectorAll('[data-offer-category]')) item.setAttribute('aria-pressed', String(item === button));
      renderOffers();
    });
    for (const button of document.querySelectorAll('[data-wallet-filter]')) button.addEventListener('click', () => {
      walletFilter = button.dataset.walletFilter;
      for (const item of document.querySelectorAll('[data-wallet-filter]')) item.setAttribute('aria-pressed', String(item === button));
      renderWallet();
    });
    function connect() {
      const user = options.getUser();
      if (user.ok) options.socket.emit('fan:identify', user.value, data => {
        if (data.ok) options.teamChoiceUpdated(data.team_choice);
        refreshWallet();
      });
      else refreshWallet();
    }
    options.socket.on('connect', connect);
    options.socket.on('disconnect', renderOffers);
    options.socket.on('wallet:changed', refreshWallet);
    options.socket.on('offers:activated', receiveMoment);
    options.socket.on('offers:state', renderOffers);
    $('wallet-refresh').addEventListener('click', refreshWallet);
    $('content').addEventListener('scroll', recordVisibleImpressions, { passive: true });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshWallet(); render(); } });
    setInterval(() => {
      updateCountdowns();
      const signature = `${(match?.campaigns || []).map(item => `${item.campaign_id}:${now() >= item.claim_expires_at}`).join(',')}|${claims.map(item => `${item.claim_id}:${stateOf(item)}`).join(',')}`;
      if (signature !== timeSignature) { timeSignature = signature; render(); }
    }, 1000);
    render();
    if (options.socket.connected) connect();
    else refreshWallet();

    return { updateMatch, render, refreshWallet, claim, reset() { claims = []; walletReady = false; connect(); render(); } };
  }

  root.PlayPulseCommerce = { create };
})(globalThis);
