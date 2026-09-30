// Conversaciones con los empleados: cada uno con su perfil (ver empleados.ts) y su modelo, qwen (llama-server
// local) o uno de Ollama (ver main.ts).

type MensajeChat =
  | { de: "yo" | "ia"; texto: string; t: number }
  | { de: "herramienta"; nombre: string; argumentos: string; salida: string; codigo: number; t: number };
type EstadoQwen =
  | { fase: "cargando" | "listo" | "escribiendo" }
  | { fase: "ejecutando" | "esperando-aprobacion" | "error"; detalle: string };
interface Conversacion {
  id: string; nombre: string; rol: string; color: string; proveedor: "qwen" | "ollama"; modelo: string; herramientas: boolean; libre?: boolean;
  estado: EstadoQwen; ultimo?: MensajeChat;
}
interface Modelo { proveedor: "qwen" | "ollama"; modelo: string; detalle: string; herramientas: boolean }
interface Identidad { nombre: string; rol: string; color: string; modelo: string; herramientas: string[]; instrucciones: string }
interface Plantilla extends Identidad { id: string; procedimientos: string[] }
declare const discalaves: {
  conversaciones(): Promise<Conversacion[]>;
  modelos(): Promise<{ modelos: Modelo[]; ollama: boolean }>;
  plantillas(): Promise<Plantilla[]>;
  empleado(id: string): Promise<(Identidad & { procedimientos: { nombre: string; descripcion: string }[] }) | undefined>;
  crearEmpleado(datos: Identidad, plantilla?: string): Promise<{ id?: string; error?: string }>;
  guardarEmpleado(id: string, datos: Identidad): Promise<{ error?: string }>;
  borradorEmpleado(descripcion: string): Promise<{ borrador?: Identidad; error?: string }>;
  abrirCarpeta(id: string): Promise<void>;
  historial(id: string): Promise<MensajeChat[]>;
  estado(id: string): Promise<EstadoQwen>;
  enviar(id: string, texto: string): Promise<{ error?: string }>;
  detener(id: string): Promise<void>;
  alCambiarEstado(f: (e: { id: string; estado: EstadoQwen }) => void): void;
  alRecibirTrozo(f: (t: { id: string; texto: string }) => void): void;
  alPaso(f: (id: string) => void): void;
  aprobar(id: string, si: boolean): Promise<void>;
  alAprobacion(f: (p: { id: string; conversacion: string; descripcion: string }) => void): void;
  verPantalla(id: string, ver: boolean): Promise<{ url?: string; error?: string }>;
  controlPantalla(id: string, activo: boolean): Promise<{ url?: string }>;
  modoLibre(id: string, activo: boolean): Promise<boolean>;
};

const ACENTOS = ["violeta", "turquesa", "naranja", "azul", "rojizo"];
const GLIFO_IA = '<path d="M5 5h14v10H10l-5 4z"/>';
const CLAVE_ACTIVA = "discalaves.conversacion";
const TEXTO_ESTADO: Record<EstadoQwen["fase"], string> = {
  cargando: "cargando el modelo…",
  listo: "en línea · local",
  escribiendo: "escribiendo…",
  ejecutando: "ejecutando",
  "esperando-aprobacion": "esperando tu aprobación para",
  error: "sin conexión",
};

let conversaciones: Conversacion[] = [];
let activa = (() => {
  try {
    return localStorage.getItem(CLAVE_ACTIVA) ?? "qwen";
  } catch {
    return "qwen";
  }
})();
let mensajes: MensajeChat[] = [];
let burbujaEnCurso: HTMLElement | null = null;

const actual = () => conversaciones.find((c) => c.id === activa) ?? conversaciones[0];

const hilo = document.getElementById("hilo")!;
const entrada = document.getElementById("entrada") as HTMLInputElement;

function crear(etiqueta: string, clase = "", texto = ""): HTMLElement {
  const el = document.createElement(etiqueta);
  if (clase) el.className = clase;
  if (texto) el.textContent = texto;
  return el;
}

