import { contextBridge, ipcRenderer } from "electron";

// Único puente entre la interfaz (sin acceso a Node) y el proceso principal.
contextBridge.exposeInMainWorld("discalaves", {
  conversaciones: () => ipcRenderer.invoke("conversaciones"),
  modelos: () => ipcRenderer.invoke("modelos"),
  nuevaConversacion: (proveedor: string, modelo: string) => ipcRenderer.invoke("nueva-conversacion", proveedor, modelo),
  historial: (id: string) => ipcRenderer.invoke("historial", id),
  estado: (id: string) => ipcRenderer.invoke("estado", id),
  enviar: (id: string, texto: string) => ipcRenderer.invoke("enviar", id, texto),
  aprobar: (id: string, si: boolean) => ipcRenderer.invoke("aprobar", id, si),
  verPantalla: (id: string, ver: boolean) => ipcRenderer.invoke("pantalla:ver", id, ver),
  controlPantalla: (id: string, activo: boolean) => ipcRenderer.invoke("pantalla:control", id, activo),
  entradaPantalla: (id: string, entrada: unknown) => ipcRenderer.invoke("pantalla:entrada", id, entrada),
  alCambiarEstado: (f: (estado: unknown) => void) => ipcRenderer.on("estado", (_e, estado) => f(estado)),
  alRecibirTrozo: (f: (trozo: unknown) => void) => ipcRenderer.on("trozo", (_e, trozo) => f(trozo)),
  alPaso: (f: (id: string) => void) => ipcRenderer.on("paso", (_e, id) => f(id)),
  alAprobacion: (f: (p: unknown) => void) => ipcRenderer.on("aprobacion", (_e, p) => f(p)),
  alFotograma: (f: (fotograma: unknown) => void) => ipcRenderer.on("pantalla:fotograma", (_e, fotograma) => f(fotograma)),
});
