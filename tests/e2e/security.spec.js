// Phase 3: liveness requirement, tamper detection and local diagnostics (mock backend).
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const h = require('./helpers/app');

let ctx;
test.afterEach(async ({}, testInfo) => { h.keepLogOnFailure(ctx, testInfo); await h.closeApp(ctx); ctx = null; });

async function start(mock, options = {}){
  ctx = await h.launchApp({ mock, ...options });
  await h.autoConfirmDialogs(ctx.app);
  await h.enableProtection(ctx.page);
  return ctx;
}

const events = () => h.readEvents(ctx.logFile);
const has = (prefix) => events().some((e) => e.startsWith(prefix));
const gateStatus = () => ctx.page.locator('#gate-status');

test('liveness: an owner face flagged as photo/screen never reveals the screen', async ({}, testInfo) => {
  const { page } = await start('owner_suspect');
  await page.waitForTimeout(5000);
  expect(has('AI_STATE|STATE|OWNER_PRESENT')).toBe(true);
  expect(has('PRESENCE_GATE|REVEALED')).toBe(false);
  expect(await h.curtainOn(page)).toBe(true);
  await h.snap(page, testInfo, 'suspect-owner');
});

test('liveness: reveal waits until the owner face shows signs of life', async () => {
  const { logFile } = await start('owner_liveness_late');
  await h.waitForEvent(logFile, 'PRESENCE_GATE|REVEALED', 15000);
  // LIVE arrives 3 s after the first owner update; reveal needs 1.2 s of LIVE updates after that.
  expect(h.msBetween(logFile, 'AI_STATE|STATE|OWNER_PRESENT', 'PRESENCE_GATE|REVEALED')).toBeGreaterThanOrEqual(4000);
});

test('tamper: camera covered is its own event and fails closed', async ({}, testInfo) => {
  const { page, logFile } = await start('camera_covered');
  await h.waitForEvent(logFile, 'TAMPER|camera-covered|mean=0.0|std=0.3', 15000);
  await h.waitForEvent(logFile, 'PRESENCE_GATE|FAILSAFE');
  expect(await h.curtainOn(page)).toBe(true);
  await expect(page.locator('#eventList')).toContainText(/Camera covered|Camera unavailable|Screen protected/);
  await h.snap(page, testInfo, 'covered');
});

test('tamper: editing settings.json while protected → FAILSAFE', async ({}, testInfo) => {
  const { page, logFile, configDir } = await start('owner_present', { configCopy:true });
  await h.waitForEvent(logFile, 'PRESENCE_GATE|REVEALED');
  const file = path.join(configDir, 'settings.json');
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  json.intruderDetectionEnabled = false; // an attacker switching threat detection off
  fs.writeFileSync(file, JSON.stringify(json, null, 2));
  await h.waitForEvent(logFile, 'TAMPER|config-modified|file=settings.json', 10000);
  await h.waitForEvent(logFile, 'PRESENCE_GATE|FAILSAFE|reason=tamper-config-modified');
  expect(await h.curtainOn(page)).toBe(true);
  await expect(gateStatus()).toHaveText('Tamper detected — screen protected');
  await h.snap(page, testInfo, 'config-tamper');
});

test('tamper: config changed while the app was closed is reported on the next start (info only)', async () => {
  ctx = await h.launchApp({ mock:'owner_present', configCopy:true });
  await h.waitForEvent(ctx.logFile, 'PROFILE_ACTIVE');
  const { userData, configDir } = ctx;
  await h.closeApp(ctx, { keepUserData:true });
  fs.appendFileSync(path.join(configDir, 'policies.json'), '\n');
  ctx = await h.launchApp({ mock:'owner_present', userData, configDir });
  await h.waitForEvent(ctx.logFile, 'CONFIG_CHANGED_SINCE_LAST_RUN|file=policies.json');
  expect(events().filter((e) => e.startsWith('TAMPER|'))).toEqual([]);
});

test('tamper: a major system clock jump → FAILSAFE; a small one is only logged', async () => {
  const { app, logFile } = await start('owner_present');
  await h.waitForEvent(logFile, 'PRESENCE_GATE|REVEALED');
  await app.evaluate(() => { const real = Date.now; Date.now = () => real() + 60 * 1000; });
  await h.waitForEvent(logFile, 'CLOCK_ADJUSTED|deltaMs=', 12000);
  expect(has('PRESENCE_GATE|FAILSAFE')).toBe(false);
  await app.evaluate(() => { const shifted = Date.now; Date.now = () => shifted() + 60 * 60 * 1000; });
  await h.waitForEvent(logFile, 'TAMPER|clock-jump|deltaMs=', 12000);
  await h.waitForEvent(logFile, 'PRESENCE_GATE|FAILSAFE|reason=tamper-clock-jump');
});

test('tamper: camera device set changed while protected → FAILSAFE', async () => {
  const { app, logFile } = await start('owner_present');
  await h.waitForEvent(logFile, 'PRESENCE_GATE|REVEALED');
  // Simulate the renderer's devicechange report with a different camera.
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    const primary = BrowserWindow.getAllWindows().find((w) => w.getBounds().width > 0);
    ipcMain.emit('video-devices', { sender:primary.webContents }, ['some-other-camera-id']);
  });
  await h.waitForEvent(logFile, 'TAMPER|camera-device-changed|added=1');
  await h.waitForEvent(logFile, 'PRESENCE_GATE|FAILSAFE|reason=tamper-camera-device-changed');
});

test('tamper: repeated AI failures are reported as a restart loop', async () => {
  const { page, logFile } = await start('ai_crash');
  for(let i = 1; i <= 2; i++){
    await expect.poll(() => events().filter((e) => e.startsWith('AI_EXIT|code=1')).length, { timeout:15000 }).toBe(i);
    await expect(page.locator('#retryBtn')).toBeVisible();
    await page.locator('#retryBtn').click();
  }
  await h.waitForEvent(logFile, 'TAMPER|ai-restart-loop|failures=3', 15000);
});

test('diagnostics: live numbers in the panel and a local export without sensitive data', async ({}, testInfo) => {
  const { page, app, logFile, userData } = await start('owner_with_stats', {
    activeApp:{ process:'C:\\x\\OUTLOOK.EXE', title:'Inbox - SECRET-SUBJECT - Outlook' }
  });
  await h.waitForEvent(logFile, 'SENSITIVE_APP_ACTIVE');
  await page.locator('#diagBtn').click();
  await expect(page.locator('#diagCamera')).toHaveText('29.8 fps · 9.9 analysed/s', { timeout:10000 });
  await expect(page.locator('#diagRecognition')).toHaveText('24.1 ms · p95 31.0 ms');
  await h.snap(page, testInfo, 'diagnostics');

  const exportPath = path.join(userData, 'diag-export.json');
  await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled:false, filePath:file }); }, exportPath);
  await page.locator('#diagExportBtn').click();
  await h.waitForEvent(logFile, 'DIAGNOSTICS_EXPORTED|file=diag-export.json');
  const report = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
  expect(report.backend.fps).toBe(29.8);
  expect(report.counters.reveals).toBeGreaterThanOrEqual(1);
  expect(report.profile).toBe('Office');
  const text = JSON.stringify(report);
  expect(text).not.toContain('SECRET-SUBJECT');
  expect(text).not.toMatch(/embedding|template|\.jpg/i);
});