function avatarIA(c: Conversacion): HTMLElement {
  const grupo = crear("span", "avatares");
  const a = crear("span", "avatar");
  a.style.setProperty("--acento", `var(--acento-${ACENTOS.includes(c.color) ? c.color : ACENTOS[0]})`);
  a.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${GLIFO_IA}</svg>`;
  grupo.append(a);
  return grupo;
}

const hora = (t: number) => new Date(t).toLocaleTimeString("es", { hour: "numeric", minute: "2-digit" });

function etiquetaDia(t: number): string {
  const dias = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(t).setHours(0, 0, 0, 0)) / 864e5);
  const dia = dias === 0 ? "Hoy" : dias === 1 ? "Ayer" : new Date(t).toLocaleDateString("es", { day: "numeric", month: "short" });
  return `${dia} ${hora(t)}`;
}

function horaCorta(t: number): string {
  const d = new Date(t);
  if (d.toDateString() === new Date().toDateString()) return hora(t);
  return d.toLocaleDateString("es", { day: "numeric", month: "short" });
}

// ---- Selección de la lista: una lente de vidrio que se desliza hasta la IA activa ----
const sinMovimiento = matchMedia("(prefers-reduced-motion: reduce)");
const lente = crear("span", "seleccion");
lente.setAttribute("aria-hidden", "true");
let indiceLente = -1;

// La lente viaja como una gota de vidrio: su borde delantero se adelanta hasta la conversación elegida
// (se estira sobre las filas intermedias, un poco más estrecha), después recoge el borde trasero y se
// asienta con un pequeño rebote. Solo se mueve la lente; las filas y el hilo no se deforman.
function moverLente(filas: HTMLElement[]) {
  const i = conversaciones.findIndex((c) => c.id === activa);
  const fila = filas[i];
  if (!fila) return;
  // Un toque del color de la IA elegida, dentro de la paleta de Discalaves.
  lente.style.setProperty("--acento", `var(--acento-${ACENTOS[i % ACENTOS.length]})`);
  const y1 = fila.offsetTop, h1 = fila.offsetHeight;
  const anterior = filas[indiceLente];
  if (anterior && i !== indiceLente && !sinMovimiento.matches) {
    const y0 = anterior.offsetTop, h0 = anterior.offsetHeight;
    const baja = y1 > y0;
    const estirada = baja ? { y: y0, h: y1 + h1 - y0 } : { y: y1, h: y0 + h0 - y1 };
    lente.animate(
      [
        { transform: `translateY(${y0}px)`, height: `${h0}px`, easing: "cubic-bezier(0.55, 0, 0.35, 1)" },
        { transform: `translateY(${estirada.y}px) scaleX(0.95)`, height: `${estirada.h}px`, offset: 0.45, easing: "cubic-bezier(0.3, 0, 0.25, 1)" },
        { transform: `translateY(${y1 + (baja ? 2 : -2)}px)`, height: `${h1 - 4}px`, offset: 0.8, easing: "ease-out" }, // se aplasta al llegar (sin ensancharse: la lista la recortaría)
        { transform: `translateY(${y1}px)`, height: `${h1}px` },
      ],
      { duration: 520 },
    );
  }
  lente.style.transform = `translateY(${y1}px)`;
  lente.style.height = `${h1}px`;
  indiceLente = i;
}

function dibujarLista() {
  const filas = conversaciones.map((c) => {
    const ultimo = c.id === activa ? mensajes.at(-1) : c.ultimo;
    const fila = crear("button", "fila");
    fila.setAttribute("aria-current", String(c.id === activa));
    const cuerpo = crear("span", "fila-cuerpo");
    const arriba = crear("span", "fila-arriba");
    arriba.append(crear("span", "nombre", c.nombre), crear("span", "hora", ultimo ? horaCorta(ultimo.t) : ""));
    const ocupado = !["listo", "cargando", "error"].includes(c.estado.fase);
    const vista = ocupado ? TEXTO_ESTADO[c.estado.fase] + "…" : c.rol || "sin rol";
    cuerpo.append(arriba, crear("span", "vista", vista));
    fila.append(avatarIA(c), cuerpo);
    fila.addEventListener("click", () => seleccionar(c.id));
    return fila;
  });
  document.getElementById("lista")!.replaceChildren(lente, ...filas); // la misma lente: conserva su posición
  moverLente(filas);
}

function resumen(m: MensajeChat): string {
  return m.de === "herramienta" ? `${m.nombre}: ${descripcion(m)}` : m.texto;
}

function descripcion(m: { nombre: string; argumentos: string }): string {
  try {
    const a = JSON.parse(m.argumentos);
    if (m.nombre === "escribir_en") return `${a.campo}: ${a.texto}${a.enviar ? " ⏎" : ""}`;
    if (m.nombre === "pasar_trabajo") return `${a.empleado}: ${a.tarea}`;
    return a.comando ?? a.ruta ?? a.consulta ?? a.url ?? a.texto ?? a.pregunta ?? "";
  } catch {
    return m.argumentos;
  }
}

// Paso de herramienta: "✓ terminal → comando", con la salida desplegable.
function tarjeta(m: Extract<MensajeChat, { de: "herramienta" }>): HTMLElement {
  const fila = crear("div", "mensaje");
  const d = document.createElement("details");
  d.className = m.codigo === 0 ? "burbuja herramienta" : "burbuja herramienta fallo";
  const s = crear("summary", "", m.codigo === 0 ? "✓ " : "✗ ");
  const sudo = m.nombre === "terminal" && /^\s*sudo\s/.test(descripcion(m));
  s.append(crear("strong", "", sudo ? "sudo" : m.nombre.replace("_", " ")), " → ", crear("code", "", descripcion(m)));
  d.append(s, crear("pre", "", m.salida));
  fila.append(d);
  return fila;
}

function burbuja(de: "yo" | "ia", texto: string): HTMLElement {
  const fila = crear("div", de === "yo" ? "mensaje mio" : "mensaje");
  const b = crear("div", "burbuja");
  // ponytail: del markdown del modelo solo se interpretan las **negritas**; el resto se ve tal cual.
  const p = crear("p");
  texto.split(/\*\*(.+?)\*\*/).forEach((parte, i) => p.append(i % 2 ? crear("strong", "", parte) : parte));
  b.append(p);
  fila.append(b);
  return fila;
}

function aviso(texto: string) {
  hilo.append(crear("p", "separador aviso", texto));
  hilo.scrollTop = hilo.scrollHeight;
}

function dibujarHilo() {
  hilo.replaceChildren();
  const c = actual();
  if (!mensajes.length) {
    const vacio = crear("p", "separador", `escríbele a ${c.nombre} para empezar. corre en tu computadora: nada sale de ella.`);
    if (!c.herramientas) vacio.append(" ", crear("strong", "", "solo chat: no puede navegar, usar la terminal ni crear archivos."));
    hilo.append(vacio);
  }
  let anterior = 0;
  for (const m of mensajes) {
    if (m.t - anterior > 60 * 60 * 1000) hilo.append(crear("p", "separador", etiquetaDia(m.t)));
    if (m.de === "herramienta") hilo.append(tarjeta(m));
    else if (m.texto) hilo.append(burbuja(m.de, m.texto));
    anterior = m.t;
  }
  hilo.scrollTop = hilo.scrollHeight;
}

function dibujarEstado() {
  const c = actual();
  const e = c.estado;
  const el = document.getElementById("cab-estado")!;
  const texto = e.fase === "listo" && c.proveedor === "ollama" ? "en línea · local (Ollama)" : TEXTO_ESTADO[e.fase];
  el.textContent = "detalle" in e ? `${texto}: ${e.detalle}` : texto;
  if (!c.herramientas) el.append(" · ", crear("strong", "", "solo chat"));
  el.dataset.fase = e.fase;
  (document.getElementById("enviar") as HTMLButtonElement).disabled = e.fase !== "listo";
  // Mientras trabaja, el botón de enviar se cambia por el de detener.
  const ocupado = !["listo", "cargando", "error"].includes(e.fase);
  document.getElementById("enviar")!.hidden = ocupado;
  const detener = document.getElementById("detener") as HTMLButtonElement;
  if (detener.hidden === ocupado) detener.disabled = false;
  detener.hidden = !ocupado;
}

function dibujarCabecera() {
  const c = actual();
  document.getElementById("cab-avatar")!.replaceChildren(avatarIA(c));
  document.getElementById("cab-nombre")!.textContent = c.nombre;
  entrada.placeholder = `Mensaje a ${c.nombre}`;
  // Sin herramientas no hay computadora que mirar.
  document.getElementById("ver-pantalla")!.hidden = !c.herramientas;
  document.getElementById("cab-nombre")!.title = c.rol;
  dibujarModoLibre();
  // Cada IA tiene su computadora: si la pantalla está abierta, pasa a mostrar la de esta conversación.
  if (!pantalla.hidden) void mostrarPantalla(c.herramientas);
  else if (c.herramientas) void escritorio(c.id);
  dibujarEstado();
}

async function recargar() {
  mensajes = await discalaves.historial(activa);
  dibujarLista();
  dibujarHilo();
}

async function seleccionar(id: string) {
  conversaciones = await discalaves.conversaciones();
  activa = conversaciones.some((c) => c.id === id) ? id : conversaciones[0].id;
  try {
    localStorage.setItem(CLAVE_ACTIVA, activa);
  } catch {
    // sin almacenamiento: se abrirá qwen la próxima vez
  }
  burbujaEnCurso = null;
  dibujarCabecera();
  await recargar(); // el hilo cambia sin animación: el movimiento está solo en la lista (moverLente)
  // Si está trabajando (varios a la vez), lo que escriba a partir de ahora se ve en su burbuja.
  if (!["listo", "cargando", "error"].includes(actual().estado.fase)) burbujaPendiente();
  entrada.focus();
}

discalaves.alCambiarEstado(({ id, estado }) => {
  const c = conversaciones.find((c) => c.id === id);
  if (!c) return;
  c.estado = estado;
  if (id === activa) dibujarEstado();
  dibujarLista();
});

function burbujaPendiente() {
  const respuesta = burbuja("ia", "");
  burbujaEnCurso = respuesta.querySelector("p")!;
  burbujaEnCurso.classList.add("pensando");
  hilo.append(respuesta);
  hilo.scrollTop = hilo.scrollHeight;
}

// Tras cada ronda de herramientas: se redibuja lo guardado y se abre otra burbuja para lo que siga.
// Si el usuario cambió de conversación, lo que llega de la otra no se dibuja: se verá al volver.
discalaves.alPaso(async (id) => {
  if (id !== activa) return;
  await recargar();
  burbujaPendiente();
});

discalaves.alRecibirTrozo(({ id, texto }) => {
  if (!burbujaEnCurso || id !== activa) return;
  burbujaEnCurso.classList.remove("pensando");
  burbujaEnCurso.textContent += texto;
  hilo.scrollTop = hilo.scrollHeight;
});

document.getElementById("redactor")!.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const texto = entrada.value.trim();
  const id = activa;
  if (!texto || actual().estado.fase !== "listo") return;
  entrada.value = "";
  hilo.append(burbuja("yo", texto));
  burbujaPendiente();

  const { error } = await discalaves.enviar(id, texto);
  if (id !== activa) {
    conversaciones = await discalaves.conversaciones();
    return dibujarLista();
  }
  burbujaEnCurso = null;
  await recargar();
  if (error) aviso(error);
  entrada.focus();
});

// Acción delicada: la IA espera a que el usuario la permita o la rechace. Si la pide otra
// conversación, se cambia a ella para que la tarjeta se vea donde corresponde.
discalaves.alAprobacion(async ({ id, conversacion, descripcion }) => {
  if (conversacion !== activa) await seleccionar(conversacion);
  const nombre = conversaciones.find((c) => c.id === conversacion)?.nombre ?? "la IA";
  const fila = crear("div", "mensaje");
  const t = crear("div", "burbuja aprobacion");
  t.append(crear("p", "", `${nombre} quiere `), crear("strong", "", descripcion));
  const acciones = crear("div", "acciones");
  const responder = (si: boolean) => {
    void discalaves.aprobar(id, si);
    acciones.replaceChildren(crear("span", "decision", si ? "✓ permitido" : "✗ rechazado"));
  };
  const no = crear("button", "boton secundario", "no");
  const si = crear("button", "boton", "permitir");
  no.addEventListener("click", () => responder(false));
  si.addEventListener("click", () => responder(true));
  acciones.append(no, si);
  t.append(acciones);
  fila.append(t);
  hilo.append(fila);
  hilo.scrollTop = hilo.scrollHeight;
  si.focus();
});

document.getElementById("detener")!.addEventListener("click", (ev) => {
  (ev.currentTarget as HTMLButtonElement).disabled = true; // hasta que la tarea termine de pararse
  void discalaves.detener(activa);
});

// ---- Menú del +: nuevo empleado desde una plantilla o describiendo el puesto ----
const menuIA = document.getElementById("menu-ia")!;
const NOMBRES_HERRAMIENTAS: Record<string, string> = {
  terminal: "terminal",
  escribir_archivo: "escribir archivos",
  buscar_web: "buscar en la web",
  abrir_pagina: "abrir páginas",
  ver_pagina: "ver páginas",
  hacer_clic: "hacer clic",
  escribir_en: "escribir en formularios",
};
// Apagadas al principio: el usuario las activa si el puesto las necesita (cada una ocupa contexto del modelo).
const NOMBRES_ADICIONALES: Record<string, string> = {
  leer_archivo: "leer archivos",
  editar_archivo: "editar archivos",
  leer_web: "leer web sin navegador",
  preguntar: "preguntarte",
  pasar_trabajo: "pasar trabajo a otro",
};

// Cada plantilla es una tarjeta tipo widget: ícono y nombre arriba, el rol, y sus datos en negrita.
function tarjetaPlantilla(p: Plantilla): HTMLElement {
  const b = crear("button", "opcion-ia");
  b.setAttribute("type", "button");
  const arriba = crear("span", "tarjeta-arriba");
  const icono = crear("span", "tarjeta-icono");
  icono.style.setProperty("--acento", `var(--acento-${p.color})`);
  icono.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${GLIFO_IA}</svg>`;
  arriba.append(icono, crear("span", "nombre", p.nombre));
  const dato = crear("span", "dato", "herramientas ");
  dato.append(crear("strong", "", String(p.herramientas.length)), " · procedimientos ", crear("strong", "", String(p.procedimientos.length)));
  const terminal = p.herramientas.includes("terminal");
  b.append(arriba, crear("span", "rol-tarjeta", p.rol), dato, crear("span", `estado ${terminal ? "con-computadora" : "sin-terminal"}`, terminal ? "con terminal" : "sin terminal"));
  b.addEventListener("click", () => {
    menuIA.hidePopover();
    void abrirDialogoEmpleado({ modo: "plantilla", plantilla: p });
  });
  return b;
}

