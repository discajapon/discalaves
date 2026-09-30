// Pruebas que no necesitan GPU, Docker ni WSL: rutas y adaptadores por sistema. Corren en Linux y en el
// runner de Windows de GitHub Actions: npm run prueba:unidad
import assert from "node:assert/strict";
import { Empleados, leerIdentidad, promptEmpleado, textoIdentidad } from "./empleados";
import { textoDeHtml, verificar } from "./herramientas";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { ordenMotor } from "./computadora";
import { bajar, extraer } from "./instalar";
import { rutasPara } from "./rutas";
import { distrosDe, textoWsl } from "./wsl";

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
  servidor.close();
  fs.rmSync(tmpI, { recursive: true, force: true });
  console.log("unidad: ok");
})();
