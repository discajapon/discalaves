// Empleados: perfiles en archivos de texto legibles y editables a mano, en los datos del usuario (no en el
// repositorio). Cada uno en <datos>/empleados/<id>/:
//   identidad.md        encabezado simple (nombre, rol, color, modelo, herramientas) + tono y reglas, CORTO
//   procedimientos/*.md el "oficio" detallado; NO va en el prompt: se lee con leer_procedimiento
//   memoria.md          notas que añade la herramienta recordar; va al prompt con un tope de tamaño
// <datos>/empleados/indice.json guarda lo que no es del perfil: orden, carpeta de su computadora (usuario),
// modo libre y si su modelo sabe usar herramientas.
import fs from "node:fs";
import path from "node:path";
import { ADICIONALES_OC, PRINCIPALES_OC } from "./openclaw";

// Principales: las que traen las plantillas. Adicionales: el usuario las activa por empleado; pasar_trabajo ya viene en
// todas las plantillas (sin ella no hay equipo: decisión del usuario, 2026-09-30).
// "escritorio": las herramientas de capturas y coordenadas (herramientas.ts), solo si el modelo ve imágenes.
export const PRINCIPALES = ["terminal", "escribir_archivo", "buscar_web", "abrir_pagina", "ver_pagina", "hacer_clic", "escribir_en", "escritorio"];
export const ADICIONALES = ["leer_archivo", "editar_archivo", "leer_web", "preguntar", "pasar_trabajo"];
export const HERRAMIENTAS = [...PRINCIPALES, ...ADICIONALES];
// Nombres válidos en el perfil: los del bucle propio y los de OpenClaw (cada motor usa los suyos).
const TODAS = [...HERRAMIENTAS, ...PRINCIPALES_OC, ...ADICIONALES_OC];
export const COLORES = ["violeta", "turquesa", "naranja", "azul", "rojizo"];
const MAX_MEMORIA = 1500; // caracteres de memoria que van al prompt (las notas más recientes)
const MAX_PROCEDIMIENTO = 6000;
const VERSION_PERFILES = 2; // súbela cuando una plantilla gane algo que los empleados ya creados también deban tener

// ¿Están todas las líneas de "viejo", en el mismo orden, dentro de "nuevo"?
export function contiene(nuevo: string, viejo: string): boolean {
  const lineas = nuevo.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  return viejo.replace(/\r\n/g, "\n").split("\n").every((l) => {
    while (i < lineas.length && lineas[i] !== l) i++;
    return i++ < lineas.length;
  });
}

export interface Identidad {
  nombre: string;
  rol: string;
  color: string;
  modelo: string; // "qwen", "ollama:<modelo>", "nube:<proveedor>:<modelo>" o "codex:<modelo>" (ver main.ts)
  herramientas: string[];
  instrucciones: string; // tono y reglas del puesto
  motor?: "openclaw"; // quién hace el bucle del agente: OpenClaw (openclaw.ts) o, sin campo, el propio de main.ts
}
export interface Entrada { id: string; usuario: string; libre?: boolean; herramientasModelo: boolean; tope?: number } // tope: USD al mes (nube)
export interface Empleado extends Identidad, Entrada {}
export interface Procedimiento { nombre: string; descripcion: string }

// ---- Formato de los archivos: "---\nclave: valor\n---\ncuerpo" ----

function partir(texto: string): { cabecera: Record<string, string>; cuerpo: string } {
  const t = texto.replace(/\r\n/g, "\n");
  const m = t.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const cabecera: Record<string, string> = {};
  for (const linea of (m?.[1] ?? "").split("\n")) {
    const c = linea.match(/^\s*([A-Za-zÁÉÍÓÚáéíóúñ_]+)\s*:\s*(.*)$/);
    if (c) cabecera[c[1].toLowerCase()] = c[2].trim();
  }
  return { cabecera, cuerpo: (m ? m[2] : t).trim() };
}

export function leerIdentidad(texto: string): Identidad {
  const { cabecera: c, cuerpo } = partir(texto);
  return {
    nombre: c.nombre || "Empleado",
    rol: c.rol || "",
    color: COLORES.includes(c.color) ? c.color : "violeta",
    modelo: c.modelo || "qwen",
    herramientas: (c.herramientas ?? "").split(",").map((h) => h.trim()).filter((h) => TODAS.includes(h)),
    instrucciones: cuerpo,
    ...(c.motor === "openclaw" && { motor: "openclaw" as const }),
  };
}

export function textoIdentidad(i: Identidad): string {
  const linea = (s: string) => s.replace(/\s*\n\s*/g, " ").trim(); // una línea por campo
  return (
    `---\nnombre: ${linea(i.nombre)}\nrol: ${linea(i.rol)}\ncolor: ${i.color}\nmodelo: ${linea(i.modelo)}\n` +
    (i.motor === "openclaw" ? "motor: openclaw\n" : "") +
    `herramientas: ${i.herramientas.filter((h) => TODAS.includes(h)).join(", ")}\n---\n\n${i.instrucciones.trim()}\n`
  );
}

