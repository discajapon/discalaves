import { app, BrowserWindow, ipcMain } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFINICIONES, ejecutarHerramienta } from "./herramientas";
import * as navegador from "./navegador";

// ponytail: rutas y puerto fijos para un solo empleado; el instalador y el gestor de modelos los definirán.
const IA = process.env.DISCALAVES_IA ?? path.join(os.homedir(), "Documents", "IA-discalves");
const SERVIDOR = path.join(IA, "llama.cpp", "llama-server");
const MODELO = path.join(IA, "modelos", "Qwen3.5-9B-Q4_K_M.gguf");
const PUERTO = 8089;
const CLAVE = randomBytes(24).toString("hex"); // sin clave, cualquier web abierta en el navegador podría usar el servidor
const CARPETA = path.join(IA, "trabajo", "qwen"); // su computadora aislada la ve como /home/qwen
const CONTEXTO_CARACTERES = 32000; // ponytail: ventana por tamaño (~9k tokens de 16k); resumir cuando las conversaciones crezcan
const MAX_PASOS = 8; // honestidad con modelos pequeños: tras 8 herramientas seguidas se detiene y pregunta
const OLLAMA = "http://127.0.0.1:11434"; // ponytail: dirección por defecto de Ollama; configurable cuando exista el gestor de modelos
const CONTEXTO_OLLAMA = 10000; // Ollama recorta por defecto a ~4k tokens: se le manda menos historial

// Cada conversación es con una IA: qwen (llama-server incluido) o un modelo de Ollama.
interface Conversacion { id: string; nombre: string; proveedor: "qwen" | "ollama"; modelo: string; herramientas: boolean }
interface Modelo { proveedor: "qwen" | "ollama"; modelo: string; detalle: string; herramientas: boolean }
const QWEN: Conversacion = { id: "qwen", nombre: "qwen", proveedor: "qwen", modelo: "Qwen3.5-9B", herramientas: true };

const sistemaConHerramientas = (nombre: string) =>
  `Eres ${nombre}, un empleado de Discalaves que trabaja en la computadora del usuario. ` +
  "Responde en el idioma del usuario, de forma breve y clara. " +
  "Tienes una computadora aislada con terminal, navegador e internet; tu carpeta es /home/qwen. " +
  "Para investigar en la web: buscar_web, luego abrir_pagina con las direcciones más útiles; para formularios: ver_pagina, hacer_clic y escribir_en. " +
  "Cita las direcciones de donde sacas la información. " +
  "Trabaja en pasos cortos y cuenta al usuario qué hiciste y qué encontraste. " +
  "Si no sabes algo, un comando falla o no puedes hacerlo, dilo en vez de inventar. " +
  "Borrar, enviar o pagar siempre requiere la aprobación del usuario: la app se la pide sola; si la rechaza, no insistas. " +
  "Usa sudo solo si es imprescindible: el usuario tendrá que escribir su contraseña.";

const sistemaSoloChat = (nombre: string) =>
  `Eres ${nombre}, un empleado de Discalaves que corre en la computadora del usuario. ` +
  "Responde en el idioma del usuario, de forma breve y clara. " +
  "No tienes herramientas: no puedes navegar por internet, ejecutar comandos ni ver o crear archivos. " +
  "Si te piden algo así, dilo y sugiere hablar con un empleado que sí tenga herramientas, como qwen. " +
  "Si no sabes algo, dilo en vez de inventar.";

interface Llamada { id: string; nombre: string; argumentos: string }
type Mensaje =
  | { de: "yo"; texto: string; t: number }
  | { de: "ia"; texto: string; t: number; llamadas?: Llamada[] }
  | { de: "herramienta"; id: string; nombre: string; argumentos: string; salida: string; codigo: number; t: number };
type Estado =
  | { fase: "cargando" | "listo" | "escribiendo" }
  | { fase: "ejecutando" | "esperando-clave" | "esperando-aprobacion" | "error"; detalle: string };

const carpetaConversaciones = () => path.join(app.getPath("userData"), "conversaciones");
const archivoHistorial = (id: string) => path.join(carpetaConversaciones(), `${id}.json`);
const archivoIndice = () => path.join(carpetaConversaciones(), "indice.json");
let conversaciones: Conversacion[] = [QWEN];
const historiales = new Map<string, Mensaje[]>();
let estadoServidor: Estado = { fase: "cargando" }; // el de llama-server, solo afecta a qwen
const trabajando = new Map<string, Estado>(); // fase de las conversaciones que están respondiendo
let servidor: ChildProcess | undefined;
let ventana: BrowserWindow | undefined;
let saliendo = false;

const estadoDe = (c: Conversacion): Estado => trabajando.get(c.id) ?? (c.proveedor === "qwen" ? estadoServidor : { fase: "listo" });
const avisarEstado = (c: Conversacion) => ventana?.webContents.send("estado", { id: c.id, estado: estadoDe(c) });

