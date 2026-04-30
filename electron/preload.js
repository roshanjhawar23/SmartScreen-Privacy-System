const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld("electronAPI",{
 
  // ---------------- MOUSE CONTROL ----------------
  setIgnoreMouse:(v)=>ipcRenderer.send("set-ignore-mouse",v),

  // ---------------- HOTKEYS ----------------
  onHotkeyBlur:(cb)=>ipcRenderer.on('hotkey-blur',cb),
  onHotkeyFocus:(cb)=>ipcRenderer.on('hotkey-focus',cb),
  onHotkeyVignette:(cb)=>ipcRenderer.on('hotkey-vignette',cb),

  // ---------------- AI STATUS EVENTS ----------------
  onAIStarting:(cb)=>ipcRenderer.on('ai-starting',cb),
  onAIStopped:(cb)=>ipcRenderer.on('ai-stopped',cb),
  onAIFailed:(cb)=>ipcRenderer.on('ai-failed',cb),

  onAIIntruder:(cb)=>ipcRenderer.on('ai-intruder',cb),
  onAINormal:(cb)=>ipcRenderer.on('ai-normal',cb),
  onAIUser:(cb)=>ipcRenderer.on('ai-user',cb),
  onAINoUser:(cb)=>ipcRenderer.on('ai-nouser',cb),

  // ---------------- AI CONTROL ----------------
  startAI:()=>ipcRenderer.send('start-ai'),
  stopAI:()=>ipcRenderer.send('stop-ai'),
onSettingsLoaded:(cb)=>ipcRenderer.on('settings-loaded',cb),
  notifyAIEnabled:()=>ipcRenderer.send('ai-enabled'),
  notifyAIDisabled:()=>ipcRenderer.send('ai-disabled'),
  notifyIntruderAlert:()=>ipcRenderer.send('ai-intruder-alert'),
  notifyIntruderCleared:()=>ipcRenderer.send('ai-intruder-cleared'),

  // ---------------- SYSTEM ----------------
  lockScreen:()=>ipcRenderer.send('lock-screen')

});