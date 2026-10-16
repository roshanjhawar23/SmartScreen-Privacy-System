// Phase 4: trusted people, profile editor, auto-switch rules, enterprise policy, settings transfer.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const h = require('./helpers/app');

let ctx;
test.afterEach(async () => { await h.closeApp(ctx); ctx = null; });

const events = () => h.readEvents(ctx.logFile);
const message = () => ctx.page.locator('#manageMessage');

async function openManage(page){
  await page.locator('#identityBtn').click();
  await expect(page.locator('#managePanel')).toBeVisible();
}

test('legacy owner template is migrated to Trusted people and still recognised', async ({}, testInfo) => {
  ctx = await h.launchApp({ mock:'owner_present' });
  const { page, userData, logFile } = ctx;
  const legacy = path.join(userData, 'biometric', 'owner_face.enc');
  expect(fs.existsSync(legacy)).toBe(true);
  await expect(page.locator('#identityBtn')).toHaveText('Manage');
  await openManage(page);
  await expect(page.locator('#peopleList')).toContainText('Owner · 5 samples');
  await h.waitForEvent(logFile, 'BIOMETRIC_MIGRATED|people=1');
  expect(fs.existsSync(legacy)).toBe(false);
  const files = fs.readdirSync(path.join(userData, 'biometric', 'trusted'));
  expect(files).toHaveLength(1);
  expect(fs.readFileSync(path.join(userData, 'biometric', 'trusted', files[0]), 'utf8')).not.toContain('embedding');
  await h.snap(page, testInfo, 'people');

  await page.locator('#identityBtn').click();
  await h.enableProtection(page);
  await h.waitForEvent(logFile, 'PRESENCE_GATE|REVEALED');
});

test('rename and remove trusted people; the last person cannot be removed', async ({}, testInfo) => {
  ctx = await h.launchApp({ mock:'owner_present' });
  await h.autoConfirmDialogs(ctx.app);
  const { page, logFile } = ctx;
  await openManage(page);
  await expect(page.locator('#peopleList')).toContainText('Owner');
  await h.seedTrustedPerson(ctx, { id:'00000000000000aa', name:'Roshan glasses' });
  await page.locator('#identityBtn').click();
  await openManage(page);
  const rows = page.locator('#peopleList .manage-row');
  await expect(rows).toHaveCount(2);

  await rows.nth(1).getByRole('button', { name:'Rename' }).click();
  await rows.nth(1).locator('input').fill('Roshan (glasses)');
  await rows.nth(1).getByRole('button', { name:'OK' }).click();
  await expect(page.locator('#peopleList')).toContainText('Roshan (glasses)');
  await h.waitForEvent(logFile, 'TRUSTED_PERSON_RENAMED');

  await rows.nth(1).getByRole('button', { name:'Remove' }).click();
  await expect(rows).toHaveCount(1);
  await h.waitForEvent(logFile, 'TRUSTED_PERSON_REMOVED');
  await expect(rows.nth(0).getByRole('button', { name:'Remove' })).toBeDisabled();
  await h.snap(page, testInfo, 'after-remove');
});

test('trusted people cannot change while protection is on', async () => {
  ctx = await h.launchApp({ mock:'owner_present' });
  const { page } = ctx;
  await h.enableProtection(page);
  await openManage(page);
  await expect(page.locator('#peopleNote')).toHaveText('Disable protection before changing trusted people.');
  await expect(page.locator('#addPersonBtn')).toBeDisabled();
  await expect(page.locator('#peopleList .manage-row').first().getByRole('button', { name:'Rename' })).toBeDisabled();
});

