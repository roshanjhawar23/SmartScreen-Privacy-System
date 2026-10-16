const test = require('node:test');
const assert = require('node:assert/strict');
const { createPresenceGate, gateSettings, STATES } = require('../electron/presence_gate');
const { createFakeTimers } = require('./helpers/fake_timers');

const OWNER = { owners:1, unknown:0, ownerScore:0.68 };

function setup(gate = {}, extra = {}){
  const timers = createFakeTimers(0);
  const logs = [];
  const changes = [];
  const locks = [];
  const g = createPresenceGate({
    getSettings:() => ({ recognitionThreshold:0.363, presenceGate:{ ...gate }, ...extra }),
    onChange:(s) => changes.push(s),
    log:(l) => logs.push(l),
    lock:(r) => locks.push(r),
    timers
  });
  return { g, timers, logs, changes, locks };
}

// Owner updates every `every` ms (the backend re-emits ~400 ms).
function owner(t, count, every = 400, payload = OWNER){
  for(let i = 0; i < count; i++){
    t.g.update('OWNER_PRESENT', payload);
    if(i < count - 1) t.timers.advance(every);
  }
}

function revealed(){
  const t = setup();
  t.g.start();
  owner(t, 4); // 0, 400, 800, 1200 ms
  assert.equal(t.g.state, STATES.REVEALED);
  return t;
}

test('settings defaults', () => {
  assert.deepEqual(gateSettings({}), {
    enabled:true, revealConfirmMs:1200, revealConfirmUpdates:3, absenceGraceMs:1500,
    failsafeLockMs:0, curtainEffect:'blackout', minOwnerScore:0.363
  });
  assert.equal(gateSettings({ presenceGate:{ curtainEffect:'nope', revealConfirmUpdates:0 } }).curtainEffect, 'blackout');
  assert.equal(gateSettings({ presenceGate:{ revealConfirmUpdates:0 } }).revealConfirmUpdates, 1);
});

test('rule 1: enabling protection starts concealed, before any backend state', () => {
  const t = setup();
  assert.equal(t.g.state, STATES.DISABLED);
  assert.equal(t.g.curtain, false);
  t.g.start();
  assert.equal(t.g.state, STATES.CONCEALED);
  assert.equal(t.g.curtain, true);
  assert.deepEqual(t.logs, ['PRESENCE_GATE|CONCEALED|reason=protection-enabled']);
  assert.equal(t.changes.at(-1).curtain, true);
  assert.equal(t.changes.at(-1).effect, 'blackout');
});

test('rule 2: reveal needs N consecutive owner updates AND the confirm time', () => {
  const t = setup();
  t.g.start();
  owner(t, 3, 100); // 3 updates in 200 ms: count met, time not
  assert.equal(t.g.state, STATES.VERIFYING);
  assert.equal(t.g.curtain, true);
  t.timers.advance(1000); // time passes, but no new update yet: still verifying
  assert.equal(t.g.state, STATES.VERIFYING);
  t.g.update('OWNER_PRESENT', OWNER);
  assert.equal(t.g.state, STATES.REVEALED);
  assert.equal(t.g.curtain, false);

  const slow = setup({ revealConfirmUpdates:5 });
  slow.g.start();
  owner(slow, 4, 1000); // time met, count not
  assert.equal(slow.g.state, STATES.VERIFYING);
  slow.g.update('OWNER_PRESENT', OWNER);
  assert.equal(slow.g.state, STATES.REVEALED);
});

test('rule 2: any non-owner update resets the count', () => {
  for(const [state, payload] of [
    ['NO_USER', {}],
    ['UNKNOWN_PERSON', {}],
    ['OWNER_PRESENT', { owners:1, unknown:0, ownerScore:0.2 }] // below threshold
  ]){
    const t = setup();
    t.g.start();
    owner(t, 3);
    t.g.update(state, payload);
    assert.equal(t.g.state, STATES.CONCEALED, state);
    owner(t, 3); // 800 ms since restart: not yet
    assert.equal(t.g.state, STATES.VERIFYING, state);
    t.timers.advance(400);
    t.g.update('OWNER_PRESENT', OWNER);
    assert.equal(t.g.state, STATES.REVEALED, state);
  }
});

