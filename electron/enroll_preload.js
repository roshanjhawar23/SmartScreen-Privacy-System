const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('enrollmentAPI', {
  submit: (samples) => ipcRenderer.invoke('enrollment-submit', samples),
  cancel: () => ipcRenderer.send('enrollment-cancel')
});
