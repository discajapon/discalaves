// Conversaciones con las IAs: qwen (llama-server local) y los modelos de Ollama (ver main.ts).

type MensajeChat =
  | { de: "yo" | "ia"; texto: string; t: number }
  | { de: "herramienta"; nombre: string; argumentos: string; salida: string; codigo: number; t: number };
type EstadoQwen =
  | { fase: "cargando" | "listo" | "escribiendo" }
  | { fase: "ejecutando" | "esperando-aprobacion" | "error"; detalle: string };
interface Conversacion {
  id: string; nombre: string; proveedor: "qwen" | "ollama"; modelo: string; herramientas: boolean; libre?: boolean;
  estado: EstadoQwen; ultimo?: MensajeChat;
}
interface Modelo { proveedor: "qwen" | "ollama"; modelo: string; detalle: string; herramientas: boolean }
declare const discalaves: {
  conversaciones(): Promise<Conversacion[]>;
  modelos(): Promise<{ modelos: Modelo[]; ollama: boolean }>;
  nuevaConversacion(proveedor: string, modelo: string): Promise<{ id?: string; error?: string }>;
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
  a.style.setProperty("--acento", `var(--acento-${ACENTOS[conversaciones.indexOf(c) % ACENTOS.length]})`);
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

// Cambia la intensidad de un filtro de ondas (su feDisplacementMap) fotograma a fotograma: forma(t) va de 0 a 1.
function ondular(filtro: string, maximo: number, duracion: number, forma: (t: number) => number): Promise<void> {
  const mapa = document.querySelector(`#${filtro} feDisplacementMap`)!;
  const inicio = performance.now();
  return new Promise((listo) => {
    const paso = (ahora: number) => {
      const t = Math.min(1, (ahora - inicio) / duracion);
      mapa.setAttribute("scale", String(maximo * forma(t)));
      if (t < 1) requestAnimationFrame(paso);
      else listo();
    };
    requestAnimationFrame(paso);
  });
}

function moverLente(filas: HTMLElement[]) {
  const i = conversaciones.findIndex((c) => c.id === activa);
  const fila = filas[i];
  if (!fila) return;
  const destino = `translateY(${fila.offsetTop}px)`;
  lente.style.height = `${fila.offsetHeight}px`;
  if (indiceLente >= 0 && i !== indiceLente && !sinMovimiento.matches) {
    // Se licúa antes de salir (se recoge y se vuelve ondulada), viaja estirada como una gota y se asienta
    // con un pequeño rebote; las ondas deforman las filas de debajo y se calman al llegar.
    const origen = lente.style.transform || destino;
    const mitad = (filas[indiceLente]?.offsetTop ?? fila.offsetTop) / 2 + fila.offsetTop / 2;
    const duracion = 640;
    // La fila que deja y la que recibe se ondulan (la lente pasa por debajo de las filas).
    const implicadas = [filas[indiceLente], fila].filter(Boolean);
    implicadas.forEach((f) => f.classList.add("licuando"));
    const viaje = lente.animate(
      [
        { transform: origen, easing: "ease-in-out" }, // se recoge, ya licuada
        { transform: `${origen} scale(1.05, 0.8)`, offset: 0.2, easing: "ease-in" },
        { transform: `translateY(${mitad}px) scale(0.93, 1.4)`, offset: 0.52, easing: "ease-out" }, // viaja estirada
        { transform: `${destino} scale(1.03, 0.9)`, offset: 0.84, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" }, // rebota
        { transform: destino },
      ],
      { duration: duracion },
    );
    void ondular("lente-liquida", 30, duracion, (t) => Math.sin(Math.PI * Math.min(1, t * 1.15)));
    viaje.finished.catch(() => {}).finally(() => implicadas.forEach((f) => f.classList.remove("licuando")));
  }
  lente.style.transform = destino;
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
    const vista = ocupado ? TEXTO_ESTADO[c.estado.fase] + "…" : ultimo ? (ultimo.de === "yo" ? "tú: " : "") + resumen(ultimo) : "sin mensajes";
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
    return a.comando ?? a.ruta ?? a.consulta ?? a.url ?? a.texto ?? "";
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
  dibujarModoLibre();
  // Cada IA tiene su computadora: si la pantalla está abierta, pasa a mostrar la de esta conversación.
  if (!pantalla.hidden) void mostrarPantalla(c.herramientas);
  dibujarEstado();
}

async function recargar() {
  mensajes = await discalaves.historial(activa);
  dibujarLista();
  dibujarHilo();
}

async function seleccionar(id: string) {
  const antes = conversaciones.findIndex((c) => c.id === activa);
  conversaciones = await discalaves.conversaciones();
  activa = conversaciones.some((c) => c.id === id) ? id : conversaciones[0].id;
  const despues = conversaciones.findIndex((c) => c.id === activa);
  try {
    localStorage.setItem(CLAVE_ACTIVA, activa);
  } catch {
    // sin almacenamiento: se abrirá qwen la próxima vez
  }
  burbujaEnCurso = null;
  dibujarCabecera();
  await recargar();
  // El hilo entra desde la dirección en que se movió la selección: desde abajo si la nueva IA está más abajo.
  if (antes >= 0 && antes !== despues && !sinMovimiento.matches) {
    // Entra ondulado, como a través de agua, y se asienta.
    const desde = despues > antes ? 28 : -28;
    hilo.classList.add("licuando");
    hilo.animate(
      [{ transform: `translateY(${desde}px)`, opacity: 0 }, { transform: "none", opacity: 1 }],
      { duration: 460, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    void ondular("ondas", 60, 460, (t) => (1 - t) ** 2).then(() => hilo.classList.remove("licuando"));
  }
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

// ---- Menú del +: IAs instaladas (qwen incluido y los modelos de Ollama) ----
const menuIA = document.getElementById("menu-ia")!;

function opcionIA(m: Modelo): HTMLElement {
  const b = crear("button", "opcion-ia");
  b.setAttribute("type", "button");
  const nombre = m.proveedor === "qwen" ? "qwen" : m.modelo.replace(/:latest$/, "");
  const abierta = conversaciones.some((c) => c.proveedor === m.proveedor && (c.proveedor === "qwen" || c.modelo === m.modelo));
  const arriba = crear("span", "fila-arriba");
  arriba.append(crear("span", "nombre", nombre), crear("span", "detalle", abierta ? "abierta" : ""));
  b.append(arriba, crear("span", "detalle", m.detalle));
  if (!m.herramientas) b.append(crear("strong", "solo-chat", "solo chat: sin navegador, terminal ni archivos"));
  b.addEventListener("click", async () => {
    const r = await discalaves.nuevaConversacion(m.proveedor, m.modelo);
    menuIA.hidePopover();
    if (r.error) return aviso(r.error);
    await seleccionar(r.id!);
  });
  return b;
}

async function llenarMenuIA() {
  menuIA.replaceChildren(crear("p", "detalle", "buscando modelos…"));
  const { modelos, ollama } = await discalaves.modelos();
  const incluidos = modelos.filter((m) => m.proveedor === "qwen");
  const deOllama = modelos.filter((m) => m.proveedor === "ollama");
  menuIA.replaceChildren(crear("p", "menu-titulo", "incluido"), ...incluidos.map(opcionIA), crear("p", "menu-titulo", "Ollama"));
  if (!ollama) menuIA.append(crear("p", "detalle", "Ollama no responde en este equipo; ¿está en marcha?"));
  else if (!deOllama.length) menuIA.append(crear("p", "detalle", "no hay modelos instalados (ollama pull …)"));
  else menuIA.append(...deOllama.map(opcionIA));
  // Las opciones entran escalonadas (ver .menu-ia > * en estilos.css).
  [...menuIA.children].forEach((el, i) => (el as HTMLElement).style.setProperty("--orden", String(i)));
  menuIA.querySelector("button")?.focus();
}

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

// ---- Pantalla en vivo: el escritorio de su computadora (KasmVNC), solo mientras está abierta ----
const panel = document.querySelector(".panel")!;
const pantalla = document.getElementById("pantalla")!;
const vnc = document.getElementById("pantalla-vnc") as HTMLIFrameElement;
const botonVer = document.getElementById("ver-pantalla")!;
const botonControl = document.getElementById("tomar-control")!;
const textoPantalla = document.getElementById("pantalla-url")!;

// Quitar el iframe corta la conexión: sin panel abierto no hay transmisión.
function mostrarEn(url?: string) {
  vnc.src = url ?? "about:blank";
}

async function mostrarPantalla(ver: boolean) {
  pantalla.hidden = !ver;
  panel.classList.toggle("viendo", ver);
  botonVer.setAttribute("aria-pressed", String(ver));
  marcarControl(false);
  mostrarEn(); // no mostrar el escritorio de otra IA mientras llega el nuevo
  vnc.title = `Escritorio de ${actual().nombre} en vivo`;
  pantalla.setAttribute("aria-label", `Pantalla de ${actual().nombre}`);
  textoPantalla.textContent = `encendiendo la computadora de ${actual().nombre}…`;
  const { url, error } = await discalaves.verPantalla(activa, ver);
  if (error) {
    aviso(`no pude abrir su pantalla: ${error}`);
    return mostrarPantalla(false);
  }
  if (ver && url && !pantalla.hidden) {
    mostrarEn(url);
    textoPantalla.textContent = `escritorio de ${actual().nombre} · solo ver`;
  }
}

function marcarControl(activo: boolean) {
  botonControl.setAttribute("aria-pressed", String(activo));
  botonControl.textContent = activo ? "devolver el control" : "tomar el control";
  pantalla.classList.toggle("controlando", activo);
}

// Tomar el control vuelve a conectar con el usuario de KasmVNC que puede usar teclado y ratón.
async function controlar(activo: boolean) {
  marcarControl(activo);
  const { url } = await discalaves.controlPantalla(activa, activo);
  if (!url) return;
  mostrarEn(url);
  textoPantalla.textContent = `escritorio de ${actual().nombre} · ${activo ? "tienes el control" : "solo ver"}`;
  if (activo) vnc.focus();
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

void seleccionar(activa);