// ---- Carpetas ----

export class Empleados {
  constructor(readonly datos: string, readonly plantillas: string) {}

  get carpeta() {
    return path.join(this.datos, "empleados");
  }
  dir(id: string) {
    return path.join(this.carpeta, id);
  }
  private get archivoIndice() {
    return path.join(this.carpeta, "indice.json");
  }

  existe() {
    return fs.existsSync(this.archivoIndice);
  }

  private leerIndice(): Entrada[] {
    try {
      return JSON.parse(fs.readFileSync(this.archivoIndice, "utf8"));
    } catch {
      return [];
    }
  }

  guardarIndice(entradas: Entrada[]) {
    fs.mkdirSync(this.carpeta, { recursive: true });
    fs.writeFileSync(this.archivoIndice, JSON.stringify(entradas.map(({ id, usuario, libre, herramientasModelo, tope }) => ({ id, usuario, libre, herramientasModelo, tope })), null, 2));
  }

  // Se relee de disco cada vez: si el usuario edita identidad.md a mano, el siguiente mensaje ya lo usa.
  listar(): Empleado[] {
    return this.leerIndice().flatMap((e) => {
      try {
        return [{ ...leerIdentidad(fs.readFileSync(path.join(this.dir(e.id), "identidad.md"), "utf8")), ...e }];
      } catch {
        return []; // carpeta borrada a mano: el empleado desaparece de la lista
      }
    });
  }

  buscar(id: string): Empleado | undefined {
    return this.listar().find((e) => e.id === id);
  }

