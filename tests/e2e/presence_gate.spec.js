// Presence Gate rules (MASTER_PROMPT Phase 1.5) on the real app with the mock backend.
const { test, expect } = require('@playwright/test');
const h = require('./helpers/app');

let ctx;
test.afterEach(async () => { await h.closeApp(ctx); ctx = null; });

async function start(mock, options = {}){
  ctx = await h.launchApp({ mock, ...options });
  await h.autoConfirmDialogs(ctx.app);
  await h.enableProtection(ctx.page);
  return ctx;
}

const gateStatus = () => ctx.page.locator('#gate-status');
const events = () => h.readEvents(ctx.logFile);
const has = (prefix) => events().some((e) => e.startsWith(prefix));

test('rule 1: curtain is up before the backend is ready', async ({}, testInfo) => {
  const { page, logFile } = await start('owner_slow_start'); // AI_READY only after 3 s
  expect(await h.curtainOn(page)).toBe(true);
  expect(await h.layerOpacity(page, 'blackoutLayer')).toBe('1');
  expect(has('AI_READY')).toBe(false);
  await expect(gateStatus()).toHaveText('Screen concealed — verifying owner');
  await h.snap(page, testInfo, 'concealed-before-ready');
  h.expectEventOrder(events(), ['PRESENCE_GATE|CONCEALED|reason=protection-enabled', 'TEST_MOCK_BACKEND|']);
  await h.waitForEvent(logFile, 'PRESENCE_GATE|REVEALED|reason=owner-verified', 15000);
  expect(await h.curtainOn(page)).toBe(false);
});

test('rule 2: reveal only after repeated owner updates and the confirm time', async ({}, testInfo) => {
  const { page, logFile } = await start('owner_present');
  await h.waitForEvent(logFile, 'PRESENCE_GATE|VERIFYING|reason=owner-detected');
  expect(await h.curtainOn(page)).toBe(true);
  await h.waitForEvent(logFile, 'PRESENCE_GATE|REVEALED|reason=owner-verified');
  await expect.poll(() => h.curtainOn(page)).toBe(false);
  await expect(gateStatus()).toHaveText('Screen visible — owner verified');
  await h.snap(page, testInfo, 'revealed');
  const ms = h.msBetween(logFile, 'PRESENCE_GATE|VERIFYING', 'PRESENCE_GATE|REVEALED');
  expect(ms).toBeGreaterThanOrEqual(1200);
  expect(ms).toBeLessThan(2500);
  // State updates repeat every ~400 ms, but AI_STATE is logged on change only.
  await page.waitForTimeout(2000);
  expect(events().filter((e) => e.startsWith('AI_STATE|STATE|OWNER_PRESENT'))).toHaveLength(1);
});

for(const mock of ['unknown_only', 'owner_and_unknown_only']){
  test(`rule 3: never reveals for ${mock}`, async ({}, testInfo) => {
    const { page } = await start(mock);
    await page.waitForTimeout(5000);
    expect(await h.curtainOn(page)).toBe(true);
    expect(has('PRESENCE_GATE|REVEALED')).toBe(false);
    await expect(gateStatus()).toHaveText(/^Screen concealed/);
    await h.snap(page, testInfo, 'still-concealed');
  });
}

test('rule 3: a threat while revealed conceals immediately; escalation still runs', async ({}, testInfo) => {
  const { page, logFile } = await start('threat_lock');
  await h.waitForEvent(logFile, 'PRESENCE_GATE|REVEALED');
  await h.waitForEvent(logFile, 'PRESENCE_GATE|CONCEALED|reason=threat-unknown_person');
  expect(await h.curtainOn(page)).toBe(true);
  await expect(gateStatus()).toHaveText('Screen concealed — unrecognized person');
  expect(h.msBetween(logFile, 'AI_STATE|STATE|UNKNOWN_PERSON', 'PRESENCE_GATE|CONCEALED|reason=threat')).toBeLessThan(100);
  await h.waitForEvent(logFile, 'TEST_LOCK_SIMULATED|reason=privacy-threat');
  await h.snap(page, testInfo, 'threat-concealed');
});

