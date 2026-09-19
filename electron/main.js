const { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, dialog, session, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const { isConfigured, createProfile, readProfile, markBiometricEnrolled } = require('./device_profile');
const { saveTemplate, readTemplate } = require('./biometric_store');

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if(!gotSingleInstanceLock){
  app.quit();
}


let logDir;
let logFile;
let settings = {};
let win = null;
let setupWindow = null;
let enrollmentWindow = null;
let tray = null;
let shortcutsRegistered = false;
let ignoringMouse = true;
let pythonProcess = null;
let lastIntruderImage = '';
let lastAIHeartbeat = 0;
let aiWatchdog = null;
let walkAwayTimer = null;
let walkAwayCountdownTimer = null;
let walkAwayFocusTimer = null;
let threatLockTimer = null;
let threatFocusTimer = null;
let walkAwayDeadline = 0;
let activeProtectionSequence = null;

function writeLog(event){

function readSecurityEvents(limit=20){
  const file = logFile || path.join(app.getPath('userData'),'logs','activity.log');
  if(!fs.existsSync(file)) return [];

  const lines = fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean);
  const events = [];

  for(let i=lines.length-1;i>=0 && events.length<Math.max(1,Number(limit)||20);i--){
    const line = lines[i];
    const match = line.match(/^(\d{4}-\d{2}-\d{2}T[^ ]+) - (.+)$/);
    if(!match) continue;

    const timestamp = match[1];
    const raw = match[2];
    let type = 'SYSTEM';
    let title = raw;
    let detail = '';

    if(raw === 'DEVICE_SETUP_COMPLETE'){
      type='SETUP'; title='Device setup completed';
    }else if(raw.startsWith('BIOMETRIC_ENROLLED|')){
      type='IDENTITY'; title='Owner identity enrolled';
      detail = raw.split('|')[1]?.replace('samples=','') || '';
    }else if(raw.startsWith('AI_STATE|STATE|OWNER_PRESENT')){
      type='IDENTITY'; title='Owner verified';
    }else if(raw.startsWith('AI_STATE|STATE|NO_USER')){
      type='PRESENCE'; title='No person detected';
    }else if(raw.startsWith('AI_STATE|STATE|UNKNOWN_PERSON')){
      type='THREAT'; title='Unrecognized person detected';
    }else if(raw.startsWith('AI_STATE|STATE|UNKNOWN_GROUP')){
      type='THREAT'; title='Unrecognized people detected';
    }else if(raw.startsWith('AI_STATE|STATE|OWNER_AND_UNKNOWN')){
      type='THREAT'; title='Owner and unrecognized person detected';
    }else if(raw.startsWith('PHOTO_SAVED|')){
      type='EVIDENCE'; title='Security image captured';
    }else if(raw.startsWith('WALK_AWAY_TIMER_ARMED')){
      type='ACTION'; title='Walk-away protection armed';
      detail = raw.split('|')[1]?.replace('delayMs=','') || '';
    }else if(raw === 'WALK_AWAY_FOCUS_ACTIVATED'){
      type='ACTION'; title='Privacy focus activated';
    }else if(raw === 'WALK_AWAY_TIMER_EXPIRED'){
      type='ACTION'; title='Walk-away timer expired';
    }else if(raw === 'THREAT_FOCUS_ACTIVATED'){
      type='ACTION'; title='Privacy focus activated';
    }else if(raw.startsWith('THREAT_LOCK_TIMER_EXPIRED')){
      type='ACTION'; title='Threat lock timer expired';
    }else if(raw.startsWith('LOCK_REQUESTED|')){
      type='ACTION'; title='Screen lock requested';
      detail = raw.split('|')[1]?.replace('reason=','') || '';
    }else if(raw.startsWith('LOCK_COMMAND_COMPLETED|')){
      type='ACTION'; title='Screen locked';
      detail = raw.split('|')[1]?.replace('reason=','') || '';
    }else if(raw.startsWith('LOCK_ERROR|')){
      type='ERROR'; title='Screen lock failed';
    }else if(raw === 'AI_READY'){
      type='SYSTEM'; title='Privacy recognition service ready';
    }else if(raw.startsWith('AI_ERROR|') || raw === 'AI_WATCHDOG_TIMEOUT'){
      type='ERROR'; title='Privacy recognition service unavailable';
    }else{
      continue;
    }

    events.push({timestamp,type,title,detail});
  }

  return events;
}

  if(!logDir){
    logDir = path.join(app.getPath('userData'), 'logs');
    logFile = path.join(logDir, 'activity.log');
  }
  if(!fs.existsSync(logDir)) fs.mkdirSync(logDir,{recursive:true});
  fs.appendFileSync(logFile, `${new Date().toISOString()} - ${event}\n`);
}

