const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createActiveWindowReader } = require('../electron/active_window');

test('test mode reads the injected foreground app on every call', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-')), 'app.json');
  const r = createActiveWindowReader({ env:{ SMARTSCREEN_TEST:'1', SMARTSCREEN_TEST_ACTIVE_APP:file } });
  assert.equal(r.read(), null); // missing file
  fs.writeFileSync(file, JSON.stringify({ process:'C:\\x\\OUTLOOK.EXE', title:'Inbox' }));
  assert.deepEqual(r.read(), { process:'C:\\x\\OUTLOOK.EXE', title:'Inbox', pid:-1 });
  fs.writeFileSync(file, JSON.stringify({ process:'C:\\x\\notepad.exe', title:'a' }));
  assert.equal(r.read().process, 'C:\\x\\notepad.exe');
});

test('the injected reader needs SMARTSCREEN_TEST=1', () => {
  const r = createActiveWindowReader({ platform:'linux', env:{ SMARTSCREEN_TEST_ACTIVE_APP:'x.json' } });
  assert.equal(r.available, false);
});

test('unavailable when the FFI library cannot load', () => {
  const r = createActiveWindowReader({ platform:'win32', env:{}, loadKoffi:() => { throw new Error('no'); } });
  assert.equal(r.available, false);
  assert.equal(r.read(), null);
});
