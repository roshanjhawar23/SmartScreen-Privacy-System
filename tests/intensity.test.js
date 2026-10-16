const test = require('node:test');
const assert = require('node:assert/strict');
const { computeIntensity, clampLevel, DEFAULT_LEVEL, RANGES } = require('../frontend/intensity');

test('endpoints map to configured ranges', () => {
  const low = computeIntensity(0);
  const high = computeIntensity(100);
  for (const key of Object.keys(RANGES)) {
    assert.equal(low[key], RANGES[key][0], `${key} @0`);
    assert.equal(high[key], RANGES[key][1], `${key} @100`);
  }
});

test('every parameter increases monotonically with the level', () => {
  let prev = computeIntensity(0);
  for (let level = 1; level <= 100; level++) {
    const cur = computeIntensity(level);
    for (const key of Object.keys(RANGES)) assert.ok(cur[key] >= prev[key], `${key} decreased at ${level}`);
    prev = cur;
  }
});

test('clamps and defaults invalid input', () => {
  assert.equal(clampLevel(-10), 0);
  assert.equal(clampLevel(1000), 100);
  assert.equal(clampLevel('42.6'), 43);
  assert.equal(clampLevel('nope'), DEFAULT_LEVEL);
  assert.equal(clampLevel(undefined), DEFAULT_LEVEL);
  assert.equal(computeIntensity(NaN).level, DEFAULT_LEVEL);
});

test('blackout stays substantially opaque even at level 0', () => {
  assert.ok(computeIntensity(0).blackoutOpacity >= 0.7);
});
