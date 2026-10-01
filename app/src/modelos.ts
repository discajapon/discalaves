// Gestor de modelos: busca modelos GGUF en Hugging Face, dice si caben en la VRAM de la GPU y los instala en
// Ollama (`hf.co/<repo>:<cuantización>`, la forma oficial de Ollama de bajar un GGUF de Hugging Face), igual que
// un nombre de su biblioteca (llama3.2:3b) o un .gguf del disco. Lo instalado se asigna a cualquier empleado
// como "ollama:<modelo>". El runtime incluido (llama-server) sigue con Qwen 3.5 9B.
// Sin Electron: se prueba con node.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const HF = "https://huggingface.co";
const GB = 1024 ** 3;

export interface Repo { repo: string; descargas: number; meGusta: number }
export interface Version { cuant: string; tamano: number; nombre: string; vram: number } // nombre: el que se le pasa a Ollama
export interface Progreso { estado: string; total?: number; completado?: number }

// Nombres que Ollama acepta (biblioteca, hf.co/...): nada que pueda colarse en una ruta o una opción.
export const nombreValido = (n: string) => n.length <= 200 && /^[A-Za-z0-9][\w.:\/-]*$/.test(n) && !n.includes("..");

export async function buscar(texto: string): Promise<Repo[]> {
  const u = `${HF}/api/models?search=${encodeURIComponent(texto)}&filter=gguf&sort=downloads&limit=20`;
  const r = await fetch(u, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`Hugging Face respondió ${r.status}`);
  return ((await r.json()) as { id: string; downloads?: number; likes?: number }[]).map((m) => ({ repo: m.id, descargas: m.downloads ?? 0, meGusta: m.likes ?? 0 }));
}

// Las cuantizaciones de un repositorio (un archivo .gguf cada una). Fuera: proyectores de visión (mmproj) y
// modelos partidos en varios archivos (Ollama no los baja por hf.co).
export async function versiones(repo: string): Promise<Version[]> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("repositorio no válido");
  const r = await fetch(`${HF}/api/models/${repo}?blobs=true`, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`Hugging Face respondió ${r.status}`);
  const { siblings = [] } = (await r.json()) as { siblings?: { rfilename: string; size?: number }[] };
  return siblings
    .flatMap((s) => {
      const cuant = cuantDe(s.rfilename);
      return cuant && s.size ? [{ cuant, tamano: s.size, nombre: `hf.co/${repo}:${cuant}`, vram: vramNecesaria(s.size) }] : [];
    })
    .sort((a, b) => a.tamano - b.tamano);
}

// La cuantización de un archivo (Qwen3.5-9B-UD-Q4_K_XL.gguf → UD-Q4_K_XL): es la etiqueta que Ollama usa en hf.co.
export function cuantDe(archivo: string): string | null {
  if (!archivo.toLowerCase().endsWith(".gguf") || /mmproj|-\d{5}-of-\d{5}|\//i.test(archivo)) return null;
  return archivo.match(/[-_.]((?:UD-)?(?:I?Q\d\w*|BF16|F16|F32))\.gguf$/i)?.[1] ?? null;
}

// ponytail: VRAM necesaria = archivo + 1,5 GB (contexto y búferes de cálculo); medir por arquitectura si hace falta.
export const vramNecesaria = (bytes: number) => bytes + 1.5 * GB;

// VRAM de la GPU NVIDIA (total y libre ahora, en bytes); null sin NVIDIA.
export function vram(): Promise<{ total: number; libre: number; nombre: string } | null> {
  return new Promise((resolver) =>
    execFile("nvidia-smi", ["--query-gpu=name,memory.total,memory.free", "--format=csv,noheader,nounits"], { timeout: 5000, windowsHide: true }, (e, salida) => {
      const c = !e && salida.split("\n")[0]?.split(",").map((x) => x.trim());
      resolver(c && c.length === 3 ? { nombre: c[0], total: Number(c[1]) * 1024 ** 2, libre: Number(c[2]) * 1024 ** 2 } : null);
    }),
  );
}

// Respuestas de Ollama en streaming: una línea JSON por evento.
async function porLineas(r: Response, alProgreso: (p: Progreso) => void) {
  if (!r.ok) throw new Error(`Ollama respondió ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const lector = r.body!.pipeThrough(new TextDecoderStream()).getReader();
  let resto = "";
  for (;;) {
    const { value, done } = await lector.read();
    if (done) return;
    const lineas = (resto + value).split("\n");
    resto = lineas.pop()!;
    for (const l of lineas.filter(Boolean)) {
      const e = JSON.parse(l) as { status?: string; total?: number; completed?: number; error?: string };
      if (e.error) throw new Error(e.error);
      alProgreso({ estado: e.status ?? "", total: e.total, completado: e.completed });
    }
  }
}

export async function instalar(ollama: string, nombre: string, alProgreso: (p: Progreso) => void, senal: AbortSignal) {
  if (!nombreValido(nombre)) throw new Error("nombre de modelo no válido");
  await porLineas(await fetch(`${ollama}/api/pull`, { method: "POST", body: JSON.stringify({ model: nombre, stream: true }), signal: senal }), alProgreso);
}

export async function quitar(ollama: string, nombre: string) {
  if (!nombreValido(nombre)) throw new Error("nombre de modelo no válido");
  const r = await fetch(`${ollama}/api/delete`, { method: "DELETE", body: JSON.stringify({ model: nombre }) });
  if (!r.ok) throw new Error(`Ollama respondió ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

// Un .gguf del disco: se sube a Ollama (blob por su sha256) y se crea un modelo con él. Devuelve su nombre.
export async function desdeArchivo(ollama: string, ruta: string, alProgreso: (p: Progreso) => void, senal: AbortSignal): Promise<string> {
  const tamano = fs.statSync(ruta).size;
  const hash = createHash("sha256");
  let leidos = 0;
  for await (const trozo of fs.createReadStream(ruta, { signal: senal })) {
    hash.update(trozo);
    leidos += trozo.length;
    alProgreso({ estado: "comprobando el archivo", total: tamano, completado: leidos });
  }
  const digest = `sha256:${hash.digest("hex")}`;
  if ((await fetch(`${ollama}/api/blobs/${digest}`, { method: "HEAD", signal: senal })).status !== 200) {
    alProgreso({ estado: "copiando a Ollama", total: tamano, completado: 0 });
    const r = await fetch(`${ollama}/api/blobs/${digest}`, {
      method: "POST", signal: senal, duplex: "half",
      body: fs.createReadStream(ruta) as unknown as ReadableStream,
    } as RequestInit);
    if (!r.ok) throw new Error(`Ollama respondió ${r.status} al copiar el archivo`);
  }
  const base = path.basename(ruta, path.extname(ruta)).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[^a-z0-9]+/, "").slice(0, 60) || "modelo";
  const nombre = `${base}:local`;
  await porLineas(
    await fetch(`${ollama}/api/create`, { method: "POST", signal: senal, body: JSON.stringify({ model: nombre, files: { [path.basename(ruta)]: digest }, stream: true }) }),
    alProgreso,
  );
  return nombre;
}
