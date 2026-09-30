// OpenClaw como motor de los empleados con `motor: openclaw` (el resto sigue con el bucle propio de main.ts).
// La app arranca su propio Gateway de OpenClaw (con el Node de Electron y su estado en <datos>/openclaw, sin
// tocar el ~/.openclaw del usuario), le escribe la configuración (un agente por empleado, el modelo = nuestro
// llama-server) y le habla por su API compatible con OpenAI, en streaming.
//
// Dónde corre cada herramienta:
// - exec/read/write/edit/apply_patch/process: en la computadora del empleado. OpenClaw usa su sandbox SSH,
//   pero su "ssh" es scriptEntrar() de computadora.ts, que entra en el contenedor con el motor (sin servidor SSH).
// - browser: el Chromium del escritorio del empleado por CDP (se ve en la pantalla en vivo). El plugin fuerza
//   el perfil del propio empleado: nunca el navegador del usuario ni el de otro empleado.
// - web_fetch/web_search: desde el Gateway, en el equipo; OpenClaw bloquea direcciones privadas y de loopback.
// El plugin de Discalaves (app/openclaw/discalaves) consulta a la app antes de cada herramienta (Detener,
// aprobaciones, navegador) y le cuenta el resultado después, por un servidor HTTP en 127.0.0.1 con token.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { scriptEntrar } from "./computadora";

// Principales: las que trae un empleado nuevo. Adicionales: el usuario las activa. Nunca: salen de su computadora
// (mensajería, dispositivos emparejados, el propio Gateway…) y se bloquean aunque alguien las ponga en el perfil.
export const PRINCIPALES_OC = ["exec", "read", "write", "edit", "web_fetch", "browser"];
export const ADICIONALES_OC = [
  "apply_patch", "process", "web_search", "update_plan", "memory_search", "memory_get",
  "agents_list", "sessions_list", "sessions_history", "sessions_send", "sessions_spawn", "subagents",
  "create_goal", "get_goal", "update_goal", "cron",
];
const NUNCA_OC = ["gateway", "nodes", "message", "canvas", "tts", "skill_workshop", "file_fetch", "file_write", "dir_fetch", "dir_list"];
const PLUGIN = path.join(__dirname, "..", "openclaw", "discalaves");

export interface AgenteOC { id: string; usuario: string; herramientas: string[] }
export interface Puente {
  cdp(agente: string): Promise<string>; // "http://127.0.0.1:<puerto>" del Chromium de su computadora (lo abre si hace falta)
  antes(agente: string, herramienta: string, parametros: Record<string, unknown>): Promise<{ bloquear?: boolean; motivo?: string; parametros?: Record<string, unknown> }>;
  despues(agente: string, herramienta: string, parametros: Record<string, unknown>, resultado: unknown, error: unknown): void;
}

function puertoLibre(): Promise<number> {
  return new Promise((resolver, rechazar) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolver(p));
    });
    s.on("error", rechazar);
  });
}

// El programa de OpenClaw: el del paquete de la app.
function programa(): string {
  return path.join(__dirname, "..", "node_modules", "openclaw", "openclaw.mjs");
}

export class OpenClaw {
  private proceso: ChildProcess | undefined;
  private puerto = 0;
  private readonly token = randomBytes(24).toString("hex");
  private readonly tokenPuente = randomBytes(24).toString("hex");
  private urlPuente = "";
  private agentes: AgenteOC[] = [];
  // Un puerto fijo por empleado en 127.0.0.1 que reenvía al CDP de su Chromium: el puerto del contenedor cambia en
  // cada arranque y OpenClaw solo lee los perfiles del navegador al arrancar.
  private reenvios: Record<string, number> = {};
  private repetidas = new Map<string, number>(); // freno de repeticiones de la tarea en curso
  private parar: (() => void) | undefined;
  private listo: Promise<void> | undefined;

  constructor(private readonly dir: string, private readonly llama: { url: string; clave: string; modelo: string; contexto: number }, private readonly puente: Puente) {}

  private get archivoConfig() {
    return path.join(this.dir, "openclaw.json");
  }