function tarjetaAMedida(): HTMLElement {
  const b = crear("button", "opcion-ia");
  b.setAttribute("type", "button");
  const arriba = crear("span", "tarjeta-arriba");
  const icono = crear("span", "tarjeta-icono");
  icono.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l4-1 11-11-3-3L5 16z"/></svg>';
  arriba.append(icono, crear("span", "nombre", "Describir el puesto"));
  b.append(arriba, crear("span", "rol-tarjeta", "cuéntalo con tus palabras y qwen redacta un borrador que revisas"));
  b.addEventListener("click", () => {
    menuIA.hidePopover();
    void abrirDialogoEmpleado({ modo: "describir" });
  });
  return b;
}

async function llenarMenuIA() {
  menuIA.replaceChildren(crear("p", "detalle", "cargando plantillas…"));
  const plantillas = (await discalaves.plantillas()).filter((p) => p.id !== "asistente");
  menuIA.replaceChildren(crear("p", "menu-titulo", "a medida"), tarjetaAMedida(), crear("p", "menu-titulo", "plantillas"), ...plantillas.map(tarjetaPlantilla));
  // Las opciones entran escalonadas (ver .menu-ia > * en estilos.css).
  [...menuIA.children].forEach((el, i) => (el as HTMLElement).style.setProperty("--orden", String(i)));
  menuIA.querySelector("button")?.focus();
}

