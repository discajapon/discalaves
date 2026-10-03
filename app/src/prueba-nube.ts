// Pruebas de los orígenes fuera del equipo sin cuentas reales (npm run prueba:nube, también dentro de npm run prueba):
// - un servidor FALSO local que habla como OpenAI, Claude y Ollama, con guiones por modelo: respuestas, llamadas a
//   herramientas, uso de tokens, corte por cuota y caída a media respuesta;
// - la bóveda cifrada, el túnel SSH contra un sshd local sin sudo (huella, ProxyJump, caída sin reconexión) y la
//   sonda de Codex (si está instalado: DISCALAVES_CODEX o codex en el PATH);
// - la app real (Electron, con datos aparte): un empleado "en la nube" cumple el criterio 1 en su contenedor,
//   uno local y uno en la nube trabajan a la vez, el tope pausa y pregunta, la cuota detiene y avisa, y
//   ninguna clave aparece en disco sin cifrar, en logs ni en el historial.
import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { _electron } from "playwright-core";
import { Boveda } from "./boveda";
import { Codex } from "./codex";
import { borrar, computadoraDe } from "./computadora";
import { definicionesPara } from "./herramientas";
import { HERRAMIENTAS } from "./empleados";
import { aClaude, Corte, listarModelos, sinClave, turnoOpenAI } from "./proveedores";
import { Tunel } from "./tunel";

const CLAVE = `sk-prueba-${randomBytes(12).toString("hex")}`; // no debe aparecer en claro en ningún sitio
const MARCA = `discalaves-fuera-${randomBytes(4).toString("hex")}`; // si aparece en el /tmp del equipo, se ejecutó fuera
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "discalaves-nube-"));

// ---- Servidor falso ----
type Paso = { texto?: string; llamada?: [string, object]; uso?: [number, number]; esperar?: number };
const GUIONES: Record<string, Paso[]> = {
  // criterio 1: comprueba dónde corre, lee una web y deja un informe
  "falso-criterio1": [
    { texto: "Miro dónde estoy.", llamada: ["terminal", { comando: `echo "$HOME"; hostname; touch /tmp/${MARCA}; ls /tmp/${MARCA}` }], esperar: 1500 },
    { llamada: ["abrir_pagina", { url: "https://example.com" }] },
    { llamada: ["escribir_archivo", { ruta: "informe.md", contenido: "# Informe\n\nexample.com es un dominio reservado para ejemplos (fuente: https://example.com).\n" }] },
    { texto: "Listo: guardé informe.md con lo que encontré en https://example.com." },
  ],
  "falso-lento": [{ texto: "hola desde el modelo local", esperar: 1500 }],
  "falso-caro": [{ llamada: ["recordar", { texto: "prueba de tope" }], uso: [2_000_000, 1_000_000] }, { texto: "no debería llegar aquí" }],
  // servidor remoto: lo mismo sin herramientas nativas (órdenes en texto), con razonamiento, con una espera y largo
  "falso-texto": [
    { texto: "Miro dónde estoy.", llamada: ["terminal", { comando: `echo "$HOME"; hostname; touch /tmp/${MARCA}; ls /tmp/${MARCA}` }] },
    { llamada: ["abrir_pagina", { url: "https://example.com" }] },
    { llamada: ["escribir_archivo", { ruta: "informe.md", contenido: "# Informe\n\nexample.com es un dominio reservado para ejemplos (fuente: https://example.com).\n" }] },
    { texto: "Listo: guardé informe.md con lo que encontré en https://example.com." },
  ],
  "falso-piensa": [{ texto: "<think>pienso en secreto-del-modelo</think>Hecho." }],
  "falso-429": [{ texto: "listo tras esperar" }],
  "falso-largo": [
    ...[1, 2, 3, 4].map((i) => ({ llamada: ["abrir_pagina", { url: `https://example.com/?${i}` }] as [string, object], esperar: 2500 })),
    { texto: "terminé lo largo" },
  ],
  "claude-falso": [{ texto: "Anoto.", llamada: ["recordar", { texto: "prueba de Claude" }] }, { texto: "Hecho con Claude." }],
};
const pedidos: { modelo: string; ruta: string; cuerpo: any; auth?: string }[] = [];
let enCurso = 0, maxEnCurso = 0;

function paso(modelo: string, mensajes: any[]): Paso {
  const hechos = mensajes.filter((m) => m.role === "tool" || (typeof m.content === "string" && m.content.startsWith("(resultado de la herramienta")) || (Array.isArray(m.content) && m.content.some((b: any) => b.type === "tool_result"))).length;
  const g = GUIONES[modelo] ?? [{ texto: "ok" }];
  return g[Math.min(hechos, g.length - 1)];
}

