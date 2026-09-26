import { contextBridge, ipcRenderer } from "electron";

// Único puente entre la interfaz (sin acceso a Node) y el proceso principal.
contextBridge.exposeInMainWorld("discalaves", {
  historial: () => ipcRenderer.invoke("historial"),
  estado: () => ipcRenderer.invoke("estado"),
  enviar: (texto: string) => ipcRenderer.invoke("enviar", texto),
  alCambiarEstado: (f: (estado: unknown) => void) => ipcRenderer.on("estado", (_e, estado) => f(estado)),
  alRecibirTrozo: (f: (texto: string) => void) => ipcRenderer.on("trozo", (_e, texto) => f(texto)),
});
