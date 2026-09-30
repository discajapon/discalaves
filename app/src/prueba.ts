// Comprueba el aislamiento de las computadoras de las IAs (contenedores reales, sin modelo): npm run prueba
// La primera vez construye la imagen de Debian (varios minutos).
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { borrar, computadoraDe } from "./computadora";
import { ejecutarHerramienta } from "./herramientas";
import { navegadorDe } from "./navegador";

function contexto(usuario: string, aprobar: () => Promise<boolean>) {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "discalaves-prueba-"));
  const computadora = computadoraDe(carpeta, usuario);
  return { carpeta, usuario, computadora, navegador: navegadorDe(computadora), avisar: () => {}, aprobar };
}

async function main() {
  const fuera = path.join(os.homedir(), `.discalaves-no-debe-existir-${process.pid}`);
  let pedidas = 0;
  const ctx = contexto("prueba", async () => (pedidas++, false));
  const correr = (nombre: string, args: object) => ejecutarHerramienta(ctx, nombre, JSON.stringify(args));
  // Su carpeta es suya: un enlace simbólico que deje ahí no debe hacer que la app escriba fuera al encenderla.
  fs.symlinkSync(fuera, path.join(ctx.carpeta, ".discalaves-claves"));

  let r = await correr("terminal", { comando: "echo hola && pwd && . /etc/os-release && echo $ID $VERSION_CODENAME" });
  assert.equal(r.codigo, 0, r.salida);
  assert.match(r.salida, /hola\n\/home\/prueba\ndebian trixie/);
  assert.equal(fs.existsSync(fuera), false, "la app siguió un enlace de la IA y escribió fuera de su carpeta");

  r = await correr("terminal", { comando: `ls ${os.homedir()}` });
  assert.notEqual(r.codigo, 0, "el contenedor no debe ver la carpeta personal");

  r = await correr("terminal", { comando: "grep CapEff /proc/self/status; test -e /var/run/docker.sock && echo SOCKET; touch /usr/x" });
  assert.match(r.salida, /CapEff:\s+0+\n/, "debe correr sin capacidades");
  assert.doesNotMatch(r.salida, /SOCKET/, "no debe ver el socket de Docker");
  assert.match(r.salida, /Permission denied/, "sin sudo no debe poder tocar su sistema");

  // sudo: root de SU contenedor (puede tocar su sistema), nunca del equipo.
  r = await correr("terminal", { comando: `sudo id -u && touch /usr/local/prueba-root && ls ${os.homedir()}` });
  assert.match(r.salida, /^0\n/, "sudo debe ser root dentro del contenedor");
  assert.notEqual(r.codigo, 0, "ni como root debe ver la carpeta personal");
  assert.equal(fs.existsSync("/usr/local/prueba-root"), false, "sudo no debe tocar el sistema del equipo");

  r = await correr("escribir_archivo", { ruta: "informes/a.md", contenido: "# hola\n" });
  assert.equal(r.codigo, 0, r.salida);
  assert.equal(fs.readFileSync(path.join(ctx.carpeta, "informes/a.md"), "utf8"), "# hola\n");

  r = await correr("editar_archivo", { ruta: "informes/a.md", buscar: "hola", reemplazar: "adiós" });
  assert.equal(r.codigo, 0, r.salida);
  r = await correr("leer_archivo", { ruta: "informes/a.md" });
  assert.equal(r.salida, "# adiós\n");
  r = await correr("editar_archivo", { ruta: "informes/a.md", buscar: "no está", reemplazar: "x" });
  assert.equal(r.codigo, 1, "editar sin coincidencia debe fallar");
  r = await correr("leer_web", { url: "file:///etc/passwd" });
  assert.notEqual(r.codigo, 0, "leer_web no debe leer archivos locales");
  r = await correr("leer_web", { url: "https://example.com" });
  assert.match(r.salida, /título: Example Domain/, r.salida);

  // Un enlace simbólico hacia fuera no debe permitir escribir fuera de la carpeta.
  await correr("terminal", { comando: `ln -s ${fuera} escape` });
  await correr("escribir_archivo", { ruta: "escape", contenido: "x" });
  assert.equal(fs.existsSync(fuera), false, "escribir_archivo escapó del contenedor");

  // Borrar necesita aprobación; si el usuario dice que no, no se borra.
  await correr("terminal", { comando: "ls && rm -rf informes" });
  await correr("terminal", { comando: "sudo rm -rf informes" });
  await correr("terminal", { comando: "find informes -type f -exec rm {} +" });
  assert.equal(pedidas, 3);
  assert.ok(fs.existsSync(path.join(ctx.carpeta, "informes/a.md")), "borró sin aprobación");

  r = await correr("terminal", { comando: "exit 3" });
  assert.equal(r.codigo, 3);

  // La pantalla en vivo y el CDP solo se publican en 127.0.0.1.
  assert.match((await ctx.computadora.pantalla()).url, /^http:\/\/127\.0\.0\.1:\d+\//);
  assert.match(await ctx.computadora.cdp(), /^http:\/\/127\.0\.0\.1:\d+$/);

  // Otra IA tiene su propia computadora: otro /home y sin ver los archivos de la primera.
  const ctx2 = contexto("otra", async () => false);
  r = await ejecutarHerramienta(ctx2, "terminal", JSON.stringify({ comando: "pwd; ls /home; cat /home/prueba/informes/a.md" }));
  assert.match(r.salida, /^\/home\/otra\notra\n/, r.salida);
  assert.notEqual(r.codigo, 0, "una IA no debe ver la carpeta de otra");
  assert.notEqual(ctx.navegador, ctx2.navegador, "cada IA debe tener su propio navegador");

  // Tampoco debe llegar por la red a la computadora de otra (el CDP no pide clave).
  await ctx2.computadora.cdp();
  const ip = (await ejecutarHerramienta(ctx2, "terminal", JSON.stringify({ comando: "hostname -I" }))).salida.trim().split(/\s+/)[0];
  r = await correr("terminal", { comando: `curl -s -m 3 http://${ip}:9223/json/version` });
  assert.notEqual(r.codigo, 0, `una IA llegó al navegador de otra: ${r.salida}`);

  // Red local cerrada: ni el propio equipo (un servidor que escucha en todas sus interfaces, visto por la
  // puerta de enlace) ni el router de casa; internet sí. Y ni como root puede quitar el cortafuegos.
  const equipo = http.createServer((_q, s) => s.end("equipo")).listen(0, "0.0.0.0");
  await new Promise((r) => equipo.once("listening", r));
  const puertoEquipo = (equipo.address() as AddressInfo).port;
  // Dirección de un gateway en /proc/net/route (hex en little endian) → "a.b.c.d".
  const gateway = (tabla: string) => {
    const h = tabla.split("\n").map((l) => l.trim().split(/\s+/)).find((c) => c[1] === "00000000")?.[2];
    return h && Buffer.from(h, "hex").reverse().join(".");
  };
  const gwComputadora = gateway((await correr("terminal", { comando: "cat /proc/net/route" })).salida);
  assert.ok(gwComputadora, "no encontré la puerta de enlace de la computadora");
  r = await correr("terminal", { comando: `curl -s -m 4 http://${gwComputadora}:${puertoEquipo}/` });
  equipo.close();
  assert.doesNotMatch(r.salida, /equipo$/, `la computadora llegó a un servicio del equipo: ${r.salida}`);
  const router = gateway(fs.readFileSync("/proc/net/route", "utf8"));
  if (router) {
    r = await correr("terminal", { comando: `curl -s -m 4 -o /dev/null -w '%{http_code}' http://${router}/` });
    assert.notEqual(r.codigo, 0, `la computadora llegó al router de casa (${router}): ${r.salida}`);
  }
  r = await correr("terminal", { comando: "curl -s -m 10 -o /dev/null -w '%{http_code}' https://example.com" });
  assert.equal(r.salida.trim(), "200", `sin internet: ${r.salida}`);
  r = await correr("terminal", { comando: "sudo apt-get install -y -q nftables >/dev/null 2>&1; sudo nft flush ruleset" });
  assert.notEqual(r.codigo, 0, "root de la computadora pudo quitar el cortafuegos");
  r = await correr("terminal", { comando: `curl -s -m 4 http://192.168.0.1/ http://10.0.0.1/; echo fin` });
  assert.doesNotMatch(r.salida, /<html/i);

  for (const c of [ctx, ctx2]) {
    await borrar(c.computadora);
    fs.rmSync(c.carpeta, { recursive: true, force: true });
  }
  console.log("computadoras: ok");
}

main().catch(async (e) => {
  for (const u of ["prueba", "otra"]) await borrar(computadoraDe("", u));
  console.error(e);
  process.exit(1);
});
