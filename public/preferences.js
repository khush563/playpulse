(function exposePreferences(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PlayPulsePreferences = api;
})(typeof globalThis === 'object' ? globalThis : this, function createPreferencesApi() {
  const STORAGE_KEY = 'playpulse-preferences-v1';
  const CLUBS = ['Arsenal', 'Chelsea'];
  const LEAGUES = ['', 'Premier League'];
  const OFFER_TYPES = ['food', 'merchandise', 'experiences'];
  const MATCH_MODES = ['celebration', 'comfort', 'all'];

  function validatePreferences(input) {
    const errors = [];
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { ok: false, errors: ['Preferences must be an object.'], value: null };
    }

    const favoriteClub = typeof input.favoriteClub === 'string' ? input.favoriteClub : '';
    const favoriteLeague = typeof input.favoriteLeague === 'string' ? input.favoriteLeague : '';
    const matchDayMode = typeof input.matchDayMode === 'string' ? input.matchDayMode : '';
    const noOfferPreference = input.noOfferPreference === true;
    const rawOffers = Array.isArray(input.offerPreferences) ? input.offerPreferences : [];
    const offerPreferences = [...new Set(rawOffers.filter(value => typeof value === 'string'))];

    if (!CLUBS.includes(favoriteClub)) errors.push('Choose Arsenal or Chelsea.');
    if (!LEAGUES.includes(favoriteLeague)) errors.push('Choose a supported league or no league preference.');
    if (!MATCH_MODES.includes(matchDayMode)) errors.push('Choose a valid match-day mode.');
    if (offerPreferences.some(value => !OFFER_TYPES.includes(value))) errors.push('One or more offer preferences are invalid.');
    if (noOfferPreference && offerPreferences.length) errors.push('No preference cannot be combined with specific offer types.');
    if (!noOfferPreference && offerPreferences.length === 0) errors.push('Choose at least one offer type or select no preference.');

    if (errors.length) return { ok: false, errors, value: null };
    return {
      ok: true,
      errors: [],
      value: { favoriteClub, favoriteLeague, offerPreferences, noOfferPreference, matchDayMode }
    };
  }

  function loadPreferences(storage) {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return { status: 'empty', value: null, errors: [] };
      const checked = validatePreferences(JSON.parse(raw));
      return checked.ok
        ? { status: 'valid', value: checked.value, errors: [] }
        : { status: 'invalid', value: null, errors: checked.errors };
    } catch (_) {
      return { status: 'invalid', value: null, errors: ['Saved preferences could not be read.'] };
    }
  }

  function savePreferences(storage, input) {
    const checked = validatePreferences(input);
    if (!checked.ok) return checked;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(checked.value));
      return checked;
    } catch (_) {
      return { ok: false, value: null, errors: ['Preferences could not be saved in this browser.'] };
    }
  }

  function clearPreferences(storage) {
    try { storage.removeItem(STORAGE_KEY); } catch (_) { /* Storage is optional. */ }
  }

  function allowsDeal(input, deal) {
    const checked = validatePreferences(input);
    if (!checked.ok || !deal || typeof deal !== 'object') return false;
    const preferences = checked.value;
    const selectedMood = preferences.matchDayMode === 'celebration' ? 'celebrate' : preferences.matchDayMode;
    if (selectedMood !== 'all' && selectedMood !== deal.mood) return false;
    if (preferences.noOfferPreference) return true;
    return OFFER_TYPES.includes(deal.offer_category) && preferences.offerPreferences.includes(deal.offer_category);
  }

  return { STORAGE_KEY, CLUBS, LEAGUES, OFFER_TYPES, MATCH_MODES, validatePreferences, loadPreferences, savePreferences, clearPreferences, allowsDeal };
});
