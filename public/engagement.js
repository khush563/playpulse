(function exposeEngagement(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PlayPulseEngagement = api;
})(typeof globalThis === 'object' ? globalThis : this, function createEngagementApi() {
  const DATA_KEY = 'playpulse-engagement-v1';
  const POLICY = Object.freeze({
    prediction_submitted: 10,
    match_joined: 5,
    correct_outcome: 10,
    exact_score: 25
  });
  const BADGE_THRESHOLDS = Object.freeze({ prediction_streak: 3, match_regular: 3 });

  function emptyData() {
    return { awards: {}, history: [], predictions: {}, participations: {}, settlements: {}, badges: {} };
  }

  function readData(storage) {
    try {
      const raw = storage.getItem(DATA_KEY);
      if (!raw) return { ok: true, value: emptyData(), errors: [] };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
      return {
        ok: true,
        value: {
          awards: objectOrEmpty(parsed.awards),
          history: Array.isArray(parsed.history) ? parsed.history.filter(validHistory) : [],
          predictions: objectOrEmpty(parsed.predictions),
          participations: objectOrEmpty(parsed.participations),
          settlements: objectOrEmpty(parsed.settlements),
          badges: objectOrEmpty(parsed.badges)
        },
        errors: []
      };
    } catch (_) {
      return { ok: false, value: emptyData(), errors: ['Saved engagement data could not be read.'] };
    }
  }

  function writeData(storage, value) {
    try {
      storage.setItem(DATA_KEY, JSON.stringify(value));
      return { ok: true, errors: [] };
    } catch (_) {
      return { ok: false, errors: ['Engagement progress could not be saved in this browser.'] };
    }
  }

  function award(data, input) {
    if (data.awards[input.key]) return { duplicate: true, entry: data.awards[input.key] };
    const entry = {
      key: input.key,
      type: input.type,
      label: input.label,
      points: input.points,
      matchId: input.matchId || null,
      awardedAt: new Date(input.now ?? Date.now()).toISOString()
    };
    data.awards[input.key] = entry;
    data.history.unshift(entry);
    return { duplicate: false, entry };
  }

  function recordPrediction(storage, input, options = {}) {
    const checked = validateRecord(input);
    if (!checked.ok) return checked;
    const read = readData(storage);
    if (!read.ok) return read;
    const existing = read.value.predictions[input.matchId];
    const timestamp = new Date(options.now ?? Date.now()).toISOString();
    read.value.predictions[input.matchId] = {
      matchId: input.matchId,
      matchOrdinal: input.matchOrdinal,
      homeScore: integerOrNull(input.homeScore),
      awayScore: integerOrNull(input.awayScore),
      outcome: input.outcome,
      recordedAt: existing?.recordedAt || timestamp,
      updatedAt: timestamp
    };
    const awarded = award(read.value, {
      key: `prediction:${input.matchId}`,
      type: 'prediction_submitted',
      label: 'Free match prediction submitted',
      points: POLICY.prediction_submitted,
      matchId: input.matchId,
      now: options.now
    });
    refreshThresholdBadges(read.value, options.now);
    const written = writeData(storage, read.value);
    return written.ok ? { ok: true, duplicate: awarded.duplicate, award: awarded.entry, profile: profileFromData(read.value) } : written;
  }

  function recordMatchParticipation(storage, input, options = {}) {
    const checked = validateRecord(input);
    if (!checked.ok) return checked;
    const read = readData(storage);
    if (!read.ok) return read;
    if (!read.value.participations[input.matchId]) {
      read.value.participations[input.matchId] = {
        matchId: input.matchId,
        matchOrdinal: input.matchOrdinal,
        joinedAt: new Date(options.now ?? Date.now()).toISOString()
      };
    }
    const awarded = award(read.value, {
      key: `match_joined:${input.matchId}`,
      type: 'match_joined',
      label: 'Joined the local match experience',
      points: POLICY.match_joined,
      matchId: input.matchId,
      now: options.now
    });
    refreshThresholdBadges(read.value, options.now);
    const written = writeData(storage, read.value);
    return written.ok ? { ok: true, duplicate: awarded.duplicate, award: awarded.entry, profile: profileFromData(read.value) } : written;
  }

  function settlePrediction(storage, input, options = {}) {
    if (!input || typeof input.matchId !== 'string' || !Number.isSafeInteger(input.actualHome) || !Number.isSafeInteger(input.actualAway) || input.actualHome < 0 || input.actualAway < 0) {
      return { ok: false, errors: ['A valid match and non-negative final score are required.'] };
    }
    const read = readData(storage);
    if (!read.ok) return read;
    if (read.value.settlements[input.matchId]) return { ok: true, duplicate: true, award: null, profile: profileFromData(read.value) };
    const prediction = read.value.predictions[input.matchId];
    if (!prediction) return { ok: false, errors: ['No saved prediction exists for this match.'] };
    const actualOutcome = input.actualHome > input.actualAway ? 'home' : input.actualHome < input.actualAway ? 'away' : 'draw';
    const exact = prediction.homeScore !== null && prediction.homeScore === input.actualHome && prediction.awayScore === input.actualAway;
    const correct = prediction.outcome === actualOutcome;
    const type = exact ? 'exact_score' : correct ? 'correct_outcome' : null;
    const points = type ? POLICY[type] : 0;
    read.value.settlements[input.matchId] = { matchId: input.matchId, exact, correct, settledAt: new Date(options.now ?? Date.now()).toISOString() };
    const awarded = type ? award(read.value, {
      key: `prediction_result:${input.matchId}`,
      type,
      label: exact ? 'Exact score prediction' : 'Correct match outcome',
      points,
      matchId: input.matchId,
      now: options.now
    }) : null;
    const written = writeData(storage, read.value);
    return written.ok ? { ok: true, duplicate: false, award: awarded?.entry || null, points, exact, correct, profile: profileFromData(read.value) } : written;
  }

  function syncEarlyBirdBadge(storage, input = {}, options = {}) {
    const read = readData(storage);
    if (!read.ok) return read;
    if (!input.granted) return { ok: true, duplicate: true, profile: profileFromData(read.value) };
    const duplicate = Boolean(read.value.badges.early_bird);
    if (!duplicate) read.value.badges.early_bird = { earnedAt: new Date(options.now ?? Date.now()).toISOString(), matchId: input.matchId || null };
    const written = writeData(storage, read.value);
    return written.ok ? { ok: true, duplicate, profile: profileFromData(read.value) } : written;
  }

  function getProfile(storage) {
    const read = readData(storage);
    if (!read.ok) return { ok: false, errors: read.errors, ...profileFromData(read.value) };
    refreshThresholdBadges(read.value);
    writeData(storage, read.value);
    return { ok: true, errors: [], ...profileFromData(read.value) };
  }

  function clear(storage) {
    try { storage.removeItem(DATA_KEY); return { ok: true, errors: [] }; }
    catch (_) { return { ok: false, errors: ['Engagement progress could not be cleared.'] }; }
  }

  function profileFromData(data) {
    const predictionStreak = consecutiveStreak(Object.values(data.predictions));
    const matchStreak = consecutiveStreak(Object.values(data.participations));
    return {
      points: Object.values(data.awards).reduce((sum, entry) => sum + (Number.isSafeInteger(entry.points) ? entry.points : 0), 0),
      history: [...data.history],
      predictionStreak,
      matchStreak,
      badges: {
        earlyBird: Boolean(data.badges.early_bird),
        predictionStreak: predictionStreak >= BADGE_THRESHOLDS.prediction_streak,
        matchRegular: matchStreak >= BADGE_THRESHOLDS.match_regular
      },
      badgeRecords: { ...data.badges }
    };
  }

  function refreshThresholdBadges(data, now = Date.now()) {
    const predictionStreak = consecutiveStreak(Object.values(data.predictions));
    const matchStreak = consecutiveStreak(Object.values(data.participations));
    if (predictionStreak >= BADGE_THRESHOLDS.prediction_streak && !data.badges.prediction_streak) {
      data.badges.prediction_streak = { earnedAt: new Date(now).toISOString(), threshold: BADGE_THRESHOLDS.prediction_streak };
    }
    if (matchStreak >= BADGE_THRESHOLDS.match_regular && !data.badges.match_regular) {
      data.badges.match_regular = { earnedAt: new Date(now).toISOString(), threshold: BADGE_THRESHOLDS.match_regular };
    }
  }

  function consecutiveStreak(records) {
    const ordinals = [...new Set((Array.isArray(records) ? records : [])
      .map(record => record?.matchOrdinal)
      .filter(value => Number.isSafeInteger(value) && value > 0))].sort((a, b) => b - a);
    if (!ordinals.length) return 0;
    let streak = 1;
    for (let index = 1; index < ordinals.length; index += 1) {
      if (ordinals[index] !== ordinals[index - 1] - 1) break;
      streak += 1;
    }
    return streak;
  }

  function validateRecord(input) {
    if (!input || typeof input.matchId !== 'string' || !input.matchId.trim() || !Number.isSafeInteger(input.matchOrdinal) || input.matchOrdinal < 1) {
      return { ok: false, errors: ['A valid match ID and positive match sequence are required.'] };
    }
    return { ok: true, errors: [] };
  }

  function integerOrNull(value) { return Number.isSafeInteger(value) ? value : null; }
  function objectOrEmpty(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
  function validHistory(entry) { return entry && typeof entry.key === 'string' && Number.isSafeInteger(entry.points); }

  return {
    DATA_KEY,
    POLICY,
    BADGE_THRESHOLDS,
    readData,
    recordPrediction,
    recordMatchParticipation,
    settlePrediction,
    syncEarlyBirdBadge,
    getProfile,
    consecutiveStreak,
    clear
  };
});
