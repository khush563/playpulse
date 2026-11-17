(async function invitations() {
  'use strict';
  const message = document.getElementById('session-message');
  let socket;
  try {
    const account = await window.PlayPulseAccount.load();
    if (!account.user) { location.replace('/auth'); return; }
    window.PlayPulseAccount.watch(account.user);
    document.getElementById('welcome').textContent = `${account.user.name || 'Welcome back'} · join your next offer pool here. Match lobbies are reserved for registered pool members.`;
    socket = io();
    socket.on('connect_error', () => { message.textContent = 'Updates are disconnected. Refresh invitations to check your session.'; });
    socket.on('connect', () => { message.textContent = ''; });
    const controller = window.PlayPulsePool.create({
      socket, user: account.user, allowEnter: true, getTeam: () => 'Arsenal',
      toast(text) { message.textContent = text; },
      joined() { location.assign('/?view=lobby'); },
      invitation(input) { document.getElementById('invitation-notice').textContent = `${input.title}. ${input.body}`; },
      changed(value) {
        const notice = document.getElementById('invitation-notice');
        notice.textContent = !value ? 'Invitations are temporarily unavailable. Try refreshing.'
          : value.membership ? 'You joined this pool. Your match lobby is ready above.'
            : value.state === 'closed' ? 'Registration has closed. You can see participating merchants above; watch here for the next pool.'
              : value.state === 'upcoming' ? 'Your next invitation is scheduled. Registration times are shown above.'
                : value.state === 'open' ? 'Your matchday invitation is open. Choose your side above before registration closes.'
                  : 'No invitation is open yet. Come back here for the next match announcement.';
      }
    });
    document.getElementById('refresh').onclick = () => controller.refresh();
    document.getElementById('sign-out').onclick = () => window.PlayPulseAccount.logout().catch(error => { message.textContent = error.message; });
  } catch (_) {
    if (socket) socket.disconnect();
    document.getElementById('welcome').textContent = 'Unable to load your account.';
    message.textContent = 'Reload this page to restore your session.';
  }
})();