function cambiarEstado(c: Conversacion, nuevo: Estado) {
  trabajando.set(c.id, nuevo);
  avisarEstado(c);
}

function cambiarEstadoServidor(nuevo: Estado) {
  estadoServidor = nuevo;
  for (const c of conversaciones) if (c.proveedor === "qwen") avisarEstado(c);
}

function leerConversaciones() {
  try {
    const guardadas: Conversacion[] = JSON.parse(fs.readFileSync(archivoIndice(), "utf8"));
    conversaciones = [QWEN, ...guardadas.filter((c) => c.proveedor === "ollama")];
  } catch {
    conversaciones = [QWEN];
  }
}

function guardarConversaciones() {
  fs.mkdirSync(carpetaConversaciones(), { recursive: true });
  fs.writeFileSync(archivoIndice(), JSON.stringify(conversaciones, null, 2));
}

function historialDe(id: string): Mensaje[] {
  let h = historiales.get(id);
  if (!h) {
    try {
      // los historiales anteriores a las conversaciones múltiples guardaban la IA como "qwen"
      h = (JSON.parse(fs.readFileSync(archivoHistorial(id), "utf8")) as Mensaje[]).map((m) => ((m.de as string) === "qwen" ? { ...m, de: "ia" } : m) as Mensaje);
    } catch {
      h = [];
    }
    historiales.set(id, h);
  }
  return h;
}

function guardarHistorial(id: string) {
  fs.mkdirSync(carpetaConversaciones(), { recursive: true });
  fs.writeFileSync(archivoHistorial(id), JSON.stringify(historialDe(id), null, 2));
}

// Modelos de Ollama con su tamaño y si saben usar herramientas; null si Ollama no responde.
async function modelosOllama(): Promise<Modelo[] | null> {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const { models } = (await r.json()) as { models: { name: string; details?: { parameter_size?: string; quantization_level?: string } }[] };
    const modelos = await Promise.all(
      models.map(async (m) => {
        const info = await fetch(`${OLLAMA}/api/show`, { method: "POST", body: JSON.stringify({ model: m.name }), signal: AbortSignal.timeout(3000) })
          .then((r) => r.json() as Promise<{ capabilities?: string[] }>, () => ({ capabilities: undefined }));
        const capacidades = info.capabilities ?? ["completion"];
        return {
          proveedor: "ollama" as const,
          modelo: m.name,
          detalle: [m.details?.parameter_size, m.details?.quantization_level].filter(Boolean).join(" · "),
          herramientas: capacidades.includes("tools"),
          chat: capacidades.includes("completion"), // los de solo embeddings no conversan
        };
      }),
    );
    return modelos.filter((m) => m.chat).map(({ chat: _, ...m }) => m);
  } catch {
    return null;
  }
}

function iniciarServidor() {
  for (const f of [SERVIDOR, MODELO]) {
    if (!fs.existsSync(f)) return cambiarEstadoServidor({ fase: "error", detalle: `no encuentro ${f}` });
  }
  const log = fs.openSync(path.join(app.getPath("userData"), "llama-server.log"), "w");
  servidor = spawn(SERVIDOR, [
    "-m", MODELO, "--host", "127.0.0.1", "--port", String(PUERTO), "--api-key", CLAVE,
    "-c", "16384", "-np", "1",
    "-ctk", "q8_0", "-ctv", "q8_0", // caché en 8 bits: 16k de contexto (páginas web) casi sin coste de VRAM
    "-fitt", "256", // margen de VRAM bajo: con el de 1 GB por defecto, en 8 GB quedan capas en CPU y va a la mitad de velocidad
    "--reasoning", "off", "--no-webui",
  ], { stdio: ["ignore", log, log] });
  servidor.on("exit", (codigo) => {
    servidor = undefined;
    if (!saliendo) cambiarEstadoServidor({ fase: "error", detalle: `el modelo se detuvo (código ${codigo}); revisa llama-server.log` });
  });
  const esperar = async () => {
    if (!servidor) return;
    const ok = await fetch(`http://127.0.0.1:${PUERTO}/health`).then((r) => r.ok, () => false);
    if (ok) cambiarEstadoServidor({ fase: "listo" });
    else setTimeout(esperar, 1000);
  };
  esperar();
}

interface Delta {
  content?: string;
  tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
}

async function* deltas(respuesta: Response): AsyncGenerator<Delta> {
  const lector = respuesta.body!.pipeThrough(new TextDecoderStream()).getReader();
  let resto = "";
  for (;;) {
    const { value, done } = await lector.read();
    if (done) return;
    const lineas = (resto + value).split("\n");
    resto = lineas.pop()!;
    for (const l of lineas) {
      if (!l.startsWith("data: ") || l === "data: [DONE]") continue;
      const d = JSON.parse(l.slice(6)).choices?.[0]?.delta;
      if (d) yield d;
    }
  }
}

