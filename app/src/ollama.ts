// Ollama como motor local por defecto (decisión del usuario, 2026-10-01): si el usuario ya lo tiene, se usa tal
// cual; si no, se instala aquí sin permisos de administrador (el archivo oficial de la release, descomprimido en
// rutas.ia/ollama) y la app lo arranca y lo apaga ella. Sin Electron: se prueba con node.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { bajar, extraer } from "./instalar";
import { rutas } from "./rutas";

export const OLLAMA = process.env.DISCALAVES_OLLAMA || "http://127.0.0.1:11434";
export const MODELO_RECOMENDADO = "qwen3:8b"; // 5,2 GB, con herramientas; cabe en 8 GB de VRAM
const BASE = process.env.DISCALAVES_OLLAMA_BASE || "https://github.com/ollama/ollama/releases/latest/download"; // la variable es para las pruebas
// ponytail: el hash sale del sha256sum.txt de la misma release (protege de descargas rotas, no de una release
// comprometida); fijar versión y hash aquí cuando se publique un instalador.
const ARCHIVO = process.platform === "win32" ? "ollama-windows-amd64.zip" : `ollama-linux-${process.arch === "arm64" ? "arm64" : "amd64"}.tar.zst`;
const DESTINO = path.join(rutas.ia, "ollama");

export async function version(): Promise<string | null> {
  try {
    const r = await fetch(`${OLLAMA}/api/version`, { signal: AbortSignal.timeout(2000) });
    return r.ok ? ((await r.json()) as { version: string }).version : null;
  } catch {
    return null;
  }
}

// Qué ejecutable hay: la copia que instaló la app, o el `ollama` que el usuario ya tenga en el PATH.
export function binario(): string | null {
  for (const f of [path.join(DESTINO, "bin", "ollama"), path.join(DESTINO, "bin", "ollama.exe"), path.join(DESTINO, "ollama.exe")]) if (fs.existsSync(f)) return f;
  return spawnSync("ollama", ["--version"], { windowsHide: true }).status === 0 ? "ollama" : null;
}

// Los modelos que tiene instalados (vacío si Ollama no responde).
export async function modelos(): Promise<string[]> {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return ((await r.json()) as { models: { name: string }[] }).models.map((m) => m.name);
  } catch {
    return [];
  }
}

export const hashDe = (texto: string, archivo: string) =>
  texto.split("\n").map((l) => l.trim().split(/\s+/)).find(([, f]) => f?.replace(/^\.?\//, "").replace(/^\*/, "") === archivo)?.[0];

export async function instalar(progreso: (texto: string) => void, senal?: AbortSignal) {
  const lista = await fetch(`${BASE}/sha256sum.txt`, { signal: senal ?? AbortSignal.timeout(30_000) });
  if (!lista.ok) throw new Error(`Ollama: no pude leer la lista de hashes (${lista.status})`);
  const hash = hashDe(await lista.text(), ARCHIVO);
  if (!hash) throw new Error(`Ollama: la release no trae ${ARCHIVO}`);
  const f = path.join(rutas.ia, "descargas", ARCHIVO);
  await bajar(`${BASE}/${ARCHIVO}`, f, hash, progreso, "Ollama", senal);
  progreso("Ollama: descomprimiendo…");
  fs.mkdirSync(DESTINO, { recursive: true });
  extraer(f, DESTINO);
  fs.rmSync(f, { force: true });
  if (!binario()) throw new Error("Ollama se descomprimió sin su ejecutable");
}

// Arranca `ollama serve` con los ajustes de Discalaves: contexto de 16k (por defecto recorta a ~4k), dos
// peticiones a la vez y caché KV en 8 bits, como el servidor de llama.cpp.
export function arrancar(registro: string): ChildProcess {
  const bin = binario();
  if (!bin) throw new Error("no encuentro Ollama");
  const log = fs.openSync(registro, "w");
  return spawn(bin, ["serve"], {
    env: {
      ...process.env,
      OLLAMA_HOST: new URL(OLLAMA).host,
      OLLAMA_CONTEXT_LENGTH: "16384",
      OLLAMA_NUM_PARALLEL: "2",
      OLLAMA_FLASH_ATTENTION: "1",
      OLLAMA_KV_CACHE_TYPE: "q8_0",
    },
    stdio: ["ignore", log, log],
    windowsHide: true,
  });
}

let hijo: ChildProcess | undefined; // solo si lo arrancó la app: el Ollama del usuario no se toca
// Deja Ollama funcionando: el que ya corre, o el instalado si se puede arrancar. false si no hay ninguno.
export async function asegurar(registro = path.join(rutas.ia, "ollama.log")): Promise<boolean> {
  if (await version()) return true;
  if (!binario()) return false;
  fs.mkdirSync(path.dirname(registro), { recursive: true });
  hijo = arrancar(registro);
  return esperar();
}
export function apagar() {
  hijo?.kill();
  hijo = undefined;
}

export async function esperar(segundos = 20): Promise<boolean> {
  for (let i = 0; i < segundos * 2; i++) {
    if (await version()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
