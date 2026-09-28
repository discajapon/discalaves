// Computadora de cada IA: un contenedor con Debian 13, escritorio XFCE, Chromium con ventana y
// KasmVNC (ver app/computadora/Dockerfile). Es el ÚNICO módulo que llama al motor de contenedores:
// docker por defecto, podman con DISCALAVES_MOTOR=podman (el Dockerfile es OCI estándar).
//
// Endurecimiento: usuario sin privilegios, sin capacidades, no-new-privileges, raíz de solo lectura,
// límites de memoria y procesos, puertos solo en 127.0.0.1, y del equipo solo se monta su carpeta.
// ponytail: la red del contenedor llega a la red local de la casa; hace falta un motor rootless con
// red propia (o reglas de firewall) para cerrarla.
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";

const MOTOR = process.env.DISCALAVES_MOTOR ?? "docker";
const IMAGEN = "discalaves-computadora";
const DIR_IMAGEN = path.join(__dirname, "..", "computadora");
const ETIQUETA = "discalaves.computadora=1";
const UID = String(process.getuid?.() ?? 1000); // el mismo uid que el usuario del equipo: los archivos de su carpeta son suyos
const GID = String(process.getgid?.() ?? 1000);

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
    await motor(["rm", "-f", this.nombre]);
    await motorOk([
      "run", "-d", "--rm", "--name", this.nombre, "--label", ETIQUETA, "--hostname", this.usuario,
      "--cap-drop=ALL", "--security-opt", "no-new-privileges",
      "--read-only", "--tmpfs", "/tmp", "--tmpfs", "/run",
      "--memory", "2g", "--pids-limit", "512", "--shm-size", "512m",
      "-p", "127.0.0.1::6901", "-p", "127.0.0.1::9223",
      "-v", `${this.carpeta}:${this.home}`,
      "-e", `CLAVE_VER=${this.claveVer}`, "-e", `CLAVE_CONTROL=${this.claveControl}`,
      "-e", `TZ=${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
      imagen,
    ]);
    this.puertoPantalla = await this.puerto(6901);
    for (let i = 0; i < 120; i++) {
      const r = await fetch(`http://${this.puertoPantalla}/`, { headers: { authorization: this.autorizacion("ver") } }).catch(() => null);
      if (r?.ok) return;
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

  // Ejecuta un comando dentro de su computadora, como su usuario. El límite de tiempo va dentro del
  // contenedor: matar "exec" desde fuera no detendría el proceso.
  async ejecutar(argumentos: string[], opciones: { entrada?: string; tiempo: number }): Promise<Resultado> {
    await this.encender();
    const segundos = String(Math.ceil(opciones.tiempo / 1000));
    return motor(
      ["exec", "-i", "-w", this.home, this.nombre, "timeout", "-k", "5", segundos, ...argumentos],
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
    await motorOk([
      "exec", "-d", this.nombre, "chromium", "--no-sandbox", // el aislamiento lo da el contenedor
      "--test-type", // sin la barra de aviso de --no-sandbox
      "--no-first-run", "--no-default-browser-check", "--start-maximized", "--lang=es-ES",
      "--remote-debugging-port=9222", `--user-data-dir=${this.home}/.navegador`, "about:blank",
    ]);
    const direccion = `http://${await this.puerto(9223)}`;
    for (let i = 0; i < 80; i++) {
      if ((await fetch(`${direccion}/json/version`).catch(() => null))?.ok) return direccion;
      await esperar(250);
    }
    throw new Error("Chromium no respondió en su escritorio");
  }

  // Pantalla en vivo: URL del cliente web de KasmVNC y credenciales según el modo (solo ver o control).
  async pantalla() {
    await this.encender();
    const usuario = this.controlUsuario ? "control" : "ver";
    const opciones = "autoconnect=true&resize=scale&show_control_bar=false&show_dot=false" +
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

// Apaga todas las computadoras de Discalaves (también las que quedaran de una sesión que se cerró mal).
// Síncrono a propósito: se llama al salir de la app, cuando ya no se puede esperar a promesas.
export function apagarTodas() {
  try {
    const ids = execFileSync(MOTOR, ["ps", "-aq", "--filter", `label=${ETIQUETA}`], { encoding: "utf8", timeout: 10_000 }).split("\n").filter(Boolean);
    if (ids.length) execFileSync(MOTOR, ["rm", "-f", ...ids], { timeout: 30_000, stdio: "ignore" });
  } catch {
    // sin motor de contenedores no hay nada que apagar
  }
}
