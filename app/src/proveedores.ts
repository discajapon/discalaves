// Orígenes de modelo fuera de este equipo (decisión del usuario, 2026-09-29): APIs con clave (OpenAI, Gemini,
// Claude, cualquier compatible con OpenAI) y servidores remotos del usuario (URL directa o túnel SSH, ver
// tunel.ts). Dos adaptadores devuelven lo mismo al resto de la app: texto en streaming, llamadas a
// herramientas y uso de tokens. qwen y Ollama usan el mismo adaptador compatible con OpenAI.
// Sin Electron: se prueba con node (prueba-nube.ts, prueba-remoto.ts).
import { aTexto, cierra, Filtro, instrucciones, nuevaMarca, sacarLlamada } from "./modo-texto";

export type Tipo = "openai" | "gemini" | "claude" | "compatible" | "remoto" | "tunel" | "codex";
export interface Proveedor {
  id: string; // corto, sin ":" (va en el campo modelo del perfil: "nube:<id>:<modelo>")
  nombre: string;
  tipo: Tipo;
  url?: string; // compatible y remoto; en túnel, la dirección del servidor vista desde el host SSH (host:puerto)
  clave?: string; // solo vive en la bóveda cifrada (boveda.ts)
  ssh?: string; // túnel: alias o usuario@host de la configuración SSH del usuario (con su ProxyJump)
  // Solo servidor remoto (decisión del usuario, 2026-10-02): lo que la app detectó o el usuario eligió.
  modelo?: string; // el modelo por defecto de los empleados que lo usan
  contexto?: number; // ventana en tokens, si el servidor no la dice
  modos?: Record<string, ModoHerramientas>; // por modelo, según la sonda
  aceptado?: boolean; // aceptó el aviso de privacidad
  predeterminado?: boolean; // los empleados nuevos nacen con este servidor
}
export type ModoHerramientas = "nativas" | "texto";
export interface Llamada { id: string; nombre: string; argumentos: string }
export interface Uso { entrada: number; salida: number; estimado?: boolean }
export interface Turno { texto: string; llamadas: Llamada[]; uso: Uso }
export interface ModeloNube { modelo: string; herramientas: boolean; contexto?: number }
type MensajeOA = { role: string; content: string; [otros: string]: unknown };

export const URL_POR_DEFECTO: Partial<Record<Tipo, string>> = {
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai", // su endpoint compatible con OpenAI
  claude: "https://api.anthropic.com/v1",
};
export const esRemoto = (t: Tipo) => t === "remoto" || t === "tunel"; // servidor del usuario; el resto es "nube"

// El proveedor cortó (sin saldo, cuota, límite del plan, clave inválida): la tarea se detiene y avisa, sin reintentar.
export class Corte extends Error {}
// El servidor pidió esperar (429 con o sin Retry-After): solo con `respetar429`, se espera y se repite el turno.
export class Espera extends Error {
  constructor(readonly segundos: number, mensaje: string) {
    super(mensaje);
  }
}

// Un mensaje de error nunca lleva la clave (algunas APIs la repiten entera en el error).
export function sinClave(texto: string, clave?: string): string {
  return clave && clave.length >= 8 ? texto.split(clave).join("***") : texto;
}

function errorHttp(status: number, cuerpo: string, clave?: string): Error {
  let m = cuerpo;
  try {
    const j = JSON.parse(cuerpo);
    m = j.error?.message ?? j.message ?? (typeof j.error === "string" ? j.error : cuerpo);
  } catch {
    // no era JSON
  }
  m = sinClave(String(m), clave).slice(0, 300);
  if (status === 401 || status === 403) return new Corte(`la clave no es válida o no tiene permiso (${status}): ${m}`);
  if (status === 402 || status === 429 || /quota|credit|billing|balance|insufficient|rate.?limit|usage limit/i.test(m)) {
    return new Corte(`el proveedor cortó (${status}): ${m}`);
  }
  return new Error(`el servidor respondió ${status}: ${m}`);
}

// Líneas "data: ..." de un stream SSE (el "event:" de Claude también viene en el JSON como "type").
async function* eventos(r: Response): AsyncGenerator<Record<string, any>> {
  const lector = r.body!.pipeThrough(new TextDecoderStream()).getReader();
  let resto = "";
  for (;;) {
    const { value, done } = await lector.read();
    if (done) return;
    const lineas = (resto + value).split("\n");
    resto = lineas.pop()!;
    for (const l of lineas) {
      if (!l.startsWith("data:")) continue;
      const d = l.slice(5).trim();
      if (d && d !== "[DONE]") yield JSON.parse(d);
    }
  }
}

