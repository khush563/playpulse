(function exposeMatchSentiment(root) {
  'use strict';
  function fromScore(home, away) {
    return {
      Arsenal: home > away ? 'celebrate' : home < away ? 'comfort' : 'neutral',
      Chelsea: away > home ? 'celebrate' : away < home ? 'comfort' : 'neutral'
    };
  }
  function allows(sentiments, campaign) {
    if (sentiments?.[campaign.targeted_team] !== campaign.mood) return false;
    if (campaign.mood !== 'comfort') return campaign.mood === 'celebrate';
    const category = campaign.offer_category || campaign.category;
    return category === 'food' || (category === 'experiences' && campaign.coupon_validity_policy === 'match_end');
  }
  const api = { fromScore, allows };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PlayPulseMatchSentiment = api;
})(globalThis);
