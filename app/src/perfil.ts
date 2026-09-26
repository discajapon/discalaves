// Perfil del usuario: nombre y foto encuadrada en un círculo. Se guarda solo en
// este equipo (localStorage de la ventana); nada sale de la máquina.

const CLAVE_PERFIL = "discalaves.perfil";
const SALIDA = 256; // lado en px de la foto recortada que se guarda
const NOMBRE_POR_DEFECTO = "Tú";

interface Perfil { nombre: string; foto: string | null }

function leerPerfil(): Perfil {
  try {
    const p = JSON.parse(localStorage.getItem(CLAVE_PERFIL) ?? "null");
    if (p && typeof p.nombre === "string") return { nombre: p.nombre, foto: typeof p.foto === "string" ? p.foto : null };
  } catch {
    // perfil ilegible: se usa el de ejemplo
  }
  return { nombre: NOMBRE_POR_DEFECTO, foto: null };
}

let perfil = leerPerfil();

function inicialesDe(nombre: string): string {
  return nombre.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
}

function pintarAvatar(el: HTMLElement, nombre: string, foto: string | null) {
  el.textContent = foto ? "" : inicialesDe(nombre);
  el.style.backgroundImage = foto ? `url("${foto}")` : "";
}

function dibujarUsuario() {
  pintarAvatar(document.getElementById("usuario-iniciales")!, perfil.nombre, perfil.foto);
  document.getElementById("usuario-nombre")!.textContent = perfil.nombre;
}

// --- Diálogo de edición ---

const dialogo = document.getElementById("perfil") as HTMLDialogElement;
const encuadre = document.getElementById("encuadre")!;
const imagen = document.getElementById("encuadre-img") as HTMLImageElement;
const vacio = document.getElementById("encuadre-iniciales")!;
const zoom = document.getElementById("zoom") as HTMLInputElement;
const archivo = document.getElementById("foto") as HTMLInputElement;
const campoNombre = document.getElementById("perfil-nombre") as HTMLInputElement;

// Posición de la imagen dentro del círculo: esquina superior izquierda (x, y) y escala.
let x = 0, y = 0, escala = 1;
let cambioFoto = false;
let medida = 0; // lado del círculo en px; se mide al abrir (cerrado mide 0)

const lado = () => medida;
const escalaMinima = () => lado() / Math.min(imagen.naturalWidth, imagen.naturalHeight); // cubre el círculo

function aplicar() {
  const w = imagen.naturalWidth * escala, h = imagen.naturalHeight * escala;
  x = Math.min(0, Math.max(lado() - w, x)); // nunca deja huecos dentro del círculo
  y = Math.min(0, Math.max(lado() - h, y));
  imagen.style.width = `${w}px`;
  imagen.style.height = `${h}px`;
  imagen.style.transform = `translate(${x}px, ${y}px)`;
}

function hayFoto() { return !imagen.hidden; }

function mostrarFoto(src: string | null) {
  imagen.hidden = !src;
  zoom.disabled = !src;
  pintarAvatar(vacio, campoNombre.value || perfil.nombre, null);
  vacio.hidden = !!src;
  if (!src) return;
  imagen.onload = () => {
    escala = escalaMinima();
    zoom.value = "1";
    x = (lado() - imagen.naturalWidth * escala) / 2;
    y = (lado() - imagen.naturalHeight * escala) / 2;
    aplicar();
  };
  imagen.src = src;
}

// Cambia la escala manteniendo fijo el centro del círculo.
function ampliar(factor: number) {
  if (!hayFoto()) return;
  const nueva = escalaMinima() * Math.min(4, Math.max(1, factor));
  const c = lado() / 2;
  x = c - ((c - x) / escala) * nueva;
  y = c - ((c - y) / escala) * nueva;
  escala = nueva;
  zoom.value = String(escala / escalaMinima());
  aplicar();
  cambioFoto = true;
}

function mover(dx: number, dy: number) {
  x += dx;
  y += dy;
  aplicar();
  cambioFoto = true;
}

zoom.addEventListener("input", () => ampliar(Number(zoom.value)));
encuadre.addEventListener("wheel", (ev) => {
  ev.preventDefault();
  ampliar(Number(zoom.value) * (ev.deltaY < 0 ? 1.1 : 1 / 1.1));
}, { passive: false });

let arrastre: { px: number; py: number } | null = null;
encuadre.addEventListener("pointerdown", (ev) => {
  if (!hayFoto()) return;
  encuadre.setPointerCapture(ev.pointerId);
  arrastre = { px: ev.clientX, py: ev.clientY };
});
encuadre.addEventListener("pointermove", (ev) => {
  if (!arrastre) return;
  mover(ev.clientX - arrastre.px, ev.clientY - arrastre.py);
  arrastre = { px: ev.clientX, py: ev.clientY };
});
encuadre.addEventListener("pointerup", () => (arrastre = null));
encuadre.addEventListener("pointercancel", () => (arrastre = null));
encuadre.addEventListener("keydown", (ev) => {
  const pasos: Record<string, [number, number]> = { ArrowLeft: [8, 0], ArrowRight: [-8, 0], ArrowUp: [0, 8], ArrowDown: [0, -8] };
  if (ev.key in pasos && hayFoto()) {
    ev.preventDefault();
    mover(...pasos[ev.key]);
  }
});

document.getElementById("elegir-foto")!.addEventListener("click", () => archivo.click());
archivo.addEventListener("change", () => {
  const f = archivo.files?.[0];
  archivo.value = "";
  if (!f || !f.type.startsWith("image/")) return;
  const lector = new FileReader();
  lector.onload = () => {
    cambioFoto = true;
    mostrarFoto(lector.result as string);
  };
  lector.readAsDataURL(f);
});
document.getElementById("quitar-foto")!.addEventListener("click", () => {
  cambioFoto = true;
  mostrarFoto(null);
});
campoNombre.addEventListener("input", () => pintarAvatar(vacio, campoNombre.value, null));

function recortar(): string {
  const lienzo = document.createElement("canvas");
  lienzo.width = lienzo.height = SALIDA;
  const k = SALIDA / lado();
  lienzo.getContext("2d")!.drawImage(imagen, x * k, y * k, imagen.naturalWidth * escala * k, imagen.naturalHeight * escala * k);
  return lienzo.toDataURL("image/jpeg", 0.9);
}

document.getElementById("usuario")!.addEventListener("click", () => {
  campoNombre.value = perfil.nombre;
  cambioFoto = false;
  dialogo.returnValue = "";
  dialogo.showModal();
  medida = encuadre.clientWidth;
  mostrarFoto(perfil.foto);
});

dialogo.addEventListener("close", () => {
  if (dialogo.returnValue !== "guardar") return;
  const foto = !cambioFoto ? perfil.foto : hayFoto() ? recortar() : null;
  perfil = { nombre: campoNombre.value.trim(), foto };
  try {
    localStorage.setItem(CLAVE_PERFIL, JSON.stringify(perfil));
  } catch {
    // sin almacenamiento: el cambio dura hasta cerrar la app
  }
  dibujarUsuario();
});

dibujarUsuario();
