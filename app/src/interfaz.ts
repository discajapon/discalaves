// Conversación con el único empleado por ahora: qwen, servido por llama-server local (ver main.ts).

interface MensajeChat { de: "yo" | "qwen"; texto: string; t: number }
type EstadoQwen = { fase: "cargando" | "listo" | "escribiendo" } | { fase: "error"; detalle: string };
declare const discalaves: {
  historial(): Promise<MensajeChat[]>;
  estado(): Promise<EstadoQwen>;
  enviar(texto: string): Promise<{ error?: string }>;
  alCambiarEstado(f: (e: EstadoQwen) => void): void;
  alRecibirTrozo(f: (t: string) => void): void;
};

const CONTACTO = { nombre: "qwen", acento: "violeta" };
const GLIFO_QWEN = '<path d="M5 5h14v10H10l-5 4z"/>';
const TEXTO_ESTADO: Record<EstadoQwen["fase"], string> = {
  cargando: "cargando el modelo…",
  listo: "en línea · local",
  escribiendo: "escribiendo…",
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
  const vista = estadoQwen.fase === "escribiendo" ? "escribiendo…" : ultimo ? (ultimo.de === "yo" ? "tú: " : "") + ultimo.texto : "sin mensajes";
  cuerpo.append(arriba, crear("span", "vista", vista));
  fila.append(avatarQwen(), cuerpo);
  document.getElementById("lista")!.replaceChildren(fila);
}

function burbuja(de: MensajeChat["de"], texto: string): HTMLElement {
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
    hilo.append(burbuja(m.de, m.texto));
    anterior = m.t;
  }
  hilo.scrollTop = hilo.scrollHeight;
}

function dibujarEstado() {
  const el = document.getElementById("cab-estado")!;
  el.textContent = estadoQwen.fase === "error" ? `${TEXTO_ESTADO.error}: ${estadoQwen.detalle}` : TEXTO_ESTADO[estadoQwen.fase];
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
  const respuesta = burbuja("qwen", "");
  burbujaEnCurso = respuesta.querySelector("p")!;
  burbujaEnCurso.classList.add("pensando");
  hilo.append(respuesta);
  hilo.scrollTop = hilo.scrollHeight;

  const { error } = await discalaves.enviar(texto);
  burbujaEnCurso = null;
  await recargar();
  if (error) aviso(error);
  entrada.focus();
});

document.getElementById("cab-avatar")!.replaceChildren(avatarQwen());
document.getElementById("cab-nombre")!.textContent = CONTACTO.nombre;
entrada.placeholder = `Mensaje a ${CONTACTO.nombre}`;
discalaves.estado().then((e) => {
  estadoQwen = e;
  dibujarEstado();
});
recargar();