// ---- Diálogo de empleado: crear (plantilla o descripción) y editar ----
const dialogoEmpleado = document.getElementById("empleado") as HTMLDialogElement;
const formEmpleado = document.getElementById("empleado-form") as HTMLFormElement;
const campo = <T extends HTMLElement>(id: string) => document.getElementById(`empleado-${id}`) as T;
const avisoEmpleado = campo<HTMLElement>("aviso");
let edicion: { modo: "plantilla" | "describir" | "editar"; plantilla?: string; id?: string } = { modo: "describir" };

function rellenar(i: Identidad) {
  campo<HTMLInputElement>("nombre").value = i.nombre;
  campo<HTMLInputElement>("rol").value = i.rol;
  campo<HTMLSelectElement>("color").value = ACENTOS.includes(i.color) ? i.color : ACENTOS[0];
  const modelo = campo<HTMLSelectElement>("modelo");
  if ([...modelo.options].some((o) => o.value === i.modelo)) modelo.value = i.modelo;
  for (const c of campo<HTMLElement>("herramientas").querySelectorAll<HTMLInputElement>("input")) c.checked = i.herramientas.includes(c.value);
  campo<HTMLTextAreaElement>("instrucciones").value = i.instrucciones;
}

function leerFormulario(): Identidad {
  return {
    nombre: campo<HTMLInputElement>("nombre").value,
    rol: campo<HTMLInputElement>("rol").value,
    color: campo<HTMLSelectElement>("color").value,
    modelo: campo<HTMLSelectElement>("modelo").value,
    herramientas: [...campo<HTMLElement>("herramientas").querySelectorAll<HTMLInputElement>("input:checked")].map((c) => c.value),
    instrucciones: campo<HTMLTextAreaElement>("instrucciones").value,
  };
}