test('rule 3: unknown states never reveal and conceal immediately when revealed', () => {
  for(const threat of ['UNKNOWN_PERSON', 'UNKNOWN_GROUP', 'OWNER_AND_UNKNOWN']){
    const t = setup();
    t.g.start();
    for(let i = 0; i < 20; i++){ t.g.update(threat, { owners:1, unknown:1, ownerScore:0.9 }); t.timers.advance(400); }
    assert.equal(t.g.state, STATES.CONCEALED, threat);

    const r = revealed();
    r.g.update(threat, {});
    assert.equal(r.g.state, STATES.CONCEALED, threat);
    assert.equal(r.logs.at(-1), `PRESENCE_GATE|CONCEALED|reason=threat-${threat.toLowerCase()}`);
  }
});

test('rule 3: an owner update that also has unknown faces does not count', () => {
  const t = setup();
  t.g.start();
  owner(t, 10, 400, { owners:1, unknown:1, ownerScore:0.9 });
  assert.notEqual(t.g.state, STATES.REVEALED);
});

test('rule 4: no user while revealed → absence grace → concealed', () => {
  const t = revealed();
  t.g.update('NO_USER');
  assert.equal(t.g.state, STATES.ABSENCE_GRACE);
  assert.equal(t.g.curtain, false);
  t.timers.advance(1499);
  assert.equal(t.g.state, STATES.ABSENCE_GRACE);
  t.timers.advance(1);
  assert.equal(t.g.state, STATES.CONCEALED);
  assert.equal(t.logs.at(-1), 'PRESENCE_GATE|CONCEALED|reason=owner-absent');
});

test('rule 4: detection flicker within the grace stays revealed', () => {
  const t = revealed();
  t.g.update('NO_USER');
  t.timers.advance(700);
  t.g.update('OWNER_PRESENT', OWNER);
  assert.equal(t.g.state, STATES.REVEALED);
  t.timers.advance(5000);
  assert.equal(t.g.state, STATES.REVEALED);
  assert.equal(t.timers.pendingCount, 0);
});

test('rule 5: failures enter FAILSAFE from any active state and stay there', () => {
  for(const [kind, expected] of [
    ['CAMERA_ERROR', 'camera-error'],
    ['AI_UNAVAILABLE', 'ai-unavailable'],
    ['SOMETHING_NEW', 'unknown-state-SOMETHING_NEW']
  ]){
    const t = revealed();
    t.g.update(kind);
    assert.equal(t.g.state, STATES.FAILSAFE, kind);
    assert.equal(t.g.curtain, true);
    assert.equal(t.logs.at(-1), `PRESENCE_GATE|FAILSAFE|reason=${expected}`);
    owner(t, 10); // owner updates do not leave FAILSAFE without a retry
    assert.equal(t.g.state, STATES.FAILSAFE, kind);
  }
  const w = revealed();
  w.g.failsafe('watchdog-timeout');
  assert.equal(w.g.state, STATES.FAILSAFE);
  const e = setup();
  e.g.start();
  e.g.failsafe('backend-exit');
  assert.equal(e.g.state, STATES.FAILSAFE);
});

test('rule 5: retry, then owner verification leaves FAILSAFE', () => {
  const t = revealed();
  t.g.failsafe('camera-error');
  assert.equal(t.g.retry(), true);
  assert.equal(t.g.state, STATES.CONCEALED);
  assert.equal(t.g.curtain, true);
  owner(t, 4);
  assert.equal(t.g.state, STATES.REVEALED);
  assert.equal(t.g.retry(), false); // only from FAILSAFE
});

