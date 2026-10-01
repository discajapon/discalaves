import { app, BrowserWindow, dialog, ipcMain, safeStorage, session, shell } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BORRADO, definicionesPara, ejecutarHerramienta, verificar } from "./herramientas";
import { ADICIONALES_OC, OpenClaw, PRINCIPALES_OC } from "./openclaw";
import { COLORES, Empleados, HERRAMIENTAS, PRINCIPALES, leerIdentidad, promptEmpleado, type Empleado, type Identidad } from "./empleados";
import { apagarTodas, computadoraDe, responde, type Computadora } from "./computadora";
import { navegadorDe } from "./navegador";
import { especificaciones } from "./especificaciones";
import { rutas } from "./rutas";
import { registrarWsl } from "./ipc-wsl";
import { Boveda, SinAlmacenSeguro } from "./boveda";
import { Codex } from "./codex";
import { Gasto, TOPE_POR_DEFECTO } from "./gasto";
import { Corte, URL_POR_DEFECTO, esRemoto, listarModelos, sinClave, turnoClaude, turnoOpenAI, type ModeloNube, type Proveedor, type Tipo, type Uso } from "./proveedores";
import { Tunel, destino, sshValido, type Pregunta } from "./tunel";
import * as gestor from "./modelos";

// Rutas según el sistema (Linux o Windows): ver rutas.ts. ponytail: puerto fijo para un solo servidor.
const SERVIDOR = rutas.servidor;
const MODELO = rutas.modelo;
if (rutas.datos) app.setPath("userData", rutas.datos); // Windows: datos locales, antes de usar userData
const PUERTO = 8089;
// Empleados de qwen que generan a la vez. 2 en 8 GB de VRAM (medido 2026-09-30, RTX 3060 Ti con ~2 GB ocupados
// por otras apps): con 3 y contexto para conversaciones largas quedan capas en CPU y uno solo va a la mitad.
// ponytail: en equipos con más VRAM se sube con DISCALAVES_RANURAS; automático cuando exista el gestor de modelos.
const RANURAS = Math.max(1, Number(process.env.DISCALAVES_RANURAS) || 2);
// Instancia con datos aparte (DISCALAVES_DATOS, p. ej. las pruebas): no apaga las computadoras de otra instancia.
const APARTE = !!process.env.DISCALAVES_DATOS;
// Almacén de claves de Linux para la bóveda (gnome-libsecret, kwallet5…): por defecto lo elige Chromium según el escritorio.
if (process.env.DISCALAVES_LLAVERO) app.commandLine.appendSwitch("password-store", process.env.DISCALAVES_LLAVERO);
const CLAVE = randomBytes(24).toString("hex"); // sin clave, cualquier web abierta en el navegador podría usar el servidor
const CONTEXTO_CARACTERES = 32000; // ponytail: ventana por tamaño (~9k tokens de 16k); resumir cuando las conversaciones crezcan
// Sin límite de pasos (decisión del usuario, 2026-09-27): la IA trabaja hasta acabar. Frenos: el botón
// Detener y la detección de repeticiones (misma llamada con los mismos argumentos).
const AVISO_REPETICION = 3; // a la 3.ª vez no se ejecuta: se le dice que cambie de enfoque
const MAX_REPETICIONES = 5; // a la 5.ª se detiene y lo explica
const OLLAMA = process.env.DISCALAVES_OLLAMA || "http://127.0.0.1:11434"; // ponytail: dirección por defecto de Ollama; configurable cuando exista el gestor de modelos
const CONTEXTO_OLLAMA = 10000; // Ollama recorta por defecto a ~4k tokens: se le manda menos historial

// Cada conversación es con un EMPLEADO (perfil en archivos, ver empleados.ts) asignado a un modelo (campo
// "modelo" del perfil, que elige el usuario; la app nunca lo cambia por su cuenta):
//   qwen                    llama-server incluido (todos los de qwen comparten el modelo cargado)
//   ollama:<modelo>         Ollama del usuario
//   nube:<proveedor>:<modelo> API con clave o servidor remoto del usuario (proveedores.ts, bóveda cifrada)
//   codex:<modelo>          ChatGPT por suscripción vía Codex (codex.ts), con su propio bucle
// libre: "modo libre", decisión del usuario por empleado (apagado por defecto): no pide aprobación.
type Origen = "local" | "nube" | "remoto";
interface Conversacion {
  id: string; nombre: string; rol: string; color: string; usuario: string; libre?: boolean;
  proveedor: "qwen" | "ollama" | "nube" | "codex"; modelo: string; // modelo tal como lo pide la API
  cuenta?: string; // nube: id del proveedor en la bóveda
  origen: Origen; donde: string; // para la marca de la lista y el aviso de privacidad
  herramientas: boolean; // el modelo sabe usar herramientas (si no, es "solo chat" aunque el perfil liste alguna)
  permitidas: string[]; // herramientas del puesto
  tope: number; // USD al mes (solo nube)
  openclaw?: boolean; // su bucle lo hace OpenClaw (solo con qwen, ver tareaOpenClaw)
}
interface Modelo { proveedor: Conversacion["proveedor"]; modelo: string; valor: string; detalle: string; herramientas: boolean; origen: Origen; donde: string; aviso?: string }
const QWEN_MODELO = "Qwen3.5-9B";

function aConversacion(e: Empleado): Conversacion {
  const base = { id: e.id, nombre: e.nombre, rol: e.rol, color: e.color, usuario: e.usuario, libre: e.libre, permitidas: e.herramientas, tope: e.tope ?? TOPE_POR_DEFECTO };
  const [prefijo, resto] = [e.modelo.slice(0, e.modelo.indexOf(":")), e.modelo.slice(e.modelo.indexOf(":") + 1)];
  if (prefijo === "ollama") return { ...base, proveedor: "ollama", modelo: resto, origen: "local", donde: "Ollama", herramientas: e.herramientasModelo };
  if (prefijo === "codex") return { ...base, proveedor: "codex", modelo: resto, origen: "nube", donde: "OpenAI (ChatGPT vía Codex)", herramientas: true };
  if (prefijo === "nube") {
    const cuenta = resto.slice(0, resto.indexOf(":"));
    const p = proveedores().find((x) => x.id === cuenta);
    return {
      ...base, proveedor: "nube", cuenta, modelo: resto.slice(cuenta.length + 1), herramientas: e.herramientasModelo,
      origen: p && esRemoto(p.tipo) ? "remoto" : "nube", donde: p ? dondeDe(p) : `${cuenta} (proveedor borrado)`,
    };
  }
  return { ...base, proveedor: "qwen", modelo: QWEN_MODELO, origen: "local", donde: "este equipo", herramientas: true, openclaw: e.motor === "openclaw" };
}

// ---- Proveedores fuera de este equipo: bóveda cifrada (claves), gasto, túneles y Codex ----
let boveda: Boveda;
let gasto: Gasto;
let codex: Codex;
const tuneles = new Map<string, Tunel>(); // por proveedor; se abren al usarlos y no se reconectan solos
const modelosNube = new Map<string, ModeloNube[]>(); // última lista de cada proveedor
const NOMBRE_TIPO: Record<Tipo, string> = { openai: "OpenAI", gemini: "Google (Gemini)", claude: "Anthropic (Claude)", compatible: "", remoto: "", tunel: "", codex: "OpenAI (ChatGPT vía Codex)" };

let enMemoria: Proveedor[] | undefined; // descifrada una vez por sesión
function proveedores(): Proveedor[] {
  try {
    return (enMemoria ??= boveda.leer());
  } catch {
    return []; // sin almacén seguro: no hay proveedores (la interfaz lo explica al intentar guardar uno)
  }
}
const hostDe = (p: Proveedor) => (p.tipo === "tunel" ? p.ssh! : (() => { try { return new URL(p.url!).host; } catch { return p.url ?? ""; } })());
const dondeDe = (p: Proveedor) => (esRemoto(p.tipo) ? hostDe(p) : NOMBRE_TIPO[p.tipo] || `${p.nombre} (${hostDe(p)})`);

// Qué sale del equipo y hacia dónde: se muestra al asignar a un empleado un origen que no es local.
function avisoPrivacidad(origen: Origen, donde: string): string | undefined {
  const que = "la conversación, las páginas que lee, las salidas de su terminal, los archivos que abre y su memoria";
  if (origen === "remoto") return `Los datos salen de este equipo hacia ${donde}, el servidor que configuraste: ${que}.`;
  if (origen === "nube") return `Los datos salen de este equipo hacia ${donde}: ${que}. Se aplican sus condiciones de uso y privacidad.`;
}

