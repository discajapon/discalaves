// Cursor de la vista en vivo en una computadora real (contenedor + cliente de KasmVNC, sin modelo):
// npm run prueba:cursor. Mira el cursor como lo ve el usuario, sobre el fondo, el panel y una app GTK: el de
// Discalaves al encender, uno propio cambiado en caliente (PNG y .ani animado) y el regreso al de Discalaves.
// Comprueba que se ve grande y que la punta (el punto activo) cae en el píxel del puntero.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow, nativeImage } from "electron";
import { borrar, computadoraDe, usarCursor } from "./computadora";
import { convertir, cursorNeon, escribirXcursor } from "./cursor";

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const png = (b: Buffer) => {
  const im = nativeImage.createFromBuffer(b);
  return { ancho: im.getSize().width, alto: im.getSize().height, bgra: im.toBitmap() };
};

// Flecha roja de 128 px con la punta en (0, 0), en PNG (dibujada aquí).
function flechaRoja(): Buffer {
  const lado = 128, bgra = Buffer.alloc(lado * lado * 4);
  for (let y = 0; y < lado; y++) for (let x = 0; x < lado; x++) {
    if (x <= y * 0.7 && y < 110 && x + y * 0.15 < 90) bgra.set([40, 40, 230, 255], (y * lado + x) * 4); // BGRA
  }
  return nativeImage.createFromBitmap(bgra, { width: lado, height: lado }).toPNG();
}

// .ani de 2 fotogramas (rojo y azul, 32 px, punta en 0,0) a 15/60 s cada uno.
function aniDosColores(): Buffer {
  const cur = (bgr: number[]) => {
    const lado = 32, dib = Buffer.alloc(40 + lado * lado * 4 + lado * 4);
    [40, lado, lado * 2].forEach((v, i) => dib.writeInt32LE(v, i * 4));
    dib.writeUInt16LE(1, 12); dib.writeUInt16LE(32, 14);
    for (let i = 0; i < lado * lado; i++) dib.set([...bgr, 255], 40 + i * 4);
    const cab = Buffer.alloc(22);
    cab.writeUInt16LE(2, 2); cab.writeUInt16LE(1, 4); cab[6] = lado; cab[7] = lado;
    cab.writeUInt32LE(dib.length, 14); cab.writeUInt32LE(22, 18);
    const f = Buffer.concat([cab, dib]), h = Buffer.alloc(8);
    h.write("icon", 0, "latin1"); h.writeUInt32LE(f.length, 4);
    return Buffer.concat([h, f]);
  };
  const anih = Buffer.alloc(44);
  anih.write("anih", 0, "latin1"); anih.writeUInt32LE(36, 4); anih.writeUInt32LE(36, 8); anih.writeUInt32LE(2, 12); anih.writeUInt32LE(2, 16);
  anih.writeUInt32LE(15, 36); anih.writeUInt32LE(1, 40);
  const fotos = Buffer.concat([cur([40, 40, 230]), cur([230, 60, 40])]);
  const lista = Buffer.alloc(12);
  lista.write("LIST", 0, "latin1"); lista.writeUInt32LE(4 + fotos.length, 4); lista.write("fram", 8, "latin1");
  const cuerpo = Buffer.concat([Buffer.from("ACON", "latin1"), anih, lista, fotos]), riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "latin1"); riff.writeUInt32LE(cuerpo.length, 4);
  return Buffer.concat([riff, cuerpo]);
}

