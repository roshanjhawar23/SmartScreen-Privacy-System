// Phase 5: security images (bounded, small) are visible to the owner in Diagnostics.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const h = require('./helpers/app');

let ctx;
test.afterEach(async ({}, testInfo) => { h.keepLogOnFailure(ctx, testInfo); await h.closeApp(ctx); ctx = null; });

test('security images: count of kept images and an Open folder button', async ({}, testInfo) => {
  ctx = await h.launchApp({ mock:'owner_present', settings:{ evidence:{ maxImages:12 } } });
  const { page, app, userData, logFile } = ctx;
  const dir = path.join(userData, 'intruder_logs');
  fs.mkdirSync(dir, { recursive:true });
  for(const name of ['20261016_101500_001.jpg', '20261016_101501_002.jpg', '20261016_101502_003.jpg', 'unrelated.jpg']){
    fs.writeFileSync(path.join(dir, name), 'x');
  }
  const opened = [];
  await app.evaluate(({ shell }) => { global.__opened = []; shell.openPath = async (p) => { global.__opened.push(p); return ''; }; });

  await page.locator('#diagBtn').click();
  await expect(page.locator('#diagEvidence')).toHaveText('3 of 12 kept');
  await page.locator('#evidenceFolderBtn').click();
  await h.waitForEvent(logFile, 'EVIDENCE_FOLDER_OPENED');
  opened.push(...await app.evaluate(() => global.__opened));
  expect(opened).toEqual([dir]);
  await h.snap(page, testInfo, 'evidence');
});

test('security images: switched off in settings', async () => {
  ctx = await h.launchApp({ mock:'owner_present', settings:{ evidence:{ enabled:false } } });
  await ctx.page.locator('#diagBtn').click();
  await expect(ctx.page.locator('#diagEvidence')).toHaveText('off');
});
