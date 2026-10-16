const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('enrollmentAPI', {
  submit: (samples) => ipcRenderer.invoke('enrollment-submit', samples),
  getTarget: () => ipcRenderer.invoke('get-enrollment-target'),
  cancel: () => ipcRenderer.send('enrollment-cancel')
});