// Base de la API de un proveedor; en túnel, lo abre (y ssh puede preguntar la huella o la contraseña).
async function baseDe(p: Proveedor): Promise<string> {
  if (p.tipo !== "tunel") return (p.url || URL_POR_DEFECTO[p.tipo] || "").replace(/\/$/, "");
  let t = tuneles.get(p.id);
  if (!t || t.caido) {
    t = await Tunel.abrir(p.ssh!, p.url!, path.join(app.getPath("userData"), "ssh"), preguntarSsh);
    tuneles.set(p.id, t);
  }
  return t.base(p.url!);
}

// Preguntas de ssh (huella del servidor, contraseña): ventana propia de la interfaz. La contraseña solo pasa por aquí.
const preguntasSsh = new Map<string, (r: string | null) => void>();
function preguntarSsh(p: Pregunta, host: string): Promise<string | null> {
  if (!ventana) return Promise.resolve(null);
  const id = randomBytes(8).toString("hex");
  ventana.webContents.send("ssh:pregunta", { id, host, ...p });
  return new Promise((resolver) => preguntasSsh.set(id, resolver));
}
ipcMain.handle("ssh:respuesta", (_e, id: unknown, valor: unknown) => {
  preguntasSsh.get(String(id))?.(typeof valor === "string" ? valor : null);
  preguntasSsh.delete(String(id));
});

// Computadora propia de cada empleado: su contenedor (se enciende la primera vez que lo usa), con la carpeta
// de trabajo (rutas.trabajo) como /home/<usuario>, y el Chromium de su escritorio.
function computadora(c: Conversacion) {
  const carpeta = rutas.trabajo(c.usuario); // la crea la computadora al encenderse (en Windows vive dentro de WSL)
  const pc = computadoraDe(carpeta, c.usuario);
  return { usuario: c.usuario, carpeta, computadora: pc, navegador: navegadorDe(pc) };
}

// Base común del prompt, idéntica para todos los empleados (con el mismo modo): va primero para que
// llama-server reutilice en caché ese prefijo al cambiar de empleado. Lo propio del puesto va después.
const baseConHerramientas = (libre: boolean) =>
  "Eres un empleado de Discalaves que trabaja para el usuario. " +
  "Responde en el idioma del usuario, de forma breve y clara. " +
  "Tienes tu propia computadora aislada (Debian con escritorio) con internet; usa solo las herramientas que tienes. " +
  "Si una tarea encaja con uno de tus procedimientos, léelo primero con leer_procedimiento y sigue sus pasos y su formato. " +
  "Cita las direcciones de donde sacas la información. " +
  "Trabaja hasta terminar la tarea completa, sin pedir permiso para continuar; entre paso y paso cuenta en una frase qué hiciste y qué encontraste. " +
  "Si algo falla, prueba otro camino en vez de repetir lo mismo. " +
  "Si no sabes algo, un comando falla o no puedes hacerlo, dilo en vez de inventar; nunca finjas saber lo que no sabes. " +
  "No digas que guardaste, abriste o comprobaste algo si no lo hiciste con una herramienta en esta tarea; cita solo direcciones que abriste o que salieron en tus resultados. " +
  "Con recordar guarda notas cortas que te sirvan en otras conversaciones (preferencias del usuario, decisiones). " +
  "Si tienes terminal: para instalar o tocar el sistema, empieza el comando con sudo (eres root en tu computadora, no en la del usuario); " +
  "para instalar: sudo apt-get update && sudo apt-get install -y <paquete>. " +
  (libre
    ? "Trabajas en modo libre: actúa por tu cuenta, no pidas confirmación ni preguntes qué hacer; decide tú y termina la tarea. " +
      "Pregunta solo si te falta un dato imprescindible que no puedes averiguar."
    : "Borrar, enviar o pagar siempre requiere la aprobación del usuario: la app se la pide sola; si la rechaza, no insistas.");

const BASE_SOLO_CHAT =
  "Eres un empleado de Discalaves que trabaja para el usuario. " +
  "Responde en el idioma del usuario, de forma breve y clara. " +
  "No tienes herramientas: no puedes navegar por internet, ejecutar comandos ni ver o crear archivos. " +
  "Si te piden algo así, dilo y sugiere pedírselo a un empleado que sí tenga herramientas. " +
  "Si no sabes algo, dilo en vez de inventar; nunca finjas saber lo que no sabes.";

function promptSistema(c: Conversacion): string {
  const e = equipo.buscar(c.id)!;
  const base = c.herramientas ? baseConHerramientas(c.libre === true) : BASE_SOLO_CHAT;
  return `${base}\n\n${promptEmpleado(e, equipo.procedimientos(c.id), equipo.memoria(c.id), c.herramientas)}`;
}

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
let equipo: Empleados; // se crea al arrancar (necesita la carpeta de datos)
let conversaciones: Conversacion[] = [];
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

// Se relee de disco en cada consulta: una edición a mano de identidad.md se nota en el siguiente mensaje.
function leerConversaciones() {
  conversaciones = equipo.listar().map(aConversacion);
}

// Primera vez con empleados: las conversaciones que ya existían (una por modelo) pasan a ser empleados
// "Asistente" con el mismo id (su historial no se mueve) y la misma carpeta de computadora.
function migrarConversaciones() {
  if (equipo.existe()) return;
  type Vieja = { id: string; nombre: string; proveedor: "qwen" | "ollama"; modelo: string; herramientas: boolean; libre?: boolean };
  let viejas: Vieja[] = [];
  try {
    viejas = JSON.parse(fs.readFileSync(path.join(carpetaConversaciones(), "indice.json"), "utf8"));
  } catch {
    // instalación nueva
  }
  if (!viejas.some((v) => v.id === "qwen")) viejas.unshift({ id: "qwen", nombre: "qwen", proveedor: "qwen", modelo: QWEN_MODELO, herramientas: true });
  const asistente = equipo.plantilla("asistente")!;
  for (const v of viejas) {
    if (v.proveedor === "qwen") {
      equipo.crear({ ...asistente, modelo: "qwen" }, true, "asistente", { id: v.id, usuario: "qwen", libre: v.libre });
    } else {
      // misma carpeta que tenía (antes salía del nombre del modelo)
      let usuario = v.nombre.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "ia";
      if (usuario === "qwen") usuario = "qwen-ollama";
      equipo.crear({ ...asistente, nombre: v.nombre, modelo: `ollama:${v.modelo}` }, v.herramientas, "asistente", { id: v.id, usuario, libre: v.libre });
    }
  }
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
          valor: `ollama:${m.name}`,
          origen: "local" as const,
          donde: "Ollama",
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
    // Varias ranuras: los empleados de qwen trabajan a la vez con el mismo modelo cargado (sin más VRAM de pesos).
    // Caché KV unificada: 12k por ranura, compartidos; cada conversación manda ~11k como mucho (con 16k para 3
    // conversaciones largas a la vez, llama-server rechazaba las peticiones). Si hay más empleados trabajando
    // que ranuras, llama-server los pone en cola. -ub 256: búfer de cálculo menor, para que quepan más capas.
    "-c", String(12288 * RANURAS), "-np", String(RANURAS), "-kvu", "-ub", "256",
    "-ctk", "q8_0", "-ctv", "q8_0", // caché en 8 bits: 16k de contexto (páginas web) casi sin coste de VRAM
    // Margen de VRAM bajo: con el de 1 GB por defecto, en 8 GB quedan capas en CPU y va a la mitad de velocidad.
    // Con 0 cabe una capa más (53 tok/s frente a 40) pero una vez se cayó al cargar: 128 es el término medio.
    "-fitt", "128",
    // Caché de prompts en RAM: por defecto hasta 8 GB. Con varios empleados, cada conversación deja ahí su
    // estado y, junto a sus computadoras, en 16 GB el sistema mató a llama-server por falta de memoria.
    "-cram", "1024",
    "--reasoning", "off", "--no-webui",
  ], { stdio: ["ignore", log, log], windowsHide: true }); // en Windows, sin ventana de consola
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

