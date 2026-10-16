const { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, dialog, session, safeStorage, screen, desktopCapturer, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const crypto = require('crypto');
const { isConfigured, createProfile, readProfile, markBiometricEnrolled } = require('./device_profile');
const { saveTemplate, readTemplate } = require('./biometric_store');
const { formatLogLine, readSecurityEvents } = require('./security_events');
const { createLineSplitter, parseStateMessage, parseErrorMessage, parseStatsMessage, parseTamperMessage } = require('./ai_protocol');
const { createProtectionSequence } = require('./protection_sequence');
const { planOverlayWindows } = require('./display_layout');
const { clampLevel } = require('../frontend/intensity');
const { createScreenLocker, isTestMode } = require('./screen_lock');
const { createPresenceGate } = require('./presence_gate');
const { createVirtualDesktops, followCurrentDesktop } = require('./virtual_desktop');
const { normalizePolicies, resolveProfileName, matchSensitiveApp } = require('./policies');
const { decide } = require('./policy_engine');
const { createActiveWindowReader } = require('./active_window');
const { FAILSAFE_KINDS, configDigest, createClockMonitor, createRestartLoopDetector, diffDevices } = require('./tamper');
const { createDiagnostics } = require('./diagnostics');

// Self-test harness only (SMARTSCREEN_TEST=1): isolated profile and a recorded camera source.
const TEST_MODE = isTestMode();
if(TEST_MODE && process.env.SMARTSCREEN_USER_DATA){
  app.setPath('userData', path.resolve(process.env.SMARTSCREEN_USER_DATA));
}
// Test mode can point at a copy of config/ (tamper tests edit it while the app runs).
const CONFIG_DIR = TEST_MODE && process.env.SMARTSCREEN_CONFIG_DIR
  ? path.resolve(process.env.SMARTSCREEN_CONFIG_DIR)
  : path.join(__dirname,'..','config');
const CONFIG_FILES = ['settings.json','policies.json'];

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if(!gotSingleInstanceLock){
  app.quit();
}


let logDir;
let logFile;
let settings = {};            // config/settings.json
let testSettings = {};        // test mode only: SMARTSCREEN_TEST_SETTINGS, applied last
let policies = normalizePolicies(null);
let activeProfile = policies.defaultProfile;
let activeApp = null;         // { id, label, name } of a sensitive foreground app, else null
let protectionActive = false; // from Enable until a confirmed Disable (stays on in FAILSAFE)
let win = null;               // primary overlay window (hosts the control panel)
let winDisplayId = null;      // display the primary overlay currently covers
const secondaryWindows = new Map(); // BrowserWindow.id -> { window, displayId }
let lastRenderState = null;
let setupWindow = null;
let enrollmentWindow = null;
let tray = null;
let shortcutsRegistered = false;
let ignoringMouse = true;
let pythonProcess = null;
let lastIntruderImage = '';
let lastAIHeartbeat = 0;     // monotonic ms (performance.now): immune to system clock changes
let aiWatchdog = null;
let aiFailureReported = false;
let lastAIState = null;       // AI_STATE is logged on change only (the backend re-emits ~400 ms)
let lastPoseKey = '';         // AI_POSE / AI_LIVENESS are logged on change of class only
let lastLivenessKey = '';
let curtainState = { on:false, effect:'blackout' };
let contentProtected = false;
let trayStatus = { icon:'icon-gray.png', tooltip:'SmartScreen Privacy Suite' };

const diagnostics = createDiagnostics();

function writeLog(event){
  diagnostics.record(event);
  if(!logDir){
    logDir = path.join(app.getPath('userData'), 'logs');
    logFile = path.join(logDir, 'activity.log');
  }
  if(!fs.existsSync(logDir)) fs.mkdirSync(logDir,{recursive:true});
  fs.appendFileSync(logFile, formatLogLine(event));
}

function activityLogFile(){
  return logFile || path.join(app.getPath('userData'),'logs','activity.log');
}

function loadSettings(){
  try{
    const data = fs.readFileSync(path.join(CONFIG_DIR,'settings.json'));
    settings = JSON.parse(data);
  }catch(err){
    console.error('Failed to load settings:', err);
    settings = {};
  }
  if(TEST_MODE && process.env.SMARTSCREEN_TEST_SETTINGS){
    try{
      testSettings = JSON.parse(process.env.SMARTSCREEN_TEST_SETTINGS) || {};
    }catch(err){
      console.error('Invalid SMARTSCREEN_TEST_SETTINGS:', err);
    }
  }
}

function policyStateFile(){
  return path.join(app.getPath('userData'), 'policy_state.json');
}

function loadPolicies(){
  try{
    policies = normalizePolicies(JSON.parse(fs.readFileSync(path.join(CONFIG_DIR,'policies.json'),'utf8')));
  }catch(err){
    console.error('Failed to load policies:', err);
    policies = normalizePolicies(null);
    writeLog(`POLICIES_LOAD_ERROR|${err.message}`);
  }
  let saved = null;
  try{ saved = JSON.parse(fs.readFileSync(policyStateFile(),'utf8')).activeProfile; }catch{}
  activeProfile = resolveProfileName(policies, saved);
}

function currentProfile(){
  return policies.profiles[activeProfile];
}

// settings.json ← active profile ← test overrides.
function effectiveSettings(){
  const profile = currentProfile();
  return {
    ...settings,
    walkAwayLockDelay:profile.walkAwayLockDelay,
    ...testSettings,
    presenceGate:{
      ...(settings.presenceGate || {}),
      curtainEffect:profile.curtainEffect,
      ...(testSettings.presenceGate || {})
    }
  };
}

function setActiveProfile(name, source){
  const next = resolveProfileName(policies, name);
  if(next !== name) return false;
  activeProfile = next;
  try{ fs.writeFileSync(policyStateFile(), JSON.stringify({ activeProfile:next })); }catch(err){ writeLog(`POLICY_STATE_SAVE_ERROR|${err.message}`); }
  writeLog(`PROFILE_CHANGED|profile=${next}|source=${source}`);
  presenceGate.refresh();
  if(win && !win.isDestroyed()) win.webContents.send('profile-changed', profileInfo());
  rebuildTrayMenu();
  return true;
}

function profileInfo(){
  return { active:activeProfile, names:Object.keys(policies.profiles) };
}

// Foreground app, polled only while protection is on. Titles are matched, never logged.
const activeWindowReader = createActiveWindowReader();
let activeAppTimer = null;
function pollActiveApp(){
  const fg = activeWindowReader.read();
  if(!fg || fg.pid === process.pid) return; // keep the last app while our own panel is focused
  const match = matchSensitiveApp(fg, policies.sensitiveApps);
  const key = match ? `${match.id}:${match.name}` : '';
  const prev = activeApp ? `${activeApp.id}:${activeApp.name}` : '';
  if(key === prev) return;
  activeApp = match;
  writeLog(match ? `SENSITIVE_APP_ACTIVE|category=${match.label}|app=${match.name}` : 'SENSITIVE_APP_INACTIVE');
}

// ---------------------------------------------------------------------------
// Anomaly and tamper detection (Phase 3). Every kind is its own TAMPER event;
// FAILSAFE_KINDS conceal the screen (Presence Gate FAILSAFE) while protection is on.

const restartLoop = createRestartLoopDetector();
const clockMonitor = createClockMonitor();
let integrityKey = null;
const configBaseline = new Map(); // file → HMAC digest
let videoDevices = null;          // latest renderer report (deviceIds)
let videoBaseline = null;         // captured when protection is enabled

function reportTamper(kind, detail = ''){
  writeLog(`TAMPER|${kind}${detail ? `|${detail}` : ''}`);
  if(protectionActive && FAILSAFE_KINDS.has(kind)) presenceGate.failsafe(`tamper-${kind}`);
}

function loadIntegrityKey(){
  const file = path.join(app.getPath('userData'), 'integrity.key');
  try{
    if(fs.existsSync(file)) return Buffer.from(safeStorage.decryptString(Buffer.from(fs.readFileSync(file,'utf8'),'base64')),'hex');
  }catch(err){
    writeLog(`INTEGRITY_KEY_ERROR|${err.message}`);
  }
  const key = crypto.randomBytes(32);
  try{ fs.writeFileSync(file, safeStorage.encryptString(key.toString('hex')).toString('base64')); }catch(err){ writeLog(`INTEGRITY_KEY_ERROR|${err.message}`); }
  return key;
}

function readConfigDigest(name){
  try{ return configDigest(integrityKey, fs.readFileSync(path.join(CONFIG_DIR, name))); }catch{ return 'missing'; }
}

// Baseline at startup; report files that changed since the last run (info) and watch for
// changes while running (tamper).
function startConfigIntegrity(){
  if(!safeStorage.isEncryptionAvailable()) return;
  integrityKey = loadIntegrityKey();
  const stateFile = path.join(app.getPath('userData'), 'integrity_state.json');
  let previous = {};
  try{ previous = JSON.parse(fs.readFileSync(stateFile,'utf8')); }catch{}
  for(const name of CONFIG_FILES){
    const digest = readConfigDigest(name);
    if(previous[name] && previous[name] !== digest) writeLog(`CONFIG_CHANGED_SINCE_LAST_RUN|file=${name}`);
    configBaseline.set(name, digest);
    fs.watchFile(path.join(CONFIG_DIR, name), { interval:1000 }, ()=>{
      const now = readConfigDigest(name);
      if(now === configBaseline.get(name)) return;
      configBaseline.set(name, now);
      persistConfigDigests(stateFile);
      reportTamper('config-modified', `file=${name}`);
    });
  }
  persistConfigDigests(stateFile);
}

function persistConfigDigests(stateFile){
  try{ fs.writeFileSync(stateFile, JSON.stringify(Object.fromEntries(configBaseline))); }catch{}
}

function checkClock(){
  const jump = clockMonitor.check();
  if(!jump) return;
  if(jump.major) reportTamper('clock-jump', `deltaMs=${jump.jumpMs}`);
  else writeLog(`CLOCK_ADJUSTED|deltaMs=${jump.jumpMs}`);
}

function electronMetrics(){
  const metrics = app.getAppMetrics();
  const cpuPercent = metrics.reduce((sum, m) => sum + (m.cpu?.percentCPUUsage || 0), 0);
  const memoryMB = metrics.reduce((sum, m) => sum + (m.memory?.workingSetSize || 0), 0) / 1024;
  return { cpuPercent:Math.round(cpuPercent * 10) / 10, memoryMB:Math.round(memoryMB), processes:metrics.length };
}

function setActiveAppPolling(on){
  if(on && !activeAppTimer && activeWindowReader.available){
    pollActiveApp();
    activeAppTimer = setInterval(pollActiveApp, 1000);
  }else if(!on && activeAppTimer){
    clearInterval(activeAppTimer);
    activeAppTimer = null;
    activeApp = null;
  }
}

const assetPath = app.isPackaged
  ? path.join(process.resourcesPath,'assets')
  : path.join(__dirname,'..','assets');

const modelsPath = app.isPackaged
  ? path.join(process.resourcesPath,'models')
  : path.join(__dirname,'..','models');

function configureCameraPermissions(){
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return permission === 'media';
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });
}

