const test = require('node:test');
const assert = require('node:assert/strict');
const { createScreenLocker, isTestMode, LOCK_COMMAND } = require('../electron/screen_lock');

function setup(env){
  const commands = [];
  const logs = [];
  const callbacks = [];
  const lock = createScreenLocker({
    env,
    exec: (command, cb) => { commands.push(command); callbacks.push(cb); },
    log: (line) => logs.push(line)
  });
  return { lock, commands, logs, callbacks };
}

test('real mode runs the Windows lock command', () => {
  const t = setup({});
  t.lock('walk-away');
  assert.deepEqual(t.commands, ['rundll32.exe user32.dll,LockWorkStation']);
  assert.equal(LOCK_COMMAND, 'rundll32.exe user32.dll,LockWorkStation');
  assert.deepEqual(t.logs, ['LOCK_REQUESTED|reason=walk-away']);

  t.callbacks[0](null, '', '');
  assert.deepEqual(t.logs, ['LOCK_REQUESTED|reason=walk-away', 'LOCK_COMMAND_COMPLETED|reason=walk-away']);
  assert.ok(!t.logs.some((l) => l.startsWith('TEST_LOCK_SIMULATED')));
});

test('real mode logs lock errors', () => {
  const t = setup({});
  t.lock('privacy-threat');
  t.callbacks[0](new Error('denied'), '', '');
  assert.deepEqual(t.logs, ['LOCK_REQUESTED|reason=privacy-threat', 'LOCK_ERROR|reason=privacy-threat|denied']);
});

test('only SMARTSCREEN_TEST=1 enables test mode', () => {
  for(const value of [undefined, '', '0', 'true', 'yes', ' 1']){
    const env = value === undefined ? {} : { SMARTSCREEN_TEST: value };
    assert.equal(isTestMode(env), false, `value ${JSON.stringify(value)}`);
    const t = setup(env);
    t.lock('manual');
    assert.equal(t.commands.length, 1, `value ${JSON.stringify(value)} must still lock`);
  }
  assert.equal(isTestMode({ SMARTSCREEN_TEST: '1' }), true);
});

test('test mode simulates the lock without running any command', () => {
  const t = setup({ SMARTSCREEN_TEST: '1' });
  t.lock('walk-away');
  assert.deepEqual(t.commands, []);
  assert.deepEqual(t.logs, ['LOCK_REQUESTED|reason=walk-away', 'TEST_LOCK_SIMULATED|reason=walk-away']);
});
