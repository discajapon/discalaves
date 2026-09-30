// Instalación de lo que Discalaves necesita y no viene en el instalador: el runtime del modelo (llama.cpp), el
// modelo (Qwen 3.5 9B) y, en Linux, el motor de contenedores (Podman). Todo se descarga una vez, con sha256
// fijado y reanudable, dentro de rutas.ia. Sin Electron: se prueba con node (prueba-unidad.ts).
// En Windows el motor lo prepara wsl.ts (distro propia con Podman); aquí solo van runtime y modelo.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rutas } from "./rutas";

export interface Pieza { id: "motor" | "runtime" | "modelo"; nombre: string; mb: number }
export type Progreso = (texto: string) => void;
interface Archivo { url: string; sha256: string; mb: number }

const LLAMA = "b11191"; // release fijado de llama.cpp; los hashes salen de la API de GitHub de ese release
const GH = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA}`;
const MODELO: Archivo = {
  url: "https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/main/Qwen3.5-9B-Q4_K_M.gguf",
  sha256: "03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8", // el mismo que publica Hugging Face (x-linked-etag)
  mb: 5417,
};
// Runtime por sistema y tarjeta: CUDA (NVIDIA) con sus bibliotecas, o Vulkan (cualquier otra GPU).
const RUNTIME: Record<string, Archivo[]> = {
  "linux-cuda": [
    { url: `${GH}/llama-${LLAMA}-bin-ubuntu-cuda-12.8-x64.tar.gz`, sha256: "a05fcd8a9582607131dbf2d2779a11fbb992735b3c6c5216f15d1b775cc08e07", mb: 163 },
    { url: `${GH}/cudart-llama-${LLAMA}-bin-ubuntu-cuda-12.8-x64.tar.gz`, sha256: "5e04491ade388bbb7b69d4d9ccc9f64c8ddfe595bee30bcc0942e8d2777c5ebe", mb: 567 },
  ],
  "linux-vulkan": [{ url: `${GH}/llama-${LLAMA}-bin-ubuntu-vulkan-x64.tar.gz`, sha256: "0e2018de56a2e23dcdf71c5a4f7ee01889820c29bcb7a7d5db9318bc7c2c6251", mb: 30 }],
  "win32-cuda": [
    { url: `${GH}/llama-${LLAMA}-bin-win-cuda-12.4-x64.zip`, sha256: "6df7f06043aecfddeac6487432db2c94b88f7974ee7952e399f26dfe189f6010", mb: 250 },
    { url: `${GH}/cudart-llama-bin-win-cuda-12.4-x64.zip`, sha256: "8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6", mb: 373 },
  ],
  "win32-vulkan": [{ url: `${GH}/llama-${LLAMA}-bin-win-vulkan-x64.zip`, sha256: "0ee4820b0af2b4a588f2605135f58d1450d9e7e1b89b1296110ef2a26ccb9acf", mb: 31 }],
};

export const hayNvidia = () => spawnSync("nvidia-smi", ["-L"], { windowsHide: true }).status === 0;
const hayMotor = () => ["docker", "podman"].some((m) => spawnSync(m, ["info"], { windowsHide: true }).status === 0);
export const hayDocker = () => spawnSync("docker", ["info"], { windowsHide: true }).status === 0;

export function pendientes(): Pieza[] {
  const p: Pieza[] = [];
  if (process.platform === "linux" && !hayMotor()) p.push({ id: "motor", nombre: "Podman, el motor de las computadoras de los empleados (pide tu contraseña de administrador)", mb: 100 });
  if (!fs.existsSync(rutas.servidor)) {
    const mb = RUNTIME[clave()]?.reduce((s, a) => s + a.mb, 0) ?? 0;
    p.push({ id: "runtime", nombre: `llama.cpp, el motor del modelo (${hayNvidia() ? "CUDA" : "Vulkan"})`, mb });
  }
  if (!fs.existsSync(rutas.modelo)) p.push({ id: "modelo", nombre: "Qwen 3.5 9B, el modelo que piensa", mb: MODELO.mb });
  return p;
}
const clave = () => `${process.platform}-${hayNvidia() ? "cuda" : "vulkan"}`;

const sha256 = (f: string) =>
  new Promise<string>((ok, mal) => {
    const h = createHash("sha256");
    fs.createReadStream(f).on("data", (d) => h.update(d)).on("end", () => ok(h.digest("hex"))).on("error", mal);
  });

// Descarga reanudable (archivo .parte + Range) y verificada. Si el hash no coincide, se borra y falla.
export async function bajar(url: string, destino: string, esperado: string, progreso: Progreso, etiqueta: string, senal?: AbortSignal) {
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const parte = destino + ".parte";
  let ya = fs.existsSync(parte) ? fs.statSync(parte).size : 0;
  const r = await fetch(url, { headers: ya ? { Range: `bytes=${ya}-` } : {}, signal: senal });
  if (r.status !== 416) {
    if (!r.ok || !r.body) throw new Error(`${etiqueta}: el servidor respondió ${r.status}`);
    if (r.status === 200) ya = 0; // ignoró el Range: desde cero
    const total = ya + Number(r.headers.get("content-length") ?? 0);
    const fuera = fs.createWriteStream(parte, { flags: ya ? "a" : "w" });
    let hecho = ya, ultimo = 0;
    for await (const trozo of r.body as unknown as AsyncIterable<Uint8Array>) {
      if (!fuera.write(trozo)) await new Promise<void>((x) => fuera.once("drain", () => x()));
      hecho += trozo.length;
      if (Date.now() - ultimo > 1000) { ultimo = Date.now(); progreso(`${etiqueta}: ${total ? Math.floor((hecho / total) * 100) + " %" : Math.floor(hecho / 1e6) + " MB"}`); }
    }
    await new Promise<void>((x) => fuera.end(() => x()));
  }
  progreso(`${etiqueta}: verificando…`);
  if ((await sha256(parte)) !== esperado) {
    fs.rmSync(parte, { force: true });
    throw new Error(`${etiqueta}: el archivo descargado no coincide con el esperado (se borró; vuelve a intentarlo)`);
  }
  fs.renameSync(parte, destino);
}

// tar de Linux y el bsdtar de Windows 10+ leen .tar.gz y .zip. Si el archivo trae una sola carpeta, se aplana.
export function extraer(archivo: string, destino: string) {
  const tmp = fs.mkdtempSync(path.join(destino, ".x-"));
  const r = spawnSync("tar", ["-xf", archivo, "-C", tmp], { windowsHide: true });
  if (r.status !== 0) throw new Error(`no se pudo descomprimir ${path.basename(archivo)}: ${r.stderr?.toString().trim() || r.error?.message}`);
  let raiz = tmp;
  const dentro = fs.readdirSync(tmp);
  if (dentro.length === 1 && fs.statSync(path.join(tmp, dentro[0])).isDirectory()) raiz = path.join(tmp, dentro[0]);
  fs.cpSync(raiz, destino, { recursive: true, force: true, verbatimSymlinks: true });
  fs.rmSync(tmp, { recursive: true, force: true });
}

async function instalarRuntime(progreso: Progreso, senal?: AbortSignal) {
  const archivos = RUNTIME[clave()];
  if (!archivos) throw new Error(`no hay llama.cpp preparado para ${clave()}`);
  const dest = path.join(rutas.ia, "llama.cpp");
  fs.mkdirSync(dest, { recursive: true });
  for (const a of archivos) {
    const f = path.join(rutas.ia, "descargas", path.basename(a.url));
    await bajar(a.url, f, a.sha256, progreso, "llama.cpp", senal);
    progreso("llama.cpp: descomprimiendo…");
    extraer(f, dest);
    fs.rmSync(f, { force: true });
  }
  fs.writeFileSync(path.join(dest, "VERSION"), `${LLAMA}-${clave()}\n`);
  if (!fs.existsSync(rutas.servidor)) throw new Error("llama.cpp se descomprimió sin llama-server");
}

// Linux: Podman con el gestor de paquetes de la distro, por polkit (una sola petición de contraseña). Incluye
// uidmap y el rango de subuids que Podman rootless necesita si el usuario aún no lo tiene.
function instalarMotor(progreso: Progreso) {
  const gestores: [string, string][] = [
    ["apt-get", "apt-get update && apt-get install -y podman uidmap"],
    ["dnf", "dnf install -y podman"],
    ["pacman", "pacman -S --noconfirm podman"],
    ["zypper", "zypper --non-interactive install podman"],
  ];
  const g = gestores.find(([bin]) => spawnSync("which", [bin]).status === 0);
  if (!g) throw new Error("no reconozco el gestor de paquetes de tu sistema: instala Podman a mano y vuelve a abrir Discalaves");
  const u = os.userInfo().username;
  const orden = `${g[1]} && (grep -q '^${u}:' /etc/subuid || usermod --add-subuids 100000-165535 --add-subgids 100000-165535 ${u})`;
  return new Promise<void>((ok, mal) => {
    progreso("Podman: esperando tu contraseña de administrador…");
    const h = spawn("pkexec", ["sh", "-c", orden], { stdio: ["ignore", "pipe", "pipe"] });
    let cola = "";
    const linea = (d: Buffer) => { cola = (cola + d).slice(-400); progreso(`Podman: ${cola.trim().split("\n").at(-1)?.slice(0, 80)}`); };
    h.stdout.on("data", linea); h.stderr.on("data", linea);
    h.on("error", (e) => mal(new Error(`no se pudo pedir permiso (pkexec): ${e.message}`)));
    h.on("close", (c) => (c === 0 ? ok() : mal(new Error(c === 126 || c === 127 ? "no diste el permiso de administrador" : `la instalación de Podman falló (código ${c}): ${cola.trim().split("\n").at(-1)}`))));
  });
}

// Instala lo que falte. Devuelve true si hay que reiniciar la app (cambió el motor de contenedores).
export async function instalar(progreso: Progreso, senal?: AbortSignal): Promise<boolean> {
  const falta = pendientes().map((p) => p.id);
  if (falta.includes("motor")) await instalarMotor(progreso);
  if (falta.includes("runtime")) await instalarRuntime(progreso, senal);
  if (falta.includes("modelo")) await bajar(MODELO.url, rutas.modelo, MODELO.sha256, progreso, "Modelo", senal);
  return falta.includes("motor");
}
