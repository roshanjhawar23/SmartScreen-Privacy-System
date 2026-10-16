const test = require('node:test');
const assert = require('node:assert/strict');
const { createVirtualDesktops, followCurrentDesktop, parseGuid, handleToNumber } = require('../electron/virtual_desktop');

test('GUID text is encoded in Windows memory layout', () => {
  assert.equal(parseGuid('AA509086-5CA9-4C25-8F95-589D3C07B48A').toString('hex'), '869050aaa95c254c8f95589d3c07b48a');
});

test('native window handles from Electron buffers', () => {
  const b64 = Buffer.alloc(8); b64.writeBigUInt64LE(123456789n);
  assert.equal(handleToNumber(b64), 123456789n);
  const b32 = Buffer.alloc(4); b32.writeUInt32LE(42);
  assert.equal(handleToNumber(b32), 42n);
});

test('unavailable off Windows or when the FFI library fails to load', () => {
  assert.equal(createVirtualDesktops({ platform:'linux' }).available, false);
  const broken = createVirtualDesktops({ platform:'win32', loadKoffi:() => { throw new Error('no ffi'); } });
  assert.equal(broken.available, false);
  assert.equal(broken.isOnCurrentDesktop(Buffer.alloc(8)), true);
});

function fakeWindow(id, { destroyed = false } = {}){
  const h = Buffer.alloc(8); h.writeBigUInt64LE(BigInt(id));
  return { isDestroyed:() => destroyed, getNativeWindowHandle:() => h };
}

test('follow moves only overlays that left the current desktop', () => {
  const onCurrent = new Set([1n]);
  const moves = [];
  const logs = [];
  const desktops = {
    available:true,
    isOnCurrentDesktop:(h) => onCurrent.has(handleToNumber(h)),
    moveToCurrentDesktop:(h) => { moves.push(handleToNumber(h)); return true; }
  };
  const moved = followCurrentDesktop([fakeWindow(1), fakeWindow(2), fakeWindow(3, { destroyed:true })], desktops, (l) => logs.push(l));
  assert.equal(moved, 1);
  assert.deepEqual(moves, [2n]);
  assert.deepEqual(logs, ['OVERLAY_DESKTOP_FOLLOW|moved=true']);
});

test('follow survives API errors and does nothing when unavailable', () => {
  const logs = [];
  const throwing = { available:true, isOnCurrentDesktop:() => { throw new Error('boom'); }, moveToCurrentDesktop:() => true };
  assert.equal(followCurrentDesktop([fakeWindow(1)], throwing, (l) => logs.push(l)), 0);
  assert.deepEqual(logs, ['OVERLAY_DESKTOP_FOLLOW_ERROR|boom']);
  assert.equal(followCurrentDesktop([fakeWindow(1)], { available:false }), 0);
});
