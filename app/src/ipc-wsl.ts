// Canales de la pantalla de primer arranque en Windows (ver primer-arranque.ts). En Linux, "wsl:estado"
// responde "no-aplica" y la pantalla no aparece.
import type { IpcMain } from "electron";
import { instalar, pendientes, type Pieza } from "./instalar";
import { binario, MODELO_RECOMENDADO, modelos, version } from "./ollama";

const IDS = ["motor", "ollama", "modelo", "runtime", "qwen"];
import { activarWsl, estadoWsl, prepararDistro } from "./wsl";

export function registrarWsl(ipcMain: IpcMain, alInstalar: (reiniciar: boolean) => void) {
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
  // Runtime del modelo, modelo y (Linux) Podman: lo que falta y su instalación, con progreso.
  ipcMain.handle("instalar:estado", () => pendientes());
  // Menú de Ollama de la configuración: ¿corre?, ¿está instalado?, ¿tiene el modelo recomendado?
  ipcMain.handle("ollama:estado", async () => {
    const v = await version();
    const lista = await modelos();
    return { version: v, instalado: v !== null || binario() !== null, modelos: lista.length, recomendado: MODELO_RECOMENDADO, recomendadoInstalado: lista.includes(MODELO_RECOMENDADO) };
  });
  ipcMain.handle("instalar:ejecutar", async (ev, pedidas: unknown) => {
    try {
      const ids = Array.isArray(pedidas) ? pedidas.filter((x): x is Pieza["id"] => IDS.includes(x)) : undefined;
      alInstalar(await instalar((texto) => ev.sender.send("wsl:progreso", texto), undefined, ids));
      return {};
    } catch (e) {
      return { error: (e as Error).message };
    }
  });
}
