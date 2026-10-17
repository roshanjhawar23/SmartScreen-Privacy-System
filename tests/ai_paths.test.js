const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { resolveAiCommand, effectiveTestMode, childEnv } = require('../electron/ai_paths');

test('dev runs the Python scripts with system python', () => {
  const monitor = resolveAiCommand({ packaged:false, appDir:'C:\\app', mode:'monitor' });
  assert.equal(monitor.command, 'python');
  assert.deepEqual(monitor.args, [path.join('C:\\app', 'backend', 'face_detection.py')]);
  const enroll = resolveAiCommand({ packaged:false, appDir:'C:\\app', mode:'enroll' });
  assert.deepEqual(enroll.args, [path.join('C:\\app', 'backend', 'enroll_face.py')]);
});

test('installed app runs the bundled exe, never system python', () => {
  const res = 'C:\\Program Files\\SmartScreen\\resources';
  const monitor = resolveAiCommand({ packaged:true, resourcesPath:res, mode:'monitor' });
  assert.equal(monitor.command, path.join(res, 'backend', 'smartscreen_ai', 'smartscreen_ai.exe'));
  assert.deepEqual(monitor.args, []);
  const enroll = resolveAiCommand({ packaged:true, resourcesPath:res, mode:'enroll' });
  assert.equal(enroll.command, monitor.command);
  assert.deepEqual(enroll.args, ['enroll']);
});

test('unknown mode is rejected', () => {
  assert.throws(() => resolveAiCommand({ packaged:false, appDir:'x', mode:'other' }));
});

test('test mode only in dev', () => {
  assert.equal(effectiveTestMode({ packaged:false, env:{ SMARTSCREEN_TEST:'1' } }), true);
  assert.equal(effectiveTestMode({ packaged:true, env:{ SMARTSCREEN_TEST:'1' } }), false);
  assert.equal(effectiveTestMode({ packaged:false, env:{} }), false);
});

test('child env drops SmartScreen test switches outside test mode', () => {
  const env = { PATH:'p', SMARTSCREEN_TEST:'1', smartscreen_camera_source:'x.mp4' };
  assert.deepEqual(childEnv({ testMode:false, env }), { PATH:'p' });
  assert.equal(childEnv({ testMode:true, env }), env);
});