async function abrirDialogoEmpleado(d: { modo: "plantilla"; plantilla: Plantilla } | { modo: "describir" } | { modo: "editar"; id: string }) {
  // Opciones fijas (colores, herramientas) y los modelos que haya ahora mismo.
  campo<HTMLSelectElement>("color").replaceChildren(...ACENTOS.map((a) => Object.assign(document.createElement("option"), { value: a, textContent: a })));
  const casillas = (nombres: Record<string, string>) =>
    Object.entries(nombres).map(([valor, texto]) => {
      const l = crear("label", "casilla");
      l.append(Object.assign(document.createElement("input"), { type: "checkbox", value: valor }), ` ${texto}`);
      return l;
    });
  campo<HTMLElement>("herramientas").replaceChildren(
    ...casillas(NOMBRES_HERRAMIENTAS),
    crear("span", "subtitulo", "adicionales: actívalas solo si el puesto las necesita"),
    ...casillas(NOMBRES_ADICIONALES),
  );
  const { modelos } = await discalaves.modelos();
  campo<HTMLSelectElement>("modelo").replaceChildren(
    ...modelos.map((m) =>
      Object.assign(document.createElement("option"), {
        value: m.proveedor === "qwen" ? "qwen" : `ollama:${m.modelo}`,
        textContent: m.proveedor === "qwen" ? "qwen (incluido)" : `${m.modelo.replace(/:latest$/, "")}${m.herramientas ? "" : " — solo chat"}`,
      }),
    ),
  );
  avisoEmpleado.textContent = "";
  campo<HTMLElement>("redactando").textContent = "";
  campo<HTMLElement>("describir").hidden = d.modo !== "describir";
  campo<HTMLTextAreaElement>("descripcion").value = "";
  if (d.modo === "plantilla") {
    edicion = { modo: "plantilla", plantilla: d.plantilla.id };
    campo<HTMLElement>("titulo").textContent = `Nuevo empleado: ${d.plantilla.nombre}`;
    rellenar(d.plantilla);
  } else if (d.modo === "describir") {
    edicion = { modo: "describir" };
    campo<HTMLElement>("titulo").textContent = "Nuevo empleado a medida";
    rellenar({ nombre: "", rol: "", color: ACENTOS[0], modelo: "qwen", herramientas: ["buscar_web", "abrir_pagina", "escribir_archivo"], instrucciones: "" });
  } else {
    const e = await discalaves.empleado(d.id);
    if (!e) return;
    edicion = { modo: "editar", id: d.id };
    campo<HTMLElement>("titulo").textContent = `Perfil de ${e.nombre}`;
    rellenar(e);
  }
  dialogoEmpleado.showModal();
  (d.modo === "describir" ? campo<HTMLTextAreaElement>("descripcion") : campo<HTMLInputElement>("nombre")).focus();
}

