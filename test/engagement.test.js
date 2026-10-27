'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  POLICY,
  recordPrediction,
  recordMatchParticipation,
  settlePrediction,
  syncEarlyBirdBadge,
  getProfile,
  consecutiveStreak
} = require('../public/engagement.js');

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

test('meaningful actions award points once per match and ignore duplicate clicks', () => {
  const storage = memoryStorage();
  const prediction = { matchId: 'match-1', matchOrdinal: 1, homeScore: 2, awayScore: 1, outcome: 'home' };
  assert.equal(recordPrediction(storage, prediction, { now: 1000 }).duplicate, false);
  assert.equal(recordPrediction(storage, prediction, { now: 2000 }).duplicate, true);
  assert.equal(recordMatchParticipation(storage, { matchId: 'match-1', matchOrdinal: 1 }, { now: 3000 }).duplicate, false);
  assert.equal(recordMatchParticipation(storage, { matchId: 'match-1', matchOrdinal: 1 }, { now: 4000 }).duplicate, true);
  const profile = getProfile(storage);
  assert.equal(profile.points, POLICY.prediction_submitted + POLICY.match_joined);
  assert.equal(profile.history.length, 2);
});

test('streaks come from consecutive saved match ordinals and badges use fixed thresholds', () => {
  assert.equal(consecutiveStreak([{ matchOrdinal: 1 }, { matchOrdinal: 2 }, { matchOrdinal: 3 }]), 3);
  assert.equal(consecutiveStreak([{ matchOrdinal: 1 }, { matchOrdinal: 3 }, { matchOrdinal: 4 }]), 2);
  const storage = memoryStorage();
  for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
    recordPrediction(storage, { matchId: `match-${ordinal}`, matchOrdinal: ordinal, homeScore: null, awayScore: null, outcome: 'draw' });
    recordMatchParticipation(storage, { matchId: `match-${ordinal}`, matchOrdinal: ordinal });
  }
  const profile = getProfile(storage);
  assert.equal(profile.predictionStreak, 3);
  assert.equal(profile.matchStreak, 3);
  assert.equal(profile.badges.predictionStreak, true);
  assert.equal(profile.badges.matchRegular, true);
});

test('prediction settlement awards one exclusive result score and is idempotent', () => {
  const storage = memoryStorage();
  recordPrediction(storage, { matchId: 'final-1', matchOrdinal: 1, homeScore: 2, awayScore: 1, outcome: 'home' });
  const exact = settlePrediction(storage, { matchId: 'final-1', actualHome: 2, actualAway: 1 }, { now: 5000 });
  assert.equal(exact.points, POLICY.exact_score);
  assert.equal(exact.exact, true);
  assert.equal(settlePrediction(storage, { matchId: 'final-1', actualHome: 2, actualAway: 1 }, { now: 6000 }).duplicate, true);
  assert.equal(getProfile(storage).points, POLICY.prediction_submitted + POLICY.exact_score);
});

test('Early Bird badge mirrors a real granted reward and adds no invented points', () => {
  const storage = memoryStorage();
  assert.equal(syncEarlyBirdBadge(storage, { granted: false }).profile.badges.earlyBird, false);
  const first = syncEarlyBirdBadge(storage, { granted: true, matchId: 'match-1' }, { now: 1000 });
  assert.equal(first.duplicate, false);
  assert.equal(syncEarlyBirdBadge(storage, { granted: true, matchId: 'match-1' }, { now: 2000 }).duplicate, true);
  assert.equal(getProfile(storage).badges.earlyBird, true);
  assert.equal(getProfile(storage).points, 0);
});
