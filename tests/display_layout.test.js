const test = require('node:test');
const assert = require('node:assert/strict');
const { planOverlayWindows } = require('../electron/display_layout');

const A = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
const B = { id: 2, bounds: { x: 1920, y: 0, width: 2560, height: 1440 } };
const C = { id: 3, bounds: { x: -1280, y: 0, width: 1280, height: 1024 } };

const primaryOn = (display, id = 100) => ({ id, role: 'primary', displayId: display.id, bounds: { ...display.bounds } });
const secondaryOn = (display, id) => ({ id, role: 'secondary', displayId: display.id, bounds: { ...display.bounds } });

test('single display: nothing to do', () => {
  assert.deepEqual(planOverlayWindows([A], 1, [primaryOn(A)]), { updates: [], creates: [], removes: [] });
});

test('creates one secondary per additional display', () => {
  const plan = planOverlayWindows([A, B, C], 1, [primaryOn(A)]);
  assert.deepEqual(plan.creates.map((c) => c.displayId), [2, 3]);
  assert.deepEqual(plan.creates[0].bounds, B.bounds);
  assert.deepEqual(plan.removes, []);
});

test('removes secondaries for disconnected displays', () => {
  const plan = planOverlayWindows([A], 1, [primaryOn(A), secondaryOn(B, 201), secondaryOn(C, 202)]);
  assert.deepEqual(plan.removes.sort(), [201, 202]);
});

test('metrics change updates bounds', () => {
  const resized = { id: 2, bounds: { x: 1920, y: 0, width: 1280, height: 720 } };
  const plan = planOverlayWindows([A, resized], 1, [primaryOn(A), secondaryOn(B, 201)]);
  assert.deepEqual(plan.updates, [{ id: 201, displayId: 2, bounds: resized.bounds }]);
});

test('primary display change moves the panel window and drops the duplicate secondary', () => {
  const plan = planOverlayWindows([A, B], 2, [primaryOn(A), secondaryOn(B, 201)]);
  assert.deepEqual(plan.updates, [{ id: 100, displayId: 2, bounds: B.bounds }]);
  assert.deepEqual(plan.removes, [201]);
  assert.deepEqual(plan.creates.map((c) => c.displayId), [1]);
});

test('every display is covered exactly once', () => {
  const windows = [primaryOn(A), secondaryOn(B, 201), secondaryOn(B, 202)];
  const plan = planOverlayWindows([A, B, C], 1, windows);
  assert.deepEqual(plan.removes, [202]);
  assert.deepEqual(plan.creates.map((c) => c.displayId), [3]);
});

test('primary window is never removed', () => {
  const plan = planOverlayWindows([B], 2, [primaryOn(A)]);
  assert.deepEqual(plan.removes, []);
  assert.deepEqual(plan.updates, [{ id: 100, displayId: 2, bounds: B.bounds }]);
});
