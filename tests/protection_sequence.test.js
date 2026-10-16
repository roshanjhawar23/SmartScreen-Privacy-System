const test = require('node:test');
const assert = require('node:assert/strict');
const { createProtectionSequence } = require('../electron/protection_sequence');
const { createFakeTimers } = require('./helpers/fake_timers');

function setup(settings = {}) {
  const timers = createFakeTimers(1000);
  const actions = [];
  const statuses = [];
  const locks = [];
  const logs = [];
  let monitoring = true;
  const seq = createProtectionSequence({
    getSettings: () => ({ walkAwayLockDelay: 6000, walkAwayFocusDelay: 3000, intruderFocusDelay: 3000, intruderLockDelay: 5000, ...settings }),
    isMonitoring: () => monitoring,
    sendAction: (action, reason) => actions.push(`${action}:${reason}`),
    sendWalkAwayStatus: (phase) => statuses.push(phase),
    log: (m) => logs.push(m),
    lock: (reason) => locks.push(reason),
    timers
  });
  return { seq, timers, actions, statuses, locks, logs, setMonitoring: (v) => { monitoring = v; } };
}

test('walk-away: blur, focus, then lock', () => {
  const t = setup();
  t.seq.updateForState('NO_USER');
  assert.deepEqual(t.actions, ['BLUR:walk-away']);
  t.timers.advance(3000);
  assert.deepEqual(t.actions, ['BLUR:walk-away', 'FOCUS:walk-away']);
  t.timers.advance(3000);
  assert.deepEqual(t.locks, ['walk-away']);
  assert.equal(t.actions.at(-1), 'LOCKING:walk-away');
  assert.ok(t.statuses.includes('EXPIRED'));
  assert.equal(t.timers.pendingCount, 0);
});

test('walk-away is cancelled when the owner returns', () => {
  const t = setup();
  t.seq.updateForState('NO_USER');
  t.timers.advance(2000);
  t.seq.updateForState('OWNER_PRESENT');
  t.timers.advance(10000);
  assert.deepEqual(t.locks, []);
  assert.equal(t.actions.at(-1), 'CLEAR:owner-returned');
  assert.equal(t.timers.pendingCount, 0);
});

test('repeated NO_USER does not re-arm', () => {
  const t = setup();
  t.seq.updateForState('NO_USER');
  t.timers.advance(4000);
  t.seq.updateForState('NO_USER');
  t.timers.advance(2000);
  assert.deepEqual(t.locks, ['walk-away']);
});

test('threat: blur, focus, lock; overrides walk-away', () => {
  const t = setup();
  t.seq.updateForState('NO_USER');
  t.seq.updateForState('UNKNOWN_PERSON');
  assert.equal(t.seq.active, 'THREAT');
  t.timers.advance(3000);
  assert.ok(t.actions.includes('FOCUS:threat'));
  t.timers.advance(2000);
  assert.deepEqual(t.locks, ['privacy-threat']);
});

test('no sequences without a running monitor', () => {
  const t = setup();
  t.setMonitoring(false);
  t.seq.updateForState('NO_USER');
  t.seq.updateForState('UNKNOWN_GROUP');
  assert.deepEqual(t.actions, []);
});

test('noUserLockEnabled=false disables walk-away; intruderDetectionEnabled=false disables threat', () => {
  const t = setup({ noUserLockEnabled: false, intruderDetectionEnabled: false });
  t.seq.updateForState('NO_USER');
  t.seq.updateForState('UNKNOWN_PERSON');
  t.timers.advance(20000);
  assert.deepEqual(t.actions, []);
  assert.deepEqual(t.locks, []);
});

test('deliberate stop clears protection', () => {
  const t = setup();
  t.seq.updateForState('UNKNOWN_PERSON');
  t.seq.stop('ai-stopped');
  assert.equal(t.actions.at(-1), 'CLEAR:ai-stopped');
  assert.equal(t.timers.pendingCount, 0);
});

