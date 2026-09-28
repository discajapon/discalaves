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
];

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
const BORRADO = /(^|[\s;&|(`\/])(rm|rmdir|shred|unlink)(\s|$)|\s-delete\b/; // también tras sudo, xargs, -exec o /bin/
const BUSQUEDA = /busca|search|buscar|consulta|query|\bq\b/i;

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
  if (nombre === "escribir_archivo" && texto("ruta")) {
    await computadora.encender((d) => avisar("ejecutando", d));
    avisar("ejecutando", `escribir ${texto("ruta")}`);
    // Se escribe desde dentro del contenedor: así un enlace simbólico creado por el modelo no puede sacar el archivo fuera.
    const script = 'mkdir -p -- "$(dirname -- "$1")" && cat > "$1" && echo "guardado: $1 ($(wc -c < "$1") bytes)"';
    const contenido = typeof args.contenido === "string" ? args.contenido : "";
    return recortar(await computadora.ejecutar(["bash", "-c", script, "escribir", texto("ruta")], { entrada: contenido, tiempo: TIEMPO_CAJA }));
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
