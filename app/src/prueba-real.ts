// Prueba de la app real contra el servidor remoto de verdad (npm run prueba:real). Solo si existe la variable de
// entorno DISCALAVES_PRUEBA_CLAVE (la clave nunca se imprime ni se escribe). DISCALAVES_PRUEBA_URL cambia el
// servidor (por defecto https://ai.hpc.cedia.edu.ec); DISCALAVES_PRUEBA_VENTANA da la ventana si el servidor no la dice.
// Dos empleados a la vez, uno con herramientas nativas y otro con el respaldo en texto, cumplen el criterio 1 en su
// contenedor investigando de verdad en la web.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron } from "playwright-core";
import { borrar, computadoraDe } from "./computadora";

const CLAVE = process.env.DISCALAVES_PRUEBA_CLAVE;
const URL = process.env.DISCALAVES_PRUEBA_URL ?? "https://ai.hpc.cedia.edu.ec";
const MODELOS = (process.env.DISCALAVES_PRUEBA_MODELOS ?? "cedia-qwen-large,cedia-chat-standard").split(",");
const sinClave = (t: string) => (CLAVE ? t.split(CLAVE).join("***") : t);

async function main() {
  if (!CLAVE) return console.log("real (app): omitida, no existe DISCALAVES_PRUEBA_CLAVE");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "discalaves-real-"));
  const datos = path.join(tmp, "datos"), ia = path.join(tmp, "ia");
  const app = await _electron.launch({
    args: [path.join(__dirname, "..")],
    env: { ...process.env, DISCALAVES_DATOS: datos, DISCALAVES_IA: ia, DISCALAVES_LLAVERO: process.env.DISCALAVES_LLAVERO || "gnome-libsecret" } as Record<string, string>,
  });
  const usuarios: string[] = [];
  try {
    const w = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.hide());
    await w.waitForFunction(() => "discalaves" in window);
    const api = <T>(f: string, ...a: unknown[]) => w.evaluate(([f, a]) => (window as any).discalaves[f as string](...(a as unknown[])), [f, a] as const) as Promise<T>;
    const p = await api<{ id: string; error?: string }>("guardarProveedor", { tipo: "remoto", nombre: "Servidor real", url: URL, clave: CLAVE });
    assert.ok(p.id, sinClave(p.error ?? ""));
    const s = await api<{ servidor?: any; error?: string }>("probarProveedor", p.id);
    assert.equal(s.error, undefined, sinClave(s.error ?? ""));
    const detectada = (await api<any>("proveedores")).proveedores.find((x: any) => x.id === p.id).url.replace(/^https?:\/\/[^/]+/, "");
    const modos: Record<string, string> = {};
    for (const m of MODELOS) {
      const a = await api<{ servidor?: any; error?: string }>("servidorAjustes", p.id, { modelo: m, contexto: process.env.DISCALAVES_PRUEBA_VENTANA ?? "32768" });
      assert.equal(a.error, undefined, sinClave(a.error ?? ""));
      modos[m] = a.servidor.herramientas;
    }
    const act = await api<{ error?: string }>("servidorActivar", p.id, true);
    assert.equal(act.error, undefined, sinClave(act.error ?? ""));
    const herramientas = ["terminal", "buscar_web", "abrir_pagina", "escribir_archivo"];
    const ids: string[] = [];
    for (const [i, m] of MODELOS.entries()) {
      const r = await api<{ id?: string; error?: string }>("crearEmpleado", { nombre: `Real ${i + 1}`, rol: "", color: "azul", modelo: `nube:${p.id}:${m}`, herramientas, instrucciones: "" });
      assert.ok(r.id, r.error);
      usuarios.push(r.id!);
      ids.push(r.id!);
    }
    const t0 = Date.now();
    const rs = await Promise.all(ids.map((id, i) => api<{ error?: string }>("enviar", id, `Investiga en la web qué es la computación cuántica y déjame un informe breve en informe${i}.md`)));
    const seg = Math.round((Date.now() - t0) / 1000);
    const resumen: string[] = [];
    for (const [i, id] of ids.entries()) {
      const h = await api<any[]>("historial", id);
      const usadas = [...new Set(h.filter((m) => m.de === "herramienta").map((m) => m.nombre))];
      const informe = path.join(ia, "trabajo", id, `informe${i}.md`);
      const ok = fs.existsSync(informe) ? fs.statSync(informe).size : 0;
      resumen.push(`${MODELOS[i]} (${modos[MODELOS[i]]}): ${rs[i].error ? "ERROR " + sinClave(rs[i].error!) : "terminó"}, informe ${ok} bytes, herramientas [${usadas.join(", ")}], ${h.filter((m) => m.de === "herramienta").length} pasos`);
      assert.ok(ok > 200, `${MODELOS[i]} no dejó un informe: ${sinClave(JSON.stringify(h.at(-1)).slice(0, 400))}`);
    }
    console.log(`real (app): ok en ${seg} s, dos a la vez; ruta base ${detectada}\n  ${resumen.join("\n  ")}`);
  } finally {
    await app.close().catch(() => {});
    for (const u of usuarios) await borrar(computadoraDe("", u)).catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
main().then(() => process.exit(0), (e) => (console.error(sinClave(String(e.stack ?? e))), process.exit(1)));
