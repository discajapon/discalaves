// La distro WSL propia de Discalaves en Windows ("discalaves"): donde corren las computadoras de los
// empleados, con Podman rootless y la misma imagen que en Linux. Este módulo solo habla con wsl.exe (y,
// para activar WSL, con PowerShell elevado); el motor de contenedores sigue siendo cosa de computadora.ts.
//
// Nada se activa sin permiso: la interfaz pregunta primero (ver pantalla de Windows en index.html).
// Nunca se toca el .wslconfig global del usuario: solo el /etc/wsl.conf de NUESTRA distro.
import { execFile, execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DISTRO, rutas, UID_DISTRO, USUARIO_DISTRO } from "./rutas";

// Raíz de Debian 13 (trixie) para amd64: la misma que usa el Dockerfile (debian:trixie-slim fijado por
// digest), descargada del registro oficial por el hash de su capa. Verificada con sha256 antes de importar.
export const RAIZ = {
  imagen: "library/debian",
  capa: "sha256:6b37362b3da78869050b894b799ad4df04f1f3b52774087db0d81151570244c8",
  bytes: 29_830_418,
};
const VERSION_PREPARADA = "1"; // subirla si cambia PREPARAR: la app vuelve a preparar la distro

// Se ejecuta como root dentro de la distro recién importada. Idempotente.
export const PREPARAR = `set -eu
export DEBIAN_FRONTEND=noninteractive
id -u ${USUARIO_DISTRO} >/dev/null 2>&1 || useradd -m -u ${UID_DISTRO} -s /bin/bash ${USUARIO_DISTRO}
grep -q '^${USUARIO_DISTRO}:' /etc/subuid || echo '${USUARIO_DISTRO}:100000:65536' >> /etc/subuid
grep -q '^${USUARIO_DISTRO}:' /etc/subgid || echo '${USUARIO_DISTRO}:100000:65536' >> /etc/subgid
apt-get update -q
apt-get install -y -q --no-install-recommends podman uidmap passt fuse-overlayfs ca-certificates nftables aardvark-dns
apt-get clean
mkdir -p /etc/containers/registries.conf.d
printf 'unqualified-search-registries = ["docker.io"]\\n' > /etc/containers/registries.conf.d/50-discalaves.conf
# Solo esta distro: su usuario por defecto, systemd (límites de memoria de Podman rootless) y sin acceso
# a los discos ni a los programas de Windows. El .wslconfig global del usuario no se toca.
cat > /etc/wsl.conf <<'FIN'
[user]
default=${USUARIO_DISTRO}
[boot]
systemd=true
[automount]
enabled=false
mountFsTab=false
[interop]
enabled=false
appendWindowsPath=false
FIN
mkdir -p /home/${USUARIO_DISTRO}/trabajo
chown -R ${USUARIO_DISTRO}:${USUARIO_DISTRO} /home/${USUARIO_DISTRO}
echo ${VERSION_PREPARADA} > /etc/discalaves-preparada
`;

// wsl.exe escribe sus propios mensajes (listas de distros, errores) en UTF-16LE; lo que ejecuta dentro
// de la distro sale en UTF-8. Esto decodifica cualquiera de los dos.
export function textoWsl(salida: Buffer): string {
  const utf16 = salida.length >= 2 && (salida[1] === 0 || (salida[0] === 0xff && salida[1] === 0xfe));
  return (utf16 ? salida.toString("utf16le") : salida.toString("utf8")).replace(/^﻿/, "").replace(/\0/g, "");
}

