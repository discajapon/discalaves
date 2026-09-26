// Herramientas de qwen. Todo corre dentro de una caja bubblewrap (sin ver las carpetas del usuario,
// con internet) salvo los comandos que empiezan por "sudo": esos corren en el sistema real y solo
// después de que el usuario escriba su contraseña en el diálogo de GNOME (pkexec/polkit). La
// contraseña nunca pasa por la app ni por el modelo.
import { spawn } from "node:child_process";
import fs from "node:fs";
import { caja } from "./caja";
import * as navegador from "./navegador";

const MAX_SALIDA = 3000; // caracteres de salida que ve el modelo
const TIEMPO_CAJA = 120_000;
const TIEMPO_SUDO = 10 * 60_000; // incluye el tiempo que tarda el usuario en escribir la contraseña

export const DEFINICIONES = [
  {
    type: "function",
    function: {
      name: "terminal",
      description:
        "Ejecuta un comando bash en tu computadora aislada: carpeta /home/qwen, con internet, sin acceso a los archivos del usuario. " +
        "Devuelve la salida y el código de salida. Si de verdad necesitas permisos de administrador (por ejemplo instalar un paquete " +
        "con apt), empieza el comando con sudo: el usuario tendrá que escribir su contraseña y el comando correrá en su sistema real.",
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
      description: "Crea o reemplaza un archivo de texto en tu carpeta /home/qwen. Úsalo para dejar informes o notas.",
      parameters: {
        type: "object",
        properties: {
          ruta: { type: "string", description: "ruta relativa a /home/qwen, por ejemplo: informes/resumen.md" },
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
export type Aviso = (fase: "ejecutando" | "esperando-clave", detalle: string) => void;
export interface Contexto {
  carpeta: string;
  avisar: Aviso;
  aprobar: (descripcion: string) => Promise<boolean>; // el usuario decide en la interfaz
}

// Acciones delicadas (borrar, enviar, pagar): necesitan la aprobación explícita del usuario.
// ponytail: detección por palabras clave; puede dejar pasar acciones delicadas con otros nombres.
const DELICADO = /\b(enviar|env[ií]a|send|pagar|pago|pay|comprar|compra|buy|checkout|publicar|post|borrar|eliminar|delete|remove|confirmar|confirm|suscrib|subscribe|transferir|donar|donate)/i;
const BORRADO = /(^|[;&|(]\s*)(rm|rmdir|shred|unlink)\b|\s-delete\b/;
const BUSQUEDA = /busca|search|buscar|consulta|query|\bq\b/i;

function ejecutar(programa: string, argumentos: string[], tiempo: number, entrada?: string): Promise<Resultado> {
  return new Promise((resolver) => {
    const hijo = spawn(programa, argumentos, { timeout: tiempo, stdio: ["pipe", "pipe", "pipe"] });
    const trozos: Buffer[] = [];
    hijo.stdout.on("data", (b) => trozos.push(b));
    hijo.stderr.on("data", (b) => trozos.push(b));
    hijo.stdin.end(entrada ?? "");
    hijo.on("error", (e) => resolver({ salida: `no se pudo ejecutar ${programa}: ${e.message}`, codigo: -1 }));
    hijo.on("close", (codigo, senal) => {
      let salida = Buffer.concat(trozos).toString("utf8");
      if (salida.length > MAX_SALIDA) salida = `${salida.slice(0, MAX_SALIDA / 2)}\n[… recortado …]\n${salida.slice(-MAX_SALIDA / 2)}`;
      if (senal) salida += `\n[detenido: superó ${tiempo / 1000} s]`;
      resolver({ salida: salida || "(sin salida)", codigo: codigo ?? -1 });
    });
  });
}

async function terminal(carpeta: string, comando: string, avisar: Aviso): Promise<Resultado> {
  const sudo = comando.match(/^\s*sudo\s+(?:-\S+\s+)*(.+)$/s);
  if (!sudo) {
    avisar("ejecutando", comando);
    return ejecutar("bwrap", caja(carpeta, ["/bin/bash", "-c", comando]), TIEMPO_CAJA);
  }
  avisar("esperando-clave", sudo[1]);
  // pkexec muestra el comando completo en el diálogo, así el usuario ve qué está autorizando.
  const r = await ejecutar("pkexec", ["/bin/bash", "-c", `cd '${carpeta}' && ${sudo[1]}`], TIEMPO_SUDO);
  if (r.codigo === 126) return { salida: "el usuario canceló el permiso de administrador; no se ejecutó nada", codigo: 126 };
  if (r.codigo === 127 && /not authorized|No authentication agent/i.test(r.salida)) {
    return { salida: "no se obtuvo el permiso de administrador (contraseña incorrecta o sin diálogo disponible)", codigo: 127 };
  }
  return r;
}

async function delicado(nombre: string, args: Record<string, unknown>): Promise<string | null> {
  const t = (k: string) => String(args[k] ?? "");
  if (nombre === "terminal" && BORRADO.test(t("comando"))) return `borrar con: ${t("comando")}`;
  if (nombre === "hacer_clic" && DELICADO.test(t("texto"))) return `hacer clic en "${t("texto")}" en ${await navegador.urlActual()}`;
  if (nombre === "escribir_en" && args.enviar === true && !BUSQUEDA.test(t("campo"))) {
    return `enviar "${t("texto").slice(0, 200)}" en el campo "${t("campo")}" de ${await navegador.urlActual()}`;
  }
  return null;
}

async function ejecutarNavegador(nombre: string, t: (k: string) => string, enviar: boolean): Promise<string | null> {
  if (navegador.controlUsuario) return "el usuario tomó el control de tu navegador; espera a que lo devuelva o pregúntale.";
  if (nombre === "buscar_web" && t("consulta")) return navegador.buscarWeb(t("consulta"));
  if (nombre === "abrir_pagina" && t("url")) return navegador.abrirPagina(t("url"));
  if (nombre === "ver_pagina") return navegador.verPagina();
  if (nombre === "hacer_clic" && t("texto")) return navegador.hacerClic(t("texto"));
  if (nombre === "escribir_en" && t("campo")) return navegador.escribirEn(t("campo"), t("texto"), enviar);
  return null;
}

export async function ejecutarHerramienta(ctx: Contexto, nombre: string, argumentosJson: string): Promise<Resultado> {
  const { carpeta, avisar } = ctx;
  fs.mkdirSync(carpeta, { recursive: true });
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argumentosJson || "{}");
  } catch {
    return { salida: "argumentos inválidos: no son JSON", codigo: -1 };
  }
  const texto = (k: string) => (typeof args[k] === "string" ? (args[k] as string).trim() : "");

  const accion = await delicado(nombre, args);
  if (accion && !(await ctx.aprobar(accion))) return { salida: "el usuario no lo permitió; no se hizo nada", codigo: 1 };

  if (nombre === "terminal" && texto("comando")) return terminal(carpeta, texto("comando"), avisar);
  if (nombre === "escribir_archivo" && texto("ruta")) {
    avisar("ejecutando", `escribir ${texto("ruta")}`);
    // Se escribe desde dentro de la caja: así un enlace simbólico creado por el modelo no puede sacar el archivo fuera.
    const script = 'mkdir -p -- "$(dirname -- "$1")" && cat > "$1" && echo "guardado: $1 ($(wc -c < "$1") bytes)"';
    const contenido = typeof args.contenido === "string" ? args.contenido : "";
    return ejecutar("bwrap", caja(carpeta, ["/bin/bash", "-c", script, "escribir", texto("ruta")]), TIEMPO_CAJA, contenido);
  }
  try {
    avisar("ejecutando", `${nombre.replace("_", " ")} ${texto("consulta") || texto("url") || texto("texto") || texto("campo")}`.trim());
    const salida = await ejecutarNavegador(nombre, texto, args.enviar === true);
    if (salida !== null) return { salida, codigo: 0 };
  } catch (e) {
    return { salida: `error del navegador: ${(e as Error).message.split("\n")[0]}`, codigo: 1 };
  }
  return { salida: `herramienta o argumentos no válidos: ${nombre}`, codigo: -1 };
}