// ---------------------------------------------------------------------------
// Overlay windows: one per display. The primary window hosts the control panel;
// secondary windows mirror the primary's render state.

function allOverlayWindows(){
  const list = [];
  if(win && !win.isDestroyed()) list.push(win);
  for(const { window } of secondaryWindows.values()){
    if(!window.isDestroyed()) list.push(window);
  }
  return list;
}

function createOverlayWindow(bounds, role){
  const overlay = new BrowserWindow({
    x:bounds.x,
    y:bounds.y,
    width:bounds.width,
    height:bounds.height,
    transparent:true,
    frame:false,
    resizable:false,
    movable:false,
    alwaysOnTop:true,
    skipTaskbar: role === 'secondary',
    hasShadow:false,
    backgroundColor:'#00000000',
    webPreferences:{
      preload:path.join(__dirname,'preload.js'),
      contextIsolation:true,
      nodeIntegration:false,
      additionalArguments:[`--smartscreen-role=${role}`]
    }
  });

  // The constructor clamps to the work area (excludes the taskbar); setBounds applies the full display.
  overlay.setBounds(bounds);
  overlay.loadFile(path.join(__dirname,'..','frontend','index.html'));
  overlay.setIgnoreMouseEvents(true,{forward:true});
  overlay.setAlwaysOnTop(true,'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true);
  overlay.setContentProtection(contentProtected);
  overlay.webContents.on('did-finish-load',()=>{
    if(!overlay.isDestroyed()) overlay.webContents.send('presence-curtain', curtainState);
  });
  return overlay;
}

// Pixelate (manual or curtain) captures the screen; exclude our own overlays from that capture.
// Only while pixelate is on, so screen sharing still sees the other effects.
function updateContentProtection(){
  const wanted = Boolean(lastRenderState?.pixelate) || (curtainState.on && curtainState.effect === 'pixelate');
  if(wanted === contentProtected) return;
  contentProtected = wanted;
  for(const overlay of allOverlayWindows()) overlay.setContentProtection(wanted);
}

function createWindow(){
  if(win && !win.isDestroyed()) return;

  const primary = screen.getPrimaryDisplay();
  win = createOverlayWindow(primary.bounds, 'primary');
  winDisplayId = primary.id;

  win.webContents.on('did-finish-load',()=>{
    win.webContents.send('settings-loaded',effectiveSettings());
  });

  win.on('closed',()=>{ win=null; winDisplayId=null; });
  syncOverlayWindows();
}

function syncOverlayWindows(){
  if(!win || win.isDestroyed()) return;

  const displays = screen.getAllDisplays().map((d) => ({ id:d.id, bounds:d.bounds }));
  const current = [{ id:win.id, role:'primary', displayId:winDisplayId, bounds:win.getBounds() }];
  for(const [id, entry] of secondaryWindows){
    if(entry.window.isDestroyed()){ secondaryWindows.delete(id); continue; }
    current.push({ id, role:'secondary', displayId:entry.displayId, bounds:entry.window.getBounds() });
  }

  const plan = planOverlayWindows(displays, screen.getPrimaryDisplay().id, current);

  for(const id of plan.removes){
    const entry = secondaryWindows.get(id);
    secondaryWindows.delete(id);
    if(entry && !entry.window.isDestroyed()) entry.window.destroy();
  }

  for(const update of plan.updates){
    if(update.id === win.id){
      winDisplayId = update.displayId;
      win.setBounds(update.bounds);
    }else{
      const entry = secondaryWindows.get(update.id);
      if(!entry) continue;
      entry.displayId = update.displayId;
      entry.window.setBounds(update.bounds);
    }
  }

  for(const create of plan.creates){
    const overlay = createOverlayWindow(create.bounds, 'secondary');
    const id = overlay.id;
    secondaryWindows.set(id, { window:overlay, displayId:create.displayId });
    overlay.webContents.on('did-finish-load',()=>{
      if(lastRenderState && !overlay.isDestroyed()) overlay.webContents.send('overlay-render-state', lastRenderState);
    });
    overlay.on('closed',()=>secondaryWindows.delete(id));
  }

  if(plan.updates.length || plan.creates.length || plan.removes.length){
    writeLog(`OVERLAY_DISPLAYS_SYNCED|displays=${displays.length}|created=${plan.creates.length}|removed=${plan.removes.length}|updated=${plan.updates.length}`);
  }
}

// Keep every overlay on the virtual desktop the user is looking at (Windows only).
let virtualDesktops = null;
let lastDesktopLog = '';
function followVirtualDesktops(){
  if(!virtualDesktops) return;
  followCurrentDesktop(allOverlayWindows(), virtualDesktops, (line)=>{
    if(line !== lastDesktopLog) writeLog(line);
    lastDesktopLog = line;
  });
}

function displayIdForSender(webContents){
  const sender = BrowserWindow.fromWebContents(webContents);
  if(!sender) return null;
  if(sender === win) return winDisplayId;
  return secondaryWindows.get(sender.id)?.displayId ?? null;
}

function sanitizeRenderState(state){
  const value = state && typeof state === 'object' ? state : {};
  return {
    blur:value.blur === true,
    pixelate:value.pixelate === true,
    blackout:value.blackout === true,
    focus:value.focus === true,
    vignette:value.vignette === true,
    level:clampLevel(value.level)
  };
}

ipcMain.on('overlay-render-state',(event,state)=>{
  if(!win || event.sender !== win.webContents) return;
  const next = sanitizeRenderState(state);
  lastRenderState = next;
  updateContentProtection();
  for(const { window } of secondaryWindows.values()){
    if(!window.isDestroyed()) window.webContents.send('overlay-render-state', next);
  }
});

ipcMain.handle('get-capture-source',async(event)=>{
  try{
    const displayId = displayIdForSender(event.sender);
    if(displayId === null) return { ok:false, error:'Unknown overlay window.' };

    const sources = await desktopCapturer.getSources({ types:['screen'], thumbnailSize:{ width:0, height:0 } });
    let source = sources.find((s) => String(s.display_id) === String(displayId));
    // Some systems report empty display_id; fall back only when unambiguous.
    if(!source && sources.length === 1 && screen.getAllDisplays().length === 1) source = sources[0];
    if(!source) return { ok:false, error:'No capture source for this display.' };
    return { ok:true, sourceId:source.id };
  }catch(error){
    writeLog(`PIXELATE_CAPTURE_ERROR|${error.message}`);
    return { ok:false, error:error.message };
  }
});

function rebuildTrayMenu(){
  if(!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label:'Show Overlay', click:()=>allOverlayWindows().forEach((w)=>w.show()) },
    { label:'Hide Overlay', click:hideOverlays },
    { type:'separator' },
    { label:'Privacy profile', submenu:profileInfo().names.map((name)=>({
      label:name, type:'radio', checked:name === activeProfile, click:()=>setActiveProfile(name, 'tray')
    })) },
    { type:'separator' },
    { label:'Protection status: Local device', enabled:false },
    { type:'separator' },
    { label:'Exit', click:()=>app.quit() }
  ]));
}

