const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { decide, stageFor } = require('../electron/policy_engine');
const { normalizePolicies, matchSensitiveApp, appDisplayName, resolveProfileName, BASE_PROFILE } = require('../electron/policies');

const POLICIES = normalizePolicies(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'policies.json'), 'utf8')));
const OUTLOOK = { process:'C:\\Program Files\\Microsoft Office\\OUTLOOK.EXE', title:'Inbox - me@example.com - Outlook' };
const NOTEPAD = { process:'C:\\Windows\\notepad.exe', title:'notes.txt - Notepad' };

const owner = (ms = 9000) => ({ id:1, role:'owner', facing:'FACING_SCREEN', presentMs:ms, facingMs:ms, lookingMs:ms });
const unknown = (facing, presentMs, facingMs, lookingMs, id = 2) => ({ id, role:'unknown', facing, presentMs, facingMs, lookingMs });

function run(name, { state = 'UNKNOWN_PERSON', tracks, app = NOTEPAD, threatMs = 0, ageMs = 0 }){
  const profile = POLICIES.profiles[name];
  return decide({ state, tracks, app:matchSensitiveApp(app, POLICIES.sensitiveApps), profile, profileName:name, threatMs, ageMs });
}

// [description, profile, input, expected action]
const TABLE = [
  ['owner alone: nothing', 'Office', { state:'OWNER_PRESENT', tracks:[owner()] }, 'NONE'],
  ['no user: nothing (walk-away is separate)', 'Office', { state:'NO_USER', tracks:[] }, 'NONE'],
  ['Office: unknown facing just now → blur', 'Office', { tracks:[unknown('FACING_SCREEN', 200, 200, 200)] }, 'BLUR'],
  ['Office: unknown turned to the screen this instant (0 ms) → blur', 'Office', { tracks:[unknown('FACING_SCREEN', 0, 0, 0)] }, 'BLUR'],
  ['Office: no track data, threat just began (0 ms) → blur at once', 'Office', { tracks:undefined, threatMs:0 }, 'BLUR'],
  ['Home: glancing, glancing not counted, 6 s present → presence blur only', 'Home', { tracks:[unknown('GLANCING', 6000, 0, 6000)] }, 'BLUR'],
  ['Office: facing 3.2 s → focus', 'Office', { tracks:[unknown('FACING_SCREEN', 3200, 3200, 3200)] }, 'FOCUS'],
  ['Office: facing 5 s → lock', 'Office', { tracks:[unknown('FACING_SCREEN', 5000, 5000, 5000)] }, 'LOCK'],
  ['Office: walking past side-on 1 s → nothing yet', 'Office', { tracks:[unknown('AWAY', 1000, 0, 0)] }, 'NONE'],
  ['Office: side-on 2.5 s → blur only', 'Office', { tracks:[unknown('AWAY', 2500, 0, 0)] }, 'BLUR'],
  ['Office: side-on 10 s → still only blur', 'Office', { tracks:[unknown('AWAY', 10000, 0, 0)] }, 'BLUR'],
  ['Office: glancing counts → focus at 3 s', 'Office', { tracks:[unknown('GLANCING', 3100, 0, 3100)] }, 'FOCUS'],
  ['Home: glancing does not count → presence rule', 'Home', { tracks:[unknown('GLANCING', 3100, 0, 3100)] }, 'NONE'],
  ['Home: facing 1 s → nothing yet', 'Home', { tracks:[unknown('FACING_SCREEN', 1000, 1000, 1000)] }, 'NONE'],
  ['Home: facing 6 s → focus', 'Home', { tracks:[unknown('FACING_SCREEN', 6000, 6000, 6000)] }, 'FOCUS'],
  ['Office + Outlook: facing 1.2 s → focus (sensitive)', 'Office', { tracks:[unknown('FACING_SCREEN', 1200, 1200, 1200)], app:OUTLOOK }, 'FOCUS'],
  ['Office + Outlook: facing 3 s → lock (sensitive)', 'Office', { tracks:[unknown('FACING_SCREEN', 3000, 3000, 3000)], app:OUTLOOK }, 'LOCK'],
  ['Public: anyone nearby → blur at once', 'Public', { tracks:[unknown('AWAY', 0, 0, 0)] }, 'BLUR'],
  ['Public: facing 1.5 s → focus', 'Public', { tracks:[unknown('FACING_SCREEN', 1500, 1500, 1500)] }, 'FOCUS'],
  ['owner + watcher: the watcher decides', 'Office', { state:'OWNER_AND_UNKNOWN', tracks:[owner(), unknown('FACING_SCREEN', 3500, 3500, 3500)] }, 'FOCUS'],
  ['two unknowns: strongest wins', 'Office', { state:'UNKNOWN_GROUP', tracks:[unknown('AWAY', 1000, 0, 0, 2), unknown('FACING_SCREEN', 5200, 5200, 5200, 3)] }, 'LOCK'],
  ['no track data: assumed facing since threat start (Phase 1 timing)', 'Office', { tracks:undefined, threatMs:3000 }, 'FOCUS'],
  ['no track data, 5 s → lock', 'Office', { tracks:[], threatMs:5000 }, 'LOCK'],
  ['tracks aged between updates', 'Office', { tracks:[unknown('FACING_SCREEN', 2800, 2800, 2800)], ageMs:300 }, 'FOCUS']
];

