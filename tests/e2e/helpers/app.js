// Launches the real SmartScreen app in test mode (SMARTSCREEN_TEST=1) with an
// isolated userData folder, an enrolled owner template and a recorded camera source.
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_DIR = path.resolve(__dirname, '..', '..', '..');
const NEUTRAL_APP = { process:'C:\\Windows\\System32\\notepad.exe', title:'notes.txt - Notepad' };
const PRIVATE_DIR = path.join(REPO_DIR, 'tests', 'fixtures', 'private');
const SCENARIO_DIR = path.join(PRIVATE_DIR, 'scenarios');
const ARTIFACT_DIR = path.join(REPO_DIR, 'tests', 'e2e', 'artifacts');
const OWNER_TEMPLATE = path.join(PRIVATE_DIR, 'owner_template.json');

const MOCK_DIR = path.join(REPO_DIR, 'tests', 'e2e', 'scenarios');

function mockScenarioPath(name){
  return path.join(MOCK_DIR, `${name}.json`);
}

function scenarioPath(name){
  return path.join(SCENARIO_DIR, `${name}.mp4`);
}

// Returns a reason string when the fixtures a test needs are missing.
function missingFixtures({ scenario, ownerTemplate = true }){
  const missing = [];
  if(scenario && !fs.existsSync(scenarioPath(scenario))) missing.push(`scenarios/${scenario}.mp4`);
  if(ownerTemplate && !fs.existsSync(OWNER_TEMPLATE)) missing.push('owner_template.json');
  return missing.length ? `missing private fixtures: ${missing.join(', ')} (see docs/testing/self-test-harness.md)` : '';
}

function loadOwnerEmbedding(useOwner){
  if(useOwner) return JSON.parse(fs.readFileSync(OWNER_TEMPLATE, 'utf8')).embedding;
  // No real face appears in owner-free scenarios; any unit vector works.
  return Array.from({ length:128 }, (_, i) => (i === 0 ? 1 : 0));
}

// mock: name of a tests/e2e/scenarios/*.json script replacing the Python backend.
// scenario/cameraSource: recorded camera input for the real Python backend.
// userData: reuse a folder from an earlier launch (restart tests); seedLog: activity.log lines.
// activeApp: simulated foreground app { process, title } (default: a neutral app, so the real
// foreground window never influences a test); change it mid-run with setActiveApp().
async function launchApp({ mock, scenario, cameraSource, ownerTemplate = !mock, settings, userData:reuse, seedLog, activeApp = NEUTRAL_APP } = {}){
  const userData = reuse || fs.mkdtempSync(path.join(os.tmpdir(), 'smartscreen-e2e-'));
  if(seedLog){
    fs.mkdirSync(path.join(userData, 'logs'), { recursive:true });
    fs.writeFileSync(path.join(userData, 'logs', 'activity.log'), seedLog.map((l) => `${l}\n`).join(''));
  }
  fs.writeFileSync(path.join(userData, 'device_profile.json'), JSON.stringify({
    version:1,
    setupComplete:true,
    windowsUser:'e2e',
    createdAt:new Date().toISOString(),
    biometric:{ enrolled:true, version:1, templateType:'sface-cosine', sampleCount:5 }
  }));

  const activeAppFile = path.join(userData, 'test_active_app.json');
  fs.writeFileSync(activeAppFile, JSON.stringify(activeApp));
  const env = {
    ...process.env,
    SMARTSCREEN_TEST:'1',
    SMARTSCREEN_USER_DATA:userData,
    SMARTSCREEN_TEST_ACTIVE_APP:activeAppFile,
  };
  if(mock) env.SMARTSCREEN_MOCK_BACKEND = mockScenarioPath(mock);
  else env.SMARTSCREEN_CAMERA_SOURCE = cameraSource || scenarioPath(scenario);
  if(settings) env.SMARTSCREEN_TEST_SETTINGS = JSON.stringify(settings);

  const app = await electron.launch({ args:[REPO_DIR], cwd:REPO_DIR, env });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  // The template is encrypted with the app's own safeStorage, exactly like enrollment does.
  const template = { version:1, model:'SFace', distance:'cosine', embedding:loadOwnerEmbedding(ownerTemplate), sampleCount:5, createdAt:new Date().toISOString() };
  const encrypted = await app.evaluate(({ safeStorage }, json) => safeStorage.encryptString(json).toString('base64'), JSON.stringify(template));
  fs.mkdirSync(path.join(userData, 'biometric'), { recursive:true });
  fs.writeFileSync(path.join(userData, 'biometric', 'owner_face.enc'), encrypted);

  return { app, page, userData, activeAppFile, logFile:path.join(userData, 'logs', 'activity.log') };
}