function createTray(){
  if(tray) return;
  tray = new Tray(path.join(assetPath,'icon-gray.png'));
  tray.setToolTip('SmartScreen Privacy Suite');
  rebuildTrayMenu();
}

function hideOverlays(){
  // Hiding the overlay while the curtain is up would reveal the screen.
  if(curtainState.on){
    writeLog('OVERLAY_HIDE_REFUSED|reason=presence-curtain');
    return;
  }
  allOverlayWindows().forEach((w)=>w.hide());
}

// While concealed the tooltip shows no protection state (MASTER_PROMPT 1.5 rule 10).
function setTrayStatus(icon, tooltip){
  trayStatus = { icon, tooltip };
  if(!tray) return;
  tray.setImage(path.join(assetPath, icon));
  tray.setToolTip(curtainState.on ? 'SmartScreen Privacy Suite' : tooltip);
}

function registerShortcuts(){
  if(shortcutsRegistered) return;
  globalShortcut.register('Control+Shift+B',()=>win?.webContents.send('hotkey-blur'));
  globalShortcut.register('Control+Shift+F',()=>win?.webContents.send('hotkey-focus'));
  globalShortcut.register('Control+Shift+V',()=>win?.webContents.send('hotkey-vignette'));
  globalShortcut.register('Control+Shift+U',()=>{
    ignoringMouse=false;
    win?.setIgnoreMouseEvents(false,{forward:true});
  });
  shortcutsRegistered=true;
}

