const test = require('node:test');
const assert = require('node:assert/strict');
const { createLineSplitter, parseStateMessage, parseErrorMessage } = require('../electron/ai_protocol');

test('reassembles lines split across chunks', () => {
  const lines = [];
  const splitter = createLineSplitter((l) => lines.push(l));
  splitter.push('AI_READY\r\nSTATE|OWNER_PR');
  assert.deepEqual(lines, ['AI_READY']);
  splitter.push(Buffer.from('ESENT|faces=1\nAI_HEART'));
  splitter.push('BEAT\n\n');
  assert.deepEqual(lines, ['AI_READY', 'STATE|OWNER_PRESENT|faces=1', 'AI_HEARTBEAT']);
});

test('flush emits a trailing partial line', () => {
  const lines = [];
  const splitter = createLineSplitter((l) => lines.push(l));
  splitter.push('AI_ERROR|CAMERA_ERROR|gone');
  assert.deepEqual(lines, []);
  splitter.flush();
  assert.deepEqual(lines, ['AI_ERROR|CAMERA_ERROR|gone']);
});

test('parses STATE messages', () => {
  assert.deepEqual(
    parseStateMessage('STATE|OWNER_AND_UNKNOWN|faces=2|owners=1|unknown=1|best=0.6100|ownerScore=0.6100|bogus=1'),
    { state: 'OWNER_AND_UNKNOWN', faces: 2, owners: 1, unknown: 1, best: 0.61, ownerScore: 0.61 }
  );
  assert.equal(parseStateMessage('STATE').state, 'UNKNOWN');
});

test('parses AI_ERROR messages', () => {
  assert.deepEqual(parseErrorMessage('AI_ERROR|CAMERA_ERROR|No camera|x'), { kind: 'CAMERA_ERROR', message: 'No camera|x' });
  assert.equal(parseErrorMessage('AI_ERROR').kind, 'AI_UNAVAILABLE');
});

test('STATE with pose and tracks', () => {
  const { parseStateMessage } = require('../electron/ai_protocol');
  const msg = 'STATE|OWNER_AND_UNKNOWN|faces=2|owners=1|unknown=1|best=0.6|ownerScore=0.6'
    + '|facing=GLANCING|yaw=-31.2|pitch=4.0|tracks=1:O:FACING_SCREEN:2.0:-3.0:4000:4000:4000,2:U:GLANCING:-31.2:4.0:1500:0:1200,bad:X';
  const data = parseStateMessage(msg);
  assert.equal(data.facing, 'GLANCING');
  assert.equal(data.yaw, -31.2);
  assert.deepEqual(data.tracks, [
    { id:1, role:'owner', facing:'FACING_SCREEN', yaw:2, pitch:-3, presentMs:4000, facingMs:4000, lookingMs:4000 },
    { id:2, role:'unknown', facing:'GLANCING', yaw:-31.2, pitch:4, presentMs:1500, facingMs:0, lookingMs:1200 }
  ]);
  assert.equal(parseStateMessage('STATE|NO_USER|faces=0').tracks, undefined);
  assert.equal(parseStateMessage('STATE|OWNER_PRESENT|facing=SIDEWAYS').facing, undefined);
});
