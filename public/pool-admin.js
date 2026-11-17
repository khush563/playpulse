(function poolAdmin() {
  'use strict';
  const host = document.querySelector('.body');
  const section = document.createElement('section'); section.className = 'match-pool-card';
  section.innerHTML = `<p class="pool-kicker">MATCHDAY OFFER POOL</p><h2>Schedule registration.</h2><p>The in-app invitation opens four hours before kickoff. Registration stays open for one or two hours. Once a fan joins, the schedule is locked.</p><form id="pool-schedule-form"><label>Kickoff · your local time<input id="pool-kickoff" type="datetime-local" required></label><label>Registration window<select id="pool-registration-minutes"><option value="120">2 hours</option><option value="60">1 hour</option></select></label><button type="submit">SAVE MATCH SCHEDULE</button></form><p id="pool-admin-status" role="status">Loading pool…</p><p id="pool-admin-counts"></p><small>Fan accounts and pool memberships persist. Match events, campaign activations and coupons remain a local simulation. External reminders are not sent.</small>`;
  host.prepend(section);
  const status = document.getElementById('pool-admin-status');
  async function refresh() {
    try {
      const response = await fetch('/api/pool', { cache: 'no-store' }); const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Pool unavailable.');
      status.textContent = data.pool ? `Registration ${data.state}. Kickoff ${new Date(data.pool.kickoff_at).toLocaleString()}.` : 'No kickoff scheduled yet.';
      document.getElementById('pool-admin-counts').textContent = `${data.total_members} unique accounts joined · Arsenal ${data.team_counts.Arsenal} · Chelsea ${data.team_counts.Chelsea}`;
      section.querySelector('button').disabled = data.total_members > 0;
    } catch (error) { status.textContent = error.message; }
  }
  document.getElementById('pool-schedule-form').onsubmit = async event => {
    event.preventDefault(); const button = event.currentTarget.querySelector('button'); button.disabled = true;
    try {
      const kickoff = new Date(document.getElementById('pool-kickoff').value);
      if (!Number.isFinite(kickoff.getTime()) || kickoff.getTime() <= Date.now()) throw new Error('Choose a future kickoff time.');
      const response = await fetch('/api/admin/pool/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kickoff_at: kickoff.toISOString(), registration_minutes: Number(document.getElementById('pool-registration-minutes').value) }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to save the schedule.');
      await refresh();
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  };
  refresh(); setInterval(refresh, 30000);
})();