function showMainWindow(){
  if(setupWindow && !setupWindow.isDestroyed()) setupWindow.close();
  if(enrollmentWindow && !enrollmentWindow.isDestroyed()) enrollmentWindow.close();
  createWindow();
  createTray();
  registerShortcuts();
}

function createSetupWindow(){
  if(setupWindow && !setupWindow.isDestroyed()) return;
  setupWindow = new BrowserWindow({
    width:560,
    height:620,
    minWidth:520,
    minHeight:580,
    resizable:false,
    autoHideMenuBar:true,
    backgroundColor:'#0f1115',
    webPreferences:{
      preload:path.join(__dirname,'setup_preload.js'),
      contextIsolation:true,
      nodeIntegration:false
    }
  });
  setupWindow.loadFile(path.join(__dirname,'..','frontend','setup.html'));
  setupWindow.on('closed',()=>{
    setupWindow=null;
    if(!win && !enrollmentWindow) app.quit();
  });
}

function createEnrollmentWindow(){
  if(enrollmentWindow && !enrollmentWindow.isDestroyed()){
    enrollmentWindow.focus();
    return;
  }

  enrollmentWindow = new BrowserWindow({
    width:760,
    height:700,
    minWidth:720,
    minHeight:660,
    resizable:false,
    autoHideMenuBar:true,
    backgroundColor:'#0f1115',
    parent: win && !win.isDestroyed() ? win : undefined,
    modal: Boolean(win && !win.isDestroyed()),
    webPreferences:{
      preload:path.join(__dirname,'enroll_preload.js'),
      contextIsolation:true,
      nodeIntegration:false
    }
  });

  enrollmentWindow.loadFile(path.join(__dirname,'..','frontend','enroll.html'));
  enrollmentWindow.on('closed',()=>{
    enrollmentWindow=null;
    if(!win && isConfigured(app.getPath('userData'))){
      app.quit();
    }
  });
}

async function finishEnrollment(result){
  if(!safeStorage.isEncryptionAvailable()){
    throw new Error('OS-backed encryption is unavailable on this device.');
  }

  const template = {
    version:1,
    model:'SFace',
    distance:'cosine',
    embedding:result.embedding,
    sampleCount:result.sampleCount,
    createdAt:new Date().toISOString()
  };

  saveTemplate(app.getPath('userData'), template);
  markBiometricEnrolled(app.getPath('userData'), { sampleCount: result.sampleCount });
  writeLog(`BIOMETRIC_ENROLLED|samples=${result.sampleCount}`);

  if(win && !win.isDestroyed()){
    win.webContents.send('biometric-updated', { enrolled:true, sampleCount:result.sampleCount });
  }

  showMainWindow();
}

function runEnrollmentPython(imagePaths){
  return new Promise((resolve,reject)=>{
    const scriptPath = path.join(__dirname,'..','backend','enroll_face.py');
    const modelDetector = path.join(modelsPath,'face_detection_yunet_2023mar.onnx');
    const modelRecognizer = path.join(modelsPath,'face_recognition_sface_2021dec.onnx');

    if(!fs.existsSync(scriptPath)) return reject(new Error('Enrollment service not found.'));
    if(!fs.existsSync(modelDetector) || !fs.existsSync(modelRecognizer)){
      return reject(new Error('Face models are missing. Run the model download script before enrollment.'));
    }

    const args = [
      scriptPath,
      '--detector', modelDetector,
      '--recognizer', modelRecognizer,
      ...imagePaths.flatMap((p)=>['--image',p])
    ];

    const child = spawn('python', args, { stdio:['ignore','pipe','pipe'], windowsHide:true });
    let stdout='';
    let stderr='';
    let settled=false;

    const timer = setTimeout(()=>{
      if(settled) return;
      settled=true;
      try{ child.kill(); }catch{}
      reject(new Error('Face enrollment timed out.'));
    }, 30000);

    child.stdout.on('data',(data)=>{ stdout += data.toString(); });
    child.stderr.on('data',(data)=>{ stderr += data.toString(); });

    child.on('error',(err)=>{
      if(settled) return;
      settled=true;
      clearTimeout(timer);
      reject(new Error(`Unable to start Python enrollment service: ${err.message}`));
    });

    child.on('close',(code)=>{
      if(settled) return;
      settled=true;
      clearTimeout(timer);

      if(code !== 0){
        const detail = stderr.trim() || stdout.trim() || `Process exited with code ${code}.`;
        reject(new Error(detail.slice(-900)));
        return;
      }

      try{
        const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
        const payload = JSON.parse(lines[lines.length-1]);
        if(!payload.ok) throw new Error(payload.error || 'Enrollment failed.');
        resolve(payload);
      }catch(error){
        reject(new Error(`Invalid enrollment response: ${error.message}`));
      }
    });
  });
}

