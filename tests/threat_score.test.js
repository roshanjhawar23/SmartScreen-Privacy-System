const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { threatScore, scoreAction } = require('../electron/threat_score');
const { decide } = require('../electron/policy_engine');
const { normalizePolicies } = require('../electron/policies');

const POLICIES = normalizePolicies(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'policies.json'), 'utf8')));
const face = (facing, ms, extra = {}) => ({ id:2, role:'unknown', facing, presentMs:ms, facingMs:facing === 'FACING_SCREEN' ? ms : 0,
  lookingMs:facing === 'AWAY' ? 0 : ms, size:0.15, liveness:'UNKNOWN', ...extra });
const EMAIL = { id:'email', label:'Email', name:'Outlook' };

const TABLE = [
  ['nobody unknown', { tracks:[{ ...face('FACING_SCREEN', 9000), role:'owner' }] }, 0],
  ['one passer-by side-on, just appeared', { tracks:[face('AWAY', 0)] }, 28],
  ['one passer-by side-on for 5 s', { tracks:[face('AWAY', 5000)] }, 33],
  ['one watcher facing for 5 s', { tracks:[face('FACING_SCREEN', 5000)] }, 58],
  ['one watcher, close', { tracks:[face('FACING_SCREEN', 5000, { size:0.3 })] }, 65],
  ['one watcher, far', { tracks:[face('FACING_SCREEN', 5000, { size:0.05 })] }, 52],
  ['watcher + sensitive app', { tracks:[face('FACING_SCREEN', 5000)], sensitiveApp:EMAIL }, 73],
  ['three watchers, close, sensitive app', { tracks:[1, 2, 3].map((id) => face('FACING_SCREEN', 5000, { id, size:0.3 })), sensitiveApp:EMAIL }, 100],
  ['photo held up (SUSPECT)', { tracks:[face('FACING_SCREEN', 2500, { liveness:'SUSPECT' })] }, 53],
  ['glancing ignored when the profile does not count it (presence points only)', { tracks:[face('GLANCING', 5000)], profile:{ glancingCounts:false } }, 33],
  ['Public multiplier', { tracks:[face('FACING_SCREEN', 5000)], profile:{ threatMultiplier:1.25 } }, 73]
];

for(const [name, input, expected] of TABLE){
  test(`threat score: ${name}`, () => {
    assert.equal(threatScore(input).score, expected);
  });
}

test('components explain every point', () => {
  const s = threatScore({ tracks:[face('FACING_SCREEN', 5000, { size:0.3 })], sensitiveApp:EMAIL });
  assert.deepEqual(s.components.map((c) => [c.name, c.points]), [['people', 20], ['attention', 30], ['distance', 15], ['sensitiveApp', 15]]);
  assert.equal(s.score, 80);
});

test('score bands', () => {
  assert.deepEqual([0, 34, 35, 54, 55, 79, 80].map((s) => scoreAction(s)), ['NONE', 'NONE', 'BLUR', 'BLUR', 'FOCUS', 'FOCUS', 'LOCK']);
  assert.equal(scoreAction(60, { focus:70 }), 'BLUR');
});

test('policy: score band escalates beyond the time rule and explains why', () => {
  // Three close watchers + Outlook, 2 s in: the sensitive time rule says FOCUS (lock at 3 s),
  // the score is 40 + 12 + 15 + 15 = 82 → LOCK band.
  const tracks = [1, 2, 3].map((id) => face('FACING_SCREEN', 2000, { id, size:0.3 }));
  const d = decide({ state:'UNKNOWN_GROUP', tracks, app:EMAIL, profile:POLICIES.profiles.Office, profileName:'Office' });
  assert.equal(d.action, 'LOCK');
  assert.match(d.reason, /^Locking: threat score \d+\/100 \(.*\) while Outlook \(email\) is active \(Office profile\)$/);
  assert.equal(d.factors.find((f) => f.name === 'decidedBy').value, 'threat-score');
});

test('policy: a single passer-by is not escalated by the score', () => {
  const d = decide({ state:'UNKNOWN_PERSON', tracks:[face('AWAY', 1000)], profile:POLICIES.profiles.Office, profileName:'Office' });
  assert.equal(d.action, 'NONE');
  assert.equal(d.factors.find((f) => f.name === 'threatScore').value, 29);
});
