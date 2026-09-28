import { app, BrowserWindow, ipcMain, session } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DEFINICIONES, ejecutarHerramienta } from "./herramientas";
import { apagarTodas, computadoraDe, responde, type Computadora } from "./computadora";
import { navegadorDe } from "./navegador";
import { rutas } from "./rutas";

// Rutas según el sistema (Linux o Windows): ver rutas.ts. ponytail: puerto fijo para un solo servidor.
const SERVIDOR = rutas.servidor;
const MODELO = rutas.modelo;
if (rutas.datos) app.setPath("userData", rutas.datos); // Windows: datos locales, antes de usar userData
const PUERTO = 8089;
const CLAVE = randomBytes(24).toString("hex"); // sin clave, cualquier web abierta en el navegador podría usar el servidor
const CONTEXTO_CARACTERES = 32000; // ponytail: ventana por tamaño (~9k tokens de 16k); resumir cuando las conversaciones crezcan
// Sin límite de pasos (decisión del usuario, 2026-09-27): la IA trabaja hasta acabar. Frenos: el botón
// Detener y la detección de repeticiones (misma llamada con los mismos argumentos).
const AVISO_REPETICION = 3; // a la 3.ª vez no se ejecuta: se le dice que cambie de enfoque
const MAX_REPETICIONES = 5; // a la 5.ª se detiene y lo explica
const OLLAMA = "http://127.0.0.1:11434"; // ponytail: dirección por defecto de Ollama; configurable cuando exista el gestor de modelos
const CONTEXTO_OLLAMA = 10000; // Ollama recorta por defecto a ~4k tokens: se le manda menos historial

// Cada conversación es con una IA: qwen (llama-server incluido) o un modelo de Ollama.
// libre: "modo libre", decisión del usuario por IA (apagado por defecto): no pide aprobación ni pregunta qué hacer.
interface Conversacion { id: string; nombre: string; proveedor: "qwen" | "ollama"; modelo: string; herramientas: boolean; libre?: boolean }
interface Modelo { proveedor: "qwen" | "ollama"; modelo: string; detalle: string; herramientas: boolean }
const QWEN: Conversacion = { id: "qwen", nombre: "qwen", proveedor: "qwen", modelo: "Qwen3.5-9B", herramientas: true };

// Computadora propia de cada IA: su contenedor (se enciende la primera vez que lo usa), con la carpeta
// IA-discalves/trabajo/<usuario> como /home/<usuario>, y el Chromium de su escritorio.
function computadora(c: Conversacion) {
  let usuario = c.id === QWEN.id ? "qwen" : c.nombre.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "ia";
  if (c.id !== QWEN.id && usuario === "qwen") usuario = "qwen-ollama"; // un modelo de Ollama llamado qwen no comparte con el incluido
  const carpeta = rutas.trabajo(usuario); // la crea la computadora al encenderse (en Windows vive dentro de WSL)
  const pc = computadoraDe(carpeta, usuario);
  return { usuario, carpeta, computadora: pc, navegador: navegadorDe(pc) };
}

const sistemaConHerramientas = (nombre: string, usuario: string, libre: boolean) =>
  `Eres ${nombre}, un empleado de Discalaves que trabaja en la computadora del usuario. ` +
  "Responde en el idioma del usuario, de forma breve y clara. " +
  `Tienes tu propia computadora aislada (Debian con escritorio) con terminal, navegador e internet; tu carpeta es /home/${usuario}. ` +
  "Para investigar en la web: buscar_web, luego abrir_pagina con las direcciones más útiles; para formularios: ver_pagina, hacer_clic y escribir_en. " +
  "Cita las direcciones de donde sacas la información. " +
  "Trabaja hasta terminar la tarea completa, sin pedir permiso para continuar; entre paso y paso cuenta en una frase qué hiciste y qué encontraste. " +
  "Si algo falla, prueba otro camino en vez de repetir lo mismo. " +
  "Si no sabes algo, un comando falla o no puedes hacerlo, dilo en vez de inventar. " +
  "Para instalar programas o tocar el sistema, empieza el comando con sudo (eres root en tu computadora, no en la del usuario); " +
  "para instalar: sudo apt-get update && sudo apt-get install -y <paquete>. " +
  (libre
    ? "Trabajas en modo libre: actúa por tu cuenta, no pidas confirmación ni preguntes qué hacer; decide tú y termina la tarea. " +
      "Pregunta solo si te falta un dato imprescindible que no puedes averiguar."
    : "Borrar, enviar o pagar siempre requiere la aprobación del usuario: la app se la pide sola; si la rechaza, no insistas.");

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
  | { fase: "ejecutando" | "esperando-aprobacion" | "error"; detalle: string };

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
    const qwen = guardadas.find((c) => c.id === QWEN.id);
    conversaciones = [{ ...QWEN, libre: qwen?.libre === true }, ...guardadas.filter((c) => c.proveedor === "ollama")];
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
    const ok = await responde(`http://127.0.0.1:${PUERTO}/health`);
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
  const mensajes: { role: string; content: string; [otros: string]: unknown }[] = historial.slice(inicio).map((m) => {
    if (m.de === "yo") return { role: "user", content: m.texto };
    if (m.de === "herramienta") return { role: "tool", tool_call_id: m.id, content: `código de salida ${m.codigo}\n${m.salida}` };
    return {
      role: "assistant",
      content: m.texto,
      ...(m.llamadas && { tool_calls: m.llamadas.map((l) => ({ id: l.id, type: "function", function: { name: l.nombre, arguments: l.argumentos } })) }),
    };
  });
  // Una sola tarea larga puede no caber: se acortan las salidas de herramientas más antiguas
  // (las últimas quedan enteras) hasta entrar en la ventana.
  // ponytail: recorte, no resumen; si ni así cabe, el servidor responderá con error de contexto.
  let total = JSON.stringify(mensajes).length;
  const herramientas = mensajes.filter((m) => m.role === "tool");
  for (const m of herramientas.slice(0, -3)) {
    if (total <= limite) break;
    if (m.content.length <= 300) continue;
    const corto = `${m.content.slice(0, 200)}\n[… salida antigua recortada para que quepa la tarea …]`;
    total -= m.content.length - corto.length;
    m.content = corto;
  }
  return mensajes;
}

