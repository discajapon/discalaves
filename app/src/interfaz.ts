// Conversación con el único empleado por ahora: qwen, servido por llama-server local (ver main.ts).

type MensajeChat =
  | { de: "yo" | "qwen"; texto: string; t: number }
  | { de: "herramienta"; nombre: string; argumentos: string; salida: string; codigo: number; t: number };
type EstadoQwen =
  | { fase: "cargando" | "listo" | "escribiendo" }
  | { fase: "ejecutando" | "esperando-clave" | "esperando-aprobacion" | "error"; detalle: string };
interface Fotograma { datos: string; ancho: number; alto: number; url: string }
declare const discalaves: {
  historial(): Promise<MensajeChat[]>;
  estado(): Promise<EstadoQwen>;
  enviar(texto: string): Promise<{ error?: string }>;
  alCambiarEstado(f: (e: EstadoQwen) => void): void;
  alRecibirTrozo(f: (t: string) => void): void;
  alPaso(f: () => void): void;
  aprobar(id: string, si: boolean): Promise<void>;
  alAprobacion(f: (p: { id: string; descripcion: string }) => void): void;
  verPantalla(ver: boolean): Promise<{ error?: string }>;
  controlPantalla(activo: boolean): Promise<void>;
  entradaPantalla(e: object): Promise<void>;
  alFotograma(f: (f: Fotograma) => void): void;
};

const CONTACTO = { nombre: "qwen", acento: "violeta" };
const GLIFO_QWEN = '<path d="M5 5h14v10H10l-5 4z"/>';
const TEXTO_ESTADO: Record<EstadoQwen["fase"], string> = {
  cargando: "cargando el modelo…",
  listo: "en línea · local",
  escribiendo: "escribiendo…",
  ejecutando: "ejecutando",
  "esperando-clave": "esperando tu contraseña para",
  "esperando-aprobacion": "esperando tu aprobación para",
  error: "sin conexión",
};

let mensajes: MensajeChat[] = [];
let estadoQwen: EstadoQwen = { fase: "cargando" };
let burbujaEnCurso: HTMLElement | null = null;

const hilo = document.getElementById("hilo")!;
const entrada = document.getElementById("entrada") as HTMLInputElement;

function crear(etiqueta: string, clase = "", texto = ""): HTMLElement {
  const el = document.createElement(etiqueta);
  if (clase) el.className = clase;
  if (texto) el.textContent = texto;
  return el;
}

function avatarQwen(): HTMLElement {
  const grupo = crear("span", "avatares");
  const a = crear("span", "avatar");
  a.style.setProperty("--acento", `var(--acento-${CONTACTO.acento})`);
  a.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${GLIFO_QWEN}</svg>`;
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
  const ultimo = mensajes.at(-1);
  const fila = crear("button", "fila");
  fila.setAttribute("aria-current", "true");
  const cuerpo = crear("span", "fila-cuerpo");
  const arriba = crear("span", "fila-arriba");
  arriba.append(crear("span", "nombre", CONTACTO.nombre), crear("span", "hora", ultimo ? horaCorta(ultimo.t) : ""));
  const ocupado = !["listo", "cargando", "error"].includes(estadoQwen.fase);
  const vista = ocupado ? TEXTO_ESTADO[estadoQwen.fase] + "…" : ultimo ? (ultimo.de === "yo" ? "tú: " : "") + resumen(ultimo) : "sin mensajes";
  cuerpo.append(arriba, crear("span", "vista", vista));
  fila.append(avatarQwen(), cuerpo);
  document.getElementById("lista")!.replaceChildren(fila);
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

function burbuja(de: "yo" | "qwen", texto: string): HTMLElement {
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
  if (!mensajes.length) hilo.append(crear("p", "separador", "escríbele a qwen para empezar. corre en tu computadora: nada sale de ella."));
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
  const el = document.getElementById("cab-estado")!;
  el.textContent = "detalle" in estadoQwen ? `${TEXTO_ESTADO[estadoQwen.fase]}: ${estadoQwen.detalle}` : TEXTO_ESTADO[estadoQwen.fase];
  el.dataset.fase = estadoQwen.fase;
  (document.getElementById("enviar") as HTMLButtonElement).disabled = estadoQwen.fase !== "listo";
}

async function recargar() {
  mensajes = await discalaves.historial();
  dibujarLista();
  dibujarHilo();
}

discalaves.alCambiarEstado((e) => {
  estadoQwen = e;
  dibujarEstado();
  dibujarLista();
});

function burbujaPendiente() {
  const respuesta = burbuja("qwen", "");
  burbujaEnCurso = respuesta.querySelector("p")!;
  burbujaEnCurso.classList.add("pensando");
  hilo.append(respuesta);
  hilo.scrollTop = hilo.scrollHeight;
}

// Tras cada ronda de herramientas: se redibuja lo guardado y se abre otra burbuja para lo que siga.
discalaves.alPaso(async () => {
  await recargar();
  burbujaPendiente();
});

discalaves.alRecibirTrozo((t) => {
  if (!burbujaEnCurso) return;
  burbujaEnCurso.classList.remove("pensando");
  burbujaEnCurso.textContent += t;
  hilo.scrollTop = hilo.scrollHeight;
});

document.getElementById("redactor")!.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const texto = entrada.value.trim();
  if (!texto || estadoQwen.fase !== "listo") return;
  entrada.value = "";
  hilo.append(burbuja("yo", texto));
  burbujaPendiente();

  const { error } = await discalaves.enviar(texto);
  burbujaEnCurso = null;
  await recargar();
  if (error) aviso(error);
  entrada.focus();
});

// Acción delicada: qwen espera a que el usuario la permita o la rechace.
discalaves.alAprobacion(({ id, descripcion }) => {
  const fila = crear("div", "mensaje");
  const t = crear("div", "burbuja aprobacion");
  t.append(crear("p", "", "qwen quiere "), crear("strong", "", descripcion));
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

document.getElementById("cab-avatar")!.replaceChildren(avatarQwen());
document.getElementById("cab-nombre")!.textContent = CONTACTO.nombre;
entrada.placeholder = `Mensaje a ${CONTACTO.nombre}`;
discalaves.estado().then((e) => {
  estadoQwen = e;
  dibujarEstado();
});
recargar();
