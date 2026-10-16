const { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, dialog, session, safeStorage, screen, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const { isConfigured, createProfile, readProfile, markBiometricEnrolled } = require('./device_profile');
const { saveTemplate, readTemplate } = require('./biometric_store');
const { formatLogLine, readSecurityEvents } = require('./security_events');
const { createLineSplitter, parseStateMessage, parseErrorMessage } = require('./ai_protocol');
const { createProtectionSequence } = require('./protection_sequence');
const { planOverlayWindows } = require('./display_layout');
const { clampLevel } = require('../frontend/intensity');
const { createScreenLocker, isTestMode } = require('./screen_lock');

// Self-test harness only (SMARTSCREEN_TEST=1): isolated profile and a recorded camera source.
const TEST_MODE = isTestMode();
if(TEST_MODE && process.env.SMARTSCREEN_USER_DATA){
  app.setPath('userData', path.resolve(process.env.SMARTSCREEN_USER_DATA));
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if(!gotSingleInstanceLock){
  app.quit();
}


let logDir;
let logFile;
let settings = {};
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
let lastAIHeartbeat = 0;
let aiWatchdog = null;
let aiFailureReported = false;

function writeLog(event){
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
    const data = fs.readFileSync(path.join(__dirname,'..','config','settings.json'));
    settings = JSON.parse(data);
  }catch(err){
    console.error('Failed to load settings:', err);
    settings = {};
  }
  if(TEST_MODE && process.env.SMARTSCREEN_TEST_SETTINGS){
    try{
      settings = { ...settings, ...JSON.parse(process.env.SMARTSCREEN_TEST_SETTINGS) };
    }catch(err){
      console.error('Invalid SMARTSCREEN_TEST_SETTINGS:', err);
    }
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
  overlay.setContentProtection(Boolean(lastRenderState?.pixelate));
  return overlay;
}

function createWindow(){
  if(win && !win.isDestroyed()) return;

  const primary = screen.getPrimaryDisplay();
  win = createOverlayWindow(primary.bounds, 'primary');
  winDisplayId = primary.id;

  win.webContents.on('did-finish-load',()=>{
    win.webContents.send('settings-loaded',settings);
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
  const pixelateChanged = Boolean(lastRenderState?.pixelate) !== next.pixelate;
  lastRenderState = next;

  // Pixelate captures the screen; exclude our own overlays from that capture.
  // Only while pixelate is on, so screen sharing still sees the other effects.
  if(pixelateChanged){
    for(const overlay of allOverlayWindows()) overlay.setContentProtection(next.pixelate);
  }
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

function createTray(){
  if(tray) return;
  tray = new Tray(path.join(assetPath,'icon-gray.png'));
  const menu = Menu.buildFromTemplate([
    { label:'Show Overlay', click:()=>allOverlayWindows().forEach((w)=>w.show()) },
    { label:'Hide Overlay', click:()=>allOverlayWindows().forEach((w)=>w.hide()) },
    { type:'separator' },
    { label:'Protection status: Local device', enabled:false },
    { type:'separator' },
    { label:'Exit', click:()=>app.quit() }
  ]);
  tray.setToolTip('SmartScreen Privacy Suite');
  tray.setContextMenu(menu);
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
  getSettings:()=>settings,
  isMonitoring:()=>Boolean(pythonProcess),
  sendAction:sendPrivacyAction,
  sendWalkAwayStatus,
  log:writeLog,
  lock:lockScreen
});

function sendAIState(payload){
  if(!win || win.isDestroyed()) return;
  win.webContents.send('ai-state', payload);
  protection.updateForState(payload.state);

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
function reportAIFailure(kind, message){
  protection.handleMonitorFailure(`ai-failed-${kind}`);
  if(aiFailureReported) return;
  aiFailureReported = true;
  win?.webContents.send('ai-failed',{kind,message});
}

function stopAIProcess(){
  protection.stop('ai-stopped');
  if(aiWatchdog){ clearInterval(aiWatchdog); aiWatchdog=null; }
  if(!pythonProcess) return;
  try{ pythonProcess.stdin.write('STOP\n'); }catch{}
  try{ pythonProcess.kill(); }catch{}
  pythonProcess=null;
}

function startAIWatchdog(){
  if(aiWatchdog) clearInterval(aiWatchdog);
  const timeoutMs = Math.max(5000, Number(settings.aiWatchdogTimeoutMs ?? 15000) || 15000);
  lastAIHeartbeat = Date.now();
  aiWatchdog = setInterval(() => {
    if(!pythonProcess || !win || win.isDestroyed()) return;
    if(Date.now() - lastAIHeartbeat > timeoutMs){
      writeLog('AI_WATCHDOG_TIMEOUT');
      reportAIFailure('AI_UNAVAILABLE','The privacy recognition service stopped responding.');
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
  aiFailureReported = false;

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

  const detectorModelPath = args[args.indexOf('--detector') + 1];
  const recognizerModelPath = args[args.indexOf('--recognizer') + 1];
  if(!fs.existsSync(detectorModelPath) || !fs.existsSync(recognizerModelPath)){
    reportAIFailure('AI_UNAVAILABLE','Face recognition models are missing.');
    return;
  }

  const logPath = path.join(app.getPath('userData'),'intruder_logs');
  fs.mkdirSync(logPath,{recursive:true});

  const child = spawn(runPath,args,{stdio:['pipe','pipe','pipe'],windowsHide:true});
  pythonProcess=child;
  win.webContents.send('ai-starting');

  const config = {
    template: template.embedding,
    threshold: Number(settings.recognitionThreshold ?? 0.363),
    detectionThreshold: Number(settings.faceDetectionThreshold ?? 0.85),
    processEveryN: Math.max(1, Number(settings.aiProcessEveryN ?? 3)),
    confirmFrames: Math.max(1, Number(settings.aiConfirmFrames ?? 5)),
    minFaceSize: Math.max(40, Number(settings.minimumFaceSize ?? 70)),
    noUserDetectionDelay: Math.max(0.5, Number(settings.noUserDetectionDelay ?? 1.5)),
    cameraFailureTimeout: Math.max(0.5, Number(settings.cameraFailureTimeout ?? 3)),
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
      lastAIHeartbeat = Date.now();
      writeLog('AI_READY');
      win.webContents.send('ai-ready');
    }else if(msg === 'AI_HEARTBEAT'){
      lastAIHeartbeat = Date.now();
    }else if(msg.startsWith('STATE|')){
      lastAIHeartbeat = Date.now();
      const payload = parseStateMessage(msg);
      writeLog(`AI_STATE|${msg}`);
      sendAIState(payload);
    }else if(msg.startsWith('PHOTO_SAVED|')){
      lastIntruderImage=msg.split('|').slice(1).join('|') || '';
      writeLog(msg);
      win.webContents.send('ai-photo-saved',{path:lastIntruderImage});
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

    if(code && code !== 0){
      reportAIFailure('AI_UNAVAILABLE',`The privacy recognition service stopped unexpectedly (exit code ${code}).`);
      return;
    }

    win?.webContents.send('ai-stopped',{code});
  });
});

ipcMain.on('stop-ai',()=>{
  stopAIProcess();
  setTimeout(()=>win?.webContents.send('ai-stopped'),150);
});

ipcMain.on('ai-enabled',()=>{
  if(tray){ tray.setImage(path.join(assetPath,'icon-green.png')); tray.setToolTip('SmartScreen Privacy Suite — Protection active'); }
});

ipcMain.on('ai-disabled',()=>{
  if(tray){ tray.setImage(path.join(assetPath,'icon-gray.png')); tray.setToolTip('SmartScreen Privacy Suite — Protection inactive'); }
});

ipcMain.on('ai-intruder-alert',()=>{
  if(tray){ tray.setImage(path.join(assetPath,'icon-red.png')); tray.setToolTip('SmartScreen Privacy Suite — Privacy threat detected'); }
});

ipcMain.on('ai-intruder-cleared',()=>{
  if(tray){ tray.setImage(path.join(assetPath,'icon-green.png')); tray.setToolTip('SmartScreen Privacy Suite — Protection active'); }
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
  runRuntimeHealthCheck();

  for(const eventName of ['display-added','display-removed','display-metrics-changed']){
    screen.on(eventName,()=>syncOverlayWindows());
  }

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