test('rule 5: disabling protection leaves FAILSAFE', () => {
  const t = revealed();
  t.g.failsafe('camera-error');
  t.g.stop('protection-disabled');
  assert.equal(t.g.state, STATES.DISABLED);
  assert.equal(t.g.curtain, false);
});

test('rule 5: optional failsafe lock', () => {
  const off = revealed();
  off.g.failsafe('camera-error');
  off.timers.advance(600000);
  assert.deepEqual(off.locks, []);

  const t = setup({ failsafeLockMs:30000 });
  t.g.start();
  t.g.failsafe('camera-error');
  t.timers.advance(29999);
  assert.deepEqual(t.locks, []);
  t.timers.advance(1);
  assert.deepEqual(t.locks, ['presence-gate-failsafe']);

  const cancelled = setup({ failsafeLockMs:30000 });
  cancelled.g.start();
  cancelled.g.failsafe('camera-error');
  cancelled.g.retry();
  cancelled.timers.advance(60000);
  assert.deepEqual(cancelled.locks, []);
});

test('rule 6: the curtain only comes down via owner verification or stop; toggle is locked while active', () => {
  const t = setup();
  t.g.start();
  assert.equal(t.g.setEnabled(false), false);
  assert.equal(t.g.state, STATES.CONCEALED);
  t.g.stop();
  assert.equal(t.g.setEnabled(false), true);
});

test('rule 7: session lock, unlock and resume re-conceal; reveal again needs verification', () => {
  for(const event of ['sessionLocked', 'sessionUnlocked', 'resumed']){
    const t = revealed();
    t.g[event]();
    assert.equal(t.g.state, STATES.CONCEALED, event);
    owner(t, 4);
    assert.equal(t.g.state, STATES.REVEALED, event);
  }
  const f = revealed();
  f.g.failsafe('camera-error');
  f.g.sessionUnlocked();
  assert.equal(f.g.state, STATES.FAILSAFE); // unlock never clears a failure
});

test('rule 8: curtain effect comes from settings', () => {
  for(const effect of ['blackout', 'blur', 'pixelate']){
    const t = setup({ curtainEffect:effect });
    t.g.start();
    assert.equal(t.changes.at(-1).effect, effect);
  }
});

test('rule 9: every transition is logged', () => {
  const t = revealed();
  t.g.update('NO_USER');
  t.timers.advance(1500);
  t.g.failsafe('camera-error');
  t.g.stop();
  assert.deepEqual(t.logs, [
    'PRESENCE_GATE|CONCEALED|reason=protection-enabled',
    'PRESENCE_GATE|VERIFYING|reason=owner-detected',
    'PRESENCE_GATE|REVEALED|reason=owner-verified',
    'PRESENCE_GATE|ABSENCE_GRACE|reason=no-user',
    'PRESENCE_GATE|CONCEALED|reason=owner-absent',
    'PRESENCE_GATE|FAILSAFE|reason=camera-error',
    'PRESENCE_GATE|DISABLED|reason=protection-disabled'
  ]);
});

test('toggle off: no curtain for absence or threats, but failures still fail closed', () => {
  const t = setup({ enabled:false });
  t.g.start();
  assert.equal(t.g.state, STATES.DISABLED);
  assert.equal(t.g.curtain, false);
  t.g.update('UNKNOWN_PERSON');
  t.g.update('NO_USER');
  assert.equal(t.g.curtain, false);

  t.g.update('CAMERA_ERROR');
  assert.equal(t.g.state, STATES.FAILSAFE);
  assert.equal(t.g.curtain, true);
  t.g.retry();
  assert.equal(t.g.curtain, true); // still needs verification after the retry
  owner(t, 4);
  assert.equal(t.g.state, STATES.DISABLED);
  assert.equal(t.g.curtain, false);
});

test('updates are ignored while protection is off', () => {
  const t = setup();
  t.g.update('CAMERA_ERROR');
  t.g.failsafe('x');
  assert.equal(t.g.state, STATES.DISABLED);
  assert.deepEqual(t.logs, []);
});
