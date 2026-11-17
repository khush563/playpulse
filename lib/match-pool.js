'use strict';

function poolState(pool, now = Date.now()) {
  if (!pool?.kickoff_at) return 'unscheduled';
  if (pool.cancelled) return 'cancelled';
  if (now < Date.parse(pool.opens_at)) return 'upcoming';
  if (now >= Date.parse(pool.closes_at)) return 'closed';
  return 'open';
}
function validateSchedule(input, now = Date.now()) {
  const kickoff = typeof input?.kickoff_at === 'string' ? Date.parse(input.kickoff_at) : NaN;
  const windowMinutes = Number(input?.registration_minutes);
  if (!Number.isFinite(kickoff) || kickoff <= now || !Number.isInteger(windowMinutes) || windowMinutes < 60 || windowMinutes > 120) return { ok: false, error: 'Choose a future kickoff and a registration window between 60 and 120 minutes.' };
  return { ok: true, value: { kickoff_at: new Date(kickoff).toISOString(), registration_minutes: windowMinutes } };
}
function teamChoice(membership) {
  return membership ? { team: membership.team, match_id: membership.match_id, selected_at: Date.parse(membership.joined_at), locked: true } : null;
}
async function readPool(client, matchId) {
  const { data, error } = await client.rpc('playpulse_pool', { p_match_id: matchId });
  if (error) throw Object.assign(new Error('Match registration is temporarily unavailable. Please try again later.'), { status: 503 });
  return { ...data, state: poolState(data.pool, data.server_now) };
}
module.exports = { poolState, validateSchedule, teamChoice, readPool };
