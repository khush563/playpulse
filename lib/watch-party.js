'use strict';

const GROUP_TARGET = 3;
const GROUP_LIMIT = 8;

function createWatchParty(groups, input, options = {}) {
  const checked = validateCreate(input);
  if (!checked.ok) return checked;
  const code = String(options.code || '').toUpperCase();
  if (!/^[A-Z0-9-]{4,16}$/.test(code) || groups.has(code)) return { ok: false, status: 409, error: 'A unique local group code could not be created.' };
  const now = options.now ?? Date.now();
  const group = {
    code,
    name: input.name.trim(),
    match_id: input.match_id,
    team: input.team,
    creator_user_id: input.user_id,
    created_at: now,
    members: new Map([[input.user_id, { user_id: input.user_id, joined_at: now, notifications_enabled: Boolean(input.notifications_enabled) }]])
  };
  groups.set(code, group);
  return { ok: true, status: 201, duplicate: false, group };
}

function joinWatchParty(groups, codeInput, input, options = {}) {
  const code = String(codeInput || '').toUpperCase();
  const group = groups.get(code);
  if (!group) return { ok: false, status: 404, error: 'Local watch party was not found.' };
  if (!validLocalUser(input?.user_id)) return { ok: false, status: 400, error: 'A valid local user identifier is required.' };
  if (group.members.has(input.user_id)) return { ok: true, status: 200, duplicate: true, group };
  if (group.members.size >= GROUP_LIMIT) return { ok: false, status: 409, error: `This local watch party is limited to ${GROUP_LIMIT} participants.` };
  group.members.set(input.user_id, { user_id: input.user_id, joined_at: options.now ?? Date.now(), notifications_enabled: Boolean(input.notifications_enabled) });
  return { ok: true, status: 200, duplicate: false, group };
}

function leaveWatchParty(groups, codeInput, input) {
  const code = String(codeInput || '').toUpperCase();
  const group = groups.get(code);
  if (!group) return { ok: false, status: 404, error: 'Local watch party was not found.' };
  if (!validLocalUser(input?.user_id)) return { ok: false, status: 400, error: 'A valid local user identifier is required.' };
  const removed = group.members.delete(input.user_id);
  return { ok: true, status: 200, duplicate: !removed, group };
}

function groupRewardProgress(group, campaign) {
  const participantCount = group?.members instanceof Map ? group.members.size : 0;
  const campaignEligible = Boolean(campaign?.eligible)
    && Number.isSafeInteger(campaign.budget_remaining_minor)
    && Number.isSafeInteger(campaign.discount_minor)
    && campaign.discount_minor > 0
    && campaign.budget_remaining_minor >= campaign.discount_minor
    && (campaign.remaining_quantity === null || (Number.isSafeInteger(campaign.remaining_quantity) && campaign.remaining_quantity > 0));
  return {
    participant_count: participantCount,
    target: GROUP_TARGET,
    progress: Math.min(participantCount, GROUP_TARGET),
    campaign_eligible: campaignEligible,
    unlocked: campaignEligible && participantCount >= GROUP_TARGET,
    offer_id: campaignEligible ? campaign.offer_id : null,
    offer_title: campaignEligible ? campaign.title : null,
    reason: campaignEligible
      ? (participantCount >= GROUP_TARGET ? 'Actual local member target reached while an eligible funded campaign has capacity.' : `${GROUP_TARGET - participantCount} more actual local member${GROUP_TARGET - participantCount === 1 ? '' : 's'} needed.`)
      : 'No eligible funded campaign with stock and budget is currently available for this group.'
  };
}

function publicWatchParty(group, options = {}) {
  const userId = options.userId;
  return {
    code: group.code,
    name: group.name,
    match_id: group.match_id,
    team: group.team,
    member_count: group.members.size,
    member_limit: GROUP_LIMIT,
    current_user_joined: validLocalUser(userId) ? group.members.has(userId) : false,
    notifications_enabled: validLocalUser(userId) && group.members.has(userId) ? group.members.get(userId).notifications_enabled : false,
    created_at: group.created_at,
    invite_path: `/?group=${encodeURIComponent(group.code)}`,
    reward: options.reward || groupRewardProgress(group, null),
    demo: true
  };
}

function validateCreate(input) {
  if (!validLocalUser(input?.user_id)) return { ok: false, status: 400, error: 'A valid local user identifier is required.' };
  if (typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.trim().length > 40) return { ok: false, status: 400, error: 'Group name must be 2–40 characters.' };
  if (input.match_id !== 'arsenal-chelsea-local-demo') return { ok: false, status: 400, error: 'Choose the current local demo match.' };
  if (!['Arsenal', 'Chelsea'].includes(input.team)) return { ok: false, status: 400, error: 'Choose Arsenal or Chelsea for this local group.' };
  return { ok: true };
}

function validLocalUser(value) {
  return typeof value === 'string' && /^local-[a-zA-Z0-9-]{4,100}$/.test(value);
}

module.exports = {
  GROUP_TARGET,
  GROUP_LIMIT,
  createWatchParty,
  joinWatchParty,
  leaveWatchParty,
  groupRewardProgress,
  publicWatchParty
};