test('rule 4: owner absent → grace → concealed; walk-away still runs', async ({}, testInfo) => {
  const { page, logFile } = await start('walkaway_lock');
  await h.waitForEvent(logFile, 'PRESENCE_GATE|REVEALED');
  await h.waitForEvent(logFile, 'PRESENCE_GATE|ABSENCE_GRACE|reason=no-user');
  expect(await h.curtainOn(page)).toBe(false); // grace absorbs flicker
  await h.waitForEvent(logFile, 'PRESENCE_GATE|CONCEALED|reason=owner-absent');
  expect(await h.curtainOn(page)).toBe(true);
  await expect(gateStatus()).toHaveText('Screen concealed — owner absent');
  const grace = h.msBetween(logFile, 'PRESENCE_GATE|ABSENCE_GRACE', 'PRESENCE_GATE|CONCEALED|reason=owner-absent');
  expect(grace).toBeGreaterThanOrEqual(1450);
  expect(grace).toBeLessThan(2500);
  await h.waitForEvent(logFile, 'TEST_LOCK_SIMULATED|reason=walk-away');
  await h.snap(page, testInfo, 'absent-concealed');
});

test('rule 4: a short detection gap within the grace stays revealed', async () => {
  const { page, logFile } = await start('absence_flicker');
  await h.waitForEvent(logFile, 'PRESENCE_GATE|ABSENCE_GRACE');
  await h.waitForEvent(logFile, 'PRESENCE_GATE|REVEALED|reason=owner-returned');
  await page.waitForTimeout(2500);
  expect(has('PRESENCE_GATE|CONCEALED|reason=owner-absent')).toBe(false);
  expect(await h.curtainOn(page)).toBe(false);
});

for(const [mock, reason, text, settings] of [
  ['camera_error', 'camera-error', 'Camera unavailable — screen protected'],
  ['ai_crash', 'backend-exit', 'Verification unavailable — screen protected'],
  ['watchdog_hang', 'watchdog-timeout', 'Verification unavailable — screen protected', { aiWatchdogTimeoutMs:5000 }],
  ['unknown_state', 'unknown-state-SOMETHING_NEW', 'Verification unavailable — screen protected']
]){
  test(`rule 5: ${mock} → FAILSAFE, concealed, Retry offered`, async ({}, testInfo) => {
    const { page, logFile } = await start(mock, { settings });
    await h.waitForEvent(logFile, 'PRESENCE_GATE|REVEALED');
    await h.waitForEvent(logFile, `PRESENCE_GATE|FAILSAFE|reason=${reason}`, 15000);
    expect(await h.curtainOn(page)).toBe(true);
    await expect(gateStatus()).toHaveText(text);
    await expect(page.locator('#retryBtn')).toBeVisible();
    await expect(page.locator('#aiBtn')).toHaveText('Disable Protection');
    await page.waitForTimeout(1500);
    expect(await h.curtainOn(page)).toBe(true); // stays concealed
    await h.snap(page, testInfo, 'failsafe');
  });
}

test('rule 5: Retry, then owner verification, leaves FAILSAFE', async ({}, testInfo) => {
  const { page, logFile } = await start('camera_error_late');
  await h.waitForEvent(logFile, 'PRESENCE_GATE|FAILSAFE|reason=camera-error', 15000);
  await page.locator('#retryBtn').click();
  await h.waitForEvent(logFile, 'PROTECTION_RETRY');
  await expect(page.locator('#retryBtn')).toBeHidden();
  expect(await h.curtainOn(page)).toBe(true); // still concealed until verified
  await expect.poll(() => events().filter((e) => e.startsWith('PRESENCE_GATE|REVEALED')).length, { timeout:10000 }).toBe(2);
  expect(await h.curtainOn(page)).toBe(false);
  h.expectEventOrder(events(), [
    'PRESENCE_GATE|FAILSAFE|reason=camera-error', 'PRESENCE_GATE|CONCEALED|reason=retry', 'PROTECTION_RETRY'
  ]);
  await h.snap(page, testInfo, 'retried-revealed');
});

test('rule 5/6: confirmed Disable Protection removes the curtain', async ({}, testInfo) => {
  const { page, logFile } = await start('camera_error');
  await h.waitForEvent(logFile, 'PRESENCE_GATE|FAILSAFE', 15000);
  await page.locator('#aiBtn').click();
  await h.waitForEvent(logFile, 'PRESENCE_GATE|DISABLED|reason=protection-disabled');
  await expect.poll(() => h.curtainOn(page)).toBe(false);
  await expect(page.locator('#aiBtn')).toHaveText('Enable Protection');
  await expect(page.locator('#retryBtn')).toBeHidden();
  await h.snap(page, testInfo, 'disabled');
});

