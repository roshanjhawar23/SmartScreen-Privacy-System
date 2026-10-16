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

// Phase 0 item 6 — fail-open. Expected to FAIL until the Phase 1.5 Presence Gate
// lands; marked todo so it is reported without blocking the suite.
test('monitor failure must not reveal the screen (fail-closed)', { todo: 'fixed by Phase 1.5 Presence Gate' }, () => {
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
