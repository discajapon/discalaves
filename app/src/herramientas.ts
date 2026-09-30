// Herramientas de cada IA. Todo corre dentro de su computadora (un contenedor Debian, ver
// computadora.ts); nada toca el sistema del usuario. Los comandos que empiezan por "sudo" corren como
// root de SU contenedor, sin contraseña (decisión del usuario, 2026-09-27).
import fs from "node:fs";
import type { Computadora } from "./computadora";
import type { Navegador } from "./navegador";

const MAX_SALIDA = 3000; // caracteres de salida que ve el modelo
const TIEMPO_CAJA = 120_000;
const TIEMPO_SUDO = 10 * 60_000; // apt puede tardar

export const DEFINICIONES = [
  {
    type: "function",
    function: {
      name: "terminal",
      description:
        "Ejecuta un comando bash en tu computadora aislada (Debian 13 con escritorio): empieza en tu carpeta de inicio (~), con internet, " +
        "sin acceso a los archivos del usuario. Los programas gráficos se abren en tu escritorio (DISPLAY=:1). " +
        "Devuelve la salida y el código de salida. Para ser administrador de tu computadora (por ejemplo sudo apt-get install -y <paquete>), " +
        "empieza el comando con sudo: corre como root de tu computadora, no de la del usuario.",
      parameters: {
        type: "object",
        properties: { comando: { type: "string", description: "comando bash, por ejemplo: ls -la" } },
        required: ["comando"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escribir_archivo",
      description: "Crea o reemplaza un archivo de texto en tu carpeta de inicio (~). Úsalo para dejar informes o notas.",
      parameters: {
        type: "object",
        properties: {
          ruta: { type: "string", description: "ruta relativa a tu carpeta de inicio, por ejemplo: informes/resumen.md" },
          contenido: { type: "string" },
        },
        required: ["ruta", "contenido"],
      },
    },
  },
  herramienta("buscar_web", "Busca en internet y devuelve los primeros resultados (título, dirección y un fragmento).", {
    consulta: { type: "string", description: "qué buscar" },
  }),
  herramienta("abrir_pagina", "Abre una dirección en tu navegador y devuelve el texto principal de la página.", {
    url: { type: "string", description: "por ejemplo: https://es.wikipedia.org/wiki/Linux" },
  }),
  herramienta("ver_pagina", "Muestra la estructura de la página abierta (enlaces, botones, campos) para decidir dónde hacer clic o escribir.", {}),
  herramienta("hacer_clic", "Hace clic en un enlace o botón de la página abierta, buscándolo por su texto visible.", {
    texto: { type: "string", description: "texto del enlace o botón" },
  }),
  herramienta("escribir_en", "Escribe en un campo de la página abierta, buscándolo por su nombre o etiqueta.", {
    campo: { type: "string", description: "nombre, etiqueta o texto de ejemplo del campo" },
    texto: { type: "string" },
    enviar: { type: "boolean", description: "true para pulsar Enter después de escribir" },
  }),
  // Adicionales: el usuario las activa por empleado (cada una ocupa contexto del modelo).
  herramienta("leer_archivo", "Lee un archivo de texto de tu carpeta de inicio (~), o lista el contenido de una carpeta.", {
    ruta: { type: "string", description: "ruta relativa a tu carpeta de inicio, por ejemplo: informes/resumen.md (o . para listarla)" },
  }),
  herramienta(
    "editar_archivo",
    "Cambia un trozo exacto de un archivo de tu carpeta por otro texto, sin reescribirlo entero. Lee antes el archivo: el texto a buscar debe aparecer una sola vez, igual que en el archivo.",
    {
      ruta: { type: "string", description: "ruta relativa a tu carpeta de inicio" },
      buscar: { type: "string", description: "el texto exacto que hay ahora" },
      reemplazar: { type: "string", description: "el texto nuevo" },
    },
  ),
  herramienta(
    "leer_web",
    "Descarga una dirección y devuelve su texto sin abrir el navegador: más rápido, pero no sirve para páginas que necesitan JavaScript ni permite hacer clic.",
    { url: { type: "string", description: "por ejemplo: https://es.wikipedia.org/wiki/Linux" } },
  ),
  herramienta(
    "preguntar",
    "Detiene tu trabajo y le hace una pregunta al usuario. Úsala solo si te falta un dato imprescindible que no puedes averiguar o debe elegir entre opciones; la tarea sigue cuando responda.",
    { pregunta: { type: "string", description: "la pregunta, corta y concreta (con las opciones si las hay)" } },
  ),
];

// Herramientas del perfil de cada empleado (no usan su computadora: las resuelve main.ts con empleados.ts).
export const LEER_PROCEDIMIENTO = herramienta(
  "leer_procedimiento",
  "Devuelve el texto de uno de tus procedimientos (pasos y formato de salida). Léelo antes de una tarea de ese tipo.",
  { nombre: { type: "string", description: "nombre del procedimiento, tal como aparece en tu lista" } },
);
export const RECORDAR = herramienta(
  "recordar",
  "Guarda una nota corta en tu memoria para otras conversaciones: preferencias del usuario, decisiones, datos que te pidió recordar.",
  { texto: { type: "string", description: "la nota, en una frase" } },
);

// pasar_trabajo lleva en su descripción a los compañeros del equipo, así que se arma en cada turno.
function pasarTrabajo(companeros: { nombre: string; rol: string }[]) {
  return herramienta(
    "pasar_trabajo",
    "Encarga una tarea a un compañero del equipo y espera su respuesta, que te llega como texto (sus archivos se quedan en su computadora). " +
      `Explícale la tarea completa: no ve tu conversación. Compañeros: ${companeros.map((c) => (c.rol ? `${c.nombre} (${c.rol})` : c.nombre)).join(", ")}.`,
    {
      empleado: { type: "string", description: "nombre del compañero" },
      tarea: { type: "string", description: "qué debe hacer y con qué datos" },
    },
  );
}

// Solo se envían al modelo las herramientas del puesto: menos opciones, menos errores.
export function definicionesPara(permitidas: string[], conProcedimientos: boolean, companeros: { nombre: string; rol: string }[] = []) {
  return [
    ...DEFINICIONES.filter((d) => permitidas.includes(d.function.name)),
    ...(permitidas.includes("pasar_trabajo") && companeros.length ? [pasarTrabajo(companeros)] : []),
    ...(conProcedimientos ? [LEER_PROCEDIMIENTO] : []),
    RECORDAR,
  ];
}

function herramienta(name: string, description: string, properties: Record<string, object>) {
  const required = Object.keys(properties).filter((k) => k !== "enviar");
  return { type: "function", function: { name, description, parameters: { type: "object", properties, required } } };
}

export interface Resultado { salida: string; codigo: number }
export type Aviso = (fase: "ejecutando", detalle: string) => void;
export interface Contexto {
  carpeta: string; // su /home en su computadora
  usuario: string; // nombre dentro de su computadora: /home/<usuario>
  computadora: Computadora; // la suya: su contenedor
  navegador: Navegador; // el Chromium de su escritorio, no compartido con otras IAs
  avisar: Aviso;
  aprobar: (descripcion: string) => Promise<boolean>; // el usuario decide en la interfaz
}

// Acciones delicadas (borrar, enviar, pagar): necesitan la aprobación explícita del usuario.
// ponytail: detección por palabras clave; puede dejar pasar acciones delicadas con otros nombres.
const DELICADO = /\b(enviar|env[ií]a|send|pagar|pago|pay|comprar|compra|buy|checkout|publicar|post|borrar|eliminar|delete|remove|confirmar|confirm|suscrib|subscribe|transferir|donar|donate)/i;
export const BORRADO = /(^|[\s;&|(`\/])(rm|rmdir|shred|unlink)(\s|$)|\s-delete\b/; // también tras sudo, xargs, -exec o /bin/
const BUSQUEDA = /busca|search|buscar|consulta|query|\bq\b/i;

const MAX_LECTURA = 6000; // caracteres de un archivo o página que ve el modelo (desde el principio)
const AGENTE = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

function escribir(computadora: Computadora, ruta: string, contenido: string): Promise<Resultado> {
  const script = 'mkdir -p -- "$(dirname -- "$1")" && cat > "$1" && echo "guardado: $1 ($(wc -c < "$1") bytes)"';
  return computadora.ejecutar(["bash", "-c", script, "escribir", ruta], { entrada: contenido, tiempo: TIEMPO_CAJA });
}

// Texto legible de una página HTML, sin navegador: fuera scripts, estilos y etiquetas; los bloques pasan a líneas.
// ponytail: expresiones regulares, no un analizador de HTML; basta para leer el texto de una página.
export function textoDeHtml(html: string): { titulo: string; texto: string } {
  const entidades: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  const decodificar = (t: string) =>
    t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] !== "#") return entidades[e.toLowerCase()] ?? m;
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    });
  const titulo = decodificar(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const texto = decodificar(
    html
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(script|style|noscript|svg|head|template)\b[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr|\/section|\/article|\/header|\/footer|\/ul|\/ol|\/table)\b[^>]*>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<[^>]+>/g, " "),
  )
    .split("\n")
    .map((l) => l.replace(/[ \t\u00a0]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return { titulo, texto };
}

function recortar(r: Resultado): Resultado {
  let salida = r.salida;
  if (salida.length > MAX_SALIDA) salida = `${salida.slice(0, MAX_SALIDA / 2)}\n[… recortado …]\n${salida.slice(-MAX_SALIDA / 2)}`;
  return { salida: salida || "(sin salida)", codigo: r.codigo };
}

async function terminal({ computadora, avisar }: Contexto, comando: string): Promise<Resultado> {
  const sudo = comando.match(/^\s*sudo\s+(?:-\S+\s+)*(.+)$/s);
  if (!sudo) {
    await computadora.encender((d) => avisar("ejecutando", d));
    avisar("ejecutando", comando);
    return recortar(await computadora.ejecutar(["bash", "-c", comando], { tiempo: TIEMPO_CAJA }));
  }
  await computadora.encender((d) => avisar("ejecutando", d));
  avisar("ejecutando", `sudo ${sudo[1]}`);
  return recortar(await computadora.ejecutar(["bash", "-c", sudo[1]], { tiempo: TIEMPO_SUDO, root: true }));
}

async function delicado(navegador: Navegador, nombre: string, args: Record<string, unknown>): Promise<string | null> {
  const t = (k: string) => String(args[k] ?? "");
  if (nombre === "terminal" && BORRADO.test(t("comando"))) return `borrar con: ${t("comando")}`;
  if (nombre === "hacer_clic" && DELICADO.test(t("texto"))) return `hacer clic en "${t("texto")}" en ${await navegador.urlActual()}`;
  if (nombre === "escribir_en" && args.enviar === true && !BUSQUEDA.test(t("campo"))) {
    return `enviar "${t("texto").slice(0, 200)}" en el campo "${t("campo")}" de ${await navegador.urlActual()}`;
  }
  return null;
}

const NAVEGADOR = { buscar_web: 1, abrir_pagina: 1, ver_pagina: 1, hacer_clic: 1, escribir_en: 1 };

async function ejecutarNavegador(navegador: Navegador, nombre: string, t: (k: string) => string, enviar: boolean): Promise<string | null> {
  if (nombre === "buscar_web" && t("consulta")) return navegador.buscarWeb(t("consulta"));
  if (nombre === "abrir_pagina" && t("url")) return navegador.abrirPagina(t("url"));
  if (nombre === "ver_pagina") return navegador.verPagina();
  if (nombre === "hacer_clic" && t("texto")) return navegador.hacerClic(t("texto"));
  if (nombre === "escribir_en" && t("campo")) return navegador.escribirEn(t("campo"), t("texto"), enviar);
  return null;
}

export async function ejecutarHerramienta(ctx: Contexto, nombre: string, argumentosJson: string): Promise<Resultado> {
  const { carpeta, computadora, avisar, navegador } = ctx;
  fs.mkdirSync(carpeta, { recursive: true });
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argumentosJson || "{}");
  } catch {
    return { salida: "argumentos inválidos: no son JSON", codigo: -1 };
  }
  const texto = (k: string) => (typeof args[k] === "string" ? (args[k] as string).trim() : "");

  const accion = await delicado(navegador, nombre, args);
  if (accion && !(await ctx.aprobar(accion))) return { salida: "el usuario no lo permitió; no se hizo nada", codigo: 1 };

  if (nombre === "terminal" && texto("comando")) return terminal(ctx, texto("comando"));
  // Los archivos se leen y escriben desde dentro del contenedor: así un enlace simbólico creado por el modelo
  // no puede sacar nada fuera de su computadora.
  if (nombre === "escribir_archivo" && texto("ruta")) {
    await computadora.encender((d) => avisar("ejecutando", d));
    avisar("ejecutando", `escribir ${texto("ruta")}`);
    return recortar(await escribir(computadora, texto("ruta"), typeof args.contenido === "string" ? args.contenido : ""));
  }
  if (nombre === "leer_archivo" && texto("ruta")) {
    await computadora.encender((d) => avisar("ejecutando", d));
    avisar("ejecutando", `leer ${texto("ruta")}`);
    const script =
      `if [ -d "$1" ]; then ls -la -- "$1"; else n=$(wc -c < "$1") && head -c ${MAX_LECTURA} -- "$1" && ` +
      `if [ "$n" -gt ${MAX_LECTURA} ]; then printf '\n[… el archivo tiene %s bytes; solo ves los primeros ${MAX_LECTURA} …]' "$n"; fi; fi`;
    const r = await computadora.ejecutar(["bash", "-c", script, "leer", texto("ruta")], { tiempo: TIEMPO_CAJA });
    return { salida: r.salida || "(archivo vacío)", codigo: r.codigo };
  }
  if (nombre === "editar_archivo" && texto("ruta") && typeof args.buscar === "string" && args.buscar) {
    await computadora.encender((d) => avisar("ejecutando", d));
    avisar("ejecutando", `editar ${texto("ruta")}`);
    const actual = await computadora.ejecutar(["cat", "--", texto("ruta")], { tiempo: TIEMPO_CAJA });
    if (actual.codigo !== 0) return recortar(actual);
    const veces = actual.salida.split(args.buscar).length - 1;
    if (veces !== 1) {
      return { salida: veces ? `ese texto aparece ${veces} veces; incluye más texto alrededor para que sea único.` : "no encontré ese texto exacto en el archivo; léelo con leer_archivo y copia el trozo tal cual.", codigo: 1 };
    }
    const reemplazar = typeof args.reemplazar === "string" ? args.reemplazar : "";
    return recortar(await escribir(computadora, texto("ruta"), actual.salida.replace(args.buscar, () => reemplazar)));
  }
  if (nombre === "leer_web" && texto("url")) {
    await computadora.encender((d) => avisar("ejecutando", d));
    avisar("ejecutando", `leer web ${texto("url")}`);
    const url = /^https?:\/\//i.test(texto("url")) ? texto("url") : `https://${texto("url")}`;
    // Se descarga desde su computadora (su red, no la del equipo) y solo por http(s), también en las redirecciones.
    const r = await computadora.ejecutar(
      ["curl", "-sSfL", "--proto", "=http,https", "--proto-redir", "=http,https", "--max-time", "25", "--max-filesize", "5000000", "-A", AGENTE, "--", url],
      { tiempo: 40_000 },
    );
    if (r.codigo !== 0) return { salida: `no pude descargarla: ${r.salida.trim().slice(0, 300)}`, codigo: 1 };
    if (r.salida.includes("\u0000")) return { salida: "no es una página de texto (parece un archivo binario, por ejemplo un PDF o una imagen).", codigo: 1 };
    const { titulo, texto: cuerpo } = textoDeHtml(r.salida);
    const recortado = cuerpo.length > MAX_LECTURA ? `${cuerpo.slice(0, MAX_LECTURA)}\n[… recortado …]` : cuerpo;
    return { salida: `título: ${titulo}\nurl: ${url}\n\n${recortado || "(la página no tiene texto sin JavaScript; prueba con abrir_pagina)"}`, codigo: 0 };
  }
  if (nombre in NAVEGADOR && computadora.controlUsuario) {
    return { salida: "el usuario tomó el control de tu navegador; espera a que lo devuelva o pregúntale.", codigo: 1 };
  }
  try {
    if (nombre in NAVEGADOR) await computadora.encender((d) => avisar("ejecutando", d));
    avisar("ejecutando", `${nombre.replace("_", " ")} ${texto("consulta") || texto("url") || texto("texto") || texto("campo")}`.trim());
    const salida = await ejecutarNavegador(navegador, nombre, texto, args.enviar === true);
    if (salida !== null) return { salida, codigo: 0 };
  } catch (e) {
    return { salida: `error del navegador: ${(e as Error).message.split("\n")[0]}`, codigo: 1 };
  }
  return { salida: `herramienta o argumentos no válidos: ${nombre}`, codigo: -1 };
}

// Un paso de la tarea tal como queda en el historial (solo los campos que mira verificar).
export interface PasoTarea { de: string; texto?: string; nombre?: string; argumentos?: string; salida?: string; codigo?: number }

// Verificación de honestidad al terminar una tarea (un modelo de 9B a veces lo necesita): si dice que guardó
// un archivo sin haberlo guardado, o cita una dirección que no salió de ninguna herramienta en esta tarea,
// se retira esa respuesta y se le pide que lo haga de verdad o que diga que no pudo. Una vez por tipo y tarea.
export function verificar(texto: string, tarea: PasoTarea[], hechas: Set<string>): { tipo: string; aviso: string } | null {
  const usadas = tarea.filter((m) => m.de === "herramienta");
  const guardo = usadas.some((m) => m.nombre === "escribir_archivo" && m.codigo === 0);
  const redirige = usadas.some((m) => m.nombre === "terminal" && m.codigo === 0 && /(>|\btee\b|\bcp\b|\bmv\b|\btouch\b)/.test(m.argumentos ?? ""));
  if (!hechas.has("archivo") && !guardo && !redirige && /\b(he guardado|lo guard[eé]|guard[eé] (el|un|tu|la)|qued[oó] guardad|est[aá] guardad|dej[eé] (el|un) (informe|archivo)|he (dejado|creado) (el|un) (informe|archivo))/i.test(texto)) {
    return { tipo: "archivo", aviso: "Dijiste que guardaste un archivo, pero en esta tarea no usaste escribir_archivo: el archivo no existe. Guárdalo ahora con escribir_archivo, o di claramente que no lo guardaste." };
  }
  if (!hechas.has("fuente")) {
    const delUsuario = tarea.filter((m) => m.de === "yo").map((m) => m.texto ?? "");
    const vistas = [...usadas.map((m) => `${m.argumentos ?? ""}\n${m.salida ?? ""}`), ...delUsuario].join("\n").toLowerCase();
    const dominios = [...texto.matchAll(/https?:\/\/(?:www\.)?([a-z0-9.-]+\.[a-z]{2,})/gi), ...texto.matchAll(/\bwww\.([a-z0-9.-]+\.[a-z]{2,})/gi)].map((m) => m[1].toLowerCase());
    const inventadas = [...new Set(dominios)].filter((d) => !vistas.includes(d));
    if (inventadas.length) {
      return { tipo: "fuente", aviso: `Citaste ${inventadas.join(", ")}, pero no lo abriste ni salió en tus búsquedas en esta tarea. Búscalo y ábrelo antes de citarlo, o di que no pudiste comprobarlo.` };
    }
  }
  return null;
}