test('rule 6: the Presence Gate toggle is locked while protection is on', async () => {
  const { page } = await start('owner_present');
  await expect(page.locator('#gateBtn')).toBeDisabled();
});

test('rule 7: session lock and unlock re-conceal; reveal again needs verification', async ({}, testInfo) => {
  const { page, app, logFile } = await start('owner_present');
  await h.waitForEvent(logFile, 'PRESENCE_GATE|REVEALED');
  await h.emitPowerEvent(app, 'lock-screen');
  await h.waitForEvent(logFile, 'PRESENCE_GATE|CONCEALED|reason=session-locked');
  expect(await h.curtainOn(page)).toBe(true);
  await h.emitPowerEvent(app, 'unlock-screen');
  // Mock keeps sending owner updates: verification starts again from zero.
  await expect.poll(() => events().filter((e) => e.startsWith('PRESENCE_GATE|REVEALED')).length, { timeout:10000 }).toBe(2);
  const all = events();
  const locked = all.findIndex((e) => e === 'PRESENCE_GATE|CONCEALED|reason=session-locked');
  const verifyingAgain = all.findIndex((e, i) => i > locked && e.startsWith('PRESENCE_GATE|VERIFYING'));
  const revealedAgain = all.findIndex((e, i) => i > locked && e.startsWith('PRESENCE_GATE|REVEALED'));
  expect(locked).toBeGreaterThanOrEqual(0);
  expect(verifyingAgain).toBeGreaterThan(locked);
  expect(revealedAgain).toBeGreaterThan(verifyingAgain);
  expect(events().some((e) => /unlock|LOGON|AUTH/i.test(e) && !e.startsWith('PRESENCE_GATE'))).toBe(false);
  await h.snap(page, testInfo, 're-revealed');
});

for(const [effect, layer] of [['blur', 'overlay'], ['pixelate', 'pixelateLayer']]){
  test(`rule 8: curtain effect "${effect}" at full intensity`, async ({}, testInfo) => {
    const { page } = await start('unknown_only', { settings:{ presenceGate:{ curtainEffect:effect } } });
    await page.waitForTimeout(1000);
    expect(await h.curtainOn(page)).toBe(true);
    expect(await h.layerOpacity(page, layer)).toBe('1');
    expect(await h.layerOpacity(page, 'blackoutLayer')).toBe('0');
    if(effect === 'blur'){
      expect(await page.evaluate(() => document.getElementById('overlay').style.backdropFilter)).toBe('blur(30px)');
    }
    await h.snap(page, testInfo, effect);
  });
}

test('rule 8: control panel stays usable under the curtain', async () => {
  const { page } = await start('unknown_only');
  expect(await h.curtainOn(page)).toBe(true);
  await page.locator('#effectsBtn').click();
  await expect(page.locator('#effectsPanel')).toBeVisible();
});

test('rule 9: transitions appear in the event history', async () => {
  const { page, logFile } = await start('walkaway_lock');
  await h.waitForEvent(logFile, 'PRESENCE_GATE|CONCEALED|reason=owner-absent');
  await expect(page.locator('#eventList')).toContainText(/Screen concealed — owner absent|Walk-away|Privacy focus/);
  const titles = h.readEvents(logFile).filter((e) => e.startsWith('PRESENCE_GATE|'));
  expect(titles).toEqual(expect.arrayContaining([
    'PRESENCE_GATE|CONCEALED|reason=protection-enabled',
    'PRESENCE_GATE|REVEALED|reason=owner-verified',
    'PRESENCE_GATE|CONCEALED|reason=owner-absent'
  ]));
});

test('gate toggle off: no curtain for absence, but a camera failure still fails closed', async ({}, testInfo) => {
  ctx = await h.launchApp({ mock:'camera_error_late' });
  await h.autoConfirmDialogs(ctx.app);
  const { page, logFile } = ctx;
  await page.locator('#gateBtn').click();
  await expect(page.locator('#gateBtn')).toHaveAttribute('aria-pressed', 'false');
  await expect(gateStatus()).toHaveText('Presence Gate off');
  await h.enableProtection(page);
  await expect(page.locator('#identity-live')).toHaveText('Owner verified');
  expect(await h.curtainOn(page)).toBe(false);
  await h.waitForEvent(logFile, 'PRESENCE_GATE|FAILSAFE|reason=camera-error', 15000);
  expect(await h.curtainOn(page)).toBe(true);
  await h.snap(page, testInfo, 'toggle-off-failsafe');
});
