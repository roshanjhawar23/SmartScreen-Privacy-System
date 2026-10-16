const { contextBridge, ipcRenderer } = require('electron');

const roleArg = process.argv.find((arg) => arg.startsWith('--smartscreen-role='));
const overlayRole = roleArg === '--smartscreen-role=secondary' ? 'secondary' : 'primary';

contextBridge.exposeInMainWorld('electronAPI', {
  overlayRole,
  publishRenderState:(state)=>ipcRenderer.send('overlay-render-state',state),
  onRenderState:(cb)=>ipcRenderer.on('overlay-render-state',(_,data)=>cb(data)),
  getCaptureSource:()=>ipcRenderer.invoke('get-capture-source'),
  onPresenceCurtain:(cb)=>ipcRenderer.on('presence-curtain',(_,data)=>cb(data)),
  onPresenceGate:(cb)=>ipcRenderer.on('presence-gate',(_,data)=>cb(data)),
  getPresenceGate:()=>ipcRenderer.invoke('get-presence-gate'),
  setPresenceGate:(enabled)=>ipcRenderer.invoke('set-presence-gate',enabled),
  retryProtection:()=>ipcRenderer.send('retry-protection'),
  getProfiles:()=>ipcRenderer.invoke('get-profiles'),
  setProfile:(name)=>ipcRenderer.invoke('set-profile',name),
  onProfileChanged:(cb)=>ipcRenderer.on('profile-changed',(_,data)=>cb(data)),
  reportVideoDevices:(ids)=>ipcRenderer.send('video-devices',ids),
  getDiagnostics:()=>ipcRenderer.invoke('get-diagnostics'),
  exportDiagnostics:()=>ipcRenderer.invoke('export-diagnostics'),
  getEvidenceInfo:()=>ipcRenderer.invoke('get-evidence-info'),
  openEvidenceFolder:()=>ipcRenderer.invoke('open-evidence-folder'),
  getTrustedPeople:()=>ipcRenderer.invoke('get-trusted-people'),
  enrollTrustedPerson:(request)=>ipcRenderer.invoke('enroll-trusted-person',request),
  renameTrustedPerson:(id,name)=>ipcRenderer.invoke('rename-trusted-person',id,name),
  removeTrustedPerson:(id)=>ipcRenderer.invoke('remove-trusted-person',id),
  getProfileDetails:(name)=>ipcRenderer.invoke('get-profile-details',name),
  saveProfile:(name,editable)=>ipcRenderer.invoke('save-profile',name,editable),
  deleteProfile:(name)=>ipcRenderer.invoke('delete-profile',name),
  setAutoSwitch:(enabled)=>ipcRenderer.invoke('set-auto-switch',enabled),
  addWifiRule:()=>ipcRenderer.invoke('add-wifi-rule'),
  removeRule:(id)=>ipcRenderer.invoke('remove-rule',id),
  exportSettings:(passphrase,preferences)=>ipcRenderer.invoke('export-settings',passphrase,preferences),
  importSettings:(passphrase)=>ipcRenderer.invoke('import-settings',passphrase),
  getEnterprisePolicy:()=>ipcRenderer.invoke('get-enterprise-policy'),
  onPolicyRefused:(cb)=>ipcRenderer.on('policy-refused',(_,data)=>cb(data)),

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
  onBiometricUpdated:(cb)=>ipcRenderer.on('biometric-updated',cb),

  lockScreen:(reason)=>ipcRenderer.send('lock-screen',reason),
  getLastIntruderImage:()=>ipcRenderer.invoke('get-last-intruder-image'),
  getSecurityEvents:(limit)=>ipcRenderer.invoke('get-security-events',limit)
});
