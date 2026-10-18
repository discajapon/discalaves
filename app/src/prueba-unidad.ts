// Pruebas que no necesitan GPU, Docker ni WSL: rutas y adaptadores por sistema. Corren en Linux y en el
// runner de Windows de GitHub Actions: npm run prueba:unidad
import assert from "node:assert/strict";
import { Empleados, leerIdentidad, promptEmpleado, textoIdentidad } from "./empleados";
import { leerPunto, textoDeHtml, verificar } from "./herramientas";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { ordenMotor } from "./computadora";
import { bajar, extraer } from "./instalar";
import { turnoOpenAI } from "./proveedores";
import { rutasPara } from "./rutas";
import { cuantDe, nombreValido } from "./modelos";
import { distrosDe, textoWsl } from "./wsl";
import { ajustar, convertir, cursorNeon, escribirXcursor, leerXcursor, TAMANO, unTamano } from "./cursor";
import { ANCHO_IMAGEN, aNormal, aPantalla, leerXwd, region, tamanoImagen, teclas, trayecto, type Vista } from "./escritorio";

// Linux: igual que siempre.
let r = rutasPara("linux", {}, "/home/ana");
assert.equal(r.windows, false);
assert.equal(r.ia, "/home/ana/Documents/IA-discalves");
assert.equal(r.servidor, "/home/ana/Documents/IA-discalves/llama.cpp/llama-server");
assert.equal(r.modelo, "/home/ana/Documents/IA-discalves/modelos/Qwen3.5-9B-Q4_K_M.gguf");
assert.equal(r.datos, null, "en Linux los datos siguen donde los pone Electron");
assert.equal(r.trabajo("qwen"), "/home/ana/Documents/IA-discalves/trabajo/qwen");
assert.equal(r.enMotor("/tmp/x"), "/tmp/x", "en Linux el motor ve la misma ruta");
assert.equal(rutasPara("linux", { DISCALAVES_IA: "/srv/ia" }, "/home/ana").servidor, "/srv/ia/llama.cpp/llama-server");

// Windows: runtime, modelos y datos en %LOCALAPPDATA%\Discalaves; trabajo dentro de la distro.
r = rutasPara("win32", { LOCALAPPDATA: "C:\\Users\\Ana\\AppData\\Local" }, "C:\\Users\\Ana");
assert.equal(r.windows, true);
assert.equal(r.ia, "C:\\Users\\Ana\\AppData\\Local\\Discalaves");
assert.equal(r.servidor, "C:\\Users\\Ana\\AppData\\Local\\Discalaves\\llama.cpp\\llama-server.exe");
assert.equal(r.modelo, "C:\\Users\\Ana\\AppData\\Local\\Discalaves\\modelos\\Qwen3.5-9B-Q4_K_M.gguf");
assert.equal(r.datos, "C:\\Users\\Ana\\AppData\\Local\\Discalaves\\datos");
assert.equal(r.distro, "C:\\Users\\Ana\\AppData\\Local\\Discalaves\\wsl");
assert.equal(r.trabajo("qwen"), "\\\\wsl$\\discalaves\\home\\discalaves\\trabajo\\qwen");
assert.equal(r.enMotor(r.trabajo("qwen")), "/home/discalaves/trabajo/qwen");
assert.equal(r.enMotor("\\\\WSL$\\Discalaves\\home\\discalaves\\trabajo\\x"), "/home/discalaves/trabajo/x", "sin distinguir mayúsculas");
assert.throws(() => r.enMotor("C:\\Users\\Ana\\Documentos"), /no está dentro de la distro/, "nunca se monta una carpeta de Windows");
// Sin LOCALAPPDATA, se deduce de la carpeta del usuario; DISCALAVES_IA solo mueve runtime y modelos.
assert.equal(rutasPara("win32", {}, "C:\\Users\\Ana").datos, "C:\\Users\\Ana\\AppData\\Local\\Discalaves\\datos");
const conIA = rutasPara("win32", { LOCALAPPDATA: "C:\\L", DISCALAVES_IA: "D:\\IA" });
assert.equal(conIA.servidor, "D:\\IA\\llama.cpp\\llama-server.exe");
assert.equal(conIA.datos, "C:\\L\\Discalaves\\datos");

