// Herramientas de cada IA. Todo corre dentro de su computadora (un contenedor Debian, ver
// computadora.ts); nada toca el sistema del usuario. Los comandos que empiezan por "sudo" corren como
// root de SU contenedor, sin contraseña (decisión del usuario, 2026-09-27).
import fs from "node:fs";
import type { Computadora } from "./computadora";
import type { Navegador } from "./navegador";
import { escritorioDe, type Captura } from "./escritorio";

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
  herramienta("abrir_pagina", "Abre una dirección en tu navegador y devuelve el texto principal de la página, para leerla. Una página larga llega por partes: con la misma url y parte: 2, 3… sigues leyendo sin recargarla.", {
    url: { type: "string", description: "por ejemplo: https://es.wikipedia.org/wiki/Linux" },
    parte: { type: "integer", description: "qué parte del texto leer: 1 (el principio, por defecto), 2, 3…" },
  }, ["parte"]),
  herramienta("ver_pagina", "Muestra la estructura de la página abierta: enlaces, botones y campos, cada uno con su referencia [ref=e7] para hacer_clic o escribir_en. Una página larga llega por partes.", {
    parte: { type: "integer", description: "qué parte de una página larga ver: 1 (la de arriba, por defecto), 2, 3…" },
  }, ["parte"]),
  herramienta("hacer_clic", "Hace clic en un enlace o botón de la página abierta. Mejor por su referencia de ver_pagina (ref); si no, por su texto visible.", {
    ref: { type: "string", description: "referencia de ver_pagina, por ejemplo: e7" },
    texto: { type: "string", description: "texto del enlace o botón, si no tienes la referencia" },
  }, ["ref", "texto"]),
  herramienta("escribir_en", "Escribe en un campo de la página abierta. Mejor por su referencia de ver_pagina (ref); si no, por su nombre o etiqueta.", {
    ref: { type: "string", description: "referencia de ver_pagina, por ejemplo: e12" },
    campo: { type: "string", description: "nombre, etiqueta o texto de ejemplo del campo, si no tienes la referencia" },
    texto: { type: "string" },
    enviar: { type: "boolean", description: "true para pulsar Enter después de escribir" },
  }, ["ref", "campo", "enviar"]),
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

// Escritorio con capturas (como computer use): en el perfil van juntas como "escritorio". Solo se ofrecen si el
// modelo acepta imágenes (main.ts lo detecta). Coordenadas de 0 a 1000 sobre la última imagen que vio.
const XY = {
  x: { type: "number", description: "0 a 1000, de izquierda a derecha de la captura" },
  y: { type: "number", description: "0 a 1000, de arriba abajo de la captura" },
};
export const ESCRITORIO = [
  herramienta(
    "captura_pantalla",
    "Toma una captura de tu escritorio (cualquier programa, no solo el navegador) para ver qué hay. Las acciones de ratón y teclado ya te devuelven una captura nueva.",
    {},
  ),
  herramienta("clic", "Hace clic en un punto de la última captura. Di siempre qué pretendes pulsar.", {
    ...XY,
    objetivo: { type: "string", description: "qué pulsas, por ejemplo: botón Guardar" },
    boton: { type: "string", enum: ["izquierdo", "derecho", "doble", "triple", "central"], description: "izquierdo por defecto; doble para abrir; triple selecciona una línea" },
    mantener: { type: "string", description: "teclas mantenidas durante el clic, por ejemplo ctrl o mayús (para seleccionar varios)" },
  }, ["boton", "mantener"]),
  herramienta("mover_raton", "Mueve el ratón a un punto de la última captura sin hacer clic (por ejemplo para ver un menú).", XY),
  herramienta("arrastrar", "Arrastra con el botón izquierdo de un punto a otro de la última captura.", {
    ...XY,
    hasta_x: { type: "number", description: "0 a 1000" },
    hasta_y: { type: "number", description: "0 a 1000" },
    objetivo: { type: "string", description: "qué arrastras y adónde" },
  }),
  herramienta("escribir_texto", "Escribe texto con el teclado donde esté el cursor (haz clic antes en el campo).", {
    texto: { type: "string" },
  }),
  herramienta("pulsar_teclas", "Pulsa teclas o atajos, por ejemplo: ctrl+s, Intro, Escape, alt+F4, ctrl+l.", {
    teclas: { type: "string", description: "una o varias separadas por espacios: ctrl+a Supr" },
  }),
  herramienta("desplazar", "Desplaza (rueda del ratón) sobre un punto de la última captura.", {
    ...XY,
    direccion: { type: "string", enum: ["arriba", "abajo", "izquierda", "derecha"] },
    cantidad: { type: "number", description: "pasos de la rueda, 3 por defecto" },
  }, ["cantidad"]),
  herramienta("esperar", "Espera unos segundos a que algo termine de cargar o abrir y te devuelve una captura nueva.", {
    segundos: { type: "number", description: "de 1 a 30" },
  }),
  herramienta(
    "ampliar",
    "Amplía una zona de la última captura para ver detalles pequeños. Tu siguiente acción puede usar coordenadas de la imagen ampliada.",
    {
      x1: { type: "number", description: "esquina superior izquierda, 0 a 1000" },
      y1: { type: "number", description: "0 a 1000" },
      x2: { type: "number", description: "esquina inferior derecha, 0 a 1000" },
      y2: { type: "number", description: "0 a 1000" },
    },
  ),
];
const DE_ESCRITORIO = new Set(ESCRITORIO.map((d) => d.function.name));
// ¿Está la herramienta en el puesto? "escritorio" en el perfil permite todas las de capturas.
export const permitida = (permitidas: string[], nombre: string) => permitidas.includes(nombre) || (DE_ESCRITORIO.has(nombre) && permitidas.includes("escritorio"));