// Nombres de distro de "wsl.exe -l -q" (una por línea).
export function distrosDe(salida: Buffer): string[] {
  return textoWsl(salida).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

function wsl(args: string[], opciones: { entrada?: string; tiempo?: number } = {}): Promise<{ salida: string; codigo: number }> {
  return new Promise((resolver) => {
    const hijo = spawn("wsl.exe", args, { windowsHide: true, timeout: opciones.tiempo });
    const trozos: Buffer[] = [];
    hijo.stdout.on("data", (b) => trozos.push(b));
    hijo.stderr.on("data", (b) => trozos.push(b));
    hijo.on("error", (e) => resolver({ salida: e.message, codigo: -1 }));
    hijo.on("close", (codigo) => resolver({ salida: textoWsl(Buffer.concat(trozos)), codigo: codigo ?? -1 }));
    hijo.stdin.end(opciones.entrada ?? "");
  });
}

// ---- Estado ----

export type EstadoWsl =
  | { estado: "no-aplica" } // Linux: no hace falta WSL
  | { estado: "sin-wsl" | "sin-distro" | "lista"; memoriaGB: number; limiteWslGB: number };

let lista = false;
export const wslLista = () => lista;

export async function estadoWsl(): Promise<EstadoWsl> {
  if (!rutas.windows) return { estado: "no-aplica" };
  // WSL 2 da a su máquina virtual, por defecto, la mitad de la RAM del equipo (si el usuario no lo cambió en
  // su .wslconfig, que no tocamos).
  const memoriaGB = Math.round(os.totalmem() / 2 ** 30);
  const base = { memoriaGB, limiteWslGB: Math.floor(memoriaGB / 2) };
  if ((await wsl(["--status"], { tiempo: 20_000 })).codigo !== 0) return { estado: "sin-wsl", ...base };
  const hay = await new Promise<boolean>((r) =>
    execFile("wsl.exe", ["-l", "-q"], { encoding: "buffer", windowsHide: true, timeout: 20_000 }, (e, salida) =>
      r(!e && distrosDe(salida).some((d) => d.toLowerCase() === DISTRO)),
    ),
  );
  if (!hay) return { estado: "sin-distro", ...base };
  const version = await wsl(["-d", DISTRO, "-u", "root", "--", "cat", "/etc/discalaves-preparada"], { tiempo: 60_000 });
  lista = version.codigo === 0 && version.salida.trim() === VERSION_PREPARADA;
  return { estado: lista ? "lista" : "sin-distro", ...base };
}

// ---- Activar WSL (con permiso del usuario y elevación de Windows) ----

// Abre el diálogo de administrador de Windows (UAC) para "wsl --install --no-distribution". Devuelve si WSL
// ya responde o si hace falta reiniciar Windows.
export async function activarWsl(): Promise<"lista" | "reiniciar" | "cancelado"> {
  const orden = "Start-Process -FilePath wsl.exe -ArgumentList '--install','--no-distribution' -Verb RunAs -Wait";
  const r = await new Promise<number>((resolver) => {
    const hijo = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", orden], { windowsHide: true });
    hijo.on("error", () => resolver(-1));
    hijo.on("close", (codigo) => resolver(codigo ?? -1));
  });
  if (r !== 0) return "cancelado"; // el usuario dijo que no en el diálogo de Windows (o PowerShell falló)
  return (await wsl(["--status"], { tiempo: 20_000 })).codigo === 0 ? "lista" : "reiniciar";
}

// ---- Crear y preparar la distro ----

async function descargarRaiz(destino: string, avisar: (texto: string) => void) {
  const token = (await (
    await fetch(`https://auth.docker.io/token?service=registry.docker.io&scope=repository:${RAIZ.imagen}:pull`)
  ).json()) as { token: string };
  const r = await fetch(`https://registry-1.docker.io/v2/${RAIZ.imagen}/blobs/${RAIZ.capa}`, {
    headers: { authorization: `Bearer ${token.token}` },
  });
  if (!r.ok || !r.body) throw new Error(`no pude descargar Debian 13 (código ${r.status})`);
  const hash = createHash("sha256");
  const archivo = fs.createWriteStream(destino);
  let bytes = 0;
  for await (const trozo of r.body as unknown as AsyncIterable<Uint8Array>) {
    hash.update(trozo);
    archivo.write(trozo);
    bytes += trozo.length;
    avisar(`descargando Debian 13: ${Math.round((bytes / RAIZ.bytes) * 100)} %`);
  }
  await new Promise((listo) => archivo.end(listo));
  if (`sha256:${hash.digest("hex")}` !== RAIZ.capa) {
    fs.rmSync(destino, { force: true });
    throw new Error("la descarga de Debian 13 no coincide con su sha256; no se usa");
  }
}

export async function prepararDistro(avisar: (texto: string) => void): Promise<void> {
  const carpeta = rutas.distro!;
  fs.mkdirSync(carpeta, { recursive: true });
  const distros = distrosDe(execFileSync("wsl.exe", ["-l", "-q"], { windowsHide: true, timeout: 20_000 }));
  if (!distros.some((d) => d.toLowerCase() === DISTRO)) {
    const raiz = path.join(carpeta, "debian-13.tar.gz");
    await descargarRaiz(raiz, avisar);
    avisar("creando la distro de Discalaves en WSL");
    const r = await wsl(["--import", DISTRO, carpeta, raiz, "--version", "2"], { tiempo: 10 * 60_000 });
    fs.rmSync(raiz, { force: true });
    if (r.codigo !== 0) throw new Error(`wsl --import falló: ${r.salida.trim()}`);
  }
  avisar("instalando Podman en la distro (unos minutos)");
  const p = await wsl(["-d", DISTRO, "-u", "root", "--", "sh", "-s"], { entrada: PREPARAR, tiempo: 30 * 60_000 });
  if (p.codigo !== 0) throw new Error(`no pude preparar la distro: ${p.salida.trim().split("\n").slice(-3).join(" ")}`);
  apagarDistro(); // reinicia la distro para que tome su wsl.conf (usuario, systemd, sin discos de Windows)
  if ((await estadoWsl()).estado !== "lista") throw new Error("la distro no quedó preparada");
}

// ---- Encendido y apagado ----

// ¿Está la distro encendida? Sin arrancarla (consultarla con -d la encendería).
export function distroEnMarcha(): boolean {
  try {
    const salida = execFileSync("wsl.exe", ["-l", "--running", "-q"], { timeout: 10_000, windowsHide: true });
    return distrosDe(salida).some((d) => d.toLowerCase() === DISTRO);
  } catch {
    return false;
  }
}

// Apaga la distro entera: libera su memoria al cerrar la app.
export function apagarDistro() {
  try {
    execFileSync("wsl.exe", ["--terminate", DISTRO], { timeout: 30_000, windowsHide: true, stdio: "ignore" });
  } catch {
    // ya estaba apagada o no existe
  }
}