const falso = http.createServer((req, res) => {
  let b = "";
  req.on("data", (d) => (b += d));
  req.on("end", async () => {
    const cuerpo = b ? JSON.parse(b) : {};
    const modelo = cuerpo.model ?? "";
    pedidos.push({ modelo, ruta: req.url!, cuerpo, auth: String(req.headers.authorization ?? req.headers["x-api-key"] ?? "") });
    const json = (o: object, status = 200, cab: Record<string, string> = {}) => res.writeHead(status, { "content-type": "application/json", ...cab }).end(JSON.stringify(o));
    const auth = String(req.headers.authorization ?? "");
    if (auth && auth !== `Bearer ${CLAVE}`) return json({ error: { message: "Invalid API key" } }, 401);
    if (req.url === "/api/tags") return json({ models: [{ name: "falso-lento", details: { parameter_size: "1B" } }] });
    if (req.url === "/api/show") return json({ capabilities: ["completion"] });
    // "falso-texto" no dice su ventana (la pone el usuario) y no acepta herramientas nativas; los demás sí
    if (req.url?.endsWith("/models")) return json({ data: Object.keys(GUIONES).concat("falso-cuota", "falso-caida", "text-embedding-falso").map((id) => ({ id, ...(id !== "falso-texto" && { max_model_len: 16384 }) })) });
    if (modelo === "falso-texto" && cuerpo.tools) return json({ error: { message: "tools are not supported" } }, 400);
    if (cuerpo.stream === false) return json({ choices: [{ message: { content: "", tool_calls: [{ function: { name: "eco", arguments: '{"texto":"ok"}' } }] } }] }); // sonda de herramientas
    if (modelo === "falso-429" && !pedidos.some((x) => x.modelo === modelo && x.cuerpo.stream && x !== pedidos.at(-1))) return json({ error: { message: "ocupado" } }, 429, { "retry-after": "1" });
    if (modelo === "falso-cuota") return json({ error: { message: "You exceeded your current quota", type: "insufficient_quota" } }, 429);
    enCurso++;
    maxEnCurso = Math.max(maxEnCurso, enCurso);
    try {
      res.writeHead(200, { "content-type": "text/event-stream" });
      if (modelo === "falso-caida") {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "empiezo…" } }] })}\n\n`);
        await new Promise((r) => setTimeout(r, 200));
        return void res.destroy(); // se corta a media respuesta
      }
      const p = paso(modelo, cuerpo.messages ?? []);
      if (p.esperar) await new Promise((r) => setTimeout(r, p.esperar));
      const [entrada, salida] = p.uso ?? [100, 20];
      if (req.url === "/v1/messages") {
        const ev = (o: object) => res.write(`event: ${(o as any).type}\ndata: ${JSON.stringify(o)}\n\n`);
        ev({ type: "message_start", message: { usage: { input_tokens: entrada, output_tokens: 1 } } });
        let i = 0;
        if (p.texto) {
          ev({ type: "content_block_start", index: i, content_block: { type: "text", text: "" } });
          ev({ type: "content_block_delta", index: i++, delta: { type: "text_delta", text: p.texto } });
        }
        if (p.llamada) {
          ev({ type: "content_block_start", index: i, content_block: { type: "tool_use", id: `toolu_${pedidos.length}`, name: p.llamada[0], input: {} } });
          ev({ type: "content_block_delta", index: i, delta: { type: "input_json_delta", partial_json: JSON.stringify(p.llamada[1]) } });
        }
        ev({ type: "message_delta", delta: { stop_reason: p.llamada ? "tool_use" : "end_turn" }, usage: { output_tokens: salida } });
        ev({ type: "message_stop" });
      } else {
        const d = (delta: object) => res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
        const marca = /<<<llamar:(\w+) /.exec(String(cuerpo.messages?.[0]?.content))?.[1]; // modo texto: la orden va escrita
        if (p.texto) d({ content: p.texto });
        if (p.llamada && marca) d({ content: `<<<llamar:${marca} ${p.llamada[0]}>>>\n${JSON.stringify(p.llamada[1])}\n` });
        else if (p.llamada) d({ tool_calls: [{ index: 0, id: `call_${pedidos.length}`, function: { name: p.llamada[0], arguments: JSON.stringify(p.llamada[1]) } }] });
        res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: entrada, completion_tokens: salida } })}\n\n`);
        res.write("data: [DONE]\n\n");
      }
      res.end();
    } finally {
      enCurso--;
    }
  });
});

