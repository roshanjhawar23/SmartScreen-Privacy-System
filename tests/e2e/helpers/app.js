// Launches the real SmartScreen app in test mode (SMARTSCREEN_TEST=1) with an
// isolated userData folder, an enrolled owner template and a recorded camera source.
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_DIR = path.resolve(__dirname, '..', '..', '..');
const PRIVATE_DIR = path.join(REPO_DIR, 'tests', 'fixtures', 'private');
const SCENARIO_DIR = path.join(PRIVATE_DIR, 'scenarios');
const ARTIFACT_DIR = path.join(REPO_DIR, 'tests', 'e2e', 'artifacts');
const OWNER_TEMPLATE = path.join(PRIVATE_DIR, 'owner_template.json');

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

async function launchApp({ scenario, cameraSource, ownerTemplate = true, settings } = {}){
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'smartscreen-e2e-'));
  fs.writeFileSync(path.join(userData, 'device_profile.json'), JSON.stringify({
    version:1,
    setupComplete:true,
    windowsUser:'e2e',
    createdAt:new Date().toISOString(),
    biometric:{ enrolled:true, version:1, templateType:'sface-cosine', sampleCount:5 }
  }));

  const env = {
    ...process.env,
    SMARTSCREEN_TEST:'1',
    SMARTSCREEN_USER_DATA:userData,
    SMARTSCREEN_CAMERA_SOURCE:cameraSource || scenarioPath(scenario)
  };
  if(settings) env.SMARTSCREEN_TEST_SETTINGS = JSON.stringify(settings);

  const app = await electron.launch({ args:[REPO_DIR], cwd:REPO_DIR, env });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  // The template is encrypted with the app's own safeStorage, exactly like enrollment does.
  const template = { version:1, model:'SFace', distance:'cosine', embedding:loadOwnerEmbedding(ownerTemplate), sampleCount:5, createdAt:new Date().toISOString() };
  const encrypted = await app.evaluate(({ safeStorage }, json) => safeStorage.encryptString(json).toString('base64'), JSON.stringify(template));
  fs.mkdirSync(path.join(userData, 'biometric'), { recursive:true });
  fs.writeFileSync(path.join(userData, 'biometric', 'owner_face.enc'), encrypted);

  return { app, page, userData, logFile:path.join(userData, 'logs', 'activity.log') };
}

async function closeApp(ctx){
  if(!ctx) return;
  try{ await ctx.app.close(); }catch{}
  try{ fs.rmSync(ctx.userData, { recursive:true, force:true }); }catch{}
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

async function snap(page, testInfo, name){
  fs.mkdirSync(ARTIFACT_DIR, { recursive:true });
  const slug = testInfo.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  const file = path.join(ARTIFACT_DIR, `${slug}--${name}.png`);
  await page.screenshot({ path:file });
  return file;
}

module.exports = {
  REPO_DIR, PRIVATE_DIR, scenarioPath, missingFixtures, launchApp, closeApp,
  readEvents, waitForEvent, indexOfEvent, enableProtection, layerOpacity, snap
};