// La herramienta de su puesto con el nombre más parecido a uno inventado ("passing_trabajo" → "pasar_trabajo"), o
// null. Sin la pista, el modelo concluía que no podía delegar y hacía el trabajo él mismo.
export function parecida(permitidas: string[], nombre: string): string | null {
  const nombres = [...permitidas.filter((p) => p !== "escritorio"), ...(permitidas.includes("escritorio") ? DE_ESCRITORIO : [])];
  const distancia = (a: string, b: string) => {
    let fila = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const nueva = [i];
      for (let j = 1; j <= b.length; j++) nueva[j] = Math.min(fila[j] + 1, nueva[j - 1] + 1, fila[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      fila = nueva;
    }
    return fila[b.length];
  };
  let mejor: string | null = null;
  let menor = Infinity;
  for (const n of nombres) {
    const d = distancia(nombre.toLowerCase(), n);
    if (d < menor) (menor = d), (mejor = n);
  }
  return mejor && menor <= Math.max(2, Math.floor(mejor.length / 3)) ? mejor : null;
}

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
export function definicionesPara(permitidas: string[], conProcedimientos: boolean, companeros: { nombre: string; rol: string }[] = [], vision = false) {
  return [
    ...DEFINICIONES.filter((d) => permitidas.includes(d.function.name)),
    ...(vision && permitidas.includes("escritorio") ? ESCRITORIO : []),
    ...(permitidas.includes("pasar_trabajo") && companeros.length ? [pasarTrabajo(companeros)] : []),
    ...(conProcedimientos ? [LEER_PROCEDIMIENTO] : []),
    RECORDAR,
  ];
}

function herramienta(name: string, description: string, properties: Record<string, object>, opcionales: string[] = ["enviar"]) {
  const required = Object.keys(properties).filter((k) => !opcionales.includes(k));
  return { type: "function", function: { name, description, parameters: { type: "object", properties, required } } };
}

// imagen: captura que el modelo ve tras la herramienta (JPEG); main.ts la guarda y la manda solo si es reciente.
export interface Resultado { salida: string; codigo: number; imagen?: Buffer }
export type Aviso = (fase: "ejecutando" | "pausa", detalle: string) => void;
// Captura con el punto que el modelo quiere pulsar (0–1000), para la tarjeta de aprobación.
export interface Marca { jpeg: Buffer; x: number; y: number }
export interface Contexto {
  carpeta: string; // su /home en su computadora
  usuario: string; // nombre dentro de su computadora: /home/<usuario>
  computadora: Computadora; // la suya: su contenedor
  navegador: Navegador; // el Chromium de su escritorio, no compartido con otras IAs
  avisar: Aviso;
  aprobar: (descripcion: string, marca?: Marca) => Promise<boolean>; // el usuario decide en la interfaz
  senal?: AbortSignal; // Detener: corta también la pausa mientras el usuario tiene el control
  // Ubica un objetivo en una captura con una pregunta corta al mismo modelo (0–1000); null si no supo.
  ubicar?: (jpeg: Buffer, objetivo: string) => Promise<{ x: number; y: number } | null>;
}

// Respuesta del modelo a "¿dónde está…?": "x,y", "[x, y]" o una caja "[x1, y1, x2, y2]" (su centro), en 0–1000.
export function leerPunto(texto: string): { x: number; y: number } | null {
  const n = (texto.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  const p = n.length >= 4 ? { x: (n[0] + n[2]) / 2, y: (n[1] + n[3]) / 2 } : n.length >= 2 ? { x: n[0], y: n[1] } : null;
  return p && p.x <= 1000 && p.y <= 1000 ? { x: Math.round(p.x), y: Math.round(p.y) } : null;
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

// Con referencia, el nombre del elemento sale de la propia página (antes de pulsarlo): así un clic en "Pagar" por
// su ref también pide aprobación. Con coordenadas, cuenta lo que el modelo declara que pulsa (objetivo).
async function delicado(navegador: Navegador, nombre: string, args: Record<string, unknown>): Promise<string | null> {
  const t = (k: string) => String(args[k] ?? "");
  if (nombre === "terminal" && BORRADO.test(t("comando"))) return `borrar con: ${t("comando")}`;
  if (nombre === "hacer_clic") {
    const quien = t("ref") ? await navegador.nombreDe(t("ref")) : t("texto");
    if (DELICADO.test(quien)) return `hacer clic en "${quien}" en ${await navegador.urlActual()}`;
  }
  if (nombre === "escribir_en" && args.enviar === true) {
    const campo = t("ref") ? await navegador.nombreDe(t("ref")) : t("campo");
    if (!BUSQUEDA.test(campo)) return `enviar "${t("texto").slice(0, 200)}" en el campo "${campo}" de ${await navegador.urlActual()}`;
  }
  if ((nombre === "clic" || nombre === "arrastrar") && DELICADO.test(t("objetivo"))) return `${nombre === "clic" ? "hacer clic en" : "arrastrar"} "${t("objetivo")}" en su escritorio`;
  return null;
}

const NAVEGADOR = { buscar_web: 1, abrir_pagina: 1, ver_pagina: 1, hacer_clic: 1, escribir_en: 1 };

async function ejecutarNavegador(navegador: Navegador, nombre: string, t: (k: string) => string, enviar: boolean, parte: unknown): Promise<string | null> {
  if (nombre === "buscar_web" && t("consulta")) return navegador.buscarWeb(t("consulta"));
  if (nombre === "abrir_pagina" && t("url")) return navegador.abrirPagina(t("url"), Number(parte) || 1);
  if (nombre === "ver_pagina") return navegador.verPagina(Number(parte) || 1); // número o texto: "2"
  if (nombre === "hacer_clic" && (t("ref") || t("texto"))) return navegador.hacerClic(t("ref"), t("texto"));
  if (nombre === "escribir_en" && (t("ref") || t("campo"))) return navegador.escribirEn(t("ref"), t("campo"), t("texto"), enviar);
  return null;
}

// Coordenada del modelo: número de 0 a 1000 (algunos la mandan como texto).
const coordenada = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
  return Number.isFinite(n) ? Math.min(1000, Math.max(0, n)) : null;
};
const conCaptura = (salida: string, c: Captura): Resultado => ({ salida: `${salida}\ncaptura: ${c.ancho}×${c.alto}, coordenadas de 0 a 1000`, codigo: 0, imagen: c.jpeg });

async function ejecutarEscritorio(ctx: Contexto, nombre: string, args: Record<string, unknown>): Promise<Resultado | null> {
  const e = escritorioDe(ctx.computadora);
  const n = (k: string) => coordenada(args[k]);
  const t = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : "");
  const faltan = (...k: string[]) => k.filter((x) => n(x) === null);
  ctx.avisar("ejecutando", `${nombre.replace("_", " ")} ${t("objetivo") || t("teclas") || t("texto").slice(0, 60)}`.trim());
  if (nombre === "captura_pantalla") return conCaptura("tu escritorio ahora", await e.capturar());
  if (nombre === "ampliar") {
    if (faltan("x1", "y1", "x2", "y2").length) return { salida: "faltan x1, y1, x2, y2 (0 a 1000)", codigo: -1 };
    return conCaptura("zona ampliada; tu siguiente acción puede usar coordenadas de esta imagen", await e.ampliar(n("x1")!, n("y1")!, n("x2")!, n("y2")!));
  }
  if (nombre === "escribir_texto") return t("texto") ? conCaptura(`escribí ${t("texto").length} caracteres`, (await e.escribir(t("texto"))).captura) : { salida: "falta el texto", codigo: -1 };
  if (nombre === "pulsar_teclas") return t("teclas") ? conCaptura(`pulsé ${t("teclas")}`, (await e.pulsar(t("teclas"))).captura) : { salida: "faltan las teclas", codigo: -1 };
  if (nombre === "esperar") return conCaptura("esperé; tu escritorio ahora", (await e.esperarYVer(Number(args.segundos) || 2)).captura);
  if (faltan("x", "y").length) return { salida: "faltan x e y (0 a 1000 sobre la última captura)", codigo: -1 };
  const [x, y] = [n("x")!, n("y")!];
  if (nombre === "clic") {
    const boton = (["derecho", "doble", "triple", "central"] as const).find((b) => b === t("boton")) ?? "izquierdo";
    const r = await e.clic(x, y, boton, t("mantener"));
    const con = t("mantener") ? ` con ${t("mantener")}` : "";
    return conCaptura(`clic ${boton === "izquierdo" ? "" : boton + " "}en ${t("objetivo") || "el punto"}${con} (${r.punto.x}, ${r.punto.y} de la pantalla)`, r.captura);
  }
  if (nombre === "mover_raton") return conCaptura("moví el ratón", (await e.mover(x, y)).captura);
  if (nombre === "desplazar") return conCaptura(`desplacé hacia ${t("direccion") || "abajo"}`, (await e.desplazar(x, y, t("direccion"), Number(args.cantidad) || 3)).captura);
  if (nombre === "arrastrar") {
    if (faltan("hasta_x", "hasta_y").length) return { salida: "faltan hasta_x y hasta_y (0 a 1000)", codigo: -1 };
    return conCaptura(`arrastré ${t("objetivo")}`.trim(), (await e.arrastrar(x, y, n("hasta_x")!, n("hasta_y")!)).captura);
  }
  return null;
}

// Mientras el usuario tiene el control de su escritorio, el empleado no envía acciones: espera (en pausa, visible
// en la interfaz) y al soltarlo sigue con una captura nueva, sin hacer la acción que pidió con la pantalla vieja.
async function pausaPorControl(ctx: Contexto, nombre: string): Promise<Resultado | null> {
  if (!ctx.computadora.controlUsuario) return null;
  ctx.avisar("pausa", "tienes el control de su escritorio; seguirá cuando lo sueltes");
  while (ctx.computadora.controlUsuario) {
    if (ctx.senal?.aborted) throw new Error("detenida");
    await new Promise((r) => setTimeout(r, 300));
  }
  ctx.avisar("ejecutando", "retoma con una captura nueva");
  const aviso = "el usuario tomó el control de tu escritorio y ya lo devolvió; no hice tu última acción porque la pantalla pudo cambiar.";
  if (nombre in NAVEGADOR) return { salida: `${aviso} Mira la página otra vez (ver_pagina) antes de seguir.`, codigo: 1 };
  const c = await escritorioDe(ctx.computadora).capturar();
  return { ...conCaptura(`${aviso} Esta es tu pantalla ahora: decide de nuevo.`, c), codigo: 1 };
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

  if (nombre in NAVEGADOR || DE_ESCRITORIO.has(nombre)) {
    const pausa = await pausaPorControl(ctx, nombre);
    if (pausa) return pausa;
  }
  // Clic: el modelo dice qué pulsa (objetivo) y la app lo ubica en la última captura con una pregunta corta al mismo
  // modelo. Medido con Qwen 3.5 9B (2026-10-17): solo, ubica un botón a ≤5 milésimas; dentro de una tarea larga
  // repetía las coordenadas de sus clics anteriores en vez de mirar la captura (132 pasos sin cerrar un diálogo).
  // Sus x, y quedan de respaldo.
  const ultima = DE_ESCRITORIO.has(nombre) ? escritorioDe(computadora).ultima : undefined;
  if (nombre === "clic" && ctx.ubicar && ultima && typeof args.objetivo === "string" && args.objetivo.trim()) {
    const p = await ctx.ubicar(ultima.jpeg, args.objetivo.trim()).catch(() => null);
    if (p) Object.assign(args, p);
  }
  const accion = await delicado(navegador, nombre, args).catch(() => null);
  if (accion) {
    const marca = ultima && coordenada(args.x) !== null ? { jpeg: ultima.jpeg, x: coordenada(args.x)!, y: coordenada(args.y) ?? 0 } : undefined;
    if (!(await ctx.aprobar(accion, marca))) return { salida: "el usuario no lo permitió; no se hizo nada", codigo: 1 };
  }
  if (DE_ESCRITORIO.has(nombre)) {
    try {
      await computadora.encender((d) => avisar("ejecutando", d));
      const r = await ejecutarEscritorio(ctx, nombre, args);
      if (r) return r;
    } catch (e) {
      return { salida: `error en su escritorio: ${(e as Error).message.split("\n")[0]}`, codigo: 1 };
    }
  }

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
  try {
    if (nombre in NAVEGADOR) await computadora.encender((d) => avisar("ejecutando", d));
    avisar("ejecutando", `${nombre.replace("_", " ")} ${texto("consulta") || texto("url") || texto("texto") || texto("campo") || texto("ref")}`.trim());
    const salida = await ejecutarNavegador(navegador, nombre, texto, args.enviar === true, args.parte);
    if (salida !== null) return { salida, codigo: 0 };
  } catch (e) {
    return { salida: `error del navegador: ${(e as Error).message.split("\n")[0]}`, codigo: 1 };
  }
  return { salida: `herramienta o argumentos no válidos: ${nombre}`, codigo: -1 };
}

// Un paso de la tarea tal como queda en el historial (solo los campos que mira verificar).
export interface PasoTarea { de: string; texto?: string; nombre?: string; argumentos?: string; salida?: string; codigo?: number }

// Freno de repeticiones: cuántas veces seguidas dio lo mismo cada llamada exacta (nombre + argumentos) en una tarea.
// Si da algo distinto, la cuenta vuelve a empezar: ver_pagina o captura_pantalla no llevan argumentos y volver a
// mirar tras navegar no es repetirse (antes, a la 3.ª lectura de la tarea se bloqueaban aunque la página cambiara).
export class Repeticiones {
  private veces = new Map<string, { n: number; salida?: string }>();
  // Antes de ejecutarla: cuántas van contando esta.
  contar(firma: string): number {
    const v = this.veces.get(firma) ?? { n: 0 };
    v.n++;
    this.veces.set(firma, v);
    return v.n;
  }
  // Después de ejecutarla.
  resultado(firma: string, salida: string) {
    const v = this.veces.get(firma);
    if (!v) return;
    if (v.salida !== undefined && v.salida !== salida) v.n = 1;
    v.salida = salida;
  }
}

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