// Phase 0 item 6 — fail-open, fixed in Phase 1.5 (was a todo until then).
test('monitor failure must not reveal the screen (fail-closed)', () => {
  for (const failure of ['ai-failed-CAMERA_ERROR', 'ai-failed-AI_UNAVAILABLE', 'watchdog']) {
    const t = setup();
    t.seq.updateForState('UNKNOWN_PERSON');
    t.seq.handleMonitorFailure(failure);
    assert.ok(!t.actions.some((a) => a.startsWith('CLEAR')), `${failure} revealed the screen: ${t.actions.join(', ')}`);
  }
  const t = setup();
  t.seq.updateForState('UNKNOWN_PERSON');
  t.seq.updateForState('CAMERA_ERROR');
  assert.ok(!t.actions.some((a) => a.startsWith('CLEAR')), 'CAMERA_ERROR state revealed the screen');
});

test('monitor failure halts timers without locking or clearing', () => {
  const t = setup();
  t.seq.updateForState('NO_USER');
  t.seq.handleMonitorFailure('ai-failed-CAMERA_ERROR');
  t.timers.advance(20000);
  assert.deepEqual(t.locks, []);
  assert.deepEqual(t.actions, ['BLUR:walk-away']);
  assert.ok(t.logs.includes('PROTECTION_SEQUENCE_HALTED|type=WALK_AWAY|reason=ai-failed-CAMERA_ERROR'));
  assert.equal(t.timers.pendingCount, 0);
});

test('threat recovery: owner alone again cancels the threat lock', () => {
  const t = setup();
  t.seq.updateForState('UNKNOWN_PERSON');
  t.timers.advance(1500);
  t.seq.updateForState('OWNER_PRESENT');
  t.timers.advance(10000);
  assert.deepEqual(t.locks, []);
  assert.ok(t.logs.includes('PROTECTION_SEQUENCE_CANCELLED|type=THREAT|reason=owner-returned'));
  assert.equal(t.timers.pendingCount, 0);
});

test('owner together with an unknown person does not cancel the threat', () => {
  const t = setup();
  t.seq.updateForState('UNKNOWN_PERSON');
  t.seq.updateForState('OWNER_AND_UNKNOWN');
  t.timers.advance(5000);
  assert.deepEqual(t.locks, ['privacy-threat']);
});

test('threat escalation follows the policy decision and only escalates', () => {
  const timers = createFakeTimers(0);
  const actions = [];
  const logs = [];
  const locks = [];
  let next = 'NONE';
  const seq = createProtectionSequence({
    getSettings:() => ({}),
    sendAction:(a) => actions.push(a),
    log:(l) => logs.push(l),
    lock:(r) => locks.push(r),
    evaluateThreat:() => ({ action:next, reason:`policy says ${next}`, factors:[] }),
    timers
  });
  seq.updateForState('UNKNOWN_PERSON', {});
  assert.deepEqual(actions, []); // policy: just watch
  next = 'FOCUS';
  timers.advance(250);
  assert.deepEqual(actions, ['FOCUS']);
  assert.ok(logs.includes('POLICY_DECISION|action=FOCUS|reason=policy says FOCUS'));
  next = 'BLUR'; // no de-escalation within a threat
  timers.advance(1000);
  assert.deepEqual(actions, ['FOCUS']);
  next = 'LOCK';
  seq.updateForState('UNKNOWN_PERSON', {}); // a backend update re-evaluates immediately
  assert.deepEqual(locks, ['privacy-threat']);
  assert.equal(timers.pendingCount, 0);
});

test('default evaluator (no profiles) ages track data between updates; presence uses the same thresholds', () => {
  const run = (track) => {
    const t = setup();
    t.seq.updateForState('UNKNOWN_PERSON', { tracks:[track] });
    t.timers.advance(5000); // tracks age between updates
    return { actions:t.actions, locks:t.locks };
  };
  const watcher = run({ id:2, role:'unknown', facing:'FACING_SCREEN', presentMs:100, facingMs:100, lookingMs:100 });
  assert.deepEqual(watcher.locks, ['privacy-threat']);
  const passer = run({ id:2, role:'unknown', facing:'AWAY', presentMs:100, facingMs:0, lookingMs:0 });
  assert.deepEqual(passer.locks, ['privacy-threat']); // slower presence rules come from profiles (policy_engine tests)
});
