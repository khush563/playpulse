const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('browser preferences are separated by account and cannot replace the server-derived user ID', () => {
  const saved = new Map();
  const context = vm.createContext({ localStorage: { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/account.js'), 'utf8'), context);
  const api = context.PlayPulseAccount;
  const one = api.storageFor({ id: 'account-one' });
  const two = api.storageFor({ id: 'account-two' });
  const guest = api.storageFor(null);
  one.setItem('preferences', 'Arsenal');
  two.setItem('preferences', 'Chelsea');
  guest.setItem('preferences', 'Guest preview');
  assert.equal(one.getItem('preferences'), 'Arsenal');
  assert.equal(two.getItem('preferences'), 'Chelsea');
  assert.equal(guest.getItem('preferences'), 'Guest preview');
  one.setItem('playpulse-local-user-v1', 'local-attacker');
  one.removeItem('playpulse-local-user-v1');
  assert.equal(one.getItem('playpulse-local-user-v1'), 'local-account-one');
  assert.equal(two.getItem('playpulse-local-user-v1'), 'local-account-two');
});
