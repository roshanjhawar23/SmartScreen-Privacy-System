// ---------------- REQUIRE SECTION ----------------
const { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');

// ---------------- LOGGING ----------------
let logDir;
let logFile;

function writeLog(event){

  if(!logDir){
    logDir = path.join(app.getPath('userData'), 'logs');
    logFile = path.join(logDir, 'activity.log');
  }

  if(!fs.existsSync(logDir)){
    fs.mkdirSync(logDir, { recursive: true });
  }

  const time = new Date().toLocaleTimeString();
  const entry = `${time} - ${event}\n`;
  fs.appendFileSync(logFile, entry);
}

let settings = {};

function loadSettings(){
  try{
    const data = fs.readFileSync(path.join(__dirname,'settings.json'));
    settings = JSON.parse(data);
  }catch(err){
    console.error("Failed to load settings:",err);
    settings = {};
  }
}

const assetPath = app.isPackaged
  ? path.join(process.resourcesPath,'assets')
  : path.join(__dirname,'assets');

let lastAIHeartbeat = Date.now();
let win;
let tray;
let ignoringMouse = true;
let pythonProcess = null;

function createWindow(){

  win = new BrowserWindow({
    fullscreen:true,
    transparent:true,
    frame:false,
    alwaysOnTop:true,
    backgroundColor:'#00000000',
    webPreferences:{
      preload: __dirname + '/preload.js',
      contextIsolation:true,
      nodeIntegration:false
    }
  });
win.loadFile(path.join(__dirname,'index.html'));
win.webContents.on('did-finish-load',()=>{
  win.webContents.send('settings-loaded',settings);
});
  win.setIgnoreMouseEvents(true,{forward:true});
  win.setAlwaysOnTop(true,"screen-saver");
  win.setVisibleOnAllWorkspaces(true);
}

function createTray(){

  tray = new Tray(path.join(assetPath,'icon-gray.png'));

  const menu = Menu.buildFromTemplate([
    { label:"Show Overlay", click:()=>win.show() },
    { label:"Hide Overlay", click:()=>win.hide() },
    { type:"separator" },
    { label:"Exit", click:()=>app.quit() }
  ]);

  tray.setToolTip("SmartScreen Privacy Suite");
  tray.setContextMenu(menu);
}

app.whenReady().then(()=>{
loadSettings();
  createWindow();
  createTray();

  // HOTKEYS
  globalShortcut.register('Control+Shift+B',()=>win.webContents.send('hotkey-blur'));
  globalShortcut.register('Control+Shift+F',()=>win.webContents.send('hotkey-focus'));
  globalShortcut.register('Control+Shift+V',()=>win.webContents.send('hotkey-vignette'));

  // emergency mouse unlock
  globalShortcut.register('Control+Shift+U',()=>{
    ignoringMouse=false;
    win.setIgnoreMouseEvents(false,{forward:true});
  });

});

// ---------------- MOUSE CONTROL ----------------
ipcMain.on("set-ignore-mouse",(e,val)=>{
  ignoringMouse=val;
  if(win) win.setIgnoreMouseEvents(val,{forward:true});
});

// ---------------- START AI ----------------
ipcMain.on('start-ai',()=>{

  if(pythonProcess) return;

  const fs = require('fs');
  const isDev = !app.isPackaged;

  let runPath;
  let args=[];

  if(isDev){

    runPath='python';
    args=[path.join(__dirname,'backend','face_detection.py')];

  }else{

    runPath=path.join(process.resourcesPath,'backend','dist','face_detection.exe');

    console.log("Looking for AI at:", runPath);

    if(!fs.existsSync(runPath)){
      console.error("❌ Backend exe NOT FOUND:",runPath);
      if(win) win.webContents.send('ai-failed');
      return;
    }
  }

  console.log("Starting AI:",runPath,args);
  if(win) win.webContents.send('ai-starting');

  pythonProcess = spawn(runPath,args,{
    stdio:['pipe','pipe','pipe'],
    windowsHide:true   // 🔥 important for packaged exe
  });

  pythonProcess.on('spawn',()=>{
    console.log("✅ AI PROCESS STARTED");
  });

  pythonProcess.stdout.on('data',(data)=>{
    lastAIHeartbeat = Date.now();

    const lines=data.toString().split('\n');

    lines.forEach(line=>{
      const msg=line.trim();
      if(!msg || !win) return;

      console.log("AI:",msg);

      if(msg==="INTRUDER"){
  writeLog("INTRUDER");
  win.webContents.send('ai-intruder');
}
      else if(msg==="USER_PRESENT"){
  writeLog("USER_PRESENT");
  win.webContents.send('ai-user');
  win.webContents.send('ai-normal');
}
      else if(msg==="NO_USER"){
  writeLog("NO_USER");
  win.webContents.send('ai-nouser');
  win.webContents.send('ai-normal');
}
    });
  });

  pythonProcess.stderr.on('data',(data)=>{
    console.error("PYTHON ERROR:",data.toString());
  });

  pythonProcess.on('error',(err)=>{
    console.error("❌ FAILED TO START AI:",err);
    pythonProcess=null;
    if(win) win.webContents.send('ai-failed');
  });

  pythonProcess.on('exit',(code)=>{
    console.log("Python exited with code",code);
    pythonProcess=null;
    if(win) win.webContents.send('ai-stopped');

    setTimeout(()=>{
      if(win) win.webContents.send('restart-ai');
    },2000);
  });

});
// ---------------- STOP AI ----------------
ipcMain.on('stop-ai',()=>{

  if(!pythonProcess) return;

  try{
    pythonProcess.stdin.write("STOP\n");
  }catch{}

  setTimeout(()=>{

    if(pythonProcess){
      try{ pythonProcess.kill(); }catch{}
      pythonProcess=null;
      console.log("AI stopped");

      // 🔥 give camera time to release
      setTimeout(()=>{
        if(win) win.webContents.send('ai-stopped');
      },800);

    }

  },500);

});
ipcMain.on('ai-enabled',()=>{
  if(tray){
    tray.setImage(path.join(assetPath,'icon-green.png'));
    tray.setToolTip("SmartScreen Privacy Suite — AI ON");
  }
});

ipcMain.on('ai-disabled',()=>{
  if(tray){
    tray.setImage(path.join(assetPath,'icon-gray.png'));
    tray.setToolTip("SmartScreen Privacy Suite — AI OFF");
  }
});

ipcMain.on('ai-intruder-alert',()=>{
  if(tray){
    tray.setImage(path.join(assetPath,'icon-green.png'));
    tray.setToolTip("SmartScreen Privacy Suite — ⚠ INTRUDER");
  }
});

ipcMain.on('ai-intruder-cleared',()=>{
  if(tray){
    tray.setImage(path.join(assetPath,'icon-green.png'));
    tray.setToolTip("SmartScreen Privacy Suite — AI ON");
  }
});
// ---------------- LOCK SCREEN ----------------
ipcMain.on('lock-screen',()=>{
  exec('rundll32.exe user32.dll,LockWorkStation');
});

// ---------------- CLEAN EXIT ----------------
app.on('will-quit',()=>{

  globalShortcut.unregisterAll();
if(pythonProcess){
  try{
    pythonProcess.stdin.write("STOP\n");
  }catch{}

  pythonProcess.kill();
  pythonProcess=null;
}

});