function decodeDataUrlToBuffer(dataUrl){
  if(typeof dataUrl !== 'string') throw new Error('Invalid image data.');
  const match = dataUrl.match(/^data:image\/(jpeg|jpg|png);base64,(.+)$/);
  if(!match) throw new Error('Invalid image format.');
  return Buffer.from(match[2], 'base64');
}

ipcMain.handle('device-setup-status',()=>({ configured:isConfigured(app.getPath('userData')) }));

ipcMain.handle('device-setup-complete',()=>{
  if(!isConfigured(app.getPath('userData'))){
    try{
      createProfile(app.getPath('userData'));
      writeLog('DEVICE_SETUP_COMPLETE');
    }catch(error){
      console.error('DEVICE_SETUP_ERROR:',error);
      writeLog(`DEVICE_SETUP_ERROR: ${error.message}`);
      return {ok:false,error:'Unable to save device setup.'};
    }
  }

  if(!readProfile(app.getPath('userData'))?.biometric?.enrolled){
    createEnrollmentWindow();
  }else{
    showMainWindow();
  }
  return {ok:true};
});

ipcMain.handle('confirm-protected-action',async(_event,options)=>{
  const title = typeof options?.title === 'string' ? options.title : 'Confirm action';
  const message = typeof options?.message === 'string' ? options.message : 'This action changes SmartScreen protection.';
  const result = await dialog.showMessageBox(win && !win.isDestroyed() ? win : enrollmentWindow, {
    type:'warning',
    buttons:['Cancel','Continue'],
    defaultId:0,
    cancelId:0,
    noLink:true,
    title,
    message
  });
  return result.response === 1;
});

ipcMain.handle('get-biometric-status',()=>{
  const profile = readProfile(app.getPath('userData'));
  return {
    enrolled:Boolean(profile?.biometric?.enrolled),
    sampleCount:Number(profile?.biometric?.sampleCount || 0)
  };
});

ipcMain.handle('open-enrollment',async()=>{
  const profile = readProfile(app.getPath('userData'));
  if(profile?.biometric?.enrolled){
    const confirmed = await dialog.showMessageBox(win && !win.isDestroyed() ? win : enrollmentWindow, {
      type:'warning',
      buttons:['Cancel','Continue'],
      defaultId:0,
      cancelId:0,
      noLink:true,
      title:'Change registered identity',
      message:'This will replace the biometric template currently used to recognize the owner.'
    });
    if(confirmed.response !== 1) return {ok:false,cancelled:true};
  }
  createEnrollmentWindow();
  return {ok:true};
});

ipcMain.handle('enrollment-submit',async(_event,samples)=>{
  if(!Array.isArray(samples) || samples.length !== 5){
    return {ok:false,error:'Exactly five enrollment samples are required.'};
  }

  const tempDir = path.join(app.getPath('userData'),'biometric','enrollment_tmp');
  fs.mkdirSync(tempDir,{recursive:true});
  const imagePaths=[];

  try{
    for(let i=0;i<samples.length;i++){
      const buffer = decodeDataUrlToBuffer(samples[i]);
      if(buffer.length < 1000 || buffer.length > 5_000_000){
        throw new Error('Enrollment image size is invalid.');
      }
      const imagePath = path.join(tempDir, `sample_${Date.now()}_${i}.jpg`);
      fs.writeFileSync(imagePath, buffer);
      imagePaths.push(imagePath);
    }

    const result = await runEnrollmentPython(imagePaths);
    await finishEnrollment(result);
    return {ok:true, sampleCount:result.sampleCount};
  }catch(error){
    writeLog(`BIOMETRIC_ENROLLMENT_FAILED|${error.message}`);
    return {ok:false,error:error.message};
  }finally{
    for(const imagePath of imagePaths){
      try{ fs.unlinkSync(imagePath); }catch{}
    }
    try{
      if(fs.existsSync(tempDir) && fs.readdirSync(tempDir).length===0) fs.rmdirSync(tempDir);
    }catch{}
  }
});

ipcMain.on('enrollment-cancel',()=>{
  if(enrollmentWindow && !enrollmentWindow.isDestroyed()){
    if(win && !win.isDestroyed()) enrollmentWindow.close();
    else app.quit();
  }
});

function sendWalkAwayStatus(phase, remainingMs=0){
  if(!win || win.isDestroyed()) return;
  win.webContents.send('walk-away-status', { phase, remainingMs: Math.max(0, remainingMs) });
}

function sendPrivacyAction(action, reason='state-change'){
  if(!win || win.isDestroyed()) return;
  win.webContents.send('privacy-action', { action, reason });
}

const lockScreen = createScreenLocker({
  exec,
  log:writeLog,
  onError:(error)=>console.error('WINDOWS LOCK ERROR:', error.message)
});

const protection = createProtectionSequence({
  getSettings:effectiveSettings,
  evaluateThreat:({ state, payload, threatMs, ageMs })=>decide({
    state, tracks:payload?.tracks, app:activeApp, profile:currentProfile(), profileName:activeProfile, threatMs, ageMs
  }),
  isMonitoring:()=>Boolean(pythonProcess),
  sendAction:sendPrivacyAction,
  sendWalkAwayStatus,
  log:writeLog,
  lock:lockScreen
});

// Presence Gate: owns the privacy curtain. The curtain is sent to every overlay window
// directly (not relayed by the primary renderer), so each display conceals on its own.
const presenceGate = createPresenceGate({
  getSettings:effectiveSettings,
  log:writeLog,
  lock:lockScreen,
  onChange:(snapshot)=>{
    curtainState = { on:snapshot.curtain, effect:snapshot.effect };
    for(const overlay of allOverlayWindows()) overlay.webContents.send('presence-curtain', curtainState);
    updateContentProtection();
    setTrayStatus(trayStatus.icon, trayStatus.tooltip);
    if(win && !win.isDestroyed()) win.webContents.send('presence-gate', snapshot);
  }
});