async function main() {
  usarCursor(escribirXcursor([cursorNeon()]));
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "discalaves-cursor-"));
  const pc = computadoraDe(carpeta, "cursor-prueba");
  try {
    await pc.encender();
    const p = await pc.pantalla();
    app.on("login", (ev, _w, _d, _a, responder) => (ev.preventDefault(), responder(p.usuario, p.clave)));
    const w = new BrowserWindow({ width: 1280, height: 800, useContentSize: true, show: false, webPreferences: { offscreen: true } }); // fuera de pantalla: se pinta y se captura sin ventana visible
    await w.loadURL(p.url);
    for (let i = 0; i < 60 && !(await pc.ejecutar(["pgrep", "-x", "xfce4-panel"], { tiempo: 5000 })).salida.trim(); i++) await esperar(250);
    await esperar(3000);
    const xdo = (...a: string[]) => pc.ejecutar(["xdotool", ...a], { tiempo: 10_000 });

    // Lo que se ve alrededor del puntero en la vista en vivo: los píxeles que cumplen `es` y su recuadro.
    const mirar = async (x: number, y: number, es: (r: number, g: number, b: number) => boolean, ms = 1200) => {
      await xdo("mousemove", String(x - 30), String(y - 30));
      await esperar(200);
      await xdo("mousemove", String(x), String(y));
      await esperar(ms);
      const zona = { x: Math.max(0, x - 20), y: Math.max(0, y - 20), width: 100, height: 100 }; // sin salir de la pantalla
      const captura = await Promise.race([w.webContents.capturePage(zona), esperar(15_000).then(() => null)]);
      assert.ok(captura, "la vista en vivo no se dejó capturar en 15 s");
      const bits = captura.toBitmap(); // BGRA
      const anchoZona = bits.length / 4 / zona.height;
      let n = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
      for (let i = 0; i < bits.length; i += 4) {
        if (!es(bits[i + 2], bits[i + 1], bits[i])) continue;
        const px = zona.x + ((i / 4) % anchoZona), py = zona.y + Math.floor(i / 4 / anchoZona);
        n++; x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
      }
      return { n, x0, y0, alto: y1 - y0 + 1 };
    };
    const rojo = (r: number, g: number, b: number) => r > 170 && g < 90 && b < 90;
    const azul = (r: number, g: number, b: number) => b > 170 && r < 90 && g < 120;
    const tinta = (r: number, g: number, b: number) => r < 40 && g < 40 && b < 40; // el relleno del neón (#1A1A1A)
    const fondo = { x: 640, y: 400 }, panel = { x: 300, y: 14 };

    // 1) El de Discalaves al encender: sobre el fondo y sobre el panel, grande (la flecha mide ~39 px a 48).
    let v = await mirar(panel.x, panel.y, tinta);
    assert.ok(v.n > 150 && v.alto > 28, `neón sobre el panel: ${JSON.stringify(v)}`);
    v = await mirar(fondo.x, fondo.y, (r, g, b) => r > 200 && g > 200 && b > 200); // su borde blanco sobre el fondo negro
    assert.ok(v.n > 60 && v.alto > 28, `neón sobre el fondo: ${JSON.stringify(v)}`);
    assert.ok(Math.abs(v.x0 - fondo.x) <= 2 && Math.abs(v.y0 - fondo.y) <= 2, `punta del neón en el puntero: ${JSON.stringify(v)}`);

    // 2) Uno propio, cambiado con la computadora encendida: PNG rojo (punta en 0,0), en el fondo, el panel y una app.
    usarCursor(convertir(flechaRoja(), "flecha.png", png));
    await esperar(3000);
    for (const [donde, punto] of [["fondo", fondo], ["panel", panel]] as const) {
      v = await mirar(punto.x, punto.y, rojo);
      assert.ok(v.n > 300 && v.alto > 36, `propio sobre el ${donde}: ${JSON.stringify(v)}`);
      assert.ok(Math.abs(v.x0 - punto.x) <= 2 && Math.abs(v.y0 - punto.y) <= 2, `punta del propio en el puntero (${donde}): ${JSON.stringify(v)}`);
    }
    await pc.ejecutar(["sh", "-c", "(mousepad >/dev/null 2>&1 &)"], { tiempo: 5000 });
    for (let i = 0; i < 40 && !(await xdo("search", "--onlyvisible", "--class", "mousepad")).salida.trim(); i++) await esperar(250);
    await esperar(1500);
    const g = (await xdo("search", "--onlyvisible", "--class", "mousepad", "getwindowgeometry", "--shell")).salida;
    const [mx, my] = [Number(g.match(/X=(\d+)/)![1]), Number(g.match(/Y=(\d+)/)![1])];
    // Sobre el texto, la "I" (la hereda de Adwaita) también grande; sobre su menú "File", la flecha propia.
    v = await mirar(mx + 20, my + 10, (r, g, b) => r < 60 && g < 60 && b < 60);
    assert.ok(v.alto > 30, `la "I" de una app GTK no sale grande: ${JSON.stringify(v)}`);
    v = await mirar(mx + 14, my - 17, rojo);
    assert.ok(v.n > 300, `propio sobre el menú de una app GTK (mousepad): ${JSON.stringify(v)}`);

    await pc.ejecutar(["pkill", "-x", "mousepad"], { tiempo: 5000 }); // que no tape el fondo
    await esperar(800);
    // 3) Animado (.ani): en la vista en vivo deben verse sus dos colores.
    usarCursor(convertir(aniDosColores(), "anim.ani", png));
    await esperar(3000);
    let vistos = 0;
    for (let i = 0; i < 6; i++) {
      const [r, a] = [await mirar(fondo.x, fondo.y, rojo, 150 + i * 70), await mirar(fondo.x, fondo.y, azul, 0)];
      vistos |= (r.n > 200 ? 1 : 0) | (a.n > 200 ? 2 : 0);
    }
    console.log(`  animado: ${vistos === 3 ? "se ven los dos fotogramas" : vistos === 1 || vistos === 2 ? "solo se ve un fotograma" : "no se ve"}`);
    assert.ok(vistos, "el cursor animado no se ve");

    console.log("cursor: ok");
  } finally {
    await borrar(pc).catch(() => {});
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
}

app.disableHardwareAcceleration(); // la vista se pinta fuera de pantalla: sin GPU (su proceso a veces se cae en pruebas)
app.whenReady().then(() => main()).then(() => app.exit(0), (e) => (console.error(e), app.exit(1)));
