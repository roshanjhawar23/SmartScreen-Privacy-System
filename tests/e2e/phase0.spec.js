// Phase 0 checklist items that can be verified without hardware (see docs/plans/phase-0.md).
const { test, expect } = require('@playwright/test');
const h = require('./helpers/app');

let ctx;
test.afterEach(async () => { await h.closeApp(ctx); ctx = null; });

const style = (page, id, prop) => page.evaluate(([i, p]) => document.getElementById(i).style[p], [id, prop]);

async function setIntensity(page, value){
  await page.locator('#intensitySlider').fill(String(value));
  await expect(page.locator('#intensityValue')).toHaveText(String(value));
}

async function openEffects(page){
  if(await page.locator('#effectsPanel').isHidden()) await page.locator('#effectsBtn').click();
}

test('§1 event history is read from activity.log at startup', async ({}, testInfo) => {
  ctx = await h.launchApp({ mock:'owner_present', seedLog:[
    '2026-10-01T10:00:00.000Z - AI_READY',
    '2026-10-01T10:00:01.000Z - AI_STATE|STATE|OWNER_PRESENT|faces=1',
    '2026-10-01T10:00:02.000Z - LOCK_REQUESTED|reason=walk-away'
  ] });
  const list = ctx.page.locator('#eventList');
  await expect(list).toContainText('Screen lock requested');
  await expect(list).toContainText('Owner verified');
  await expect(list).not.toContainText('No security events recorded');
  await h.snap(ctx.page, testInfo, 'events');
});

test('§2 startup state: intensity and identity button', async () => {
  ctx = await h.launchApp({ mock:'owner_present' });
  const { page } = ctx;
  await expect(page.locator('#intensityValue')).toHaveText('50');
  await expect(page.locator('#identityBtn')).toHaveText('Re-enroll Owner');
  await expect(page.locator('#ai-status')).toHaveText('Inactive');
});

test('§3 one slider drives every effect live', async ({}, testInfo) => {
  ctx = await h.launchApp({ mock:'owner_present' });
  const { page } = ctx;
  await openEffects(page);
  await expect(page.locator('input[type=range]')).toHaveCount(1);

  await page.locator('#blurBtn').click();
  expect(await h.layerOpacity(page, 'overlay')).toBe('1');
  expect(await style(page, 'overlay', 'backdropFilter')).toBe('blur(17px)');
  await setIntensity(page, 100);
  expect(await style(page, 'overlay', 'backdropFilter')).toBe('blur(30px)');
  await setIntensity(page, 0);
  expect(await style(page, 'overlay', 'backdropFilter')).toBe('blur(4px)');
  await page.locator('#blurBtn').click();
  expect(await h.layerOpacity(page, 'overlay')).toBe('0');

  await page.locator('#blackoutBtn').click();
  expect(await h.layerOpacity(page, 'blackoutLayer')).toBe('1');
  expect(await style(page, 'blackoutLayer', 'background')).toContain('rgba(0, 0, 0, 0.7)'); // still dark at 0
  await setIntensity(page, 100);
  expect(await style(page, 'blackoutLayer', 'background')).toMatch(/rgb\(0, 0, 0\)|rgba\(0, 0, 0, 1\)/);
  await h.snap(page, testInfo, 'blackout-100');
  await page.locator('#blackoutBtn').click();

  await page.locator('#focusBtn').click();
  await page.locator('#vignetteBtn').click();
  await expect(page.locator('#focusValue')).toHaveText('On');
  await expect(page.locator('#vignetteValue')).toHaveText('On');
  expect(await style(page, 'focusLayer', 'background')).toContain('0.95');
  expect(await style(page, 'vignetteLayer', 'background')).toContain('0.9');
  await setIntensity(page, 0);
  expect(await style(page, 'focusLayer', 'background')).toContain('0.2)');
  expect(await style(page, 'vignetteLayer', 'background')).toContain('0.3)');
  await h.snap(page, testInfo, 'focus-vignette-0');
});

test('§3 slider drag does not move the panel; header drag moves it and stays on screen', async () => {
  ctx = await h.launchApp({ mock:'owner_present' });
  const { page } = ctx;
  await openEffects(page);
  const control = page.locator('#control');
  const before = await control.boundingBox();

  const slider = await page.locator('#intensitySlider').boundingBox();
  await page.mouse.move(slider.x + slider.width / 2, slider.y + slider.height / 2);
  await page.mouse.down();
  await page.mouse.move(slider.x - 600, slider.y + 200, { steps:10 }); // far outside the panel
  await page.mouse.up();
  await expect(page.locator('#intensityValue')).toHaveText('0'); // kept following outside the panel
  expect(await control.boundingBox()).toEqual(before);

  const header = await page.locator('.brand-block').boundingBox();
  await page.mouse.move(header.x + 10, header.y + 5);
  await page.mouse.down();
  await page.mouse.move(-2000, -2000, { steps:10 });
  await page.mouse.up();
  const after = await control.boundingBox();
  expect(after.x).toBe(0);
  expect(after.y).toBe(0);
});

test('§3 intensity is remembered across a restart', async () => {
  ctx = await h.launchApp({ mock:'owner_present' });
  await openEffects(ctx.page);
  await setIntensity(ctx.page, 73);
  const userData = ctx.userData;
  await h.closeApp(ctx, { keepUserData:true });

  ctx = await h.launchApp({ mock:'owner_present', userData });
  await expect(ctx.page.locator('#intensityValue')).toHaveText('73');
});

test('§4 pixelate shows a pixelated capture sized by the intensity', async ({}, testInfo) => {
  ctx = await h.launchApp({ mock:'owner_present' });
  const { page } = ctx;
  await page.locator('#pixelateBtn').click();
  expect(await h.layerOpacity(page, 'pixelateLayer')).toBe('1');
  // level 50 → 28 px blocks: the canvas holds one pixel per block.
  await expect.poll(() => page.evaluate(() => {
    const c = document.getElementById('pixelateCanvas');
    return c.style.visibility === 'visible' && c.width === Math.ceil(window.innerWidth / 28);
  }), { timeout:10000 }).toBe(true);
  await h.snap(page, testInfo, 'pixelate');
  // Our own overlay is excluded from capture while pixelate is on.
  // (Visual check of the captured content stays in the live check.)
});

test('§6/§7 one overlay per display, each covering the full display bounds', async () => {
  ctx = await h.launchApp({ mock:'owner_present' });
  await ctx.page.waitForTimeout(500);
  const layout = await ctx.app.evaluate(({ BrowserWindow, screen }) => ({
    displays:screen.getAllDisplays().map((d) => ({ bounds:d.bounds, workArea:d.workArea })),
    windows:BrowserWindow.getAllWindows().map((w) => ({ bounds:w.getBounds(), top:w.isAlwaysOnTop() }))
  }));
  expect(layout.windows).toHaveLength(layout.displays.length);
  for(const display of layout.displays){
    const match = layout.windows.find((w) => JSON.stringify(w.bounds) === JSON.stringify(display.bounds));
    expect(match, `overlay covering ${JSON.stringify(display.bounds)}`).toBeTruthy();
    expect(match.top).toBe(true);
  }
});

test('virtual desktops: follower is active and every overlay is on the current desktop', async () => {
  ctx = await h.launchApp({ mock:'owner_present' });
  await h.waitForEvent(ctx.logFile, 'VIRTUAL_DESKTOP_FOLLOW|available=true');
  await ctx.page.waitForTimeout(1500);
  expect(h.readEvents(ctx.logFile).some((e) => e.startsWith('OVERLAY_DESKTOP_FOLLOW_ERROR'))).toBe(false);
});