// Últimos mensajes que caben, empezando siempre en un mensaje del usuario para no partir
// una llamada a herramienta de su resultado.
function contexto(c: Conversacion) {
  const historial = historialDe(c.id);
  const limite = c.proveedor === "ollama" ? CONTEXTO_OLLAMA : CONTEXTO_CARACTERES;
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
// Todos los orígenes devuelven lo mismo (proveedores.ts): texto, llamadas a herramientas y uso de tokens.
async function turno(c: Conversacion, interfaz: Electron.WebContents, senal: AbortSignal, avisos: string[] = []): Promise<{ texto: string; llamadas: Llamada[]; uso: Uso }> {
  const companeros = conversaciones.filter((o) => o.id !== c.id).map((o) => ({ nombre: o.nombre, rol: o.rol }));
  const pedido = {
    modelo: c.modelo,
    sistema: promptSistema(c),
    mensajes: [...contexto(c), ...avisos.map((a) => ({ role: "user", content: `(aviso de la app, no del usuario) ${a}` }))],
    herramientas: c.herramientas ? definicionesPara(c.permitidas, equipo.procedimientos(c.id).length > 0, companeros) : [],
    senal, // Detener corta también la respuesta que está llegando
    alTexto: (texto: string) => interfaz.send("trozo", { id: c.id, texto }),
  };
  try {
    if (c.proveedor === "qwen") return await turnoOpenAI({ ...pedido, url: `http://127.0.0.1:${PUERTO}/v1`, clave: CLAVE });
    if (c.proveedor === "ollama") return await turnoOpenAI({ ...pedido, url: `${OLLAMA}/v1` });
    const p = proveedores().find((x) => x.id === c.cuenta);
    if (!p) throw new Corte(`el proveedor de ${c.nombre} ya no está configurado; elige otro modelo en su perfil`);
    const url = await baseDe(p);
    return await (p.tipo === "claude" ? turnoClaude : turnoOpenAI)({ ...pedido, url, clave: p.clave });
  } catch (e) {
    const m = (e as Error).message;
    const memoria = m.match(/requires more system memory \(([\d.]+ GiB)\) than is available \(([\d.]+ GiB)\)/);
    if (memoria) throw new Error(`no hay memoria para cargar ${c.nombre}: necesita ${memoria[1]} y hay ${memoria[2]} libres. Cierra otras apps (o qwen) y vuelve a intentarlo.`);
    throw e;
  }
}

// Gasto de un empleado en la nube: precio conocido antes de trabajar, y tope mensual (pausa y pregunta).
// El modo libre no salta el tope: es dinero.
async function antesDeGastar(c: Conversacion, interfaz: Electron.WebContents): Promise<string | null> {
  if (c.proveedor !== "nube") return null;
  if (!gasto.precio(`${c.cuenta}:${c.modelo}`)) throw new Corte(`no conozco el precio de ${c.modelo}; ponlo en el perfil de ${c.nombre} (USD por millón de tokens; 0 si es tu propio servidor)`);
  const llevado = gasto.delMes(c.id);
  if (llevado < c.tope) return null;
  const nuevo = Math.ceil(c.tope * 2);
  const si = await pedirAprobacion(c, interfaz, `${c.nombre} llegó a su tope de ${c.tope} USD este mes (lleva ${llevado.toFixed(2)} USD). ¿Subir el tope a ${nuevo} USD y seguir?`);
  if (!si) return `me pausé: llegué a mi tope de ${c.tope} USD de este mes. Súbelo en mi perfil si quieres que siga.`;
  equipo.cambiarTope(c.id, nuevo);
  c.tope = nuevo;
  return null;
}
function anotarGasto(c: Conversacion, uso: Uso) {
  const precio = c.proveedor === "nube" && gasto.precio(`${c.cuenta}:${c.modelo}`);
  if (precio) gasto.sumar(c.id, uso, precio);
}

// Aprobación de acciones delicadas: la interfaz muestra la tarjeta y responde con el id.
const aprobaciones = new Map<string, { conversacion: string; resolver: (si: boolean) => void }>();
function pedirAprobacion(c: Conversacion, interfaz: Electron.WebContents, descripcion: string): Promise<boolean> {
  const id = randomBytes(8).toString("hex");
  cambiarEstado(c, { fase: "esperando-aprobacion", detalle: descripcion });
  const enHilo = [...abiertas.values()].some((col) => col.some((x) => x.id === c.id && !x.hasta));
  interfaz.send("aprobacion", { id, conversacion: c.id, descripcion, enHilo });
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
  if (id === HILO) return [...abiertas.keys()].forEach(detener);
  detener(id);
});
function detener(id: unknown) {
  const parar = tareas.get(String(id));
  parar?.abort();
  for (const [clave, a] of aprobaciones) {
    // también las del compañero al que le pasó trabajo (comparten la misma tarea)
    if (a.conversacion !== id && (!parar || tareas.get(a.conversacion) !== parar)) continue;
    a.resolver(false); // una aprobación pendiente cuenta como "no"
    aprobaciones.delete(clave);
  }
}

// Vista en vivo: el cliente web de KasmVNC de cada escritorio. La interfaz tiene un iframe por empleado siempre
// conectado, así cambiar de empleado es instantáneo (decisión del usuario, 2026-09-30: prima la inmediatez
// sobre el consumo). Las credenciales se dan aquí (evento "login") según el origen: "ver" solo mira; "control"
// usa teclado y ratón.
const pantallas = new Map<string, Computadora>(); // origen de su KasmVNC → su computadora
const computadoraConHerramientas = (id: unknown) => {
  const c = buscar(id);
  return c?.herramientas ? computadora(c).computadora : undefined;
};
async function abrirPantalla(pc: Computadora) {
  const p = await pc.pantalla();
  pantallas.set(p.origen, pc);
  return { url: p.url };
}
ipcMain.handle("pantalla:ver", async (_e, id: unknown) => {
  const pc = computadoraConHerramientas(id);
  if (!pc) return {};
  try {
    return await abrirPantalla(pc);
  } catch (e) {
    return { error: (e as Error).message.split("\n")[0] };
  }
});
ipcMain.handle("pantalla:control", async (_e, id: unknown, activo: unknown) => {
  const pc = computadoraConHerramientas(id);
  if (!pc) return {};
  pc.controlUsuario = activo === true;
  await session.defaultSession.clearAuthCache(); // al cambiar de "ver" a "control" hay que volver a autenticarse
  return abrirPantalla(pc);
});
app.on("login", (ev, _contenido, detalles, _auth, responder) => {
  const pc = pantallas.get(new URL(detalles.url).origin);
  if (!pc) return; // cualquier otro sitio: sin credenciales
  ev.preventDefault();
  void pc.pantalla().then((p) => responder(p.usuario, p.clave));
});

const buscar = (id: unknown) => {
  leerConversaciones();
  return conversaciones.find((c) => c.id === id);
};

ipcMain.handle("modo-libre", (_e, id: unknown, activo: unknown) => {
  const c = buscar(id);
  if (!c?.herramientas) return false;
  equipo.cambiarLibre(c.id, activo === true);
  return activo === true;
});
ipcMain.handle("conversaciones", () => {
  const lista = (leerConversaciones(), conversaciones).map((c) => ({ ...c, estado: estadoDe(c), ultimo: historialDe(c.id).at(-1) }));
  if (lista.length < 2) return lista;
  const participantes = [...new Set(leerColaboraciones().flat().map((x) => x.id))];
  const hilo = {
    id: HILO, nombre: "Equipo", rol: "hilo compartido del equipo", color: "violeta", proveedor: "equipo", modelo: "", herramientas: false,
    origen: "local", donde: "", estado: estadoHilo(), ultimo: hiloEquipo().at(-1), equipo: true,
    colores: [...new Set((participantes.length ? participantes : lista.map((c) => c.id)).map((id) => lista.find((c) => c.id === id)?.color).filter(Boolean))].slice(0, 3),
  };
  return [hilo, ...lista];
});
ipcMain.handle("historial", (_e, id: unknown) => (id === HILO ? (leerConversaciones(), hiloEquipo()) : buscar(id) ? historialDe(String(id)) : []));
ipcMain.handle("estado", (_e, id: unknown) => {
  if (id === HILO) return estadoHilo();
  const c = buscar(id);
  return c ? estadoDe(c) : { fase: "error", detalle: "conversación desconocida" };
});
ipcMain.handle("modelos", async () => {
  const ollama = await modelosOllama();
  const qwen: Modelo = { proveedor: "qwen", modelo: QWEN_MODELO, valor: "qwen", detalle: "incluido · 9B · Q4_K_M", herramientas: true, origen: "local", donde: "este equipo" };
  const nube: Modelo[] = [];
  for (const p of proveedores()) {
    const origen: Origen = esRemoto(p.tipo) ? "remoto" : "nube";
    const donde = dondeDe(p);
    let lista = modelosNube.get(p.id);
    // Túneles (ssh podría pedir contraseña) y Codex (la sonda tarda) se listan al pulsar "probar", no al abrir el diálogo.
    if (!lista && p.tipo !== "tunel" && p.tipo !== "codex") lista = await baseDe(p).then((u) => listarModelos(p.tipo, u, p.clave)).catch(() => undefined);
    if (lista) modelosNube.set(p.id, lista);
    for (const m of lista ?? []) {
      nube.push({
        proveedor: p.tipo === "codex" ? "codex" : "nube", modelo: m.modelo, valor: p.tipo === "codex" ? `codex:${m.modelo}` : `nube:${p.id}:${m.modelo}`,
        detalle: p.tipo === "codex" ? "ChatGPT vía Codex · no oficial, puede dejar de funcionar" : p.nombre,
        herramientas: m.herramientas, origen, donde, aviso: avisoPrivacidad(origen, donde),
      });
    }
  }
  return { modelos: [qwen, ...(ollama ?? []), ...nube], ollama: ollama !== null };
});

