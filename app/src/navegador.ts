// Navegador de cada IA: Chromium sin ventana dentro de su propia caja bubblewrap (la misma que su terminal),
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

let opciones: { ia: string; datos: string } | undefined;

export function configurarNavegador(o: { ia: string; datos: string }) {
  opciones = o;
}

function ejecutableChromium(dir: string): string {
  const version = fs.readdirSync(dir).find((d) => d.startsWith("chromium_headless_shell-"));
  if (!version) throw new Error(`no encuentro Chromium en ${dir}`);
  return path.join(dir, version, "chrome-headless-shell-linux64", "chrome-headless-shell");
}

// Playwright lanza este script en lugar de Chromium: así el navegador arranca dentro de la caja.
function escribirEnvoltorio(carpeta: string, usuario: string): string {
  const { ia, datos } = opciones!;
  const dirNavegador = path.join(ia, "navegador");
  const comillas = (a: string) => `'${a.replace(/'/g, `'\\''`)}'`;
  const args = caja(carpeta, [ejecutableChromium(dirNavegador)], [
    "--bind", carpeta, carpeta, // el perfil del navegador vive en su carpeta, con la misma ruta que ve Playwright
    "--ro-bind", dirNavegador, dirNavegador,
  ], usuario);
  const archivo = path.join(datos, `navegador-en-caja-${usuario}.sh`);
  fs.writeFileSync(archivo, `#!/bin/sh\nexec bwrap ${args.map(comillas).join(" ")} "$@"\n`, { mode: 0o700 });
  return archivo;
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

export type Entrada =
  | { tipo: "clic"; x: number; y: number }
  | { tipo: "rueda"; dy: number }
  | { tipo: "tecla"; tecla: string };

// Un navegador por IA: perfil, pestañas y pantalla propios, en su carpeta (su /home).
export class Navegador {
  private contexto: Promise<BrowserContext> | undefined;
  private pagina: Page | undefined;
  private transmision: { cdp: CDPSession; enviar: (f: Fotograma) => void } | undefined;
  controlUsuario = false;

  constructor(readonly carpeta: string, readonly usuario: string) {}

  private async abrirContexto(): Promise<BrowserContext> {
    const ctx = await chromium.launchPersistentContext(path.join(this.carpeta, ".navegador"), {
      executablePath: escribirEnvoltorio(this.carpeta, this.usuario),
      headless: true,
      viewport: { width: ANCHO, height: ALTO },
      userAgent: AGENTE,
      locale: "es-ES",
    });
    this.pagina = ctx.pages()[0] ?? (await ctx.newPage());
    // Si una página abre otra pestaña, la IA (y la transmisión) pasan a la nueva.
    ctx.on("page", (p) => {
      this.pagina = p;
      if (this.transmision) void this.transmitir(this.transmision.enviar);
    });
    ctx.on("close", () => {
      this.contexto = undefined;
      this.pagina = undefined;
    });
    return ctx;
  }

  private async paginaActual(): Promise<Page> {
    this.contexto ??= this.abrirContexto().catch((e) => {
      this.contexto = undefined;
      throw e;
    });
    await this.contexto;
    return this.pagina!;
  }

  async cerrar() {
    await (await this.contexto)?.close().catch(() => {});
  }

  async buscarWeb(consulta: string): Promise<string> {
    const p = await this.paginaActual();
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

  async abrirPagina(url: string): Promise<string> {
    const p = await this.paginaActual();
    await p.goto(/^https?:\/\//.test(url) ? url : `https://${url}`, { timeout: 30000, waitUntil: "domcontentloaded" });
    return resumen(p, await textoPrincipal(p));
  }

  async verPagina(): Promise<string> {
    const p = await this.paginaActual();
    return resumen(p, await estructura(p));
  }

  async hacerClic(texto: string): Promise<string> {
    const p = await this.paginaActual();
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
      return `hice clic en "${texto}".\n` + (await resumen(await this.paginaActual(), await estructura(await this.paginaActual())));
    }
    return `no encontré ningún enlace, botón o texto "${texto}" en la página. Usa ver_pagina para ver qué hay.`;
  }

  async escribirEn(campo: string, texto: string, enviar: boolean): Promise<string> {
    const p = await this.paginaActual();
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
      return `escribí en "${campo}"${enviar ? " y lo envié" : ""}.\n` + (await resumen(await this.paginaActual(), await estructura(await this.paginaActual())));
    }
    return `no encontré el campo "${campo}". Usa ver_pagina para ver los campos disponibles.`;
  }

  // ---- Vista en vivo y control del usuario ----

  async transmitir(enviar: (f: Fotograma) => void) {
    await this.detenerTransmision();
    const p = await this.paginaActual();
    const cdp = await p.context().newCDPSession(p);
    this.transmision = { cdp, enviar };
    cdp.on("Page.screencastFrame", (f) => {
      void cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
      enviar({ datos: f.data, ancho: f.metadata.deviceWidth, alto: f.metadata.deviceHeight, url: p.url() });
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 70, maxWidth: ANCHO, maxHeight: ALTO });
  }

  async detenerTransmision() {
    const t = this.transmision;
    this.transmision = undefined;
    this.controlUsuario = false;
    await t?.cdp.send("Page.stopScreencast").catch(() => {});
    await t?.cdp.detach().catch(() => {});
  }

  tomarControl(activo: boolean) {
    this.controlUsuario = activo && !!this.transmision;
  }

  // Entradas del usuario cuando tomó el control. Coordenadas ya en píxeles de la página.
  async entradaUsuario(e: Entrada) {
    if (!this.controlUsuario || !this.pagina) return;
    const p = this.pagina;
    if (e.tipo === "clic") await p.mouse.click(e.x, e.y);
    else if (e.tipo === "rueda") await p.mouse.wheel(0, e.dy);
    else await p.keyboard.press(e.tecla).catch(() => {}); // una tecla desconocida no debe romper nada
  }

  async urlActual(): Promise<string> {
    return this.pagina?.url() ?? "(sin página abierta)";
  }
}

const navegadores = new Map<string, Navegador>();

// Se crea al primer uso: un Chromium ocupa RAM y solo arranca cuando la IA lo necesita.
export function navegadorDe(carpeta: string, usuario: string): Navegador {
  let n = navegadores.get(usuario);
  if (!n) navegadores.set(usuario, (n = new Navegador(carpeta, usuario)));
  return n;
}

export async function cerrarNavegadores() {
  await Promise.all([...navegadores.values()].map((n) => n.cerrar()));
}
