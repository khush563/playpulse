const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validatePrediction,
  isLocked,
  getPredictionState,
  submitPrediction,
  applyRewardDecision,
  editPrediction
} = require('../public/predictions.js');

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

const config = {
  match_id: 'demo-match',
  window_state: 'open',
  lock_at: null,
  reward_cap: 5000
};
const localId = () => 'local-test-user';

test('prediction scores require valid whole numbers and a consistent outcome', () => {
  assert.equal(validatePrediction({ homeScore: '2', awayScore: '1', outcome: 'home' }).ok, true);
  assert.equal(validatePrediction({ homeScore: '', awayScore: '', outcome: 'draw' }).ok, true);

  for (const invalid of [
    { homeScore: '1.5', awayScore: '0', outcome: 'home' },
    { homeScore: '-1', awayScore: '0', outcome: 'away' },
    { homeScore: '21', awayScore: '0', outcome: 'home' },
    { homeScore: '2', awayScore: '', outcome: 'home' },
    { homeScore: '2', awayScore: '1', outcome: 'away' }
  ]) assert.equal(validatePrediction(invalid).ok, false);
});

test('one prediction is created per local user and match, with edits only through the edit policy', () => {
  const storage = memoryStorage();
  const first = submitPrediction(storage, config, { homeScore: '2', awayScore: '1', outcome: 'home' }, { now: 1000, idFactory: localId });
  assert.equal(first.ok, true);
  assert.equal(first.rewardGranted, true);
  assert.equal(first.claim.type, 'badge');

  const duplicate = submitPrediction(storage, config, { homeScore: '1', awayScore: '1', outcome: 'draw' }, { now: 2000, idFactory: localId });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.code, 'duplicate');

  const edited = editPrediction(storage, config, { homeScore: '1', awayScore: '1', outcome: 'draw' }, { now: 3000, idFactory: localId });
  assert.equal(edited.ok, true);
  assert.equal(edited.prediction.outcome, 'draw');
  assert.equal(edited.claim.type, 'badge');
  assert.equal(getPredictionState(storage, config, { now: 3000, idFactory: localId }).prediction.homeScore, 1);
});

test('manual state and configured timestamp both lock prediction creation and editing', () => {
  const now = Date.parse('2026-10-27T12:00:00.000Z');
  assert.equal(isLocked({ ...config, window_state: 'locked' }, now), true);
  assert.equal(isLocked({ ...config, lock_at: '2026-10-27T11:59:59.000Z' }, now), true);
  assert.equal(isLocked({ ...config, lock_at: '2026-10-27T12:00:01.000Z' }, now), false);

  const storage = memoryStorage();
  const locked = submitPrediction(storage, { ...config, window_state: 'locked' }, { homeScore: '0', awayScore: '0', outcome: 'draw' }, { now, idFactory: localId });
  assert.equal(locked.ok, false);
  assert.equal(locked.code, 'locked');

  submitPrediction(storage, config, { homeScore: '1', awayScore: '0', outcome: 'home' }, { now: now - 1000, idFactory: localId });
  const edit = editPrediction(storage, { ...config, window_state: 'locked' }, { homeScore: '2', awayScore: '0', outcome: 'home' }, { now, idFactory: localId });
  assert.equal(edit.ok, false);
  assert.equal(edit.code, 'locked');
});

test('a reached Early Bird cap does not block an ordinary prediction', () => {
  const storage = memoryStorage();
  const result = submitPrediction(storage, { ...config, reward_cap: 0 }, { homeScore: '', awayScore: '', outcome: 'away' }, { now: 1000, idFactory: localId });
  assert.equal(result.ok, true);
  assert.equal(result.rewardGranted, false);
  assert.equal(result.capReached, true);
  assert.equal(result.prediction.outcome, 'away');
  assert.equal(result.claim, null);
});

test('a deferred server reward decision is attached to the saved local prediction', () => {
  const storage = memoryStorage();
  const saved = submitPrediction(storage, config, { homeScore: '3', awayScore: '2', outcome: 'home' }, { now: 1000, idFactory: localId, deferReward: true });
  assert.equal(saved.rewardPending, true);
  assert.equal(saved.claim, null);

  const applied = applyRewardDecision(storage, config, { granted: true, status: 'granted', label: 'PlayPulse Early Bird' }, { now: 2000, idFactory: localId });
  assert.equal(applied.ok, true);
  assert.equal(applied.claim.type, 'badge');
  assert.equal(getPredictionState(storage, config, { idFactory: localId }).prediction.rewardStatus, 'granted');
});
