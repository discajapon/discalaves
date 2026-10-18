// Uso del escritorio con capturas (como computer use): la app captura la pantalla del contenedor, el modelo ve
// la imagen reescalada y responde con una acción por coordenadas, y aquí se inyecta como evento real de ratón o
// teclado en el servidor X de KasmVNC (xwd y xdotool dentro de su computadora, como su usuario, sin privilegios).
// Las coordenadas del modelo van de 0 a 1000 sobre la imagen que vio: Qwen 3.5 responde así de forma nativa
// (medido 2026-10-17: el mismo botón da el mismo número en imágenes de 1024 y de 1280 de ancho). El mapeo a
// píxeles de la pantalla real lo hace la app (aPantalla), nunca el modelo.
import type { Computadora } from "./computadora";

export const ANCHO_IMAGEN = 1024; // ancho de las capturas que ve el modelo (~1120 tokens con Qwen 3.5 y --image-min-tokens 1024)
const ESPERA = 600; // ms para que la pantalla se asiente tras una acción, antes de la captura nueva
// Tras una acción, la captura nueva se toma en cuanto la pantalla está quieta (dos capturas seguidas iguales, cada
// ~0,1 s): si cambió, enseguida; si no cambió nada, a los ~0,4 s; si sigue moviéndose, como mucho ~1,2 s (una app
// que tarda en abrir: para eso está esperar). Antes era una espera fija de 600 ms y tres llamadas a la computadora.
const ACTUAR = [
  'f=/tmp/.discalaves-captura.$$',
  'xwd -root -silent > "$f" 2>/dev/null; antes=$(cksum < "$f")',
  'xdotool "$@" 2> "$f.err" || { cat "$f.err"; rm -f "$f" "$f.err"; exit 3; }',
  'previa=$antes; i=0',
  'while [ $i -lt 8 ]; do',
  '  sleep 0.1; xwd -root -silent > "$f" 2>/dev/null; ahora=$(cksum < "$f"); i=$((i+1))',
  '  [ "$ahora" = "$previa" ] && { [ "$ahora" != "$antes" ] || [ $i -ge 3 ]; } && break',
  '  previa=$ahora',
  'done',
  'base64 -w0 "$f"; rm -f "$f" "$f.err"',
].join("\n");
const PASOS = 8; // pasos del movimiento suave del ratón (se ve en vivo, no salta)
const ENTRE_PASOS = 0.015; // s entre pasos: ~120 ms, que se descuentan de ESPERA (no retrasa al empleado)

// Región de la pantalla real que muestra la última imagen: la pantalla entera o la zona ampliada.
export interface Vista { x: number; y: number; ancho: number; alto: number }
export interface Captura { jpeg: Buffer; ancho: number; alto: number; vista: Vista }

// Coordenadas del modelo (0–1000 sobre la imagen que vio) → píxel de la pantalla real.
export function aPantalla(nx: number, ny: number, v: Vista): { x: number; y: number } {
  const una = (n: number, origen: number, largo: number) => origen + Math.min(largo - 1, Math.max(0, Math.floor((n / 1000) * largo)));
  return { x: una(nx, v.x, v.ancho), y: una(ny, v.y, v.alto) };
}

// Al revés (píxel real → 0–1000 de la imagen): para marcar el punto en la tarjeta de aprobación y en las pruebas.
export function aNormal(px: number, py: number, v: Vista): { x: number; y: number } {
  return { x: ((px - v.x + 0.5) / v.ancho) * 1000, y: ((py - v.y + 0.5) / v.alto) * 1000 };
}

// Tamaño de la imagen para el modelo: 1024 de ancho con la proporción de la región (una zona pequeña se amplía).
export function tamanoImagen(ancho: number, alto: number) {
  return { ancho: ANCHO_IMAGEN, alto: Math.max(1, Math.round((alto * ANCHO_IMAGEN) / ancho)) };
}

// Región en coordenadas 0–1000 de la vista actual → región de la pantalla real (al menos 16 px por lado).
export function region(x1: number, y1: number, x2: number, y2: number, v: Vista): Vista {
  const a = aPantalla(Math.min(x1, x2), Math.min(y1, y2), v);
  const b = aPantalla(Math.max(x1, x2), Math.max(y1, y2), v);
  const ancho = Math.max(16, b.x - a.x + 1), alto = Math.max(16, b.y - a.y + 1);
  return { x: Math.min(a.x, v.x + v.ancho - ancho), y: Math.min(a.y, v.y + v.alto - alto), ancho: Math.min(ancho, v.ancho), alto: Math.min(alto, v.alto) };
}