// ---- Gestor de modelos (modelos.ts): buscar en Hugging Face, ver la VRAM e instalar en Ollama ----
const instalaciones = new Map<string, AbortController>(); // nombre → para cancelarla
const ollamaNoResponde = (e: unknown) => ((e as Error).message === "fetch failed" ? "Ollama no responde: instálalo desde ollama.com y ábrelo" : (e as Error).message);
const texto200 = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 200) : "");
ipcMain.handle("gestor:vram", () => gestor.vram());
ipcMain.handle("gestor:buscar", (_e, q: unknown) => gestor.buscar(texto200(q)).catch((e) => ({ error: (e as Error).message })));
ipcMain.handle("gestor:versiones", (_e, repo: unknown) => gestor.versiones(texto200(repo)).catch((e) => ({ error: (e as Error).message })));
ipcMain.handle("gestor:instalados", async () => {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return ((await r.json()) as { models: { name: string; size: number }[] }).models.map((m) => ({ nombre: m.name, tamano: m.size }));
  } catch (e) {
    return { error: ollamaNoResponde(e) };
  }
});
// Instala (o carga un .gguf elegido por el usuario) con el progreso en el evento "gestor:progreso".
async function conProgreso(clave: string, ev: Electron.IpcMainInvokeEvent, trabajo: (avisar: (p: gestor.Progreso) => void, senal: AbortSignal) => Promise<unknown>) {
  const parar = new AbortController();
  instalaciones.set(clave, parar);
  try {
    await trabajo((p) => ev.sender.send("gestor:progreso", { nombre: clave, ...p }), parar.signal);
    return {};
  } catch (e) {
    return { error: parar.signal.aborted ? "cancelado" : ollamaNoResponde(e) };
  } finally {
    instalaciones.delete(clave);
  }
}
ipcMain.handle("gestor:instalar", (ev, nombre: unknown) => {
  const n = texto200(nombre);
  if (!gestor.nombreValido(n)) return { error: "nombre de modelo no válido" };
  return conProgreso(n, ev, (avisar, senal) => gestor.instalar(OLLAMA, n, avisar, senal));
});
ipcMain.handle("gestor:archivo", async (ev) => {
  const { filePaths } = await dialog.showOpenDialog(ventana!, { title: "Elegir un modelo .gguf", properties: ["openFile"], filters: [{ name: "Modelos GGUF", extensions: ["gguf"] }] });
  if (!filePaths[0]) return { error: "" }; // no eligió ninguno
  let nombre = "";
  const r = await conProgreso("archivo", ev, async (avisar, senal) => (nombre = await gestor.desdeArchivo(OLLAMA, filePaths[0], avisar, senal)));
  return { ...r, nombre };
});
ipcMain.handle("gestor:cancelar", (_e, nombre: unknown) => instalaciones.get(texto200(nombre))?.abort());
ipcMain.handle("gestor:quitar", async (_e, nombre: unknown) => {
  const n = texto200(nombre);
  const usan = (leerConversaciones(), conversaciones).filter((c) => c.proveedor === "ollama" && c.modelo === n).map((c) => c.nombre);
  if (usan.length) return { error: `lo usa${usan.length > 1 ? "n" : ""} ${usan.join(", ")}: asígnale${usan.length > 1 ? "s" : ""} otro modelo antes` };
  return gestor.quitar(OLLAMA, n).then(() => ({}), (e) => ({ error: ollamaNoResponde(e) }));
});