// Un turno del modelo: el texto se reenvía a la interfaz mientras llega; las llamadas se acumulan.
async function turno(c: Conversacion, interfaz: Electron.WebContents, senal: AbortSignal) {
  const url = c.proveedor === "qwen" ? `http://127.0.0.1:${PUERTO}/v1/chat/completions` : `${OLLAMA}/v1/chat/completions`;
  const sistema = c.herramientas ? sistemaConHerramientas(c.nombre, computadora(c).usuario, c.libre === true) : sistemaSoloChat(c.nombre);
  const r = await fetch(url, {
    method: "POST",
    signal: senal, // Detener corta también la respuesta que está llegando
    headers: { authorization: `Bearer ${CLAVE}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: c.modelo,
      stream: true,
      ...(c.herramientas && { tools: DEFINICIONES }),
      messages: [{ role: "system", content: sistema }, ...contexto(c)],
    }),
  });
  if (!r.ok) {
    const cuerpo = await r.text();
    let mensaje = cuerpo;
    try {
      mensaje = JSON.parse(cuerpo).error?.message ?? cuerpo;
    } catch {
      // no era JSON: se muestra tal cual
    }
    const memoria = mensaje.match(/requires more system memory \(([\d.]+ GiB)\) than is available \(([\d.]+ GiB)\)/);
    if (memoria) throw new Error(`no hay memoria para cargar ${c.nombre}: necesita ${memoria[1]} y hay ${memoria[2]} libres. Cierra otras apps (o qwen) y vuelve a intentarlo.`);
    throw new Error(`el servidor respondió ${r.status}: ${mensaje.slice(0, 200)}`);
  }
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
const aprobaciones = new Map<string, { conversacion: string; resolver: (si: boolean) => void }>();
function pedirAprobacion(c: Conversacion, interfaz: Electron.WebContents, descripcion: string): Promise<boolean> {
  const id = randomBytes(8).toString("hex");
  cambiarEstado(c, { fase: "esperando-aprobacion", detalle: descripcion });
  interfaz.send("aprobacion", { id, conversacion: c.id, descripcion });
  return new Promise((resolver) => aprobaciones.set(id, { conversacion: c.id, resolver }));
}
ipcMain.handle("aprobar", (_e, id: unknown, si: unknown) => {
  aprobaciones.get(String(id))?.resolver(si === true);
  aprobaciones.delete(String(id));
});

// Detener: corta la tarea en curso de esa conversación. Lo que se esté ejecutando termina
// (un comando no se mata a medias) y después ya no sigue.
const tareas = new Map<string, AbortController>();
ipcMain.handle("detener", (_e, id: unknown) => {
  tareas.get(String(id))?.abort();
  for (const [clave, a] of aprobaciones) {
    if (a.conversacion !== id) continue;
    a.resolver(false); // una aprobación pendiente cuenta como "no"
    aprobaciones.delete(clave);
  }
});

// Vista en vivo: el cliente web de KasmVNC de su escritorio, dentro del panel de la interfaz. Solo hay
// transmisión mientras el panel está abierto (la interfaz quita el iframe al cerrarlo). Las credenciales
// se dan aquí (evento "login"): "ver" solo mira; "control" usa teclado y ratón.
let mirando: Computadora | undefined;
const computadoraConHerramientas = (id: unknown) => {
  const c = buscar(id);
  return c?.herramientas ? computadora(c).computadora : undefined;
};
async function abrirPantalla(pc: Computadora) {
  mirando = pc;
  await session.defaultSession.clearAuthCache(); // al cambiar de "ver" a "control" hay que volver a autenticarse
  return { url: (await pc.pantalla()).url };
}
ipcMain.handle("pantalla:ver", async (_e, id: unknown, ver: unknown) => {
  if (mirando) mirando.controlUsuario = false;
  mirando = undefined;
  const pc = computadoraConHerramientas(id);
  if (ver !== true || !pc) return {};
  try {
    return await abrirPantalla(pc);
  } catch (e) {
    return { error: (e as Error).message.split("\n")[0] };
  }
});
ipcMain.handle("pantalla:control", async (_e, id: unknown, activo: unknown) => {
  const pc = computadoraConHerramientas(id);
  if (!pc || pc !== mirando) return {};
  pc.controlUsuario = activo === true;
  return abrirPantalla(pc);
});
app.on("login", (ev, _contenido, detalles, _auth, responder) => {
  const pc = mirando;
  if (!pc) return;
  void pc.pantalla().then((p) => {
    if (new URL(detalles.url).origin === p.origen) responder(p.usuario, p.clave);
    else responder(); // cualquier otro sitio: sin credenciales
  });
  ev.preventDefault();
});

const buscar = (id: unknown) => conversaciones.find((c) => c.id === id);

ipcMain.handle("modo-libre", (_e, id: unknown, activo: unknown) => {
  const c = buscar(id);
  if (!c?.herramientas) return false;
  c.libre = activo === true;
  guardarConversaciones();
  return c.libre;
});
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
  const parar = new AbortController();
  tareas.set(c.id, parar);
  const detenida = () => {
    historial.push({ de: "ia", texto: "me detuviste. Aquí lo dejo; dime si sigo o cambio algo.", t: Date.now() });
    guardarHistorial(c.id);
    return {};
  };
  try {
    const veces = new Map<string, number>(); // cuántas veces pidió cada llamada exacta en esta tarea
    for (;;) {
      if (parar.signal.aborted) return detenida();
      cambiarEstado(c, { fase: "escribiendo" });
      const { texto, llamadas } = await turno(c, ev.sender, parar.signal);
      if (texto || llamadas.length) historial.push({ de: "ia", texto, t: Date.now(), ...(llamadas.length && { llamadas }) });
      guardarHistorial(c.id);
      if (!llamadas.length) return {};
      for (const l of llamadas) {
        const firma = `${l.nombre} ${l.argumentos}`;
        const n = (veces.get(firma) ?? 0) + 1;
        veces.set(firma, n);
        if (n >= MAX_REPETICIONES) {
          historial.push({ de: "ia", texto: `me detuve: intenté ${n} veces lo mismo (${l.nombre}) sin avanzar. ¿Me das otra pista?`, t: Date.now() });
          guardarHistorial(c.id);
          return {};
        }
        const r =
          n >= AVISO_REPETICION
            ? { salida: `ya hiciste exactamente esto ${n - 1} veces; no lo repito. Prueba otro camino o termina con lo que tienes.`, codigo: 1 }
            : await ejecutarHerramienta(
                { ...computadora(c), avisar: (fase, detalle) => cambiarEstado(c, { fase, detalle }), aprobar: async (d) => c.libre === true || pedirAprobacion(c, ev.sender, d) },
                l.nombre,
                l.argumentos,
              );
        historial.push({ de: "herramienta", ...l, ...r, t: Date.now() });
        guardarHistorial(c.id);
      }
      ev.sender.send("paso", c.id);
    }
  } catch (e) {
    if (parar.signal.aborted) return detenida();
    const detalle = c.proveedor === "ollama" && (e as Error).message === "fetch failed" ? "Ollama no responde; ¿está en marcha?" : (e as Error).message;
    return { error: `no pude obtener respuesta: ${detalle}` };
  } finally {
    tareas.delete(c.id);
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
  // El escritorio en vivo es código de la computadora de la IA (donde es root): desde su marco no puede llevar
  // esta ventana, que tiene el puente al proceso principal, a otra página ni abrir ventanas que lo heredarían.
  ventana.webContents.on("will-navigate", (e) => e.preventDefault());
  ventana.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
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
  apagarTodas(); // restos de una sesión que se cerró mal
  leerConversaciones();
  iniciarServidor();
  crearVentana();
});
app.on("window-all-closed", () => app.quit());
// Red de seguridad: un error inesperado del proceso principal se anota en errores.log en vez de mostrar el
// cuadro de Electron "A JavaScript error occurred in the main process" (y la app sigue funcionando).
function anotarError(tipo: string, e: unknown) {
  const texto = `${new Date().toISOString()} ${tipo}: ${(e as Error)?.stack ?? String(e)}\n`;
  console.error(texto);
  try {
    fs.appendFileSync(path.join(app.getPath("userData"), "errores.log"), texto);
  } catch {
    // sin disco no hay dónde anotarlo
  }
}
process.on("uncaughtException", (e) => anotarError("excepción", e));
process.on("unhandledRejection", (e) => anotarError("promesa rechazada", e));

// Cerrar con una señal (terminal, lanzador) no pasa por "will-quit": sin esto quedarían llama-server y los contenedores.
for (const senal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.on(senal, () => app.quit());
app.on("will-quit", () => {
  saliendo = true;
  servidor?.kill();
  apagarTodas(); // no deja contenedores corriendo
});