// Volcado de xwd (formato XWD de X11, ZPixmap): píxeles en BGRA, lo que espera nativeImage.createFromBitmap.
export function leerXwd(b: Buffer): { ancho: number; alto: number; bgra: Buffer } {
  const campo = (i: number) => b.readUInt32BE(i * 4); // la cabecera va siempre en big-endian
  const [tamCabecera, formato, ancho, alto, ordenBytes, bitsPixel, bytesLinea] = [campo(0), campo(2), campo(4), campo(5), campo(7), campo(11), campo(12)];
  const [rojo, verde, azul, colores] = [campo(14), campo(15), campo(16), campo(19)];
  // Xvnc no siempre da lo mismo: 32 bits por píxel al arrancar y, con la sesión XFCE (visual DirectColor), 24 bits
  // empaquetados en 3 bytes con líneas más largas de lo necesario (visto 2026-10-17). Leer 4 bytes por píxel ahí
  // dejaba la imagen encogida al 75 % y con colores corridos. ponytail: se supone el mapa de colores identidad de
  // DirectColor (el de Xvnc); con otro mapa los colores saldrían cambiados.
  const bytesPixel = bitsPixel / 8;
  if (formato !== 2 || (bitsPixel !== 24 && bitsPixel !== 32) || bytesLinea < ancho * bytesPixel) throw new Error(`captura en un formato que no sé leer (formato ${formato}, ${bitsPixel} bits por píxel)`);
  const bajo = (m: number) => 31 - Math.clz32(m & -m); // primer bit de la máscara
  const [dr, dg, db] = [bajo(rojo), bajo(verde), bajo(azul)];
  const inicio = tamCabecera + colores * 12;
  const bgra = Buffer.alloc(ancho * alto * 4);
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const i = inicio + y * bytesLinea + x * bytesPixel;
      const p = ordenBytes === 0 ? b.readUIntLE(i, bytesPixel) : b.readUIntBE(i, bytesPixel);
      const o = (y * ancho + x) * 4;
      bgra[o] = (p & azul) >>> db;
      bgra[o + 1] = (p & verde) >>> dg;
      bgra[o + 2] = (p & rojo) >>> dr;
      bgra[o + 3] = 255;
    }
  }
  return { ancho, alto, bgra };
}

// Teclas como las escribe el modelo ("ctrl+s", "Intro", "flecha abajo") → nombres de xdotool.
const TECLAS: Record<string, string> = {
  enter: "Return", intro: "Return", return: "Return", esc: "Escape", escape: "Escape", escapar: "Escape", tab: "Tab", tabulador: "Tab",
  retroceso: "BackSpace", backspace: "BackSpace", borrar: "BackSpace", supr: "Delete", suprimir: "Delete", delete: "Delete", del: "Delete",
  espacio: "space", space: "space", inicio: "Home", home: "Home", fin: "End", end: "End", repag: "Prior", pageup: "Prior", avpag: "Next", pagedown: "Next",
  arriba: "Up", up: "Up", abajo: "Down", down: "Down", izquierda: "Left", left: "Left", derecha: "Right", right: "Right",
  ctrl: "ctrl", control: "ctrl", alt: "alt", shift: "shift", mayus: "shift", "mayús": "shift", super: "super", win: "super", windows: "super", meta: "super",
};
export function teclas(texto: string): string[] {
  return texto
    .split(/\s+(?![^+]*\+)|,\s*/) // combinaciones separadas por espacios o comas: "ctrl+a Delete"
    .map((combo) => combo.trim().replace(/^flecha\s*/i, ""))
    .filter(Boolean)
    .map((combo) => combo.split("+").map((t) => TECLAS[t.trim().toLowerCase()] ?? (t.trim().length === 1 ? t.trim().toLowerCase() : t.trim())).join("+"));
}

