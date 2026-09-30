// Túnel SSH hacia un servidor remoto del usuario (por ejemplo, una supercomputadora): `ssh -N -L` con la
// configuración SSH del propio usuario (alias de host, ProxyJump, llaves). Lo que ssh pregunta (huella del
// servidor en el primer contacto, contraseña, frase de la llave) llega a la app por SSH_ASKPASS y se muestra
// en una ventana propia; la contraseña va de la ventana a ssh y no se guarda en ningún sitio (ni disco, ni
// logs, ni historial). La verificación del host es obligatoria (StrictHostKeyChecking=ask, known_hosts del
// usuario). Si el túnel se cae, avisa una vez y no se reconecta solo. Nada de SLURM ni trabajos en el clúster.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import path from "node:path";

export type Pregunta = { tipo: "huella" | "clave"; texto: string };
// Devuelve la respuesta del usuario (la contraseña, o "yes" para aceptar la huella); null si cancela.
export type Preguntar = (p: Pregunta, host: string) => Promise<string | null>;

// Solo alias o usuario@host: nada que ssh pueda leer como una opción.
export const sshValido = (s: string) => /^[A-Za-z0-9_][A-Za-z0-9._@-]*$/.test(s);

// El destino se escribe como una URL vista desde el host SSH, por ejemplo http://localhost:8000/v1.
export function destino(url: string): { host: string; puerto: number; ruta: string } | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return { host: u.hostname.replace(/^\[|\]$/g, ""), puerto: Number(u.port) || (u.protocol === "https:" ? 443 : 80), ruta: u.pathname.replace(/\/$/, "") };
  } catch {
    return null;
  }
}

const puertoLibre = () =>
  new Promise<number>((resolver, rechazar) => {
    const s = net.createServer();
    s.on("error", rechazar);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as AddressInfo).port;
      s.close(() => resolver(p));
    });
  });

const abierto = (puerto: number) =>
  new Promise<boolean>((resolver) => {
    const c = net.connect(puerto, "127.0.0.1");
    c.once("connect", () => (c.destroy(), resolver(true)));
    c.once("error", () => resolver(false));
  });

// ---- Puente SSH_ASKPASS: ssh ejecuta un script que le pasa la pregunta a la app por HTTP local con token ----
let puente: { url: string; token: string; preguntas: Map<string, { host: string; preguntar: Preguntar }> } | undefined;

async function iniciarPuente() {
  if (puente) return puente;
  const token = randomBytes(24).toString("hex");
  const preguntas = new Map<string, { host: string; preguntar: Preguntar }>();
  const s = http.createServer((req, res) => {
    let texto = "";
    req.on("data", (d) => (texto += d));
    req.on("end", async () => {
      const quien = preguntas.get(String(req.headers["x-tunel"]));
      if (req.headers.authorization !== `Bearer ${token}` || !quien) return void res.writeHead(403).end();
      const huella = /fingerprint|authenticity|continue connecting/i.test(texto);
      const r = await quien.preguntar({ tipo: huella ? "huella" : "clave", texto: texto.trim() }, quien.host).catch(() => null);
      if (r === null) return void res.writeHead(403).end();
      res.writeHead(200).end(huella ? (r === "yes" ? "yes" : "no") : r);
    });
  });
  await new Promise<void>((resolver) => s.listen(0, "127.0.0.1", resolver));
  s.unref();
  return (puente = { url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, token, preguntas });
}

// El programa que ssh ejecuta como SSH_ASKPASS: con el ejecutable de la app en modo Node (Electron) o con node.
function scriptAskpass(carpeta: string): string {
  fs.mkdirSync(carpeta, { recursive: true });
  const js = path.join(carpeta, "askpass.js");
  fs.writeFileSync(
    js,
    `const r=require("http").request(process.env.DISCALAVES_ASKPASS,{method:"POST",headers:{authorization:"Bearer "+process.env.DISCALAVES_ASKPASS_TOKEN,"x-tunel":process.env.DISCALAVES_TUNEL}},(s)=>{let b="";s.on("data",(d)=>(b+=d));s.on("end",()=>{if(s.statusCode!==200)process.exit(1);process.stdout.write(b+"\\n");});});r.on("error",()=>process.exit(1));r.end(process.argv[2]||"");\n`,
  );
  // ponytail: script de sh, solo Linux; en Windows hará falta un .cmd equivalente (ssh de Windows acepta SSH_ASKPASS).
  const sh = path.join(carpeta, "askpass.sh");
  fs.writeFileSync(sh, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec '${process.execPath.replace(/'/g, `'\\''`)}' '${js.replace(/'/g, `'\\''`)}' "$@"\n`, { mode: 0o700 });
  return sh;
}

export class Tunel {
  caido = false;
  motivo = "";
  private avisos = new Set<(motivo: string) => void>();
  private constructor(private proceso: ChildProcess, readonly puerto: number, readonly ssh: string) {}

  // opciones: solo para las pruebas (su propio archivo de configuración y known_hosts).
  static async abrir(ssh: string, url: string, carpeta: string, preguntar: Preguntar, opciones: string[] = []): Promise<Tunel> {
    const d = destino(url);
    if (!sshValido(ssh) || !d) throw new Error("el host SSH o la dirección del servidor no son válidos");
    const p = await iniciarPuente();
    const id = randomBytes(8).toString("hex");
    p.preguntas.set(id, { host: ssh, preguntar });
    const puerto = await puertoLibre();
    const proceso = spawn("ssh", [
      ...opciones,
      "-N", "-T",
      "-o", "StrictHostKeyChecking=ask", // la huella se confirma siempre en el primer contacto
      "-o", "ExitOnForwardFailure=yes",
      "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3", // así se nota si se cae
      "-o", "ControlMaster=no", "-o", "ControlPath=none",
      "-L", `127.0.0.1:${puerto}:${d.host.includes(":") ? `[${d.host}]` : d.host}:${d.puerto}`,
      ssh,
    ], {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
      env: { ...process.env, SSH_ASKPASS: scriptAskpass(carpeta), SSH_ASKPASS_REQUIRE: "force", DISPLAY: process.env.DISPLAY || ":0",
        DISCALAVES_ASKPASS: p.url, DISCALAVES_ASKPASS_TOKEN: p.token, DISCALAVES_TUNEL: id },
    });
    const t = new Tunel(proceso, puerto, ssh);
    let errores = "";
    proceso.stderr!.on("data", (d) => (errores = (errores + d).slice(-1000)));
    const termino = new Promise<void>((resolver) => proceso.on("close", () => resolver()));
    proceso.on("error", (e) => (errores = e.message));
    void termino.then(() => {
      p.preguntas.delete(id);
      t.caido = true;
      t.motivo = errores.trim().split("\n").filter((l) => !/^Warning: Permanently added/.test(l)).at(-1) || "ssh terminó";
      for (const f of t.avisos) f(t.motivo);
    });
    // Listo cuando el puerto local acepta conexiones; si ssh termina antes (clave rechazada, huella distinta), falla.
    for (;;) {
      if (t.caido) throw new Error(`no pude abrir el túnel a ${ssh}: ${t.motivo}`);
      if (await abierto(puerto)) return t;
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  base(url: string) {
    return `http://127.0.0.1:${this.puerto}${destino(url)?.ruta ?? ""}`;
  }
  alCaer(f: (motivo: string) => void) {
    this.avisos.add(f);
    return () => this.avisos.delete(f);
  }
  cerrar() {
    this.proceso.kill();
  }
}