// Low-volume pose/liveness trail for explanations and live checks: one line per change of
// facing class or of any track's liveness, never per frame.
function logPoseAndLiveness(payload){
  if(payload.facing){
    const key = payload.facing;
    if(key !== lastPoseKey){
      lastPoseKey = key;
      writeLog(`AI_POSE|facing=${payload.facing}|yaw=${Number(payload.yaw || 0).toFixed(0)}|pitch=${Number(payload.pitch || 0).toFixed(0)}`);
    }
  }
  const tracks = payload.tracks || [];
  const liveKey = tracks.map((t) => `${t.role}:${t.liveness}`).join(',');
  if(liveKey && liveKey !== lastLivenessKey){
    lastLivenessKey = liveKey;
    writeLog(`AI_LIVENESS|${liveKey}`);
  }
}

function sendAIState(payload){
  if(!win || win.isDestroyed()) return;
  win.webContents.send('ai-state', payload);
  protection.updateForState(payload.state, payload);
  presenceGate.update(payload.state, payload);

  switch(payload.state){
    case 'OWNER_PRESENT':
      win.webContents.send('ai-user', payload);
      win.webContents.send('ai-normal', payload);
      break;
    case 'NO_USER':
      win.webContents.send('ai-nouser', payload);
      win.webContents.send('ai-normal', payload);
      break;
    case 'UNKNOWN_PERSON':
    case 'OWNER_AND_UNKNOWN':
    case 'UNKNOWN_GROUP':
      win.webContents.send('ai-intruder', payload);
      break;
    default:
      break;
  }
}

// Report a monitoring failure to the renderer once per AI run, so a later
// generic "exited with code 1" does not overwrite a specific CAMERA_ERROR.
function reportAIFailure(kind, message, reason){
  if(protectionActive && restartLoop.record(performance.now())) reportTamper('ai-restart-loop', `failures=${restartLoop.count}|windowMin=10`);
  protection.handleMonitorFailure(`ai-failed-${kind}`);
  presenceGate.failsafe(reason || (kind === 'CAMERA_ERROR' ? 'camera-error' : 'ai-unavailable'));
  if(aiFailureReported) return;
  aiFailureReported = true;
  win?.webContents.send('ai-failed',{kind,message});
}

// Ends the backend process. Protection state is the caller's decision.
function stopAIProcess(){
  if(aiWatchdog){ clearInterval(aiWatchdog); aiWatchdog=null; }
  if(!pythonProcess) return;
  try{ pythonProcess.stdin.write('STOP\n'); }catch{}
  try{ pythonProcess.kill(); }catch{}
  pythonProcess=null;
}

function startAIWatchdog(){
  if(aiWatchdog) clearInterval(aiWatchdog);
  const timeoutMs = Math.max(5000, Number(effectiveSettings().aiWatchdogTimeoutMs ?? 15000) || 15000);
  lastAIHeartbeat = performance.now();
  aiWatchdog = setInterval(() => {
    if(!pythonProcess || !win || win.isDestroyed()) return;
    if(performance.now() - lastAIHeartbeat > timeoutMs){
      writeLog('AI_WATCHDOG_TIMEOUT');
      reportAIFailure('AI_UNAVAILABLE','The privacy recognition service stopped responding.','watchdog-timeout');
      stopAIProcess();
    }
  },2000);
}

ipcMain.on('set-ignore-mouse',(_event,val)=>{
  ignoringMouse=Boolean(val);
  if(win && !win.isDestroyed()) win.setIgnoreMouseEvents(ignoringMouse,{forward:true});
});

ipcMain.on('start-ai',()=>{
  if(!win || pythonProcess) return;
  protectionActive = true;
  setActiveAppPolling(true);
  videoBaseline = videoDevices ? [...videoDevices] : null;
  // The curtain goes up before the camera starts.
  if(presenceGate.state === 'FAILSAFE') presenceGate.retry();
  else presenceGate.start();
  startAI();
});

ipcMain.on('retry-protection',()=>{
  if(!win || pythonProcess) return;
  if(!presenceGate.retry()) return;
  writeLog('PROTECTION_RETRY');
  startAI();
});

