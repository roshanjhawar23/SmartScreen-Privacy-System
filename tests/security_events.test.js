const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readSecurityEvents, parseLogLine, formatLogLine, sanitizeLogValue } = require('../electron/security_events');

function tempLog(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartscreen-events-'));
  const file = path.join(dir, 'activity.log');
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

test('module exports a top-level readSecurityEvents (regression: was nested in writeLog)', () => {
  assert.equal(typeof readSecurityEvents, 'function');
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  assert.doesNotMatch(mainSource, /function writeLog\([^)]*\)\{\s*\n\s*function readSecurityEvents/);
});

test('returns [] for a missing file', () => {
  assert.deepEqual(readSecurityEvents(path.join(os.tmpdir(), 'does-not-exist.log')), []);
  assert.deepEqual(readSecurityEvents(null), []);
});

test('newest first, limited, unknown lines skipped', () => {
  const file = tempLog([
    '2026-10-01T10:00:00.000Z - AI_READY',
    '2026-10-01T10:00:01.000Z - SYSTEM_HEALTH|detector=true',
    'garbage line',
    '2026-10-01T10:00:02.000Z - AI_STATE|STATE|OWNER_PRESENT|faces=1',
    '2026-10-01T10:00:03.000Z - LOCK_REQUESTED|reason=walk-away'
  ]);
  const events = readSecurityEvents(file, 2);
  assert.deepEqual(events.map((e) => e.title), ['Screen lock requested', 'Owner verified']);
  assert.equal(events[0].detail, 'walk-away');
  assert.equal(events[0].timestamp, '2026-10-01T10:00:03.000Z');
  assert.equal(readSecurityEvents(file, 50).length, 3);
});

test('limit is clamped', () => {
  const lines = Array.from({ length: 300 }, (_, i) => `2026-10-01T10:00:00.${String(i).padStart(3, '0')}Z - AI_READY`);
  const file = tempLog(lines);
  assert.equal(readSecurityEvents(file, 10000).length, 200);
  assert.equal(readSecurityEvents(file, 'abc').length, 20);
  assert.equal(readSecurityEvents(file, -5).length, 1);
});

test('classifies event types', () => {
  const cases = [
    ['AI_STATE|STATE|UNKNOWN_PERSON|faces=1', 'THREAT'],
    ['AI_STATE|STATE|NO_USER|faces=0', 'PRESENCE'],
    ['BIOMETRIC_ENROLLED|samples=5', 'IDENTITY'],
    ['AI_ERROR|CAMERA_ERROR|The camera stopped delivering frames.', 'ERROR'],
    ['AI_WATCHDOG_TIMEOUT', 'ERROR'],
    ['PHOTO_SAVED|C:\\x.jpg', 'EVIDENCE'],
    ['TEST_LOCK_SIMULATED|reason=walk-away', 'ACTION']
  ];
  for (const [raw, type] of cases) {
    assert.equal(parseLogLine(`2026-10-01T10:00:00.000Z - ${raw}`).type, type, raw);
  }
  assert.equal(parseLogLine('2026-10-01T10:00:00.000Z - AI_ERROR|CAMERA_ERROR|x').title, 'Camera unavailable');
  assert.equal(parseLogLine('2026-10-01T10:00:00.000Z - TEST_LOCK_SIMULATED|reason=walk-away').title, 'Screen lock simulated (test mode)');
});

test('log values cannot inject extra lines', () => {
  const line = formatLogLine('LOCK_REQUESTED|reason=x\n2026-01-01T00:00:00.000Z - AI_STATE|STATE|OWNER_PRESENT', new Date(0));
  assert.equal(line.split('\n').filter(Boolean).length, 1);
  assert.equal(sanitizeLogValue('a\r\nb'), 'a b');
});
