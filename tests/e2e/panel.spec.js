// Control panel layout: drag from empty areas with edge snap and a remembered position;
// Manage never hides Enable/Disable Protection or overlaps other sections.
const { test, expect } = require('@playwright/test');
const h = require('./helpers/app');

let ctx;
test.afterEach(async ({}, testInfo) => { h.keepLogOnFailure(ctx, testInfo); await h.closeApp(ctx); ctx = null; });

test('drag left from an empty area snaps to the edge and persists after restart', async () => {
  ctx = await h.launchApp({ mock:'owner_present' });
  const control = ctx.page.locator('#control');
  const box = await control.boundingBox();
  const status = await ctx.page.locator('.live-status').boundingBox();
  // The gap between the two status cards: an empty part of the panel, not the header.
  const startX = status.x + status.width / 2;
  const startY = status.y + 2;
  await ctx.page.mouse.move(startX, startY);
  await ctx.page.mouse.down();
  await ctx.page.mouse.move(startX - box.x - 10, startY + 120, { steps:12 }); // ends 10 px from the left edge
  await ctx.page.mouse.up();
  const dropped = await control.boundingBox();
  expect(dropped.x).toBe(0); // within 24 px: snapped
  expect(Math.round(dropped.y)).toBe(Math.round(box.y + 120));

  const userData = ctx.userData;
  await h.closeApp(ctx, { keepUserData:true });
  ctx = await h.launchApp({ mock:'owner_present', userData });
  const restored = await ctx.page.locator('#control').boundingBox();
  expect(restored.x).toBe(0);
  expect(Math.round(restored.y)).toBe(Math.round(dropped.y));
});

test('with Manage open, Enable Protection stays visible and clickable and nothing overlaps', async () => {
  ctx = await h.launchApp({ mock:'owner_present' });
  const { page } = ctx;
  await page.locator('#identityBtn').click();
  await expect(page.locator('#managePanel')).toBeVisible();
  await page.locator('#effectsBtn').click();
  await page.locator('#diagBtn').click();

  // Scroll the panel body to the bottom: the pinned top (with the button) must stay in view.
  await page.locator('#control').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const ai = page.locator('#aiBtn');
  await expect(ai).toBeInViewport();
  const panel = await page.locator('#control').boundingBox();
  const viewport = page.viewportSize() || await page.evaluate(() => ({ width:innerWidth, height:innerHeight }));
  expect(panel.y + panel.height).toBeLessThanOrEqual(viewport.height);
  await ai.click(); // a real click: fails if anything covers the button
  await expect(ai).toHaveText('Disable Protection');

  // Unscrolled, no two visible sections of the panel overlap.
  await page.locator('#control').evaluate((el) => { el.scrollTop = 0; });
  const overlaps = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('#control > *, #panelTop > *, #panelBody > *, #managePanel > *')]
      .filter((el) => el.offsetParent !== null && el.getClientRects().length)
      .map((el) => ({ id:el.id || el.className, parent:el.parentElement.id, r:el.getBoundingClientRect() }));
    const found = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]; const b = boxes[j];
        if (a.parent !== b.parent) continue; // nested elements contain each other by design
        const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (x > 1 && y > 1) found.push(`${a.id} / ${b.id}`);
      }
    }
    return found;
  });
  expect(overlaps).toEqual([]);
});
