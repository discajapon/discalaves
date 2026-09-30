// ChatGPT por suscripción vía Codex (no oficial para apps de terceros: puede dejar de funcionar). Se usa el
// CLI oficial de Codex (`codex exec --json`, lo mismo que envuelve su SDK) que el usuario instala aparte
// (npm i -g @openai/codex, Apache-2.0). El usuario inicia sesión con `codex login` (flujo oficial de OpenAI);
// Discalaves nunca lee, guarda ni reenvía sus tokens: viven en el CODEX_HOME propio de la app.
//
// CRÍTICO: Codex corre en el equipo del usuario, así que TODAS sus herramientas propias (terminal, parches,
// imágenes, navegador, subagentes…) se apagan: todas las funciones activas se desactivan, la búsqueda web
// también, y un catálogo de modelos propio quita apply_patch y el buscador de herramientas. Solo quedan las
// de Discalaves, servidas por MCP desde la app, que actúan en la computadora (contenedor) del empleado.
// sonda() lo comprueba con la versión instalada antes de usarla: Codex habla con un servidor falso local y
// se mira qué herramientas le ofrece al modelo; si aparece cualquier otra, no se usa.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { Corte, type Uso } from "./proveedores";

// Herramientas de Codex que no tocan el equipo: leer recursos de NUESTRO servidor MCP y preguntar al usuario.
const INOFENSIVAS = ["list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource", "request_user_input"];
const MCP = "discalaves";

export const binario = () => process.env.DISCALAVES_CODEX || "codex";

function correr(args: string[], home: string, entrada?: string, senal?: AbortSignal, extra: Record<string, string> = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: home, ...extra };
  delete env.OPENAI_API_KEY; // la suscripción, no una clave que el usuario tenga en su entorno
  delete env.CODEX_API_KEY;
  fs.mkdirSync(home, { recursive: true });
  const p = spawn(binario(), args, { env, stdio: ["pipe", "pipe", "pipe"], signal: senal, windowsHide: true });
  p.stdin.end(entrada ?? "");
  return p;
}

function salidaDe(args: string[], home: string): Promise<{ codigo: number; salida: string }> {
  return new Promise((resolver) => {
    let salida = "";
    const p = correr(args, home);
    p.stdout.on("data", (d) => (salida += d));
    p.stderr.on("data", (d) => (salida += d));
    p.on("error", () => resolver({ codigo: -1, salida: "no encuentro el programa codex" }));
    p.on("close", (codigo) => resolver({ codigo: codigo ?? -1, salida }));
  });
}

export class Codex {
  private revisada?: Promise<string | null>; // resultado de la sonda (null = segura)
  constructor(readonly home: string) {}

  async instalado(): Promise<boolean> {
    return (await salidaDe(["--version"], this.home)).codigo === 0;
  }
  // Sesión iniciada con la cuenta de ChatGPT (no con una clave de API).
  async conSesion(): Promise<boolean> {
    const r = await salidaDe(["login", "status"], this.home);
    return r.codigo === 0 && /chatgpt/i.test(r.salida);
  }
  // Flujo oficial: Codex abre el navegador y guarda la sesión en su CODEX_HOME.
  iniciarSesion(): Promise<boolean> {
    return salidaDe(["login"], this.home).then((r) => r.codigo === 0);
  }

  async modelos(): Promise<{ modelo: string; herramientas: boolean }[]> {
    const r = await salidaDe(["debug", "models"], this.home);
    try {
      return (JSON.parse(r.salida.slice(r.salida.indexOf("{"))).models as { slug: string; visibility?: string }[])
        .filter((m) => m.visibility !== "hide")
        .map((m) => ({ modelo: m.slug, herramientas: true }));
    } catch {
      return [];
    }
  }