  // Escribe la configuración entera; el Gateway la vigila y la aplica sin reiniciarse.
  private escribirConfig() {
    const perfil = (id: string) => `discalaves-${id}`;
    const config = {
      gateway: { mode: "local", bind: "loopback", port: this.puerto, auth: { mode: "token", token: this.token }, http: { endpoints: { chatCompletions: { enabled: true } } } },
      models: {
        mode: "replace",
        providers: {
          discalaves: {
            baseUrl: `${this.llama.url}/v1`, apiKey: this.llama.clave, api: "openai-completions", timeoutSeconds: 300,
            models: [{ id: this.llama.modelo, name: this.llama.modelo, reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: this.llama.contexto, maxTokens: 4096 }],
          },
        },
      },
      agents: {
        defaults: {
          model: { primary: `discalaves/${this.llama.modelo}` },
          // Prompt corto: sin archivos de plantilla ni skills (con 16k de contexto no caben; medido 2026-09-29).
          skipBootstrap: true,
          skills: [],
          // Reserva y cola reciente a la medida de 16k: con los valores por defecto (pensados para 128k+) la
          // compactación nunca libera nada y la respuesta acaba en error.
          compaction: { reserveTokens: 3000, reserveTokensFloor: 3000, keepRecentTokens: 4000 },
        },
        list: this.agentes.map((a) => ({
          id: a.id,
          workspace: path.join(this.dir, "espacios", a.id),
          // Con la sandbox activa hay una segunda lista (tools.sandbox.tools): las mismas del puesto.
          tools: {
            profile: "minimal",
            alsoAllow: a.herramientas.filter((h) => !NUNCA_OC.includes(h)),
            deny: NUNCA_OC,
            sandbox: { tools: { allow: a.herramientas.filter((h) => !NUNCA_OC.includes(h)) } },
          },
          sandbox: {
            mode: "all", backend: "ssh", scope: "agent", workspaceAccess: "rw",
            // "host" para OpenClaw = el Gateway; el plugin fuerza el perfil del empleado, cuyo cdpUrl es su Chromium.
            browser: { allowHostControl: true },
            ssh: { target: `${a.usuario}@discalaves-${a.usuario}:22`, command: path.join(this.dir, "entrar"), workspaceRoot: `/home/${a.usuario}/openclaw`, strictHostKeyChecking: false, updateHostKeys: false },
          },
        })),
      },
      tools: { elevated: { enabled: false } },
      browser: {
        enabled: true,
        defaultProfile: this.agentes[0] ? perfil(this.agentes[0].id) : "openclaw",
        profiles: Object.fromEntries(Object.entries(this.reenvios).map(([id, puerto]) => [perfil(id), { cdpUrl: `http://127.0.0.1:${puerto}`, attachOnly: true, color: "#7C5CE6" }])),
      },
      plugins: {
        load: { paths: [PLUGIN] },
        entries: { discalaves: { enabled: true, config: { url: this.urlPuente, token: this.tokenPuente }, hooks: { timeouts: { before_tool_call: 600_000 } } } },
      },
      skills: { allowBundled: [] },
    };
    fs.writeFileSync(this.archivoConfig, JSON.stringify(config, null, 2), { mode: 0o600 });
  }

  // Empleados con motor OpenClaw; se puede llamar en cualquier momento. Si cambia quién está, el Gateway se
  // reinicia en el próximo mensaje (sus perfiles de navegador no se recargan en caliente).
  configurar(agentes: AgenteOC[]) {
    const antes = this.agentes.map((a) => a.id).join();
    this.agentes = agentes;
    if (this.proceso && antes !== agentes.map((a) => a.id).join()) this.proceso.kill();
    else if (this.proceso) this.escribirConfig();
  }

  private async reenviar(agente: string): Promise<number> {
    const servidor = net.createServer((entrada) => {
      entrada.pause();
      this.puente.cdp(agente).then(
        (url) => {
          const salida = net.connect(Number(new URL(url).port), "127.0.0.1");
          entrada.pipe(salida).pipe(entrada);
          entrada.resume();
          salida.on("error", () => entrada.destroy());
          entrada.on("error", () => salida.destroy());
        },
        () => entrada.destroy(),
      );
    });
    await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", () => r()));
    return (servidor.address() as net.AddressInfo).port;
  }

  iniciar(): Promise<void> {
    return (this.listo ??= this.arrancar().catch((e) => {
      this.listo = undefined;
      throw e;
    }));
  }

