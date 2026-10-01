// Hoja de configuración (botón junto al perfil): modelos de este equipo, especificaciones y créditos.
// Los datos se piden al proceso principal cada vez que se abre, así reflejan el estado actual.
(() => {
  interface Modelo { modelo: string; detalle: string; herramientas: boolean; origen: string; donde: string }
  interface Specs { sistema: string; procesador: string; nucleos: number; ramGB: number; gpus: { nombre: string; vramGB: number; usadaGB: number }[] }
  const puente = (globalThis as unknown as { discalaves: { modelos(): Promise<{ modelos: Modelo[] }>; especificaciones(): Promise<Specs>; abrirEnlace(url: string): Promise<void> } }).discalaves;
  const dialogo = document.getElementById("config") as HTMLDialogElement;
  const modelos = document.getElementById("config-modelos")!;
  const specs = document.getElementById("config-specs")!;
  const copiada = document.getElementById("config-copiada")!;

  const fila = (padre: HTMLElement, tag: string, texto: string, clase?: string) => {
    const el = document.createElement(tag);
    el.textContent = texto;
    if (clase) el.className = clase;
    padre.append(el);
    return el;
  };

  async function abrir() {
    copiada.textContent = "";
    modelos.replaceChildren();
    specs.replaceChildren();
    dialogo.showModal();
    const [m, s] = await Promise.all([puente.modelos().catch(() => ({ modelos: [] as Modelo[] })), puente.especificaciones()]);
    const locales = m.modelos.filter((x) => x.origen === "local");
    for (const x of locales) {
      const li = document.createElement("li");
      fila(li, "span", x.modelo, "nombre");
      fila(li, "span", [x.donde, x.detalle, x.herramientas ? "" : "solo chat"].filter(Boolean).join(" · "), "detalle");
      modelos.append(li);
    }
    if (!locales.length) fila(modelos, "li", "No hay modelos locales disponibles.");
    const datos: [string, string][] = [
      ["Sistema", s.sistema],
      ["Procesador", `${s.procesador} (${s.nucleos} hilos)`],
      ["Memoria RAM", `${s.ramGB} GB`],
      ...(s.gpus.length ? s.gpus.map((g, i): [string, string] => [s.gpus.length > 1 ? `GPU ${i + 1}` : "GPU", `${g.nombre} · ${g.vramGB} GB de VRAM (${g.usadaGB} GB en uso)`]) : [["GPU", "No se detectó una tarjeta NVIDIA"] as [string, string]]),
    ];
    for (const [k, v] of datos) {
      fila(specs, "dt", k);
      fila(specs, "dd", v);
    }
  }

  document.getElementById("configuracion")!.addEventListener("click", () => void abrir());
  document.getElementById("config-web")!.addEventListener("click", (e) => {
    e.preventDefault();
    void puente.abrirEnlace("https://discajapon.com");
  });
  document.getElementById("config-btc")!.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(document.getElementById("config-wallet")!.textContent!);
      copiada.textContent = "Dirección copiada. ¡Gracias!";
    } catch {
      copiada.textContent = "No se pudo copiar: selecciona la dirección y cópiala.";
    }
  });
})();