// Últimos mensajes que caben, empezando siempre en un mensaje del usuario para no partir
// una llamada a herramienta de su resultado.
function contexto(c: Conversacion) {
  const historial = historialDe(c.id);
  const limite = c.proveedor === "qwen" ? CONTEXTO_CARACTERES : CONTEXTO_OLLAMA;
  let inicio = 0, caracteres = 0;
  for (let i = historial.length - 1; i >= 0; i--) {
    caracteres += JSON.stringify(historial[i]).length;
    if (historial[i].de !== "yo") continue;
    inicio = i;
    if (caracteres > limite) break;
  }
  return historial.slice(inicio).map((m) => {
    if (m.de === "yo") return { role: "user", content: m.texto };
    if (m.de === "herramienta") return { role: "tool", tool_call_id: m.id, content: `código de salida ${m.codigo}\n${m.salida}` };
    return {
      role: "assistant",
      content: m.texto,
      ...(m.llamadas && { tool_calls: m.llamadas.map((l) => ({ id: l.id, type: "function", function: { name: l.nombre, arguments: l.argumentos } })) }),
    };
  });
}

// Un turno del modelo: el texto se reenvía a la interfaz mientras llega; las llamadas se acumulan.
async function turno(c: Conversacion, interfaz: Electron.WebContents) {
  const url = c.proveedor === "qwen" ? `http://127.0.0.1:${PUERTO}/v1/chat/completions` : `${OLLAMA}/v1/chat/completions`;
  const sistema = c.herramientas ? sistemaConHerramientas(c.nombre) : sistemaSoloChat(c.nombre);
  const r = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${CLAVE}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: c.modelo,
      stream: true,
      ...(c.herramientas && { tools: DEFINICIONES }),
      messages: [{ role: "system", content: sistema }, ...contexto(c)],
    }),
  });
  if (!r.ok) throw new Error(`el servidor respondió ${r.status}: ${(await r.text()).slice(0, 200)}`);
  let texto = "";
  const llamadas: Llamada[] = [];
  for await (const d of deltas(r)) {
    if (d.content) {
      texto += d.content;
      interfaz.send("trozo", { id: c.id, texto: d.content });
    }
    for (const tc of d.tool_calls ?? []) {
      const l = (llamadas[tc.index] ??= { id: "", nombre: "", argumentos: "" });
      if (tc.id) l.id = tc.id;
      l.nombre += tc.function?.name ?? "";
      l.argumentos += tc.function?.arguments ?? "";
    }
  }
  return { texto: texto.trim(), llamadas: llamadas.filter((l) => l?.nombre).map((l, i) => ({ ...l, id: l.id || `llamada-${Date.now()}-${i}` })) };
}

// Aprobación de acciones delicadas: la interfaz muestra la tarjeta y responde con el id.
const aprobaciones = new Map<string, (si: boolean) => void>();
function pedirAprobacion(c: Conversacion, interfaz: Electron.WebContents, descripcion: string): Promise<boolean> {
  const id = randomBytes(8).toString("hex");
  cambiarEstado(c, { fase: "esperando-aprobacion", detalle: descripcion });
  interfaz.send("aprobacion", { id, conversacion: c.id, descripcion });
  return new Promise((resolver) => aprobaciones.set(id, resolver));
}
ipcMain.handle("aprobar", (_e, id: unknown, si: unknown) => {
  aprobaciones.get(String(id))?.(si === true);
  aprobaciones.delete(String(id));
});

// Vista en vivo: solo se transmite mientras la interfaz la pide.
ipcMain.handle("pantalla:ver", async (ev, ver: unknown) => {
  try {
    if (ver === true) await navegador.transmitir((f) => ev.sender.send("pantalla:fotograma", f));
    else await navegador.detenerTransmision();
    return {};
  } catch (e) {
    return { error: (e as Error).message.split("\n")[0] };
  }
});
ipcMain.handle("pantalla:control", (_e, activo: unknown) => navegador.tomarControl(activo === true));
ipcMain.handle("pantalla:entrada", (_e, e: unknown) => {
  const x = e as Record<string, unknown>;
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const str = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max;
  if (x?.tipo === "clic" && num(x.x) && num(x.y)) return navegador.entradaUsuario({ tipo: "clic", x: x.x as number, y: x.y as number });
  if (x?.tipo === "rueda" && num(x.dy)) return navegador.entradaUsuario({ tipo: "rueda", dy: x.dy as number });
  if (x?.tipo === "tecla" && str(x.tecla, 40)) return navegador.entradaUsuario({ tipo: "tecla", tecla: x.tecla as string });
});

const buscar = (id: unknown) => conversaciones.find((c) => c.id === id);

