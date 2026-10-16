// Identity scenarios on recorded private fixtures (owner, unknown, empty).
// Build them with tests/fixtures/tools (see docs/testing/self-test-harness.md).
const { test, expect } = require('@playwright/test');
const h = require('./helpers/app');

let ctx;
test.afterEach(async () => { await h.closeApp(ctx); ctx = null; });

function requireFixtures(options){
  const reason = h.missingFixtures(options);
  test.skip(Boolean(reason), reason);
}

const PROTECTIVE_LAYERS = ['overlay', 'pixelateLayer', 'blackoutLayer', 'focusLayer'];
async function anyProtectiveLayerOn(page){
  for(const id of PROTECTIVE_LAYERS){
    if(await h.layerOpacity(page, id) === '1') return true;
  }
  return false;
}

test('owner is verified and the screen stays clear', async ({}, testInfo) => {
  requireFixtures({ scenario:'owner_then_stop' });
  ctx = await h.launchApp({ scenario:'owner_then_stop' });
  const { page, logFile } = ctx;
  await h.enableProtection(page);

  await expect(page.locator('#identity-live')).toHaveText('Owner verified', { timeout:20000 });
  await expect(page.locator('#ai-status')).toHaveText('Owner verified');
  expect(await anyProtectiveLayerOn(page)).toBe(false);
  await h.snap(page, testInfo, 'owner-verified');

  const events = h.readEvents(logFile);
  expect(events.some((e) => e.startsWith('AI_STATE|STATE|UNKNOWN') || e.startsWith('AI_STATE|STATE|OWNER_AND_UNKNOWN'))).toBe(false);
  expect(events.some((e) => e.startsWith('PHOTO_SAVED|'))).toBe(false);
});

test('camera stops while the owner is present: Camera unavailable', async ({}, testInfo) => {
  requireFixtures({ scenario:'owner_then_stop' });
  ctx = await h.launchApp({ scenario:'owner_then_stop' });
  const { page, logFile } = ctx;
  await h.enableProtection(page);
  await expect(page.locator('#identity-live')).toHaveText('Owner verified', { timeout:20000 });

  await h.waitForEvent(logFile, 'AI_ERROR|CAMERA_ERROR|', 25000);
  await expect(page.locator('#ai-status')).toHaveText('Camera unavailable');
  await expect(page.locator('#identity-live')).toHaveText('Camera unavailable');
  await h.snap(page, testInfo, 'camera-stopped');
});

// Fail-closed rule (CLAUDE.md #2). KNOWN DEFECT until Phase 1.5 (Presence Gate):
// a camera failure removes protection. test.fail() marks the expected failure;
// it turns red ("unexpectedly passed") once fixed, and the marker must then go.
test('FAIL-CLOSED: a camera failure keeps the screen concealed', async ({}, testInfo) => {
  test.fail(true, 'Known Phase 0 defect: monitor failure reveals the screen (fixed in Phase 1.5).');
  requireFixtures({ scenario:'empty_only', ownerTemplate:false });
  ctx = await h.launchApp({ scenario:'empty_only', ownerTemplate:false });
  const { page, logFile } = ctx;
  await h.enableProtection(page);
  await h.waitForEvent(logFile, 'AI_ERROR|CAMERA_ERROR|', 40000);
  await page.waitForTimeout(1000);
  await h.snap(page, testInfo, 'after-camera-error');
  expect(await anyProtectiveLayerOn(page)).toBe(true);
});

test('walk-away: owner returns before the deadline, sequence cancelled, no lock', async ({}, testInfo) => {
  requireFixtures({ scenario:'walkaway_return' });
  ctx = await h.launchApp({ scenario:'walkaway_return' });
  const { page, logFile } = ctx;
  await h.enableProtection(page);

  await expect(page.locator('#identity-live')).toHaveText('Owner verified', { timeout:20000 });
  await expect(page.locator('#identity-live')).toHaveText('No person detected', { timeout:15000 });
  expect(await h.layerOpacity(page, 'overlay')).toBe('1');
  await h.snap(page, testInfo, '1-away-blur');

  await h.waitForEvent(logFile, 'PROTECTION_SEQUENCE_CANCELLED|type=WALK_AWAY|reason=owner-returned', 15000);
  await expect(page.locator('#identity-live')).toHaveText('Owner verified');
  await expect.poll(() => anyProtectiveLayerOn(page)).toBe(false);
  await h.snap(page, testInfo, '2-owner-back-clear');

  // Stay until the walk-away deadline would have passed.
  await page.waitForTimeout(7000);
  const events = h.readEvents(logFile);
  expect(h.indexOfEvent(events, 'WALK_AWAY_TIMER_ARMED')).toBeGreaterThan(h.indexOfEvent(events, 'AI_STATE|STATE|NO_USER'));
  expect(h.indexOfEvent(events, 'PROTECTION_SEQUENCE_CANCELLED')).toBeGreaterThan(h.indexOfEvent(events, 'WALK_AWAY_TIMER_ARMED'));
  expect(events.some((e) => e.startsWith('LOCK_REQUESTED'))).toBe(false);
});

