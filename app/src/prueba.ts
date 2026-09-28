// Comprueba el aislamiento de las computadoras de las IAs (contenedores reales, sin modelo): npm run prueba
// La primera vez construye la imagen de Debian (varios minutos).
import assert from "node:assert/strict";
import fs from "node:fs";
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

  let r = await correr("terminal", { comando: "echo hola && pwd && . /etc/os-release && echo $ID $VERSION_CODENAME" });
  assert.equal(r.codigo, 0, r.salida);
  assert.match(r.salida, /hola\n\/home\/prueba\ndebian trixie/);

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

  // Un enlace simbólico hacia fuera no debe permitir escribir fuera de la carpeta.
  await correr("terminal", { comando: `ln -s ${fuera} escape` });
  await correr("escribir_archivo", { ruta: "escape", contenido: "x" });
  assert.equal(fs.existsSync(fuera), false, "escribir_archivo escapó del contenedor");

  // Borrar necesita aprobación; si el usuario dice que no, no se borra.
  await correr("terminal", { comando: "ls && rm -rf informes" });
  assert.equal(pedidas, 1);
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
