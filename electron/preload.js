const { contextBridge, ipcRenderer } = require('electron');

const roleArg = process.argv.find((arg) => arg.startsWith('--smartscreen-role='));
const overlayRole = roleArg === '--smartscreen-role=secondary' ? 'secondary' : 'primary';

contextBridge.exposeInMainWorld('electronAPI', {
  overlayRole,
  publishRenderState:(state)=>ipcRenderer.send('overlay-render-state',state),
  onRenderState:(cb)=>ipcRenderer.on('overlay-render-state',(_,data)=>cb(data)),
  getCaptureSource:()=>ipcRenderer.invoke('get-capture-source'),

  setIgnoreMouse:(v)=>ipcRenderer.send('set-ignore-mouse',v),

  onHotkeyBlur:(cb)=>ipcRenderer.on('hotkey-blur',cb),
  onHotkeyFocus:(cb)=>ipcRenderer.on('hotkey-focus',cb),
  onHotkeyVignette:(cb)=>ipcRenderer.on('hotkey-vignette',cb),

  onAIStarting:(cb)=>ipcRenderer.on('ai-starting',cb),
  onAIReady:(cb)=>ipcRenderer.on('ai-ready',cb),
  onAIStopped:(cb)=>ipcRenderer.on('ai-stopped',cb),
  onAIFailed:(cb)=>ipcRenderer.on('ai-failed',cb),
  onAIIntruder:(cb)=>ipcRenderer.on('ai-intruder',cb),
  onAINormal:(cb)=>ipcRenderer.on('ai-normal',cb),
  onAIUser:(cb)=>ipcRenderer.on('ai-user',cb),
  onAINoUser:(cb)=>ipcRenderer.on('ai-nouser',cb),
  onAIState:(cb)=>ipcRenderer.on('ai-state',(_,data)=>cb(data)),
  onAIPhotoSaved:(cb)=>ipcRenderer.on('ai-photo-saved',(_,data)=>cb(data)),
  onWalkAwayStatus:(cb)=>ipcRenderer.on('walk-away-status',(_,data)=>cb(data)),
  onPrivacyAction:(cb)=>ipcRenderer.on('privacy-action',(_,data)=>cb(data)),

  startAI:()=>ipcRenderer.send('start-ai'),
  stopAI:()=>ipcRenderer.send('stop-ai'),

  onSettingsLoaded:(cb)=>ipcRenderer.on('settings-loaded',cb),

  notifyAIEnabled:()=>ipcRenderer.send('ai-enabled'),
  notifyAIDisabled:()=>ipcRenderer.send('ai-disabled'),
  notifyIntruderAlert:()=>ipcRenderer.send('ai-intruder-alert'),
  notifyIntruderCleared:()=>ipcRenderer.send('ai-intruder-cleared'),

  confirmProtectedAction:(options)=>ipcRenderer.invoke('confirm-protected-action',options),
  getBiometricStatus:()=>ipcRenderer.invoke('get-biometric-status'),
  openEnrollment:()=>ipcRenderer.invoke('open-enrollment'),
  onBiometricUpdated:(cb)=>ipcRenderer.on('biometric-updated',cb),

  lockScreen:(reason)=>ipcRenderer.send('lock-screen',reason),
  getLastIntruderImage:()=>ipcRenderer.invoke('get-last-intruder-image'),
  getSecurityEvents:(limit)=>ipcRenderer.invoke('get-security-events',limit)
});