// ---- Proveedores (la interfaz nunca recibe las claves: solo si hay una guardada) ----
const sinSecretos = (p: Proveedor) => ({ id: p.id, nombre: p.nombre, tipo: p.tipo, url: p.url, ssh: p.ssh, conClave: !!p.clave, donde: dondeDe(p), remoto: esRemoto(p.tipo) });
ipcMain.handle("proveedores", async () => ({
  proveedores: proveedores().map(sinSecretos),
  almacen: safeStorage.isEncryptionAvailable() && (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text"),
  codex: await codex.instalado(),
}));
ipcMain.handle("guardar-proveedor", async (_e, datos: unknown) => {
  const d = datos as Record<string, unknown>;
  const texto = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const tipo = texto(d?.tipo) as Tipo;
  if (!(tipo in NOMBRE_TIPO)) return { error: "tipo de proveedor desconocido" };
  const actual = proveedores().find((x) => x.id === texto(d.id));
  const p: Proveedor = { id: actual?.id ?? `p${randomBytes(4).toString("hex")}`, nombre: texto(d.nombre, 60) || NOMBRE_TIPO[tipo] || tipo, tipo };
  // openai/gemini/claude: dirección opcional (un proxy propio; o el servidor falso de las pruebas)
  if (tipo === "compatible" || tipo === "remoto" || tipo === "tunel" || (tipo !== "codex" && texto(d.url))) {
    p.url = texto(d.url);
    let u: URL;
    try {
      u = new URL(p.url);
    } catch {
      return { error: "la dirección no es válida (por ejemplo https://servidor/v1)" };
    }
    if (u.username || u.password) return { error: "no pongas usuario ni contraseña en la dirección; usa el campo de clave" };
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
    if (tipo !== "tunel" && u.protocol !== "https:" && !local) return { error: "la dirección debe ser https (los datos viajan por internet)" };
  }
  if (tipo === "tunel") {
    p.ssh = texto(d.ssh, 120);
    if (!sshValido(p.ssh) || !destino(p.url!)) return { error: "pon el host SSH (alias de tu ~/.ssh/config o usuario@host) y la dirección del servidor vista desde ese host" };
  }
  const clave = texto(d.clave, 500);
  if (tipo !== "codex" && tipo !== "tunel") {
    p.clave = clave || actual?.clave; // vacío al editar = conservar la guardada
    if (!p.clave && tipo !== "compatible") return { error: "falta la clave de API" };
  } else if (tipo === "tunel" && (clave || actual?.clave)) p.clave = clave || actual?.clave;
  try {
    boveda.guardar([...proveedores().filter((x) => x.id !== p.id), p]);
  } catch (e) {
    return { error: e instanceof SinAlmacenSeguro ? e.message : `no pude guardar: ${(e as Error).message}` };
  }
  enMemoria = undefined;
  modelosNube.delete(p.id);
  tuneles.get(p.id)?.cerrar();
  tuneles.delete(p.id);
  return { id: p.id };
});
ipcMain.handle("borrar-proveedor", (_e, id: unknown) => {
  try {
    boveda.guardar(proveedores().filter((x) => x.id !== id));
  } catch (e) {
    return { error: (e as Error).message };
  }
  enMemoria = undefined;
  tuneles.get(String(id))?.cerrar();
  tuneles.delete(String(id));
  return {};
});
// Probar: lista sus modelos (en túnel, lo abre: ssh puede pedir la huella o la contraseña en una ventana).
ipcMain.handle("probar-proveedor", async (_e, id: unknown) => {
  const p = proveedores().find((x) => x.id === id);
  if (!p) return { error: "no existe ese proveedor" };
  try {
    if (p.tipo === "codex") {
      if (!(await codex.instalado())) return { error: "no encuentro Codex: instálalo con npm i -g @openai/codex" };
      if (!(await codex.conSesion())) return { error: "no hay sesión de ChatGPT en Codex: pulsa «iniciar sesión»" };
    }
    let lista = p.tipo === "codex" ? await codex.modelos() : await listarModelos(p.tipo, await baseDe(p), p.clave);
    if (p.tipo === "codex") {
      // Solo se ofrecen los modelos con los que la sonda confirma: sin herramientas propias y con las de Discalaves.
      const nuestras = definicionesPara(HERRAMIENTAS, true, [{ nombre: "otro", rol: "" }]);
      const motivos = await Promise.all(lista.map((m) => codex.sonda(nuestras, m.modelo)));
      const ajena = motivos.find((m) => m?.includes("herramientas propias"));
      if (ajena) return { error: ajena };
      lista = lista.filter((_, i) => !motivos[i]);
    }
    modelosNube.set(p.id, lista);
    return { modelos: lista.length };
  } catch (e) {
    return { error: sinClave((e as Error).message, p.clave) };
  }
});
ipcMain.handle("codex-sesion", async () => ((await codex.iniciarSesion()) ? {} : { error: "no se completó el inicio de sesión" }));

// ---- Empleados: plantillas, crear, editar, borrador redactado por el modelo y abrir su carpeta ----

// La interfaz no decide qué es válido: se limpia todo lo que llega.
function limpiarIdentidad(x: unknown): Identidad | null {
  const d = x as Record<string, unknown>;
  const texto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const nombre = texto(d?.nombre, 40);
  const modelo = texto(d?.modelo, 120);
  if (!nombre || !(modelo === "qwen" || /^(ollama|codex):\S+$/.test(modelo) || /^nube:[a-z0-9]+:\S+$/.test(modelo))) return null;
  return {
    nombre,
    rol: texto(d.rol, 80),
    color: COLORES.includes(d.color as string) ? (d.color as string) : "violeta",
    modelo,
    herramientas: Array.isArray(d.herramientas) ? d.herramientas.filter((h): h is string => [...HERRAMIENTAS, ...PRINCIPALES_OC, ...ADICIONALES_OC].includes(h as string)) : [],
    instrucciones: texto(d.instrucciones, 3000),
    ...(d.motor === "openclaw" && modelo === "qwen" && { motor: "openclaw" as const }),
  };
}

// ¿El modelo asignado sabe usar herramientas? qwen sí; los de Ollama según /api/show.
async function modeloConHerramientas(modelo: string): Promise<boolean | null> {
  if (modelo === "qwen" || modelo.startsWith("codex:")) return true;
  if (modelo.startsWith("nube:")) {
    const [, cuenta, ...resto] = modelo.split(":");
    const m = modelosNube.get(cuenta)?.find((x) => x.modelo === resto.join(":"));
    return m ? m.herramientas : proveedores().some((p) => p.id === cuenta) ? true : null;
  }
  const m = (await modelosOllama())?.find((x) => `ollama:${x.modelo}` === modelo);
  return m ? m.herramientas : null;
}

ipcMain.handle("plantillas", () =>
  equipo.listarPlantillas().map((p) => ({ id: p.id, ...p.identidad, procedimientos: p.procedimientos })),
);
ipcMain.handle("empleado", (_e, id: unknown) => {
  const e = equipo.buscar(String(id));
  if (!e) return undefined;
  const clavePrecio = e.modelo.startsWith("nube:") ? e.modelo.slice(5) : "";
  return {
    nombre: e.nombre, rol: e.rol, color: e.color, modelo: e.modelo, herramientas: e.herramientas, instrucciones: e.instrucciones, motor: e.motor, procedimientos: equipo.procedimientos(e.id),
    tope: e.tope ?? TOPE_POR_DEFECTO, gastado: gasto.delMes(e.id), precio: clavePrecio ? gasto.precio(clavePrecio) : undefined,
  };
});
// Gasto de un empleado en la nube: precio del modelo (tabla editable, USD por millón de tokens) y tope mensual.
function limpiarGasto(modelo: string, datos: unknown): { tope?: number; error?: string } {
  if (!modelo.startsWith("nube:")) return {};
  const d = datos as { tope?: unknown; precio?: { entrada?: unknown; salida?: unknown } };
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : typeof v === "string" && v.trim() !== "" && Number(v) >= 0 ? Number(v) : NaN);
  const entrada = num(d.precio?.entrada), salida = num(d.precio?.salida), tope = num(d.tope ?? TOPE_POR_DEFECTO);
  if (!Number.isFinite(entrada) || !Number.isFinite(salida)) {
    if (!gasto.precio(modelo.slice(5))) return { error: "no conozco el precio de ese modelo: ponlo (USD por millón de tokens de entrada y de salida; 0 si es tu propio servidor)" };
  } else gasto.ponerPrecio(modelo.slice(5), { entrada, salida });
  if (!Number.isFinite(tope) || tope <= 0) return { error: "el tope mensual debe ser un número mayor que 0" };
  return { tope };
}
ipcMain.handle("crear-empleado", async (_e, datos: unknown, plantilla: unknown) => {
  const identidad = limpiarIdentidad(datos);
  if (!identidad) return { error: "falta el nombre o el modelo" };
  const conHerramientas = await modeloConHerramientas(identidad.modelo);
  if (conHerramientas === null) return { error: "ese modelo ya no está disponible" };
  const g = limpiarGasto(identidad.modelo, datos);
  if (g.error) return { error: g.error };
  const origen = typeof plantilla === "string" && equipo.plantilla(plantilla) ? plantilla : undefined;
  const e = equipo.crear(identidad, conHerramientas, origen);
  if (g.tope) equipo.cambiarTope(e.id, g.tope);
  return { id: e.id };
});
ipcMain.handle("guardar-empleado", async (_e, id: unknown, datos: unknown) => {
  const identidad = limpiarIdentidad(datos);
  if (!identidad || !equipo.buscar(String(id))) return { error: "falta el nombre o el modelo" };
  const conHerramientas = await modeloConHerramientas(identidad.modelo);
  if (conHerramientas === null) return { error: "ese modelo ya no está disponible" };
  const g = limpiarGasto(identidad.modelo, datos);
  if (g.error) return { error: g.error };
  equipo.actualizar(String(id), identidad, conHerramientas);
  if (g.tope) equipo.cambiarTope(String(id), g.tope);
  return {};
});
// Hoja de configuración: especificaciones del equipo y el único enlace externo de la app (los créditos).
ipcMain.handle("especificaciones", () => especificaciones());
ipcMain.handle("abrir-enlace", (_e, url: unknown) => {
  if (url === "https://discajapon.com") void shell.openExternal(url);
});
ipcMain.handle("abrir-carpeta", async (_e, id: unknown) => {
  if (!equipo.buscar(String(id))) return;
  await shell.openPath(equipo.dir(String(id)));
});

// Borrador de perfil a partir de una descripción del puesto, redactado por qwen. El usuario lo revisa.
ipcMain.handle("borrador-empleado", async (_e, descripcion: unknown) => {
  const texto = typeof descripcion === "string" ? descripcion.trim().slice(0, 1500) : "";
  if (!texto) return { error: "describe el puesto" };
  if (estadoServidor.fase !== "listo") return { error: "qwen todavía no está listo" };
  const instrucciones =
    "Redactas perfiles de empleados de IA para Discalaves. Responde SOLO con el archivo, sin explicaciones ni bloques de código, con este formato exacto:\n" +
    "---\nnombre: <nombre corto del puesto>\nrol: <rol en pocas palabras>\n" +
    `color: <uno de: ${COLORES.join(", ")}>\nmodelo: qwen\n` +
    `herramientas: <separadas por comas, elegidas de: ${PRINCIPALES.join(", ")}; terminal solo si el puesto programa o administra sistemas>\n` +
    "---\n\nTono: <una frase>\n\nReglas:\n- <de 3 a 5 reglas del puesto>\n\n" +
    "Menos de 120 palabras en total. Una de las reglas es de honestidad: no fingir saber; si el puesto maneja normas, leyes o cifras oficiales, " +
    "buscarlas en fuentes oficiales, citarlas y pedir confirmación antes de darlas como definitivas.";
  try {
    const r = await fetch(`http://127.0.0.1:${PUERTO}/v1/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${CLAVE}`, "content-type": "application/json" },
      body: JSON.stringify({ model: QWEN_MODELO, max_tokens: 500, temperature: 0.4, messages: [{ role: "system", content: instrucciones }, { role: "user", content: texto }] }),
      signal: AbortSignal.timeout(120_000),
    });
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    const salida = (j.choices?.[0]?.message?.content ?? "").replace(/^```\w*\n?|```\s*$/g, "").trim();
    return { borrador: { ...leerIdentidad(salida), modelo: "qwen" } };
  } catch (e) {
    return { error: `no pude redactar el borrador: ${(e as Error).message}` };
  }
});

