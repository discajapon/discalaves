// Navegador de cada IA: el Chromium con ventana de su escritorio (en su contenedor, ver computadora.ts),
// controlado por CDP con playwright-core a través de la estructura de la página (árbol de
// accesibilidad), no por píxeles. El usuario lo ve moverse en la pantalla en vivo.
import { chromium, type BrowserContext, type Page } from "playwright-core";
import type { Computadora } from "./computadora";

const MAX_TEXTO = 2500;

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

// Los buscadores envuelven cada enlace en una redirección con la URL real dentro: DuckDuckGo en "uddg=",
// Yahoo en "/RU=<url>/RK=". Se desenvuelve para dar la dirección real y ahorrar tokens.
function desenvolver(url: string): string {
  try {
    const u = new URL(url, "https://duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    if (uddg) return uddg;
    const ru = u.pathname.match(/\/RU=([^/]+)\//);
    if (ru) return decodeURIComponent(ru[1]);
    return u.href;
  } catch {
    return url;
  }
}

// Buscadores, en orden. Bing quedó fuera: al navegador automatizado le sirve resultados de relleno sin
// relación con la consulta (probado 2026-09-28). DuckDuckGo HTML y Yahoo responden bien.
const BUSCADORES = [
  { url: (q: string) => `https://html.duckduckgo.com/html/?q=${q}&kl=es-es`, resultado: ".result:not(.result--ad)", titulo: ".result__a", fragmento: ".result__snippet" },
  { url: (q: string) => `https://search.yahoo.com/search?p=${q}`, resultado: "#web li .algo, #web ol > li", titulo: "h3 a, a h3", fragmento: ".compText p, p" },
];

// Un navegador por IA: el de su propio escritorio, con perfil en su carpeta (su /home).
export class Navegador {
  private contexto: Promise<BrowserContext> | undefined;
  private pagina: Page | undefined;

  constructor(readonly computadora: Computadora) {}

  private async abrirContexto(): Promise<BrowserContext> {
    const navegador = await chromium.connectOverCDP(await this.computadora.cdp());
    // Si el usuario cierra la ventana (o el contenedor se apaga), se vuelve a abrir en el próximo uso.
    navegador.on("disconnected", () => {
      this.contexto = undefined;
      this.pagina = undefined;
      this.computadora.navegadorCerrado();
    });
    const ctx = navegador.contexts()[0];
    this.pagina = ctx.pages()[0] ?? (await ctx.newPage());
    ctx.on("page", (p) => (this.pagina = p)); // si una página abre otra pestaña, la IA pasa a la nueva
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
    await (await this.contexto)?.browser()?.close().catch(() => {});
  }

  async buscarWeb(consulta: string): Promise<string> {
    const p = await this.paginaActual();
    for (const b of BUSCADORES) {
      await p.goto(b.url(encodeURIComponent(consulta)), { timeout: 30000, waitUntil: "domcontentloaded" }).catch(() => {});
      const resultados = await p
        .$$eval(b.resultado, (els, sel) => els.slice(0, 6).map((e) => {
          const t = e.querySelector(sel.titulo);
          const a = (t?.closest("a") ?? t?.querySelector("a") ?? t) as HTMLAnchorElement | null;
          return { titulo: t?.textContent?.trim() ?? "", url: a?.href ?? "", fragmento: e.querySelector(sel.fragmento)?.textContent?.trim().slice(0, 200) ?? "" };
        }), { titulo: b.titulo, fragmento: b.fragmento })
        .catch(() => []);
      const buenos = resultados.filter((r) => r.titulo && r.url);
      if (buenos.length) return buenos.map((r, i) => `${i + 1}. ${r.titulo}\n   ${desenvolver(r.url)}\n   ${r.fragmento}`).join("\n");
    }
    return `sin resultados para "${consulta}" (los buscadores no respondieron o bloquearon la búsqueda)`;
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

  async urlActual(): Promise<string> {
    return this.pagina?.url() ?? "(sin página abierta)";
  }
}

const navegadores = new Map<string, Navegador>();

// Se crea al primer uso: un Chromium ocupa RAM y solo arranca cuando la IA lo necesita.
export function navegadorDe(computadora: Computadora): Navegador {
  let n = navegadores.get(computadora.usuario);
  if (!n) navegadores.set(computadora.usuario, (n = new Navegador(computadora)));
  return n;
}

export async function cerrarNavegadores() {
  await Promise.all([...navegadores.values()].map((n) => n.cerrar()));
}