test('profile editor: built-ins are read-only, save as new, curtain applies, delete', async ({}, testInfo) => {
  ctx = await h.launchApp({ mock:'unknown_only' });
  await h.autoConfirmDialogs(ctx.app);
  const { page, logFile } = ctx;
  await openManage(page);
  await expect(page.locator('#profileNote')).toHaveText('Office (built-in)');
  await expect(page.locator('#deleteProfileBtn')).toBeDisabled();
  await page.locator('#pfCurtain').selectOption('pixelate');
  await page.locator('#saveProfileBtn').click();
  await expect(message()).toContainText('read-only');

  await page.locator('#profileName').fill('Cafe');
  await page.locator('#pfSensitivity').selectOption('strict');
  await page.locator('#pfWalkAway').selectOption('4000');
  await page.locator('#saveProfileBtn').click();
  await expect(message()).toHaveText('Profile "Cafe" saved.');
  await expect(page.locator('#profileSelect')).toHaveValue('Cafe');
  await h.waitForEvent(logFile, 'PROFILE_SAVED|profile=Cafe');
  await h.waitForEvent(logFile, 'PROFILE_CHANGED|profile=Cafe');

  await page.locator('#identityBtn').click();
  await h.enableProtection(page);
  await h.waitForEvent(logFile, 'PRESENCE_GATE|CONCEALED');
  expect(await h.curtainOn(page)).toBe(true);
  expect(await h.layerOpacity(page, 'pixelateLayer')).toBe('1'); // the custom curtain
  await h.snap(page, testInfo, 'cafe-curtain');
  await page.locator('#aiBtn').click(); // disable (confirmed)
  await h.waitForEvent(logFile, 'PRESENCE_GATE|DISABLED');

  await openManage(page);
  await page.locator('#deleteProfileBtn').click();
  await expect(page.locator('#profileSelect')).toHaveValue('Office');
  await h.waitForEvent(logFile, 'PROFILE_DELETED|profile=Cafe');
});

test('auto-switch: a time rule and a Wi-Fi rule switch the profile; the SSID is never logged', async () => {
  const now = new Date();
  const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const from = hhmm(new Date(now.getTime() - 60 * 60 * 1000));
  const to = hhmm(new Date(now.getTime() + 60 * 60 * 1000));
  ctx = await h.launchApp({
    mock:'owner_present', wifi:'NotMatching', settings:{ profileRuleIntervalMs:1000 },
    profiles:{ version:1, custom:{}, autoSwitch:true, rules:[
      { id:'home-wifi', type:'wifi', profile:'Home', ssid:'SmartScreenTestNet' },
      ...(from < to ? [{ id:'now', type:'time', profile:'Public', from, to }] : [])
    ] }
  });
  const { page, logFile } = ctx;
  if(from < to){
    await h.waitForEvent(logFile, 'PROFILE_CHANGED|profile=Public|source=rule-time', 10000);
    await expect(page.locator('#profileSelect')).toHaveValue('Public');
  }
  h.setWifi(ctx, 'SmartScreenTestNet');
  await h.waitForEvent(logFile, 'PROFILE_CHANGED|profile=Home|source=rule-wifi', 10000);
  await expect(page.locator('#profileSelect')).toHaveValue('Home');
  // A manual choice holds while the context stays the same.
  await page.locator('#profileSelect').selectOption('Office');
  await page.waitForTimeout(2500);
  await expect(page.locator('#profileSelect')).toHaveValue('Office');
  expect(fs.readFileSync(logFile, 'utf8')).not.toContain('SmartScreenTestNet');
});

test('Wi-Fi rule from the panel uses the current network', async () => {
  ctx = await h.launchApp({ mock:'owner_present', wifi:'CafeNet' });
  const { page } = ctx;
  await page.locator('#profileSelect').selectOption('Public');
  await openManage(page);
  await page.locator('#addWifiRuleBtn').click();
  await expect(page.locator('#rulesList')).toContainText('Wi-Fi network → Public');
  await page.locator('#autoSwitchBtn').click();
  await expect(page.locator('#autoSwitchBtn')).toHaveText('On');
  const saved = JSON.parse(fs.readFileSync(path.join(ctx.userData, 'profiles.json'), 'utf8'));
  expect(saved.rules[0]).toMatchObject({ type:'wifi', profile:'Public', ssid:'CafeNet' });
  expect(saved.autoSwitch).toBe(true);
});

