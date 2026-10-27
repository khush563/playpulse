(function exposePredictions(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PlayPulsePredictions = api;
})(typeof globalThis === 'object' ? globalThis : this, function createPredictionApi() {
  const DATA_KEY = 'playpulse-predictions-v1';
  const USER_KEY = 'playpulse-local-user-v1';
  const OUTCOMES = ['home', 'draw', 'away'];
  const DEFAULT_CONFIG = Object.freeze({
    match_id: 'arsenal-chelsea-local-demo',
    mode: 'simulated',
    window_state: 'open',
    lock_at: null,
    reward_cap: 5000,
    edit_policy: 'before_lock',
    reward_label: 'PlayPulse Early Bird'
  });

  function normalizeConfig(input = {}) {
    const merged = { ...DEFAULT_CONFIG, ...(input && typeof input === 'object' ? input : {}) };
    const lockTime = merged.lock_at ? Date.parse(merged.lock_at) : null;
    return {
      ...merged,
      match_id: typeof merged.match_id === 'string' && merged.match_id.trim() ? merged.match_id.trim() : DEFAULT_CONFIG.match_id,
      mode: 'simulated',
      window_state: merged.window_state === 'locked' ? 'locked' : 'open',
      lock_at: Number.isFinite(lockTime) ? new Date(lockTime).toISOString() : null,
      reward_cap: Number.isSafeInteger(Number(merged.reward_cap)) && Number(merged.reward_cap) >= 0 ? Number(merged.reward_cap) : DEFAULT_CONFIG.reward_cap,
      edit_policy: 'before_lock',
      reward_label: typeof merged.reward_label === 'string' && merged.reward_label.trim() ? merged.reward_label.trim() : DEFAULT_CONFIG.reward_label
    };
  }

  function validatePrediction(input) {
    const errors = [];
    const rawHome = input && input.homeScore;
    const rawAway = input && input.awayScore;
    const hasHome = rawHome !== '' && rawHome !== null && rawHome !== undefined;
    const hasAway = rawAway !== '' && rawAway !== null && rawAway !== undefined;
    const homeScore = hasHome ? Number(rawHome) : null;
    const awayScore = hasAway ? Number(rawAway) : null;
    const outcome = input && typeof input.outcome === 'string' ? input.outcome : '';

    if (hasHome !== hasAway) errors.push('Enter both team scores or leave both blank.');
    if (hasHome && (!Number.isSafeInteger(homeScore) || homeScore < 0 || homeScore > 20)) errors.push('Home score must be a whole number from 0 to 20.');
    if (hasAway && (!Number.isSafeInteger(awayScore) || awayScore < 0 || awayScore > 20)) errors.push('Away score must be a whole number from 0 to 20.');
    if (outcome && !OUTCOMES.includes(outcome)) errors.push('Choose home win, draw, or away win.');

    const scoresValid = hasHome && hasAway
      && Number.isSafeInteger(homeScore) && homeScore >= 0 && homeScore <= 20
      && Number.isSafeInteger(awayScore) && awayScore >= 0 && awayScore <= 20;
    const derivedOutcome = scoresValid ? (homeScore > awayScore ? 'home' : homeScore < awayScore ? 'away' : 'draw') : '';
    if (!scoresValid && !OUTCOMES.includes(outcome)) errors.push('Enter an exact score or choose a match outcome.');
    if (scoresValid && outcome && outcome !== derivedOutcome) errors.push('The selected outcome must match the predicted score.');

    if (errors.length) return { ok: false, errors: [...new Set(errors)], value: null };
    return {
      ok: true,
      errors: [],
      value: { homeScore: scoresValid ? homeScore : null, awayScore: scoresValid ? awayScore : null, outcome: outcome || derivedOutcome }
    };
  }

  function isLocked(configInput, now = Date.now()) {
    const config = normalizeConfig(configInput);
    if (config.window_state === 'locked') return true;
    return Boolean(config.lock_at && Date.parse(config.lock_at) <= now);
  }

  function emptyData() {
    return { predictions: {}, claims: {}, demoCounts: {} };
  }

  function readData(storage) {
    try {
      const raw = storage.getItem(DATA_KEY);
      if (!raw) return { ok: true, value: emptyData(), errors: [] };
      const value = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
      return {
        ok: true,
        value: {
          predictions: value.predictions && typeof value.predictions === 'object' ? value.predictions : {},
          claims: value.claims && typeof value.claims === 'object' ? value.claims : {},
          demoCounts: value.demoCounts && typeof value.demoCounts === 'object' ? value.demoCounts : {}
        },
        errors: []
      };
    } catch (_) {
      return { ok: false, value: emptyData(), errors: ['Saved prediction data could not be read.'] };
    }
  }

  function writeData(storage, value) {
    try {
      storage.setItem(DATA_KEY, JSON.stringify(value));
      return { ok: true, errors: [] };
    } catch (_) {
      return { ok: false, errors: ['Prediction could not be saved in this browser.'] };
    }
  }

  function createLocalId() {
    if (typeof crypto === 'object' && typeof crypto.randomUUID === 'function') return `local-${crypto.randomUUID()}`;
    return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function getOrCreateLocalUserId(storage, idFactory = createLocalId) {
    try {
      const existing = storage.getItem(USER_KEY);
      if (typeof existing === 'string' && existing.startsWith('local-')) return { ok: true, value: existing, errors: [] };
      const value = idFactory();
      storage.setItem(USER_KEY, value);
      return { ok: true, value, errors: [] };
    } catch (_) {
      return { ok: false, value: null, errors: ['A local user identifier could not be created.'] };
    }
  }

  function getPredictionState(storage, configInput, options = {}) {
    const config = normalizeConfig(configInput);
    const user = getOrCreateLocalUserId(storage, options.idFactory);
    const data = readData(storage);
    if (!user.ok || !data.ok) {
      return { ok: false, config, locked: isLocked(config, options.now), userId: user.value, prediction: null, claim: null, errors: [...user.errors, ...data.errors] };
    }
    const prediction = data.value.predictions[config.match_id] || null;
    const claim = data.value.claims[config.match_id] || null;
    return {
      ok: true,
      config,
      locked: isLocked(config, options.now),
      userId: user.value,
      prediction: prediction && prediction.userId === user.value ? prediction : null,
      claim: claim && claim.userId === user.value ? claim : null,
      errors: []
    };
  }

  function submitPrediction(storage, configInput, input, options = {}) {
    const config = normalizeConfig(configInput);
    const now = options.now ?? Date.now();
    if (isLocked(config, now)) return { ok: false, code: 'locked', errors: ['The simulated prediction window is locked.'] };
    const checked = validatePrediction(input);
    if (!checked.ok) return { ...checked, code: 'invalid' };
    const user = getOrCreateLocalUserId(storage, options.idFactory);
    const data = readData(storage);
    if (!user.ok || !data.ok) return { ok: false, code: 'storage', errors: [...user.errors, ...data.errors] };
    if (data.value.predictions[config.match_id]) {
      return { ok: false, code: 'duplicate', errors: ['One prediction already exists for this match. Use Edit while the window is open.'] };
    }

    const used = Number.isSafeInteger(data.value.demoCounts[config.match_id]) ? data.value.demoCounts[config.match_id] : 0;
    const rewardGranted = !options.deferReward && used < config.reward_cap && !data.value.claims[config.match_id];
    const timestamp = new Date(now).toISOString();
    const prediction = {
      ...checked.value,
      userId: user.value,
      matchId: config.match_id,
      createdAt: timestamp,
      updatedAt: timestamp,
      rewardStatus: options.deferReward ? 'pending' : rewardGranted ? 'granted' : 'cap_reached'
    };
    data.value.predictions[config.match_id] = prediction;
    let claim = null;
    if (rewardGranted) {
      claim = { userId: user.value, matchId: config.match_id, type: 'badge', label: config.reward_label, claimedAt: timestamp };
      data.value.claims[config.match_id] = claim;
      data.value.demoCounts[config.match_id] = used + 1;
    }
    const written = writeData(storage, data.value);
    if (!written.ok) return { ok: false, code: 'storage', errors: written.errors };
    return { ok: true, code: 'created', errors: [], prediction, claim, rewardGranted, capReached: !options.deferReward && !rewardGranted, rewardPending: Boolean(options.deferReward) };
  }

  function applyRewardDecision(storage, configInput, decision, options = {}) {
    const config = normalizeConfig(configInput);
    const user = getOrCreateLocalUserId(storage, options.idFactory);
    const data = readData(storage);
    if (!user.ok || !data.ok) return { ok: false, code: 'storage', errors: [...user.errors, ...data.errors] };
    const prediction = data.value.predictions[config.match_id];
    if (!prediction || prediction.userId !== user.value) return { ok: false, code: 'missing', errors: ['No prediction exists for this reward decision.'] };
    const granted = Boolean(decision && decision.granted);
    const status = granted ? 'granted' : decision?.status === 'cap_reached' ? 'cap_reached' : 'unavailable';
    prediction.rewardStatus = status;
    let claim = null;
    if (granted) {
      claim = {
        userId: user.value,
        matchId: config.match_id,
        type: 'badge',
        label: typeof decision.label === 'string' && decision.label ? decision.label : config.reward_label,
        claimedAt: new Date(options.now ?? Date.now()).toISOString()
      };
      data.value.claims[config.match_id] = claim;
    }
    const written = writeData(storage, data.value);
    if (!written.ok) return { ok: false, code: 'storage', errors: written.errors };
    return { ok: true, code: status, errors: [], prediction, claim, rewardGranted: granted, capReached: status === 'cap_reached' };
  }

  function editPrediction(storage, configInput, input, options = {}) {
    const config = normalizeConfig(configInput);
    const now = options.now ?? Date.now();
    if (isLocked(config, now)) return { ok: false, code: 'locked', errors: ['The simulated prediction window is locked.'] };
    const checked = validatePrediction(input);
    if (!checked.ok) return { ...checked, code: 'invalid' };
    const user = getOrCreateLocalUserId(storage, options.idFactory);
    const data = readData(storage);
    if (!user.ok || !data.ok) return { ok: false, code: 'storage', errors: [...user.errors, ...data.errors] };
    const existing = data.value.predictions[config.match_id];
    if (!existing || existing.userId !== user.value) return { ok: false, code: 'missing', errors: ['No editable prediction exists for this local user.'] };
    const prediction = { ...existing, ...checked.value, updatedAt: new Date(now).toISOString() };
    data.value.predictions[config.match_id] = prediction;
    const written = writeData(storage, data.value);
    if (!written.ok) return { ok: false, code: 'storage', errors: written.errors };
    return { ok: true, code: 'updated', errors: [], prediction, claim: data.value.claims[config.match_id] || null, rewardGranted: existing.rewardStatus === 'granted', capReached: existing.rewardStatus === 'cap_reached' };
  }

  return {
    DATA_KEY,
    USER_KEY,
    OUTCOMES,
    DEFAULT_CONFIG,
    normalizeConfig,
    validatePrediction,
    isLocked,
    getOrCreateLocalUserId,
    getPredictionState,
    submitPrediction,
    applyRewardDecision,
    editPrediction
  };
});