ipcMain.handle("conversaciones", () => conversaciones.map((c) => ({ ...c, estado: estadoDe(c), ultimo: historialDe(c.id).at(-1) })));
ipcMain.handle("historial", (_e, id: unknown) => (buscar(id) ? historialDe(String(id)) : []));
ipcMain.handle("estado", (_e, id: unknown) => {
  const c = buscar(id);
  return c ? estadoDe(c) : { fase: "error", detalle: "conversación desconocida" };
});
ipcMain.handle("modelos", async () => {
  const ollama = await modelosOllama();
  const qwen: Modelo = { proveedor: "qwen", modelo: QWEN.modelo, detalle: "incluido · 9B · Q4_K_M", herramientas: true };
  return { modelos: [qwen, ...(ollama ?? [])], ollama: ollama !== null };
});

// Abre la conversación con esa IA; si ya existe, devuelve la misma (una por IA).
ipcMain.handle("nueva-conversacion", async (_e, proveedor: unknown, modelo: unknown) => {
  if (proveedor === "qwen") return { id: QWEN.id };
  const m = (await modelosOllama())?.find((m) => m.modelo === modelo); // la interfaz no decide qué existe
  if (!m) return { error: "ese modelo ya no está en Ollama" };
  const id = `ollama-${m.modelo.replace(/[^a-z0-9._-]/gi, "_")}`;
  if (!buscar(id)) {
    conversaciones.push({ id, nombre: m.modelo.replace(/:latest$/, ""), proveedor: "ollama", modelo: m.modelo, herramientas: m.herramientas });
    guardarConversaciones();
  }
  return { id };
});

ipcMain.handle("enviar", async (ev, id: unknown, entrada: unknown) => {
  const c = buscar(id);
  const texto = typeof entrada === "string" ? entrada.trim().slice(0, 8000) : "";
  if (!c || !texto) return { error: "mensaje vacío" };
  if (estadoDe(c).fase !== "listo") return { error: `${c.nombre} no está listo` };
  // ponytail: una conversación trabajando a la vez (la VRAM de 8 GB no da para más); cola real cuando haya varios empleados
  const otra = conversaciones.find((o) => trabajando.has(o.id));
  if (otra) return { error: `${otra.nombre} está trabajando; espera a que termine` };

  const historial = historialDe(c.id);
  historial.push({ de: "yo", texto, t: Date.now() });
  guardarHistorial(c.id);
  try {
    for (let paso = 0; paso < MAX_PASOS; paso++) {
      cambiarEstado(c, { fase: "escribiendo" });
      const { texto, llamadas } = await turno(c, ev.sender);
      if (texto || llamadas.length) historial.push({ de: "ia", texto, t: Date.now(), ...(llamadas.length && { llamadas }) });
      guardarHistorial(c.id);
      if (!llamadas.length) return {};
      for (const l of llamadas) {
        const r = await ejecutarHerramienta(
          { carpeta: CARPETA, avisar: (fase, detalle) => cambiarEstado(c, { fase, detalle }), aprobar: (d) => pedirAprobacion(c, ev.sender, d) },
          l.nombre,
          l.argumentos,
        );
        historial.push({ de: "herramienta", ...l, ...r, t: Date.now() });
        guardarHistorial(c.id);
      }
      ev.sender.send("paso", c.id);
    }
    historial.push({ de: "ia", texto: `me detuve después de ${MAX_PASOS} pasos para que revises cómo va. ¿sigo?`, t: Date.now() });
    guardarHistorial(c.id);
    return {};
  } catch (e) {
    const detalle = c.proveedor === "ollama" && (e as Error).message === "fetch failed" ? "Ollama no responde; ¿está en marcha?" : (e as Error).message;
    return { error: `no pude obtener respuesta: ${detalle}` };
  } finally {
    trabajando.delete(c.id);
    avisarEstado(c);
  }
});

function crearVentana() {
  ventana = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    title: "Discalaves",
    backgroundColor: "#FFFFFF",
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  ventana.setMenuBarVisibility(false);
  ventana.loadFile(path.join(__dirname, "..", "index.html"));
}

// Una sola instancia: una segunda no podría usar el puerto de llama-server.
const primera = app.requestSingleInstanceLock();
if (!primera) app.quit();
app.on("second-instance", () => {
  if (ventana?.isMinimized()) ventana.restore();
  ventana?.focus();
});

app.whenReady().then(() => {
  if (!primera) return;
  navegador.configurarNavegador({ ia: IA, carpeta: CARPETA, datos: app.getPath("userData") });
  leerConversaciones();
  iniciarServidor();
  crearVentana();
});
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
  saliendo = true;
  servidor?.kill();
  void navegador.cerrarNavegador(); // la caja muere igualmente con la app (--die-with-parent)
});