// Pasos intermedios del movimiento suave (sin incluir el origen): se ve en vivo cómo va el ratón.
export function trayecto(desde: { x: number; y: number }, hasta: { x: number; y: number }, pasos = PASOS): { x: number; y: number }[] {
  return Array.from({ length: pasos }, (_, i) => {
    const t = (i + 1) / pasos;
    const s = t * t * (3 - 2 * t); // suave al salir y al llegar
    return { x: Math.round(desde.x + (hasta.x - desde.x) * s), y: Math.round(desde.y + (hasta.y - desde.y) * s) };
  });
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Escritorio de una computadora: captura y acciones. Recuerda la última vista para mapear las coordenadas.
export class Escritorio {
  private vista: Vista | undefined;
  ultima: Captura | undefined; // la última imagen que vio el modelo (la tarjeta de aprobación marca el punto en ella)

  constructor(readonly computadora: Computadora) {}

  private async xdotool(args: string[]): Promise<string> {
    const r = await this.computadora.ejecutar(["xdotool", ...args], { tiempo: 20_000 });
    if (r.codigo !== 0) throw new Error(`no pude actuar en su escritorio: ${r.salida.trim().slice(0, 200)}`);
    return r.salida;
  }

  // Captura de la pantalla entera o de una región (para ampliar), reescalada a ANCHO_IMAGEN y en JPEG.
  async capturar(zona?: Vista): Promise<Captura> {
    const r = await this.computadora.ejecutar(["sh", "-c", "xwd -root -silent 2>/dev/null | base64 -w0"], { tiempo: 20_000 });
    if (r.codigo !== 0) throw new Error(`no pude capturar su pantalla: ${r.salida.trim().slice(0, 200)}`);
    return this.procesar(r.salida, zona);
  }

  // Acción de xdotool, espera a que la pantalla se asiente y captura nueva, en una sola llamada (ACTUAR).
  private async actuar(args: string[]): Promise<Captura> {
    const r = await this.computadora.ejecutar(["sh", "-c", ACTUAR, "sh", ...args], { tiempo: 20_000 });
    if (r.codigo !== 0) throw new Error(`no pude actuar en su escritorio: ${r.salida.trim().slice(0, 200)}`);
    return this.procesar(r.salida);
  }

  private procesar(base64: string, zona?: Vista): Captura {
    const { ancho, alto, bgra } = leerXwd(Buffer.from(base64, "base64"));
    const { nativeImage } = require("electron") as typeof import("electron"); // solo en Electron (las pruebas de unidad no la usan)
    let imagen = nativeImage.createFromBitmap(bgra, { width: ancho, height: alto });
    const vista = zona ?? { x: 0, y: 0, ancho, alto };
    if (zona) imagen = imagen.crop({ x: zona.x, y: zona.y, width: zona.ancho, height: zona.alto });
    const t = tamanoImagen(vista.ancho, vista.alto);
    imagen = imagen.resize({ width: t.ancho, height: t.alto, quality: "best" });
    this.vista = vista;
    return (this.ultima = { jpeg: imagen.toJPEG(80), ancho: t.ancho, alto: t.alto, vista });
  }

  // Zona ampliada a partir de dos esquinas en 0–1000 de la vista actual.
  async ampliar(x1: number, y1: number, x2: number, y2: number): Promise<Captura> {
    if (!this.vista) await this.capturar();
    return this.capturar(region(x1, y1, x2, y2, this.vista!));
  }

  // Punto real de unas coordenadas del modelo (las de la última imagen que vio).
  async punto(nx: number, ny: number): Promise<{ x: number; y: number }> {
    if (!this.vista) await this.capturar();
    return aPantalla(nx, ny, this.vista!);
  }

  private async moverA(p: { x: number; y: number }): Promise<string[]> {
    const donde = (await this.xdotool(["getmouselocation", "--shell"])).match(/X=(\d+)\s+Y=(\d+)/);
    const desde = donde ? { x: Number(donde[1]), y: Number(donde[2]) } : p;
    return trayecto(desde, p).flatMap((q, i) => [...(i ? ["sleep", String(ENTRE_PASOS)] : []), "mousemove", String(q.x), String(q.y)]);
  }

  // Cada acción devuelve una captura nueva para que el modelo vea el resultado.
  private async despues(): Promise<Captura> {
    await esperar(ESPERA - PASOS * ENTRE_PASOS * 1000);
    return this.capturar();
  }

  async clic(nx: number, ny: number, boton: "izquierdo" | "derecho" | "doble" = "izquierdo") {
    const p = await this.punto(nx, ny);
    const clic = boton === "derecho" ? ["click", "3"] : boton === "doble" ? ["click", "--repeat", "2", "--delay", "80", "1"] : ["click", "1"];
    return { punto: p, captura: await this.actuar([...(await this.moverA(p)), ...clic]) };
  }

  async mover(nx: number, ny: number) {
    const p = await this.punto(nx, ny);
    return { punto: p, captura: await this.actuar(await this.moverA(p)) };
  }

  async arrastrar(x1: number, y1: number, x2: number, y2: number) {
    const a = await this.punto(x1, y1), b = await this.punto(x2, y2);
    const ida = trayecto(a, b).flatMap((q) => ["sleep", String(ENTRE_PASOS), "mousemove", String(q.x), String(q.y)]);
    const captura = await this.actuar([...(await this.moverA(a)), "mousedown", "1", ...ida, "mouseup", "1"]);
    return { punto: a, hasta: b, captura };
  }

  async escribir(texto: string) {
    return { captura: await this.actuar(["type", "--delay", "12", "--", texto]) };
  }

  async pulsar(combinacion: string) {
    const lista = teclas(combinacion);
    if (!lista.length) throw new Error("no dijiste qué teclas pulsar");
    return { captura: await this.actuar(["key", "--delay", "60", "--", ...lista]) };
  }

  async desplazar(nx: number, ny: number, direccion: string, cantidad: number) {
    const p = await this.punto(nx, ny);
    const boton = { arriba: "4", abajo: "5", izquierda: "6", derecha: "7" }[direccion] ?? "5";
    const veces = String(Math.min(30, Math.max(1, Math.round(cantidad) || 3)));
    return { punto: p, captura: await this.actuar([...(await this.moverA(p)), "click", "--repeat", veces, "--delay", "30", boton]) };
  }
}

const escritorios = new Map<string, Escritorio>();
export function escritorioDe(computadora: Computadora): Escritorio {
  let e = escritorios.get(computadora.usuario);
  if (!e) escritorios.set(computadora.usuario, (e = new Escritorio(computadora)));
  return e;
}