// ---- Bóveda (con un cifrador AES de prueba en lugar del llavero del sistema) ----
function pruebaBoveda() {
  const k = randomBytes(32);
  const cifrador = {
    disponible: () => true,
    cifrar: (t: string) => {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", k, iv);
      const datos = Buffer.concat([c.update(t, "utf8"), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), datos]);
    },
    descifrar: (b: Buffer) => {
      const d = createDecipheriv("aes-256-gcm", k, b.subarray(0, 12));
      d.setAuthTag(b.subarray(12, 28));
      return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
    },
  };
  const archivo = path.join(tmp, "boveda.cifrado");
  const b = new Boveda(archivo, cifrador);
  b.guardar([{ id: "x", nombre: "X", tipo: "openai", clave: CLAVE }]);
  assert.equal(b.leer()[0].clave, CLAVE);
  assert.ok(!fs.readFileSync(archivo).includes(CLAVE), "la bóveda guardó la clave en claro");
  assert.equal(fs.statSync(archivo).mode & 0o077, 0, "la bóveda no debe ser legible por otros usuarios");
  const sin = new Boveda(path.join(tmp, "sin.cifrado"), { ...cifrador, disponible: () => false });
  assert.throws(() => sin.guardar([]), /almacén seguro/, "sin llavero no debe guardar");
  assert.equal(fs.existsSync(path.join(tmp, "sin.cifrado")), false);
  assert.equal(sinClave(`clave inválida: ${CLAVE}`, CLAVE), "clave inválida: ***");
  // Formato de Claude: resultados de herramientas como tool_result y turnos alternados.
  const c = aClaude([
    { role: "user", content: "hola" },
    { role: "assistant", content: "", tool_calls: [{ id: "t1", type: "function", function: { name: "recordar", arguments: '{"texto":"a"}' } }] },
    { role: "tool", tool_call_id: "t1", content: "ok" },
    { role: "user", content: "(aviso) sigue" },
  ]);
  assert.deepEqual(c.map((m) => m.role), ["user", "assistant", "user"]);
  assert.deepEqual(c[1].content, [{ type: "tool_use", id: "t1", name: "recordar", input: { texto: "a" } }]);
  assert.equal((c[2].content[0] as any).type, "tool_result");
  console.log("bóveda y formatos: ok");
}

// ---- Adaptador contra el servidor falso: cuota y caída se detienen sin reintentar ----
async function pruebaAdaptador(base: string) {
  const pedido = { url: `${base}/v1`, clave: CLAVE, sistema: "s", mensajes: [{ role: "user", content: "hola" }], herramientas: [], senal: new AbortController().signal, alTexto: () => {} };
  const antes = pedidos.length;
  await assert.rejects(turnoOpenAI({ ...pedido, modelo: "falso-cuota" }), (e) => e instanceof Corte && /cortó \(429\)/.test((e as Error).message));
  await assert.rejects(turnoOpenAI({ ...pedido, modelo: "falso-caida" }));
  assert.equal(pedidos.length - antes, 2, "no debe reintentar tras un corte o una caída");
  const t = await turnoOpenAI({ ...pedido, modelo: "falso-caro" });
  assert.deepEqual(t.uso, { entrada: 2_000_000, salida: 1_000_000 });
  assert.equal(t.llamadas[0].nombre, "recordar");
  const lista = await listarModelos("compatible", `${base}/v1`, CLAVE);
  assert.ok(lista.some((m) => m.modelo === "falso-criterio1") && !lista.some((m) => m.modelo.includes("embedding")));
  console.log("adaptadores: ok");
}

