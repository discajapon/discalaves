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

