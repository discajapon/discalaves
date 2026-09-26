import { app, BrowserWindow, ipcMain } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ponytail: rutas y puerto fijos para un solo empleado; el instalador y el gestor de modelos los definirán.
const IA = process.env.DISCALAVES_IA ?? path.join(os.homedir(), "Documents", "IA-discalves");
const SERVIDOR = path.join(IA, "llama.cpp", "llama-server");
const MODELO = path.join(IA, "modelos", "Qwen3.5-9B-Q4_K_M.gguf");
const PUERTO = 8089;
const CLAVE = randomBytes(24).toString("hex"); // sin clave, cualquier web abierta en el navegador podría usar el servidor
const CONTEXTO_MENSAJES = 20; // ponytail: ventana fija de historial; resumir cuando las conversaciones crezcan

const SISTEMA =
  "Eres qwen, un empleado de Discalaves que corre en la computadora del usuario. " +
  "Responde en el idioma del usuario, de forma breve y clara. Si no sabes algo o no puedes hacerlo, dilo. " +
  "Todavía no tienes acceso a internet, archivos ni herramientas: por ahora solo puedes conversar.";

interface Mensaje { de: "yo" | "qwen"; texto: string; t: number }
type Estado = { fase: "cargando" | "listo" | "escribiendo" } | { fase: "error"; detalle: string };

const archivoHistorial = () => path.join(app.getPath("userData"), "conversaciones", "qwen.json");
let historial: Mensaje[] = [];
let estado: Estado = { fase: "cargando" };
let servidor: ChildProcess | undefined;
let ventana: BrowserWindow | undefined;
let saliendo = false;

function cambiarEstado(nuevo: Estado) {
  estado = nuevo;
  ventana?.webContents.send("estado", estado);
}

function leerHistorial() {
  try {
    historial = JSON.parse(fs.readFileSync(archivoHistorial(), "utf8"));
  } catch {
    historial = [];
  }
}

function guardarHistorial() {
  fs.mkdirSync(path.dirname(archivoHistorial()), { recursive: true });
  fs.writeFileSync(archivoHistorial(), JSON.stringify(historial, null, 2));
}

function iniciarServidor() {
  for (const f of [SERVIDOR, MODELO]) {
    if (!fs.existsSync(f)) return cambiarEstado({ fase: "error", detalle: `no encuentro ${f}` });
  }
  const log = fs.openSync(path.join(app.getPath("userData"), "llama-server.log"), "w");
  servidor = spawn(SERVIDOR, [
    "-m", MODELO, "--host", "127.0.0.1", "--port", String(PUERTO), "--api-key", CLAVE,
    "-c", "8192", "-np", "1",
    "-fitt", "256", // margen de VRAM bajo: con el de 1 GB por defecto, en 8 GB quedan capas en CPU y va a la mitad de velocidad
    "--reasoning", "off", "--no-webui",
  ], { stdio: ["ignore", log, log] });
  servidor.on("exit", (codigo) => {
    servidor = undefined;
    if (!saliendo) cambiarEstado({ fase: "error", detalle: `el modelo se detuvo (código ${codigo}); revisa llama-server.log` });
  });
  const esperar = async () => {
    if (!servidor) return;
    const ok = await fetch(`http://127.0.0.1:${PUERTO}/health`).then((r) => r.ok, () => false);
    if (ok) cambiarEstado({ fase: "listo" });
    else setTimeout(esperar, 1000);
  };
  esperar();
}

async function* trozos(respuesta: Response) {
  const lector = respuesta.body!.pipeThrough(new TextDecoderStream()).getReader();
  let resto = "";
  for (;;) {
    const { value, done } = await lector.read();
    if (done) return;
    const lineas = (resto + value).split("\n");
    resto = lineas.pop()!;
    for (const l of lineas) {
      if (!l.startsWith("data: ") || l === "data: [DONE]") continue;
      const t = JSON.parse(l.slice(6)).choices?.[0]?.delta?.content;
      if (t) yield t as string;
    }
  }
}

ipcMain.handle("historial", () => historial);
ipcMain.handle("estado", () => estado);
ipcMain.handle("enviar", async (ev, entrada: unknown) => {
  const texto = typeof entrada === "string" ? entrada.trim().slice(0, 8000) : "";
  if (!texto || estado.fase !== "listo") return { error: "qwen no está listo" };

  historial.push({ de: "yo", texto, t: Date.now() });
  guardarHistorial();
  cambiarEstado({ fase: "escribiendo" });
  let respuesta = "";
  try {
    const r = await fetch(`http://127.0.0.1:${PUERTO}/v1/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${CLAVE}`, "content-type": "application/json" },
      body: JSON.stringify({
        stream: true,
        messages: [
          { role: "system", content: SISTEMA },
          ...historial.slice(-CONTEXTO_MENSAJES).map((m) => ({ role: m.de === "yo" ? "user" : "assistant", content: m.texto })),
        ],
      }),
    });
    if (!r.ok) throw new Error(`el servidor respondió ${r.status}`);
    for await (const t of trozos(r)) {
      respuesta += t;
      ev.sender.send("trozo", t);
    }
    return {};
  } catch (e) {
    return { error: `no pude obtener respuesta: ${(e as Error).message}` };
  } finally {
    // Aunque falle a medias, lo recibido se guarda para no perderlo.
    if (respuesta.trim()) historial.push({ de: "qwen", texto: respuesta.trim(), t: Date.now() });
    guardarHistorial();
    if ((estado as Estado).fase === "escribiendo") cambiarEstado({ fase: "listo" }); // pudo pasar a "error" mientras tanto
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
  leerHistorial();
  iniciarServidor();
  crearVentana();
});
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
  saliendo = true;
  servidor?.kill();
});
