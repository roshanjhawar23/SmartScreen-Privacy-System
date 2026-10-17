// Phase 5: security images are opt-in, encrypted, viewable only in the app, bounded, and never
// keep a photo of a trusted person.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const h = require('./helpers/app');
const { TINY_JPEG } = require('./mock_backend');

const NOTICE = 'SmartScreen will save small photos of unrecognized people. Make sure people around you are aware.';

let ctx;
test.afterEach(async ({}, testInfo) => { h.keepLogOnFailure(ctx, testInfo); await h.closeApp(ctx); ctx = null; });

const evidenceDir = () => path.join(ctx.userData, 'evidence');
const encFiles = () => (fs.existsSync(evidenceDir()) ? fs.readdirSync(evidenceDir()).filter((n) => n.endsWith('.enc')) : []);
const events = () => h.readEvents(ctx.logFile);

// Record every dialog message; answer "Turn on" / "Delete all" / "Continue" (button 1).
async function recordDialogs(app){
  await app.evaluate(({ dialog }) => {
    global.__dialogs = [];
    dialog.showMessageBox = async (_win, options) => { global.__dialogs.push((options || _win).message); return { response:1 }; };
  });
}
const dialogs = () => ctx.app.evaluate(() => global.__dialogs);

async function openDiagnostics(page){
  await page.locator('#diagBtn').click();
  await expect(page.locator('#diagPanel')).toBeVisible();
}

test('off by default: a threat produces no image and nothing is stored', async () => {
  ctx = await h.launchApp({ mock:'threat_lock' });
  const { page, logFile } = ctx;
  await openDiagnostics(page);
  await expect(page.locator('#diagEvidence')).toHaveText('0 of 30 kept · off');
  await expect(page.locator('#evidenceToggleBtn')).toHaveText('Save images: Off');
  await h.enableProtection(page);
  await h.waitForEvent(logFile, 'AI_STATE|STATE|UNKNOWN_PERSON');
  await page.waitForTimeout(1500);
  expect(events().some((e) => e.startsWith('PHOTO_SAVED'))).toBe(false);
  expect(encFiles()).toEqual([]);
});

test('turning it on shows the notice once; images are encrypted and viewable in the app', async ({}, testInfo) => {
  ctx = await h.launchApp({ mock:'threat_lock' });
  const { page, app, logFile } = ctx;
  await recordDialogs(app);
  await openDiagnostics(page);
  await page.locator('#evidenceToggleBtn').click();
  await expect(page.locator('#evidenceToggleBtn')).toHaveText('Save images: On');
  expect(await dialogs()).toEqual([NOTICE]);
  // off and on again: no second notice
  await page.locator('#evidenceToggleBtn').click();
  await expect(page.locator('#evidenceToggleBtn')).toHaveText('Save images: Off');
  await page.locator('#evidenceToggleBtn').click();
  await expect(page.locator('#evidenceToggleBtn')).toHaveText('Save images: On');
  expect(await dialogs()).toEqual([NOTICE]);
  await h.waitForEvent(logFile, 'EVIDENCE_SETTING|enabled=true');

  await h.enableProtection(page);
  await h.waitForEvent(logFile, 'PHOTO_SAVED|event=');
  expect(encFiles()).toHaveLength(1);
  const raw = fs.readFileSync(path.join(evidenceDir(), encFiles()[0]));
  expect(raw.includes(Buffer.from(TINY_JPEG, 'base64').subarray(0, 4))).toBe(false); // no JPEG on disk
  expect(raw.toString('utf8')).not.toContain(TINY_JPEG);

  await page.locator('#evidenceViewBtn').click();
  await expect(page.locator('#evidenceCaption')).toContainText('1 / 1');
  const src = await page.locator('#evidenceImg').getAttribute('src');
  expect(src).toBe(`data:image/jpeg;base64,${TINY_JPEG}`);
  await h.waitForEvent(logFile, 'EVIDENCE_VIEWED');
  await h.snap(page, testInfo, 'viewer');

  await page.locator('#evidenceDeleteBtn').click();
  await expect(page.locator('#evidenceCaption')).toHaveText('No security images.');
  expect(encFiles()).toEqual([]);
  await expect(page.locator('#diagEvidence')).toHaveText('0 of 30 kept · on');
});

