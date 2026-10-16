const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePolicy, allowedProfileNames, clampIntensity, clampWalkAwayDelay, uiView, DEFAULTS } = require('../electron/enterprise_policy');
const { exportBundle, importBundle } = require('../electron/settings_transfer');

test('no policy file: unmanaged defaults', () => {
  assert.deepEqual(parsePolicy(null), { ...DEFAULTS });
  assert.equal(uiView(parsePolicy(null)).managed, false);
});

test('policy values are validated; invalid ones are ignored', () => {
  const p = parsePolicy(JSON.stringify({
    minimumIntensity:150, presenceGateRequired:true, allowDisableProtection:false, allowQuit:'no',
    allowedProfiles:['Office', 42], maxWalkAwayLockDelayMs:500, lockProfiles:true, extra:'ignored'
  }));
  assert.equal(p.managed, true);
  assert.equal(p.minimumIntensity, 100);
  assert.equal(p.presenceGateRequired, true);
  assert.equal(p.allowDisableProtection, false);
  assert.equal(p.allowQuit, true); // not a boolean → default
  assert.deepEqual(p.allowedProfiles, ['Office']);
  assert.equal(p.maxWalkAwayLockDelayMs, null); // below 1 s → ignored
  assert.equal(p.lockProfiles, true);
  assert.equal(p.extra, undefined);
});

test('a broken policy file is reported, not fatal', () => {
  const p = parsePolicy('{not json');
  assert.equal(p.managed, true);
  assert.match(p.error, /Invalid policy/);
  assert.equal(p.allowDisableProtection, true);
});

test('policy helpers', () => {
  const p = parsePolicy(JSON.stringify({ minimumIntensity:60, maxWalkAwayLockDelayMs:6000, allowedProfiles:['Public', 'Office'] }));
  assert.equal(clampIntensity(p, 20), 60);
  assert.equal(clampIntensity(p, 80), 80);
  assert.equal(clampWalkAwayDelay(p, 15000), 6000);
  assert.equal(clampWalkAwayDelay(parsePolicy(null), 15000), 15000);
  assert.deepEqual(allowedProfileNames(p, ['Home', 'Office', 'Public']), ['Office', 'Public']);
  assert.deepEqual(allowedProfileNames(parsePolicy(JSON.stringify({ allowedProfiles:['Nope'] })), ['Home', 'Office']), ['Home']);
});

const DATA = {
  customProfiles:{ Cafe:{ curtainEffect:'pixelate', sensitivity:'strict', walkAwayLockDelay:4000, glancingCounts:true } },
  rules:[{ id:'r1', type:'time', profile:'Office', from:'09:00', to:'18:00', days:[1, 2, 3, 4, 5] }],
  autoSwitch:true, activeProfile:'Office', presenceGateEnabled:true, intensity:70,
  notAllowed:'dropped'
};

test('export → import round trip with only allow-listed keys', () => {
  const text = exportBundle(DATA, 'correct horse battery');
  assert.ok(!text.includes('Cafe') && !text.includes('pixelate'), 'bundle content is encrypted');
  const { settings } = importBundle(text, 'correct horse battery');
  assert.deepEqual(settings, {
    customProfiles:DATA.customProfiles, rules:DATA.rules, autoSwitch:true, activeProfile:'Office', presenceGateEnabled:true, intensity:70
  }); // notAllowed is dropped
});

test('wrong passphrase, tampering and foreign files are rejected', () => {
  const text = exportBundle(DATA, 'correct horse battery');
  assert.throws(() => importBundle(text, 'wrong passphrase'), /Wrong passphrase/);
  const bundle = JSON.parse(text);
  const flipped = Buffer.from(bundle.data, 'base64');
  flipped[0] ^= 1;
  assert.throws(() => importBundle(JSON.stringify({ ...bundle, data:flipped.toString('base64') }), 'correct horse battery'), /Wrong passphrase or damaged/);
  assert.throws(() => importBundle('{"format":"other"}', 'correct horse battery'), /Not a SmartScreen/);
  assert.throws(() => exportBundle(DATA, 'short'), /at least 8/);
});

test('biometric data can never be exported', () => {
  assert.throws(() => exportBundle({ ...DATA, rules:[{ embedding:[1, 2, 3] }] }, 'correct horse battery'), /biometric/);
  assert.throws(() => exportBundle({ customProfiles:{ x:{ note:'owner_face.enc' } } }, 'correct horse battery'), /biometric/);
});
