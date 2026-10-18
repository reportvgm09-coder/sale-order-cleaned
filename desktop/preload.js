// What the setup window may ask of the desktop shell - nothing more.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("setup", {
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  save: (form) => ipcRenderer.invoke("save-settings", form),
});