test('enterprise policy: locked controls and refusals enforced in main', async ({}, testInfo) => {
  ctx = await h.launchApp({ mock:'owner_present', policy:{
    minimumIntensity:60, presenceGateRequired:true, allowDisableProtection:false,
    lockTrustedPeople:true, lockProfiles:true, lockImport:true, allowedProfiles:['Office', 'Public']
  } });
  const { page, app, logFile } = ctx;
  await h.waitForEvent(logFile, 'ENTERPRISE_POLICY|managed=true');
  await expect(page.locator('#deviceStatus')).toHaveText('Managed by your organization');
  const options = await page.locator('#profileSelect option').allTextContents();
  expect(options).toEqual(['Office', 'Public']);
  await expect(page.locator('#gateBtn')).toBeDisabled();

  await page.locator('#effectsBtn').click();
  await expect(page.locator('#intensitySlider')).toHaveAttribute('min', '60');
  await expect(page.locator('#intensityValue')).toHaveText('60'); // stored 50 was raised to the floor
  // A crafted lower value is clamped by the slider and by the renderer.
  await page.evaluate(() => {
    const s = document.getElementById('intensitySlider');
    s.value = '10';
    s.dispatchEvent(new Event('input'));
  });
  await expect(page.locator('#intensityValue')).toHaveText('60');

  await openManage(page);
  await expect(page.locator('#peopleNote')).toHaveText('Trusted people are managed by your organization.');
  await expect(page.locator('#profileNote')).toHaveText('Managed by your organization');
  await expect(page.locator('#saveProfileBtn')).toBeDisabled();
  await page.locator('#transferPass').fill('long enough pass');
  await page.locator('#importSettingsBtn').click();
  await expect(message()).toHaveText('Import is disabled by your organization.');
  await h.snap(page, testInfo, 'managed');
  await page.locator('#identityBtn').click();

  await h.enableProtection(page);
  await h.waitForEvent(logFile, 'PRESENCE_GATE|REVEALED');
  await page.locator('#aiBtn').click(); // renderer refuses
  // main refuses too, even if the renderer is bypassed
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    const primary = BrowserWindow.getAllWindows().find((w) => w.getBounds().width > 0);
    ipcMain.emit('stop-ai', { sender:primary.webContents });
  });
  await h.waitForEvent(logFile, 'ENTERPRISE_REFUSED|action=disable-protection');
  await expect(page.locator('#aiBtn')).toHaveText('Disable Protection');
  expect(events().some((e) => e.startsWith('PRESENCE_GATE|DISABLED'))).toBe(false);
});

test('settings transfer: export, then import on a fresh profile; wrong passphrase rejected', async ({}, testInfo) => {
  const file = path.join(require('os').tmpdir(), `smartscreen-transfer-${Date.now()}.json`);
  ctx = await h.launchApp({ mock:'owner_present' });
  await h.autoConfirmDialogs(ctx.app);
  await ctx.app.evaluate(({ dialog }, f) => { dialog.showSaveDialog = async () => ({ canceled:false, filePath:f }); }, file);
  let page = ctx.page;
  await openManage(page);
  await page.locator('#profileName').fill('Library');
  await page.locator('#pfCurtain').selectOption('blur');
  await page.locator('#saveProfileBtn').click();
  await expect(page.locator('#profileSelect')).toHaveValue('Library');
  await page.locator('#transferPass').fill('short');
  await page.locator('#exportSettingsBtn').click();
  await expect(message()).toContainText('at least 8');
  await page.locator('#transferPass').fill('correct horse battery');
  await page.locator('#exportSettingsBtn').click();
  await expect(message()).toContainText('Settings exported');
  const text = fs.readFileSync(file, 'utf8');
  expect(text).not.toContain('Library');
  await h.closeApp(ctx);

  ctx = await h.launchApp({ mock:'owner_present' });
  await ctx.app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled:false, filePaths:[f] }); }, file);
  page = ctx.page;
  await expect(page.locator('#profileSelect')).toHaveValue('Office');
  await openManage(page);
  await page.locator('#transferPass').fill('wrong passphrase!');
  await page.locator('#importSettingsBtn').click();
  await expect(message()).toHaveText('Wrong passphrase or damaged file.');
  await page.locator('#transferPass').fill('correct horse battery');
  await page.locator('#importSettingsBtn').click();
  await expect(message()).toHaveText('Settings imported.');
  await expect(page.locator('#profileSelect')).toHaveValue('Library');
  await h.waitForEvent(ctx.logFile, 'SETTINGS_IMPORTED|');
  expect(fs.existsSync(path.join(ctx.userData, 'biometric', 'trusted'))).toBe(true); // own people untouched
  await h.snap(page, testInfo, 'imported');
  fs.rmSync(file, { force:true });
});
