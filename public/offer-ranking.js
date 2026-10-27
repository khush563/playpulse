(function exposeOfferRanking(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PlayPulseOfferRanking = api;
})(typeof globalThis === 'object' ? globalThis : this, function createOfferRankingApi() {
  const RANKER_ID = 'deterministic-weighted-v1';

  function hardEligibility(offer, context = {}, now = Date.now()) {
    const reasons = [];
    if (!offer || typeof offer !== 'object') return { eligible: false, reasons: ['invalid_offer'] };
    if (offer.status !== 'active') reasons.push('campaign_not_active');
    const start = Date.parse(offer.campaign_start_at);
    const end = Date.parse(offer.campaign_end_at);
    const deadline = Date.parse(offer.claim_deadline_at);
    if (Number.isFinite(start) && now < start) reasons.push('campaign_not_started');
    if (Number.isFinite(end) && now >= end) reasons.push('campaign_ended');
    if (Number.isFinite(deadline) && now >= deadline) reasons.push('claim_deadline_elapsed');
    if (offer.inventory_tracked && (!Number.isSafeInteger(offer.remaining_quantity) || offer.remaining_quantity <= 0)) reasons.push('inventory_exhausted');
    if (offer.metrics && offer.metrics.reservation_count >= offer.metrics.maximum_redemptions) reasons.push('redemption_limit_reached');
    if (offer.metrics && offer.metrics.budget_remaining_minor < offer.discount_minor) reasons.push('budget_exhausted');
    if (context.matchId && !supports(offer.supported_match_ids, context.matchId)) reasons.push('unsupported_match');
    if (context.team && !supports(offer.supported_teams, context.team)) reasons.push('unsupported_team');
    if (context.event && !supports(offer.supported_events, context.event)) reasons.push('unsupported_event');
    if (context.mood && !supports(offer.supported_moods, context.mood)) reasons.push('unsupported_mood');
    return { eligible: reasons.length === 0, reasons };
  }

  // Future rankers implement this same method and receive eligible offers only.
  const deterministicRanker = Object.freeze({ id: RANKER_ID, rankEligibleOffers: deterministicWeightedRank });

  function recommendOffers(input, ranker = deterministicRanker) {
    const now = Number.isFinite(input?.now) ? input.now : Date.now();
    const context = input?.context || {};
    const excluded = new Set(Array.isArray(input?.excludedOfferIds) ? input.excludedOfferIds : []);
    const rejected = [];
    const eligible = [];
    for (const offer of Array.isArray(input?.offers) ? input.offers : []) {
      if (excluded.has(offer.offer_id)) { rejected.push({ offer_id: offer.offer_id, reasons: ['explicitly_excluded'] }); continue; }
      const checked = hardEligibility(offer, context, now);
      if (checked.eligible) eligible.push(offer);
      else rejected.push({ offer_id: offer.offer_id, reasons: checked.reasons });
    }
    if (!ranker || typeof ranker.rankEligibleOffers !== 'function') throw new Error('Ranker must implement rankEligibleOffers(eligibleOffers, signals).');
    const ranked = ranker.rankEligibleOffers(eligible, {
      context,
      preferences: input?.preferences || null,
      interactions: input?.interactions || null,
      location: input?.locationConsent === true ? input.location || null : null
    });
    const eligibleIds = new Set(eligible.map(offer => offer.offer_id));
    if (!Array.isArray(ranked) || ranked.some(item => !eligibleIds.has(item.offer.offer_id))) {
      throw new Error('Ranker returned an offer outside the hard-eligible set.');
    }
    return { ranker_id: ranker.id || 'custom-ranker', ranked, rejected };
  }

  function deterministicWeightedRank(eligibleOffers, signals) {
    const preferences = validPreferenceShape(signals.preferences) ? signals.preferences : null;
    const hasPersonalSignals = Boolean(preferences);
    return eligibleOffers.map(offer => {
      let score = 0;
      const reasons = [];
      if (preferences && !preferences.noOfferPreference && preferences.offerPreferences.includes(offer.category)) {
        score += 40;
        reasons.push(`Matches your ${categoryLabel(offer.category)} preference.`);
      }
      if (preferences?.favoriteClub === signals.context.team && supports(offer.supported_teams, signals.context.team)) {
        score += 30;
        reasons.push('Available for your selected team.');
      }
      const explicitMood = preferences?.matchDayMode === 'celebration' ? 'celebrate'
        : preferences?.matchDayMode === 'comfort' ? 'comfort' : null;
      if (explicitMood && explicitMood === signals.context.mood && supports(offer.supported_moods, explicitMood)) {
        score += 20;
        reasons.push(`Matches your ${preferences.matchDayMode} deals setting.`);
      }
      if (signals.context.event && supports(offer.supported_events, signals.context.event)) {
        score += 12;
        reasons.push(`Relevant to this ${eventLabel(signals.context.event)} moment.`);
      }
      if (preferences?.fulfilmentPreference && offer.fulfilment_mode === preferences.fulfilmentPreference) {
        score += 10;
        reasons.push(`Matches your ${offer.fulfilment_mode} preference.`);
      }
      const claims = countFor(signals.interactions?.categoryClaims, offer.category);
      const views = countFor(signals.interactions?.categoryViews, offer.category);
      if (claims > 0 || views > 0) {
        score += Math.min(18, claims * 6 + views * 2);
        reasons.push(`Based on your previous ${categoryLabel(offer.category)} offer interactions.`);
      }
      if (signals.location && Number.isFinite(offer.distance_km)) {
        score += Math.max(0, 10 - Math.floor(offer.distance_km));
        reasons.push(`Within ${offer.distance_km.toFixed(1)} km using your permitted location.`);
      }
      if (!reasons.length && signals.context.team && supports(offer.supported_teams, signals.context.team)) {
        reasons.push('Available for your selected team.');
      }
      return {
        offer,
        score,
        reasons,
        strategy: hasPersonalSignals ? 'personalised_rules' : 'relevance_fallback'
      };
    }).sort((a, b) => b.score - a.score
      || dateValue(b.offer.campaign_start_at) - dateValue(a.offer.campaign_start_at)
      || String(a.offer.offer_id).localeCompare(String(b.offer.offer_id)));
  }

  function validPreferenceShape(value) {
    return Boolean(value && typeof value === 'object' && typeof value.favoriteClub === 'string'
      && Array.isArray(value.offerPreferences) && typeof value.matchDayMode === 'string');
  }
  function supports(list, value) { return Array.isArray(list) && list.includes(value); }
  function countFor(record, key) { const value = record && Number(record[key]); return Number.isSafeInteger(value) && value > 0 ? value : 0; }
  function dateValue(value) { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : 0; }
  function categoryLabel(value) { return value === 'merchandise' ? 'merchandise' : value === 'experiences' ? 'match experience' : 'food'; }
  function eventLabel(value) { return String(value).replaceAll('_', ' '); }

  return { RANKER_ID, hardEligibility, deterministicRanker, deterministicWeightedRank, recommendOffers };
});