campo<HTMLButtonElement>("redactar").addEventListener("click", async (ev) => {
  const boton = ev.currentTarget as HTMLButtonElement;
  const descripcion = campo<HTMLTextAreaElement>("descripcion").value.trim();
  if (!descripcion) return campo<HTMLTextAreaElement>("descripcion").focus();
  boton.disabled = true;
  campo<HTMLElement>("redactando").textContent = "qwen está redactando el borrador…";
  const r = await discalaves.borradorEmpleado(descripcion);
  boton.disabled = false;
  campo<HTMLElement>("redactando").textContent = r.error ?? "borrador listo: revísalo antes de guardar";
  if (r.borrador) rellenar({ ...r.borrador, modelo: campo<HTMLSelectElement>("modelo").value });
});

formEmpleado.addEventListener("submit", async (ev) => {
  if ((ev.submitter as HTMLButtonElement | null)?.value !== "guardar") return; // Cancelar cierra sin más
  ev.preventDefault();
  const datos = leerFormulario();
  const r =
    edicion.modo === "editar"
      ? await discalaves.guardarEmpleado(edicion.id!, datos)
      : await discalaves.crearEmpleado(datos, edicion.plantilla);
  if (r.error) {
    avisoEmpleado.textContent = r.error;
    return;
  }
  dialogoEmpleado.close();
  await seleccionar((r as { id?: string }).id ?? activa);
});

