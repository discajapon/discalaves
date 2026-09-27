// Comprueba el aislamiento de las herramientas de las IAs (sin modelo ni sudo): npm run prueba
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ejecutarHerramienta } from "./herramientas";
import { navegadorDe } from "./navegador";

async function main() {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "discalaves-prueba-"));
  const fuera = path.join(os.homedir(), `.discalaves-no-debe-existir-${process.pid}`);
  let pedidas = 0;
  const ctx = { carpeta, usuario: "prueba", navegador: navegadorDe(carpeta, "prueba"), avisar: () => {}, aprobar: async () => (pedidas++, false) };
  const correr = (nombre: string, args: object) => ejecutarHerramienta(ctx, nombre, JSON.stringify(args));

  let r = await correr("terminal", { comando: "echo hola && pwd" });
  assert.equal(r.codigo, 0);
  assert.match(r.salida, /hola\n\/home\/prueba/);

  r = await correr("terminal", { comando: `ls ${os.homedir()}` });
  assert.notEqual(r.codigo, 0, "la caja no debe ver la carpeta personal");

  r = await correr("escribir_archivo", { ruta: "informes/a.md", contenido: "# hola\n" });
  assert.equal(r.codigo, 0, r.salida);
  assert.equal(fs.readFileSync(path.join(carpeta, "informes/a.md"), "utf8"), "# hola\n");

  // Un enlace simbólico hacia fuera no debe permitir escribir fuera de la carpeta.
  await correr("terminal", { comando: `ln -s ${fuera} escape` });
  await correr("escribir_archivo", { ruta: "escape", contenido: "x" });
  assert.equal(fs.existsSync(fuera), false, "escribir_archivo escapó de la caja");

  // Borrar necesita aprobación; si el usuario dice que no, no se borra.
  r = await correr("terminal", { comando: "ls && rm -rf informes" });
  assert.equal(pedidas, 1);
  assert.ok(fs.existsSync(path.join(carpeta, "informes/a.md")), "borró sin aprobación");

  r = await correr("terminal", { comando: "exit 3" });
  assert.equal(r.codigo, 3);

  // Otra IA tiene su propia computadora: otro /home y sin ver los archivos de la primera.
  const carpeta2 = fs.mkdtempSync(path.join(os.tmpdir(), "discalaves-prueba-"));
  const ctx2 = { ...ctx, carpeta: carpeta2, usuario: "otra", navegador: navegadorDe(carpeta2, "otra") };
  r = await ejecutarHerramienta(ctx2, "terminal", JSON.stringify({ comando: "pwd; ls /home; cat /home/prueba/informes/a.md" }));
  assert.match(r.salida, /^\/home\/otra\notra\n/, r.salida);
  assert.notEqual(r.codigo, 0, "una IA no debe ver la carpeta de otra");
  assert.notEqual(ctx.navegador, ctx2.navegador, "cada IA debe tener su propio navegador");
  fs.rmSync(carpeta2, { recursive: true, force: true });

  fs.rmSync(carpeta, { recursive: true, force: true });
  console.log("herramientas: ok");
}

main();
