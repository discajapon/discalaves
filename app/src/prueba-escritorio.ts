// Escritorio con capturas en una computadora real (contenedor, sin modelo): npm run prueba:escritorio
// Corre dentro de Electron (la captura usa nativeImage). Comprueba la captura (tamaño, sin cursor), que un clic en
// coordenadas 0–1000 cae en el píxel correcto de la pantalla real (también tras ampliar), que el teclado escribe y
// guarda en una app nativa (mousepad), la pausa por toma de control, la aprobación con la captura marcada y las
// referencias del navegador.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, nativeImage } from "electron";
import { borrar, computadoraDe, usarCursor } from "./computadora";
import { cursorNeon, escribirXcursor } from "./cursor";
import { aNormal, aPantalla, escritorioDe } from "./escritorio";
import { ejecutarHerramienta, type Marca } from "./herramientas";
import { navegadorDe } from "./navegador";

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  usarCursor(escribirXcursor([cursorNeon()])); // como main.ts al arrancar
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "discalaves-escritorio-"));
  const computadora = computadoraDe(carpeta, "escritorio-prueba");
  const marcas: Marca[] = [];
  let aprobar = false;
  const ctx = {
    carpeta, usuario: "escritorio-prueba", computadora, navegador: navegadorDe(computadora), avisar: () => {},
    aprobar: async (_d: string, m?: Marca) => (m && marcas.push(m), aprobar),
  };
  const correr = (nombre: string, args: object) => ejecutarHerramienta(ctx, nombre, JSON.stringify(args));
  const raton = async () => {
    const r = await computadora.ejecutar(["xdotool", "getmouselocation", "--shell"], { tiempo: 10_000 });
    const m = r.salida.match(/X=(\d+)\s+Y=(\d+)/)!;
    return { x: Number(m[1]), y: Number(m[2]) };
  };
  try {
    await computadora.encender();
    const e = escritorioDe(computadora);

    // Captura: 1024 de ancho con la proporción de la pantalla (1280×800 → 1024×640), en JPEG.
    let r = await correr("captura_pantalla", {});
    assert.equal(r.codigo, 0, r.salida);
    const img = nativeImage.createFromBuffer(r.imagen!);
    assert.deepEqual(img.getSize(), { width: 1024, height: 640 });
    assert.deepEqual(e.ultima!.vista, { x: 0, y: 0, ancho: 1280, alto: 800 });
    // Con la sesión XFCE, Xvnc da 24 bits empaquetados: la barra superior (clara) debe llegar al borde derecho. Leída
    // como 32 bits, la imagen salía encogida al 75 % y a la derecha todo negro.
    for (let i = 0; i < 40 && !(await computadora.ejecutar(["pgrep", "-x", "xfce4-panel"], { tiempo: 5000 })).salida.trim(); i++) await esperar(250);
    await esperar(1500);
    const barra = nativeImage.createFromBuffer((await e.capturar()).jpeg).crop({ x: 1000, y: 2, width: 20, height: 12 }).toBitmap();
    assert.ok(barra.reduce((s, v) => s + v, 0) / barra.length > 120, "la captura no llega al borde derecho (¿formato de píxel mal leído?)");

    // Cursor grande de la vista en vivo: el tema "discalaves" (Xcursor) está en su computadora y la sesión lo usa a 48 px.
    const t = await computadora.ejecutar(["sh", "-c", "head -c 4 ~/.icons/discalaves/cursors/left_ptr; readlink ~/.icons/discalaves/cursors/default; tr '\\0' '\\n' < /proc/$(pgrep -x xfce4-session)/environ | grep XCURSOR | sort"], { tiempo: 10_000 });
    assert.equal(t.salida, "Xcurleft_ptr\nXCURSOR_SIZE=48\nXCURSOR_THEME=discalaves\n", t.salida);

    // El cursor no sale en la captura del modelo: con el ratón en dos sitios del fondo, la zona es la misma.
    const zona = { x: 600, y: 300, width: 80, height: 80 };
    const bits = async (x: number, y: number) => {
      await computadora.ejecutar(["xdotool", "mousemove", String(x), String(y)], { tiempo: 10_000 });
      await esperar(300);
      return nativeImage.createFromBuffer((await e.capturar()).jpeg).crop(zona).toBitmap();
    };
    const [a, b] = [await bits(800, 420), await bits(100, 700)]; // 800,420 (real) cae dentro de la zona de la imagen
    let distintos = 0;
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 24) distintos++;
    assert.ok(distintos < a.length * 0.01, `el cursor aparece en la captura (${distintos} bytes distintos)`);

    // Clic por coordenadas (criterio 4 en la pantalla real): el puntero acaba en el píxel que dice el mapeo.
    await e.capturar();
    for (const [nx, ny] of [[0, 0], [500, 500], [999, 999], [123, 877], [684, 781]]) {
      r = await correr("mover_raton", { x: nx, y: ny });
      assert.equal(r.codigo, 0, r.salida);
      assert.deepEqual(await raton(), aPantalla(nx, ny, { x: 0, y: 0, ancho: 1280, alto: 800 }), `${nx},${ny}`);
    }
    // Tras ampliar, las coordenadas son las de la imagen ampliada: su centro es el centro de la zona.
    r = await correr("ampliar", { x1: 250, y1: 250, x2: 500, y2: 500 });
    assert.equal(r.codigo, 0, r.salida);
    assert.deepEqual(nativeImage.createFromBuffer(r.imagen!).getSize().width, 1024);
    r = await correr("mover_raton", { x: 500, y: 500 });
    assert.deepEqual(await raton(), { x: 480, y: 300 }, "clic en la imagen ampliada");

    // Trampas del escritorio que encontró Qwen (2026-10-18): el lanzador de archivos del panel preguntaba qué
    // programa usar (no había gestor de archivos) y el de navegador debe abrir el Chromium de la app (CDP en 9222).
    const sh = async (c: string) => (await computadora.ejecutar(["sh", "-c", c], { tiempo: 20_000 })).salida.trim();
    await sh("(exo-open --launch FileManager >/dev/null 2>&1 &)");
    for (let i = 0; i < 40 && !(await sh("xdotool search --onlyvisible --class thunar")); i++) await esperar(250);
    assert.ok(await sh("xdotool search --onlyvisible --class thunar"), "el lanzador de archivos no abrió Thunar");
    assert.equal(await sh("xdotool search --onlyvisible --name 'Choose Preferred' | wc -l"), "0", "pregunta qué programa usar");
    await sh("pkill -x thunar; true");
    assert.match(await sh("grep -h '^WebBrowser=' /etc/xdg/xfce4/helpers.rc"), /^WebBrowser=navegador$/);
    // Botones de los diálogos arriba: el de "Guardar como" es más alto que la pantalla y los de abajo no se veían.
    assert.equal(await sh("xfconf-query -c xsettings -p /Gtk/DialogsUseHeader"), "true");

    // Una app nativa con teclado y ratón: mousepad, escribir una frase y guardar con ctrl+s.
    await computadora.ejecutar(["sh", "-c", "rm -f ~/nota.txt; (mousepad >/dev/null 2>&1 &)"], { tiempo: 10_000 });
    for (let i = 0; i < 40 && !(await computadora.ejecutar(["xdotool", "search", "--onlyvisible", "--class", "mousepad"], { tiempo: 5000 })).salida.trim(); i++) await esperar(250);
    await esperar(800);
    r = await correr("escribir_texto", { texto: "Hola desde Discalaves" });
    assert.equal(r.codigo, 0, r.salida);
    // Centro de la ventana de mousepad (en 0–1000 de la captura): ahí está su área de texto.
    const g = (await computadora.ejecutar(["sh", "-c", "xdotool search --onlyvisible --class mousepad | head -1 | xargs xdotool getwindowgeometry --shell"], { tiempo: 5000 })).salida;
    const [gx, gy, gw, gh] = ["X", "Y", "WIDTH", "HEIGHT"].map((k) => Number(g.match(new RegExp(`^${k}=(\\d+)`, "m"))![1]));
    await e.capturar();
    const centro = aNormal(gx + gw / 2, gy + gh / 2, { x: 0, y: 0, ancho: 1280, alto: 800 });
    // Clic triple: selecciona la línea y lo que se escribe la reemplaza.
    r = await correr("clic", { ...centro, objetivo: "texto del editor", boton: "triple" });
    assert.equal(r.codigo, 0, r.salida);
    r = await correr("escribir_texto", { texto: "Hola desde Discalaves, con ñ y tildes: canción." });
    // Clic con ctrl mantenido: al soltarlo, ctrl no queda pulsado (si quedara, "x" sería cortar).
    r = await correr("clic", { ...centro, objetivo: "texto del editor", mantener: "ctrl" });
    assert.match(r.salida, /con ctrl/);
    // esperar: tarda lo pedido y devuelve una captura nueva.
    const t0 = Date.now();
    r = await correr("esperar", { segundos: 1 });
    assert.ok(r.imagen && Date.now() - t0 >= 1000, r.salida);
    // Una acción (orden + al menos 0,6 s hasta que la pantalla se asiente + captura) en una sola llamada: sin
    // atascarse esperando a una pantalla que no cambia (como mucho ~1,5 s).
    const t1 = Date.now();
    r = await correr("mover_raton", { x: 10, y: 990 });
    assert.ok(Date.now() - t1 >= 600 && Date.now() - t1 < 1500, `una acción tardó ${Date.now() - t1} ms`);
    r = await correr("pulsar_teclas", { teclas: "ctrl+s" });
    await esperar(800);
    r = await correr("escribir_texto", { texto: `/home/escritorio-prueba/nota.txt` });
    r = await correr("pulsar_teclas", { teclas: "Intro" });
    await esperar(1000);
    const nota = path.join(carpeta, "nota.txt");
    assert.ok(fs.existsSync(nota), "mousepad no guardó el archivo");
    assert.equal(fs.readFileSync(nota, "utf8").trim(), "Hola desde Discalaves, con ñ y tildes: canción.");
    await correr("pulsar_teclas", { teclas: "ctrl+q" });

    // Toma de control (criterio 5): no hace la acción mientras el usuario controla; al soltar, captura nueva.
    await e.capturar();
    const antes = await raton();
    computadora.controlUsuario = true;
    let fin: Awaited<ReturnType<typeof correr>> | undefined;
    const enCurso = correr("clic", { x: 900, y: 100, objetivo: "nada" }).then((x) => (fin = x));
    await esperar(1500);
    assert.equal(fin, undefined, "siguió con el usuario al control");
    assert.deepEqual(await raton(), antes, "movió el ratón con el usuario al control");
    computadora.controlUsuario = false;
    await enCurso;
    assert.equal(fin!.codigo, 1);
    assert.ok(fin!.imagen, "al soltar retoma con una captura nueva");
    assert.match(fin!.salida, /no hice tu última acción/);

    // Clic delicado por coordenadas (criterio 6): pide aprobación con la captura y el punto; "no" = no se pulsa.
    await e.capturar();
    const quieto = await raton();
    r = await correr("clic", { x: 300, y: 300, objetivo: "botón Enviar pedido" });
    assert.match(r.salida, /no lo permitió/);
    assert.equal(marcas.length, 1);
    assert.deepEqual([marcas[0].x, marcas[0].y], [300, 300]);
    assert.ok(nativeImage.createFromBuffer(marcas[0].jpeg).getSize().width === 1024, "la tarjeta lleva la captura que vio");
    assert.deepEqual(await raton(), quieto, "pulsó sin aprobación");
    r = await correr("clic", { x: 300, y: 300, objetivo: "campo de texto" });
    assert.equal(marcas.length, 1, "un clic normal no pide aprobación");

    // Navegador: referencias cortas y estables; hacer_clic acepta la referencia.
    r = await correr("abrir_pagina", { url: "https://example.com" });
    assert.equal(r.codigo, 0, r.salida);
    r = await correr("ver_pagina", {});
    const ref = r.salida.match(/link "[^"]+" \[ref=(e\d+)\]/)?.[1];
    assert.ok(ref, `ver_pagina sin referencias:\n${r.salida}`);
    assert.equal((await correr("ver_pagina", {})).salida.includes(`[ref=${ref}]`), true, "la referencia cambia entre lecturas");
    r = await correr("hacer_clic", { ref });
    assert.equal(r.codigo, 0, r.salida);
    assert.match(r.salida, /url: https:\/\/www\.iana\.org/);
    r = await correr("hacer_clic", { ref: "e99999" });
    assert.match(r.salida, /no encontré la referencia/);

    // Un buscador como el de YouTube: las sugerencias se despliegan bajo el puntero (el centro de la pantalla) y la
    // que queda bajo él se marca; al enviar, la URL cambia sin recargar y los resultados se pintan 0,7 s después, sin que nada se mueva mientras.
    await correr("abrir_pagina", { url: "https://example.com" }); // con origen propio, para que pushState valga
    await computadora.ejecutar(["xdotool", "mousemove", "640", "400"], { tiempo: 10_000 });
    await (navegadorDe(computadora) as any).paginaActual().then((p: import("playwright-core").Page) => p.setContent(`
      <input role="combobox" aria-label="Buscar" id="q" style="position:absolute;top:0;left:0;width:100%">
      <ul id="s" style="position:absolute;top:30px;left:0;width:100%;height:100%;margin:0;padding:0"></ul>
      <main id="m">Portada</main>
      <script>
        let marcada = null;
        q.oninput = () => { s.innerHTML = '<li style="height:100%">' + q.value + ' tejida a crochet</li>'; s.firstChild.onmouseenter = () => (marcada = s.firstChild.textContent); };
        q.onkeydown = (e) => { if (e.key !== "Enter") return; const t = marcada ?? q.value; s.innerHTML = ""; history.pushState(0, "", "?q=" + encodeURIComponent(t)); setTimeout(() => (m.textContent = "Resultados de " + t), 700); };
      </script>`));
    for (let vez = 0; vez < 2; vez++) {
      const buscador = (await correr("ver_pagina", {})).salida.match(/combobox "Buscar"[^\n]*?\[ref=((?:f\d+)?e\d+)\]/)?.[1];
      assert.ok(buscador, "sin referencia del buscador");
      r = await correr("escribir_en", { ref: buscador, texto: "mariposa monarca", enviar: true });
      assert.match(r.salida, /url: https:\/\/example\.com\/\?q=mariposa%20monarca\n/, `Enter eligió la sugerencia bajo el puntero:\n${r.salida}`);
      assert.match(r.salida, /Resultados de mariposa monarca/, `vuelta ${vez}: devolvió la página de antes de pintarse:\n${r.salida}`);
      await (navegadorDe(computadora) as any).paginaActual().then((p: import("playwright-core").Page) => p.evaluate(() => { (document.getElementById("m") as HTMLElement).textContent = "Portada"; (document.getElementById("q") as HTMLInputElement).value = ""; history.replaceState(0, "", "/"); }));
    }
    assert.deepEqual(await raton(), { x: 640, y: 400 }, "el puntero que se ve en vivo no se movió");

    // Una página larga llega por partes y se puede pedir la siguiente (número o texto, como lo mande el modelo).
    console.log("escritorio: ok");
  } finally {
    await navegadorDe(computadora).cerrar();
    await borrar(computadora).catch(() => {});
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
}

app.whenReady().then(() => main()).then(() => app.exit(0), (e) => (console.error(e), app.exit(1)));
