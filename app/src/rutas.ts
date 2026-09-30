// Dónde vive cada cosa según el sistema. Es el ÚNICO módulo que decide las rutas de los datos de la app,
// el runtime del modelo, los modelos y las carpetas de trabajo de los empleados; el resto se las pide.
//
// Linux: todo como siempre (runtime y modelos en ~/Documents/IA-discalves, datos donde Electron decide).
// Windows: runtime, modelos y datos en %LOCALAPPDATA%\Discalaves (local, no se sincroniza con el perfil
// itinerante); las carpetas de trabajo viven DENTRO de la distro WSL "discalaves" (montar carpetas de
// Windows en WSL es muy lento) y la app las ve por la ruta de red \\wsl$\discalaves\….
// DISCALAVES_IA sigue eligiendo dónde están el runtime y los modelos en los dos sistemas; DISCALAVES_DATOS, los datos.
import os from "node:os";
import path from "node:path";

export const DISTRO = "discalaves"; // nombre de la distro WSL propia de Discalaves
export const USUARIO_DISTRO = "discalaves"; // usuario sin privilegios de esa distro
export const UID_DISTRO = 1000; // uid fijo de ese usuario (en Windows no hay "uid del usuario del equipo")

export interface Rutas {
  windows: boolean;
  ia: string; // runtime (llama.cpp) y modelos
  servidor: string; // ejecutable de llama-server
  modelo: string;
  datos: string | null; // datos de la app (conversaciones, registros); null = la carpeta por defecto de Electron
  distro: string | null; // dónde guarda Windows el disco de la distro WSL
  trabajo(usuario: string): string; // carpeta de trabajo de un empleado, vista desde la app
  enMotor(carpeta: string): string; // la misma carpeta, vista desde el motor de contenedores
}

export function rutasPara(plataforma: string = process.platform, entorno: NodeJS.ProcessEnv = process.env, inicio = os.homedir()): Rutas {
  const windows = plataforma === "win32";
  const p = windows ? path.win32 : path.posix;
  const base = windows ? p.join(entorno.LOCALAPPDATA || p.join(inicio, "AppData", "Local"), "Discalaves") : "";
  const ia = entorno.DISCALAVES_IA || (windows ? base : p.join(inicio, "Documents", "IA-discalves"));
  const red = `\\\\wsl$\\${DISTRO}`; // \\wsl$\discalaves: el sistema de archivos de la distro visto desde Windows
  return {
    windows,
    ia,
    servidor: p.join(ia, "llama.cpp", windows ? "llama-server.exe" : "llama-server"),
    modelo: p.join(ia, "modelos", "Qwen3.5-9B-Q4_K_M.gguf"),
    datos: entorno.DISCALAVES_DATOS || (windows ? p.join(base, "datos") : null), // DISCALAVES_DATOS: una instancia aparte (pruebas)
    distro: windows ? p.join(base, "wsl") : null,
    trabajo: (usuario) =>
      windows ? `${red}\\home\\${USUARIO_DISTRO}\\trabajo\\${usuario}` : p.join(ia, "trabajo", usuario),
    enMotor: (carpeta) => {
      if (!windows) return carpeta;
      if (!carpeta.toLowerCase().startsWith(red.toLowerCase() + "\\")) throw new Error(`la carpeta ${carpeta} no está dentro de la distro ${DISTRO}`);
      return carpeta.slice(red.length).replaceAll("\\", "/");
    },
  };
}

export const rutas = rutasPara();