function setActiveApp(ctx, app){
  fs.writeFileSync(ctx.activeAppFile, JSON.stringify(app));
}

async function closeApp(ctx, { keepUserData = false } = {}){
  if(!ctx) return;
  try{ await ctx.app.close(); }catch{}
  if(!keepUserData){
    try{ fs.rmSync(ctx.userData, { recursive:true, force:true }); }catch{}
  }
}

// Log events (without timestamps), oldest first.
function readEvents(logFile){
  if(!fs.existsSync(logFile)) return [];
  return fs.readFileSync(logFile, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => line.replace(/^\S+ - /, ''));
}

async function waitForEvent(logFile, prefix, timeout = 30000){
  await expect.poll(() => readEvents(logFile).some((e) => e.startsWith(prefix)), {
    timeout, message:`activity.log should contain ${prefix}`
  }).toBe(true);
}

function indexOfEvent(events, prefix){
  return events.findIndex((e) => e.startsWith(prefix));
}

async function enableProtection(page){
  await page.locator('#aiBtn').click();
  await expect(page.locator('#aiBtn')).toHaveText('Disable Protection');
}

// Target opacity of an overlay layer (inline style set by overlay_effects.js).
function layerOpacity(page, id){
  return page.evaluate((layerId) => document.getElementById(layerId).style.opacity || '0', id);
}

const PROTECTIVE_LAYERS = ['overlay', 'pixelateLayer', 'blackoutLayer', 'focusLayer'];

// True when any layer that hides screen content is on.
async function anyProtectiveLayerOn(page){
  for(const id of PROTECTIVE_LAYERS){
    if(await layerOpacity(page, id) === '1') return true;
  }
  return false;
}

// Asserts that the given log prefixes occur in this order: each one is matched after the
// previous match (events may repeat, e.g. a second REVEALED after a recovery).
function expectEventOrder(events, prefixes){
  let from = -1;
  const unmatched = [];
  for(const prefix of prefixes){
    const index = events.findIndex((e, i) => i > from && e.startsWith(prefix));
    if(index < 0) unmatched.push(prefix);
    else from = index;
  }
  expect(unmatched, `events missing or out of order (${prefixes.join(' < ')})`).toEqual([]);
}

// Presence Gate curtain state as rendered: which layer it uses and whether it is up.
function curtainOn(page){
  return page.evaluate(() => document.body.classList.contains('curtain-on'));
}

// Native confirmation dialogs can't be clicked by Playwright: auto-answer "Continue".
async function autoConfirmDialogs(app){
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response:1 }); });
}

// Simulate a Windows session event (lock-screen, unlock-screen, resume).
async function emitPowerEvent(app, name){
  await app.evaluate(({ powerMonitor }, event) => powerMonitor.emit(event), name);
}

// Milliseconds between the first log lines (with timestamps) matching two event prefixes.
function msBetween(logFile, firstPrefix, secondPrefix){
  const lines = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split(/\r?\n/).filter(Boolean) : [];
  const time = (prefix) => {
    const line = lines.find((l) => l.replace(/^\S+ - /, '').startsWith(prefix));
    return line ? Date.parse(line.split(' - ')[0]) : NaN;
  };
  return time(secondPrefix) - time(firstPrefix);
}

async function snap(page, testInfo, name){
  fs.mkdirSync(ARTIFACT_DIR, { recursive:true });
  const slug = testInfo.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  const file = path.join(ARTIFACT_DIR, `${slug}--${name}.png`);
  await page.screenshot({ path:file });
  return file;
}

module.exports = {
  REPO_DIR, PRIVATE_DIR, scenarioPath, mockScenarioPath, missingFixtures, launchApp, closeApp,
  readEvents, waitForEvent, indexOfEvent, enableProtection, layerOpacity, anyProtectiveLayerOn, expectEventOrder, snap,
  curtainOn, autoConfirmDialogs, emitPowerEvent, msBetween, setActiveApp
};
