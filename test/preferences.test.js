const test = require('node:test');
const assert = require('node:assert/strict');

const {
  STORAGE_KEY,
  validatePreferences,
  loadPreferences,
  savePreferences,
  clearPreferences
} = require('../public/preferences.js');

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

const validPreferences = {
  favoriteClub: 'Arsenal',
  favoriteLeague: 'Premier League',
  offerPreferences: ['food', 'merchandise'],
  noOfferPreference: false,
  matchDayMode: 'all'
};

test('valid preferences save and load through the local storage adapter', () => {
  const storage = memoryStorage();
  const saved = savePreferences(storage, validPreferences);
  assert.equal(saved.ok, true);
  assert.deepEqual(loadPreferences(storage), {
    status: 'valid',
    value: validPreferences,
    errors: []
  });

  clearPreferences(storage);
  assert.deepEqual(loadPreferences(storage), { status: 'empty', value: null, errors: [] });
});

test('validation rejects unsupported and conflicting preference values', () => {
  const unsupported = validatePreferences({
    favoriteClub: 'Barcelona',
    favoriteLeague: 'La Liga',
    offerPreferences: ['tickets'],
    noOfferPreference: false,
    matchDayMode: 'everything'
  });
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.errors.length, 4);

  const conflicting = validatePreferences({
    ...validPreferences,
    noOfferPreference: true
  });
  assert.equal(conflicting.ok, false);
  assert.match(conflicting.errors.join(' '), /cannot be combined/);
});

test('empty, malformed, and unavailable storage states are handled without throwing', () => {
  const malformed = memoryStorage({ [STORAGE_KEY]: '{not-json' });
  assert.equal(loadPreferences(malformed).status, 'invalid');

  const unavailable = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); }
  };
  assert.equal(loadPreferences(unavailable).status, 'invalid');
  const saved = savePreferences(unavailable, validPreferences);
  assert.equal(saved.ok, false);
  assert.match(saved.errors[0], /could not be saved/);
  assert.doesNotThrow(() => clearPreferences(unavailable));
});

test('saved category and match-day preferences determine which deals are allowed', () => {
  const { allowsDeal } = require('../public/preferences.js');
  const merchandiseCelebration = { mood: 'celebrate', offer_category: 'merchandise' };
  const foodComfort = { mood: 'comfort', offer_category: 'food' };

  assert.equal(allowsDeal({ ...validPreferences, matchDayMode: 'celebration' }, merchandiseCelebration), true);
  assert.equal(allowsDeal({ ...validPreferences, matchDayMode: 'celebration' }, foodComfort), false);
  assert.equal(allowsDeal({ ...validPreferences, offerPreferences: ['food'] }, merchandiseCelebration), false);
  assert.equal(allowsDeal({ ...validPreferences, offerPreferences: [], noOfferPreference: true }, foodComfort), true);
  assert.equal(allowsDeal(null, foodComfort), false);
});
