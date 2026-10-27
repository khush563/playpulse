'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  addNotification,
  getState,
  setPreferences,
  markRead,
  markAllRead
} = require('../public/notifications.js');

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

function eventNotification(overrides = {}) {
  return {
    id: 'event:goal-001:confirmed', type: 'event', title: 'GOAL by Arsenal',
    body: 'Goal at 23′ · confirmed simulated match event.', target: 'match', referenceId: 'goal-001',
    ...overrides
  };
}

test('stable IDs deduplicate repeated event delivery', () => {
  const storage = memoryStorage();
  const first = addNotification(storage, eventNotification(), { now: 1000 });
  const duplicate = addNotification(storage, eventNotification(), { now: 2000 });
  assert.equal(first.added, true);
  assert.equal(first.announce, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(getState(storage).entries.length, 1);
  assert.equal(getState(storage).unreadCount, 1);
});

test('event and offer preferences filter their categories and remember suppressed duplicates', () => {
  const storage = memoryStorage();
  assert.equal(setPreferences(storage, { eventAlerts: false, offerAlerts: false, quietMode: false }).ok, true);
  const filtered = addNotification(storage, eventNotification(), { now: 1000 });
  assert.equal(filtered.filtered, true);
  assert.equal(getState(storage).entries.length, 0);
  setPreferences(storage, { eventAlerts: true, offerAlerts: true, quietMode: false });
  assert.equal(addNotification(storage, eventNotification(), { now: 2000 }).duplicate, true);

  const claim = addNotification(storage, eventNotification({ id: 'claim:001', type: 'claim', title: 'Offer claimed', target: 'order' }));
  assert.equal(claim.added, true);
  assert.equal(setPreferences(storage, { eventAlerts: true, quietMode: false }).ok, false);
});

test('quiet mode keeps inbox history but suppresses status announcements', () => {
  const storage = memoryStorage();
  setPreferences(storage, { eventAlerts: true, offerAlerts: true, quietMode: true });
  const result = addNotification(storage, eventNotification(), { now: 1000 });
  assert.equal(result.added, true);
  assert.equal(result.announce, false);
  assert.equal(getState(storage).entries.length, 1);
});

test('single and bulk read actions maintain the unread count', () => {
  const storage = memoryStorage();
  addNotification(storage, eventNotification(), { now: 1000 });
  addNotification(storage, eventNotification({ id: 'offer:001:active', type: 'offer', title: 'Offer active', target: 'offer' }), { now: 2000 });
  assert.equal(getState(storage).unreadCount, 2);
  assert.equal(markRead(storage, 'event:goal-001:confirmed').ok, true);
  assert.equal(getState(storage).unreadCount, 1);
  assert.equal(markAllRead(storage).ok, true);
  assert.equal(getState(storage).unreadCount, 0);
});
