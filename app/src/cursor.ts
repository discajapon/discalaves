// Cursor grande en la vista en vivo (como en Cowork): el puntero del escritorio de cada empleado se ve a ~2× para
// seguir qué hace. Por defecto, uno propio de Discalaves, estilo neón (tinta con un halo violeta → turquesa, los
// acentos de GUIA_DE_DISEÑO.md), dibujado aquí: el repositorio no lleva imágenes de terceros. El usuario puede
// cargar el suyo en Configuración (.cur, .ani, PNG o un Xcursor); se convierte a Xcursor, el formato del tema de
// cursores de X11, y se guarda en sus datos (fuera del repositorio).
// Las capturas que ve el MODELO no llevan cursor: xwd no lo captura (lo comprueba prueba-escritorio.ts).

export const TAMANO = 48; // el normal es 24: 2×, no más
const TINTA = [0x1a, 0x1a, 0x1a]; // --tinta
const VIOLETA = [0x7c, 0x5c, 0xe6]; // --acento-violeta
const TURQUESA = [0x4d, 0xb6, 0xa5]; // --acento-turquesa

// Una imagen del cursor: píxeles ARGB premultiplicados (lo que guarda Xcursor), punto activo y retardo (animados).
export interface Imagen { ancho: number; alto: number; xhot: number; yhot: number; retardo: number; argb: Uint32Array }

// ---- Formato Xcursor (libXcursor): cabecera, tabla de contenidos y un bloque por imagen, todo little-endian ----

export function escribirXcursor(imagenes: Imagen[], nominal = TAMANO): Buffer {
  const cab = 16, toc = 12 * imagenes.length;
  const bloques = imagenes.map((im) => {
    const b = Buffer.alloc(36 + im.ancho * im.alto * 4);
    [36, 0xfffd0002, nominal, 1, im.ancho, im.alto, im.xhot, im.yhot, im.retardo].forEach((v, i) => b.writeUInt32LE(v >>> 0, i * 4));
    for (let i = 0; i < im.argb.length; i++) b.writeUInt32LE(im.argb[i] >>> 0, 36 + i * 4);
    return b;
  });
  const salida = Buffer.alloc(cab + toc);
  salida.write("Xcur", 0, "latin1");
  [cab, 0x10000, imagenes.length].forEach((v, i) => salida.writeUInt32LE(v, 4 + i * 4));
  let posicion = cab + toc;
  bloques.forEach((b, i) => {
    [0xfffd0002, nominal, posicion].forEach((v, j) => salida.writeUInt32LE(v, cab + i * 12 + j * 4));
    posicion += b.length;
  });
  return Buffer.concat([salida, ...bloques]);
}

// Un Xcursor de un tema trae el mismo cursor en varios tamaños nominales (Adwaita: 24, 32, 48, 64 y 96); las
// imágenes del mismo tamaño son los fotogramas de su animación. Se queda el tamaño más cercano a TAMANO (a igual
// distancia, el mayor): mezclarlos haría que el cursor "palpitara" entre tamaños.
export function unTamano(imagenes: (Imagen & { nominal: number })[]): Imagen[] {
  const nominales = [...new Set(imagenes.map((i) => i.nominal))];
  const elegido = nominales.sort((a, c) => Math.abs(a - TAMANO) - Math.abs(c - TAMANO) || c - a)[0];
  return imagenes.filter((i) => i.nominal === elegido).map(({ nominal: _, ...im }) => im);
}

export function leerXcursor(b: Buffer): (Imagen & { nominal: number })[] {
  if (b.toString("latin1", 0, 4) !== "Xcur") throw new Error("no es un archivo Xcursor");
  const n = b.readUInt32LE(12);
  const imagenes: (Imagen & { nominal: number })[] = [];
  for (let i = 0; i < n; i++) {
    const [tipo, nominal, posicion] = [0, 4, 8].map((d) => b.readUInt32LE(16 + i * 12 + d));
    if (tipo !== 0xfffd0002) continue; // comentarios
    const c = (k: number) => b.readUInt32LE(posicion + k * 4);
    const [ancho, alto] = [c(4), c(5)];
    if (!ancho || !alto || ancho > 256 || alto > 256) throw new Error("imagen de cursor de tamaño no válido");
    const argb = new Uint32Array(ancho * alto);
    for (let p = 0; p < argb.length; p++) argb[p] = b.readUInt32LE(posicion + 36 + p * 4);
    imagenes.push({ nominal, ancho, alto, xhot: Math.min(c(6), ancho - 1), yhot: Math.min(c(7), alto - 1), retardo: c(8), argb });
  }
  if (!imagenes.length) throw new Error("el Xcursor no trae imágenes");
  return imagenes;
}