// ponytail: si la API no devuelve uso, se estima con ~4 caracteres por token (y se marca como estimado).
const estimar = (entrada: unknown, salida: string): Uso => ({ entrada: Math.ceil(JSON.stringify(entrada).length / 4), salida: Math.ceil(salida.length / 4), estimado: true });

export interface Pedido {
  url: string; // base, por ejemplo https://api.openai.com/v1
  clave?: string;
  modelo: string;
  sistema: string;
  mensajes: MensajeOA[]; // formato OpenAI (el de contexto() en main.ts)
  herramientas: { type: string; function: { name: string; description: string; parameters: object } }[];
  senal: AbortSignal;
  alTexto: (t: string) => void;
  modoTexto?: boolean; // sin herramientas nativas: órdenes escritas como texto (modo-texto.ts)
  respetar429?: boolean; // servidor remoto: ante un 429 espera lo que pida y repite (hasta 3 veces)
}

// ---- Adaptador compatible con OpenAI (/chat/completions en streaming) ----
// llama-server responde 500 ("Failed to parse tool call arguments as JSON") si el modelo escribe una llamada a
// herramienta con el JSON roto, por ejemplo cortado a mitad de una URL. Los modelos pequeños lo hacen de vez en
// cuando; como cada intento muestrea distinto, se repite el turno antes de rendirse.
export async function turnoOpenAI(p: Pedido): Promise<Turno> {
  let rotas = 0, esperas = 0;
  for (;;) {
    try {
      return await unTurnoOpenAI(p);
    } catch (e) {
      if (p.senal.aborted) throw e;
      if (e instanceof Espera) {
        if (++esperas > 3) throw new Corte(`el servidor sigue pidiendo esperar (${e.message}); me detuve`);
        await dormir(e.segundos, p.senal);
      } else if (!/Failed to parse tool call/i.test((e as Error).message)) throw e;
      else if (++rotas >= 3) throw new Error("el modelo no logró escribir bien una llamada a herramienta en 3 intentos; vuelve a pedírselo o dale un paso más pequeño");
    }
  }
}

const dormir = (segundos: number, senal: AbortSignal) =>
  new Promise<void>((ok, mal) => {
    const t = setTimeout(ok, segundos * 1000);
    senal.addEventListener("abort", () => (clearTimeout(t), mal(new Error("detenida"))), { once: true });
  });

