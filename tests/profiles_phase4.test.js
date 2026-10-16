const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { normalizePolicies } = require('../electron/policies');
const store = require('../electron/profile_store');
const { matchRule, resolveRule, createAutoSwitcher, parseNetshSsid } = require('../electron/profile_rules');

const POLICIES = normalizePolicies(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'policies.json'), 'utf8')));
const BUILT_INS = Object.keys(POLICIES.profiles);

test('custom profile from presets uses the built-in timings of its sensitivity', () => {
  let user = store.emptyUserProfiles();
  user = store.saveCustom(user, 'Cafe', { curtainEffect:'pixelate', sensitivity:'strict', walkAwayLockDelay:4000, glancingCounts:true }, BUILT_INS);
  const merged = store.mergePolicies(POLICIES, user);
  assert.deepEqual(Object.keys(merged.profiles), ['Home', 'Office', 'Public', 'Cafe']);
  const cafe = merged.profiles.Cafe;
  assert.equal(cafe.curtainEffect, 'pixelate');
  assert.equal(cafe.walkAwayLockDelay, 4000);
  assert.deepEqual(cafe.escalation, POLICIES.profiles.Public.escalation);
  assert.equal(cafe.threatMultiplier, POLICIES.profiles.Public.threatMultiplier);
});

test('built-ins are read-only; invalid choices fall back to safe defaults', () => {
  const user = store.emptyUserProfiles();
  assert.throws(() => store.saveCustom(user, 'Office', {}, BUILT_INS), /Built-in/);
  assert.throws(() => store.saveCustom(user, '../x', {}, BUILT_INS), /name/);
  const saved = store.saveCustom(user, 'X', { curtainEffect:'neon', sensitivity:'paranoid', walkAwayLockDelay:123, glancingCounts:'yes' }, BUILT_INS);
  assert.deepEqual(saved.custom.X, { curtainEffect:'blackout', sensitivity:'normal', walkAwayLockDelay:6000, glancingCounts:true });
  assert.equal(store.describeProfile('Office', POLICIES, user).readOnly, true);
  assert.equal(store.describeProfile('Home', POLICIES, user).sensitivity, 'relaxed');
  assert.equal(store.describeProfile('X', POLICIES, saved).readOnly, false);
});

test('a custom name cannot shadow a built-in even if the file says so', () => {
  const user = store.normalizeUserProfiles({ custom:{ Office:{ curtainEffect:'blur' } } });
  assert.equal(store.mergePolicies(POLICIES, user).profiles.Office.curtainEffect, 'blackout');
});

test('deleting a custom profile also removes its rules', () => {
  let user = store.saveCustom(store.emptyUserProfiles(), 'Cafe', {}, BUILT_INS);
  user = { ...user, rules:[{ id:'r1', type:'wifi', profile:'Cafe', ssid:'CafeNet' }, { id:'r2', type:'wifi', profile:'Home', ssid:'HomeNet' }] };
  user = store.deleteCustom(user, 'Cafe');
  assert.deepEqual(Object.keys(user.custom), []);
  assert.deepEqual(user.rules.map((r) => r.id), ['r2']);
  assert.throws(() => store.deleteCustom(user, 'Home'), /custom/);
});

test('rule validation', () => {
  assert.equal(store.normalizeRule({ id:'a', type:'wifi', profile:'Home', ssid:'' }), null);
  assert.equal(store.normalizeRule({ id:'a', type:'time', profile:'Home', from:'25:00', to:'06:00' }), null);
  assert.deepEqual(store.normalizeRule({ id:'a', type:'time', profile:'Office', from:'09:00', to:'18:00', days:[1, 2, 9] }).days, [1, 2]);
  assert.equal(store.normalizeRule({ id:'bad id!', type:'wifi', profile:'Home', ssid:'x' }), null);
});

const at = (iso) => new Date(iso);
const WORK = { id:'work', type:'time', profile:'Office', from:'09:00', to:'18:00', days:[1, 2, 3, 4, 5] };
const NIGHT = { id:'night', type:'time', profile:'Home', from:'22:00', to:'06:00', days:[5] }; // Friday night
const WIFI = { id:'home-wifi', type:'wifi', profile:'Home', ssid:'RoshanHome' };

test('time windows, weekdays and overnight windows', () => {
  assert.equal(matchRule(WORK, { now:at('2026-10-16T10:00:00') }), true);  // Friday 10:00
  assert.equal(matchRule(WORK, { now:at('2026-10-16T18:00:00') }), false); // end is exclusive
  assert.equal(matchRule(WORK, { now:at('2026-10-17T10:00:00') }), false); // Saturday
  assert.equal(matchRule(NIGHT, { now:at('2026-10-16T23:30:00') }), true);  // Friday 23:30
  assert.equal(matchRule(NIGHT, { now:at('2026-10-17T05:00:00') }), true);  // Saturday 05:00 belongs to Friday night
  assert.equal(matchRule(NIGHT, { now:at('2026-10-17T07:00:00') }), false);
  assert.equal(matchRule(WIFI, { ssid:'RoshanHome' }), true);
  assert.equal(matchRule(WIFI, { ssid:null }), false);
});

test('first matching rule wins; rules for missing profiles are ignored', () => {
  const rules = [{ ...WIFI, profile:'Gone' }, WIFI, WORK];
  assert.equal(resolveRule(rules, { ssid:'RoshanHome', now:at('2026-10-16T10:00:00') }, BUILT_INS).id, 'home-wifi');
  assert.equal(resolveRule([WORK], { now:at('2026-10-18T10:00:00') }, BUILT_INS), null);
});

test('auto-switcher applies on context change and respects a manual choice in the same context', async () => {
  let current = 'Office';
  let ctx = { ssid:'RoshanHome', now:at('2026-10-16T20:00:00') };
  let enabled = true;
  const applied = [];
  const s = createAutoSwitcher({
    getRules:() => [WIFI, WORK], getContext:async () => ctx, isEnabled:() => enabled,
    getAvailableProfiles:() => BUILT_INS, getCurrent:() => current,
    apply:(p, r) => { applied.push(`${p}:${r.id}`); current = p; }
  });
  await s.evaluate();
  assert.deepEqual(applied, ['Home:home-wifi']);
  current = 'Public'; // user picks Public manually at home
  await s.evaluate();
  assert.equal(current, 'Public');
  ctx = { ssid:'CorpWiFi', now:at('2026-10-19T10:00:00') }; // Monday at work
  await s.evaluate();
  assert.deepEqual(applied, ['Home:home-wifi', 'Office:work']);
  enabled = false;
  ctx = { ssid:'RoshanHome', now:at('2026-10-19T20:00:00') };
  assert.equal(await s.evaluate(), null);
});

test('netsh output parsing', () => {
  const out = [
    'There is 1 interface on the system:',
    '    Name                   : Wi-Fi',
    '    State                  : connected',
    '    SSID                   : Roshan Home 5G',
    '    BSSID                  : aa:bb:cc:dd:ee:ff',
    ''
  ].join('\r\n');
  assert.equal(parseNetshSsid(out), 'Roshan Home 5G');
  assert.equal(parseNetshSsid('There is 1 interface on the system:\r\n    State : disconnected'), null);
});
