// Configuración → Cursor personalizado en la app real (npm run prueba:configuracion): se abre la hoja, se carga un
// cursor (el diálogo de archivos se sustituye por uno que devuelve la ruta), se ve el estado, se guarda en los datos
// del usuario como Xcursor y "Usar el de Discalaves" lo quita. También un archivo roto y uno que no es un cursor.
// Sin empleados: no enciende ninguna computadora.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron } from "playwright-core";
import { leerXcursor } from "./cursor";

// .cur de 32 bits, 32×32, punto activo (5, 3), todo verde.
function cur(): Buffer {
  const lado = 32, dib = Buffer.alloc(40 + lado * lado * 4 + lado * 4);
  [40, lado, lado * 2].forEach((v, i) => dib.writeInt32LE(v, i * 4));
  dib.writeUInt16LE(1, 12); dib.writeUInt16LE(32, 14);
  for (let i = 0; i < lado * lado; i++) dib.writeUInt32LE(0xff00ff00, 40 + i * 4);
  const cab = Buffer.alloc(22);
  cab.writeUInt16LE(2, 2); cab.writeUInt16LE(1, 4); cab[6] = lado; cab[7] = lado;
  cab.writeUInt16LE(5, 10); cab.writeUInt16LE(3, 12); cab.writeUInt32LE(dib.length, 14); cab.writeUInt32LE(22, 18);
  return Buffer.concat([cab, dib]);
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "discalaves-config-"));
  const datos = path.join(tmp, "datos");
  fs.mkdirSync(path.join(datos, "empleados"), { recursive: true }); // sin migración: ningún empleado
  const archivos = { bueno: path.join(tmp, "verde.cur"), roto: path.join(tmp, "roto.cur"), texto: path.join(tmp, "notas.txt") };
  fs.writeFileSync(archivos.bueno, cur());
  fs.writeFileSync(archivos.roto, cur().subarray(0, 200));
  fs.writeFileSync(archivos.texto, "esto no es un cursor, son unas notas");
  const app = await _electron.launch({ args: [path.join(__dirname, "..")], env: { ...process.env, DISCALAVES_DATOS: datos } as Record<string, string> });
  try {
    const w = await app.firstWindow();
    await w.waitForFunction(() => "discalaves" in window);
    const elegir = (ruta: string | null) =>
      app.evaluate(({ dialog }, r) => {
        dialog.showOpenDialog = (async () => ({ canceled: !r, filePaths: r ? [r] : [] })) as typeof dialog.showOpenDialog;
      }, ruta);
    const estado = () => w.locator("#config-cursor-estado").innerText();
    const guardado = path.join(datos, "cursor.xcursor");

    await w.click("#configuracion");
    await w.waitForSelector("#config[open]");
    await w.waitForFunction(() => document.getElementById("config-cursor-estado")!.textContent !== "");
    assert.match(await estado(), /neón de Discalaves/);
    assert.equal(await w.isVisible("#config-cursor-restablecer"), false);

    // Uno propio: se convierte, se guarda en sus datos y la hoja lo dice.
    await elegir(archivos.bueno);
    await w.click("#config-cursor-cargar");
    await w.waitForFunction(() => /propio cursor/.test(document.getElementById("config-cursor-estado")!.textContent ?? ""));
    const x = leerXcursor(fs.readFileSync(guardado));
    assert.deepEqual([x.length, x[0].ancho, x[0].xhot, x[0].yhot, x[0].nominal], [1, 48, 8, 5, 48], "Xcursor guardado: 48 px, punto activo escalado");
    assert.equal(await w.isVisible("#config-cursor-restablecer"), true);

    console.log("configuración (cursor): ok");
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
main().then(() => process.exit(0), (e) => (console.error(String(e.stack ?? e)), process.exit(1)));
