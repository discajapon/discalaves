import { contextBridge, ipcRenderer } from "electron";

// Único puente entre la interfaz (sin acceso a Node) y el proceso principal.
contextBridge.exposeInMainWorld("discalaves", {
  historial: () => ipcRenderer.invoke("historial"),
  estado: () => ipcRenderer.invoke("estado"),
  enviar: (texto: string) => ipcRenderer.invoke("enviar", texto),
  aprobar: (id: string, si: boolean) => ipcRenderer.invoke("aprobar", id, si),
  verPantalla: (ver: boolean) => ipcRenderer.invoke("pantalla:ver", ver),
  controlPantalla: (activo: boolean) => ipcRenderer.invoke("pantalla:control", activo),
  entradaPantalla: (entrada: unknown) => ipcRenderer.invoke("pantalla:entrada", entrada),
  alCambiarEstado: (f: (estado: unknown) => void) => ipcRenderer.on("estado", (_e, estado) => f(estado)),
  alRecibirTrozo: (f: (texto: string) => void) => ipcRenderer.on("trozo", (_e, texto) => f(texto)),
  alPaso: (f: () => void) => ipcRenderer.on("paso", () => f()),
  alAprobacion: (f: (p: unknown) => void) => ipcRenderer.on("aprobacion", (_e, p) => f(p)),
  alFotograma: (f: (fotograma: unknown) => void) => ipcRenderer.on("pantalla:fotograma", (_e, fotograma) => f(fotograma)),
});
