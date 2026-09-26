// Herramientas de qwen. Todo corre dentro de una caja bubblewrap (sin ver las carpetas del usuario,
// con internet) salvo los comandos que empiezan por "sudo": esos corren en el sistema real y solo
// después de que el usuario escriba su contraseña en el diálogo de GNOME (pkexec/polkit). La
// contraseña nunca pasa por la app ni por el modelo.
//
// ponytail: bubblewrap no es todavía el contenedor endurecido de CLAUDE.md: comparte la red del
// equipo (incluida la red local) y ve /usr y /etc en solo lectura. Se cambia cuando llegue el motor
// de contenedores.
import { spawn } from "node:child_process";
import fs from "node:fs";

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
];

export interface Resultado { salida: string; codigo: number }
export type Aviso = (fase: "ejecutando" | "esperando-clave", detalle: string) => void;

function caja(carpeta: string, argumentos: string[]): string[] {
  return [
    "--ro-bind", "/usr", "/usr",
    "--symlink", "usr/bin", "/bin", "--symlink", "usr/lib", "/lib",
    "--symlink", "usr/lib64", "/lib64", "--symlink", "usr/sbin", "/sbin",
    "--ro-bind", "/etc", "/etc",
    "--ro-bind-try", "/run/systemd/resolve", "/run/systemd/resolve", // DNS de systemd-resolved
    "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
    "--bind", carpeta, "/home/qwen", "--chdir", "/home/qwen",
    "--unshare-all", "--share-net", "--hostname", "qwen",
    "--die-with-parent", "--new-session",
    "--clearenv", "--setenv", "HOME", "/home/qwen", "--setenv", "PATH", "/usr/local/bin:/usr/bin:/bin",
    "--setenv", "LANG", "C.UTF-8", "--setenv", "TERM", "dumb",
    ...argumentos,
  ];
}

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

export function ejecutarHerramienta(carpeta: string, nombre: string, argumentosJson: string, avisar: Aviso): Promise<Resultado> {
  fs.mkdirSync(carpeta, { recursive: true });
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argumentosJson || "{}");
  } catch {
    return Promise.resolve({ salida: "argumentos inválidos: no son JSON", codigo: -1 });
  }
  const texto = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : "");

  if (nombre === "terminal" && texto("comando").trim()) return terminal(carpeta, texto("comando"), avisar);
  if (nombre === "escribir_archivo" && texto("ruta").trim()) {
    avisar("ejecutando", `escribir ${texto("ruta")}`);
    // Se escribe desde dentro de la caja: así un enlace simbólico creado por el modelo no puede sacar el archivo fuera.
    const script = 'mkdir -p -- "$(dirname -- "$1")" && cat > "$1" && echo "guardado: $1 ($(wc -c < "$1") bytes)"';
    return ejecutar("bwrap", caja(carpeta, ["/bin/bash", "-c", script, "escribir", texto("ruta")]), TIEMPO_CAJA, texto("contenido"));
  }
  return Promise.resolve({ salida: `herramienta o argumentos no válidos: ${nombre}`, codigo: -1 });
}
