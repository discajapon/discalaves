// Dibuja la lista de conversaciones y el hilo activo a partir de datos.ts.

const ICONOS: Record<Glifo, string> = {
  buscar: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  pluma: '<path d="M4 20l4-1 11-11-3-3L5 16z"/>',
  grafica: '<path d="M5 19v-8M12 19V5M19 19v-6"/>',
  sobre: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 7l9 6 9-6"/>',
  lista: '<path d="M4 7l2 2 3-3M4 16l2 2 3-3M13 8h7M13 17h7"/>',
};

const porId = new Map(EMPLEADOS.map((e) => [e.id, e]));
let activa = CONVERSACIONES[0].id;

function crear(etiqueta: string, clase = "", texto = ""): HTMLElement {
  const el = document.createElement(etiqueta);
  if (clase) el.className = clase;
  if (texto) el.textContent = texto;
  return el;
}

function avatar(miembros: string[]): HTMLElement {
  const grupo = crear("span", miembros.length > 1 ? "avatares grupo" : "avatares");
  for (const id of miembros) {
    const e = porId.get(id)!;
    const a = crear("span", "avatar");
    a.style.setProperty("--acento", `var(--acento-${e.acento})`);
    a.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONOS[e.glifo]}</svg>`;
    grupo.append(a);
  }
  return grupo;
}

function ultimaLinea(c: Conversacion): string {
  const m = [...c.mensajes].reverse().find((m) => !("separador" in m));
  if (!m || "separador" in m) return "";
  const texto = m.texto ?? m.checks!.map((k) => `✓ ${k.etiqueta}`).join("  ");
  const quien = m.de === "yo" ? "tú: " : c.miembros.length > 1 ? `${porId.get(m.de)!.nombre}: ` : "";
  return quien + texto;
}

function dibujarLista() {
  const lista = document.getElementById("lista")!;
  lista.replaceChildren();
  for (const c of CONVERSACIONES) {
    const fila = crear("button", "fila");
    fila.setAttribute("aria-current", String(c.id === activa));
    const av = avatar(c.miembros);
    if (c.noLeido) av.append(crear("span", "punto", ""));
    const cuerpo = crear("span", "fila-cuerpo");
    const arriba = crear("span", "fila-arriba");
    arriba.append(crear("span", "nombre", c.nombre), crear("span", "hora", c.hora));
    cuerpo.append(arriba, crear("span", "vista", ultimaLinea(c)));
    fila.append(av, cuerpo);
    fila.addEventListener("click", () => {
      activa = c.id;
      c.noLeido = false;
      dibujarLista();
      dibujarHilo();
    });
    lista.append(fila);
  }
}

function dibujarHilo() {
  const c = CONVERSACIONES.find((c) => c.id === activa)!;
  const cab = document.getElementById("cab-avatar")!;
  cab.replaceChildren(avatar(c.miembros));
  document.getElementById("cab-nombre")!.textContent = c.nombre;
  (document.getElementById("entrada") as HTMLInputElement).placeholder = `Mensaje a ${c.nombre}`;

  const hilo = document.getElementById("hilo")!;
  hilo.replaceChildren();
  let anterior = "";
  for (const m of c.mensajes) {
    if ("separador" in m) {
      hilo.append(crear("p", "separador", m.separador));
      anterior = "";
      continue;
    }
    const mio = m.de === "yo";
    const fila = crear("div", mio ? "mensaje mio" : "mensaje");
    if (!mio && c.miembros.length > 1 && m.de !== anterior) fila.append(crear("span", "autor", porId.get(m.de)!.nombre));
    const burbuja = crear("div", "burbuja");
    if (m.texto) burbuja.append(crear("p", "", m.texto));
    if (m.checks) {
      const ul = crear("ul", "checks");
      for (const k of m.checks) {
        const li = crear("li", "", "✓ ");
        li.append(crear("strong", "", k.etiqueta), ` → ${k.detalle}`);
        ul.append(li);
      }
      burbuja.append(ul);
    }
    if (m.reaccion) burbuja.append(crear("span", "reaccion", m.reaccion));
    fila.append(burbuja);
    hilo.append(fila);
    anterior = m.de;
  }
  hilo.scrollTop = hilo.scrollHeight;
}

document.getElementById("usuario-iniciales")!.textContent = USUARIO.iniciales;
document.getElementById("usuario-nombre")!.textContent = USUARIO.nombre;
// ponytail: el cuadro de texto aún no envía nada; se conecta cuando existan los agentes.
document.getElementById("redactor")!.addEventListener("submit", (ev) => ev.preventDefault());
dibujarLista();
dibujarHilo();
