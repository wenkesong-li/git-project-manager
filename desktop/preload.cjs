'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('gitpmDesktop', {
  writeClipboard: text => ipcRenderer.invoke('gitpm:clipboard', text),
  getAppInfo: () => ipcRenderer.invoke('gitpm:info'),
  setPreferences: patch => ipcRenderer.invoke('gitpm:preferences', patch),
  openDataFolder: () => ipcRenderer.invoke('gitpm:data-folder'),
  saveConfiguration: content => ipcRenderer.invoke('gitpm:save-configuration', content),
  loadConfiguration: () => ipcRenderer.invoke('gitpm:load-configuration'),
  checkForUpdates: () => ipcRenderer.invoke('gitpm:update-check'),
  downloadUpdate: () => ipcRenderer.invoke('gitpm:update-download'),
  installUpdate: () => ipcRenderer.invoke('gitpm:update-install'),
  onUpdate: callback => { const listener = (_, state) => callback(state); ipcRenderer.on('gitpm:update', listener); return () => ipcRenderer.removeListener('gitpm:update', listener); },
});