// ---- Hilo compartido "Equipo": donde se ve a los empleados colaborar ----
// No copia mensajes: guarda los TRAMOS de cada colaboración (qué empleado, desde y hasta cuándo) y el hilo se
// arma con los mensajes de sus historiales dentro de esos tramos. Una colaboración empieza cuando un empleado le
// pasa trabajo a otro (o cuando el usuario escribe desde el hilo Equipo) y la forman la tarea que le encargó el
// usuario (la raíz) y las que se pasan por el camino.
const HILO = "_equipo"; // no choca con un empleado: sus ids empiezan por letra
interface Tramo { id: string; desde: number; hasta?: number }
type MensajeHilo = (Mensaje | { de: "separador"; texto: string; t: number }) & { quien?: string; a?: string };
const archivoHilo = () => path.join(carpetaConversaciones(), `${HILO}.json`);
let colaboraciones: Tramo[][] | undefined;
const abiertas = new Map<string, Tramo[]>(); // raíz (empleado al que el usuario le encargó la tarea) → sus tramos
const comienzos = new Map<string, number>(); // raíz → cuándo empezó su tarea

function leerColaboraciones(): Tramo[][] {
  try {
    return (colaboraciones ??= JSON.parse(fs.readFileSync(archivoHilo(), "utf8")));
  } catch {
    return (colaboraciones = []);
  }
}
function guardarColaboraciones() {
  fs.mkdirSync(carpetaConversaciones(), { recursive: true });
  fs.writeFileSync(archivoHilo(), JSON.stringify(leerColaboraciones(), null, 2));
  ventana?.webContents.send("equipo", [...abiertas.values()].flat().filter((x) => !x.hasta).map((x) => x.id));
  ventana?.webContents.send("estado", { id: HILO, estado: estadoHilo() });
}
const estadoHilo = (): Estado => (abiertas.size ? { fase: "escribiendo" } : { fase: "listo" });

// Abre (o sigue) la colaboración de una raíz; la primera vez incluye a la raíz desde que empezó su tarea.
function colaboracion(raiz: string): Tramo[] {
  let col = abiertas.get(raiz);
  if (!col) {
    col = [{ id: raiz, desde: comienzos.get(raiz) ?? Date.now() }];
    abiertas.set(raiz, col);
    leerColaboraciones().push(col);
  }
  return col;
}
function cerrarColaboracion(raiz: string) {
  const col = abiertas.get(raiz);
  if (!col) return;
  abiertas.delete(raiz);
  for (const x of col) x.hasta ??= Date.now();
  guardarColaboraciones();
}

// El hilo: los mensajes de cada tramo, en orden, con quién los dijo. El encargo que un empleado le pasa a otro
// se ve como un mensaje suyo dirigido al otro (no se repite su llamada a pasar_trabajo con la respuesta).
function hiloEquipo(): MensajeHilo[] {
  const nombre = (id: string) => conversaciones.find((c) => c.id === id)?.nombre ?? id;
  return leerColaboraciones().flatMap((col) => {
    const mensajes = col.flatMap((x) =>
      historialDe(x.id)
        .filter((m) => m.t >= x.desde && m.t <= (x.hasta ?? Infinity))
        .filter((m) => !(m.de === "herramienta" && m.nombre === "pasar_trabajo"))
        .map((m): MensajeHilo => {
          const encargo = m.de === "yo" && m.texto.match(/^\(tarea de (.+?)\) ([\s\S]*)$/);
          if (encargo) return { de: "ia", texto: encargo[2], t: m.t, quien: conversaciones.find((c) => c.nombre === encargo[1])?.id ?? encargo[1], a: x.id };
          return m.de === "yo" ? { ...m, a: x.id } : { ...m, quien: x.id };
        }),
    );
    if (!mensajes.length) return [];
    const quienes = [...new Set(col.map((x) => nombre(x.id)))];
    const titulo = quienes.length > 1 ? `${quienes.slice(0, -1).join(", ")} y ${quienes.at(-1)}` : quienes[0];
    return [{ de: "separador" as const, texto: titulo, t: col[0].desde }, ...mensajes.sort((a, b) => a.t - b.t)];
  });
}

// Las herramientas del perfil (procedimientos y memoria) se resuelven aquí; el resto, en su computadora.
// Una herramienta que no es de su puesto no se ejecuta aunque el modelo la pida.
async function usarHerramienta(c: Conversacion, l: Llamada, interfaz: Electron.WebContents, parar: AbortController, cadena: string[]) {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(l.argumentos || "{}");
  } catch {
    return { salida: "argumentos inválidos: no son JSON", codigo: -1 };
  }
  const texto = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : "");
  if (l.nombre === "leer_procedimiento") {
    cambiarEstado(c, { fase: "ejecutando", detalle: `leer procedimiento ${texto("nombre")}` });
    const p = equipo.leerProcedimiento(c.id, texto("nombre"));
    if (p) return { salida: p, codigo: 0 };
    return { salida: `no existe ese procedimiento. Tienes: ${equipo.procedimientos(c.id).map((x) => x.nombre).join(", ") || "ninguno"}`, codigo: 1 };
  }
  if (l.nombre === "recordar") return { salida: equipo.recordar(c.id, texto("texto")), codigo: 0 };
  if (!c.permitidas.includes(l.nombre)) return { salida: `no tienes la herramienta ${l.nombre} en tu puesto; hazlo con las que tienes o dilo.`, codigo: 1 };
  if (l.nombre === "pasar_trabajo") {
    const quien = texto("empleado").trim().toLowerCase();
    const otro = conversaciones.find((o) => o.id !== c.id && (o.nombre.toLowerCase() === quien || o.id === quien));
    if (!otro) return { salida: `no hay ningún compañero llamado "${texto("empleado")}". Tienes: ${conversaciones.filter((o) => o.id !== c.id).map((o) => o.nombre).join(", ")}.`, codigo: 1 };
    if (cadena.includes(otro.id)) return { salida: `${otro.nombre} está esperando tu resultado: no puede encargarse de esto ahora.`, codigo: 1 };
    if (!texto("tarea").trim()) return { salida: "falta la tarea", codigo: -1 };
    // Con varios trabajando a la vez: su hilo es de una tarea cada vez.
    if (trabajando.has(otro.id)) return { salida: `${otro.nombre} está ocupado con otra tarea; espera a que termine o encárgaselo a otro compañero.`, codigo: 1 };
    cambiarEstado(c, { fase: "ejecutando", detalle: `esperando a ${otro.nombre}` });
    const tramo: Tramo = { id: otro.id, desde: Date.now() };
    colaboracion(cadena[0] ?? c.id).push(tramo);
    guardarColaboraciones();
    try {
      const respuesta = await tarea(otro, `(tarea de ${c.nombre}) ${texto("tarea").trim()}`, interfaz, parar, [...cadena, c.id]);
      return { salida: `${otro.nombre} respondió:\n${respuesta.slice(0, 4000)}`, codigo: 0 };
    } catch (e) {
      if (parar.signal.aborted) throw e;
      return { salida: `${otro.nombre} no pudo hacerlo: ${(e as Error).message}`, codigo: 1 };
    } finally {
      tramo.hasta = Date.now();
      guardarColaboraciones();
    }
  }
  return ejecutarHerramienta(
    { ...computadora(c), avisar: (fase, detalle) => cambiarEstado(c, { fase, detalle }), aprobar: async (d) => c.libre === true || pedirAprobacion(c, interfaz, d) },
    l.nombre,
    l.argumentos,
  );
}

// Desde el hilo Equipo el mensaje empieza por @nombre: va a ese empleado y se ve en el hilo desde el principio.
function destinatario(entrada: string): { c: Conversacion; texto: string } | null {
  const t = entrada.replace(/^@/, "").toLowerCase();
  const c = conversaciones
    .filter((o) => t.startsWith(o.nombre.toLowerCase()) && /^($|[\s,:])/.test(t.slice(o.nombre.length)))
    .sort((a, b) => b.nombre.length - a.nombre.length)[0];
  return c ? { c, texto: entrada.replace(/^@/, "").slice(c.nombre.length).replace(/^[\s,:]+/, "") } : null;
}

