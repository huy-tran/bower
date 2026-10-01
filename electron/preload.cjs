const { contextBridge, ipcRenderer } = require('electron')

// The little the page may ask of the desktop app (see app/utils/desktop.ts).
contextBridge.exposeInMainWorld('bowerDesktop', {
  pickFolder: (title, initial) => ipcRenderer.invoke('bower:pick-folder', { title, initial })
})