// Motor de contenedores por sistema: nada de Docker Desktop en Windows.
assert.deepEqual(ordenMotor("linux"), ["docker"]);
assert.deepEqual(ordenMotor("linux", "podman"), ["podman"]);
assert.deepEqual(ordenMotor("linux", undefined, false), ["podman"], "sin Docker usable, Podman");
assert.deepEqual(ordenMotor("win32"), ["wsl.exe", "-d", "discalaves", "-u", "discalaves", "--", "podman"]);
assert.deepEqual(ordenMotor("win32", "docker"), ordenMotor("win32"), "en Windows DISCALAVES_MOTOR no cambia a Docker");

// wsl.exe -l -q responde en UTF-16LE (a veces con BOM); lo de dentro de la distro, en UTF-8.
const utf16 = (t: string) => Buffer.from(t, "utf16le");
assert.deepEqual(distrosDe(utf16("Ubuntu\r\ndiscalaves\r\n")), ["Ubuntu", "discalaves"]);
assert.deepEqual(distrosDe(Buffer.concat([Buffer.from([0xff, 0xfe]), utf16("discalaves\r\n")])), ["discalaves"]);
assert.deepEqual(distrosDe(Buffer.from("")), []);
assert.equal(textoWsl(Buffer.from("hola ñ\n", "utf8")), "hola ñ\n", "la salida de los comandos de la distro es UTF-8");

// ---- Empleados: formato de los perfiles, procedimientos, memoria y plantillas ----
const identidad = leerIdentidad("---\r\nnombre: Contadora\r\nrol: impuestos\r\ncolor: turquesa\r\nmodelo: ollama:llama3.2\r\nherramientas: buscar_web, terminal, inventada\r\n---\r\n\r\nTono: prudente.\r\n");
assert.deepEqual(identidad, { nombre: "Contadora", rol: "impuestos", color: "turquesa", modelo: "ollama:llama3.2", herramientas: ["buscar_web", "terminal"], instrucciones: "Tono: prudente." }, "herramientas desconocidas fuera");
assert.deepEqual(leerIdentidad(textoIdentidad(identidad)), identidad, "escribir y leer da lo mismo");
assert.equal(leerIdentidad("sin encabezado").color, "violeta", "valores por defecto");
assert.equal(leerIdentidad(textoIdentidad({ ...identidad, rol: "uno\nnombre: otro" })).nombre, "Contadora", "un salto de línea no inyecta campos");

