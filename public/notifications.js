(function exposeNotifications(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PlayPulseNotifications = api;
})(typeof globalThis === 'object' ? globalThis : this, function createNotificationApi() {
  const DATA_KEY = 'playpulse-notifications-v1';
  const TYPES = Object.freeze(['event', 'offer', 'claim', 'expiry', 'order']);
  const TARGETS = Object.freeze(['match', 'offer', 'order', 'profile']);
  const DEFAULT_PREFERENCES = Object.freeze({ eventAlerts: true, offerAlerts: true, quietMode: false });

  function emptyData() {
    return { preferences: { ...DEFAULT_PREFERENCES }, entries: [], seen: {} };
  }

  function readData(storage) {
    try {
      const raw = storage.getItem(DATA_KEY);
      if (!raw) return { ok: true, value: emptyData(), errors: [] };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
      return {
        ok: true,
        value: {
          preferences: normalizePreferences(parsed.preferences),
          entries: Array.isArray(parsed.entries) ? parsed.entries.filter(validEntry).slice(0, 50) : [],
          seen: parsed.seen && typeof parsed.seen === 'object' && !Array.isArray(parsed.seen) ? parsed.seen : {}
        },
        errors: []
      };
    } catch (_) {
      return { ok: false, value: emptyData(), errors: ['Saved notifications could not be read.'] };
    }
  }

  function writeData(storage, value) {
    try { storage.setItem(DATA_KEY, JSON.stringify(value)); return { ok: true, errors: [] }; }
    catch (_) { return { ok: false, errors: ['Notifications could not be saved in this browser.'] }; }
  }

  function setPreferences(storage, input) {
    const checked = validatePreferences(input);
    if (!checked.ok) return checked;
    const read = readData(storage);
    if (!read.ok) return read;
    read.value.preferences = checked.value;
    const written = writeData(storage, read.value);
    return written.ok ? { ok: true, preferences: checked.value, errors: [] } : written;
  }

  function addNotification(storage, input, options = {}) {
    const checked = validateNotification(input);
    if (!checked.ok) return checked;
    const read = readData(storage);
    if (!read.ok) return read;
    if (read.value.seen[input.id]) return { ok: true, added: false, duplicate: true, announce: false, entry: read.value.seen[input.id] };
    if ((input.type === 'event' && !read.value.preferences.eventAlerts)
      || (['offer', 'expiry'].includes(input.type) && !read.value.preferences.offerAlerts)) {
      read.value.seen[input.id] = { id: input.id, suppressed: true };
      const written = writeData(storage, read.value);
      return written.ok
        ? { ok: true, added: false, duplicate: false, filtered: true, announce: false, entry: null }
        : written;
    }
    const entry = {
      id: input.id,
      type: input.type,
      title: input.title.trim(),
      body: input.body.trim(),
      target: input.target,
      referenceId: input.referenceId || null,
      createdAt: new Date(options.now ?? Date.now()).toISOString(),
      read: false
    };
    read.value.seen[input.id] = entry;
    read.value.entries.unshift(entry);
    read.value.entries = read.value.entries.slice(0, 50);
    const written = writeData(storage, read.value);
    if (!written.ok) return written;
    return { ok: true, added: true, duplicate: false, filtered: false, announce: !read.value.preferences.quietMode, entry };
  }

  function markRead(storage, id) {
    const read = readData(storage);
    if (!read.ok) return read;
    const entry = read.value.entries.find(item => item.id === id);
    if (!entry) return { ok: false, errors: ['Notification was not found.'] };
    entry.read = true;
    if (read.value.seen[id]) read.value.seen[id].read = true;
    const written = writeData(storage, read.value);
    return written.ok ? { ok: true, entry, errors: [] } : written;
  }

  function markAllRead(storage) {
    const read = readData(storage);
    if (!read.ok) return read;
    for (const entry of read.value.entries) {
      entry.read = true;
      if (read.value.seen[entry.id]) read.value.seen[entry.id].read = true;
    }
    const written = writeData(storage, read.value);
    return written.ok ? { ok: true, errors: [] } : written;
  }

  function getState(storage) {
    const read = readData(storage);
    const entries = read.value.entries;
    return {
      ok: read.ok,
      errors: read.errors,
      preferences: read.value.preferences,
      entries,
      unreadCount: entries.filter(entry => !entry.read).length
    };
  }

  function clear(storage) {
    try { storage.removeItem(DATA_KEY); return { ok: true, errors: [] }; }
    catch (_) { return { ok: false, errors: ['Notifications could not be cleared.'] }; }
  }

  function normalizePreferences(input) {
    return {
      eventAlerts: typeof input?.eventAlerts === 'boolean' ? input.eventAlerts : DEFAULT_PREFERENCES.eventAlerts,
      offerAlerts: typeof input?.offerAlerts === 'boolean' ? input.offerAlerts : DEFAULT_PREFERENCES.offerAlerts,
      quietMode: typeof input?.quietMode === 'boolean' ? input.quietMode : DEFAULT_PREFERENCES.quietMode
    };
  }

  function validatePreferences(input) {
    if (!input || ['eventAlerts', 'offerAlerts', 'quietMode'].some(key => typeof input[key] !== 'boolean')) {
      return { ok: false, errors: ['Event alerts, offer alerts, and quiet mode must each be on or off.'] };
    }
    return { ok: true, value: normalizePreferences(input), errors: [] };
  }

  function validateNotification(input) {
    const errors = [];
    if (!input || typeof input.id !== 'string' || !/^[a-zA-Z0-9:_-]{3,160}$/.test(input.id)) errors.push('Notification needs a stable ID.');
    if (!TYPES.includes(input?.type)) errors.push('Notification type is invalid.');
    if (typeof input?.title !== 'string' || !input.title.trim() || input.title.trim().length > 100) errors.push('Notification title is required and must be at most 100 characters.');
    if (typeof input?.body !== 'string' || !input.body.trim() || input.body.trim().length > 240) errors.push('Notification body is required and must be at most 240 characters.');
    if (!TARGETS.includes(input?.target)) errors.push('Notification target is invalid.');
    return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
  }

  function validEntry(entry) {
    return entry && typeof entry.id === 'string' && TYPES.includes(entry.type) && TARGETS.includes(entry.target)
      && typeof entry.title === 'string' && typeof entry.body === 'string' && typeof entry.read === 'boolean';
  }

  return {
    DATA_KEY,
    TYPES,
    TARGETS,
    DEFAULT_PREFERENCES,
    readData,
    getState,
    setPreferences,
    addNotification,
    markRead,
    markAllRead,
    clear
  };
});