  // Argumentos comunes (sesión real y sonda): todas las funciones apagadas, sin configuración del usuario.
  private async argumentos(modelo: string, mcpUrl: string, instrucciones: string): Promise<string[]> {
    const funciones = (await salidaDe(["features", "list"], this.home)).salida
      .split("\n")
      .map((l) => l.trim().split(/\s+/))
      .filter((c) => c.length >= 3 && c.at(-1) === "true")
      .map((c) => c[0]);
    const catalogo = path.join(this.home, "catalogo.json");
    const r = await salidaDe(["debug", "models"], this.home);
    const lista = JSON.parse(r.salida.slice(r.salida.indexOf("{")));
    for (const m of lista.models) Object.assign(m, { apply_patch_tool_type: null, supports_search_tool: false });
    fs.writeFileSync(catalogo, JSON.stringify(lista));
    const c = (k: string, v: string) => ["-c", `${k}=${JSON.stringify(v)}`];
    return [
      "exec", "--json", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules",
      "-C", this.vacia(), "-s", "read-only",
      ...funciones.flatMap((f) => ["--disable", f]),
      ...c("web_search", "disabled"),
      ...c("approval_policy", "never"),
      ...c("model_catalog_json", catalogo),
      ...c("developer_instructions", instrucciones),
      ...c(`mcp_servers.${MCP}.url`, mcpUrl),
      ...c(`mcp_servers.${MCP}.bearer_token_env_var`, "DISCALAVES_MCP"),
      // Codex no pide aprobación: la pide Discalaves en cada herramienta, igual que con su propio bucle.
      ...c(`mcp_servers.${MCP}.default_tools_approval_mode`, "approve"),
      "-m", modelo, "-",
    ];
  }
  private vacia() {
    const d = path.join(this.home, "vacia"); // su "directorio de trabajo": vacío y de solo lectura para él
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  // ¿Qué herramientas le ofrece Codex al modelo con esta configuración? Contra un servidor falso local.
  async herramientasOfrecidas(nuestras: Herramienta[]): Promise<string[]> {
    const vistas: string[] = [];
    const falso = await servir((req, cuerpo, res) => {
      if (!req.url?.endsWith("/responses")) return void res.writeHead(404).end("{}");
      for (const t of JSON.parse(cuerpo).tools ?? []) {
        if (t.type === "namespace") for (const h of t.tools ?? []) vistas.push(`${t.name}/${h.name}`);
        else vistas.push(t.name ?? t.type);
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const ev = (type: string, o: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...o })}\n\n`);
      ev("response.created", { response: { id: "sonda" } });
      ev("response.output_item.done", { item: { type: "message", role: "assistant", id: "m", content: [{ type: "output_text", text: "ok" }] } });
      ev("response.completed", { response: { id: "sonda", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } });
      res.end();
    });
    const mcp = await servidorMcp(nuestras, async () => ({ salida: "", codigo: 0 }));
    try {
      const modelo = (await this.modelos())[0]?.modelo ?? "gpt-5.5";
      const args = await this.argumentos(modelo, mcp.url, "sonda");
      args.splice(args.indexOf("-m"), 0,
        "-c", 'model_provider="sonda"',
        "-c", `model_providers.sonda={name="sonda",base_url="${falso.url}/v1",wire_api="responses",env_key="SONDA"}`);
      await new Promise<void>((resolver) => {
        const p = correr(args, this.home, "sonda", undefined, { SONDA: "x", DISCALAVES_MCP: mcp.token });
        p.stdout.resume();
        p.stderr.resume();
        p.on("error", () => resolver());
        p.on("close", () => resolver());
      });
    } finally {
      falso.cerrar();
      mcp.cerrar();
    }
    return vistas;
  }

  // null si Codex solo ofrece las herramientas de Discalaves (y las inofensivas); si no, el motivo.
  sonda(nuestras: Herramienta[]): Promise<string | null> {
    return (this.revisada ??= this.herramientasOfrecidas(nuestras).then((vistas) => {
      if (!vistas.length) return "no pude comprobar las herramientas de Codex (¿está instalado?)";
      const ajenas = vistas.filter((v) => !INOFENSIVAS.includes(v) && !v.startsWith(`mcp__${MCP}/`));
      return ajenas.length ? `esta versión de Codex ofrece herramientas propias que actuarían en tu equipo (${ajenas.join(", ")}); no la uso` : null;
    }));
  }

  // Una tarea completa con el bucle de Codex. Las herramientas llegan a llamar(); el texto, a alTexto().
  async ejecutar(o: { modelo: string; instrucciones: string; prompt: string; herramientas: Herramienta[]; llamar: Llamar; alTexto: (t: string) => void; senal: AbortSignal }): Promise<{ texto: string; uso: Uso }> {
    const motivo = await this.sonda(o.herramientas);
    if (motivo) throw new Error(motivo);
    const mcp = await servidorMcp(o.herramientas, o.llamar);
    try {
      const args = await this.argumentos(o.modelo, mcp.url, o.instrucciones);
      return await new Promise((resolver, rechazar) => {
        const p = correr(args, this.home, o.prompt, o.senal, { DISCALAVES_MCP: mcp.token });
        let resto = "", texto = "", error = "", errores = "";
        const uso: Uso = { entrada: 0, salida: 0 };
        p.stderr.on("data", (d) => (errores = (errores + d).slice(-2000)));
        p.stdout.on("data", (d) => {
          const lineas = (resto + d).split("\n");
          resto = lineas.pop()!;
          for (const l of lineas) {
            let e: Record<string, any>;
            try {
              e = JSON.parse(l);
            } catch {
              continue;
            }
            const item = e.item ?? {};
            if (e.type === "item.completed" && item.type === "agent_message") {
              texto += (texto ? "\n\n" : "") + item.text;
              o.alTexto((texto === item.text ? "" : "\n\n") + item.text);
            } else if (e.type?.startsWith("item.") && ["command_execution", "file_change", "web_search"].includes(item.type)) {
              // defensa extra: no debería pasar nunca con las funciones apagadas
              error = `Codex intentó usar una herramienta propia (${item.type}); lo detuve`;
              p.kill();
            } else if (e.type === "turn.completed" && e.usage) {
              uso.entrada += e.usage.input_tokens ?? 0;
              uso.salida += e.usage.output_tokens ?? 0;
            } else if (e.type === "turn.failed" || e.type === "error") error = e.error?.message ?? e.message ?? "error de Codex";
          }
        });
        p.on("error", (e) => rechazar(o.senal.aborted ? e : new Error(`no pude ejecutar codex: ${e.message}`)));
        p.on("close", (codigo) => {
          if (o.senal.aborted) return rechazar(new Error("detenida"));
          if (error || codigo !== 0) {
            const m = error || errores.trim().split("\n").at(-1) || `codex terminó con código ${codigo}`;
            // límite del plan, sin sesión, cuota: se detiene y avisa, sin reintentar
            return rechazar(/limit|quota|usage|login|auth|401|403|429/i.test(m) ? new Corte(`ChatGPT cortó: ${m}`) : new Error(m));
          }
          resolver({ texto: texto.trim(), uso });
        });
      });
    } finally {
      mcp.cerrar();
    }
  }
}

// ---- Servidor MCP (HTTP, JSON-RPC) con las herramientas de Discalaves, solo en 127.0.0.1 y con token ----
export interface Herramienta { type: string; function: { name: string; description: string; parameters: object } }
export type Llamar = (nombre: string, argumentos: string) => Promise<{ salida: string; codigo: number }>;

function servir(manejar: (req: http.IncomingMessage, cuerpo: string, res: http.ServerResponse) => unknown) {
  const s = http.createServer((req, res) => {
    let cuerpo = "";
    req.on("data", (d) => (cuerpo += d));
    req.on("end", () => void Promise.resolve(manejar(req, cuerpo, res)).catch(() => res.writeHead(500).end()));
  });
  return new Promise<{ url: string; cerrar: () => void }>((resolver) =>
    s.listen(0, "127.0.0.1", () => resolver({ url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, cerrar: () => (s.closeAllConnections(), s.close()) })),
  );
}

export async function servidorMcp(herramientas: Herramienta[], llamar: Llamar) {
  const token = randomBytes(24).toString("hex");
  const s = await servir(async (req, cuerpo, res) => {
    if (req.method !== "POST" || req.headers.authorization !== `Bearer ${token}`) return void res.writeHead(401).end();
    const m = JSON.parse(cuerpo);
    if (m.id === undefined) return void res.writeHead(202).end(); // notificaciones
    const responder = (o: object) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: m.id, ...o }));
    if (m.method === "initialize") return responder({ result: { protocolVersion: m.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: MCP, version: "1" } } });
    if (m.method === "tools/list") return responder({ result: { tools: herramientas.map((h) => ({ name: h.function.name, description: h.function.description, inputSchema: h.function.parameters })) } });
    if (m.method === "tools/call") {
      const r = await llamar(String(m.params?.name ?? ""), JSON.stringify(m.params?.arguments ?? {}));
      return responder({ result: { content: [{ type: "text", text: `código de salida ${r.codigo}\n${r.salida}` }], isError: r.codigo !== 0 } });
    }
    if (m.method === "ping") return responder({ result: {} });
    responder({ error: { code: -32601, message: "método desconocido" } });
  });
  return { url: `${s.url}/mcp`, token, cerrar: s.cerrar };
}