function startAI(){
  aiFailureReported = false;
  lastAIState = null;
  lastPoseKey = '';
  lastLivenessKey = '';

  let template;
  try{
    template = readTemplate(app.getPath('userData'));
  }catch(error){
    writeLog(`AI_TEMPLATE_ERROR|${error.message}`);
    reportAIFailure('AI_UNAVAILABLE',`Unable to read the owner biometric template: ${error.message}`);
    return;
  }

  if(!template?.embedding || !Array.isArray(template.embedding) || template.embedding.length === 0){
    reportAIFailure('AI_UNAVAILABLE','Owner identity is not enrolled.');
    return;
  }

  const isDev = !app.isPackaged;
  let runPath;
  let args=[];

  if(isDev){
    runPath='python';
    args=[
      path.join(__dirname,'..','backend','face_detection.py'),
      '--detector',path.join(modelsPath,'face_detection_yunet_2023mar.onnx'),
      '--recognizer',path.join(modelsPath,'face_recognition_sface_2021dec.onnx')
    ];
  }else{
    runPath=path.join(process.resourcesPath,'backend','dist','face_detection.exe');
    args=[
      '--detector',path.join(modelsPath,'face_detection_yunet_2023mar.onnx'),
      '--recognizer',path.join(modelsPath,'face_recognition_sface_2021dec.onnx')
    ];
    if(!fs.existsSync(runPath)){
      reportAIFailure('AI_UNAVAILABLE','Packaged AI service is missing.');
      return;
    }
  }

  const detectorModelPath = path.join(modelsPath,'face_detection_yunet_2023mar.onnx');
  const recognizerModelPath = path.join(modelsPath,'face_recognition_sface_2021dec.onnx');
  if(!fs.existsSync(detectorModelPath) || !fs.existsSync(recognizerModelPath)){
    reportAIFailure('AI_UNAVAILABLE','Face recognition models are missing.');
    return;
  }

  // Self-test harness only: a scripted backend that speaks the same line protocol.
  let spawnEnv = process.env;
  if(TEST_MODE && process.env.SMARTSCREEN_MOCK_BACKEND){
    runPath = process.execPath;
    args = [path.join(__dirname,'..','tests','e2e','mock_backend.js'), path.resolve(process.env.SMARTSCREEN_MOCK_BACKEND)];
    spawnEnv = { ...process.env, ELECTRON_RUN_AS_NODE:'1' };
    writeLog(`TEST_MOCK_BACKEND|${path.basename(process.env.SMARTSCREEN_MOCK_BACKEND)}`);
  }

  const logPath = path.join(app.getPath('userData'),'intruder_logs');
  fs.mkdirSync(logPath,{recursive:true});

  const child = spawn(runPath,args,{stdio:['pipe','pipe','pipe'],windowsHide:true,env:spawnEnv});
  pythonProcess=child;
  win.webContents.send('ai-starting');

  const cfg = effectiveSettings();
  const config = {
    template: template.embedding,
    threshold: Number(cfg.recognitionThreshold ?? 0.363),
    detectionThreshold: Number(cfg.faceDetectionThreshold ?? 0.85),
    processEveryN: Math.max(1, Number(cfg.aiProcessEveryN ?? 3)),
    confirmFrames: Math.max(1, Number(cfg.aiConfirmFrames ?? 5)),
    minFaceSize: Math.max(40, Number(cfg.minimumFaceSize ?? 70)),
    noUserDetectionDelay: Math.max(0.5, Number(cfg.noUserDetectionDelay ?? 1.5)),
    cameraFailureTimeout: Math.max(0.5, Number(cfg.cameraFailureTimeout ?? 3)),
    stateUpdateInterval: Math.max(0, Number(cfg.aiStateUpdateInterval ?? 0.4)),
    headPose: cfg.headPose || {},
    logDir: logPath
  };
  // The backend ignores cameraSource unless SMARTSCREEN_TEST=1 is set too.
  if(TEST_MODE && process.env.SMARTSCREEN_CAMERA_SOURCE){
    config.cameraSource = process.env.SMARTSCREEN_CAMERA_SOURCE;
    writeLog(`TEST_CAMERA_SOURCE|${path.basename(config.cameraSource)}`);
  }

  const isCurrent = () => pythonProcess === child;

  const stdoutLines = createLineSplitter((msg)=>{
    if(!win || !isCurrent()) return;

    if(msg === 'AI_READY'){
      lastAIHeartbeat = performance.now();
      writeLog('AI_READY');
      win.webContents.send('ai-ready');
    }else if(msg === 'AI_HEARTBEAT'){
      lastAIHeartbeat = performance.now();
    }else if(msg.startsWith('STATE|')){
      lastAIHeartbeat = performance.now();
      const payload = parseStateMessage(msg);
      if(payload.state !== lastAIState) writeLog(`AI_STATE|${msg}`);
      logPoseAndLiveness(payload);
      lastAIState = payload.state;
      sendAIState(payload);
    }else if(msg.startsWith('PHOTO_SAVED|')){
      lastIntruderImage=msg.split('|').slice(1).join('|') || '';
      writeLog(msg);
      win.webContents.send('ai-photo-saved',{path:lastIntruderImage});
    }else if(msg.startsWith('LIVENESS|')){
      writeLog(msg.slice(0, 120));
    }else if(msg.startsWith('STATS|')){
      diagnostics.setBackendStats(parseStatsMessage(msg));
    }else if(msg.startsWith('TAMPER|')){
      const { kind, detail } = parseTamperMessage(msg);
      reportTamper(kind, detail);
    }else if(msg === 'PHOTO_SAVE_FAILED'){
      writeLog('PHOTO_SAVE_FAILED');
    }else if(msg.startsWith('AI_ERROR|')){
      const { kind, message } = parseErrorMessage(msg);
      writeLog(`AI_ERROR|${kind}|${message}`);
      reportAIFailure(kind, message);
    }
  });
  child.stdout.on('data',(data)=>stdoutLines.push(data));

  try{
    child.stdin.write(`${JSON.stringify(config)}\n`);
  }catch(error){
    writeLog(`AI_CONFIG_SEND_ERROR|${error.message}`);
    try{ child.kill(); }catch{}
    pythonProcess=null;
    reportAIFailure('AI_UNAVAILABLE',error.message);
    return;
  }

  startAIWatchdog();

  child.stderr.on('data',(data)=>{
    const message=data.toString().trim();
    if(message) console.error('PYTHON ERROR:',message);
  });

  child.on('error',(err)=>{
    if(!isCurrent()) return;
    pythonProcess=null;
    if(aiWatchdog){ clearInterval(aiWatchdog); aiWatchdog=null; }
    writeLog(`AI_PROCESS_ERROR|${err.message}`);
    reportAIFailure('AI_UNAVAILABLE',err.message);
  });

  child.on('exit',(code)=>{
    stdoutLines.flush();
    writeLog(`AI_EXIT|code=${code}`);
    if(!isCurrent()) return;
    pythonProcess=null;
    if(aiWatchdog){ clearInterval(aiWatchdog); aiWatchdog=null; }

    // We did not stop it (stopAIProcess clears pythonProcess first): any exit is a failure.
    reportAIFailure('AI_UNAVAILABLE',`The privacy recognition service stopped unexpectedly (exit code ${code}).`,'backend-exit');
  });
}

// Deliberate disable (the renderer asks for confirmation first). The only manual way,
// besides quitting, to remove the curtain.
ipcMain.on('stop-ai',()=>{
  stopAIProcess();
  protectionActive = false;
  setActiveAppPolling(false);
  protection.stop('ai-stopped');
  presenceGate.stop('protection-disabled');
  setTimeout(()=>win?.webContents.send('ai-stopped'),150);
});

