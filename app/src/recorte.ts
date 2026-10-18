// Qué parte del historial viaja al modelo, estable entre turnos. llama-server solo reutiliza su caché si el prompt
// nuevo empieza igual que el anterior; con Qwen 3.5 (híbrido) ni siquiera recorta: vuelve a un punto de control.
// Recortar un poco en cada turno (la ventana deslizándose mensaje a mensaje) cambiaba el principio del prompt en
// TODOS los turnos: en una conversación real se reprocesaban ~10 000 tokens por paso (9–10 s, medido 2026-10-18).
// Por eso se recorta con holgura: solo cuando el total pasa del límite, y entonces hasta el OBJETIVO del límite; los
// turnos siguientes solo añaden al final hasta volver a llenarlo. Lo recortado se recuerda (`previo`).

// Un mensaje ya convertido al formato del modelo: su tamaño entero y, si es una salida de herramienta larga, el que
// tendría recortada (igual al entero si no se puede recortar).
export interface Pieza { rol: "user" | "assistant" | "tool"; largo: number; corto: number }
// inicio: primer mensaje (siempre del usuario) que viaja; cortas: salidas recortadas; fuera: pasos omitidos.
export interface Recorte { inicio: number; cortas: Set<number>; fuera: Set<number> }

export const OBJETIVO = 0.6; // al recortar se baja al 60 % del límite: el 40 % restante son turnos sin tocar el principio

export function recortar(piezas: Pieza[], limite: number, previo?: Recorte): Recorte {
  // Lo recordado vale si sigue apuntando a un mensaje del usuario (el historial puede haberse vaciado o cambiado).
  const valido = previo && previo.inicio < piezas.length && piezas[previo.inicio].rol === "user";
  const r: Recorte = valido
    ? { inicio: previo.inicio, cortas: new Set([...previo.cortas].filter((i) => i < piezas.length)), fuera: new Set([...previo.fuera].filter((i) => i < piezas.length)) }
    : { inicio: Math.max(0, piezas.findIndex((p) => p.rol === "user")), cortas: new Set(), fuera: new Set() };
  const tam = (i: number) => (r.fuera.has(i) ? 0 : r.cortas.has(i) ? piezas[i].corto : piezas[i].largo);
  const total = () => piezas.reduce((s, _, i) => (i < r.inicio ? s : s + tam(i)), 0);
  if (total() <= limite) return r;
  const objetivo = limite * OBJETIVO;

  // 1. Mover el inicio a un mensaje del usuario más reciente (nunca más allá del último).
  const usuarios = piezas.flatMap((p, i) => (p.rol === "user" && i > r.inicio ? [i] : []));
  for (const u of usuarios) {
    if (total() <= objetivo) break;
    r.inicio = u;
    for (const i of [...r.cortas, ...r.fuera]) if (i < u) (r.cortas.delete(i), r.fuera.delete(i));
  }
  return r;
}