document.getElementById("editar-empleado")!.addEventListener("click", () => abrirDialogoEmpleado({ modo: "editar", id: activa }));
document.getElementById("carpeta-empleado")!.addEventListener("click", () => discalaves.abrirCarpeta(activa));

menuIA.addEventListener("toggle", (ev) => {
  if ((ev as ToggleEvent).newState === "open") void llenarMenuIA();
});
menuIA.addEventListener("keydown", (ev) => {
  if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
  ev.preventDefault();
  const opciones = [...menuIA.querySelectorAll("button")];
  const i = opciones.indexOf(document.activeElement as HTMLButtonElement);
  opciones[(i + (ev.key === "ArrowDown" ? 1 : -1) + opciones.length) % opciones.length]?.focus();
});

// ---- Pantalla en vivo: el escritorio de su computadora (KasmVNC) ----
// Un iframe por empleado, conectado desde que arranca la app y apilados: cambiar de empleado (o abrir el panel)
// solo cambia cuál se ve, sin reconectar (decisión del usuario, 2026-09-30: instantáneo aunque consuma más).
const panel = document.querySelector(".panel")!;
const pantalla = document.getElementById("pantalla")!;
const contenedorVnc = document.getElementById("pantalla-vnc")!;
const botonVer = document.getElementById("ver-pantalla")!;
const botonControl = document.getElementById("tomar-control")!;
const textoPantalla = document.getElementById("pantalla-url")!;
const escritorios = new Map<string, Promise<HTMLIFrameElement | string>>(); // iframe, o el error al encender
let controlado: string | null = null; // empleado cuyo escritorio controla el usuario