function loadSettings(){
  try{
    const data = fs.readFileSync(path.join(__dirname,'..','config','settings.json'));
    settings = JSON.parse(data);
  }catch(err){
    console.error('Failed to load settings:', err);
    settings = {};
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

function createWindow(){
  if(win && !win.isDestroyed()) return;

  win = new BrowserWindow({
    fullscreen:true,
    transparent:true,
    frame:false,
    alwaysOnTop:true,
    backgroundColor:'#00000000',
    webPreferences:{
      preload:path.join(__dirname,'preload.js'),
      contextIsolation:true,
      nodeIntegration:false
    }
  });

  win.loadFile(path.join(__dirname,'..','frontend','index.html'));
  win.webContents.on('did-finish-load',()=>{
    win.webContents.send('settings-loaded',settings);
  });

  win.on('closed',()=>{ win=null; });
  win.setIgnoreMouseEvents(true,{forward:true});
  win.setAlwaysOnTop(true,'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
}

function createTray(){
  if(tray) return;
  tray = new Tray(path.join(assetPath,'icon-gray.png'));
  const menu = Menu.buildFromTemplate([
    { label:'Show Overlay', click:()=>win?.show() },
    { label:'Hide Overlay', click:()=>win?.hide() },
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

function parseStateMessage(message){
  const parts = message.split('|');
  const state = parts[1] || 'UNKNOWN';
  const data = { state };
  for(const part of parts.slice(2)){
    const [key, value] = part.split('=');
    if(!key) continue;
    if(key === 'faces' || key === 'owners' || key === 'unknown') data[key] = Number(value || 0);
    else if(key === 'best' || key === 'ownerScore') data[key] = Number(value || 0);
  }
  return data;
}

function sendWalkAwayStatus(phase, remainingMs=0){
  if(!win || win.isDestroyed()) return;
  win.webContents.send('walk-away-status', { phase, remainingMs: Math.max(0, remainingMs) });
}

function sendPrivacyAction(action, reason='state-change'){
  if(!win || win.isDestroyed()) return;
  win.webContents.send('privacy-action', { action, reason });
}

function cancelProtectionSequence(reason='state-change'){
  if(walkAwayTimer){ clearTimeout(walkAwayTimer); walkAwayTimer=null; }
  if(walkAwayCountdownTimer){ clearInterval(walkAwayCountdownTimer); walkAwayCountdownTimer=null; }
  if(walkAwayFocusTimer){ clearTimeout(walkAwayFocusTimer); walkAwayFocusTimer=null; }
  if(threatFocusTimer){ clearTimeout(threatFocusTimer); threatFocusTimer=null; }
  if(threatLockTimer){ clearTimeout(threatLockTimer); threatLockTimer=null; }
  if(activeProtectionSequence){
    writeLog(`PROTECTION_SEQUENCE_CANCELLED|type=${activeProtectionSequence}|reason=${reason}`);
    activeProtectionSequence=null;
    sendPrivacyAction('CLEAR', reason);
  }
  walkAwayDeadline=0;
}

function cancelWalkAwayTimer(reason='state-change'){
  if(walkAwayTimer || walkAwayCountdownTimer || walkAwayFocusTimer){
    if(walkAwayTimer){ clearTimeout(walkAwayTimer); walkAwayTimer=null; }
    if(walkAwayCountdownTimer){ clearInterval(walkAwayCountdownTimer); walkAwayCountdownTimer=null; }
    if(walkAwayFocusTimer){ clearTimeout(walkAwayFocusTimer); walkAwayFocusTimer=null; }
    walkAwayDeadline=0;
    writeLog(`WALK_AWAY_TIMER_CANCELLED|reason=${reason}`);
    sendWalkAwayStatus('CANCELLED',0);
  }
}

function lockScreen(reason='manual'){
  writeLog(`LOCK_REQUESTED|reason=${reason}`);
  exec('rundll32.exe user32.dll,LockWorkStation', (error, stdout, stderr) => {
    if(error){
      writeLog(`LOCK_ERROR|reason=${reason}|${error.message}`);
      console.error('WINDOWS LOCK ERROR:', error.message);
      return;
    }
    if(stderr?.trim()) writeLog(`LOCK_STDERR|reason=${reason}|${stderr.trim()}`);
    writeLog(`LOCK_COMMAND_COMPLETED|reason=${reason}`);
  });
}

function armWalkAwayTimer(){
  if(!pythonProcess || activeProtectionSequence === 'WALK_AWAY') return;
  cancelProtectionSequence('new-walk-away');

  const configuredDelay = Number(settings.walkAwayLockDelay ?? 6000);
  const delay = Math.max(1000, Number.isFinite(configuredDelay) ? configuredDelay : 6000);
  const focusConfigured = Number(settings.walkAwayFocusDelay ?? 3000);
  const focusDelay = Math.min(delay - 250, Math.max(0, Number.isFinite(focusConfigured) ? focusConfigured : 3000));

  activeProtectionSequence='WALK_AWAY';
  sendPrivacyAction('BLUR','walk-away');
  writeLog(`WALK_AWAY_TIMER_ARMED|delayMs=${delay}|focusDelayMs=${focusDelay}`);
  walkAwayDeadline=Date.now()+delay;
  sendWalkAwayStatus('ARMED',delay);

  walkAwayFocusTimer=setTimeout(()=>{
    walkAwayFocusTimer=null;
    if(activeProtectionSequence !== 'WALK_AWAY') return;
    sendPrivacyAction('FOCUS','walk-away');
    writeLog('WALK_AWAY_FOCUS_ACTIVATED');
  },focusDelay);

  walkAwayCountdownTimer=setInterval(()=>{
    const remainingMs=Math.max(0,walkAwayDeadline-Date.now());
    sendWalkAwayStatus('COUNTDOWN',remainingMs);
    if(remainingMs<=0 && walkAwayCountdownTimer){
      clearInterval(walkAwayCountdownTimer);
      walkAwayCountdownTimer=null;
    }
  },250);

  walkAwayTimer=setTimeout(()=>{
    walkAwayTimer=null;
    if(walkAwayCountdownTimer){ clearInterval(walkAwayCountdownTimer); walkAwayCountdownTimer=null; }
    if(walkAwayFocusTimer){ clearTimeout(walkAwayFocusTimer); walkAwayFocusTimer=null; }
    walkAwayDeadline=0;
    if(activeProtectionSequence !== 'WALK_AWAY') return;
    writeLog('WALK_AWAY_TIMER_EXPIRED');
    sendWalkAwayStatus('EXPIRED',0);
    sendPrivacyAction('LOCKING','walk-away');
    lockScreen('walk-away');
  },delay);
}

function startThreatProtection(){
  if(!pythonProcess || activeProtectionSequence === 'THREAT') return;
  cancelProtectionSequence('new-threat');
  activeProtectionSequence='THREAT';

  const focusConfigured=Number(settings.intruderFocusDelay ?? 3000);
  const lockConfigured=Number(settings.intruderLockDelay ?? 5000);
  const focusDelay=Math.max(0,Number.isFinite(focusConfigured)?focusConfigured:3000);
  const lockDelay=Math.max(focusDelay,Number.isFinite(lockConfigured)?lockConfigured:5000);

  sendPrivacyAction('BLUR','threat');
  threatFocusTimer=setTimeout(()=>{
    threatFocusTimer=null;
    if(activeProtectionSequence !== 'THREAT') return;
    sendPrivacyAction('FOCUS','threat');
    writeLog('THREAT_FOCUS_ACTIVATED');
  },focusDelay);

  threatLockTimer=setTimeout(()=>{
    threatLockTimer=null;
    if(activeProtectionSequence !== 'THREAT') return;
    sendPrivacyAction('LOCKING','threat');
    writeLog('THREAT_LOCK_TIMER_EXPIRED');
    lockScreen('privacy-threat');
  },lockDelay);
}

function updateWalkAwayForState(state){
  if(state === 'NO_USER'){
    if(activeProtectionSequence !== 'WALK_AWAY') armWalkAwayTimer();
  }else if(state === 'OWNER_PRESENT'){
    if(activeProtectionSequence === 'WALK_AWAY') cancelProtectionSequence('owner-returned');
    cancelWalkAwayTimer('owner-present');
  }else if(state === 'UNKNOWN_PERSON' || state === 'UNKNOWN_GROUP' || state === 'OWNER_AND_UNKNOWN'){
    if(activeProtectionSequence === 'WALK_AWAY') cancelProtectionSequence('privacy-threat');
    if(activeProtectionSequence !== 'THREAT') startThreatProtection();
  }else{
    cancelProtectionSequence(`state-${state}`);
    cancelWalkAwayTimer(`state-${state}`);
  }
}

function sendAIState(payload){
  if(!win || win.isDestroyed()) return;
  win.webContents.send('ai-state', payload);
  updateWalkAwayForState(payload.state);

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

function stopAIProcess(){
  cancelProtectionSequence('ai-stopped');
  cancelWalkAwayTimer('ai-stopped');
  if(aiWatchdog){ clearInterval(aiWatchdog); aiWatchdog=null; }
  if(!pythonProcess) return;
  try{ pythonProcess.stdin.write('STOP\n'); }catch{}
  try{ pythonProcess.kill(); }catch{}
  pythonProcess=null;
}

function startAIWatchdog(){
  if(aiWatchdog) clearInterval(aiWatchdog);
  lastAIHeartbeat = Date.now();
  aiWatchdog = setInterval(() => {
    if(!pythonProcess || !win || win.isDestroyed()) return;
    if(Date.now() - lastAIHeartbeat > 15000){
      writeLog('AI_WATCHDOG_TIMEOUT');
      win.webContents.send('ai-failed',{kind:'AI_UNAVAILABLE',message:'The privacy recognition service stopped responding.'});
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

  let template;
  try{
    template = readTemplate(app.getPath('userData'));
  }catch(error){
    writeLog(`AI_TEMPLATE_ERROR|${error.message}`);
    win.webContents.send('ai-failed',{kind:'AI_UNAVAILABLE',message:`Unable to read the owner biometric template: ${error.message}`});
    return;
  }

  if(!template?.embedding || !Array.isArray(template.embedding) || template.embedding.length === 0){
    win.webContents.send('ai-failed',{kind:'AI_UNAVAILABLE',message:'Owner identity is not enrolled.'});
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
      win.webContents.send('ai-failed',{kind:'AI_UNAVAILABLE',message:'Packaged AI service is missing.'});
      return;
    }
  }

  const detectorModelPath = args[args.indexOf('--detector') + 1];
  const recognizerModelPath = args[args.indexOf('--recognizer') + 1];
  if(!fs.existsSync(detectorModelPath) || !fs.existsSync(recognizerModelPath)){
    win.webContents.send('ai-failed',{kind:'AI_UNAVAILABLE',message:'Face recognition models are missing.'});
    return;
  }

  const logPath = path.join(app.getPath('userData'),'intruder_logs');
  fs.mkdirSync(logPath,{recursive:true});

  const child = spawn(runPath,args,{stdio:['pipe','pipe','pipe'],windowsHide:true});
  pythonProcess=child;
  win.webContents.send('ai-starting');

  let configSent=false;
  const config = {
    template: template.embedding,
    threshold: Number(settings.recognitionThreshold ?? 0.363),
    detectionThreshold: Number(settings.faceDetectionThreshold ?? 0.85),
    processEveryN: Math.max(1, Number(settings.aiProcessEveryN ?? 3)),
    confirmFrames: Math.max(1, Number(settings.aiConfirmFrames ?? 5)),
    minFaceSize: Math.max(40, Number(settings.minimumFaceSize ?? 70)),
    noUserDetectionDelay: Math.max(0.5, Number(settings.noUserDetectionDelay ?? 1.5)),
    logDir: logPath
  };

  child.stdout.on('data',(data)=>{
    data.toString().split(/\r?\n/).forEach((line)=>{
      const msg=line.trim();
      if(!msg || !win) return;

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
        const parts = msg.split('|');
        const kind = parts[1] || 'AI_UNAVAILABLE';
        const message = parts.slice(2).join('|') || 'Privacy recognition service unavailable.';
        writeLog(`AI_ERROR|${kind}|${message}`);
        win.webContents.send('ai-failed',{kind,message});
      }
    });
  });

  try{
    child.stdin.write(`${JSON.stringify(config)}\n`);
    configSent=true;
  }catch(error){
    writeLog(`AI_CONFIG_SEND_ERROR|${error.message}`);
    try{ child.kill(); }catch{}
    pythonProcess=null;
    win.webContents.send('ai-failed',{kind:'AI_UNAVAILABLE',message:error.message});
    return;
  }

  startAIWatchdog();

  child.stderr.on('data',(data)=>{
    const message=data.toString().trim();
    if(message) console.error('PYTHON ERROR:',message);
  });

  child.on('error',(err)=>{
    pythonProcess=null;
    if(aiWatchdog){ clearInterval(aiWatchdog); aiWatchdog=null; }
    writeLog(`AI_PROCESS_ERROR|${err.message}`);
    win?.webContents.send('ai-failed',{kind:'AI_UNAVAILABLE',message:err.message});
  });

  child.on('exit',(code)=>{
    pythonProcess=null;
    if(aiWatchdog){ clearInterval(aiWatchdog); aiWatchdog=null; }
    writeLog(`AI_EXIT|code=${code}`);

    if(code && code !== 0){
      win?.webContents.send('ai-failed',{
        kind:'AI_UNAVAILABLE',
        message:`The privacy recognition service stopped unexpectedly (exit code ${code}).`
      });
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
ipcMain.handle('get-security-events',(_event,limit)=>readSecurityEvents(limit));
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
  runRuntimeHealthCheck();

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
