(function exposePools(root) {
  'use strict';
  function create(options) {
    let snapshot = null; let error = ''; let loading = false; let joining = false; let pendingRefresh = false;
    const mounts = [...document.querySelectorAll('[data-match-pool]')];
    const node = (tag, text, className) => { const item = document.createElement(tag); if (text) item.textContent = text; if (className) item.className = className; return item; };
    const time = value => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    function render() {
      for (const mount of mounts) {
        mount.replaceChildren();
        mount.className = 'match-pool-card';
        const member = snapshot?.membership;
        const state = snapshot?.state;
        mount.append(node('p', member ? "YOU’RE IN · TEAM LOCKED" : state === 'open' ? 'MATCHDAY REGISTRATION · OPEN' : 'YOUR NEXT MATCHDAY', 'pool-kicker'));
        mount.append(node('h2', member ? `${member.team}. Your side for this match.` : state === 'closed' ? 'This pool is closed.' : 'Get in before kickoff.'));
        const count = snapshot?.total_members;
        mount.append(node('p', error || (!snapshot ? 'Loading match registration…' : state === 'unscheduled' ? 'Registration will appear here once kickoff is scheduled. Watch this page for your next invitation.' : member ? 'You can claim eligible offers when a confirmed moment unlocks them. Your side cannot be changed for this match.' : state === 'closed' ? 'You missed this match’s registration window. Watch for the next invitation here. Only registered pool members can enter this match’s lobby.' : state === 'upcoming' ? `Registration opens ${time(snapshot.pool.opens_at)}. Come back to choose your side.` : 'Choose one side and join the offer pool before registration closes.')));
        if (Number.isFinite(count)) mount.append(node('strong', `${count.toLocaleString()} fan${count === 1 ? '' : 's'} joined · Arsenal ${snapshot.team_counts.Arsenal} / Chelsea ${snapshot.team_counts.Chelsea}`, 'pool-count'));
        if (snapshot?.pool) {
          mount.append(node('p', `Kickoff ${time(snapshot.pool.kickoff_at)}`, 'pool-timing'));
          mount.append(node('p', `${state === 'closed' ? 'Registration closed' : 'Registration closes'} ${time(snapshot.pool.closes_at)}`, 'pool-timing'));
        }
        if (snapshot?.merchants?.length) mount.append(node('p', `Participating demo merchants: ${snapshot.merchants.map(item => item.name).join(' · ')}`, 'pool-merchants'));
        if (member && options.allowEnter) { const link = node('a', 'ENTER MATCH LOBBY →'); link.href = '/?view=lobby'; mount.append(link); }
        if (!member && state === 'open' && options.user) {
          const label = node('label', 'Your side for this match');
          const select = node('select'); select.setAttribute('aria-label', 'Your pool team');
          for (const team of ['Arsenal', 'Chelsea']) { const option = node('option', team); option.value = team; select.append(option); }
          select.value = options.getTeam() || 'Arsenal'; label.append(select); mount.append(label);
          const button = node('button', joining ? 'Joining…' : 'JOIN OFFER POOL →'); button.type = 'button'; button.disabled = joining;
          button.onclick = () => join(select.value); mount.append(button);
        } else if (!member && state === 'open') {
          const link = node('a', 'SIGN IN TO JOIN THE POOL →'); link.href = '/auth'; mount.append(link);
        }
        if (error) { const retry = node('button', loading ? 'Loading…' : 'Retry registration'); retry.type = 'button'; retry.disabled = loading; retry.onclick = refresh; mount.append(retry); }
        mount.append(node('small', 'Pool membership is free. Offers have separate stock, claim limits and deadlines. A place in the pool does not guarantee a coupon.'));
      }
    }
    async function refresh() {
      if (loading) { pendingRefresh = true; return; }
      loading = true;
      try {
        const response = await fetch('/api/pool', { cache: 'no-store' }); const data = await response.json();
        if (response.status === 401) { location.replace('/auth'); return; }
        if (!response.ok) throw new Error(data.error || 'Match registration could not be loaded.');
        snapshot = data; error = ''; options.changed(snapshot);
        if (data.pool) {
          const now = data.server_now;
          if (data.state === 'open') options.invitation({ id: `pool:${data.pool.match_id}:${data.pool.opens_at}`, title: 'Your matchday invitation is open', body: `Join before ${time(data.pool.closes_at)}. Kickoff ${time(data.pool.kickoff_at)}.` });
          clearTimeout(boundaryTimer);
          const boundary = [Date.parse(data.pool.opens_at), Date.parse(data.pool.closes_at)].find(value => value > now);
          if (boundary) boundaryTimer = setTimeout(refresh, Math.min(2147483647, boundary - now + 50));
        }
      } catch (failure) { error = failure.message; snapshot = null; options.changed(null); }
      finally { loading = false; render(); if (pendingRefresh) { pendingRefresh = false; refresh(); } }
    }
    let boundaryTimer = null;
    async function join(team) {
      joining = true; render();
      try {
        const response = await fetch('/api/pool/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ team }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to join this pool.');
        await refresh(); options.joined(data.team_choice); options.toast('You’re in · your team is locked for this match');
      } catch (failure) { options.toast(failure.message); await refresh(); }
      finally { joining = false; render(); }
    }
    options.socket.on('pool:changed', refresh);
    options.socket.on('connect', refresh);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    render(); refresh();
    return { refresh, render };
  }
  root.PlayPulsePool = { create };
})(globalThis);
