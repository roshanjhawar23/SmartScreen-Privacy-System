// Harness self-checks that need no recorded person: synthetic empty room and a missing camera.
const { test, expect } = require('@playwright/test');
const path = require('path');
const h = require('./helpers/app');

let ctx;
test.afterEach(async () => { await h.closeApp(ctx); ctx = null; });

test('empty room: walk-away escalates to a simulated lock, then the ended source is a camera error', async ({}, testInfo) => {
  const reason = h.missingFixtures({ scenario:'empty_only', ownerTemplate:false });
  test.skip(Boolean(reason), reason);

  ctx = await h.launchApp({ scenario:'empty_only', ownerTemplate:false });
  const { page, logFile } = ctx;
  await expect(page.locator('#ai-status')).toHaveText('Inactive');
  await h.snap(page, testInfo, '0-inactive');

  await h.enableProtection(page);
  await expect(page.locator('#identity-live')).toHaveText('No person detected', { timeout:20000 });
  expect(await h.layerOpacity(page, 'overlay')).toBe('1'); // walk-away blur
  await h.snap(page, testInfo, '1-walk-away-blur');

  await h.waitForEvent(logFile, 'TEST_LOCK_SIMULATED|reason=walk-away', 20000);
  expect(await h.layerOpacity(page, 'focusLayer')).toBe('1');
  await h.snap(page, testInfo, '2-lock-simulated');

  const events = h.readEvents(logFile);
  const order = [
    'TEST_MODE_ACTIVE',
    'TEST_CAMERA_SOURCE|empty_only.mp4',
    'AI_READY',
    'AI_STATE|STATE|NO_USER',
    'WALK_AWAY_TIMER_ARMED',
    'WALK_AWAY_FOCUS_ACTIVATED',
    'WALK_AWAY_TIMER_EXPIRED',
    'LOCK_REQUESTED|reason=walk-away',
    'TEST_LOCK_SIMULATED|reason=walk-away'
  ].map((p) => h.indexOfEvent(events, p));
  expect(order.every((i) => i >= 0), `all events present: ${order}`).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  // Test mode must never run the real Windows lock.
  expect(events.some((e) => e.startsWith('LOCK_COMMAND_COMPLETED') || e.startsWith('LOCK_ERROR'))).toBe(false);

  // The 16 s clip ends: the backend must report it like a camera that stopped.
  await h.waitForEvent(logFile, 'AI_ERROR|CAMERA_ERROR|', 20000);
  await expect(page.locator('#ai-status')).toHaveText('Camera unavailable');
  await expect(page.locator('#identity-live')).toHaveText('Camera unavailable');
  await h.snap(page, testInfo, '3-camera-ended');
});

test('missing camera source is reported as Camera unavailable', async ({}, testInfo) => {
  ctx = await h.launchApp({ cameraSource:path.join(h.PRIVATE_DIR, 'does-not-exist.mp4'), ownerTemplate:false });
  const { page, logFile } = ctx;
  await h.enableProtection(page);
  await expect(page.locator('#ai-status')).toHaveText('Camera unavailable', { timeout:20000 });
  await h.waitForEvent(logFile, 'AI_ERROR|CAMERA_ERROR|');
  expect(h.readEvents(logFile).some((e) => e.startsWith('AI_STATE|'))).toBe(false);
  await h.snap(page, testInfo, 'camera-unavailable');
});