const datos = fs.mkdtempSync(path.join(os.tmpdir(), "discalaves-empleados-"));
const equipo = new Empleados(datos, path.join(__dirname, "..", "plantillas"));
assert.ok(equipo.listarPlantillas().length >= 7, "plantillas del repositorio");
for (const p of equipo.listarPlantillas()) {
  const palabras = p.identidad.instrucciones.split(/\s+/).length;
  assert.ok(palabras < 150, `la identidad de ${p.id} es corta (${palabras} palabras)`);
}
assert.ok(!equipo.plantilla("contador")!.herramientas.includes("terminal"), "el Contador no tiene terminal");
assert.ok(equipo.plantilla("desarrollador")!.herramientas.includes("terminal"));
const e = equipo.crear(equipo.plantilla("contador")!, true, "contador");
assert.equal(e.id, "contador");
assert.equal(equipo.crear(equipo.plantilla("contador")!, true, "contador").id, "contador-2", "ids únicos");
assert.equal(equipo.crear({ ...identidad, nombre: "3D Diseño" }, true).id, "e-3d-diseno", "el id empieza por letra y sin tildes");
assert.ok(equipo.procedimientos("contador").some((p) => p.nombre === "consulta-tributaria" && p.descripcion));
assert.match(equipo.leerProcedimiento("contador", "consulta-tributaria")!, /fuente oficial/);
assert.equal(equipo.leerProcedimiento("contador", "../identidad"), null, "solo procedimientos de su lista");
for (let i = 0; i < 60; i++) equipo.recordar("contador", `nota número ${i} con algo de texto para ocupar sitio`);
const memoria = equipo.memoria("contador");
assert.ok(memoria.length <= 1500 && memoria.includes("nota número 59") && !memoria.includes("nota número 0 "), "memoria: las más recientes, con tope");
const prompt = promptEmpleado(e, equipo.procedimientos("contador"), memoria, true);
assert.match(prompt, /Te llamas Contador/);
assert.match(prompt, /consulta-tributaria: /);
assert.ok(!/## Procedimientos/.test(promptEmpleado(e, equipo.procedimientos("contador"), "", false)), "solo chat: sin procedimientos");
fs.rmSync(datos, { recursive: true, force: true });

// ---- Verificación de honestidad al terminar una tarea ----
const pedido = { de: "yo", texto: "investiga y deja un informe" };
assert.equal(verificar("Listo, he guardado el informe en informes/a.md", [pedido], new Set())?.tipo, "archivo", "dice que guardó sin guardar");
assert.equal(verificar("He guardado el informe", [pedido, { de: "herramienta", nombre: "escribir_archivo", argumentos: "{}", salida: "guardado", codigo: 0 }], new Set()), null);
assert.equal(verificar("Lo guardé", [pedido], new Set(["archivo"])), null, "una sola vez por tarea");
assert.equal(verificar("Fuente: https://www.sri.gob.ec", [pedido], new Set())?.tipo, "fuente", "cita una web que no abrió");
assert.equal(verificar("Fuente: https://www.sri.gob.ec/iva", [pedido, { de: "herramienta", nombre: "abrir_pagina", argumentos: '{"url":"https://www.sri.gob.ec/iva"}', salida: "…", codigo: 0 }], new Set()), null);
assert.equal(verificar("como dijiste, mira www.ejemplo.com", [{ de: "yo", texto: "revisa www.ejemplo.com" }], new Set()), null, "la dirección la dio el usuario");

// leer_web: texto de una página sin navegador.
const pagina = textoDeHtml("<html><head><title>Hola &amp; adi&oacute;s</title><style>p{}</style></head><body><script>x()</script><p>Uno&nbsp;&#233;</p><ul><li>a</li><li>b</li></ul></body></html>");
assert.equal(pagina.titulo, "Hola & adi&oacute;s");
assert.equal(pagina.texto, "Uno é\n- a\n- b");

// Instalación: descarga verificada y reanudable contra un servidor local, y extracción aplanando la carpeta raíz.
const bytes = Buffer.alloc(300_000, "discalaves");
const hash = createHash("sha256").update(bytes).digest("hex");
const servidor = http.createServer((req, res) => {
  const desde = Number(/bytes=(\d+)-/.exec(req.headers.range ?? "")?.[1] ?? 0);
  res.writeHead(desde ? 206 : 200, { "content-length": bytes.length - desde });
  res.end(bytes.subarray(desde));
}).listen(0);
const url = `http://127.0.0.1:${(servidor.address() as import("node:net").AddressInfo).port}/x`;
const tmpI = fs.mkdtempSync(path.join(os.tmpdir(), "discalaves-instalar-"));
void (async () => {
  await bajar(url, path.join(tmpI, "a"), hash, () => {}, "t");
  assert.equal(fs.statSync(path.join(tmpI, "a")).size, bytes.length, "descarga completa");
  fs.writeFileSync(path.join(tmpI, "b.parte"), bytes.subarray(0, 100_000)); // quedó a medias
  await bajar(url, path.join(tmpI, "b"), hash, () => {}, "t");
  assert.equal(createHash("sha256").update(fs.readFileSync(path.join(tmpI, "b"))).digest("hex"), hash, "reanuda desde donde se quedó");
  await assert.rejects(bajar(url, path.join(tmpI, "c"), "0".repeat(64), () => {}, "t"), /no coincide/);
  assert.ok(!fs.existsSync(path.join(tmpI, "c")) && !fs.existsSync(path.join(tmpI, "c.parte")), "un hash malo no deja archivo");
  fs.mkdirSync(path.join(tmpI, "raiz", "llama-b1"), { recursive: true });
  fs.writeFileSync(path.join(tmpI, "raiz", "llama-b1", "llama-server"), "x");
  execFileSync("tar", ["-czf", path.join(tmpI, "r.tar.gz"), "-C", path.join(tmpI, "raiz"), "llama-b1"]);
  fs.mkdirSync(path.join(tmpI, "dest"));
  extraer(path.join(tmpI, "r.tar.gz"), path.join(tmpI, "dest"));
  assert.deepEqual(fs.readdirSync(path.join(tmpI, "dest")), ["llama-server"], "aplana la carpeta raíz y no deja restos");
  // Llamada a herramienta rota: llama-server responde 500; se repite el turno y, si sigue rota, se explica.
  let rotas = 2;
  const modelo = http.createServer((_q, res) => {
    if (rotas-- > 0) return res.writeHead(500, { "content-type": "application/json" }).end('{"error":{"message":"Failed to parse tool call arguments as JSON: missing closing quote"}}');
    res.writeHead(200, { "content-type": "text/event-stream" }).end('data: {"choices":[{"delta":{"content":"listo"}}]}\n\ndata: [DONE]\n\n');
  }).listen(0);
  const pedido = { url: `http://127.0.0.1:${(modelo.address() as import("node:net").AddressInfo).port}/v1`, modelo: "m", sistema: "s", mensajes: [{ role: "user", content: "hola" }], herramientas: [], senal: new AbortController().signal, alTexto: () => {} };
  assert.equal((await turnoOpenAI(pedido)).texto, "listo", "tras dos llamadas rotas, el tercer intento sale bien");
  rotas = 3;
  await assert.rejects(turnoOpenAI(pedido), /en 3 intentos/);
  // El servidor entrega la llamada con el JSON cortado (contexto lleno): no se acepta ni se guarda; se repite.
  const cortada = http.createServer((_q, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" }).end('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"a","function":{"name":"abrir_pagina","arguments":"{\\"url\\":\\"https://x"}}]}}]}\n\ndata: [DONE]\n\n');
  }).listen(0);
  await assert.rejects(turnoOpenAI({ ...pedido, url: `http://127.0.0.1:${(cortada.address() as import("node:net").AddressInfo).port}/v1` }), /en 3 intentos/, "una llamada cortada no llega al historial");
  cortada.close();
  rotas = 1;
  modelo.close();
  servidor.close();
  fs.rmSync(tmpI, { recursive: true, force: true });

  // Gestor de modelos: la cuantización de cada archivo es la etiqueta de hf.co en Ollama; nombres seguros.
  assert.equal(cuantDe("Qwen3.5-9B-UD-Q4_K_XL.gguf"), "UD-Q4_K_XL");
  assert.equal(cuantDe("Qwen3.5-9B-Q4_K_M.gguf"), "Q4_K_M");
  assert.equal(cuantDe("Qwen3.5-9B-IQ4_XS.gguf"), "IQ4_XS");
  assert.equal(cuantDe("modelo.BF16.gguf"), "BF16");
  assert.equal(cuantDe("mmproj-F16.gguf"), null, "el proyector de visión no es un modelo");
  assert.equal(cuantDe("big-Q8_0-00001-of-00003.gguf"), null, "los modelos partidos no se ofrecen");
  assert.equal(cuantDe("README.md"), null);
  assert.ok(nombreValido("hf.co/unsloth/Qwen3.5-9B-GGUF:Q4_K_M") && nombreValido("llama3.2:3b"));
  assert.ok(!nombreValido("../x") && !nombreValido("-rf") && !nombreValido("a b"));

  // Mapeo de coordenadas (criterio 4): un píxel de la pantalla real se ve en un píxel de la imagen reescalada
  // (o ampliada); el modelo apunta a ese píxel en 0–1000 (enteros, como responde) y el clic debe caer dentro de
  // los píxeles reales que forman ese píxel de la imagen, a cualquier escala, también en los bordes.
  const vistas: Vista[] = [
    { x: 0, y: 0, ancho: 1280, alto: 800 }, // la pantalla de cada computadora
    { x: 0, y: 0, ancho: 1920, alto: 1080 },
    { x: 0, y: 0, ancho: 800, alto: 600 },
    { x: 0, y: 0, ancho: 1024, alto: 640 }, // misma escala que la imagen
    { x: 300, y: 200, ancho: 200, alto: 120 }, // zona ampliada (la imagen es mayor que la zona)
    { x: 1264, y: 784, ancho: 16, alto: 16 }, // zona mínima, en la esquina
  ];
  for (const v of vistas) {
    const img = tamanoImagen(v.ancho, v.alto);
    assert.equal(img.ancho, ANCHO_IMAGEN);
    assert.ok(Math.abs(img.alto / img.ancho - v.alto / v.ancho) < 0.01, "se conserva la proporción");
    const muestras = [[v.x, v.y], [v.x + v.ancho - 1, v.y + v.alto - 1], [v.x + (v.ancho >> 1), v.y + (v.alto >> 1)],
      ...Array.from({ length: 300 }, (_, i) => [v.x + ((i * 7919) % v.ancho), v.y + ((i * 104729) % v.alto)])];
    for (const [px, py] of muestras) {
      const ix = Math.floor(((px - v.x + 0.5) * img.ancho) / v.ancho), iy = Math.floor(((py - v.y + 0.5) * img.alto) / v.alto); // píxel de la imagen
      const nx = Math.round(((ix + 0.5) / img.ancho) * 1000), ny = Math.round(((iy + 0.5) / img.alto) * 1000); // lo que diría el modelo
      const p = aPantalla(nx, ny, v);
      const margenX = v.ancho / img.ancho + v.ancho / 1000, margenY = v.alto / img.alto + v.alto / 1000; // un píxel de la imagen + el redondeo a 0–1000
      assert.ok(Math.abs(p.x - px) <= Math.max(1, margenX) && Math.abs(p.y - py) <= Math.max(1, margenY), `vista ${JSON.stringify(v)}: ${px},${py} → ${nx},${ny} → ${p.x},${p.y}`);
      assert.ok(p.x >= v.x && p.x < v.x + v.ancho && p.y >= v.y && p.y < v.y + v.alto, "nunca fuera de la vista");
    }
    // Ida y vuelta exacta desde 0–1000 sin redondear.
    for (const [px, py] of muestras.slice(0, 50)) assert.deepEqual(aPantalla(aNormal(px, py, v).x, aNormal(px, py, v).y, v), { x: px, y: py });
  }
  // Un botón real: en 1280×800, "Guardar" ocupa 825–925 × 609–641; el modelo ve 1024×640 y apunta al centro.
  const btn = aPantalla(Math.round((700 / 1024) * 1000), Math.round((500 / 640) * 1000), vistas[0]);
  assert.ok(btn.x >= 825 && btn.x <= 925 && btn.y >= 609 && btn.y <= 641, `el clic cae en el botón: ${btn.x},${btn.y}`);
  // Fuera de rango: se recorta al borde, no sale de la pantalla.
  assert.deepEqual(aPantalla(-50, 2000, vistas[0]), { x: 0, y: 799 });
  // Ampliar: la región pedida en 0–1000 de la pantalla pasa a píxeles reales; en la imagen ampliada, 500,500 es su centro.
  const zona = region(250, 250, 500, 500, vistas[0]);
  assert.deepEqual(zona, { x: 320, y: 200, ancho: 321, alto: 201 });
  assert.deepEqual(aPantalla(500, 500, zona), { x: 480, y: 300 });
  assert.deepEqual(region(999, 999, 1000, 1000, vistas[0]), { x: 1264, y: 784, ancho: 16, alto: 16 }, "zona mínima de 16 px dentro de la pantalla");
  // Lo que responde el modelo al ubicar un objetivo: punto, punto entre corchetes o caja (su centro).
  assert.deepEqual(leerPunto("532,560"), { x: 532, y: 560 });
  assert.deepEqual(leerPunto("[630, 394]"), { x: 630, y: 394 });
  assert.deepEqual(leerPunto("[10,92,27,116]"), { x: 19, y: 104 });
  assert.equal(leerPunto("no lo veo"), null);
  assert.equal(leerPunto("1500, 20"), null, "fuera de 0–1000");
  // Teclas como las escribe el modelo.
  assert.deepEqual(teclas("ctrl+s"), ["ctrl+s"]);
  assert.deepEqual(teclas("Intro"), ["Return"]);
  assert.deepEqual(teclas("Ctrl+Shift+T, flecha abajo"), ["ctrl+shift+t", "Down"]);
  assert.deepEqual(teclas("ctrl+a Supr"), ["ctrl+a", "Delete"]);
  // Movimiento suave: termina exactamente en el destino y no salta.
  const ruta = trayecto({ x: 0, y: 0 }, { x: 800, y: 400 });
  assert.deepEqual(ruta.at(-1), { x: 800, y: 400 });
  assert.ok(ruta.every((q, i) => i === 0 || Math.abs(q.x - ruta[i - 1].x) <= 200), "pasos cortos");
  // Captura: un XWD de 32 bits (como el de xwd en Xvnc) pasa a BGRA.
  const xwd = Buffer.alloc(100 + 2 * 2 * 4);
  [100, 7, 2, 24, 2, 2, 0, 0, 32, 0, 32, 32, 8, 4, 0xff0000, 0xff00, 0xff, 8, 0, 0].forEach((v, i) => xwd.writeUInt32BE(v, i * 4));
  [0x00112233, 0x00445566, 0x00778899, 0x00aabbcc].forEach((v, i) => xwd.writeUInt32LE(v, 100 + i * 4));
  const leido = leerXwd(xwd);
  assert.deepEqual([leido.ancho, leido.alto], [2, 2]);
  assert.deepEqual([...leido.bgra.subarray(0, 8)], [0x33, 0x22, 0x11, 255, 0x66, 0x55, 0x44, 255]);
  // Xvnc con la sesión XFCE: 24 bits empaquetados en 3 bytes y líneas con relleno (como 1280 px en 5120 bytes).
  const x24 = Buffer.alloc(100 + 2 * 8);
  [100, 7, 2, 24, 2, 2, 0, 0, 32, 0, 8, 24, 8, 5, 0xff0000, 0xff00, 0xff, 8, 0, 0].forEach((v, i) => x24.writeUInt32BE(v, i * 4));
  Buffer.from([0x33, 0x22, 0x11, 0x66, 0x55, 0x44, 0, 0, 0x99, 0x88, 0x77, 0xcc, 0xbb, 0xaa, 0, 0]).copy(x24, 100);
  assert.deepEqual([...leerXwd(x24).bgra], [0x33, 0x22, 0x11, 255, 0x66, 0x55, 0x44, 255, 0x99, 0x88, 0x77, 255, 0xcc, 0xbb, 0xaa, 255]);
  // Cursor neón: 48 px (2× el normal) y el punto activo en la punta de la flecha: opaco en la punta, transparente
  // por encima y a la izquierda (solo el halo), así el clic cae donde se ve la punta.
  const neon = cursorNeon();
  assert.deepEqual([neon.ancho, neon.alto], [TAMANO, TAMANO]);
  const alfa = (x: number, y: number) => neon.argb[y * neon.ancho + x] >>> 24;
  assert.ok(alfa(neon.xhot + 1, neon.yhot + 2) > 200, "la punta es opaca");
  assert.ok(alfa(neon.xhot - 3, neon.yhot - 3) < 80, "nada sólido antes de la punta");
  assert.ok(alfa(TAMANO - 1, 0) === 0, "esquina vacía");
  // Xcursor: ida y vuelta.
  const ida = leerXcursor(escribirXcursor([neon]));
  assert.deepEqual([ida[0].ancho, ida[0].xhot, ida[0].yhot, ida[0].argb[500]], [TAMANO, neon.xhot, neon.yhot, neon.argb[500]]);
  // .cur de 32 bits, 16×16, punto activo (3, 5): se escala a 48 (×3) con su punto activo.
  const cur = (lado: number, xhot: number, yhot: number, color: number) => {
    const dib = Buffer.alloc(40 + lado * lado * 4 + lado * 4);
    [40, lado, lado * 2].forEach((v, i) => dib.writeInt32LE(v, i * 4));
    dib.writeUInt16LE(1, 12); dib.writeUInt16LE(32, 14);
    for (let i = 0; i < lado * lado; i++) dib.writeUInt32LE(color, 40 + i * 4);
    const cab = Buffer.alloc(22);
    cab.writeUInt16LE(2, 2); cab.writeUInt16LE(1, 4); cab[6] = lado; cab[7] = lado;
    cab.writeUInt16LE(xhot, 10); cab.writeUInt16LE(yhot, 12); cab.writeUInt32LE(dib.length, 14); cab.writeUInt32LE(22, 18);
    return Buffer.concat([cab, dib]);
  };
  const sinPng = () => { throw new Error("no debía usar PNG"); };
  let x = leerXcursor(convertir(cur(16, 3, 5, 0xff00ff00), "flecha.cur", sinPng))[0];
  assert.deepEqual([x.ancho, x.alto, x.xhot, x.yhot, x.argb[0]], [48, 48, 9, 15, 0xff00ff00]);
  // .ani: dos fotogramas a 10/60 s cada uno.
  const icono = (c: number) => { const f = cur(16, 0, 0, c); const h = Buffer.alloc(8); h.write("icon", 0, "latin1"); h.writeUInt32LE(f.length, 4); return Buffer.concat([h, f]); };
  const anih = Buffer.alloc(44); anih.write("anih", 0, "latin1"); anih.writeUInt32LE(36, 4); anih.writeUInt32LE(36, 8); anih.writeUInt32LE(2, 12); anih.writeUInt32LE(2, 16); anih.writeUInt32LE(10, 36);
  const fotos = Buffer.concat([icono(0xffff0000), icono(0xff0000ff)]);
  const lista = Buffer.alloc(12); lista.write("LIST", 0, "latin1"); lista.writeUInt32LE(4 + fotos.length, 4); lista.write("fram", 8, "latin1");
  const cuerpo = Buffer.concat([Buffer.from("ACON", "latin1"), anih, lista, fotos]);
  const riff = Buffer.alloc(8); riff.write("RIFF", 0, "latin1"); riff.writeUInt32LE(cuerpo.length, 4);
  const ani = leerXcursor(convertir(Buffer.concat([riff, cuerpo]), "espera.ani", sinPng));
  assert.deepEqual(ani.map((f) => [f.retardo, f.argb[0]]), [[167, 0xffff0000], [167, 0xff0000ff]]);
  // Xcursor de un tema con varios tamaños (como Adwaita: 24, 32, 48…): se queda el de 48, sin mezclarlos como fotogramas.
  const tam = (n: number, color: number) => ({ ...cursorNeon(n), argb: new Uint32Array(n * n).fill(color) });
  const tema = leerXcursor(Buffer.concat([escribirXcursor([tam(24, 1)], 24)]));
  assert.equal(tema[0].nominal, 24);
  const variosTamanos = [24, 32, 48, 64].map((n, i) => ({ ...tam(n, 0xff000000 + i), nominal: n }));
  assert.deepEqual(unTamano(variosTamanos).map((i) => i.ancho), [48]);
  assert.deepEqual(unTamano([24, 32, 64].map((n) => ({ ...tam(n, 1), nominal: n }))).map((i) => i.ancho), [64], "a igual distancia, el mayor");
  const animado = unTamano([{ ...tam(32, 1), nominal: 32 }, { ...tam(32, 2), nominal: 32 }, { ...tam(24, 3), nominal: 24 }]);
  assert.deepEqual(animado.map((i) => i.argb[0]), [1, 2], "los fotogramas del tamaño elegido se conservan");
  // .cur con varias imágenes (96, 48 y 24, como los de Yaru): se usa la de 48 con su punto activo, sin escalar.
  const curVarios = (() => {
    const lados = [96, 48, 24], dibs = lados.map((l) => cur(l, 0, 0, 0xff000000 + l).subarray(22));
    const cab = Buffer.alloc(6 + 16 * lados.length);
    cab.writeUInt16LE(2, 2); cab.writeUInt16LE(lados.length, 4);
    let pos = cab.length;
    lados.forEach((l, i) => {
      const e = 6 + i * 16;
      cab[e] = l % 256; cab[e + 1] = l % 256; cab.writeUInt16LE(l / 8, e + 4); cab.writeUInt16LE(l / 16, e + 6);
      cab.writeUInt32LE(dibs[i].length, e + 8); cab.writeUInt32LE(pos, e + 12); pos += dibs[i].length;
    });
    return Buffer.concat([cab, ...dibs]);
  })();
  x = leerXcursor(convertir(curVarios, "yaru.cur", sinPng))[0];
  assert.deepEqual([x.ancho, x.xhot, x.yhot, x.argb[0]], [48, 6, 3, 0xff000030], "la imagen de 48 y su propio punto activo");
  // PNG (decodificado por nativeImage en la app): punto activo arriba a la izquierda.
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  x = leerXcursor(convertir(png, "mio.png", () => ({ ancho: 24, alto: 24, bgra: Buffer.alloc(24 * 24 * 4, 0xff) })))[0];
  assert.deepEqual([x.ancho, x.xhot, x.yhot], [48, 0, 0]);
  assert.throws(() => convertir(Buffer.from("hola, esto no es un cursor"), "x.txt", sinPng), /formato no reconocido/);
  assert.throws(() => convertir(Buffer.from("xx"), "x.cur", sinPng), /vacío/);
  assert.throws(() => convertir(cur(16, 3, 5, 0xff00ff00).subarray(0, 300), "roto.cur", sinPng), /cortado/);
  console.log("unidad: ok");
})();
