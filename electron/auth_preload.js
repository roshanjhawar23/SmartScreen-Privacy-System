const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('authAPI', {
  status: () => ipcRenderer.invoke('auth-status'),
  register: (username, password) => ipcRenderer.invoke('auth-register', { username, password }),
  login: (username, password) => ipcRenderer.invoke('auth-login', { username, password })
});
