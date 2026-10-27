'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWatchParty, joinWatchParty, leaveWatchParty, groupRewardProgress, publicWatchParty } = require('../lib/watch-party');

function createGroup() {
  const groups = new Map();
  const result = createWatchParty(groups, {
    user_id: 'local-owner', name: 'North London crew', match_id: 'arsenal-chelsea-local-demo', team: 'Arsenal', notifications_enabled: false
  }, { code: 'PP-001', now: 1000 });
  return { groups, group: result.group };
}

test('watch parties use actual unique local participants and idempotent joins', () => {
  const { groups, group } = createGroup();
  assert.equal(group.members.size, 1);
  assert.equal(joinWatchParty(groups, 'pp-001', { user_id: 'local-member-2' }, { now: 2000 }).duplicate, false);
  assert.equal(joinWatchParty(groups, 'PP-001', { user_id: 'local-member-2' }, { now: 3000 }).duplicate, true);
  assert.equal(group.members.size, 2);
  assert.equal(leaveWatchParty(groups, 'PP-001', { user_id: 'local-member-2' }).duplicate, false);
  assert.equal(group.members.size, 1);
  assert.equal(publicWatchParty(group, { userId: 'local-owner' }).member_count, 1);
});

test('group reward requires actual target progress and an eligible campaign with stock and budget', () => {
  const { groups, group } = createGroup();
  joinWatchParty(groups, 'PP-001', { user_id: 'local-member-2' });
  joinWatchParty(groups, 'PP-001', { user_id: 'local-member-3' });
  const eligible = { eligible: true, offer_id: 'offer-1', title: 'Local offer', discount_minor: 500, budget_remaining_minor: 500, remaining_quantity: 1 };
  assert.equal(groupRewardProgress(group, eligible).unlocked, true);
  assert.equal(groupRewardProgress(group, { ...eligible, budget_remaining_minor: 499 }).unlocked, false);
  assert.equal(groupRewardProgress(group, { ...eligible, remaining_quantity: 0 }).unlocked, false);
  assert.equal(groupRewardProgress(group, null).campaign_eligible, false);
});

test('watch party creation validates local identity, name, team, and match', () => {
  const groups = new Map();
  const invalid = createWatchParty(groups, { user_id: 'bad', name: '', match_id: 'wrong', team: 'Other' }, { code: 'PP-001' });
  assert.equal(invalid.ok, false);
  assert.equal(groups.size, 0);
});
