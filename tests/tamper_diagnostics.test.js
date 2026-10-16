const test = require('node:test');
const assert = require('node:assert/strict');
const { configDigest, createClockMonitor, createRestartLoopDetector, diffDevices, FAILSAFE_KINDS } = require('../electron/tamper');
const { createDiagnostics } = require('../electron/diagnostics');

test('config digest is keyed: same bytes, different key → different digest', () => {
  const a = configDigest(Buffer.alloc(32, 1), Buffer.from('{"x":1}'));
  assert.equal(a, configDigest(Buffer.alloc(32, 1), Buffer.from('{"x":1}')));
  assert.notEqual(a, configDigest(Buffer.alloc(32, 2), Buffer.from('{"x":1}')));
  assert.notEqual(a, configDigest(Buffer.alloc(32, 1), Buffer.from('{"x":2}')));
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('clock monitor detects wall-clock jumps against the monotonic clock', () => {
  let wall = 1e12, mono = 0;
  const c = createClockMonitor({ wallNow:() => wall, monoNow:() => mono, thresholdMs:30000 });
  wall += 5000; mono += 5000;
  assert.equal(c.check(), null);
  wall += 5000 + 60000; mono += 5000; // clock moved forward 1 min
  assert.deepEqual(c.check(), { jumpMs:60000, major:false });
  wall += 5000 - 3600000; mono += 5000; // back 1 h
  assert.deepEqual(c.check(), { jumpMs:-3600000, major:true });
  wall += 7200000; // sleep: wall advances, monotonic paused → reset avoids a false jump
  c.reset();
  wall += 5000; mono += 5000;
  assert.equal(c.check(), null);
});

test('restart loop trips once at the limit within the window', () => {
  const d = createRestartLoopDetector({ windowMs:600000, limit:3 });
  assert.equal(d.record(0), false);
  assert.equal(d.record(60000), false);
  assert.equal(d.record(120000), true);
  assert.equal(d.record(130000), false); // already tripped
  assert.equal(d.record(900000), false); // all earlier failures are older than 10 min: count 1
  assert.equal(d.record(910000), false); // count 2
  assert.equal(d.record(920000), true);  // count 3: a new loop
});

test('device set changes', () => {
  assert.equal(diffDevices(['a', 'b'], ['b', 'a']), null);
  assert.deepEqual(diffDevices(['a'], ['b']), { added:1, removed:1 });
  assert.deepEqual(diffDevices(['a'], ['a', 'c']), { added:1, removed:0 });
  assert.ok(FAILSAFE_KINDS.has('config-modified'));
  assert.ok(!FAILSAFE_KINDS.has('clock-jump-minor'));
});

test('diagnostics counters, backend stats and summary', () => {
  let t = 1000;
  const d = createDiagnostics({ now:() => t });
  for(const e of [
    'AI_STATE|STATE|OWNER_PRESENT|faces=1', 'AI_STATE|STATE|UNKNOWN_PERSON|faces=1', 'POLICY_DECISION|action=BLUR|reason=x',
    'LOCK_REQUESTED|reason=walk-away', 'PRESENCE_GATE|REVEALED|reason=owner-verified', 'PRESENCE_GATE|FAILSAFE|reason=camera-error',
    'TAMPER|camera-covered|mean=0', 'AI_EXIT|code=1', 'AI_EXIT|code=null', 'AI_WATCHDOG_TIMEOUT', 'SENSITIVE_APP_ACTIVE|category=Email|app=Outlook'
  ]) d.record(e);
  d.setBackendStats({ fps:29.8, recognitionMs:24.1, cpu:18.5 });
  t = 6000;
  const s = d.snapshot({ cpuPercent:3.2, memoryMB:180 });
  assert.deepEqual(s.counters, {
    identityChanges:2, threats:1, policyActions:1, lockRequests:1, reveals:1, failsafes:1,
    tamperEvents:1, aiFailures:2, sensitiveAppActivations:1
  });
  assert.equal(s.backend.ageMs, 5000);
  assert.equal(s.uptimeMs, 5000);
  assert.equal(d.summaryLine({ cpuPercent:3.2, memoryMB:180 }), 'DIAGNOSTICS|fps=29.8|recognitionMs=24.1|visionCpu=18.5|appCpu=3.2|appMemMB=180.0');
  assert.ok(!JSON.stringify(s).includes('Outlook'), 'no app names or titles in the snapshot');
});