  private async arrancar() {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(path.join(this.dir, "entrar"), scriptEntrar(), { mode: 0o700 });
    this.urlPuente = await this.servirPuente();
    this.puerto = await puertoLibre();
    for (const a of this.agentes) this.reenvios[a.id] ??= await this.reenviar(a.id);
    this.escribirConfig();
    const log = fs.openSync(path.join(this.dir, "gateway.log"), "w");
    this.proceso = spawn(process.execPath, [programa(), "gateway", "--port", String(this.puerto)], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", OPENCLAW_STATE_DIR: this.dir, OPENCLAW_CONFIG_PATH: this.archivoConfig },
      stdio: ["ignore", log, log],
    });
    this.proceso.on("exit", () => {
      this.proceso = undefined;
      this.listo = undefined;
    });
    for (let i = 0; i < 120; i++) {
      if (!this.proceso) throw new Error(`OpenClaw no arrancó (revisa ${path.join(this.dir, "gateway.log")})`);
      try {
        const r = await fetch(`http://127.0.0.1:${this.puerto}/v1/models`, { headers: { authorization: `Bearer ${this.token}` } });
        await r.arrayBuffer();
        if (r.ok) return;
      } catch {
        // todavía arrancando
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("OpenClaw no respondió a tiempo");
  }

  // Servidor del plugin: solo 127.0.0.1 y con token.
  private servirPuente(): Promise<string> {
    const servidor = http.createServer(async (req, res) => {
      const responder = (codigo: number, cuerpo: unknown) => {
        res.writeHead(codigo, { "content-type": "application/json" });
        res.end(JSON.stringify(cuerpo));
      };
      if (req.method !== "POST" || req.headers.authorization !== `Bearer ${this.tokenPuente}`) return responder(403, {});
      let texto = "";
      for await (const trozo of req) texto += trozo;
      try {
        const d = JSON.parse(texto) as { agente: string; herramienta: string; parametros?: Record<string, unknown>; resultado?: unknown; error?: unknown };
        const parametros = d.parametros ?? {};
        if (req.url === "/antes") {
          if (NUNCA_OC.includes(d.herramienta)) return responder(200, { bloquear: true, motivo: `${d.herramienta} no está permitida en Discalaves` });
          // Mismo freno que el bucle propio: a la 3.ª llamada idéntica no se ejecuta; a la 5.ª se corta la tarea.
          const firma = `${d.agente} ${d.herramienta} ${JSON.stringify(parametros)}`;
          const n = (this.repetidas.get(firma) ?? 0) + 1;
          this.repetidas.set(firma, n);
          if (n >= 5) this.parar?.();
          if (n >= 3) return responder(200, { bloquear: true, motivo: `ya hiciste exactamente esto ${n - 1} veces; no lo repito. Prueba otro camino o termina con lo que tienes.` });
          // El navegador siempre es el del propio empleado: nunca el del usuario ni el de otro empleado.
          if (d.herramienta === "browser") parametros.profile = `discalaves-${d.agente}`;
          const r = await this.puente.antes(d.agente, d.herramienta, parametros);
          return responder(200, r.bloquear || r.parametros ? r : { ...r, parametros: d.herramienta === "browser" ? parametros : undefined });
        }
        if (req.url === "/despues") {
          this.puente.despues(d.agente, d.herramienta, parametros, d.resultado, d.error);
          return responder(200, {});
        }
        responder(404, {});
      } catch (e) {
        responder(200, { bloquear: true, motivo: `error de la app: ${(e as Error).message}` });
      }
    });
    return new Promise((resolver) => servidor.listen(0, "127.0.0.1", () => resolver(`http://127.0.0.1:${(servidor.address() as net.AddressInfo).port}`)));
  }

  // Un mensaje a un empleado: su sesión es la de esa conversación. Devuelve el texto final; los trozos
  // llegan mientras escribe. Cortar la señal cierra la petición (Detener).
  async enviar(agente: string, texto: string, alTrozo: (t: string) => void, senal: AbortSignal): Promise<string> {
    await this.iniciar();
    this.repetidas.clear();
    const corte = new AbortController();
    this.parar = () => corte.abort(new Error(`me detuve: intenté 5 veces lo mismo sin avanzar. ¿Me das otra pista?`));
    const r = await fetch(`http://127.0.0.1:${this.puerto}/v1/chat/completions`, {
      method: "POST",
      signal: AbortSignal.any([senal, corte.signal]),
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify({ model: `openclaw/${agente}`, user: `discalaves-${agente}`, stream: true, messages: [{ role: "user", content: texto }] }),
    });
    if (!r.ok) throw new Error(`OpenClaw respondió ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const lector = r.body!.pipeThrough(new TextDecoderStream()).getReader();
    let resto = "", final = "";
    for (;;) {
      const { value, done } = await lector.read();
      if (done) return final.trim();
      const lineas = (resto + value).split("\n");
      resto = lineas.pop()!;
      for (const l of lineas) {
        if (!l.startsWith("data: ") || l === "data: [DONE]") continue;
        const t = JSON.parse(l.slice(6)).choices?.[0]?.delta?.content;
        if (t) {
          final += t;
          alTrozo(t);
        }
      }
    }
  }

  apagar() {
    this.proceso?.kill();
  }
}