ipcMain.handle("enviar", async (ev, id: unknown, entrada: unknown) => {
  let texto = typeof entrada === "string" ? entrada.trim().slice(0, 8000) : "";
  let c = buscar(id);
  const desdeHilo = id === HILO;
  if (desdeHilo) {
    leerConversaciones();
    const d = texto.startsWith("@") ? destinatario(texto) : null;
    if (!d) return { error: "empieza con @ y el nombre del empleado, por ejemplo: @Investigador busca…" };
    ({ c, texto } = d);
  }
  if (!c || !texto) return { error: "mensaje vacío" };
  if (estadoDe(c).fase !== "listo") return { error: `${c.nombre} no está listo` };
  // Los de qwen trabajan a la vez (ranuras de llama-server). Ollama carga otro modelo en la misma VRAM: no
  // trabaja a la vez que ningún otro local. Los de la nube y los remotos no usan la VRAM: sin límite.
  const otra = c.origen === "local" && conversaciones.find((o) => o.origen === "local" && trabajando.has(o.id) && (o.proveedor === "ollama" || c.proveedor === "ollama"));
  if (otra) return { error: `${otra.nombre} está trabajando; espera a que termine` };
  const parar = new AbortController();
  comienzos.set(c.id, Date.now());
  if (desdeHilo) {
    colaboracion(c.id);
    guardarColaboraciones();
  }
  try {
    await tarea(c, texto, ev.sender, parar);
    return {};
  } catch (e) {
    if (parar.signal.aborted) return {};
    const m = (e as Error).message;
    // Corte del proveedor (cuota, saldo, límite del plan, clave): se detiene y avisa con el motivo, sin reintentar.
    if (e instanceof Corte) return { error: `${c.nombre} se detuvo: ${m}` };
    const detalle = c.proveedor === "ollama" && m === "fetch failed" ? "Ollama no responde; ¿está en marcha?" : m;
    return { error: `no pude obtener respuesta: ${detalle}` };
  } finally {
    comienzos.delete(c.id);
    cerrarColaboracion(c.id);
  }
});

// Una tarea: el mensaje entra en el hilo del empleado y trabaja hasta terminar; devuelve su última respuesta.
// cadena: los compañeros que esperan su resultado (pasar_trabajo), para que no se encarguen trabajo en círculo.
async function tarea(c: Conversacion, texto: string, interfaz: Electron.WebContents, parar: AbortController, cadena: string[] = []): Promise<string> {
  if (c.proveedor === "codex") return tareaCodex(c, texto, interfaz, parar, cadena);
  if (c.openclaw) return tareaOpenClaw(c, texto, interfaz, parar);
  const historial = historialDe(c.id);
  historial.push({ de: "yo", texto, t: Date.now() });
  guardarHistorial(c.id);
  const decir = (t: string) => {
    historial.push({ de: "ia", texto: t, t: Date.now() });
    guardarHistorial(c.id);
    return t;
  };
  tareas.set(c.id, parar);
  const inicioTarea = historial.length - 1;
  let caida = ""; // túnel SSH caído: se detiene y avisa, sin reconectar en bucle
  const cuenta = proveedores().find((x) => x.id === c.cuenta);
  if (cuenta?.tipo === "tunel") await baseDe(cuenta); // abre el túnel antes de empezar (ssh puede preguntar)
  const olvidarTunel = c.cuenta ? tuneles.get(c.cuenta)?.alCaer((m) => ((caida = m), parar.abort())) : undefined;
  try {
    const veces = new Map<string, number>(); // cuántas veces pidió cada llamada exacta en esta tarea
    const verificadas = new Set<string>();
    let avisos: string[] = [];
    for (;;) {
      if (parar.signal.aborted) throw new Error("detenida");
      const pausa = await antesDeGastar(c, interfaz);
      if (pausa) return decir(pausa);
      cambiarEstado(c, { fase: "escribiendo" });
      const { texto, llamadas, uso } = await turno(c, interfaz, parar.signal, avisos);
      anotarGasto(c, uso);
      avisos = [];
      if (texto || llamadas.length) historial.push({ de: "ia", texto, t: Date.now(), ...(llamadas.length && { llamadas }) });
      guardarHistorial(c.id);
      if (!llamadas.length) {
        const fallo = c.herramientas ? verificar(texto, historial.slice(inicioTarea), verificadas) : null;
        if (!fallo) return texto;
        verificadas.add(fallo.tipo);
        historial.pop(); // la respuesta falsa no se queda en el hilo
        guardarHistorial(c.id);
        avisos = [fallo.aviso];
        interfaz.send("paso", c.id);
        continue;
      }
      let pregunta = ""; // preguntar: la tarea se para hasta que el usuario responda
      for (const l of llamadas) {
        const firma = `${l.nombre} ${l.argumentos}`;
        const n = (veces.get(firma) ?? 0) + 1;
        veces.set(firma, n);
        if (n >= MAX_REPETICIONES) return decir(`me detuve: intenté ${n} veces lo mismo (${l.nombre}) sin avanzar. ¿Me das otra pista?`);
        let r: { salida: string; codigo: number };
        if (pregunta) r = { salida: "no se hizo: esperas la respuesta del usuario", codigo: 1 };
        else if (n >= AVISO_REPETICION) r = { salida: `ya hiciste exactamente esto ${n - 1} veces; no lo repito. Prueba otro camino o termina con lo que tienes.`, codigo: 1 };
        else if (l.nombre === "preguntar" && c.permitidas.includes("preguntar")) {
          pregunta = argumento(l, "pregunta");
          r = pregunta ? { salida: "pregunta hecha; su respuesta llega en el próximo mensaje", codigo: 0 } : { salida: "falta la pregunta", codigo: -1 };
        } else r = await usarHerramienta(c, l, interfaz, parar, cadena);
        historial.push({ de: "herramienta", ...l, ...r, t: Date.now() });
        guardarHistorial(c.id);
      }
      interfaz.send("paso", c.id);
      if (pregunta) return decir(pregunta);
    }
  } catch (e) {
    if (caida) {
      decir(`se cayó la conexión con ${c.donde} (${caida}); me detuve. Escríbeme de nuevo cuando quieras que reconecte.`);
      throw new Corte(`se cayó el túnel a ${c.donde}`);
    }
    if (parar.signal.aborted) decir("me detuviste. Aquí lo dejo; dime si sigo o cambio algo.");
    throw e;
  } finally {
    olvidarTunel?.();
    tareas.delete(c.id);
    trabajando.delete(c.id);
    avisarEstado(c);
  }
}

// ChatGPT vía Codex: el bucle es el de Codex, pero cada herramienta llega aquí (por MCP, ver codex.ts) y pasa
// por lo mismo que con el bucle propio: herramientas del puesto, aprobaciones, modo libre, Detener,
// detección de repeticiones y verificación de honestidad al final.
async function tareaCodex(c: Conversacion, texto: string, interfaz: Electron.WebContents, parar: AbortController, cadena: string[]): Promise<string> {
  const historial = historialDe(c.id);
  const guardar = (m: Mensaje) => (historial.push(m), guardarHistorial(c.id));
  const decir = (t: string) => (guardar({ de: "ia", texto: t, t: Date.now() }), t);
  guardar({ de: "yo", texto, t: Date.now() });
  tareas.set(c.id, parar);
  const inicioTarea = historial.length - 1;
  const corte = new AbortController(); // Detener o demasiadas repeticiones
  const alDetener = () => corte.abort();
  parar.signal.addEventListener("abort", alDetener);
  const veces = new Map<string, number>();
  let repeticion = "";
  const companeros = conversaciones.filter((o) => o.id !== c.id).map((o) => ({ nombre: o.nombre, rol: o.rol }));
  const llamar = async (nombre: string, argumentos: string) => {
    const l: Llamada = { id: `codex-${Date.now()}-${veces.size}`, nombre, argumentos };
    const firma = `${nombre} ${argumentos}`;
    const n = (veces.get(firma) ?? 0) + 1;
    veces.set(firma, n);
    if (n >= MAX_REPETICIONES) {
      repeticion = `me detuve: intenté ${n} veces lo mismo (${nombre}) sin avanzar. ¿Me das otra pista?`;
      corte.abort();
      return { salida: "detenido", codigo: 1 };
    }
    let r: { salida: string; codigo: number };
    if (n >= AVISO_REPETICION) r = { salida: `ya hiciste exactamente esto ${n - 1} veces; no lo repito. Prueba otro camino o termina con lo que tienes.`, codigo: 1 };
    else if (nombre === "preguntar" && c.permitidas.includes("preguntar")) r = { salida: "escribe esa pregunta como tu respuesta final y termina; la tarea sigue cuando el usuario responda", codigo: 0 };
    else r = await usarHerramienta(c, l, interfaz, parar, cadena);
    guardar({ de: "ia", texto: "", t: Date.now(), llamadas: [l] }); // mismo formato que el bucle propio
    guardar({ de: "herramienta", ...l, ...r, t: Date.now() });
    interfaz.send("paso", c.id);
    cambiarEstado(c, { fase: "escribiendo" });
    return r;
  };
  try {
    const verificadas = new Set<string>();
    let avisos: string[] = [];
    for (;;) {
      cambiarEstado(c, { fase: "escribiendo" });
      const { texto: respuesta } = await codex.ejecutar({
        modelo: c.modelo,
        instrucciones: promptSistema(c),
        prompt: transcripcion(c, avisos),
        herramientas: definicionesPara(c.permitidas, equipo.procedimientos(c.id).length > 0, companeros),
        llamar,
        alTexto: (t) => interfaz.send("trozo", { id: c.id, texto: t }),
        senal: corte.signal,
      });
      const fallo = verificar(respuesta, historial.slice(inicioTarea), verificadas);
      if (!fallo) return decir(respuesta);
      verificadas.add(fallo.tipo);
      avisos = [fallo.aviso];
      interfaz.send("paso", c.id);
    }
  } catch (e) {
    if (repeticion && !parar.signal.aborted) return decir(repeticion);
    if (parar.signal.aborted) decir("me detuviste. Aquí lo dejo; dime si sigo o cambio algo.");
    throw e;
  } finally {
    parar.signal.removeEventListener("abort", alDetener);
    tareas.delete(c.id);
    trabajando.delete(c.id);
    avisarEstado(c);
  }
}

