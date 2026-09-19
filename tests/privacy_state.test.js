const assert = require('node:assert/strict');
const {
  STATES,
  normalizeState,
  normalizePayload,
  isThreatState,
  classify
} = require('../frontend/privacy_state.js');

assert.equal(normalizeState('OWNER_PRESENT'), STATES.OWNER_PRESENT);
assert.equal(normalizeState('owner_present'), STATES.OWNER_PRESENT);
assert.equal(normalizeState('unexpected'), STATES.AI_UNAVAILABLE);

assert.equal(isThreatState(STATES.UNKNOWN_PERSON), true);
assert.equal(isThreatState(STATES.UNKNOWN_GROUP), true);
assert.equal(isThreatState(STATES.OWNER_AND_UNKNOWN), true);
assert.equal(isThreatState(STATES.OWNER_PRESENT), false);

assert.equal(classify(STATES.OWNER_PRESENT), 'OWNER');
assert.equal(classify(STATES.NO_USER), 'AWAY');
assert.equal(classify(STATES.UNKNOWN_PERSON), 'THREAT');
assert.equal(classify(STATES.OWNER_AND_UNKNOWN), 'THREAT');
assert.equal(classify(STATES.CAMERA_ERROR), 'CAMERA_ERROR');

const payload = normalizePayload({ state:'unknown_person', faces:1, owners:0, unknown:1 });
assert.equal(payload.state, STATES.UNKNOWN_PERSON);
assert.equal(payload.category, 'THREAT');
assert.equal(payload.faces, 1);

console.log('Privacy state tests passed.');