// ---- El cursor de Discalaves: flecha de tinta con borde claro y halo neón, dibujada con supermuestreo ----

const FLECHA: [number, number][] = [[0, 0], [0, 17], [4.2, 13.2], [7, 19.5], [9.6, 18.4], [6.9, 12.2], [12.4, 12.2]]; // en unidades de 24 px

function dentro(x: number, y: number, poligono: [number, number][]): boolean {
  let si = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const [xi, yi] = poligono[i], [xj, yj] = poligono[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) si = !si;
  }
  return si;
}
function distancia(x: number, y: number, poligono: [number, number][]): number {
  let d = Infinity;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const [ax, ay] = poligono[j], [bx, by] = poligono[i];
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
    d = Math.min(d, Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay))));
  }
  return d;
}

export function cursorNeon(tam = TAMANO): Imagen {
  const escala = tam / 24, margen = 3 * escala; // el halo necesita sitio alrededor de la punta
  const poligono = FLECHA.map(([x, y]) => [x * escala + margen, y * escala + margen] as [number, number]);
  const argb = new Uint32Array(tam * tam);
  const S = 4; // 4×4 muestras por píxel
  for (let py = 0; py < tam; py++) {
    for (let px = 0; px < tam; px++) {
      let [a, r, g, b] = [0, 0, 0, 0];
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = px + (sx + 0.5) / S, y = py + (sy + 0.5) / S;
          let color: number[] | null = null, alfa = 0;
          if (dentro(x, y, poligono)) {
            const borde = distancia(x, y, poligono) < 1.1 * escala;
            [color, alfa] = [borde ? [255, 255, 255] : TINTA, 1];
          } else {
            const d = distancia(x, y, poligono);
            if (d < 2.6 * escala) {
              const t = Math.min(1, (x + y) / (tam * 1.2)); // del violeta (punta) al turquesa (cola)
              color = VIOLETA.map((v, k) => v + (TURQUESA[k] - v) * t);
              alfa = 0.85 * (1 - d / (2.6 * escala)) ** 1.5;
            }
          }
          if (color) [a, r, g, b] = [a + alfa, r + color[0] * alfa, g + color[1] * alfa, b + color[2] * alfa];
        }
      }
      const n = S * S;
      argb[py * tam + px] = ((Math.round((a / n) * 255) << 24) | (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n)) >>> 0;
    }
  }
  // Punto activo = la punta de la flecha.
  return { ancho: tam, alto: tam, xhot: Math.round(margen), yhot: Math.round(margen), retardo: 0, argb };
}

// ---- Cursores del usuario: .cur/.ico, .ani y PNG (decodificado fuera: nativeImage) → imágenes Xcursor ----

