// Especificaciones del equipo para la hoja de configuración: sistema, procesador, memoria y tarjetas NVIDIA
// (nvidia-smi; sin él, la lista de GPU queda vacía). Sin Electron.
import { execFileSync } from "node:child_process";
import os from "node:os";

export interface Especificaciones {
  sistema: string;
  procesador: string;
  nucleos: number;
  ramGB: number;
  gpus: { nombre: string; vramGB: number; usadaGB: number }[];
}

const gb = (mb: number) => Math.round((mb / 1024) * 10) / 10;

export function especificaciones(): Especificaciones {
  let gpus: Especificaciones["gpus"] = [];
  try {
    const salida = execFileSync("nvidia-smi", ["--query-gpu=name,memory.total,memory.used", "--format=csv,noheader,nounits"], { timeout: 3000, windowsHide: true }).toString();
    gpus = salida.trim().split("\n").map((l) => l.split(",").map((x) => x.trim())).filter((c) => c.length === 3).map(([nombre, total, usada]) => ({ nombre, vramGB: gb(+total), usadaGB: gb(+usada) }));
  } catch {
    // sin nvidia-smi: no hay tarjeta NVIDIA que mostrar
  }
  const cpu = os.cpus();
  return {
    sistema: `${os.type() === "Windows_NT" ? "Windows" : os.type()} ${os.release()} (${os.arch()})`,
    procesador: cpu[0]?.model.trim() ?? "desconocido",
    nucleos: cpu.length,
    ramGB: gb(os.totalmem() / 1048576),
    gpus,
  };
}
