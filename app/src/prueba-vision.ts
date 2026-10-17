// Prueba con Qwen 3.5 9B de verdad (npm run prueba:vision): necesita llama.cpp, el modelo y su mmproj en
// DISCALAVES_IA (o ~/Documents/IA-discalves), Docker y la GPU. Empleados propios de la prueba (nunca los del
// usuario: sus computadoras se llaman distinto). Comprueba:
//   escritorio  abre mousepad desde su escritorio, escribe una frase y la guarda solo con capturas y coordenadas
//   buscador    en una web usa el buscador del sitio (escribe, envía, abre un resultado) y deja un informe
//   listo-1     criterio 1 de "listo": investiga en la web y deja un informe (modo texto)
//   listo-2     criterio 2 de "listo": investiga y le pasa el resultado a otro, que lo resume
// Con argumentos se corren solo esas: node dist/prueba-vision.js escritorio buscador
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron } from "playwright-core";
import { borrar, computadoraDe } from "./computadora";
import { rutas } from "./rutas";

const PRUEBAS = process.argv.slice(2).length ? process.argv.slice(2) : ["escritorio", "buscador", "listo-1", "listo-2"];

async function main() {
  for (const f of [rutas.servidor, rutas.modelo, rutas.mmproj]) if (!fs.existsSync(f)) return console.log(`visión (app): omitida, falta ${f}`);
  const datos = fs.mkdtempSync(path.join(os.tmpdir(), "discalaves-vision-"));
  fs.mkdirSync(path.join(datos, "empleados")); // sin migración: ningún empleado (ni computadora) del usuario
  const app = await _electron.launch({ args: [path.join(__dirname, "..")], env: { ...process.env, DISCALAVES_DATOS: datos } as Record<string, string> });
  const usuarios: string[] = [];
  const informe: string[] = [];
  try {
    const w = await app.firstWindow();
    await w.waitForFunction(() => "discalaves" in window);
    const api = <T>(f: string, ...a: unknown[]) => w.evaluate(([f, a]) => (window as any).discalaves[f as string](...(a as unknown[])), [f, a] as const) as Promise<T>;
    // Aprueba todo lo delicado y lo anota (con o sin captura marcada).
    await w.evaluate(() => {
      (window as any).aprobadas = [];
      (window as any).discalaves.alAprobacion((p: any) => {
        (window as any).aprobadas.push({ descripcion: p.descripcion, captura: !!p.captura });
        void (window as any).discalaves.aprobar(p.id, true);
      });
    });
    const plantillas = await api<any[]>("plantillas");
    const crear = async (nombre: string, plantilla: string | null, herramientas?: string[]) => {
      const p = plantilla ? plantillas.find((x) => x.id === plantilla) : { rol: "", color: "azul", instrucciones: "" };
      const r = await api<{ id?: string; error?: string }>("crearEmpleado", { ...p, nombre, modelo: "qwen", herramientas: herramientas ?? p.herramientas }, plantilla ?? undefined);
      assert.ok(r.id, r.error);
      usuarios.push(r.id!);
      return r.id!;
    };
    const tarea = async (id: string, texto: string) => {
      for (let i = 0; (await api<any>("estado", id)).fase !== "listo"; i++) {
        assert.ok(i < 240, `qwen no se puso listo: ${JSON.stringify(await api<any>("estado", id))}`);
        await new Promise((r) => setTimeout(r, 500));
      }
      const t0 = Date.now();
      const r = await api<{ error?: string }>("enviar", id, texto);
      const h = await api<any[]>("historial", id);
      const pasos = h.filter((m) => m.de === "herramienta");
      const usadas = [...new Set(pasos.map((m) => m.nombre))];
      const capturas = pasos.filter((m) => m.imagen).length;
      return { error: r.error, h, pasos, usadas, capturas, seg: Math.round((Date.now() - t0) / 1000), final: h.filter((m) => m.de === "ia").at(-1)?.texto ?? "" };
    };
    const carpeta = (id: string) => rutas.trabajo(id);

    if (PRUEBAS.includes("escritorio")) {
      const id = await crear("Visor Escritorio", null, ["escritorio"]);
      const r = await tarea(id, "Abre el editor de texto Mousepad desde el menú de aplicaciones de tu escritorio, escribe la frase «Discalaves ve su pantalla» y guarda el archivo como frase.txt en tu carpeta de inicio. Usa capturas, clics y el teclado.");
      const archivo = path.join(carpeta(id), "frase.txt");
      const contenido = fs.existsSync(archivo) ? fs.readFileSync(archivo, "utf8").trim() : "(no existe)";
      informe.push(`escritorio: ${r.seg} s, ${r.pasos.length} pasos, ${r.capturas} capturas, herramientas [${r.usadas.join(", ")}], frase.txt = ${JSON.stringify(contenido)}${r.error ? `, ERROR ${r.error}` : ""}`);
      assert.ok(r.usadas.every((n) => ["captura_pantalla", "clic", "mover_raton", "arrastrar", "escribir_texto", "pulsar_teclas", "desplazar", "ampliar"].includes(n)), "usó algo que no son capturas y coordenadas");
      assert.match(contenido, /Discalaves ve su pantalla/i, `no guardó la frase. Última respuesta: ${r.final.slice(0, 300)}`);
    }
    if (PRUEBAS.includes("buscador")) {
      const id = await crear("Visor Buscador", "investigador");
      const r = await tarea(id, "Entra en https://es.wikipedia.org y usa el buscador de la propia Wikipedia (no buscar_web) para buscar «mariposa monarca». Abre el artículo del resultado y déjame un informe breve en informes/monarca.md.");
      const archivo = path.join(carpeta(id), "informes", "monarca.md");
      const tam = fs.existsSync(archivo) ? fs.statSync(archivo).size : 0;
      const escribio = r.pasos.find((m) => (m.nombre === "escribir_en" || m.nombre === "escribir_texto") && /monarca/i.test(m.argumentos));
      const paginas = r.pasos.filter((m) => /url: https:\/\/es\.wikipedia\.org\/wiki\/[^\s]*[Mm]onarca/.test(m.salida ?? "")).length;
      informe.push(`buscador: ${r.seg} s, ${r.pasos.length} pasos, ${r.capturas} capturas, herramientas [${r.usadas.join(", ")}], escribió en el buscador: ${escribio ? escribio.nombre : "no"}, páginas del artículo: ${paginas}, informe ${tam} bytes${r.error ? `, ERROR ${r.error}` : ""}`);
      assert.ok(escribio, "no escribió en el buscador del sitio");
      assert.ok(paginas > 0, "no abrió el artículo");
      assert.ok(tam > 200, `no dejó el informe. Última respuesta: ${r.final.slice(0, 300)}`);
    }
    if (PRUEBAS.includes("listo-1") || PRUEBAS.includes("listo-2")) {
      const inv = await crear("Visor Investigador", "investigador");
      if (PRUEBAS.includes("listo-1")) {
        const r = await tarea(inv, "Investiga en la web qué es la fotosíntesis y déjame un informe en informes/fotosintesis.md");
        const archivo = path.join(carpeta(inv), "informes", "fotosintesis.md");
        const tam = fs.existsSync(archivo) ? fs.statSync(archivo).size : 0;
        informe.push(`listo-1: ${r.seg} s, ${r.pasos.length} pasos, ${r.capturas} capturas, herramientas [${r.usadas.join(", ")}], informe ${tam} bytes${r.error ? `, ERROR ${r.error}` : ""}`);
        assert.ok(tam > 200, `criterio 1: sin informe. Última respuesta: ${r.final.slice(0, 300)}`);
      }
      if (PRUEBAS.includes("listo-2")) {
        await crear("Visor Redactor", "redactor");
        const r = await tarea(inv, "Lee https://es.wikipedia.org/wiki/Volcán y pásale lo que encuentres a Visor Redactor para que lo resuma en 3 frases. Dame su resumen.");
        const paso = r.pasos.find((m) => m.nombre === "pasar_trabajo");
        informe.push(`listo-2: ${r.seg} s, ${r.pasos.length} pasos, pasó trabajo: ${paso ? (paso.codigo === 0 ? "sí, respondió" : `falló: ${paso.salida.slice(0, 120)}`) : "no"}${r.error ? `, ERROR ${r.error}` : ""}`);
        assert.ok(paso && paso.codigo === 0, `criterio 2: no pasó el trabajo. Última respuesta: ${r.final.slice(0, 300)}`);
      }
    }
    const aprobadas = await w.evaluate(() => (window as any).aprobadas);
    if (aprobadas.length) informe.push(`aprobaciones: ${aprobadas.map((a: any) => `${a.descripcion}${a.captura ? " (con captura)" : ""}`).join("; ")}`);
    console.log(`visión (app): ok\n  ${informe.join("\n  ")}`);
  } catch (e) {
    console.log(`visión (app): FALLÓ\n  ${informe.join("\n  ")}`);
    throw e;
  } finally {
    await app.close().catch(() => {});
    for (const u of usuarios) await borrar(computadoraDe("", u)).catch(() => {});
    if (!process.env.DISCALAVES_PRUEBA_CONSERVAR) {
      for (const u of usuarios) fs.rmSync(rutas.trabajo(u), { recursive: true, force: true });
      fs.rmSync(datos, { recursive: true, force: true });
    } else console.log(`  datos en ${datos}`);
  }
}
main().then(() => process.exit(0), (e) => (console.error(String(e.stack ?? e)), process.exit(1)));
