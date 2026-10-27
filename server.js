// Local mock match feed, deterministic event state machine, and flash-campaign router.
'use strict';

const express = require('express');
const http = require('node:http');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { Server } = require('socket.io');
const {
  EVENT_STATES,
  CAMPAIGN_STATES,
  transitionEvent,
  transitionCampaign,
  campaignClaimability
} = require('./lib/state-machine');
const {
  createDemoCatalogue,
  discoverOffers,
  reserveInventory,
  releaseInventory,
  publicOffer,
  publicCatalogue,
  offerMetrics
} = require('./lib/offer-catalogue');
const { validateMerchantCampaign, transitionMerchantCampaign } = require('./lib/merchant-campaigns');
const { computeMerchantAnalytics, contributionEstimate } = require('./lib/merchant-analytics');
const { buildDecisionSupport } = require('./lib/merchant-decision-support');
const {
  createWatchParty,
  joinWatchParty,
  leaveWatchParty,
  groupRewardProgress,
  publicWatchParty
} = require('./lib/watch-party');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const TEAMS = ['Arsenal', 'Chelsea'];
const OTHER_TEAM = { Arsenal: 'Chelsea', Chelsea: 'Arsenal' };
const TEAM_SLUG = { Arsenal: 'ars', Chelsea: 'che' };
const EVENT_TYPES = ['goal', 'penalty_awarded', 'penalty_scored', 'penalty_missed', 'red_card', 'half_time', 'full_time', 'postponed', 'suspended', 'spotlight'];
const TEAM_EVENT_TYPES = new Set(['goal', 'penalty_awarded', 'penalty_scored', 'penalty_missed', 'red_card', 'spotlight']);
const OVERTURNABLE_TYPES = new Set(['goal', 'penalty_scored', 'penalty_missed', 'penalty_awarded', 'red_card', 'spotlight']);
const FEATURED_PLAYER = { Arsenal: 'Bukayo Saka', Chelsea: 'Cole Palmer' };

