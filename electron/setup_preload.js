const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('setupAPI', {
  status: () => ipcRenderer.invoke('device-setup-status'),
  complete: () => ipcRenderer.invoke('device-setup-complete')
});
