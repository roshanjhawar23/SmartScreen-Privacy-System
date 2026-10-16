const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { formatState, parseScenario, runScenario } = require('./e2e/mock_backend');
const { parseStateMessage } = require('../electron/ai_protocol');
const { createFakeTimers } = require('./helpers/fake_timers');

function run(raw){
  const timers = createFakeTimers(0);
  const lines = [];
  const exits = [];
  const handle = runScenario(parseScenario(raw), { emit:(l) => lines.push(l), exit:(c) => exits.push(c), timers });
  return { timers, lines, exits, handle };
}

test('state lines match the real backend format and parse', () => {
  assert.equal(formatState('NO_USER'), 'STATE|NO_USER|faces=0|owners=0|unknown=0|best=0.0000');
  const owner = parseStateMessage(formatState('OWNER_PRESENT'));
  assert.deepEqual(owner, { state:'OWNER_PRESENT', faces:1, owners:1, unknown:0, best:0.62, ownerScore:0.62 });
  const both = parseStateMessage(formatState('OWNER_AND_UNKNOWN'));
  assert.equal(both.owners, 1);
  assert.equal(both.unknown, 1);
  assert.equal(parseStateMessage(formatState('UNKNOWN_GROUP')).unknown, 2);
});

test('steps fire in time order with heartbeats', () => {
  const t = run({ heartbeatMs:1000, stateUpdateMs:0, steps:[
    { at:1500, state:'NO_USER' },
    { at:0, emit:'AI_READY' },
    { at:2500, state:'UNKNOWN_PERSON', snapshot:true }
  ] });
  t.timers.advance(3000);
  assert.deepEqual(t.lines, [
    'AI_READY',
    'AI_HEARTBEAT',
    'STATE|NO_USER|faces=0|owners=0|unknown=0|best=0.0000',
    'AI_HEARTBEAT',
    formatState('UNKNOWN_PERSON'),
    'PHOTO_SAVED|mock-snapshot-2500.jpg',
    'AI_HEARTBEAT'
  ]);
});

test('face states repeat like the real backend; NO_USER, errors and hangs stop them', () => {
  const owner = formatState('OWNER_PRESENT');
  const t = run({ heartbeatMs:10000, stateUpdateMs:400, steps:[
    { at:0, state:'OWNER_PRESENT' },
    { at:1000, state:'NO_USER' },
    { at:2000, state:'UNKNOWN_PERSON', snapshot:true },
    { at:2900, heartbeat:false }
  ] });
  t.timers.advance(5000);
  assert.deepEqual(t.lines, [
    owner, owner, owner, // 0, 400, 800
    formatState('NO_USER'),
    formatState('UNKNOWN_PERSON'), 'PHOTO_SAVED|mock-snapshot-2000.jpg',
    formatState('UNKNOWN_PERSON'), formatState('UNKNOWN_PERSON') // 2400, 2800, then hung
  ]);

  const e = run({ heartbeatMs:10000, steps:[{ at:0, state:'OWNER_PRESENT' }, { at:500, emit:'AI_ERROR|CAMERA_ERROR|x' }] });
  e.timers.advance(3000);
  assert.deepEqual(e.lines, [owner, owner, 'AI_ERROR|CAMERA_ERROR|x']);
});

test('heartbeat can stop (hang) and exit ends everything', () => {
  const t = run({ heartbeatMs:500, steps:[{ at:0, emit:'AI_READY' }, { at:1200, heartbeat:false }, { at:5000, exit:1 }, { at:6000, emit:'LATE' }] });
  t.timers.advance(4000);
  assert.deepEqual(t.lines, ['AI_READY', 'AI_HEARTBEAT', 'AI_HEARTBEAT']);
  t.timers.advance(3000);
  assert.deepEqual(t.exits, [1]);
  assert.ok(!t.lines.includes('LATE'));
  assert.equal(t.timers.pendingCount, 0);
});

test('stop (STOP / EOF) clears all timers', () => {
  const t = run({ steps:[{ at:0, emit:'AI_READY' }, { at:9000, emit:'X' }] });
  t.timers.advance(10);
  t.handle.stop(0);
  t.timers.advance(20000);
  assert.deepEqual(t.lines, ['AI_READY']);
  assert.deepEqual(t.exits, [0]);
});

test('invalid scenarios are rejected', () => {
  assert.throws(() => parseScenario({}));
  assert.throws(() => parseScenario({ steps:[{ at:-1, emit:'x' }] }));
  assert.throws(() => parseScenario({ steps:[{ at:0 }] }));
  assert.throws(() => parseScenario({ steps:[{ at:0, emit:'x', exit:1 }] }));
});

test('every committed e2e scenario file is valid', () => {
  const dir = path.join(__dirname, 'e2e', 'scenarios');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.ok(files.length > 0);
  for(const file of files){
    assert.doesNotThrow(() => parseScenario(fs.readFileSync(path.join(dir, file), 'utf8')), file);
  }
});
