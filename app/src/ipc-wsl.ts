// Canales de la pantalla de primer arranque en Windows (ver primer-arranque.ts). En Linux, "wsl:estado"
// responde "no-aplica" y la pantalla no aparece.
import type { IpcMain } from "electron";
import { activarWsl, estadoWsl, prepararDistro } from "./wsl";

export function registrarWsl(ipcMain: IpcMain) {
  ipcMain.handle("wsl:estado", () => estadoWsl());
  // Solo se llama cuando el usuario pulsó "Preparar" en la pantalla: nunca se activa nada sin su permiso.
  ipcMain.handle("wsl:activar", () => activarWsl());
  ipcMain.handle("wsl:preparar", async (ev) => {
    try {
      await prepararDistro((texto) => ev.sender.send("wsl:progreso", texto));
      return {};
    } catch (e) {
      return { error: (e as Error).message };
    }
  });
}
