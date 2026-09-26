// Navegador de qwen: Chromium sin ventana dentro de la misma caja bubblewrap que la terminal,
// controlado por la estructura de la página (árbol de accesibilidad) con playwright-core, no por
// píxeles. La pantalla se transmite a la interfaz solo mientras el usuario la está mirando.
import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type CDPSession, type Page } from "playwright-core";
import { caja } from "./caja";

const MAX_TEXTO = 2500;
const ANCHO = 1280;
const ALTO = 800;
// ponytail: agente de usuario fijo; los buscadores bloquean el de Chromium sin ventana ("HeadlessChrome").
const AGENTE = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export interface Fotograma { datos: string; ancho: number; alto: number; url: string }

let opciones: { ia: string; carpeta: string; datos: string } | undefined;
let contexto: Promise<BrowserContext> | undefined;
let pagina: Page | undefined;
let transmision: { cdp: CDPSession; enviar: (f: Fotograma) => void } | undefined;
export let controlUsuario = false;

export function configurarNavegador(o: { ia: string; carpeta: string; datos: string }) {
  opciones = o;
}

function ejecutableChromium(dir: string): string {
  const version = fs.readdirSync(dir).find((d) => d.startsWith("chromium_headless_shell-"));
  if (!version) throw new Error(`no encuentro Chromium en ${dir}`);
  return path.join(dir, version, "chrome-headless-shell-linux64", "chrome-headless-shell");
}

// Playwright lanza este script en lugar de Chromium: así el navegador arranca dentro de la caja.
function escribirEnvoltorio(): string {
  const { ia, carpeta, datos } = opciones!;
  const dirNavegador = path.join(ia, "navegador");
  const comillas = (a: string) => `'${a.replace(/'/g, `'\\''`)}'`;
  const args = caja(carpeta, [ejecutableChromium(dirNavegador)], [
    "--bind", carpeta, carpeta, // el perfil del navegador vive en su carpeta, con la misma ruta que ve Playwright
    "--ro-bind", dirNavegador, dirNavegador,
  ]);
  const archivo = path.join(datos, "navegador-en-caja.sh");
  fs.writeFileSync(archivo, `#!/bin/sh\nexec bwrap ${args.map(comillas).join(" ")} "$@"\n`, { mode: 0o700 });
  return archivo;
}

async function abrirContexto(): Promise<BrowserContext> {
  const ctx = await chromium.launchPersistentContext(path.join(opciones!.carpeta, ".navegador"), {
    executablePath: escribirEnvoltorio(),
    headless: true,
    viewport: { width: ANCHO, height: ALTO },
    userAgent: AGENTE,
    locale: "es-ES",
  });
  pagina = ctx.pages()[0] ?? (await ctx.newPage());
  // Si una página abre otra pestaña, qwen (y la transmisión) pasan a la nueva.
  ctx.on("page", (p) => {
    pagina = p;
    if (transmision) void transmitir(transmision.enviar);
  });
  ctx.on("close", () => {
    contexto = undefined;
    pagina = undefined;
  });
  return ctx;
}

async function paginaActual(): Promise<Page> {
  contexto ??= abrirContexto().catch((e) => {
    contexto = undefined;
    throw e;
  });
  await contexto;
  return pagina!;
}

export async function cerrarNavegador() {
  await (await contexto)?.close().catch(() => {});
}

// ---- Herramientas para el modelo ----

const recortar = (t: string) => (t.length > MAX_TEXTO ? t.slice(0, MAX_TEXTO) + "\n[… recortado …]" : t);

async function resumen(p: Page, cuerpo: string): Promise<string> {
  return `título: ${await p.title()}\nurl: ${p.url()}\n\n${recortar(cuerpo)}`;
}

async function textoPrincipal(p: Page): Promise<string> {
  const principal = p.locator("main, article, [role=main]").first();
  const origen = (await principal.count()) ? principal : p.locator("body");
  return (await origen.innerText({ timeout: 5000 })).replace(/\n{3,}/g, "\n\n").trim();
}

async function estructura(p: Page): Promise<string> {
  const arbol = await p.locator("body").ariaSnapshot({ timeout: 5000 });
  return arbol.split("\n").filter((l) => !l.trim().startsWith("- /url:")).join("\n");
}

async function esperarCarga(p: Page) {
  await p.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
}

// Bing envuelve cada enlace en una redirección con la URL real en base64 ("u=a1…"): se desenvuelve para ahorrar tokens.
function desenvolverBing(url: string): string {
  const u = new URL(url).searchParams.get("u");
  if (!u?.startsWith("a1")) return url;
  try {
    return Buffer.from(u.slice(2), "base64url").toString("utf8");
  } catch {
    return url;
  }
}