test('walk-away: owner stays away, screen locks (simulated)', async ({}, testInfo) => {
  requireFixtures({ scenario:'walkaway_lock' });
  ctx = await h.launchApp({ scenario:'walkaway_lock' });
  const { page, logFile } = ctx;
  await h.enableProtection(page);

  await expect(page.locator('#identity-live')).toHaveText('Owner verified', { timeout:20000 });
  await h.waitForEvent(logFile, 'TEST_LOCK_SIMULATED|reason=walk-away', 25000);
  await h.snap(page, testInfo, 'locked');
  const events = h.readEvents(logFile);
  const order = ['AI_STATE|STATE|OWNER_PRESENT', 'AI_STATE|STATE|NO_USER', 'WALK_AWAY_TIMER_ARMED',
    'WALK_AWAY_TIMER_EXPIRED', 'LOCK_REQUESTED|reason=walk-away'].map((p) => h.indexOfEvent(events, p));
  expect(order.every((i) => i >= 0), `all events present: ${order}`).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
});

test('unknown person: threat detected, evidence saved, screen locks (simulated)', async ({}, testInfo) => {
  requireFixtures({ scenario:'threat_lock' });
  ctx = await h.launchApp({ scenario:'threat_lock' });
  const { page, logFile } = ctx;
  await h.enableProtection(page);

  await expect(page.locator('#identity-live')).toHaveText('Owner verified', { timeout:20000 });
  await expect(page.locator('#identity-live')).toHaveText(/^Unrecognized (person|people)$/, { timeout:15000 });
  await expect(page.locator('#ai-status')).toHaveText('Privacy threat detected');
  expect(await h.layerOpacity(page, 'overlay')).toBe('1');
  await h.snap(page, testInfo, '1-threat');

  await h.waitForEvent(logFile, 'TEST_LOCK_SIMULATED|reason=privacy-threat', 15000);
  await h.snap(page, testInfo, '2-locked');
  const events = h.readEvents(logFile);
  const threat = events.findIndex((e) => /^AI_STATE\|STATE\|UNKNOWN_(PERSON|GROUP)/.test(e));
  expect(threat).toBeGreaterThan(h.indexOfEvent(events, 'AI_STATE|STATE|OWNER_PRESENT'));
  expect(h.indexOfEvent(events, 'PHOTO_SAVED|')).toBeGreaterThan(threat);
  expect(h.indexOfEvent(events, 'THREAT_FOCUS_ACTIVATED')).toBeGreaterThan(threat);
  expect(h.indexOfEvent(events, 'LOCK_REQUESTED|reason=privacy-threat')).toBeGreaterThan(h.indexOfEvent(events, 'THREAT_FOCUS_ACTIVATED'));
});

test('owner with an unknown person beside them is a threat', async ({}, testInfo) => {
  requireFixtures({ scenario:'owner_and_unknown' });
  ctx = await h.launchApp({ scenario:'owner_and_unknown' });
  const { page, logFile } = ctx;
  await h.enableProtection(page);

  await expect(page.locator('#identity-live')).toHaveText('Owner verified', { timeout:20000 });
  await expect(page.locator('#identity-live')).toHaveText('Owner + unrecognized person', { timeout:15000 });
  await h.snap(page, testInfo, 'owner-and-unknown');
  await h.waitForEvent(logFile, 'TEST_LOCK_SIMULATED|reason=privacy-threat', 15000);
});

test('threat recovery: unknown leaves, owner verified again', async ({}, testInfo) => {
  requireFixtures({ scenario:'threat_recovery' });
  ctx = await h.launchApp({ scenario:'threat_recovery' });
  const { page, logFile } = ctx;
  await h.enableProtection(page);

  await expect(page.locator('#identity-live')).toHaveText('Owner verified', { timeout:20000 });
  await expect(page.locator('#identity-live')).toHaveText(/^Unrecognized/, { timeout:15000 });
  await expect(page.locator('#identity-live')).toHaveText('Owner verified', { timeout:15000 });
  await page.waitForTimeout(7000);
  await h.snap(page, testInfo, 'after-recovery');
  // Whether a threat that has already ended still locks is a product decision
  // (currently: yes, the threat lock timer is not cancelled). Recorded, not asserted.
  testInfo.annotations.push({ type:'observed', description:h.readEvents(logFile).filter((e) => /THREAT|LOCK|CANCELLED/.test(e)).join(' ; ') });
});