for(const [name, profile, input, expected] of TABLE){
  test(`policy: ${name}`, () => {
    assert.equal(run(profile, input).action, expected);
  });
}

test('reasons are explainable and never contain the window title', () => {
  const d = run('Office', { tracks:[unknown('FACING_SCREEN', 2100, 2100, 2100)], app:OUTLOOK });
  assert.equal(d.reason, 'Focus mode: unknown person facing the screen for 2.1 s while Outlook (email) is active (Office profile)');
  assert.ok(!d.reason.includes('me@example.com'));
  assert.ok(!JSON.stringify(d.factors).includes('Inbox'));
  assert.deepEqual(d.factors.find((f) => f.name === 'sensitiveApp'), { name:'sensitiveApp', value:'Email' });

  const away = run('Office', { tracks:[unknown('AWAY', 2500, 0, 0)] });
  assert.equal(away.reason, 'Blurred: unknown person nearby, not looking at the screen for 2.5 s (Office profile)');
  const group = run('Office', { state:'UNKNOWN_GROUP', tracks:[unknown('AWAY', 900, 0, 0, 2), unknown('GLANCING', 3100, 0, 3100, 3)] });
  assert.match(group.reason, /^Focus mode: 2 unknown people; nearest: unknown person glancing at the screen for 3\.1 s/);
  const assumed = run('Office', { tracks:[], threatMs:1000 });
  assert.ok(assumed.factors.some((f) => f.name === 'trackData'));
});

test('stage thresholds', () => {
  const t = { blurMs:0, focusMs:3000, lockMs:5000 };
  assert.deepEqual([0, 2999, 3000, 4999, 5000].map((ms) => stageFor(ms, t)), ['BLUR', 'BLUR', 'FOCUS', 'FOCUS', 'LOCK']);
  assert.equal(stageFor(1e9, { blurMs:10, focusMs:20, lockMs:null }), 'FOCUS');
});

test('sensitive app matching by process glob or title keyword', () => {
  const apps = POLICIES.sensitiveApps;
  assert.equal(matchSensitiveApp(OUTLOOK, apps).label, 'Email');
  assert.equal(matchSensitiveApp({ process:'C:\\x\\KeePassXC.exe', title:'db' }, apps).label, 'Password manager');
  assert.equal(matchSensitiveApp({ process:'C:\\x\\chrome.exe', title:'HDFC NetBanking - Google Chrome' }, apps).label, 'Banking');
  assert.equal(matchSensitiveApp({ process:'C:\\x\\chrome.exe', title:'Gmail - Inbox' }, apps).name, 'Chrome');
  assert.equal(matchSensitiveApp(NOTEPAD, apps), null);
  assert.equal(matchSensitiveApp(null, apps), null);
  assert.equal(appDisplayName('C:\\Program Files\\Microsoft Office\\OUTLOOK.EXE'), 'Outlook');
});

test('policies: validation, defaults and profile resolution', () => {
  assert.deepEqual(Object.keys(POLICIES.profiles), ['Home', 'Office', 'Public']);
  assert.equal(POLICIES.defaultProfile, 'Office');
  assert.equal(POLICIES.profiles.Home.curtainEffect, 'blur');
  assert.equal(POLICIES.profiles.Home.notLooking.lockMs, null);
  const broken = normalizePolicies({ profiles:{ 'Bad<name>':{}, Custom:{ curtainEffect:'neon', escalation:{ focusMs:-5 } } } });
  assert.deepEqual(Object.keys(broken.profiles), ['Custom']);
  assert.equal(broken.profiles.Custom.curtainEffect, 'blackout');
  assert.equal(broken.profiles.Custom.escalation.focusMs, BASE_PROFILE.escalation.focusMs);
  assert.deepEqual(Object.keys(normalizePolicies(null).profiles), ['Default']);
  assert.equal(resolveProfileName(POLICIES, 'Public'), 'Public');
  assert.equal(resolveProfileName(POLICIES, 'nope'), 'Office');
  assert.equal(resolveProfileName(POLICIES, '__proto__'), 'Office');
});
