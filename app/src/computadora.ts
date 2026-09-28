// Computadora de cada IA: un contenedor con Debian 13, escritorio XFCE, Chromium con ventana y
// KasmVNC (ver app/computadora/Dockerfile). Es el ÚNICO módulo que llama al motor de contenedores:
// docker por defecto, podman con DISCALAVES_MOTOR=podman (el Dockerfile es OCI estándar).
//
// Endurecimiento: la IA trabaja como usuario sin privilegios y sin capacidades (no puede escribir fuera de
// su /home), no-new-privileges, límites de memoria y procesos, puertos solo en 127.0.0.1, y del equipo
// solo se monta su carpeta. Su "sudo" es root DENTRO de su contenedor (exec -u 0), con las capacidades
// mínimas para que apt funcione; nunca toca el sistema del usuario.
//
// El contenedor persiste entre sesiones (lo que instale con sudo se conserva): se detiene al cerrar la
// app y se reanuda al volver; se recrea si cambia la imagen.
// ponytail: la red del contenedor llega a la red local de la casa; hace falta un motor rootless con
// red propia (o reglas de firewall) para cerrarla.
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MOTOR = process.env.DISCALAVES_MOTOR ?? "docker";
const IMAGEN = "discalaves-computadora";
const DIR_IMAGEN = path.join(__dirname, "..", "computadora");
const ETIQUETA = "discalaves.computadora=1";
const UID = String(process.getuid?.() ?? 1000); // el mismo uid que el usuario del equipo: los archivos de su carpeta son suyos
const GID = String(process.getgid?.() ?? 1000);
const CAPACIDADES_ROOT = ["CHOWN", "DAC_OVERRIDE", "FOWNER", "SETUID", "SETGID"]; // lo justo para apt/dpkg como root

export interface Resultado { salida: string; codigo: number }

function motor(args: string[], opciones: { entrada?: string; tiempo?: number } = {}): Promise<Resultado> {
  return new Promise((resolver) => {
    const hijo = spawn(MOTOR, args, { timeout: opciones.tiempo, stdio: ["pipe", "pipe", "pipe"] });
    const trozos: Buffer[] = [];
    hijo.stdout.on("data", (b) => trozos.push(b));
    hijo.stderr.on("data", (b) => trozos.push(b));
    hijo.stdin.end(opciones.entrada ?? "");
    hijo.on("error", (e) => resolver({ salida: `no se pudo ejecutar ${MOTOR}: ${e.message}`, codigo: -1 }));
    hijo.on("close", (codigo, senal) =>
      resolver({ salida: Buffer.concat(trozos).toString("utf8") + (senal ? `\n[detenido: superó ${(opciones.tiempo ?? 0) / 1000} s]` : ""), codigo: codigo ?? -1 }),
    );
  });
}

async function motorOk(args: string[], opciones: { entrada?: string; tiempo?: number } = {}): Promise<string> {
  const r = await motor(args, opciones);
  if (r.codigo !== 0) throw new Error(`${MOTOR} ${args[0]}: ${r.salida.trim().split("\n").slice(-3).join(" ")}`);
  return r.salida.trim();
}

// La imagen base se construye (o se confirma en caché) una vez por sesión de la app.
let imagenBase: Promise<string> | undefined;
const construirBase = () =>
  (imagenBase ??= motorOk(["build", "-q", "-t", `${IMAGEN}:base`, DIR_IMAGEN], { tiempo: 30 * 60_000 }).catch((e) => {
    imagenBase = undefined;
    throw e;
  }));