// ---- Túnel SSH contra un sshd local sin sudo: huella en el primer contacto, ProxyJump y caída ----
async function pruebaTunel(base: string) {
  const sshd = "/usr/sbin/sshd";
  if (!fs.existsSync(sshd)) return console.log("túnel: SIN PROBAR (no hay sshd en este equipo)");
  const d = path.join(tmp, "ssh");
  fs.mkdirSync(d, { mode: 0o700 });
  execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", path.join(d, "host")]);
  execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", path.join(d, "usuario")]);
  fs.copyFileSync(path.join(d, "usuario.pub"), path.join(d, "autorizadas"));
  const puerto = 20000 + Math.floor(Math.random() * 20000);
  fs.writeFileSync(path.join(d, "sshd_config"), [
    `Port ${puerto}`, "ListenAddress 127.0.0.1", `HostKey ${d}/host`, `AuthorizedKeysFile ${d}/autorizadas`, "PidFile none",
    "UsePAM no", "StrictModes no", "PasswordAuthentication no", "AllowTcpForwarding yes", "LogLevel ERROR",
  ].join("\n") + "\n");
  const servidor = spawn(sshd, ["-D", "-e", "-f", path.join(d, "sshd_config")], { stdio: "ignore" });
  // Apagarlo de verdad: sus conexiones viven en procesos hijos (con su propia sesión); se cierran por PID.
  const apagar = () => {
    let hijos: string[] = [];
    try {
      hijos = execFileSync("ps", ["-o", "pid=", "--ppid", String(servidor.pid)]).toString().split(/\s+/).filter(Boolean);
    } catch {
      // sin hijos
    }
    for (const pid of [...hijos.map(Number), servidor.pid!]) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // ya terminó
      }
    }
  };
  await new Promise((r) => setTimeout(r, 500));
  const usuario = os.userInfo().username;
  // Config propio: "destino" se alcanza saltando por "salto" (los dos son el sshd local).
  fs.writeFileSync(path.join(d, "config"), [
    "Host salto destino", `  HostName 127.0.0.1`, `  Port ${puerto}`, `  User ${usuario}`, `  IdentityFile ${d}/usuario`, "  IdentitiesOnly yes",
    `  UserKnownHostsFile ${d}/known_hosts`, "Host destino", "  ProxyJump salto",
  ].join("\n") + "\n");
  const preguntas: string[] = [];
  const opciones = ["-F", path.join(d, "config")];
  try {
    let t = await Tunel.abrir("destino", `${base}/v1`, path.join(d, "askpass"), async (p) => (preguntas.push(p.tipo), p.tipo === "huella" ? "yes" : null), opciones);
    assert.ok(preguntas.includes("huella"), "el primer contacto debe pedir confirmar la huella");
    assert.ok(fs.readFileSync(path.join(d, "known_hosts"), "utf8").includes("ssh-ed25519"), "la huella aceptada debe quedar en known_hosts");
    assert.ok((await listarModelos("tunel", t.base(`${base}/v1`), CLAVE)).length > 0, "por el túnel debe llegar al servidor");
    t.cerrar();
    // Segunda vez: ya es conocido, no pregunta.
    preguntas.length = 0;
    t = await Tunel.abrir("destino", `${base}/v1`, path.join(d, "askpass"), async () => (preguntas.push("x"), null), opciones);
    assert.equal(preguntas.length, 0, "un host conocido no debe volver a preguntar");
    // Huella rechazada: no conecta.
    fs.rmSync(path.join(d, "known_hosts"));
    await assert.rejects(Tunel.abrir("destino", `${base}/v1`, path.join(d, "askpass"), async () => "no", opciones), /no pude abrir el túnel/);
    // Caída: avisa una vez y no se reconecta.
    let avisos = 0;
    t.alCaer(() => avisos++);
    apagar();
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(t.caido, true, "debe notar que se cayó");
    assert.equal(avisos, 1, "la caída debe avisar una sola vez");
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(avisos, 1, "no debe reconectarse solo");
    await assert.rejects(Tunel.abrir("destino", "no es url", d, async () => null), /no son válidos/);
    await assert.rejects(Tunel.abrir("-oProxyCommand=touch", `${base}/v1`, d, async () => null), /no son válidos/, "un host que empieza por - sería una opción de ssh");
    console.log("túnel SSH: ok (huella, known_hosts, ProxyJump, caída)");
  } finally {
    apagar();
  }
}

// ---- Codex: con la versión instalada, solo ofrece las herramientas de Discalaves ----
async function pruebaCodex() {
  const c = new Codex(path.join(os.homedir(), ".cache", "discalaves-prueba-codex")); // fuera de /tmp: Codex no crea ayudantes allí
  if (!(await c.instalado())) return console.log("codex: SIN PROBAR (no está instalado; DISCALAVES_CODEX=<ruta> para probarlo)");
  const nuestras = definicionesPara(HERRAMIENTAS, true, [{ nombre: "otro", rol: "" }]);
  // Cada modelo que lista Codex: ninguna herramienta propia (terminal, parches, web…) llega al modelo.
  const utiles: string[] = [];
  for (const { modelo } of await c.modelos()) {
    const vistas = await c.herramientasOfrecidas(nuestras, modelo);
    for (const peligrosa of ["exec_command", "shell", "apply_patch", "web_search", "view_image", "write_stdin", "tool_search"]) assert.ok(!vistas.includes(peligrosa), `con ${modelo} Codex ofrece ${peligrosa}`);
    const motivo = await c.sonda(nuestras, modelo);
    assert.ok(!motivo?.includes("herramientas propias"), motivo ?? "");
    if (!motivo) utiles.push(modelo);
    if (!motivo) assert.ok(vistas.includes("mcp__discalaves/terminal"), "debe ofrecer la terminal de Discalaves (su contenedor)");
  }
  assert.ok(utiles.length > 0, "ningún modelo de Codex recibe las herramientas de Discalaves");
  console.log(`codex: ok (sin herramientas propias en ningún modelo; utilizables: ${utiles.join(", ")})`);
}