// Imagen BMP de un .cur (DIB "de altura doble": color y debajo la máscara AND de 1 bit). 1, 4, 8, 24 y 32 bits.
function leerDib(b: Buffer, xhot: number, yhot: number): Imagen {
  const cabecera = b.readUInt32LE(0), ancho = b.readInt32LE(4), alto = Math.abs(b.readInt32LE(8)) / 2, bits = b.readUInt16LE(14);
  if (![1, 4, 8, 24, 32].includes(bits)) throw new Error(`cursor de ${bits} bits: conviértelo a PNG`);
  const colores = bits <= 8 ? b.readUInt32LE(32) || 1 << bits : 0;
  const paleta = cabecera, datos = cabecera + colores * 4;
  const linea = Math.ceil((ancho * bits) / 32) * 4, lineaMascara = Math.ceil(ancho / 32) * 4;
  const mascara = datos + linea * alto;
  const argb = new Uint32Array(ancho * alto);
  let conAlfa = false;
  for (let y = 0; y < alto; y++) {
    const fila = alto - 1 - y; // de abajo arriba
    for (let x = 0; x < ancho; x++) {
      let [a, r, g, bl] = [255, 0, 0, 0];
      if (bits === 32) [bl, g, r, a] = [...b.subarray(datos + fila * linea + x * 4, datos + fila * linea + x * 4 + 4)];
      else if (bits === 24) [bl, g, r] = [...b.subarray(datos + fila * linea + x * 3, datos + fila * linea + x * 3 + 3)];
      else {
        const bit = x * bits, byte = b[datos + fila * linea + (bit >> 3)];
        const i = (byte >> (8 - bits - (bit & 7))) & ((1 << bits) - 1);
        [bl, g, r] = [b[paleta + i * 4], b[paleta + i * 4 + 1], b[paleta + i * 4 + 2]];
      }
      if (bits === 32 && a) conAlfa = true;
      const transparente = (b[mascara + fila * lineaMascara + (x >> 3)] >> (7 - (x & 7))) & 1;
      if (bits !== 32 && transparente) a = 0;
      argb[y * ancho + x] = ((a << 24) | (Math.round((r * a) / 255) << 16) | (Math.round((g * a) / 255) << 8) | Math.round((bl * a) / 255)) >>> 0;
    }
  }
  if (bits === 32 && !conAlfa) { // 32 bits sin alfa: manda la máscara
    for (let y = 0; y < alto; y++) for (let x = 0; x < ancho; x++) {
      const fila = alto - 1 - y;
      if ((b[mascara + fila * lineaMascara + (x >> 3)] >> (7 - (x & 7))) & 1) argb[y * ancho + x] = 0;
      else argb[y * ancho + x] = (argb[y * ancho + x] | 0xff000000) >>> 0;
    }
  }
  return { ancho, alto, xhot, yhot, retardo: 0, argb };
}

export type DecodificarPng = (png: Buffer) => { ancho: number; alto: number; bgra: Buffer }; // premultiplicado