// Capa mínima con el usuario de la IA: así /etc/passwd lo conoce sin darle permisos para editarlo.
async function construirUsuario(usuario: string): Promise<string> {
  await construirBase();
  const archivo = [
    `FROM ${IMAGEN}:base`,
    `RUN groupadd -g ${GID} ${usuario} && useradd -u ${UID} -g ${GID} -d /home/${usuario} -M -s /bin/bash ${usuario}`,
    `USER ${UID}:${GID}`,
    `WORKDIR /home/${usuario}`,
    `ENV HOME=/home/${usuario} USER=${usuario}`,
  ].join("\n");
  const etiqueta = `${IMAGEN}:${usuario}`;
  await motorOk(["build", "-q", "-t", etiqueta, "-"], { entrada: archivo, tiempo: 5 * 60_000 });
  return etiqueta;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ¿Responde bien esa dirección? Siempre lee el cuerpo: si se abandona sin leer y el servidor cierra la
// conexión, el cliente HTTP de Node (undici) falla con "assert(!this.paused)" y tumba el proceso principal.
export async function responde(url: string, init?: RequestInit): Promise<boolean> {
  try {
    const r = await fetch(url, init);
    await r.arrayBuffer();
    return r.ok;
  } catch {
    return false;
  }
}

export type Avisar = (detalle: string) => void;

export class Computadora {
  readonly nombre: string;
  readonly home: string;
  private readonly claveVer = randomBytes(18).toString("base64url");
  private readonly claveControl = randomBytes(18).toString("base64url");
  private arranque: Promise<void> | undefined;
  private navegador: Promise<string> | undefined;
  private puertoPantalla = "";
  controlUsuario = false; // mientras el usuario la controla, las herramientas le dicen a la IA que espere

  constructor(readonly carpeta: string, readonly usuario: string) {
    this.nombre = `discalaves-${usuario}`;
    this.home = `/home/${usuario}`;
  }

  // Arranca en su primer uso; la primera vez construye la imagen (varios minutos).
  encender(avisar: Avisar = () => {}): Promise<void> {
    return (this.arranque ??= this.arrancar(avisar).catch((e) => {
      this.arranque = undefined;
      throw e;
    }));
  }

  private async arrancar(avisar: Avisar) {
    avisar("encendiendo su computadora (la primera vez prepara Debian: puede tardar unos minutos)");
    const imagen = await construirUsuario(this.usuario);
    const idImagen = await motorOk(["image", "inspect", "-f", "{{.Id}}", imagen]);
    // Claves de KasmVNC de esta sesión: en un archivo que iniciar.sh lee y borra (el entorno de un
    // contenedor que se reanuda no se puede cambiar).
    fs.writeFileSync(path.join(this.carpeta, ".discalaves-claves"), `CLAVE_VER=${this.claveVer}\nCLAVE_CONTROL=${this.claveControl}\n`, { mode: 0o600 });
    const existente = await motor(["inspect", "-f", '{{index .Config.Labels "discalaves.imagen"}}', this.nombre]);
    if (existente.codigo === 0 && existente.salida.trim() === idImagen) {
      await motorOk(["start", this.nombre]);
    } else {
      await motor(["rm", "-f", this.nombre]);
      await motorOk([
        "run", "-d", "--name", this.nombre, "--label", ETIQUETA, "--label", `discalaves.imagen=${idImagen}`,
        "--hostname", this.usuario,
        "--cap-drop=ALL", ...CAPACIDADES_ROOT.flatMap((c) => ["--cap-add", c]), "--security-opt", "no-new-privileges",
        "--tmpfs", "/tmp", "--tmpfs", "/run",
        "--memory", "2g", "--pids-limit", "512", "--shm-size", "512m",
        "-p", "127.0.0.1::6901", "-p", "127.0.0.1::9223",
        "-v", `${this.carpeta}:${this.home}`,
        "-e", `TZ=${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
        imagen,
      ]);
    }
    this.puertoPantalla = await this.puerto(6901);
    for (let i = 0; i < 120; i++) {
      if (await responde(`http://${this.puertoPantalla}/`, { headers: { authorization: this.autorizacion("ver") } })) return;
      await esperar(250);
    }
    throw new Error("su escritorio no arrancó (revisa: " + MOTOR + " logs " + this.nombre + ")");
  }

  private async puerto(interno: number): Promise<string> {
    return (await motorOk(["port", this.nombre, String(interno)])).split("\n")[0];
  }

  private autorizacion(usuario: "ver" | "control") {
    const clave = usuario === "ver" ? this.claveVer : this.claveControl;
    return "Basic " + Buffer.from(`${usuario}:${clave}`).toString("base64");
  }

  // Ejecuta un comando dentro de su computadora, como su usuario (o como root de su contenedor, para
  // su "sudo"). El límite de tiempo va dentro del contenedor: matar "exec" desde fuera no lo detendría.
  async ejecutar(argumentos: string[], opciones: { entrada?: string; tiempo: number; root?: boolean }): Promise<Resultado> {
    await this.encender();
    const segundos = String(Math.ceil(opciones.tiempo / 1000));
    const usuario = opciones.root ? ["-u", "0", "-e", "HOME=/root"] : [];
    return motor(
      ["exec", "-i", ...usuario, "-w", this.home, this.nombre, "timeout", "-k", "5", segundos, ...argumentos],
      { entrada: opciones.entrada, tiempo: opciones.tiempo + 15_000 },
    );
  }

  // Dirección CDP del Chromium con ventana de su escritorio; lo abre si no está abierto.
  cdp(): Promise<string> {
    return (this.navegador ??= this.abrirChromium().catch((e) => {
      this.navegador = undefined;
      throw e;
    }));
  }

  // Si el usuario cierra la ventana de Chromium, la próxima herramienta vuelve a abrirlo.
  navegadorCerrado() {
    this.navegador = undefined;
  }

  private async abrirChromium(): Promise<string> {
    await this.encender();
    // El contenedor se detiene con la app, así que Chromium nunca se cierra "bien": se marca el perfil como
    // cerrado correctamente para que no pregunte "¿Quieres restaurar las páginas?".
    const perfil = `${this.home}/.navegador`;
    const marcarCerrado =
      `f="${perfil}/Default/Preferences"; [ -f "$f" ] && sed -i ` +
      `-e 's/"exit_type":"[A-Za-z]*"/"exit_type":"Normal"/' -e 's/"exited_cleanly":false/"exited_cleanly":true/' "$f"; exec "$@"`;
    await motorOk([
      "exec", "-d", this.nombre, "sh", "-c", marcarCerrado, "chromium",
      "chromium", "--no-sandbox", // el aislamiento lo da el contenedor
      "--test-type", // sin la barra de aviso de --no-sandbox
      "--hide-crash-restore-bubble",
      "--no-first-run", "--no-default-browser-check", "--start-maximized", "--lang=es-ES",
      "--remote-debugging-port=9222", `--user-data-dir=${perfil}`, "about:blank",
    ]);
    const direccion = `http://${await this.puerto(9223)}`;
    for (let i = 0; i < 80; i++) {
      if (await responde(`${direccion}/json/version`)) return direccion;
      await esperar(250);
    }
    throw new Error("Chromium no respondió en su escritorio");
  }

  // Pantalla en vivo: URL del cliente web de KasmVNC y credenciales según el modo (solo ver o control).
  async pantalla() {
    await this.encender();
    const usuario = this.controlUsuario ? "control" : "ver";
    // La calidad de imagen la fija el servidor (kasmvnc.yaml): KasmVNC ignora los ajustes de calidad del cliente.
    // logging=error: sus avisos de funciones opcionales que aquí no aplican (códecs de vídeo que Electron no
    // trae, canales de impresora y tarjeta inteligente) no llenan la consola; los errores sí se ven.
    const opciones = "autoconnect=true&resize=scale&show_control_bar=false&show_dot=false&logging=error" +
      "&clipboard_up=false&clipboard_down=false&clipboard_seamless=false";
    return {
      url: `http://${this.puertoPantalla}/?${opciones}`,
      origen: `http://${this.puertoPantalla}`,
      usuario,
      clave: usuario === "ver" ? this.claveVer : this.claveControl,
    };
  }
}

const computadoras = new Map<string, Computadora>();

export function computadoraDe(carpeta: string, usuario: string): Computadora {
  let c = computadoras.get(usuario);
  if (!c) computadoras.set(usuario, (c = new Computadora(carpeta, usuario)));
  return c;
}

// Detiene todas las computadoras de Discalaves que estén encendidas (también las que quedaran de una sesión
// que se cerró mal). Se conservan detenidas, con lo que tengan instalado. Síncrono a propósito: se llama al
// salir de la app, cuando ya no se puede esperar a promesas.
export function apagarTodas() {
  try {
    const ids = execFileSync(MOTOR, ["ps", "-q", "--filter", `label=${ETIQUETA}`], { encoding: "utf8", timeout: 10_000 }).split("\n").filter(Boolean);
    if (ids.length) execFileSync(MOTOR, ["stop", "-t", "3", ...ids], { timeout: 60_000, stdio: "ignore" });
  } catch {
    // sin motor de contenedores no hay nada que apagar
  }
}

// Borra una computadora (su sistema, no su carpeta). Para las pruebas.
export async function borrar(pc: Computadora) {
  await motor(["rm", "-f", pc.nombre]);
  computadoras.delete(pc.usuario);
}
