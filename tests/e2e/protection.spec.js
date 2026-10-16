// Protection rules on the real app, driven by the scripted mock backend
// (tests/e2e/scenarios/*.json). No camera, no biometric fixtures needed.
const { test, expect } = require('@playwright/test');
const h = require('./helpers/app');

let ctx;
test.afterEach(async () => { await h.closeApp(ctx); ctx = null; });

async function start(mock, options = {}){
  ctx = await h.launchApp({ mock, ...options });
  await h.enableProtection(ctx.page);
  return ctx;
}

const identity = () => ctx.page.locator('#identity-live');
const status = () => ctx.page.locator('#ai-status');
const noLock = () => expect(h.readEvents(ctx.logFile).some((e) => e.startsWith('LOCK_REQUESTED'))).toBe(false);

test('owner present: verified, screen clear, no lock', async ({}, testInfo) => {
  const { page, logFile } = await start('owner_present');
  await expect(identity()).toHaveText('Owner verified');
  await expect(status()).toHaveText('Owner verified');
  await page.waitForTimeout(3000);
  expect(await h.anyProtectiveLayerOn(page)).toBe(false);
  await h.snap(page, testInfo, 'owner');
  h.expectEventOrder(h.readEvents(logFile), ['TEST_MODE_ACTIVE', 'TEST_MOCK_BACKEND|owner_present.json', 'AI_READY', 'AI_STATE|STATE|OWNER_PRESENT']);
  noLock();
});

test('walk-away: owner returns before the deadline, sequence cancelled, no lock', async ({}, testInfo) => {
  const { page, logFile } = await start('walkaway_return');
  await expect(identity()).toHaveText('Owner verified');
  await expect(identity()).toHaveText('No person detected');
  await expect(status()).toHaveText(/^User away — locking in \ds$/);
  expect(await h.layerOpacity(page, 'overlay')).toBe('1');
  await h.snap(page, testInfo, '1-away-blur');

  await expect(identity()).toHaveText('Owner verified');
  await h.waitForEvent(logFile, 'PROTECTION_SEQUENCE_CANCELLED|type=WALK_AWAY|reason=owner-returned');
  await expect.poll(() => h.anyProtectiveLayerOn(page)).toBe(false);
  await h.snap(page, testInfo, '2-owner-back');

  await page.waitForTimeout(6000); // past the original walk-away deadline
  h.expectEventOrder(h.readEvents(logFile), [
    'AI_STATE|STATE|OWNER_PRESENT', 'AI_STATE|STATE|NO_USER', 'WALK_AWAY_TIMER_ARMED',
    'PROTECTION_SEQUENCE_CANCELLED|type=WALK_AWAY|reason=owner-returned'
  ]);
  noLock();
});

test('walk-away: owner stays away, blur then focus then simulated lock', async ({}, testInfo) => {
  const { page, logFile } = await start('walkaway_lock');
  await expect(identity()).toHaveText('No person detected', { timeout:10000 });
  expect(await h.layerOpacity(page, 'overlay')).toBe('1');
  await h.waitForEvent(logFile, 'WALK_AWAY_FOCUS_ACTIVATED');
  expect(await h.layerOpacity(page, 'focusLayer')).toBe('1');
  await h.waitForEvent(logFile, 'TEST_LOCK_SIMULATED|reason=walk-away');
  await expect(status()).toHaveText('Locking screen');
  await h.snap(page, testInfo, 'locked');
  const events = h.readEvents(logFile);
  h.expectEventOrder(events, [
    'AI_STATE|STATE|NO_USER', 'WALK_AWAY_TIMER_ARMED', 'WALK_AWAY_FOCUS_ACTIVATED',
    'WALK_AWAY_TIMER_EXPIRED', 'LOCK_REQUESTED|reason=walk-away', 'TEST_LOCK_SIMULATED|reason=walk-away'
  ]);
  expect(events.some((e) => e.startsWith('LOCK_COMMAND_COMPLETED'))).toBe(false);
});

for(const [mock, label] of [
  ['threat_lock', 'Unrecognized person'],
  ['unknown_group', 'Unrecognized people'],
  ['owner_and_unknown', 'Owner + unrecognized person']
]){
  test(`threat (${mock}): blur, focus, evidence, simulated lock`, async ({}, testInfo) => {
    const { page, logFile } = await start(mock);
    await expect(identity()).toHaveText('Owner verified');
    await expect(identity()).toHaveText(label);
    await expect(status()).toHaveText('Privacy threat detected');
    expect(await h.layerOpacity(page, 'overlay')).toBe('1');
    await h.snap(page, testInfo, '1-threat');

    await h.waitForEvent(logFile, 'TEST_LOCK_SIMULATED|reason=privacy-threat');
    await h.snap(page, testInfo, '2-locked');
    const state = { threat_lock:'UNKNOWN_PERSON', unknown_group:'UNKNOWN_GROUP', owner_and_unknown:'OWNER_AND_UNKNOWN' }[mock];
    h.expectEventOrder(h.readEvents(logFile), [
      'AI_STATE|STATE|OWNER_PRESENT', `AI_STATE|STATE|${state}`, 'PHOTO_SAVED|',
      'THREAT_FOCUS_ACTIVATED', 'THREAT_LOCK_TRIGGERED', 'LOCK_REQUESTED|reason=privacy-threat',
      'TEST_LOCK_SIMULATED|reason=privacy-threat'
    ]);
  });
}

