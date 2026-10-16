// Phase 2: pose-aware, app-aware, profile-driven escalation (mock backend with face tracks).
const { test, expect } = require('@playwright/test');
const h = require('./helpers/app');

const OUTLOOK = { process:'C:\\Program Files\\Microsoft Office\\root\\Office16\\OUTLOOK.EXE', title:'Inbox - SECRET-SUBJECT-TEXT - Outlook' };

let ctx;
test.afterEach(async ({}, testInfo) => { h.keepLogOnFailure(ctx, testInfo); await h.closeApp(ctx); ctx = null; });

async function start(mock, options = {}){
  ctx = await h.launchApp({ mock, ...options });
  await h.enableProtection(ctx.page);
  return ctx;
}

const events = () => h.readEvents(ctx.logFile);
const decisions = () => events().filter((e) => e.startsWith('POLICY_DECISION|'));

test('someone walking past side-on: gentle blur only, no focus or lock (Office)', async ({}, testInfo) => {
  const { page, logFile } = await start('passerby_away');
  await h.waitForEvent(logFile, 'AI_STATE|STATE|UNKNOWN_PERSON');
  await h.waitForEvent(logFile, 'POLICY_DECISION|action=BLUR');
  const ms = h.msBetween(logFile, 'AI_STATE|STATE|UNKNOWN_PERSON', 'POLICY_DECISION|action=BLUR');
  expect(ms).toBeGreaterThanOrEqual(1900); // notLooking.blurMs = 2000
  expect(decisions()[0]).toContain('not looking at the screen');
  await page.waitForTimeout(7000);
  expect(decisions().map((d) => d.split('|')[1])).toEqual(['action=BLUR']);
  expect(events().some((e) => e.startsWith('LOCK_REQUESTED'))).toBe(false);
  await h.snap(page, testInfo, 'passerby');
});

test('someone facing the screen: blur, focus, lock on the Office timings', async ({}, testInfo) => {
  const { page, logFile } = await start('watcher_facing');
  await h.waitForEvent(logFile, 'TEST_LOCK_SIMULATED|reason=privacy-threat', 15000);
  expect(decisions().map((d) => d.split('|')[1])).toEqual(['action=BLUR', 'action=FOCUS', 'action=LOCK']);
  const lockMs = h.msBetween(logFile, 'AI_STATE|STATE|UNKNOWN_PERSON', 'POLICY_DECISION|action=LOCK');
  expect(lockMs).toBeGreaterThanOrEqual(4900);
  expect(lockMs).toBeLessThan(6000);
  expect(decisions()[2]).toContain('Locking: unknown person facing the screen for 5.');
  await expect(page.locator('#eventList')).toContainText('Screen lock');
  await h.snap(page, testInfo, 'watcher');
});

test('sensitive app in the foreground escalates faster; the title is never logged', async ({}, testInfo) => {
  const { page, logFile } = await start('watcher_facing', { activeApp:OUTLOOK });
  await h.waitForEvent(logFile, 'SENSITIVE_APP_ACTIVE|category=Email|app=Outlook');
  await h.waitForEvent(logFile, 'TEST_LOCK_SIMULATED|reason=privacy-threat', 15000);
  const lockMs = h.msBetween(logFile, 'AI_STATE|STATE|UNKNOWN_PERSON', 'POLICY_DECISION|action=LOCK');
  expect(lockMs).toBeGreaterThanOrEqual(2900); // sensitiveEscalation.lockMs = 3000
  expect(lockMs).toBeLessThan(4000);
  expect(decisions().at(-1)).toContain('while Outlook (email) is active (Office profile)');
  const fs = require('fs');
  expect(fs.readFileSync(logFile, 'utf8')).not.toContain('SECRET-SUBJECT-TEXT');
  await h.snap(page, testInfo, 'sensitive');
});

test('foreground app changes are followed while protection is on', async () => {
  const { logFile } = await start('owner_present');
  await h.waitForEvent(logFile, 'PRESENCE_GATE|REVEALED');
  h.setActiveApp(ctx, OUTLOOK);
  await h.waitForEvent(logFile, 'SENSITIVE_APP_ACTIVE|category=Email');
  h.setActiveApp(ctx, { process:'C:\\Windows\\notepad.exe', title:'x' });
  await h.waitForEvent(logFile, 'SENSITIVE_APP_INACTIVE');
});

test('profile switch from the panel: Home ignores glancing, curtain becomes blur, choice persists', async ({}, testInfo) => {
  ctx = await h.launchApp({ mock:'watcher_glancing' });
  const { page, logFile } = ctx;
  await expect(page.locator('#profileSelect')).toHaveValue('Office');
  await page.locator('#profileSelect').selectOption('Home');
  await h.waitForEvent(logFile, 'PROFILE_CHANGED|profile=Home|source=panel');
  await expect(page.locator('#eventList')).toContainText('Privacy profile: Home');

  await h.enableProtection(page);
  await h.waitForEvent(logFile, 'PRESENCE_GATE|CONCEALED|reason=threat');
  // Home curtain = blur at full intensity
  expect(await h.curtainOn(page)).toBe(true);
  expect(await h.layerOpacity(page, 'overlay')).toBe('1');
  expect(await h.layerOpacity(page, 'blackoutLayer')).toBe('0');
  // Glancing does not count at Home: no focus within 4 s (Office would focus at 3 s).
  await page.waitForTimeout(4000);
  expect(decisions().some((d) => d.includes('action=FOCUS') || d.includes('action=LOCK'))).toBe(false);
  await h.snap(page, testInfo, 'home-profile');

  const userData = ctx.userData;
  await h.closeApp(ctx, { keepUserData:true });
  ctx = await h.launchApp({ mock:'owner_present', userData });
  await expect(ctx.page.locator('#profileSelect')).toHaveValue('Home');
  await h.waitForEvent(ctx.logFile, 'PROFILE_ACTIVE|profile=Home');
});

test('Public profile: anyone nearby is blurred at once', async () => {
  ctx = await h.launchApp({ mock:'passerby_away' });
  await ctx.page.locator('#profileSelect').selectOption('Public');
  await h.enableProtection(ctx.page);
  await h.waitForEvent(ctx.logFile, 'POLICY_DECISION|action=BLUR');
  expect(h.msBetween(ctx.logFile, 'AI_STATE|STATE|UNKNOWN_PERSON', 'POLICY_DECISION|action=BLUR')).toBeLessThan(300);
});