async function unTurnoOpenAI(p: Pedido): Promise<Turno> {
  const marca = p.modoTexto && p.herramientas.length ? nuevaMarca() : ""; // una distinta en cada turno
  const cuerpo = {
    model: p.modelo,
    stream: true,
    stream_options: { include_usage: true },
    ...(p.herramientas.length && !marca && { tools: p.herramientas }),
    ...(marca && { stop: [cierra(marca)] }),
    messages: [{ role: "system", content: marca ? `${p.sistema}\n\n${instrucciones(marca, p.herramientas)}` : p.sistema }, ...(marca ? aTexto(p.mensajes, marca) : p.mensajes)],
  };
  const r = await fetch(`${p.url}/chat/completions`, {
    method: "POST",
    signal: p.senal,
    headers: { ...(p.clave && { authorization: `Bearer ${p.clave}` }), "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  if (!r.ok) {
    if (r.status === 429 && p.respetar429) {
      const m = sinClave((await r.text()).slice(0, 200), p.clave);
      throw new Espera(Math.min(Math.max(Number(r.headers.get("retry-after")) || 10, 1), 120), `429: ${m}`);
    }
    throw errorHttp(r.status, await r.text(), p.clave);
  }
  // El razonamiento (<think>…) y las órdenes en texto no llegan a la interfaz ni al historial.
  const filtro = new Filtro(p.alTexto, marca || undefined);
  let uso: Uso | undefined;
  const llamadas: Llamada[] = [];
  for await (const e of eventos(r)) {
    if (e.error) throw errorHttp(Number(e.error.code) || 500, JSON.stringify(e), p.clave);
    if (e.usage) uso = { entrada: e.usage.prompt_tokens ?? 0, salida: e.usage.completion_tokens ?? 0 };
    const d = e.choices?.[0]?.delta;
    if (!d) continue;
    if (d.content) filtro.poner(d.content);
    for (const tc of d.tool_calls ?? []) {
      const l = (llamadas[tc.index ?? 0] ??= { id: "", nombre: "", argumentos: "" });
      if (tc.id) l.id = tc.id;
      l.nombre += tc.function?.name ?? "";
      l.argumentos += tc.function?.arguments ?? "";
    }
  }
  // Una llamada con el JSON cortado (el contexto se llenó, o se acabaron los tokens) no se acepta: guardada en el
  // historial, el servidor la rechazaría con un 500 en todos los turnos siguientes. Se repite el turno.
  for (const l of llamadas) if (l?.argumentos.trim() && !jsonValido(l.argumentos)) throw new Error(`Failed to parse tool call arguments as JSON (cortado): ${l.argumentos.slice(-60)}`);
  filtro.fin();
  const orden = marca ? sacarLlamada(filtro.ordenes, marca) : null;
  if (orden) llamadas.push({ id: "", nombre: orden.nombre, argumentos: orden.argumentos });
  return { texto: filtro.texto, llamadas: limpiar(llamadas), uso: uso ?? estimar(cuerpo.messages, filtro.texto) };
}

export const jsonValido = (t: string) => {
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
};

const limpiar = (llamadas: Llamada[]) => llamadas.filter((l) => l?.nombre).map((l, i) => ({ ...l, id: l.id || `llamada-${Date.now()}-${i}` }));

// ---- Adaptador nativo de la API de Claude (/messages en streaming) ----

// Del formato OpenAI al de Claude: los resultados de herramientas van en un mensaje "user" con bloques
// tool_result, y los turnos deben alternar (se juntan los seguidos del mismo rol).
export function aClaude(mensajes: MensajeOA[]) {
  const salida: { role: "user" | "assistant"; content: object[] }[] = [];
  const poner = (role: "user" | "assistant", bloques: object[]) => {
    if (!bloques.length) return;
    const ultimo = salida.at(-1);
    if (ultimo?.role === role) ultimo.content.push(...bloques);
    else salida.push({ role, content: bloques });
  };
  for (const m of mensajes) {
    if (m.role === "tool") poner("user", [{ type: "tool_result", tool_use_id: m.tool_call_id, content: m.content || "(sin salida)" }]);
    else if (m.role === "assistant") {
      const llamadas = (m.tool_calls as { id: string; function: { name: string; arguments: string } }[] | undefined) ?? [];
      poner("assistant", [
        ...(m.content ? [{ type: "text", text: m.content }] : []),
        ...llamadas.map((l) => ({ type: "tool_use", id: l.id, name: l.function.name, input: argumentosObjeto(l.function.arguments) })),
      ]);
    } else poner("user", [{ type: "text", text: m.content || " " }]);
  }
  return salida;
}

function argumentosObjeto(a: string): object {
  try {
    const o = JSON.parse(a || "{}");
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

export async function turnoClaude(p: Pedido): Promise<Turno> {
  const cuerpo = {
    model: p.modelo,
    max_tokens: 8192,
    stream: true,
    system: p.sistema,
    messages: aClaude(p.mensajes),
    ...(p.herramientas.length && {
      tools: p.herramientas.map((h) => ({ name: h.function.name, description: h.function.description, input_schema: h.function.parameters })),
    }),
  };
  const r = await fetch(`${p.url}/messages`, {
    method: "POST",
    signal: p.senal,
    headers: { "x-api-key": p.clave ?? "", "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  if (!r.ok) throw errorHttp(r.status, await r.text(), p.clave);
  let texto = "";
  const uso: Uso = { entrada: 0, salida: 0 };
  const bloques: (Llamada | null)[] = [];
  for await (const e of eventos(r)) {
    if (e.type === "error") throw errorHttp(e.error?.type === "overloaded_error" ? 529 : 500, JSON.stringify(e), p.clave);
    if (e.type === "message_start") {
      const u = e.message?.usage ?? {};
      uso.entrada = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      uso.salida = u.output_tokens ?? 0;
    } else if (e.type === "message_delta" && e.usage) uso.salida = e.usage.output_tokens ?? uso.salida;
    else if (e.type === "content_block_start") {
      bloques[e.index] = e.content_block?.type === "tool_use" ? { id: e.content_block.id, nombre: e.content_block.name, argumentos: "" } : null;
    } else if (e.type === "content_block_delta") {
      if (e.delta?.type === "text_delta") {
        texto += e.delta.text;
        p.alTexto(e.delta.text);
      } else if (e.delta?.type === "input_json_delta" && bloques[e.index]) bloques[e.index]!.argumentos += e.delta.partial_json;
    }
  }
  return { texto: texto.trim(), llamadas: limpiar(bloques.filter((b): b is Llamada => !!b)), uso };
}

// ---- Lista de modelos de cada proveedor ----

// ponytail: las APIs compatibles con OpenAI no dicen si un modelo admite herramientas (salvo OpenRouter, con
// supported_parameters); se da por hecho que sí, menos los que ni siquiera conversan.
const NO_CONVERSA = /embed|tts|whisper|dall-e|image|audio|moderation|realtime|transcribe|search|rerank|computer-use/i;

export async function listarModelos(tipo: Tipo, url: string, clave?: string): Promise<ModeloNube[]> {
  const claude = tipo === "claude";
  const r = await fetch(`${url}/models${claude ? "?limit=1000" : ""}`, {
    headers: claude ? { "x-api-key": clave ?? "", "anthropic-version": "2023-06-01" } : clave ? { authorization: `Bearer ${clave}` } : {},
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw errorHttp(r.status, await r.text(), clave);
  const { data } = (await r.json()) as { data?: ModeloCrudo[] };
  return (data ?? [])
    .map((m) => ({ modelo: m.id.replace(/^models\//, ""), herramientas: claude || (m.supported_parameters ? m.supported_parameters.includes("tools") : true), conversa: !NO_CONVERSA.test(m.id), contexto: ventanaDe(m) }))
    .filter((m) => m.conversa)
    .map(({ conversa: _, ...m }) => (m.contexto ? m : { modelo: m.modelo, herramientas: m.herramientas }))
    .sort((a, b) => a.modelo.localeCompare(b.modelo));
}

// ---- Servidor remoto compatible con OpenAI: ruta base, ventana de contexto y herramientas ----

type ModeloCrudo = { id: string; supported_parameters?: string[]; [otros: string]: any };
// Cada servidor la llama distinto: vLLM max_model_len, OpenRouter context_length, LiteLLM max_input_tokens…
// ponytail: se toma lo que el servidor dice; si no dice nada, la pregunta la app al usuario.
const ventanaDe = (m: ModeloCrudo): number | undefined => {
  const v = [m.max_model_len, m.context_length, m.context_window, m.max_context_length, m.max_input_tokens, m.n_ctx, m.meta?.n_ctx_train, m.top_provider?.context_length]
    .map(Number)
    .find((n) => Number.isFinite(n) && n >= 1024);
  return v;
};

const sinBarra = (u: string) => u.trim().replace(/\/+$/, "");
const causa = (e: unknown) => ((e as Error & { cause?: { code?: string; message?: string } }).cause?.code ?? (e as Error).message);

// La base que responde: la URL tal cual o con /v1 (o sin él si ya lo traía). Se pide la lista de modelos; una
// respuesta que no es esa lista (una página web, un 404) descarta la candidata. Una clave rechazada (401/403) corta
// de inmediato con un mensaje claro: no se prueban otras cabeceras.
export async function detectarBase(url: string, clave?: string): Promise<{ base: string; modelos: ModeloNube[] }> {
  const dada = sinBarra(url);
  const candidatas = [dada, /\/v1$/.test(dada) ? dada.replace(/\/v1$/, "") : `${dada}/v1`].filter(Boolean);
  const fallos: string[] = [];
  for (const base of candidatas) {
    try {
      return { base, modelos: await listarModelos("remoto", base, clave) };
    } catch (e) {
      if (e instanceof Corte) throw e; // 401/403/402/429
      fallos.push(`${base} (${/Unexpected|JSON/.test((e as Error).message) ? "no devolvió una lista de modelos" : causa(e)})`);
    }
  }
  throw new Error(`no encontré una API compatible con OpenAI en ${dada}; probé ${fallos.join(" y ")}`);
}

// ¿Acepta herramientas nativas? Una llamada de prueba. Un 400/422/501 o una respuesta sin llamada = "texto"; una clave
// rechazada, un límite o un modelo inexistente no son una respuesta sobre las herramientas y se propagan.
export async function sondaHerramientas(base: string, clave: string | undefined, modelo: string): Promise<ModoHerramientas> {
  const r = await fetch(`${base}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: { ...(clave && { authorization: `Bearer ${clave}` }), "content-type": "application/json" },
    body: JSON.stringify({
      model: modelo,
      stream: false,
      max_tokens: 512,
      messages: [{ role: "user", content: 'Usa la herramienta eco con el texto "ok". No respondas con texto.' }],
      tools: [{ type: "function", function: { name: "eco", description: "Devuelve el texto recibido", parameters: { type: "object", properties: { texto: { type: "string" } }, required: ["texto"] } } }],
    }),
  });
  if (r.status === 400 || r.status === 422 || r.status === 501) return "texto";
  if (!r.ok) throw errorHttp(r.status, await r.text(), clave);
  const j = (await r.json()) as { choices?: { message?: { tool_calls?: { function?: { name?: string } }[] } }[] };
  return j.choices?.[0]?.message?.tool_calls?.[0]?.function?.name === "eco" ? "nativas" : "texto";
}
