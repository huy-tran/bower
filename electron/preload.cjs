const { contextBridge, ipcRenderer } = require('electron')

// The little the page may ask of the desktop app (see app/utils/desktop.ts).
contextBridge.exposeInMainWorld('bowerDesktop', {
  pickFolder: (title, initial) => ipcRenderer.invoke('bower:pick-folder', { title, initial }),
  updateState: () => ipcRenderer.invoke('bower:update-state'),
  onUpdate: (cb) => {
    const listener = (_e, state) => cb(state)
    ipcRenderer.on('bower:update', listener)
    return () => ipcRenderer.removeListener('bower:update', listener)
  },
  installUpdate: () => ipcRenderer.invoke('bower:install-update')
})