function escritorio(id: string) {
  let e = escritorios.get(id);
  if (!e) {
    e = discalaves.verPantalla(id, true).then(({ url, error }) => {
      if (!url) {
        escritorios.delete(id); // se reintenta la próxima vez
        return error ?? "no tiene computadora";
      }
      const f = document.createElement("iframe");
      f.allow = "keyboard-map";
      f.hidden = true;
      f.title = `Escritorio de ${conversaciones.find((c) => c.id === id)?.nombre ?? "la IA"} en vivo`;
      f.src = url;
      contenedorVnc.append(f);
      return f;
    });
    escritorios.set(id, e);
  }
  return e;
}

// Enciende y conecta todos los escritorios en segundo plano, uno tras otro (el primero construye la imagen).
async function precargarEscritorios() {
  for (const c of conversaciones.filter((c) => c.herramientas)) await escritorio(c.id);
}

async function mostrarPantalla(ver: boolean) {
  if (controlado && (!ver || controlado !== activa)) await controlar(false);
  pantalla.hidden = !ver;
  panel.classList.toggle("viendo", ver);
  botonVer.setAttribute("aria-pressed", String(ver));
  if (!ver) return;
  const c = actual();
  pantalla.setAttribute("aria-label", `Pantalla de ${c.nombre}`);
  textoPantalla.textContent = `encendiendo la computadora de ${c.nombre}…`;
  for (const f of contenedorVnc.children) (f as HTMLElement).hidden = true; // nunca el escritorio de otra IA
  const f = await escritorio(c.id);
  if (c.id !== activa || pantalla.hidden) return;
  if (typeof f === "string") {
    aviso(`no pude abrir su pantalla: ${f}`);
    return mostrarPantalla(false);
  }
  f.hidden = false;
  textoPantalla.textContent = `escritorio de ${c.nombre} · solo ver`;
}

function marcarControl(activo: boolean) {
  botonControl.setAttribute("aria-pressed", String(activo));
  botonControl.textContent = activo ? "devolver el control" : "tomar el control";
  pantalla.classList.toggle("controlando", activo);
}

// Tomar el control reconecta ese escritorio con el usuario de KasmVNC que puede usar teclado y ratón.
async function controlar(activo: boolean) {
  const id = activo ? activa : controlado;
  if (!id) return;
  controlado = activo ? id : null;
  marcarControl(activo);
  const [{ url }, f] = await Promise.all([discalaves.controlPantalla(id, activo), escritorio(id)]);
  if (!url || typeof f === "string") return;
  f.src = url;
  if (id === activa) textoPantalla.textContent = `escritorio de ${actual().nombre} · ${activo ? "tienes el control" : "solo ver"}`;
  if (activo) f.focus();
}

const enControl = () => botonControl.getAttribute("aria-pressed") === "true";
botonVer.addEventListener("click", () => mostrarPantalla(pantalla.hidden !== false));
botonControl.addEventListener("click", () => controlar(!enControl()));

// ---- Modo libre: la IA actúa sin pedir aprobación ni preguntar qué hacer (decisión del usuario, por IA) ----
const botonLibre = document.getElementById("modo-libre")!;

function dibujarModoLibre() {
  const c = actual();
  botonLibre.hidden = !c.herramientas;
  botonLibre.setAttribute("aria-checked", String(c.libre === true));
  botonLibre.title = c.libre
    ? `${c.nombre} actúa sin pedir tu aprobación (borrar, enviar, pagar) ni preguntar qué hacer`
    : `activar: ${c.nombre} dejará de pedir tu aprobación y de preguntarte qué hacer`;
}

botonLibre.addEventListener("click", async () => {
  const c = actual();
  c.libre = await discalaves.modoLibre(c.id, !c.libre);
  dibujarModoLibre();
});

void seleccionar(activa).then(precargarEscritorios);