test('turning it on mid-session applies to the next threat at once', async () => {
  ctx = await h.launchApp({ mock:'evidence_threat_twice' });
  const { page, app, logFile } = ctx;
  await recordDialogs(app);
  await h.enableProtection(page);
  await h.waitForEvent(logFile, 'AI_STATE|STATE|UNKNOWN_PERSON'); // first threat: off, no image
  await h.waitForEvent(logFile, 'PROTECTION_SEQUENCE_CANCELLED|type=THREAT');
  await openDiagnostics(page);
  await page.locator('#evidenceToggleBtn').click(); // the backend is told "EVIDENCE|1"
  await expect(page.locator('#evidenceToggleBtn')).toHaveText('Save images: On');
  await h.waitForEvent(logFile, 'PHOTO_SAVED|event=', 15000); // second threat
  expect(events().filter((e) => e.startsWith('PHOTO_SAVED'))).toHaveLength(1);
  expect(encFiles()).toHaveLength(1);
});

test('never keeps a photo of a trusted person: an owner-confirmed event is deleted', async () => {
  ctx = await h.launchApp({ mock:'evidence_discard' });
  const { page, app, logFile } = ctx;
  await recordDialogs(app);
  await openDiagnostics(page);
  await page.locator('#evidenceToggleBtn').click();
  await h.enableProtection(page);
  await h.waitForEvent(logFile, 'PHOTO_SAVED|event=');
  expect(encFiles()).toHaveLength(1);
  await h.waitForEvent(logFile, 'PHOTO_DISCARDED|');
  expect(events().find((e) => e.startsWith('PHOTO_DISCARDED|'))).toMatch(/reason=owner-confirmed\|removed=1$/);
  expect(encFiles()).toEqual([]);
  await expect(page.locator('#eventList')).toContainText(/trusted person recognized|Owner verified|Screen revealed/);
});

test('only the newest N are kept', async () => {
  ctx = await h.launchApp({ mock:'evidence_three', settings:{ evidence:{ maxImages:2 } } });
  const { page, app, logFile } = ctx;
  await recordDialogs(app);
  await openDiagnostics(page);
  await page.locator('#evidenceToggleBtn').click();
  await h.enableProtection(page);
  await expect.poll(() => events().filter((e) => e.startsWith('PHOTO_SAVED')).length, { timeout:10000 }).toBe(3);
  expect(encFiles()).toHaveLength(2);
  await expect(page.locator('#diagEvidence')).toHaveText('2 of 2 kept · on');
  await page.locator('#evidenceViewBtn').click();
  await page.locator('#evidenceDeleteAllBtn').click();
  await expect(page.locator('#evidenceCaption')).toHaveText('No security images.');
  expect(encFiles()).toEqual([]);
  expect(await dialogs()).toEqual([NOTICE, 'Delete all security images? This cannot be undone.']);
  await h.waitForEvent(logFile, 'EVIDENCE_DELETED|count=2');
});

test('plaintext images of earlier versions are encrypted, then deleted', async () => {
  // First launch creates the profile; seed old-style files, then start again on it.
  ctx = await h.launchApp({ mock:'owner_present' });
  const userData = ctx.userData;
  await h.closeApp(ctx, { keepUserData:true });
  const legacy = path.join(userData, 'intruder_logs');
  fs.mkdirSync(legacy, { recursive:true });
  const jpeg = Buffer.from(TINY_JPEG, 'base64');
  for(const name of ['20261016_101500_001.jpg', '20261016_101501_002.jpg', '20261016_101502_003.jpg']) fs.writeFileSync(path.join(legacy, name), jpeg);
  fs.writeFileSync(path.join(legacy, 'notes.txt'), 'not ours');

  ctx = await h.launchApp({ mock:'owner_present', userData });
  await h.waitForEvent(ctx.logFile, 'EVIDENCE_MIGRATED|encrypted=3|plaintextDeleted=3');
  expect(fs.readdirSync(legacy)).toEqual(['notes.txt']);
  expect(encFiles()).toHaveLength(3);
  await openDiagnostics(ctx.page);
  await ctx.page.locator('#evidenceViewBtn').click();
  await expect(ctx.page.locator('#evidenceCaption')).toContainText('1 / 3');
  expect(await ctx.page.locator('#evidenceImg').getAttribute('src')).toBe(`data:image/jpeg;base64,${TINY_JPEG}`);
});
