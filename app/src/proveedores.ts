// Orígenes de modelo fuera de este equipo (decisión del usuario, 2026-09-29): APIs con clave (OpenAI, Gemini,
// Claude, cualquier compatible con OpenAI) y servidores remotos del usuario (URL directa o túnel SSH, ver
// tunel.ts). Dos adaptadores devuelven lo mismo al resto de la app: texto en streaming, llamadas a
// herramientas y uso de tokens. qwen y Ollama usan el mismo adaptador compatible con OpenAI.
// Sin Electron: se prueba con node (prueba-nube.ts).

export type Tipo = "openai" | "gemini" | "claude" | "compatible" | "remoto" | "tunel" | "codex";
export interface Proveedor {
  id: string; // corto, sin ":" (va en el campo modelo del perfil: "nube:<id>:<modelo>")
  nombre: string;
  tipo: Tipo;
  url?: string; // compatible y remoto; en túnel, la dirección del servidor vista desde el host SSH (host:puerto)
  clave?: string; // solo vive en la bóveda cifrada (boveda.ts)
  ssh?: string; // túnel: alias o usuario@host de la configuración SSH del usuario (con su ProxyJump)
}
export interface Llamada { id: string; nombre: string; argumentos: string }
export interface Uso { entrada: number; salida: number; estimado?: boolean }
export interface Turno { texto: string; llamadas: Llamada[]; uso: Uso }
export interface ModeloNube { modelo: string; herramientas: boolean }
type MensajeOA = { role: string; content: string; [otros: string]: unknown };

export const URL_POR_DEFECTO: Partial<Record<Tipo, string>> = {
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai", // su endpoint compatible con OpenAI
  claude: "https://api.anthropic.com/v1",
};
export const esRemoto = (t: Tipo) => t === "remoto" || t === "tunel"; // servidor del usuario; el resto es "nube"

// El proveedor cortó (sin saldo, cuota, límite del plan, clave inválida): la tarea se detiene y avisa, sin reintentar.
export class Corte extends Error {}

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
}

// ---- Adaptador compatible con OpenAI (/chat/completions en streaming) ----
// llama-server responde 500 ("Failed to parse tool call arguments as JSON") si el modelo escribe una llamada a
// herramienta con el JSON roto, por ejemplo cortado a mitad de una URL. Los modelos pequeños lo hacen de vez en
// cuando; como cada intento muestrea distinto, se repite el turno antes de rendirse.
export async function turnoOpenAI(p: Pedido): Promise<Turno> {
  for (let intento = 1; ; intento++) {
    try {
      return await unTurnoOpenAI(p);
    } catch (e) {
      if (p.senal.aborted || !/Failed to parse tool call/i.test((e as Error).message)) throw e;
      if (intento >= 3) throw new Error("el modelo no logró escribir bien una llamada a herramienta en 3 intentos; vuelve a pedírselo o dale un paso más pequeño");
    }
  }
}

async function unTurnoOpenAI(p: Pedido): Promise<Turno> {
  const cuerpo = {
    model: p.modelo,
    stream: true,
    stream_options: { include_usage: true },
    ...(p.herramientas.length && { tools: p.herramientas }),
    messages: [{ role: "system", content: p.sistema }, ...p.mensajes],
  };
  const r = await fetch(`${p.url}/chat/completions`, {
    method: "POST",
    signal: p.senal,
    headers: { ...(p.clave && { authorization: `Bearer ${p.clave}` }), "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  if (!r.ok) throw errorHttp(r.status, await r.text(), p.clave);
  let texto = "";
  let uso: Uso | undefined;
  const llamadas: Llamada[] = [];
  for await (const e of eventos(r)) {
    if (e.error) throw errorHttp(Number(e.error.code) || 500, JSON.stringify(e), p.clave);
    if (e.usage) uso = { entrada: e.usage.prompt_tokens ?? 0, salida: e.usage.completion_tokens ?? 0 };
    const d = e.choices?.[0]?.delta;
    if (!d) continue;
    if (d.content) {
      texto += d.content;
      p.alTexto(d.content);
    }
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
  return { texto: texto.trim(), llamadas: limpiar(llamadas), uso: uso ?? estimar(cuerpo.messages, texto) };
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
  const { data } = (await r.json()) as { data?: { id: string; supported_parameters?: string[] }[] };
  return (data ?? [])
    .map((m) => ({ modelo: m.id.replace(/^models\//, ""), herramientas: claude || (m.supported_parameters ? m.supported_parameters.includes("tools") : true), conversa: !NO_CONVERSA.test(m.id) }))
    .filter((m) => m.conversa)
    .map(({ conversa: _, ...m }) => m)
    .sort((a, b) => a.modelo.localeCompare(b.modelo));
}