// .cur (o .ico): la imagen de TAMANO, o la menor que lo supere (si no hay, la mayor), así se escala lo mínimo y el
// punto activo es el que dibujó su autor para ese tamaño. En un .ico esos campos son planos y bits: punto (0, 0).
function leerCur(b: Buffer, png: DecodificarPng): Imagen {
  if (b.length < 22) throw new Error("no es un archivo .cur válido");
  const n = b.readUInt16LE(4), icono = b.readUInt16LE(2) === 1;
  if (b.readUInt16LE(0) !== 0 || ![1, 2].includes(b.readUInt16LE(2)) || !n || b.length < 6 + n * 16) throw new Error("no es un archivo .cur válido");
  const entradas = Array.from({ length: n }, (_, i) => {
    const e = 6 + i * 16;
    return { lado: b[e] || 256, xhot: icono ? 0 : b.readUInt16LE(e + 4), yhot: icono ? 0 : b.readUInt16LE(e + 6), tam: b.readUInt32LE(e + 8), pos: b.readUInt32LE(e + 12) };
  }).sort((a, c) => a.lado - c.lado);
  const e = entradas.find((x) => x.lado >= TAMANO) ?? entradas.at(-1)!;
  if (e.pos + e.tam > b.length) throw new Error("el .cur está cortado");
  const datos = b.subarray(e.pos, e.pos + e.tam);
  if (datos.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return deBgra(png(datos), e.xhot, e.yhot);
  return leerDib(datos, e.xhot, e.yhot);
}

// .ani (RIFF "ACON"): fotogramas .cur con su ritmo (en sesentavos de segundo) y su orden.
function leerAni(b: Buffer, png: DecodificarPng): Imagen[] {
  if (b.toString("latin1", 0, 4) !== "RIFF" || b.toString("latin1", 8, 12) !== "ACON") throw new Error("no es un archivo .ani válido");
  let ritmo = 6, pasos: number[] | undefined, orden: number[] | undefined;
  const fotos: Imagen[] = [];
  const recorrer = (inicio: number, fin: number) => {
    for (let i = inicio; i + 8 <= fin; ) {
      const id = b.toString("latin1", i, i + 4), tam = b.readUInt32LE(i + 4), d = i + 8;
      if (id === "anih") ritmo = b.readUInt32LE(d + 28) || 6;
      else if (id === "rate") pasos = Array.from({ length: tam / 4 }, (_, k) => b.readUInt32LE(d + k * 4));
      else if (id === "seq ") orden = Array.from({ length: tam / 4 }, (_, k) => b.readUInt32LE(d + k * 4));
      else if (id === "LIST") recorrer(d + 4, d + tam);
      else if (id === "icon") fotos.push(leerCur(b.subarray(d, d + tam), png));
      i = d + tam + (tam & 1);
    }
  };
  recorrer(12, b.length);
  if (!fotos.length) throw new Error("el .ani no trae fotogramas");
  return (orden ?? fotos.map((_, i) => i)).map((f, i) => ({ ...fotos[f % fotos.length], retardo: Math.round(((pasos?.[i] ?? ritmo) * 1000) / 60) }));
}

function deBgra({ ancho, alto, bgra }: { ancho: number; alto: number; bgra: Buffer }, xhot: number, yhot: number): Imagen {
  const argb = new Uint32Array(ancho * alto);
  for (let i = 0; i < argb.length; i++) argb[i] = bgra.readUInt32LE(i * 4); // BGRA en memoria = ARGB little-endian
  return { ancho, alto, xhot, yhot, retardo: 0, argb };
}

// Lleva cada imagen a TAMANO de alto como máximo (vecino más cercano: los cursores son pixel art) y escala el punto activo.
function ajustar(im: Imagen): Imagen {
  const f = TAMANO / Math.max(im.ancho, im.alto);
  if (f === 1) return im;
  const ancho = Math.max(1, Math.round(im.ancho * f)), alto = Math.max(1, Math.round(im.alto * f));
  const argb = new Uint32Array(ancho * alto);
  for (let y = 0; y < alto; y++) for (let x = 0; x < ancho; x++) argb[y * ancho + x] = im.argb[Math.min(im.alto - 1, Math.floor(y / f)) * im.ancho + Math.min(im.ancho - 1, Math.floor(x / f))];
  return { ...im, ancho, alto, xhot: Math.min(ancho - 1, Math.round(im.xhot * f)), yhot: Math.min(alto - 1, Math.round(im.yhot * f)), argb };
}

// Archivo del usuario → Xcursor listo para el tema. Un PNG lleva el punto activo arriba a la izquierda (0, 0).
export function convertir(b: Buffer, nombre: string, png: DecodificarPng): Buffer {
  const ext = nombre.toLowerCase().split(".").pop() ?? "";
  if (b.length < 8) throw new Error("el archivo está vacío o no es un cursor");
  let imagenes: Imagen[];
  try {
    imagenes = leer(b, ext, png);
  } catch (e) {
    // Un archivo cortado o mal formado da errores de lectura de bytes: se explican en palabras.
    if (e instanceof RangeError) throw new Error("el archivo está dañado o cortado: no pude leer el cursor");
    throw e;
  }
  return escribirXcursor(imagenes.map(ajustar));
}

function leer(b: Buffer, ext: string, png: DecodificarPng): Imagen[] {
  let imagenes: Imagen[];
  if (b.toString("latin1", 0, 4) === "Xcur") imagenes = unTamano(leerXcursor(b));
  else if (b.toString("latin1", 0, 4) === "RIFF") imagenes = leerAni(b, png);
  else if (b[0] === 0x89 && b.toString("latin1", 1, 4) === "PNG") imagenes = [deBgra(png(b), 0, 0)];
  else if (b.readUInt16LE(0) === 0 && (ext === "cur" || ext === "ico" || b.readUInt16LE(2) === 2)) imagenes = [leerCur(b, png)];
  else throw new Error("formato no reconocido: usa .cur, .ani, PNG o un cursor Xcursor");
  return imagenes;
}
