const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../frontend/panel_position');

const size = { width: 292, height: 400 };
const viewport = { width: 1920, height: 1080 };

test('clamp keeps the panel fully on screen', () => {
  assert.deepEqual(P.clampPosition({ x: -50, y: -10 }, size, viewport), { x: 0, y: 0 });
  assert.deepEqual(P.clampPosition({ x: 5000, y: 5000 }, size, viewport), { x: 1628, y: 680 });
  assert.deepEqual(P.clampPosition({ x: 300.4, y: 200.6 }, size, viewport), { x: 300, y: 201 });
});

test('panel larger than the viewport sits at the top-left', () => {
  assert.deepEqual(P.clampPosition({ x: 50, y: 50 }, { width: 400, height: 900 }, { width: 300, height: 800 }), { x: 0, y: 0 });
});

test('snap within 24 px of an edge, not beyond', () => {
  assert.deepEqual(P.snapToEdges({ x: 24, y: 300 }, size, viewport), { x: 0, y: 300 });
  assert.deepEqual(P.snapToEdges({ x: 25, y: 300 }, size, viewport), { x: 25, y: 300 });
  assert.deepEqual(P.snapToEdges({ x: 1610, y: 670 }, size, viewport), { x: 1628, y: 680 });
  assert.deepEqual(P.snapToEdges({ x: 800, y: 10 }, size, viewport), { x: 800, y: 0 });
});

test('stored position round-trips; corrupt data is ignored', () => {
  assert.deepEqual(P.parseStored(P.serialize({ x: 12.2, y: 40 })), { x: 12, y: 40 });
  assert.equal(P.parseStored(''), null);
  assert.equal(P.parseStored('{bad'), null);
  assert.equal(P.parseStored('{"x":"a","y":1}'), null);
  assert.equal(P.parseStored(null), null);
});
