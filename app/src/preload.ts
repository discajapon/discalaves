import { contextBridge, ipcRenderer } from "electron";

// Único puente entre la interfaz (sin acceso a Node) y el proceso principal.
contextBridge.exposeInMainWorld("discalaves", {
  // Windows: primer arranque (WSL). En Linux, wslEstado responde "no-aplica".
  wslEstado: () => ipcRenderer.invoke("wsl:estado"),
  wslActivar: () => ipcRenderer.invoke("wsl:activar"),
  wslPreparar: () => ipcRenderer.invoke("wsl:preparar"),
  alProgresoWsl: (f: (texto: string) => void) => ipcRenderer.on("wsl:progreso", (_e, texto) => f(texto)),
  conversaciones: () => ipcRenderer.invoke("conversaciones"),
  modelos: () => ipcRenderer.invoke("modelos"),
  nuevaConversacion: (proveedor: string, modelo: string) => ipcRenderer.invoke("nueva-conversacion", proveedor, modelo),
  historial: (id: string) => ipcRenderer.invoke("historial", id),
  estado: (id: string) => ipcRenderer.invoke("estado", id),
  enviar: (id: string, texto: string) => ipcRenderer.invoke("enviar", id, texto),
  detener: (id: string) => ipcRenderer.invoke("detener", id),
  aprobar: (id: string, si: boolean) => ipcRenderer.invoke("aprobar", id, si),
  verPantalla: (id: string, ver: boolean) => ipcRenderer.invoke("pantalla:ver", id, ver),
  controlPantalla: (id: string, activo: boolean) => ipcRenderer.invoke("pantalla:control", id, activo),
  modoLibre: (id: string, activo: boolean) => ipcRenderer.invoke("modo-libre", id, activo),
  alCambiarEstado: (f: (estado: unknown) => void) => ipcRenderer.on("estado", (_e, estado) => f(estado)),
  alRecibirTrozo: (f: (trozo: unknown) => void) => ipcRenderer.on("trozo", (_e, trozo) => f(trozo)),
  alPaso: (f: (id: string) => void) => ipcRenderer.on("paso", (_e, id) => f(id)),
  alAprobacion: (f: (p: unknown) => void) => ipcRenderer.on("aprobacion", (_e, p) => f(p)),
});