test('threat recovery: unknown leaves, owner verified again, threat lock cancelled', async ({}, testInfo) => {
  const { page, logFile } = await start('threat_recovery');
  await expect(identity()).toHaveText('Unrecognized person');
  await expect(identity()).toHaveText('Owner verified');
  await h.waitForEvent(logFile, 'PROTECTION_SEQUENCE_CANCELLED|type=THREAT|reason=owner-returned');
  await page.waitForTimeout(6000); // past the threat lock deadline
  await h.snap(page, testInfo, 'after-recovery');
  // Owner decision 2026-10-16: a threat that has ended does not lock.
  noLock();
  h.expectEventOrder(h.readEvents(logFile), [
    'AI_STATE|STATE|UNKNOWN_PERSON', 'PRESENCE_GATE|CONCEALED|reason=threat-unknown_person',
    'PROTECTION_SEQUENCE_CANCELLED|type=THREAT|reason=owner-returned', 'PRESENCE_GATE|REVEALED|reason=owner-verified'
  ]);
});

test('camera failure: Camera unavailable, protection stays on with Retry', async ({}, testInfo) => {
  const { page, logFile } = await start('camera_error');
  await expect(identity()).toHaveText('Owner verified');
  await expect(status()).toHaveText('Camera unavailable');
  await expect(identity()).toHaveText('Camera unavailable');
  await expect(page.locator('#aiBtn')).toHaveText('Disable Protection');
  await expect(page.locator('#retryBtn')).toBeVisible();
  await h.waitForEvent(logFile, 'AI_EXIT|code=1');
  await page.waitForTimeout(500);
  await expect(status()).toHaveText('Camera unavailable'); // not overwritten by the exit
  await h.snap(page, testInfo, 'camera-error');
  h.expectEventOrder(h.readEvents(logFile), ['AI_STATE|STATE|OWNER_PRESENT', 'AI_ERROR|CAMERA_ERROR|', 'AI_EXIT|code=1']);
});

test('watchdog: a hung backend is stopped and reported as Protection unavailable', async ({}, testInfo) => {
  const { page, logFile } = await start('watchdog_hang', { settings:{ aiWatchdogTimeoutMs:5000 } });
  await expect(identity()).toHaveText('Owner verified');
  await h.waitForEvent(logFile, 'AI_WATCHDOG_TIMEOUT', 15000);
  await expect(status()).toHaveText('Protection unavailable');
  await expect(identity()).toHaveText('Verification unavailable');
  await h.snap(page, testInfo, 'watchdog');
  h.expectEventOrder(h.readEvents(logFile), ['AI_STATE|STATE|OWNER_PRESENT', 'AI_WATCHDOG_TIMEOUT']);
});

test('backend crash without an error line: Protection unavailable', async ({}, testInfo) => {
  const { page, logFile } = await start('ai_crash');
  await expect(identity()).toHaveText('Owner verified');
  await h.waitForEvent(logFile, 'AI_EXIT|code=1');
  await expect(status()).toHaveText('Protection unavailable');
  await h.snap(page, testInfo, 'crash');
});

// Fail-closed rule (CLAUDE.md #2): fixed in Phase 1.5 by the Presence Gate FAILSAFE.
// (Until then these were expected failures.)
for(const [mock, settings, event] of [
  ['camera_error', undefined, 'AI_ERROR|CAMERA_ERROR|'],
  ['camera_error_while_away', undefined, 'AI_ERROR|CAMERA_ERROR|'],
  ['watchdog_hang', { aiWatchdogTimeoutMs:5000 }, 'AI_WATCHDOG_TIMEOUT'],
  ['ai_crash', undefined, 'AI_EXIT|code=1']
]){
  test(`FAIL-CLOSED (${mock}): the screen stays concealed after a monitoring failure`, async ({}, testInfo) => {
    const { page, logFile } = await start(mock, { settings });
    await h.waitForEvent(logFile, event, 15000);
    await page.waitForTimeout(1000);
    await h.snap(page, testInfo, 'after-failure');
    expect(await h.anyProtectiveLayerOn(page)).toBe(true);
  });
}