// ---- La app real con datos aparte ----
async function pruebaApp(base: string) {
  const datos = path.join(tmp, "datos"), ia = path.join(tmp, "ia");
  const logs: string[] = [];
  const app = await _electron.launch({
    args: [path.join(__dirname, "..")],
    // Playwright fuerza --password-store=basic (clave fija): se pide el llavero de verdad para probar la bóveda real.
    env: { ...process.env, DISCALAVES_DATOS: datos, DISCALAVES_IA: ia, DISCALAVES_OLLAMA: base, DISCALAVES_LLAVERO: process.env.DISCALAVES_LLAVERO || "gnome-libsecret" } as Record<string, string>,
  });
  app.process().stdout?.on("data", (d) => logs.push(String(d)));
  app.process().stderr?.on("data", (d) => logs.push(String(d)));
  app.process().on("exit", (codigo, senal) => logs.push(`\n[la app terminó: código ${codigo}, señal ${senal}]\n`));
  const usuarios: string[] = [];
  try {
    const w = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.hide()); // sin robar la pantalla
    await w.waitForFunction(() => "discalaves" in window);
    const api = <T>(f: string, ...a: unknown[]) => w.evaluate(([f, a]) => (window as any).discalaves[f as string](...(a as unknown[])), [f, a] as const) as Promise<T>;
    const { almacen } = await api<{ almacen: boolean }>("proveedores");
    if (!almacen) return console.log("app: SIN PROBAR (este sistema no tiene llavero para safeStorage)");
    const p = await api<{ id: string; error?: string }>("guardarProveedor", { tipo: "compatible", nombre: "Nube falsa", url: `${base}/v1`, clave: CLAVE });
    assert.ok(p.id, p.error);
    const pc = await api<{ id: string; error?: string }>("guardarProveedor", { tipo: "claude", nombre: "Claude falso", url: `${base}/v1`, clave: CLAVE });
    assert.ok(pc.id, pc.error);
    assert.equal((await api<{ modelos?: number; error?: string }>("probarProveedor", p.id)).modelos, 10);
    await api("probarProveedor", pc.id);
    const provs = await api<any>("proveedores");
    assert.ok(!JSON.stringify(provs).includes(CLAVE), "la interfaz no debe recibir las claves");

    const herramientas = ["terminal", "abrir_pagina", "escribir_archivo"];
    const crear = async (nombre: string, modelo: string, extra: object = {}) => {
      const r = await api<{ id?: string; error?: string }>("crearEmpleado", { nombre, rol: "", color: "azul", modelo, herramientas, instrucciones: "", precio: { entrada: 1, salida: 2 }, tope: 13, ...extra });
      assert.ok(r.id, r.error);
      usuarios.push(r.id!);
      return r.id!;
    };
    const sinPrecio = await api<{ error?: string }>("crearEmpleado", { nombre: "Sin precio", rol: "", color: "azul", modelo: `nube:${p.id}:falso-lento`, herramientas, instrucciones: "" });
    assert.match(sinPrecio.error ?? "", /precio/, "sin precio conocido debe pedirlo");
    const nube = await crear("Nube Prueba", `nube:${p.id}:falso-criterio1`);
    const local = await crear("Local Prueba", "ollama:falso-lento");
    const caro = await crear("Caro Prueba", `nube:${p.id}:falso-caro`, { tope: 1 });
    const cuota = await crear("Cuota Prueba", `nube:${p.id}:falso-cuota`);
    const claude = await crear("Claude Prueba", `nube:${pc.id}:claude-falso`);

    // Un local y uno en la nube a la vez (y las aprobaciones del tope, respondidas "no").
    await w.evaluate(() =>
      (window as any).discalaves.alAprobacion((a: any) => {
        ((window as any).__aprobaciones ??= []).push(a);
        void (window as any).discalaves.aprobar(a.id, false); // "no": el tope debe pausar
      }),
    );
    const [rNube, rLocal] = await Promise.all([api<{ error?: string }>("enviar", nube, "Investiga qué es example.com y deja un informe en informe.md"), api<{ error?: string }>("enviar", local, "hola")]);
    assert.equal(rNube.error, undefined, rNube.error);
    assert.equal(rLocal.error, undefined, rLocal.error);
    assert.ok(maxEnCurso >= 2, "el local y el de la nube debían trabajar a la vez");

    // Criterio 1 en su contenedor, y nada fuera de él.
    const informe = path.join(ia, "trabajo", nube, "informe.md");
    assert.match(fs.readFileSync(informe, "utf8"), /example\.com/);
    const hilo = await api<any[]>("historial", nube);
    const terminal = hilo.find((m) => m.de === "herramienta" && m.nombre === "terminal");
    assert.match(terminal.salida, new RegExp(`/home/${nube}\\n`), "la terminal debe correr en su computadora");
    assert.ok(!terminal.salida.includes(os.hostname() + "\n") || os.hostname() === "", "la terminal corrió en el equipo");
    assert.equal(fs.existsSync(`/tmp/${MARCA}`), false, "se ejecutó algo fuera de su contenedor");
    assert.match(hilo.at(-1).texto, /informe\.md/);
    // Sus pedidos llevan la clave (en la cabecera) y el mismo prompt base que los locales.
    const suyo = pedidos.find((x) => x.modelo === "falso-criterio1")!;
    assert.equal(suyo.auth, `Bearer ${CLAVE}`);
    assert.match(suyo.cuerpo.messages[0].content, /^Eres un empleado de Discalaves/);

    // El tope pausa y pregunta (respuesta: no); la cuota detiene y avisa, sin reintentos.
    const desde = pedidos.length;
    const rCaro = await api<{ error?: string }>("enviar", caro, "haz algo");
    assert.equal(rCaro.error, undefined, rCaro.error);
    const aprob = await w.evaluate(() => (window as any).__aprobaciones as any[]);
    assert.ok(aprob?.some((a) => /tope de 1 USD/.test(a.descripcion)), "el tope debía pedir aprobación");
    assert.match((await api<any[]>("historial", caro)).at(-1).texto, /me pausé/);
    assert.equal(pedidos.slice(desde).filter((x) => x.modelo === "falso-caro").length, 1, "tras el tope no debe seguir gastando");
    const desdeCuota = pedidos.length;
    const rCuota = await api<{ error?: string }>("enviar", cuota, "hola");
    assert.match(rCuota.error ?? "", /se detuvo: el proveedor cortó \(429\)/);
    assert.equal(pedidos.slice(desdeCuota).filter((x) => x.modelo === "falso-cuota").length, 1, "no debe reintentar tras un corte");

    // API nativa de Claude: herramienta y resultado de ida y vuelta.
    const rClaude = await api<{ error?: string }>("enviar", claude, "anota algo");
    assert.equal(rClaude.error, undefined, rClaude.error);
    assert.equal((await api<any[]>("historial", claude)).at(-1).texto, "Hecho con Claude.");
    const segundo = pedidos.filter((x) => x.modelo === "claude-falso")[1].cuerpo;
    assert.equal(segundo.messages.at(-1).content[0].type, "tool_result");
    assert.equal(pedidos.find((x) => x.modelo === "claude-falso")!.auth, CLAVE);

    // Marca y origen para la interfaz.
    const convs = await api<any[]>("conversaciones");
    assert.equal(convs.find((c) => c.id === nube).origen, "nube");
    assert.equal(convs.find((c) => c.id === local).origen, "local");
    console.log("app: ok (criterio 1 en su contenedor, local y nube a la vez, tope, cuota, Claude)");

    // ---- Servidor remoto compatible con OpenAI (decisión del usuario, 2026-10-02) ----
    const mala = await api<{ error?: string }>("guardarProveedor", { tipo: "remoto", nombre: "Remoto malo", url: base, clave: "clave-equivocada" });
    assert.match(mala.error ?? "", /401/, "una clave rechazada debe decirlo claro");
    const r = await api<{ id: string; error?: string }>("guardarProveedor", { tipo: "remoto", nombre: "Servidor falso", url: `${base}/v1/`, clave: CLAVE });
    assert.ok(r.id, r.error);
    const sondeo = await api<{ modelos?: number; servidor?: any; error?: string }>("probarProveedor", r.id);
    assert.equal(sondeo.error, undefined, sondeo.error);
    assert.ok(sondeo.servidor.modelos.includes("falso-criterio1"));
    // sin elegir modelo no se puede activar; sin aceptar el aviso tampoco
    assert.match((await api<{ error?: string }>("servidorActivar", r.id, true)).error ?? "", /modelo/);
    let aj = await api<{ servidor?: any; error?: string }>("servidorAjustes", r.id, { modelo: "falso-criterio1" });
    assert.equal(aj.servidor.herramientas, "nativas");
    assert.equal(aj.servidor.contexto, 16384, "la ventana sale de la lista del servidor");
    assert.equal(aj.servidor.contextoDelServidor, true);
    assert.match((await api<{ error?: string }>("servidorActivar", r.id, false)).error ?? "", /aceptar/);
    assert.ok(!JSON.stringify(await api<any>("proveedores")).includes(CLAVE), "la interfaz no debe recibir las claves");
    // "falso-texto": sin herramientas nativas y sin ventana en la lista: el usuario la pone
    aj = await api("servidorAjustes", r.id, { modelo: "falso-texto" });
    assert.equal(aj.servidor.herramientas, "texto");
    assert.equal(aj.servidor.contexto, undefined);
    assert.match((await api<{ error?: string }>("servidorAjustes", r.id, { contexto: "12" })).error ?? "", /1024/);
    aj = await api("servidorAjustes", r.id, { contexto: "16384" });
    assert.equal(aj.servidor.contexto, 16384);
    aj = await api("servidorAjustes", r.id, { modelo: "falso-criterio1" });

    // Activar: todos los empleados existentes pasan al servidor y los nuevos nacen con él
    const act = await api<{ cambiados?: number; error?: string }>("servidorActivar", r.id, true);
    assert.ok((act.cambiados ?? 0) >= 5, act.error);
    const todos = (await api<any[]>("conversaciones")).filter((c) => !c.equipo);
    assert.ok(todos.every((c) => c.origen === "remoto" && c.modelo === "falso-criterio1"), "todos debían quedar en el servidor remoto");
    assert.equal((await api<{ modelos: any[] }>("modelos")).modelos.find((m) => m.predeterminado)?.valor, `nube:${r.id}:falso-criterio1`);
    // sin precios ni tope: un empleado remoto se crea sin ellos
    const remoto = async (nombre: string, modelo: string) => crear(nombre, `nube:${r.id}:${modelo}`, { precio: undefined, tope: undefined });
    const unoNativo = await remoto("Remoto Nativo", "falso-criterio1");
    const unoTexto = await remoto("Remoto Texto", "falso-texto");
    // Dos trabajan a la vez, sin cola de VRAM, uno con herramientas nativas y otro con el respaldo en texto
    maxEnCurso = 0;
    const antesRemotos = pedidos.length;
    const medicion = process.env.DISCALAVES_MEDIR_RAM ? medirRam() : undefined;
    const [r1, r2] = await Promise.all([api<{ error?: string }>("enviar", unoNativo, "Investiga qué es example.com y deja un informe en informe.md"), api<{ error?: string }>("enviar", unoTexto, "Investiga qué es example.com y deja un informe en informe.md")]);
    assert.equal(r1.error, undefined, r1.error);
    assert.equal(r2.error, undefined, r2.error);
    assert.ok(maxEnCurso >= 2, "los dos empleados remotos debían trabajar a la vez");
    for (const u of [unoNativo, unoTexto]) {
      assert.match(fs.readFileSync(path.join(ia, "trabajo", u, "informe.md"), "utf8"), /example\.com/, `criterio 1 de ${u}`);
      const h = await api<any[]>("historial", u);
      assert.match(h.find((m) => m.de === "herramienta" && m.nombre === "terminal").salida, new RegExp(`/home/${u}\\n`), "la terminal debe correr en su computadora");
      assert.match(h.at(-1).texto, /informe\.md/);
      assert.ok(!JSON.stringify(h).includes("<<<"), "las órdenes en texto no deben quedar en el historial");
    }
    assert.equal(fs.existsSync(`/tmp/${MARCA}`), false, "se ejecutó algo fuera de su contenedor");
    const nuevos = pedidos.slice(antesRemotos);
    assert.ok(nuevos.filter((x) => x.modelo === "falso-texto" && x.cuerpo.stream).every((x) => !x.cuerpo.tools && /FORMA DE USAR HERRAMIENTAS/.test(x.cuerpo.messages[0].content)), "el de texto no debe recibir tools nativas");
    assert.ok(nuevos.filter((x) => x.modelo === "falso-criterio1" && x.cuerpo.stream).every((x) => x.cuerpo.tools?.length), "el nativo debe recibir tools");
    assert.ok((await api<any>("empleado", unoNativo)).remoto, "el perfil debe saber que es un servidor remoto (sin precios ni tope)");
    // Razonamiento: no se ve ni se guarda
    const piensa = await remoto("Remoto Piensa", "falso-piensa");
    assert.equal((await api<{ error?: string }>("enviar", piensa, "hola")).error, undefined);
    const hp = await api<any[]>("historial", piensa);
    assert.equal(hp.at(-1).texto, "Hecho.");
    assert.ok(!JSON.stringify(hp).includes("secreto-del-modelo"), "el razonamiento no debe quedar en el historial");
    // 429: espera lo que pide el servidor y sigue
    const espera = await remoto("Remoto Espera", "falso-429");
    const t0 = Date.now();
    assert.equal((await api<{ error?: string }>("enviar", espera, "hola")).error, undefined);
    assert.ok(Date.now() - t0 >= 1000, "debía esperar el Retry-After");
    assert.equal((await api<any[]>("historial", espera)).at(-1).texto, "listo tras esperar");
    // Si el servidor se cae: el empleado se detiene y avisa, sin reintentos ni modelo local
    const cae = await remoto("Remoto Cae", "falso-caida");
    const desdeCaida = pedidos.length;
    const rCae = await api<{ error?: string }>("enviar", cae, "hola");
    assert.match(rCae.error ?? "", /se detuvo: se cortó la conexión/);
    assert.equal(pedidos.slice(desdeCaida).filter((x) => x.modelo === "falso-caida" && x.cuerpo.stream).length, 1, "no debe reintentar");
    assert.ok(!(await api<any[]>("conversaciones")).some((c) => c.id === cae && c.origen === "local"), "no debe pasar a un modelo local");
    if (medicion) await medicionCon(medicion, api, remoto);
    console.log("remoto (app): ok (activación para todos, criterio 1 con herramientas nativas y en texto, a la vez, razonamiento oculto, 429, caída)");
  } catch (e) {
    await new Promise((r) => setTimeout(r, 1500));
    let errores = "";
    try {
      errores = fs.readFileSync(path.join(datos, "errores.log"), "utf8");
    } catch {
      // sin errores anotados
    }
    console.error(`--- registro de la app ---\n${logs.join("").slice(-3000)}\n--- errores.log ---\n${errores.slice(-3000)}`);
    throw e;
  } finally {
    await app.close().catch(() => {});
    for (const u of usuarios) await borrar(computadoraDe("", u)).catch(() => {});
  }
  // Ninguna clave en disco sin cifrar, en logs ni en el historial.
  const dondeEsta = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) return dondeEsta(f);
      return e.isFile() && fs.readFileSync(f).includes(CLAVE) ? [f] : [];
    });
  assert.deepEqual([...dondeEsta(datos), ...dondeEsta(ia)], [], "la clave apareció sin cifrar en disco");
  assert.ok(!logs.join("").includes(CLAVE), "la clave apareció en los logs");
  const cifrado = fs.readFileSync(path.join(datos, "proveedores.cifrado"));
  assert.notEqual(cifrado.subarray(0, 3).toString(), "v10", "la bóveda usó la clave fija de Chromium, no el llavero");
  console.log("claves: ok (ni en disco sin cifrar, ni en logs, ni en el historial)");
}

