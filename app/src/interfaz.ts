// Conversaciones con las IAs: qwen (llama-server local) y los modelos de Ollama (ver main.ts).

type MensajeChat =
  | { de: "yo" | "ia"; texto: string; t: number }
  | { de: "herramienta"; nombre: string; argumentos: string; salida: string; codigo: number; t: number };
type EstadoQwen =
  | { fase: "cargando" | "listo" | "escribiendo" }
  | { fase: "ejecutando" | "esperando-clave" | "esperando-aprobacion" | "error"; detalle: string };
interface Fotograma { datos: string; ancho: number; alto: number; url: string }
interface Conversacion {
  id: string; nombre: string; proveedor: "qwen" | "ollama"; modelo: string; herramientas: boolean;
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
  alCambiarEstado(f: (e: { id: string; estado: EstadoQwen }) => void): void;
  alRecibirTrozo(f: (t: { id: string; texto: string }) => void): void;
  alPaso(f: (id: string) => void): void;
  aprobar(id: string, si: boolean): Promise<void>;
  alAprobacion(f: (p: { id: string; conversacion: string; descripcion: string }) => void): void;
  verPantalla(ver: boolean): Promise<{ error?: string }>;
  controlPantalla(activo: boolean): Promise<void>;
  entradaPantalla(e: object): Promise<void>;
  alFotograma(f: (f: Fotograma) => void): void;
};

const ACENTOS = ["violeta", "turquesa", "naranja", "azul", "rojizo"];
const GLIFO_IA = '<path d="M5 5h14v10H10l-5 4z"/>';
const CLAVE_ACTIVA = "discalaves.conversacion";
const TEXTO_ESTADO: Record<EstadoQwen["fase"], string> = {
  cargando: "cargando el modelo…",
  listo: "en línea · local",
  escribiendo: "escribiendo…",
  ejecutando: "ejecutando",
  "esperando-clave": "esperando tu contraseña para",
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
  document.getElementById("lista")!.replaceChildren(...filas);
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
}

function dibujarCabecera() {
  const c = actual();
  document.getElementById("cab-avatar")!.replaceChildren(avatarIA(c));
  document.getElementById("cab-nombre")!.textContent = c.nombre;
  entrada.placeholder = `Mensaje a ${c.nombre}`;
  // Sin herramientas no hay computadora que mirar.
  document.getElementById("ver-pantalla")!.hidden = !c.herramientas;
  if (!c.herramientas && !pantalla.hidden) void mostrarPantalla(false);
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
  await recargar();
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

// ---- Pantalla en vivo: solo se transmite mientras está abierta ----
const panel = document.querySelector(".panel")!;
const pantalla = document.getElementById("pantalla")!;
const imgPantalla = document.getElementById("pantalla-img") as HTMLImageElement;
const botonVer = document.getElementById("ver-pantalla")!;
const botonControl = document.getElementById("tomar-control")!;
let tamPagina = { ancho: 1280, alto: 800 };

discalaves.alFotograma((f) => {
  if (pantalla.hidden) return;
  tamPagina = { ancho: f.ancho, alto: f.alto };
  imgPantalla.src = `data:image/jpeg;base64,${f.datos}`;
  document.getElementById("pantalla-url")!.textContent = f.url === "about:blank" ? "qwen todavía no abrió ninguna página" : f.url;
});

async function mostrarPantalla(ver: boolean) {
  pantalla.hidden = !ver;
  panel.classList.toggle("viendo", ver);
  botonVer.setAttribute("aria-pressed", String(ver));
  if (!ver) controlar(false);
  const { error } = await discalaves.verPantalla(ver);
  if (error) {
    aviso(`no pude abrir su pantalla: ${error}`);
    mostrarPantalla(false);
  }
}

function controlar(activo: boolean) {
  void discalaves.controlPantalla(activo);
  botonControl.setAttribute("aria-pressed", String(activo));
  botonControl.textContent = activo ? "devolver el control" : "tomar el control";
  imgPantalla.classList.toggle("controlando", activo);
  if (activo) imgPantalla.focus();
}

// Posición del ratón sobre la imgPantalla (object-fit: contain) → píxeles de la página.
function aPagina(ev: MouseEvent) {
  const r = imgPantalla.getBoundingClientRect();
  const escalaImg = Math.min(r.width / tamPagina.ancho, r.height / tamPagina.alto);
  const x = (ev.clientX - r.left - (r.width - tamPagina.ancho * escalaImg) / 2) / escalaImg;
  const y = (ev.clientY - r.top - (r.height - tamPagina.alto * escalaImg) / 2) / escalaImg;
  return x >= 0 && y >= 0 && x <= tamPagina.ancho && y <= tamPagina.alto ? { x, y } : null;
}

const enControl = () => botonControl.getAttribute("aria-pressed") === "true";
botonVer.addEventListener("click", () => mostrarPantalla(pantalla.hidden !== false));
botonControl.addEventListener("click", () => controlar(!enControl()));
imgPantalla.addEventListener("click", (ev) => {
  const p = enControl() && aPagina(ev);
  if (p) void discalaves.entradaPantalla({ tipo: "clic", ...p });
});
imgPantalla.addEventListener("wheel", (ev) => {
  if (!enControl()) return;
  ev.preventDefault();
  void discalaves.entradaPantalla({ tipo: "rueda", dy: ev.deltaY });
});
imgPantalla.addEventListener("keydown", (ev) => {
  if (!enControl() || ev.key === "Dead") return;
  ev.preventDefault();
  const tecla = ev.key === " " ? "Space" : ev.key;
  const mods = [ev.ctrlKey && "Control", ev.altKey && "Alt", ev.metaKey && "Meta"].filter(Boolean).join("+");
  void discalaves.entradaPantalla({ tipo: "tecla", tecla: mods ? `${mods}+${tecla}` : tecla });
});

void seleccionar(activa);