// OpenClaw: el bucle y las herramientas son de OpenClaw (openclaw.ts); la app ve cada herramienta antes y después
// por su plugin (puenteOpenClaw) y pone en el hilo los pasos, las aprobaciones y Detener, como con el bucle propio.
let openclaw: OpenClaw;
async function tareaOpenClaw(c: Conversacion, texto: string, interfaz: Electron.WebContents, parar: AbortController): Promise<string> {
  const historial = historialDe(c.id);
  const decir = (t: string) => (historial.push({ de: "ia", texto: t, t: Date.now() }), guardarHistorial(c.id), t);
  historial.push({ de: "yo", texto, t: Date.now() });
  guardarHistorial(c.id);
  tareas.set(c.id, parar);
  try {
    cambiarEstado(c, { fase: "escribiendo" });
    openclaw.configurar(conversaciones.filter((o) => o.openclaw).map((o) => ({ id: o.id, usuario: o.usuario, herramientas: o.permitidas })));
    await computadora(c).computadora.encender((d) => cambiarEstado(c, { fase: "ejecutando", detalle: d }));
    cambiarEstado(c, { fase: "escribiendo" });
    return decir(await openclaw.enviar(c.id, texto, (t) => interfaz.send("trozo", { id: c.id, texto: t }), parar.signal));
  } catch (e) {
    if (parar.signal.aborted) decir("me detuviste. Aquí lo dejo; dime si sigo o cambio algo.");
    else if ((e as Error).message.startsWith("me detuve")) return decir((e as Error).message);
    throw e;
  } finally {
    tareas.delete(c.id);
    trabajando.delete(c.id);
    avisarEstado(c);
  }
}

// Acciones delicadas con herramientas de OpenClaw (misma regla que delicado() en herramientas.ts).
// ponytail: los clics de su navegador van por referencia (e12), sin texto: solo se aprueba enviar formularios.
function delicadoOC(herramienta: string, p: Record<string, unknown>): string | null {
  const orden = String(p.command ?? "");
  if (herramienta === "exec" && BORRADO.test(orden)) return `borrar con: ${orden}`;
  if (herramienta === "apply_patch" && /\*\*\* Delete File/.test(String(p.input ?? ""))) return "borrar archivos con un parche";
  const r = (p.request ?? {}) as Record<string, unknown>;
  if (herramienta === "browser" && (r.submit === true || (r.kind === "press" && /enter/i.test(String(r.key))))) return "enviar un formulario con el navegador";
  return null;
}

function puenteOpenClaw() {
  const conv = (agente: string) => {
    const c = buscar(agente);
    if (!c) throw new Error(`empleado desconocido: ${agente}`);
    return c;
  };
  return {
    cdp: (agente: string) => computadora(conv(agente)).computadora.cdp(),
    async antes(agente: string, herramienta: string, parametros: Record<string, unknown>) {
      const c = conv(agente);
      if (tareas.get(c.id)?.signal.aborted) return { bloquear: true, motivo: "el usuario te detuvo" };
      const pc = computadora(c).computadora;
      if (herramienta === "browser" && pc.controlUsuario) return { bloquear: true, motivo: "el usuario tomó el control de tu navegador; espera a que lo devuelva o pregúntale." };
      cambiarEstado(c, { fase: "ejecutando", detalle: `${herramienta} ${String(parametros.command ?? parametros.path ?? parametros.url ?? parametros.targetUrl ?? "")}`.trim() });
      const accion = delicadoOC(herramienta, parametros);
      if (accion && c.libre !== true && ventana && !(await pedirAprobacion(c, ventana.webContents, accion))) return { bloquear: true, motivo: "el usuario no lo permitió; no se hizo nada" };
      return {};
    },
    despues(agente: string, herramienta: string, parametros: Record<string, unknown>, resultado: unknown, error: unknown) {
      const c = buscar(agente);
      if (!c) return;
      const contenido = (resultado as { content?: { text?: string }[] })?.content?.map((x) => x.text ?? "").join("\n") ?? "";
      const l: Llamada = { id: `openclaw-${Date.now()}`, nombre: herramienta, argumentos: JSON.stringify(parametros) };
      const h = historialDe(c.id);
      h.push({ de: "ia", texto: "", t: Date.now(), llamadas: [l] }); // mismo formato que el bucle propio
      h.push({ de: "herramienta", ...l, salida: (error ? String(typeof error === "string" ? error : JSON.stringify(error)) : contenido).slice(0, 3000) || "(sin salida)", codigo: error ? 1 : 0, t: Date.now() });
      guardarHistorial(c.id);
      ventana?.webContents.send("paso", c.id);
      cambiarEstado(c, { fase: "escribiendo" });
    },
  };
}

// ponytail: Codex empieza cada tarea sin memoria; se le pasa la conversación reciente como texto.
function transcripcion(c: Conversacion, avisos: string[]): string {
  const lineas = contexto(c).map((m) => {
    if (m.role === "user") return `Usuario: ${m.content}`;
    if (m.role === "tool") return `[resultado de herramienta] ${m.content.slice(0, 600)}`;
    return m.content ? `Tú: ${m.content}` : "";
  });
  return `Conversación hasta ahora (la última línea del usuario es el encargo actual):\n\n${lineas.filter(Boolean).join("\n\n")}${avisos.map((a) => `\n\n(aviso de la app, no del usuario) ${a}`).join("")}`;
}

function argumento(l: Llamada, clave: string): string {
  try {
    const v = JSON.parse(l.argumentos || "{}")[clave];
    return typeof v === "string" ? v.trim() : "";
  } catch {
    return "";
  }
}

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

// Primer arranque: WSL (Windows) y descarga del runtime, el modelo y Podman. Al terminar, arranca el modelo
// (o reinicia la app si cambió el motor de contenedores, que se elige al cargar).
registrarWsl(ipcMain, (reiniciar) => {
  if (reiniciar) return setTimeout(() => { app.relaunch(); app.quit(); }, 1500).unref();
  if (!servidor) iniciarServidor();
});

app.whenReady().then(() => {
  if (!primera) return;
  if (!APARTE) apagarTodas(); // restos de una sesión que se cerró mal
  equipo = new Empleados(app.getPath("userData"), path.join(__dirname, "..", "plantillas"));
  const datos = app.getPath("userData");
  boveda = new Boveda(path.join(datos, "proveedores.cifrado"), {
    // Linux: "basic_text" significa que no hay llavero y safeStorage cifraría con una clave fija: no vale.
    disponible: () => safeStorage.isEncryptionAvailable() && (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text"),
    cifrar: (t) => safeStorage.encryptString(t),
    descifrar: (b) => safeStorage.decryptString(b),
  });
  gasto = new Gasto(datos);
  codex = new Codex(path.join(datos, "codex"));
  // ponytail: 16k por empleado de OpenClaw; el servidor comparte 12k × RANURAS (-kvu), así que con varios a la vez puede faltar
  openclaw = new OpenClaw(path.join(datos, "openclaw"), { url: `http://127.0.0.1:${PUERTO}`, clave: CLAVE, modelo: QWEN_MODELO, contexto: 16384 }, puenteOpenClaw());
  migrarConversaciones();
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
  for (const t of tuneles.values()) t.cerrar();
  openclaw?.apagar();
  if (!APARTE) apagarTodas(); // no deja contenedores corriendo
});