function createFlashServer(options = {}) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { serveClient: true });
  const predictionSettings = initialPredictionConfig(options);
  const hasClaimWindowOverride = options.claimWindowSeconds !== undefined || process.env.PLAYPULSE_CLAIM_WINDOW_SECONDS !== undefined;
  const claimWindowSeconds = positiveNumber(options.claimWindowSeconds ?? process.env.PLAYPULSE_CLAIM_WINDOW_SECONDS, 300);
  const fulfilmentWindowSeconds = positiveNumber(options.fulfilmentWindowSeconds ?? process.env.PLAYPULSE_FULFILMENT_WINDOW_SECONDS, 86_400);
  const campaignCapacity = positiveInteger(options.campaignCapacity ?? process.env.PLAYPULSE_CAMPAIGN_CAPACITY, 1000);
  const match = initialMatch(predictionSettings, { claimWindowSeconds, fulfilmentWindowSeconds });
  let catalogue = createDemoCatalogue(options.catalogueNow ?? Date.now());
  const goals = { Arsenal: 0, Chelsea: 0 };
  let pendingPenalty = null;
  const eventsById = new Map();
  const processedPayloads = new Map();
  const campaigns = new Map();
  const activeDeals = new Map();
  const expiryTimers = new Map();
  const earlyBirdClaims = new Map();
  const watchParties = new Map();
  let nextDealNumber = 992;
  let nextEventNumber = 1;
  let eventSequence = 0;
  let nextMerchantCampaignNumber = 1;
  let nextWatchPartyNumber = 1;

  app.disable('x-powered-by');
  app.use(express.json({ limit: '4kb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/api/match', (_req, res) => res.set('Cache-Control', 'no-store').json({ match }));
  app.get('/api/campaigns', (_req, res) => res.set('Cache-Control', 'no-store').json({
    event_states: EVENT_STATES,
    campaign_states: CAMPAIGN_STATES,
    campaigns: [...campaigns.values()].map(publicCampaign)
  }));
  app.get('/api/catalogue', (_req, res) => res.set('Cache-Control', 'no-store').json(publicCatalogue(catalogue)));
  app.get('/api/offers', (req, res) => {
    const categories = typeof req.query.categories === 'string' ? req.query.categories.split(',').filter(Boolean) : [];
    const result = discoverOffers(catalogue, {
      matchId: req.query.match_id || match.prediction.match_id,
      team: req.query.team || undefined,
      event: req.query.event || undefined,
      mood: req.query.mood || undefined,
      categories
    });
    res.set('Cache-Control', 'no-store').json({
      catalogue: catalogue.label,
      context: { team: req.query.team || null, event: req.query.event || null, mood: req.query.mood || null, categories },
      ...result
    });
  });
  app.get('/api/merchant/dashboard', (_req, res) => {
    const offers = catalogue.offers.map(offer => publicOffer(catalogue, offer));
    const totals = offers.reduce((summary, offer) => {
      summary.budget_committed_minor += offer.metrics.budget_consumed_minor;
      summary.active_reservations += offer.metrics.reservation_count;
      if (offer.status === 'active') summary.active_campaigns += 1;
      return summary;
    }, { active_campaigns: 0, active_reservations: 0, budget_committed_minor: 0 });
    res.set('Cache-Control', 'no-store').json({
      account: { label: 'Demo merchant account', authenticated: false, demo: true },
      totals,
      vendors: catalogue.vendors,
      products: catalogue.products,
      campaigns: offers,
      transactions: [...catalogue.reservations.values()].map(item => ({ ...item }))
    });
  });
  app.get('/api/merchant/analytics', (req, res) => {
    const analytics = merchantAnalyticsSnapshot();
    if (req.query.offer_id) {
      const campaign = analytics.campaigns.find(item => item.offer_id === req.query.offer_id);
      if (!campaign) return res.status(404).json({ error: 'Campaign analytics were not found.' });
      return res.set('Cache-Control', 'no-store').json({
        ...analytics,
        totals: campaign,
        campaigns: [campaign],
        transactions: analytics.transactions.filter(item => item.offer_id === campaign.offer_id)
      });
    }
    res.set('Cache-Control', 'no-store').json(analytics);
  });
  app.post('/api/merchant/analytics/estimate', (req, res) => {
    const analytics = merchantAnalyticsSnapshot();
    const campaign = req.body?.offer_id === 'all' ? analytics.totals : analytics.campaigns.find(item => item.offer_id === req.body?.offer_id);
    if (!campaign) return res.status(404).json({ error: 'Campaign analytics were not found.' });
    const result = contributionEstimate(campaign, req.body || {});
    if (!result.ok) return res.status(400).json({ errors: result.errors });
    res.json(result);
  });

  app.post('/api/merchant/decision-support', (req, res) => {
    const offer = catalogue.offers.find(item => item.offer_id === req.body?.offer_id);
    if (!offer) return res.status(404).json({ error: 'Choose a campaign from the local catalogue.' });
    const publicData = publicOffer(catalogue, offer);
    const remainingRedemptions = Math.max(0, offer.max_redemptions - publicData.metrics.reservation_count);
    const constraintErrors = {};
    if (offer.remaining_quantity !== null && Number.isSafeInteger(req.body?.available_stock) && req.body.available_stock > offer.remaining_quantity) {
      constraintErrors.available_stock = `Available stock cannot exceed the campaign's current ${offer.remaining_quantity} units.`;
    }
    if (Number.isSafeInteger(req.body?.campaign_budget_minor) && req.body.campaign_budget_minor > publicData.metrics.budget_remaining_minor) {
      constraintErrors.campaign_budget_minor = `Available budget cannot exceed the campaign's current remaining budget of ${publicData.metrics.budget_remaining_minor} minor currency units.`;
    }
    if (Object.keys(constraintErrors).length) return res.status(400).json({ ok: false, errors: constraintErrors });
    const result = buildDecisionSupport({
      ...req.body,
      discount_minor: publicData.discount_minor,
      campaign_max_redemptions: remainingRedemptions,
      final_price_minor: publicData.final_price_minor,
      funding_source: offer.funding_source,
      vendor_funding_percent: offer.vendor_funding_percent
    }, observedSamplesForOffer(offer.offer_id));
    if (!result.ok) return res.status(400).json(result);
    res.set('Cache-Control', 'no-store').json({
      ...result,
      campaign: {
        offer_id: offer.offer_id,
        title: offer.title,
        currency: offer.currency,
        current_remaining_quantity: offer.remaining_quantity,
        current_budget_remaining_minor: publicData.metrics.budget_remaining_minor,
        current_remaining_redemptions: remainingRedemptions
      }
    });
  });

  app.post('/api/merchant/campaigns/preview', (req, res) => {
    const checked = validateMerchantCampaign(req.body, catalogue);
    if (!checked.ok) return res.status(400).json({ errors: checked.errors });
    const preview = { ...checked.value, offer_id: 'unsaved-preview' };
    res.json({ campaign: publicOffer(catalogue, preview) });
  });

  app.post('/api/merchant/campaigns', (req, res) => {
    const checked = validateMerchantCampaign(req.body, catalogue);
    if (!checked.ok) return res.status(400).json({ errors: checked.errors });
    const offer = {
      ...checked.value,
      offer_id: `merchant-campaign-${String(nextMerchantCampaignNumber++).padStart(3, '0')}`,
      status: 'scheduled',
      merchant_state_history: [{ from: null, to: 'scheduled', at: Date.now(), reason: 'merchant_created' }]
    };
    catalogue.offers.push(offer);
    broadcastCatalogueOffer(offer.offer_id);
    res.status(201).json({ campaign: publicOffer(catalogue, offer) });
  });

  app.put('/api/merchant/campaigns/:offerId', (req, res) => {
    const existing = catalogue.offers.find(offer => offer.offer_id === req.params.offerId);
    if (!existing) return res.status(404).json({ error: 'Campaign was not found.' });
    if (['cancelled', 'expired', 'exhausted'].includes(existing.status)) return res.status(409).json({ error: `A ${existing.status} campaign cannot be edited.` });
    const checked = validateMerchantCampaign(req.body, catalogue, { existing });
    if (!checked.ok) return res.status(400).json({ errors: checked.errors });
    const history = existing.merchant_state_history || [];
    Object.assign(existing, checked.value, { offer_id: existing.offer_id, status: existing.status, merchant_state_history: history });
    broadcastCatalogueOffer(existing.offer_id);
    res.json({ campaign: publicOffer(catalogue, existing) });
  });

  app.post('/api/merchant/campaigns/:offerId/state', (req, res) => {
    const offer = catalogue.offers.find(item => item.offer_id === req.params.offerId);
    if (!offer) return res.status(404).json({ error: 'Campaign was not found.' });
    const result = transitionMerchantCampaign(offer, req.body?.state, { catalogue, reason: 'demo_merchant_action' });
    if (!result.ok) return res.status(409).json({ error: result.error });
    broadcastCatalogueOffer(offer.offer_id);
    res.json({ campaign: publicOffer(catalogue, offer), duplicate: result.duplicate });
  });

  app.post('/api/events/goal', (req, res) => handleEventRequest(req, res, 'goal'));
  app.post('/api/events/penalty', (req, res) => handleEventRequest(req, res, 'penalty_awarded'));
  app.post('/api/events/penalty-result', (req, res) => {
    const outcome = req.body?.outcome;
    if (!['scored', 'missed'].includes(outcome)) return res.status(400).json({ error: 'outcome must be scored or missed' });
    handleEventRequest(req, res, outcome === 'scored' ? 'penalty_scored' : 'penalty_missed');
  });
  app.post('/api/events/spotlight', (req, res) => handleEventRequest(req, res, 'spotlight'));
  app.post('/api/events/full-time', (req, res) => handleEventRequest(req, res, 'full_time'));

  app.post('/api/match/reset', (_req, res) => {
    for (const timer of expiryTimers.values()) clearTimeout(timer);
    expiryTimers.clear();
    for (const campaign of campaigns.values()) {
      if (['scheduled', 'active', 'paused'].includes(campaign.state)) closeCampaign(campaign, 'cancelled', 'demo_reset', false);
    }
    goals.Arsenal = 0;
    goals.Chelsea = 0;
    pendingPenalty = null;
    eventsById.clear();
    processedPayloads.clear();
    campaigns.clear();
    activeDeals.clear();
    watchParties.clear();
    catalogue = createDemoCatalogue(options.catalogueNow ?? Date.now());
    eventSequence = 0;
    Object.assign(match, initialMatch(predictionSettings, { claimWindowSeconds, fulfilmentWindowSeconds }));
    io.emit('catalogue:state', { reset: true });
    io.emit('match:state', match);
    res.json({ match });
  });

  app.post('/api/simulator/event', (req, res) => {
    const started = performance.now();
    const result = applyEvent({ ...req.body, source: 'simulator' });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json({ ...eventResult(result.deals, started), event: result.event, duplicate: result.duplicate });
  });

  app.post('/api/simulator/confirm', (req, res) => {
    const started = performance.now();
    const result = confirmEvent(req.body?.event_id);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json({ ...eventResult(result.deals, started), event: result.event, duplicate: result.duplicate });
  });

  app.post('/api/simulator/ignore', (req, res) => {
    const result = ignoreEvent(req.body?.event_id);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json({ match, event: result.event });
  });

  app.post('/api/simulator/advance', (req, res) => {
    const amount = Number(req.body?.minutes);
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 15) {
      return res.status(400).json({ error: 'minutes must be a whole number from 1 to 15' });
    }
    if (['FT', 'POSTPONED', 'SUSPENDED'].includes(match.status)) {
      return res.status(409).json({ error: `Cannot advance time while match status is ${match.status}.` });
    }
    match.minutes = Math.min(90, match.minutes + amount);
    io.emit('match:state', match);
    res.json({ match, advanced_by: amount });
  });

  app.post('/api/simulator/duplicate', (req, res) => {
    const payload = processedPayloads.get(req.body?.event_id);
    if (!payload) return res.status(404).json({ error: 'No processed event exists with that event ID.' });
    const started = performance.now();
    const result = applyEvent(payload);
    res.json({ ...eventResult(result.deals, started), event: result.event, duplicate: true });
  });

  app.post('/api/simulator/overturn', (req, res) => {
    const started = performance.now();
    const result = overturnEvent(req.body?.event_id);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json({ ...eventResult([], started), event: result.event, overturned_event: result.overturnedEvent });
  });

  app.post('/api/campaigns/:campaignId/claim', (req, res) => {
    const result = claimCampaign(req.params.campaignId, {
      userId: req.body?.user_id,
      offerId: req.body?.offer_id,
      basketSubtotalMinor: req.body?.basket_subtotal_minor
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error, campaign: result.campaign || null });
    res.json({ claim: result.claim, campaign: result.campaign, duplicate: result.duplicate });
  });

  app.post('/api/campaigns/:campaignId/impressions', (req, res) => {
    const userId = req.body?.user_id;
    if (!validLocalUserId(userId)) return res.status(400).json({ error: 'A valid local user identifier is required.' });
    const campaign = campaigns.get(req.params.campaignId);
    if (!campaign) return res.status(404).json({ error: 'Campaign was not found.' });
    const offerId = req.body?.offer_id || campaign.catalogue_offer_id;
    if (!campaign.eligible_offers.some(offer => offer.offer_id === offerId)) return res.status(400).json({ error: 'Offer is not eligible for this campaign.' });
    const key = `${userId}:${offerId}`;
    const existing = campaign.impressions.get(key);
    if (existing) return res.json({ impression: { ...existing }, duplicate: true });
    const impression = { impression_id: `${campaign.campaign_id}:${key}`, campaign_id: campaign.campaign_id, offer_id: offerId, user_id: userId, viewed_at: Date.now() };
    campaign.impressions.set(key, impression);
    io.emit('analytics:state', { offer_id: offerId });
    res.status(201).json({ impression: { ...impression }, duplicate: false });
  });

  app.post('/api/reservations/:reservationId/release', (req, res) => {
    const userId = req.body?.user_id;
    if (!validLocalUserId(userId)) return res.status(400).json({ error: 'A valid local user identifier is required.' });
    const claim = findClaimByReservation(req.params.reservationId);
    if (!claim || claim.user_id !== userId) return res.status(404).json({ error: 'Reservation was not found for this local user.' });
    const released = releaseInventory(catalogue, req.params.reservationId, 'local_user_release');
    if (!released.ok) return res.status(409).json({ error: released.error });
    if (claim.status !== 'released') {
      claim.status_history.push({ from: claim.status, to: 'released', at: Date.now(), reason: 'local_user_release' });
      claim.status = 'released';
      claim.redemption_status = 'cancelled';
    }
    refreshAllCampaignOffers(claim.offer_id);
    io.emit('catalogue:state', { offer_id: claim.offer_id });
    io.emit('analytics:state', { offer_id: claim.offer_id });
    io.emit('match:state', match);
    res.json({ reservation: released.reservation, claim: publicClaim(claim), duplicate: released.duplicate });
  });

  app.post('/api/merchant/claims/:claimId/order', (req, res) => {
    const found = findClaimById(req.params.claimId);
    if (!found) return res.status(404).json({ error: 'Demo claim was not found.' });
    const { claim, campaign } = found;
    const action = req.body?.action;
    const now = Date.now();
    let duplicate = false;
    if (action === 'complete_order') {
      if (claim.order_status === 'completed') duplicate = true;
      else if (claim.order_status !== 'none' || claim.status !== 'claimed') return res.status(409).json({ error: 'Only an active claim without an order can become a completed demo order.' });
      else {
        claim.order_id = `order-${claim.coupon_code.slice(3).toLowerCase()}`;
        claim.order_status = 'completed';
        claim.order_value_minor = claim.final_price_minor;
        claim.ordered_at = now;
        claim.order_history.push({ from: 'none', to: 'completed', at: now, reason: 'demo_merchant_completed_order' });
      }
    } else if (action === 'redeem') {
      if (claim.redemption_status === 'redeemed') duplicate = true;
      else if (claim.order_status !== 'completed' || claim.redemption_status !== 'not_redeemed') return res.status(409).json({ error: 'Only a completed demo order can be redeemed.' });
      else {
        claim.redemption_status = 'redeemed';
        claim.redeemed_at = now;
        claim.status_history.push({ from: claim.status, to: claim.status, at: now, reason: 'demo_coupon_redeemed' });
      }
    } else if (action === 'cancel_order') {
      if (claim.order_status === 'cancelled') duplicate = true;
      else if (claim.order_status !== 'completed' || claim.redemption_status !== 'not_redeemed') return res.status(409).json({ error: 'Only a completed, unredeemed demo order can be cancelled.' });
      else {
        const released = releaseInventory(catalogue, claim.reservation_id, 'demo_order_cancelled', now);
        if (!released.ok) return res.status(409).json({ error: released.error });
        claim.order_history.push({ from: 'completed', to: 'cancelled', at: now, reason: 'demo_merchant_cancelled_order' });
        claim.order_status = 'cancelled';
        claim.cancelled_at = now;
        claim.status_history.push({ from: claim.status, to: 'released', at: now, reason: 'demo_order_cancelled' });
        claim.status = 'released';
        claim.redemption_status = 'cancelled';
      }
    } else return res.status(400).json({ error: 'action must be complete_order, redeem, or cancel_order' });
    refreshAllCampaignOffers(claim.offer_id);
    syncCampaignSnapshot(campaign);
    io.emit('catalogue:state', { offer_id: claim.offer_id });
    io.emit('analytics:state', { offer_id: claim.offer_id });
    io.emit('match:state', match);
    res.json({ claim: publicClaim(claim), duplicate });
  });

  app.post('/api/predictions/window', (req, res) => {
    const state = req.body?.state;
    if (!['open', 'locked'].includes(state)) return res.status(400).json({ error: 'state must be open or locked' });
    match.prediction.window_state = state;
    io.emit('match:state', match);
    res.json({ prediction: match.prediction });
  });

  app.post('/api/rewards/early-bird/claim', (req, res) => {
    const matchId = req.body?.match_id;
    const userId = req.body?.user_id;
    if (matchId !== match.prediction.match_id) return res.status(400).json({ error: 'Unknown demo match.' });
    if (!validLocalUserId(userId)) return res.status(400).json({ error: 'A valid local user identifier is required.' });
    if (earlyBirdClaims.has(userId)) return res.json({ granted: true, status: 'already_claimed', label: match.prediction.reward_label });
    if (earlyBirdClaims.size >= match.prediction.reward_cap) return res.json({ granted: false, status: 'cap_reached', label: match.prediction.reward_label });
    earlyBirdClaims.set(userId, { matchId, claimedAt: Date.now() });
    res.json({ granted: true, status: 'granted', label: match.prediction.reward_label });
  });

  app.post('/api/watch-parties', (req, res) => {
    let code;
    do { code = `PP-${String(nextWatchPartyNumber++).padStart(3, '0')}`; } while (watchParties.has(code));
    const result = createWatchParty(watchParties, req.body || {}, { code });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    const reward = watchPartyReward(result.group);
    res.status(result.status).json({ group: publicWatchParty(result.group, { userId: req.body.user_id, reward }) });
  });

  app.get('/api/watch-parties/:code', (req, res) => {
    const group = watchParties.get(String(req.params.code || '').toUpperCase());
    if (!group) return res.status(404).json({ error: 'Local watch party was not found.' });
    const reward = watchPartyReward(group);
    res.set('Cache-Control', 'no-store').json({ group: publicWatchParty(group, { userId: req.query.user_id, reward }) });
  });

  app.post('/api/watch-parties/:code/join', (req, res) => {
    const result = joinWatchParty(watchParties, req.params.code, req.body || {});
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    const reward = watchPartyReward(result.group);
    res.json({ group: publicWatchParty(result.group, { userId: req.body.user_id, reward }), duplicate: result.duplicate });
  });

  app.post('/api/watch-parties/:code/leave', (req, res) => {
    const result = leaveWatchParty(watchParties, req.params.code, req.body || {});
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    const reward = watchPartyReward(result.group);
    res.json({ group: publicWatchParty(result.group, { userId: req.body.user_id, reward }), duplicate: result.duplicate });
  });

  app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

  io.on('connection', socket => {
    socket.emit('match:state', match);
    socket.on('fan:select', async (team, acknowledge) => {
      if (!TEAMS.includes(team)) {
        acknowledge?.({ error: 'Choose Arsenal or Chelsea.' });
        return;
      }
      if (socket.data.team) await socket.leave(room(socket.data.team));
      socket.data.team = team;
      await socket.join(room(team));
      acknowledge?.({ team });
      const deal = currentDeal(team);
      if (deal) socket.emit('deal:flash', publicDeal(deal));
    });
    socket.on('fan:clear', async acknowledge => {
      if (socket.data.team) await socket.leave(room(socket.data.team));
      socket.data.team = null;
      acknowledge?.({ team: null });
    });
  });

  function handleEventRequest(req, res, type) {
    const started = performance.now();
    const result = applyEvent({
      event_id: req.body?.event_id || `manual-${type}-${String(nextEventNumber++).padStart(3, '0')}`,
      type,
      team: req.body?.team ?? null,
      player: req.body?.player ?? null,
      minute: req.body?.minute,
      lifecycle_state: 'confirmed',
      source: 'manual_demo'
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json({ ...eventResult(result.deals, started), event: result.event, duplicate: result.duplicate });
  }

  function eventResult(deals, started) {
    return { match, deals: deals.map(publicDeal), processing_ms: Math.round((performance.now() - started) * 100) / 100 };
  }

  function applyEvent(input) {
    const checked = validateEvent(input);
    if (!checked.ok) return checked;
    const { eventId, team, player, eventMinute, lifecycleState } = checked;
    if (eventsById.has(eventId)) return { ok: true, duplicate: true, event: eventsById.get(eventId), deals: [] };
    if (['FT', 'POSTPONED', 'SUSPENDED'].includes(match.status) && input.source !== 'simulator') {
      return { ok: false, status: 409, error: `Match status is ${match.status}. Reset the demo before adding another event.` };
    }

    const now = Date.now();
    const event = {
      id: eventId,
      sequence: ++eventSequence,
      minute: eventMinute,
      type: input.type,
      team,
      player,
      label: eventLabel(input.type, team, player),
      state: 'detected',
      status: 'detected',
      state_history: [{ from: null, to: 'detected', at: now, reason: 'event_received' }],
      detected_at: now,
      confirmed_at: null,
      delayed: eventMinute < match.minutes,
      match_status: match.status,
      offer_state: 'none',
      offers: [],
      source: input.source === 'simulator' ? 'simulator' : 'manual_demo'
    };
    eventsById.set(eventId, event);
    processedPayloads.set(eventId, { ...input, event_id: eventId, team, player, minute: eventMinute });
    match.timeline.push(event);
    match.timeline.sort(compareTimelineEvents);

    if (['FT', 'POSTPONED', 'SUSPENDED'].includes(match.status)) {
      transitionEvent(event, 'ignored', { at: now, reason: `match_${match.status.toLowerCase()}` });
      event.offer_state = 'ignored';
      publishEvent(event);
      return { ok: true, duplicate: false, event, deals: [] };
    }
    if (lifecycleState === 'pending_confirmation') {
      transitionEvent(event, 'pending_confirmation', { at: now, reason: 'awaiting_authoritative_confirmation' });
      event.offer_state = 'blocked_until_confirmed';
      publishEvent(event);
      return { ok: true, duplicate: false, event, deals: [] };
    }
    if (lifecycleState === 'ignored') {
      transitionEvent(event, 'ignored', { at: now, reason: 'simulator_marked_irrelevant' });
      event.offer_state = 'ignored';
      publishEvent(event);
      return { ok: true, duplicate: false, event, deals: [] };
    }
    if (lifecycleState === 'detected') {
      event.offer_state = 'blocked_until_confirmed';
      publishEvent(event);
      return { ok: true, duplicate: false, event, deals: [] };
    }
    return confirmEventInternal(event);
  }

  function validateEvent(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, status: 400, error: 'Event payload must be an object.' };
    const eventId = typeof input.event_id === 'string' ? input.event_id.trim() : '';
    if (!/^[a-zA-Z0-9:_-]{3,80}$/.test(eventId)) return { ok: false, status: 400, error: 'event_id must be 3-80 letters, numbers, colons, underscores, or hyphens.' };
    if (!EVENT_TYPES.includes(input.type)) return { ok: false, status: 400, error: `type must be one of: ${EVENT_TYPES.join(', ')}` };
    const lifecycleState = input.lifecycle_state || 'confirmed';
    if (!['detected', 'pending_confirmation', 'confirmed', 'ignored'].includes(lifecycleState)) {
      return { ok: false, status: 400, error: 'lifecycle_state must be detected, pending_confirmation, confirmed, or ignored.' };
    }
    const team = input.team ?? null;
    if (TEAM_EVENT_TYPES.has(input.type) && !TEAMS.includes(team)) return { ok: false, status: 400, error: 'team must be Arsenal or Chelsea' };
    const player = input.player ?? null;
    if (player !== null && team && player !== FEATURED_PLAYER[team]) return { ok: false, status: 400, error: `player must be ${FEATURED_PLAYER[team]} for ${team}` };
    if (input.type === 'spotlight' && !player) return { ok: false, status: 400, error: 'player is required for a spotlight event' };
    const suppliedMinute = input.minute === undefined || input.minute === null ? match.minutes : Number(input.minute);
    if (!Number.isSafeInteger(suppliedMinute) || suppliedMinute < 0 || suppliedMinute > 130) return { ok: false, status: 400, error: 'minute must be a whole number from 0 to 130' };
    const eventMinute = input.type === 'full_time' ? 90 : input.type === 'half_time' ? Math.max(45, suppliedMinute) : suppliedMinute;
    return { ok: true, eventId, team, player, eventMinute, lifecycleState };
  }

  function confirmEvent(eventId) {
    if (typeof eventId !== 'string' || !eventId) return { ok: false, status: 400, error: 'event_id is required.' };
    const event = eventsById.get(eventId);
    if (!event) return { ok: false, status: 404, error: 'Event was not found.' };
    if (event.state === 'confirmed') return { ok: true, duplicate: true, event, deals: [] };
    if (!['detected', 'pending_confirmation'].includes(event.state)) return { ok: false, status: 409, error: `Cannot confirm an event in ${event.state} state.` };
    if (['FT', 'POSTPONED', 'SUSPENDED'].includes(match.status)) {
      transitionEvent(event, 'ignored', { reason: `confirmation_blocked_match_${match.status.toLowerCase()}` });
      event.offer_state = 'ignored';
      publishEvent(event);
      return { ok: true, duplicate: false, event, deals: [] };
    }
    return confirmEventInternal(event);
  }

  function confirmEventInternal(event) {
    const relationshipError = validateConfirmedRelationship(event);
    if (relationshipError) return { ok: false, status: relationshipError.status, error: relationshipError.error };
    try {
      transitionEvent(event, 'confirmed', { reason: 'deterministic_confirmation' });
    } catch (error) {
      return { ok: false, status: 409, error: error.message };
    }
    event.confirmed_at = Date.now();
    const deals = applyConfirmedEffect(event);
    publishEvent(event);
    return { ok: true, duplicate: false, event, deals };
  }

  function validateConfirmedRelationship(event) {
    if (pendingPenalty && !['penalty_scored', 'penalty_missed'].includes(event.type)) return { status: 409, error: 'Resolve the pending penalty first.' };
    if (['penalty_scored', 'penalty_missed'].includes(event.type)) {
      if (!pendingPenalty) return { status: 409, error: 'Award a penalty before recording its result.' };
      if (event.team !== pendingPenalty.team) return { status: 400, error: `Pending penalty belongs to ${pendingPenalty.team}` };
      event.player = pendingPenalty.player;
      event.label = eventLabel(event.type, event.team, event.player);
    }
    if (event.type === 'full_time' && pendingPenalty) return { status: 409, error: 'Resolve the pending penalty first.' };
    return null;
  }

  function applyConfirmedEffect(event) {
    const deals = [];
    const { type, team, player, id: eventId } = event;
    match.minutes = Math.max(match.minutes, Math.min(90, event.minute));
    if (match.status === 'HT' && !['half_time', 'postponed', 'suspended'].includes(type)) match.status = 'LIVE';
    if (type === 'goal') {
      goals[team] += 1;
      updateScore();
      deals.push(issueDeal(team, 'celebrate', 'goal', player, eventId));
      const opponent = OTHER_TEAM[team];
      if (goals[opponent] < goals[team]) deals.push(issueDeal(opponent, 'comfort', 'trailing', null, eventId));
    } else if (type === 'penalty_awarded') {
      pendingPenalty = { team, player, event_id: eventId };
      match.pending_penalty = { team, player };
      cancelAllActiveCampaigns('penalty_attention_window');
      event.offer_state = 'waiting_for_result';
    } else if (type === 'penalty_scored') {
      pendingPenalty = null;
      match.pending_penalty = null;
      goals[team] += 1;
      updateScore();
      deals.push(issueDeal(team, 'celebrate', 'penalty_scored', player, eventId));
      const opponent = OTHER_TEAM[team];
      if (goals[opponent] < goals[team]) deals.push(issueDeal(opponent, 'comfort', 'penalty_trailing', null, eventId));
    } else if (type === 'penalty_missed') {
      pendingPenalty = null;
      match.pending_penalty = null;
      deals.push(issueDeal(team, 'comfort', 'penalty_missed', player, eventId));
    } else if (type === 'half_time') {
      match.status = 'HT';
      match.minutes = Math.max(45, match.minutes);
    } else if (type === 'full_time') {
      match.status = 'FT';
      match.minutes = 90;
      cancelAllActiveCampaigns('final_whistle');
      const winner = goals.Arsenal === goals.Chelsea ? null : (goals.Arsenal > goals.Chelsea ? 'Arsenal' : 'Chelsea');
      if (winner) {
        deals.push(issueDeal(winner, 'celebrate', 'win', null, eventId));
        deals.push(issueDeal(OTHER_TEAM[winner], 'comfort', 'loss', null, eventId));
      }
    } else if (type === 'postponed') {
      match.status = 'POSTPONED';
      pendingPenalty = null;
      match.pending_penalty = null;
      cancelAllActiveCampaigns('match_postponed');
    } else if (type === 'suspended') {
      match.status = 'SUSPENDED';
      pendingPenalty = null;
      match.pending_penalty = null;
      pauseAllActiveCampaigns('match_suspended');
    } else if (type === 'spotlight') {
      deals.push(issueDeal(team, 'celebrate', 'spotlight', player, eventId));
    }
    event.match_status = match.status;
    event.offers = deals.map(deal => ({ campaign_id: deal.campaign_id, deal_id: deal.deal_id, team: deal.targeted_team, mood: deal.mood, state: deal.state }));
    if (deals.length) event.offer_state = 'active';
    return deals;
  }

  function ignoreEvent(eventId) {
    if (typeof eventId !== 'string' || !eventId) return { ok: false, status: 400, error: 'event_id is required.' };
    const event = eventsById.get(eventId);
    if (!event) return { ok: false, status: 404, error: 'Event was not found.' };
    if (!['detected', 'pending_confirmation'].includes(event.state)) return { ok: false, status: 409, error: `Cannot ignore an event in ${event.state} state.` };
    transitionEvent(event, 'ignored', { reason: 'operator_ignored' });
    event.offer_state = 'ignored';
    publishEvent(event);
    return { ok: true, event };
  }

  function overturnEvent(eventId) {
    if (typeof eventId !== 'string' || !eventId) return { ok: false, status: 400, error: 'event_id is required.' };
    const original = eventsById.get(eventId);
    if (!original) return { ok: false, status: 404, error: 'Event was not found.' };
    if (original.state === 'overturned') return { ok: false, status: 409, error: 'Event is already overturned.' };
    if (!OVERTURNABLE_TYPES.has(original.type)) return { ok: false, status: 409, error: 'This event type cannot be overturned in the demo.' };
    if (!['detected', 'pending_confirmation', 'confirmed'].includes(original.state)) return { ok: false, status: 409, error: `Cannot overturn an event in ${original.state} state.` };
    const wasConfirmed = original.state === 'confirmed';
    if (wasConfirmed && (original.type === 'goal' || original.type === 'penalty_scored')) {
      goals[original.team] = Math.max(0, goals[original.team] - 1);
      updateScore();
    }
    if (wasConfirmed && original.type === 'penalty_awarded' && pendingPenalty?.event_id === original.id) {
      pendingPenalty = null;
      match.pending_penalty = null;
    }
    for (const offer of original.offers) {
      const campaign = campaigns.get(offer.campaign_id || offer.deal_id);
      if (campaign && ['scheduled', 'active', 'paused'].includes(campaign.state)) closeCampaign(campaign, 'cancelled', 'source_event_overturned', false);
      offer.state = campaign?.state || 'cancelled';
    }
    transitionEvent(original, 'overturned', { reason: wasConfirmed ? 'confirmed_decision_reversed' : 'unconfirmed_decision_reversed' });
    original.offer_state = original.offers.length ? 'cancelled' : 'none';
    const now = Date.now();
    const overturnId = uniqueOverturnId(eventId);
    const event = {
      id: overturnId,
      sequence: ++eventSequence,
      minute: match.minutes,
      type: 'overturn',
      team: original.team,
      player: original.player,
      label: `OVERTURNED: ${original.label}`,
      state: 'confirmed',
      status: 'confirmed',
      state_history: [
        { from: null, to: 'detected', at: now, reason: 'overturn_received' },
        { from: 'detected', to: 'confirmed', at: now, reason: 'deterministic_confirmation' }
      ],
      detected_at: now,
      confirmed_at: now,
      delayed: false,
      match_status: match.status,
      offer_state: original.offers.length ? 'cancelled' : 'none',
      offers: [],
      related_event_id: original.id,
      source: 'simulator'
    };
    eventsById.set(overturnId, event);
    match.timeline.push(event);
    match.timeline.sort(compareTimelineEvents);
    publishEvent(event);
    return { ok: true, event, overturnedEvent: original };
  }

  function issueDeal(team, mood, source, player = null, sourceEventId = null) {
    const old = activeDeals.get(team);
    if (old) closeCampaign(old, 'cancelled', 'superseded_by_new_campaign', false);
    const issuedAt = Date.now();
    const discovered = discoverOffers(catalogue, {
      matchId: match.prediction.match_id,
      team,
      event: source,
      mood
    }, issuedAt);
    const eligibleOffers = [...discovered.preferred, ...discovered.alternatives];
    const preferredCategory = mood === 'celebrate' ? 'merchandise' : 'food';
    const primary = eligibleOffers.find(offer => offer.category === preferredCategory) || eligibleOffers[0];
    if (!primary) return null;
    const effectiveClaimWindowSeconds = hasClaimWindowOverride ? claimWindowSeconds : (primary.claim_window_seconds || claimWindowSeconds);
    const title = source === 'goal' ? (player ? `GOAL! ${player} scores for ${team}!` : `GOAL! ${team} Scores!`) :
      source === 'penalty_scored' ? (player ? `GOAL! ${player} converts!` : `GOAL! ${team} converts!`) :
      source === 'penalty_missed' ? `A tough penalty for ${team}` :
      source === 'spotlight' ? `All eyes on ${player}!` :
      source === 'win' ? `${team} wins!` :
      source === 'loss' ? `A tough finish for ${team}` : `A tough moment for ${team}`;
    const id = `${TEAM_SLUG[team]}-${mood}-${nextDealNumber++}`;
    const campaign = {
      campaign_id: id,
      deal_id: id,
      title,
      description: primary.description,
      checkout_url: primary.checkout_url,
      targeted_team: team,
      mood,
      event_type: source,
      player_name: player,
      spotlight: source === 'spotlight',
      source_event_id: sourceEventId,
      catalogue_offer_id: primary.offer_id,
      eligible_offers: eligibleOffers,
      offer_category: primary.category,
      product_name: primary.product_name,
      product_label: `DEMO · ${discountLabel(primary)} · ${formatMinor(primary.final_price_minor, primary.currency)}`,
      product_icon: primary.product_icon,
      vendor_id: primary.vendor_id,
      vendor_name: primary.vendor_name,
      original_price_minor: primary.original_price_minor,
      discount_type: primary.discount_type,
      discount_value: primary.discount_value,
      discount_minor: primary.discount_minor,
      final_price_minor: primary.final_price_minor,
      currency: primary.currency,
      minimum_basket_minor: primary.minimum_basket_minor,
      quantity_cap: primary.quantity_cap,
      remaining_quantity: primary.remaining_quantity,
      inventory_tracked: primary.inventory_tracked,
      fulfilment_mode: primary.fulfilment_mode,
      fulfilment_estimate: primary.fulfilment_estimate,
      funding_source: primary.funding_source,
      state: 'scheduled',
      state_history: [{ from: null, to: 'scheduled', at: issuedAt, reason: 'confirmed_event_rule_matched' }],
      issued_at: issuedAt,
      claim_window_seconds: effectiveClaimWindowSeconds,
      expires_in_seconds: effectiveClaimWindowSeconds,
      claim_expires_at: Math.min(issuedAt + effectiveClaimWindowSeconds * 1000, Date.parse(primary.claim_deadline_at)),
      expires_at: Math.min(issuedAt + effectiveClaimWindowSeconds * 1000, Date.parse(primary.claim_deadline_at)),
      fulfilment_window_seconds: fulfilmentWindowSeconds,
      capacity: campaignCapacity,
      claim_count: 0,
      claims: new Map(),
      impressions: new Map(),
      paused_remaining_ms: null
    };
    campaigns.set(id, campaign);
    transitionCampaign(campaign, 'active', { at: issuedAt, reason: 'confirmed_event_activated' });
    activeDeals.set(team, campaign);
    syncCampaignSnapshot(campaign);
    scheduleCampaignExpiry(campaign);
    io.to(room(team)).emit('deal:flash', publicDeal(campaign));
    return campaign;
  }

  function claimCampaign(campaignId, input) {
    const userId = input.userId;
    if (!validLocalUserId(userId)) return { ok: false, status: 400, error: 'A valid local user identifier is required.' };
    const campaign = campaigns.get(campaignId);
    if (!campaign) return { ok: false, status: 404, error: 'Campaign was not found.' };
    const existing = campaign.claims.get(userId);
    if (existing) return { ok: true, duplicate: true, claim: publicClaim(existing), campaign: publicCampaign(campaign) };
    const now = Date.now();
    const eligibility = campaignClaimability(campaign, now);
    if (!eligibility.claimable) {
      if (eligibility.reason === 'claim_window_elapsed' && campaign.state === 'active') closeCampaign(campaign, 'expired', eligibility.reason);
      return { ok: false, status: 409, error: claimError(eligibility.reason), campaign: publicCampaign(campaign) };
    }
    const selectedOffer = campaign.eligible_offers.find(offer => offer.offer_id === (input.offerId || campaign.catalogue_offer_id));
    if (!selectedOffer) return { ok: false, status: 400, error: 'Choose an eligible catalogue offer from this campaign.', campaign: publicCampaign(campaign) };
    const basketSubtotalMinor = input.basketSubtotalMinor === undefined || input.basketSubtotalMinor === null
      ? selectedOffer.original_price_minor
      : Number(input.basketSubtotalMinor);
    const reservationId = `reservation-${deterministicCouponCode(campaign.campaign_id, userId).slice(3).toLowerCase()}`;
    const reserved = reserveInventory(catalogue, {
      reservation_id: reservationId,
      reservation_key: `${campaign.campaign_id}:${userId}`,
      offer_id: selectedOffer.offer_id,
      user_id: userId,
      match_id: match.prediction.match_id,
      team: campaign.targeted_team,
      event: campaign.event_type,
      mood: campaign.mood,
      basket_subtotal_minor: basketSubtotalMinor
    }, now);
    if (!reserved.ok) {
      refreshAllCampaignOffers(selectedOffer.offer_id);
      return { ok: false, status: 409, error: reserved.error, campaign: publicCampaign(campaign) };
    }
    const currentOffer = publicOffer(catalogue, catalogue.offers.find(offer => offer.offer_id === selectedOffer.offer_id));
    const claim = {
      claim_id: `${campaign.campaign_id}:${userId}`,
      coupon_code: deterministicCouponCode(campaign.campaign_id, userId),
      reservation_id: reserved.reservation.reservation_id,
      offer_id: currentOffer.offer_id,
      vendor_id: currentOffer.vendor_id,
      user_id: userId,
      status: 'claimed',
      redemption_status: 'not_redeemed',
      claimed_at: now,
      fulfilment_expires_at: now + fulfilmentWindowSeconds * 1000,
      fulfilment_mode: currentOffer.fulfilment_mode,
      fulfilment_estimate: currentOffer.fulfilment_estimate,
      basket_subtotal_minor: basketSubtotalMinor,
      original_price_minor: currentOffer.original_price_minor,
      discount_minor: currentOffer.discount_minor,
      final_price_minor: currentOffer.final_price_minor,
      currency: currentOffer.currency,
      funding_source: currentOffer.funding_source,
      vendor_funding_percent: currentOffer.vendor_funding_percent,
      order_id: null,
      order_status: 'none',
      order_value_minor: null,
      ordered_at: null,
      cancelled_at: null,
      redeemed_at: null,
      order_history: [],
      status_history: [{ from: null, to: 'claimed', at: now, reason: 'eligible_claim' }]
    };
    campaign.claims.set(userId, claim);
    campaign.claim_count += 1;
    if (campaign.claim_count >= campaign.capacity) closeCampaign(campaign, 'exhausted', 'capacity_reached', false);
    refreshAllCampaignOffers(currentOffer.offer_id);
    syncCampaignSnapshot(campaign);
    io.to(room(campaign.targeted_team)).emit('campaign:state', publicCampaign(campaign));
    io.emit('catalogue:state', { offer_id: currentOffer.offer_id });
    io.emit('analytics:state', { offer_id: currentOffer.offer_id });
    io.emit('match:state', match);
    return { ok: true, duplicate: false, claim: publicClaim(claim), campaign: publicCampaign(campaign) };
  }

  function pauseAllActiveCampaigns(reason) {
    for (const campaign of [...activeDeals.values()]) {
      if (campaign.state !== 'active') continue;
      campaign.paused_remaining_ms = Math.max(0, campaign.claim_expires_at - Date.now());
      closeCampaign(campaign, 'paused', reason, false);
    }
  }

  function cancelAllActiveCampaigns(reason) {
    for (const campaign of [...activeDeals.values()]) closeCampaign(campaign, 'cancelled', reason, false);
  }

  function closeCampaign(campaign, nextState, reason, broadcast = true) {
    if (!campaign || !['scheduled', 'active', 'paused'].includes(campaign.state)) return false;
    const timer = expiryTimers.get(campaign.campaign_id);
    if (timer) clearTimeout(timer);
    expiryTimers.delete(campaign.campaign_id);
    transitionCampaign(campaign, nextState, { reason });
    if (activeDeals.get(campaign.targeted_team)?.campaign_id === campaign.campaign_id) activeDeals.delete(campaign.targeted_team);
    if (nextState === 'cancelled' && campaign.claims.size) {
      for (const claim of campaign.claims.values()) {
        if (claim.status !== 'claimed') continue;
        claim.status_history.push({ from: claim.status, to: 'review_required', at: Date.now(), reason });
        claim.status = 'review_required';
      }
    }
    updateOfferReference(campaign);
    syncCampaignSnapshot(campaign);
    notifyCampaignClosed(campaign, nextState, reason);
    if (broadcast) io.emit('match:state', match);
    return true;
  }

  function notifyCampaignClosed(campaign, state, reason) {
    io.to(room(campaign.targeted_team)).emit('campaign:state', { ...publicCampaign(campaign), reason });
    io.to(room(campaign.targeted_team)).emit('deal:expired', { deal_id: campaign.deal_id, campaign_id: campaign.campaign_id, issued_at: campaign.issued_at, state, reason });
  }

  function scheduleCampaignExpiry(campaign) {
    const delay = Math.max(0, campaign.claim_expires_at - Date.now());
    expiryTimers.set(campaign.campaign_id, setTimeout(() => {
      if (campaign.state === 'active') closeCampaign(campaign, 'expired', 'claim_window_elapsed');
    }, delay));
  }

  function updateOfferReference(campaign) {
    const sourceEvent = eventsById.get(campaign.source_event_id);
    const offer = sourceEvent?.offers.find(item => (item.campaign_id || item.deal_id) === campaign.campaign_id);
    if (offer) offer.state = campaign.state;
    if (sourceEvent?.offers.length && sourceEvent.offers.every(item => item.state !== 'active')) {
      const states = new Set(sourceEvent.offers.map(item => item.state));
      sourceEvent.offer_state = states.size === 1 ? sourceEvent.offers[0].state : 'closed';
    }
  }

  function syncCampaignSnapshot(campaign) {
    const snapshot = publicCampaign(campaign);
    const index = match.campaigns.findIndex(item => item.campaign_id === campaign.campaign_id);
    if (index === -1) match.campaigns.push(snapshot);
    else match.campaigns[index] = snapshot;
  }

  function refreshAllCampaignOffers(offerId) {
    for (const campaign of campaigns.values()) {
      if (!campaign.eligible_offers.some(offer => offer.offer_id === offerId)) continue;
      campaign.eligible_offers = campaign.eligible_offers.map(previous => {
        const current = catalogue.offers.find(offer => offer.offer_id === previous.offer_id);
        return current ? publicOffer(catalogue, current) : previous;
      });
      const primary = campaign.eligible_offers.find(offer => offer.offer_id === campaign.catalogue_offer_id);
      if (primary) {
        campaign.remaining_quantity = primary.remaining_quantity;
        campaign.inventory_tracked = primary.inventory_tracked;
      }
      syncCampaignSnapshot(campaign);
    }
  }

  function broadcastCatalogueOffer(offerId) {
    refreshAllCampaignOffers(offerId);
    for (const campaign of campaigns.values()) {
      if (!campaign.eligible_offers.some(offer => offer.offer_id === offerId)) continue;
      io.to(room(campaign.targeted_team)).emit('campaign:state', publicCampaign(campaign));
    }
    io.emit('catalogue:state', { offer_id: offerId });
    io.emit('match:state', match);
  }

  function findClaimByReservation(reservationId) {
    for (const campaign of campaigns.values()) {
      for (const claim of campaign.claims.values()) {
        if (claim.reservation_id === reservationId) return claim;
      }
    }
    return null;
  }

  function findClaimById(claimId) {
    for (const campaign of campaigns.values()) {
      for (const claim of campaign.claims.values()) {
        if (claim.claim_id === claimId) return { claim, campaign };
      }
    }
    return null;
  }

  function merchantAnalyticsSnapshot() {
    return {
      ...computeMerchantAnalytics(catalogue, campaigns.values()),
      transactions: [...campaigns.values()].flatMap(campaign => [...campaign.claims.values()].map(publicClaim))
    };
  }

  function watchPartyReward(group) {
    if (!['LIVE', 'HT'].includes(match.status)) return groupRewardProgress(group, null);
    const discovered = discoverOffers(catalogue, {
      matchId: group.match_id,
      team: group.team
    });
    const offer = discovered.preferred[0] || discovered.alternatives[0] || null;
    return groupRewardProgress(group, offer && {
      eligible: true,
      offer_id: offer.offer_id,
      title: offer.title,
      discount_minor: offer.discount_minor,
      budget_remaining_minor: offer.metrics.budget_remaining_minor,
      remaining_quantity: offer.remaining_quantity
    });
  }

  function observedSamplesForOffer(offerId) {
    return [...campaigns.values()].map(campaign => {
      const impressions = [...(campaign.impressions?.values() || [])].filter(item => item.offer_id === offerId).length;
      const claims = [...campaign.claims.values()].filter(item => item.offer_id === offerId);
      return {
        sample_id: campaign.campaign_id,
        impressions,
        claims: claims.length,
        completed_orders: claims.filter(claim => claim.order_status === 'completed').length
      };
    });
  }

  function publishEvent(event) {
    match.last_event = event.label;
    match.last_event_player = event.player;
    match.last_event_minute = event.minute;
    match.timeline.sort(compareTimelineEvents);
    io.emit('match:state', match);
  }

  function currentDeal(team) {
    const campaign = activeDeals.get(team);
    if (!campaign) return null;
    if (campaign.state !== 'active' || Date.now() >= campaign.claim_expires_at) {
      if (campaign.state === 'active') closeCampaign(campaign, 'expired', 'claim_window_elapsed');
      return null;
    }
    return campaign;
  }

  function updateScore() { match.score = `${goals.Arsenal}-${goals.Chelsea}`; }

  const matchClock = setInterval(() => {
    if (match.status === 'LIVE' && match.minutes < 90) {
      match.minutes += 1;
      io.emit('match:state', match);
    }
  }, 60_000);

  async function close() {
    clearInterval(matchClock);
    for (const timer of expiryTimers.values()) clearTimeout(timer);
    await new Promise(resolve => io.close(resolve));
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }

  return { server, close };
}

function eventLabel(type, team, player) {
  if (type === 'goal') return `GOAL by ${team}`;
  if (type === 'penalty_awarded') return `PENALTY awarded to ${team}`;
  if (type === 'penalty_scored') return `PENALTY SCORED by ${team}`;
  if (type === 'penalty_missed') return `PENALTY MISSED by ${team}`;
  if (type === 'red_card') return `RED CARD for ${team}`;
  if (type === 'half_time') return 'HALF-TIME';
  if (type === 'full_time') return 'FULL-TIME';
  if (type === 'postponed') return 'MATCH POSTPONED';
  if (type === 'suspended') return 'MATCH SUSPENDED';
  if (type === 'spotlight') return `STAR MOMENT for ${team}`;
  return player ? `${type} · ${player}` : type;
}

function publicDeal(campaign) {
  const { claims, impressions, paused_remaining_ms, ...deal } = campaign;
  return { ...deal, campaign_state: campaign.state, expires_at: campaign.claim_expires_at };
}

function publicCampaign(campaign) {
  const { claims, impressions, paused_remaining_ms, ...data } = campaign;
  return { ...data, campaign_state: campaign.state, claims: [...claims.values()].map(publicClaim) };
}

function publicClaim(claim) {
  return {
    ...claim,
    status_history: claim.status_history.map(item => ({ ...item })),
    order_history: (claim.order_history || []).map(item => ({ ...item }))
  };
}

function initialMatch(prediction = initialPredictionConfig(), campaignConfig = {}) {
  return {
    minutes: 14,
    home_team: 'Arsenal',
    away_team: 'Chelsea',
    competition: 'Premier League',
    fixture_kind: 'local_demo',
    data_source: 'seeded_simulator',
    demo_fixture_id: 'arsenal-chelsea-demo-001',
    kickoff_at: null,
    prediction: { ...prediction },
    offer_catalogue: { label: 'Seeded local demo catalogue', demo: true, inventory_persistence: 'in_memory' },
    campaign_config: {
      claim_window_seconds: campaignConfig.claimWindowSeconds ?? 300,
      fulfilment_window_seconds: campaignConfig.fulfilmentWindowSeconds ?? 86_400
    },
    score: '0-0',
    status: 'LIVE',
    pending_penalty: null,
    last_event: 'none',
    last_event_player: null,
    last_event_minute: null,
    timeline: [],
    campaigns: []
  };
}

function compareTimelineEvents(a, b) {
  return a.minute - b.minute || a.sequence - b.sequence || String(a.id).localeCompare(String(b.id));
}

function initialPredictionConfig(options = {}) {
  const rawCap = Number(options.earlyBirdCap ?? process.env.PLAYPULSE_EARLY_BIRD_CAP ?? 5000);
  const rewardCap = Number.isSafeInteger(rawCap) && rawCap >= 0 ? rawCap : 5000;
  const requestedState = options.predictionState ?? process.env.PLAYPULSE_PREDICTION_STATE;
  const rawLockAt = options.predictionLockAt ?? process.env.PLAYPULSE_PREDICTION_LOCK_AT;
  const parsedLockAt = rawLockAt ? Date.parse(rawLockAt) : NaN;
  return {
    match_id: 'arsenal-chelsea-local-demo',
    mode: 'simulated',
    window_state: requestedState === 'locked' ? 'locked' : 'open',
    lock_at: Number.isFinite(parsedLockAt) ? new Date(parsedLockAt).toISOString() : null,
    reward_cap: rewardCap,
    edit_policy: 'before_lock',
    reward_label: 'PlayPulse Early Bird'
  };
}

function uniqueOverturnId(eventId) { return `overturn-${eventId}`.slice(0, 80); }
function room(team) { return `fans:${team}`; }
function positiveNumber(value, fallback) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : fallback; }
function positiveInteger(value, fallback) { const number = Number(value); return Number.isSafeInteger(number) && number > 0 ? number : fallback; }
function validLocalUserId(value) { return typeof value === 'string' && /^local-[a-zA-Z0-9-]{6,100}$/.test(value); }
function deterministicCouponCode(campaignId, userId) {
  let hash = 2166136261;
  for (const character of `${campaignId}:${userId}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `PP-${(hash >>> 0).toString(36).toUpperCase().padStart(7, '0')}`;
}
function discountLabel(offer) {
  return offer.discount_type === 'percentage'
    ? `${offer.discount_value}% OFF`
    : `${formatMinor(offer.discount_value, offer.currency)} OFF`;
}
function formatMinor(value, currency = 'GBP') {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(value / 100);
}
function claimError(reason) {
  return {
    campaign_paused: 'This campaign is paused while the match is suspended.',
    campaign_cancelled: 'This campaign was cancelled after the source event changed.',
    campaign_expired: 'The claim window has ended.',
    campaign_exhausted: 'This demo campaign has reached its claim capacity.',
    claim_window_elapsed: 'The claim window has ended.',
    capacity_reached: 'This demo campaign has reached its claim capacity.'
  }[reason] || 'This campaign is not available to claim.';
}

if (require.main === module) {
  const { server } = createFlashServer();
  server.listen(PORT, HOST, () => {
    console.log(`Fan view: http://${HOST}:${PORT}`);
    console.log(`Admin trigger: http://${HOST}:${PORT}/admin`);
  });
}

module.exports = { createFlashServer };