export async function buscarWeb(consulta: string): Promise<string> {
  const p = await paginaActual();
  await p.goto(`https://www.bing.com/search?q=${encodeURIComponent(consulta)}&setlang=es`, { timeout: 30000 });
  const resultados = await p.$$eval("li.b_algo", (els) =>
    els.slice(0, 6).map((e) => ({
      titulo: e.querySelector("h2")?.textContent?.trim() ?? "",
      url: (e.querySelector("h2 a") as HTMLAnchorElement | null)?.href ?? "",
      fragmento: e.querySelector(".b_caption p, p")?.textContent?.trim().slice(0, 200) ?? "",
    })),
  );
  if (!resultados.length) return `sin resultados para "${consulta}" (el buscador pudo bloquear la búsqueda)`;
  return resultados.map((r, i) => `${i + 1}. ${r.titulo}\n   ${desenvolverBing(r.url)}\n   ${r.fragmento}`).join("\n");
}

export async function abrirPagina(url: string): Promise<string> {
  const p = await paginaActual();
  await p.goto(/^https?:\/\//.test(url) ? url : `https://${url}`, { timeout: 30000, waitUntil: "domcontentloaded" });
  return resumen(p, await textoPrincipal(p));
}

export async function verPagina(): Promise<string> {
  const p = await paginaActual();
  return resumen(p, await estructura(p));
}

export async function hacerClic(texto: string): Promise<string> {
  const p = await paginaActual();
  const candidatos = [
    p.getByRole("link", { name: texto }),
    p.getByRole("button", { name: texto }),
    p.getByRole("tab", { name: texto }),
    p.getByRole("menuitem", { name: texto }),
    p.getByText(texto),
  ];
  for (const c of candidatos) {
    if (!(await c.count())) continue;
    await c.first().click({ timeout: 8000 });
    await esperarCarga(p);
    return `hice clic en "${texto}".\n` + (await resumen(await paginaActual(), await estructura(await paginaActual())));
  }
  return `no encontré ningún enlace, botón o texto "${texto}" en la página. Usa ver_pagina para ver qué hay.`;
}

export async function escribirEn(campo: string, texto: string, enviar: boolean): Promise<string> {
  const p = await paginaActual();
  const candidatos = [
    p.getByRole("textbox", { name: campo }),
    p.getByRole("searchbox", { name: campo }),
    p.getByRole("combobox", { name: campo }),
    p.getByPlaceholder(campo),
    p.getByLabel(campo),
  ];
  for (const c of candidatos) {
    if (!(await c.count())) continue;
    await c.first().fill(texto, { timeout: 8000 });
    if (enviar) {
      await c.first().press("Enter");
      await esperarCarga(p);
    }
    return `escribí en "${campo}"${enviar ? " y lo envié" : ""}.\n` + (await resumen(await paginaActual(), await estructura(await paginaActual())));
  }
  return `no encontré el campo "${campo}". Usa ver_pagina para ver los campos disponibles.`;
}

// ---- Vista en vivo y control del usuario ----

export async function transmitir(enviar: (f: Fotograma) => void) {
  await detenerTransmision();
  const p = await paginaActual();
  const cdp = await p.context().newCDPSession(p);
  transmision = { cdp, enviar };
  cdp.on("Page.screencastFrame", (f) => {
    void cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    enviar({ datos: f.data, ancho: f.metadata.deviceWidth, alto: f.metadata.deviceHeight, url: p.url() });
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 70, maxWidth: ANCHO, maxHeight: ALTO });
}

export async function detenerTransmision() {
  const t = transmision;
  transmision = undefined;
  controlUsuario = false;
  await t?.cdp.send("Page.stopScreencast").catch(() => {});
  await t?.cdp.detach().catch(() => {});
}

export function tomarControl(activo: boolean) {
  controlUsuario = activo && !!transmision;
}

export type Entrada =
  | { tipo: "clic"; x: number; y: number }
  | { tipo: "rueda"; dy: number }
  | { tipo: "tecla"; tecla: string };

// Entradas del usuario cuando tomó el control. Coordenadas ya en píxeles de la página.
export async function entradaUsuario(e: Entrada) {
  if (!controlUsuario || !pagina) return;
  const p = pagina;
  if (e.tipo === "clic") await p.mouse.click(e.x, e.y);
  else if (e.tipo === "rueda") await p.mouse.wheel(0, e.dy);
  else await p.keyboard.press(e.tecla).catch(() => {}); // una tecla desconocida no debe romper nada
}

export async function urlActual(): Promise<string> {
  return pagina?.url() ?? "(sin página abierta)";
}