ipcMain.handle('get-presence-gate',()=>presenceGate.snapshot());
ipcMain.handle('get-profiles',()=>profileInfo());

// Renderer reports the video input devices (deviceIds only) on load and on devicechange.
ipcMain.on('video-devices',(event, ids)=>{
  if(!win || event.sender !== win.webContents || !Array.isArray(ids)) return;
  const list = ids.filter((id)=>typeof id === 'string').slice(0, 32);
  videoDevices = list;
  if(!protectionActive) return;
  if(!videoBaseline){ videoBaseline = [...list]; return; }
  const change = diffDevices(videoBaseline, list);
  if(!change) return;
  videoBaseline = [...list];
  reportTamper('camera-device-changed', `added=${change.added}|removed=${change.removed}`);
});

ipcMain.handle('get-diagnostics',()=>diagnostics.snapshot(electronMetrics()));
ipcMain.handle('export-diagnostics',async()=>{
  const stamp = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
  const result = await dialog.showSaveDialog(win && !win.isDestroyed() ? win : undefined, {
    title:'Export diagnostics',
    defaultPath:path.join(app.getPath('documents'), `smartscreen-diagnostics-${stamp}.json`),
    filters:[{ name:'JSON', extensions:['json'] }]
  });
  if(result.canceled || !result.filePath) return { ok:false, cancelled:true };
  const report = {
    ...diagnostics.snapshot(electronMetrics()),
    app:{ version:app.getVersion(), electron:process.versions.electron, platform:process.platform },
    profile:activeProfile,
    recentEvents:readSecurityEvents(activityLogFile(), 50).map(({ timestamp, type, title }) => ({ timestamp, type, title }))
  };
  fs.writeFileSync(result.filePath, JSON.stringify(report, null, 2));
  writeLog(`DIAGNOSTICS_EXPORTED|file=${path.basename(result.filePath)}`);
  return { ok:true, file:path.basename(result.filePath) };
});
ipcMain.handle('set-profile',(_event,name)=>({ ok:typeof name === 'string' && setActiveProfile(name, 'panel'), ...profileInfo() }));
ipcMain.handle('set-presence-gate',(_event,enabled)=>{
  const ok = presenceGate.setEnabled(enabled === true);
  if(ok) writeLog(`PRESENCE_GATE_SETTING|enabled=${enabled === true}`);
  return { ok, snapshot:presenceGate.snapshot() };
});

ipcMain.on('ai-enabled',()=>{
  setTrayStatus('icon-green.png','SmartScreen Privacy Suite — Protection active');
});

ipcMain.on('ai-disabled',()=>{
  setTrayStatus('icon-gray.png','SmartScreen Privacy Suite — Protection inactive');
});

ipcMain.on('ai-intruder-alert',()=>{
  setTrayStatus('icon-red.png','SmartScreen Privacy Suite — Privacy threat detected');
});

ipcMain.on('ai-intruder-cleared',()=>{
  setTrayStatus('icon-green.png','SmartScreen Privacy Suite — Protection active');
});

ipcMain.on('lock-screen',(_event, reason)=>{
  lockScreen(typeof reason === 'string' ? reason : 'manual');
});
ipcMain.handle('get-security-events',(_event,limit)=>readSecurityEvents(activityLogFile(),limit));
ipcMain.handle('get-last-intruder-image',()=>lastIntruderImage);

app.on('second-instance',()=>{
  if(win && !win.isDestroyed()){
    if(win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }else if(setupWindow && !setupWindow.isDestroyed()){
    if(setupWindow.isMinimized()) setupWindow.restore();
    setupWindow.show();
    setupWindow.focus();
  }
});

function runRuntimeHealthCheck(){
  const detector = path.join(modelsPath,'face_detection_yunet_2023mar.onnx');
  const recognizer = path.join(modelsPath,'face_recognition_sface_2021dec.onnx');
  const profile = readProfile(app.getPath('userData'));
  const checks = {
    detector: fs.existsSync(detector),
    recognizer: fs.existsSync(recognizer),
    configured: Boolean(profile?.setupComplete),
    biometric: Boolean(profile?.biometric?.enrolled),
    encryption: safeStorage.isEncryptionAvailable()
  };
  writeLog(`SYSTEM_HEALTH|detector=${checks.detector}|recognizer=${checks.recognizer}|configured=${checks.configured}|biometric=${checks.biometric}|encryption=${checks.encryption}`);
  return checks;
}

app.whenReady().then(()=>{
  configureCameraPermissions();
  loadSettings();
  if(TEST_MODE) writeLog('TEST_MODE_ACTIVE');
  loadPolicies();
  writeLog(`PROFILE_ACTIVE|profile=${activeProfile}`);
  runRuntimeHealthCheck();

  for(const eventName of ['display-added','display-removed','display-metrics-changed']){
    screen.on(eventName,()=>syncOverlayWindows());
  }

  virtualDesktops = createVirtualDesktops();
  writeLog(`VIRTUAL_DESKTOP_FOLLOW|available=${virtualDesktops.available}`);
  if(virtualDesktops.available) setInterval(followVirtualDesktops, 1000);

  // Never unlocks Windows: after a lock, unlock or resume the gate conceals and re-verifies.
  powerMonitor.on('lock-screen',()=>presenceGate.sessionLocked());
  powerMonitor.on('unlock-screen',()=>presenceGate.sessionUnlocked());
  powerMonitor.on('resume',()=>{ clockMonitor.reset(); presenceGate.resumed(); });
  powerMonitor.on('suspend',()=>clockMonitor.reset());

  startConfigIntegrity();
  setInterval(checkClock, 5000);
  setInterval(()=>{ if(protectionActive) writeLog(diagnostics.summaryLine(electronMetrics())); }, 60000);

  const profile = readProfile(app.getPath('userData'));
  if(!profile?.setupComplete){
    createSetupWindow();
  }else if(!profile?.biometric?.enrolled){
    createEnrollmentWindow();
  }else{
    showMainWindow();
  }
});

app.on('will-quit',()=>{
  globalShortcut.unregisterAll();
  stopAIProcess();
});