// RAM con varios contenedores trabajando a la vez (DISCALAVES_MEDIR_RAM=1): muestrea el sistema y cada computadora.
function medirRam() {
  const muestras: { usado: number; contenedores: number }[] = [];
  let enCurso = false;
  const sacar = async () => {
    if (enCurso) return;
    enCurso = true;
    try {
      const sh = promisify(execFile);
      const libre = (await sh("free", ["-m"])).stdout.split("\n")[1].split(/\s+/);
      const docker = (await sh("docker", ["stats", "--no-stream", "--format", "{{.Name}} {{.MemUsage}}"])).stdout.trim().split("\n").filter((l) => l.startsWith("discalaves-") && !l.startsWith("discalaves-computadora-red"));
      const mb = (t: string) => (/GiB/.test(t) ? parseFloat(t) * 1024 : parseFloat(t));
      muestras.push({ usado: Number(libre[2]), contenedores: docker.reduce((a, l) => a + mb(l.split(" ")[1]), 0) });
    } catch {
      // una muestra perdida no importa
    } finally {
      enCurso = false;
    }
  };
  const t = setInterval(() => void sacar(), 1500);
  return { muestras, parar: () => clearInterval(t) };
}
async function medicionCon(m: ReturnType<typeof medirRam>, api: <T>(f: string, ...a: unknown[]) => Promise<T>, remoto: (n: string, mod: string) => Promise<string>) {
  m.parar();
  const mayor = (k: "usado" | "contenedores") => Math.max(...m.muestras.map((x) => x[k]));
  console.log(`RAM con 2 empleados remotos trabajando: sistema usado máx ${mayor("usado")} MB, contenedores máx ${Math.round(mayor("contenedores"))} MB (${m.muestras.length} muestras)`);
  // tres a la vez, con tareas largas que mantienen Chromium abierto
  const tres = await Promise.all(["Largo A", "Largo B", "Largo C"].map((n) => remoto(n, "falso-largo")));
  const m3 = medirRam();
  const antes = Number(execFileSync("free", ["-m"]).toString().split("\n")[1].split(/\s+/)[2]);
  const rs = await Promise.all(tres.map((id) => api<{ error?: string }>("enviar", id, "abre varias páginas")));
  assert.deepEqual(rs.map((x) => x.error), [undefined, undefined, undefined]);
  m3.parar();
  const may = (k: "usado" | "contenedores") => Math.max(...m3.muestras.map((x) => x[k]));
  console.log(`RAM con 3 empleados remotos trabajando (navegando): sistema usado antes ${antes} MB, máx ${may("usado")} MB, contenedores máx ${Math.round(may("contenedores"))} MB (${m3.muestras.length} muestras)`);
}

async function main() {
  await new Promise<void>((r) => falso.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(falso.address() as AddressInfo).port}`;
  try {
    pruebaBoveda();
    await pruebaAdaptador(base);
    await pruebaTunel(base);
    await pruebaCodex();
    if (!process.argv.includes("--sin-app")) await pruebaApp(base);
  } finally {
    falso.closeAllConnections();
    falso.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
