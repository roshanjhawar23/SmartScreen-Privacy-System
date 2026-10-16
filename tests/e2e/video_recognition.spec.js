// Face recognition from recorded video: the real Python backend (YuNet + SFace)
// on private fixtures (owner, unknown, empty). PENDING until the owner fixture is
// recorded (planned before Phase 5); protection rules are covered by protection.spec.js
// with the mock backend. Build fixtures with tests/fixtures/tools (docs/testing/self-test-harness.md).
const { test, expect } = require('@playwright/test');
const h = require('./helpers/app');

let ctx;
test.afterEach(async ({}, testInfo) => { h.keepLogOnFailure(ctx, testInfo); await h.closeApp(ctx); ctx = null; });

function requireFixtures(options){
  const reason = h.missingFixtures(options);
  test.skip(Boolean(reason), `pending: needs owner fixture — ${reason}`);
}

const anyProtectiveLayerOn = h.anyProtectiveLayerOn;

test('video: owner is verified and the screen stays clear', async ({}, testInfo) => {
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

test('video: camera stops while the owner is present: Camera unavailable', async ({}, testInfo) => {
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

test('video: walk-away: owner returns before the deadline, sequence cancelled, no lock', async ({}, testInfo) => {
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

test('video: walk-away: owner stays away, screen locks (simulated)', async ({}, testInfo) => {
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

test('video: unknown person: threat detected, evidence saved, screen locks (simulated)', async ({}, testInfo) => {
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

test('video: owner with an unknown person beside them is a threat', async ({}, testInfo) => {
  requireFixtures({ scenario:'owner_and_unknown' });
  ctx = await h.launchApp({ scenario:'owner_and_unknown' });
  const { page, logFile } = ctx;
  await h.enableProtection(page);

  await expect(page.locator('#identity-live')).toHaveText('Owner verified', { timeout:20000 });
  await expect(page.locator('#identity-live')).toHaveText('Owner + unrecognized person', { timeout:15000 });
  await h.snap(page, testInfo, 'owner-and-unknown');
  await h.waitForEvent(logFile, 'TEST_LOCK_SIMULATED|reason=privacy-threat', 15000);
});

test('video: threat recovery: unknown leaves, owner verified again', async ({}, testInfo) => {
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