  // Un id nuevo a partir del nombre: letras y números, empieza por letra (es también el usuario de su computadora).
  private idNuevo(nombre: string): string {
    const limpio = nombre.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28);
    const base = !limpio ? "empleado" : /^[a-z]/.test(limpio) ? limpio : `e-${limpio}`;
    let id = base;
    for (let n = 2; fs.existsSync(this.dir(id)) || this.leerIndice().some((e) => e.id === id || e.usuario === id); n++) id = `${base}-${n}`;
    return id;
  }

  crear(identidad: Identidad, herramientasModelo: boolean, plantilla?: string, fijo?: { id: string; usuario: string; libre?: boolean }): Empleado {
    const id = fijo?.id ?? this.idNuevo(identidad.nombre);
    const dir = this.dir(id);
    fs.mkdirSync(path.join(dir, "procedimientos"), { recursive: true });
    const origen = plantilla && path.join(this.plantillas, path.basename(plantilla), "procedimientos"); // nunca fuera de plantillas/
    if (origen && fs.existsSync(origen)) {
      for (const f of fs.readdirSync(origen)) if (f.endsWith(".md")) fs.copyFileSync(path.join(origen, f), path.join(dir, "procedimientos", f));
    }
    fs.writeFileSync(path.join(dir, "identidad.md"), textoIdentidad(identidad));
    const memoria = path.join(dir, "memoria.md");
    if (!fs.existsSync(memoria)) fs.writeFileSync(memoria, `# Memoria de ${identidad.nombre}\n\n`);
    const entrada: Entrada = { id, usuario: fijo?.usuario ?? id, libre: fijo?.libre, herramientasModelo };
    this.guardarIndice([...this.leerIndice().filter((e) => e.id !== id), entrada]);
    return { ...identidad, ...entrada };
  }

  actualizar(id: string, identidad: Identidad, herramientasModelo: boolean) {
    fs.writeFileSync(path.join(this.dir(id), "identidad.md"), textoIdentidad(identidad));
    this.guardarIndice(this.leerIndice().map((e) => (e.id === id ? { ...e, herramientasModelo } : e)));
  }

  cambiarLibre(id: string, libre: boolean) {
    this.guardarIndice(this.leerIndice().map((e) => (e.id === id ? { ...e, libre } : e)));
  }

  cambiarTope(id: string, tope: number) {
    this.guardarIndice(this.leerIndice().map((e) => (e.id === id ? { ...e, tope } : e)));
  }

  // ---- Puesta al día de perfiles creados con plantillas anteriores ----
  // Una vez por versión (<datos>/empleados/version): después, lo que el usuario cambie en el perfil se respeta.
  ponerAlDia() {
    const archivo = path.join(this.carpeta, "version");
    let version = 0;
    try {
      version = Number(fs.readFileSync(archivo, "utf8")) || 0;
    } catch {
      // nunca se puso al día
    }
    if (version >= VERSION_PERFILES) return;
    for (const e of this.listar()) {
      // 2026-10-17: escribir_en llegó a las plantillas; quien hacía clic en páginas no podía escribir en sus buscadores.
      if (e.herramientas.includes("hacer_clic") && !e.herramientas.includes("escribir_en")) {
        const herramientas = [...e.herramientas];
        herramientas.splice(herramientas.indexOf("hacer_clic") + 1, 0, "escribir_en");
        fs.writeFileSync(path.join(this.dir(e.id), "identidad.md"), textoIdentidad({ ...e, herramientas }));
      }
      this.procedimientosAlDia(e.id);
    }
    fs.mkdirSync(this.carpeta, { recursive: true });
    fs.writeFileSync(archivo, String(VERSION_PERFILES));
  }

  // Un procedimiento copiado de una plantilla pasa a su versión nueva solo si el usuario no lo tocó: todas sus líneas
  // siguen, en orden, en la de la plantilla (la plantilla solo añadió). Uno editado a mano se queda como está.
  private procedimientosAlDia(id: string) {
    const dir = path.join(this.dir(id), "procedimientos");
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
      const actual = fs.readFileSync(path.join(dir, f), "utf8");
      for (const p of fs.readdirSync(this.plantillas)) {
        const nuevo = path.join(this.plantillas, p, "procedimientos", f);
        if (!fs.existsSync(nuevo)) continue;
        const texto = fs.readFileSync(nuevo, "utf8");
        if (texto !== actual && contiene(texto, actual)) {
          fs.writeFileSync(path.join(dir, f), texto);
          break;
        }
      }
    }
  }

  // ---- Procedimientos y memoria ----

  procedimientos(id: string): Procedimiento[] {
    const dir = path.join(this.dir(id), "procedimientos");
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort().map((f) => {
      const { cabecera, cuerpo } = partir(fs.readFileSync(path.join(dir, f), "utf8"));
      const primera = cuerpo.split("\n").find((l) => l.trim() && !l.startsWith("#")) ?? "";
      return { nombre: f.slice(0, -3), descripcion: cabecera.descripcion || primera.slice(0, 100) };
    });
  }

  // Solo por nombre de la lista: el modelo no puede leer otras rutas.
  leerProcedimiento(id: string, nombre: string): string | null {
    const p = this.procedimientos(id).find((x) => x.nombre === nombre.trim().replace(/\.md$/, ""));
    if (!p) return null;
    const texto = partir(fs.readFileSync(path.join(this.dir(id), "procedimientos", `${p.nombre}.md`), "utf8")).cuerpo;
    return texto.length > MAX_PROCEDIMIENTO ? texto.slice(0, MAX_PROCEDIMIENTO) + "\n[… recortado …]" : texto;
  }

  recordar(id: string, texto: string): string {
    const nota = texto.replace(/\s+/g, " ").trim().slice(0, 300);
    if (!nota) return "no hay nada que recordar";
    fs.appendFileSync(path.join(this.dir(id), "memoria.md"), `- ${new Date().toISOString().slice(0, 10)}: ${nota}\n`);
    return `guardado en tu memoria: ${nota}`;
  }

  // Las notas más recientes que caben en el tope (líneas enteras).
  memoria(id: string): string {
    let texto = "";
    try {
      texto = fs.readFileSync(path.join(this.dir(id), "memoria.md"), "utf8");
    } catch {
      return "";
    }
    const lineas = texto.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
    const elegidas: string[] = [];
    let total = 0;
    for (let i = lineas.length - 1; i >= 0 && total + lineas[i].length <= MAX_MEMORIA; i--) {
      elegidas.unshift(lineas[i]);
      total += lineas[i].length + 1;
    }
    return elegidas.join("\n");
  }

  // ---- Plantillas (en el repositorio) ----

  listarPlantillas(): { id: string; identidad: Identidad; procedimientos: string[] }[] {
    return fs.readdirSync(this.plantillas).filter((d) => fs.existsSync(path.join(this.plantillas, d, "identidad.md"))).map((d) => ({
      id: d,
      identidad: leerIdentidad(fs.readFileSync(path.join(this.plantillas, d, "identidad.md"), "utf8")),
      procedimientos: fs.existsSync(path.join(this.plantillas, d, "procedimientos"))
        ? fs.readdirSync(path.join(this.plantillas, d, "procedimientos")).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3))
        : [],
    }));
  }

  plantilla(id: string): Identidad | null {
    const f = path.join(this.plantillas, path.basename(id), "identidad.md");
    return fs.existsSync(f) ? leerIdentidad(fs.readFileSync(f, "utf8")) : null;
  }
}

// La parte del prompt propia de cada empleado: va DESPUÉS de la base común (así llama-server reutiliza en
// caché el prefijo común al cambiar de empleado).
export function promptEmpleado(e: Empleado, procedimientos: Procedimiento[], memoria: string, conHerramientas: boolean): string {
  const partes = [`## Tu puesto\nTe llamas ${e.nombre}${e.rol ? `. Rol: ${e.rol}` : ""}.${conHerramientas ? ` Tu carpeta es /home/${e.usuario}.` : ""}`, e.instrucciones];
  if (conHerramientas && procedimientos.length) {
    partes.push(
      "## Procedimientos\nAntes de una tarea de este tipo, léelo con leer_procedimiento y sigue sus pasos y su formato:\n" +
        procedimientos.map((p) => `- ${p.nombre}: ${p.descripcion}`).join("\n"),
    );
  }
  if (memoria) partes.push(`## Tu memoria (notas tuyas de otras conversaciones)\n${memoria}`);
  return partes.filter(Boolean).join("\n\n");
}
