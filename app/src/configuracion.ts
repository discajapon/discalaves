// Hoja de configuración (botón junto al perfil): modelos de este equipo, especificaciones y créditos.
// Los datos se piden al proceso principal cada vez que se abre, así reflejan el estado actual.
(() => {
  interface Modelo { modelo: string; detalle: string; herramientas: boolean; origen: string; donde: string }
  interface Specs { sistema: string; procesador: string; nucleos: number; ramGB: number; gpus: { nombre: string; vramGB: number; usadaGB: number }[] }
  interface EstadoOllama { version: string | null; instalado: boolean; modelos: number; recomendado: string; recomendadoInstalado: boolean }
  const puente = (globalThis as unknown as { discalaves: { modelos(): Promise<{ modelos: Modelo[] }>; especificaciones(): Promise<Specs>; abrirEnlace(url: string): Promise<void>; copiarWallet(): Promise<void>; ollamaEstado(): Promise<EstadoOllama>; instalarEjecutar(ids?: string[]): Promise<{ error?: string }>; alProgresoWsl(f: (texto: string) => void): void } }).discalaves;
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

  // Menú de Ollama: instalar el motor y bajar el modelo recomendado desde aquí.
  const ollamaEstado = document.getElementById("config-ollama-estado")!;
  const botonInstalar = document.getElementById("config-ollama-instalar") as HTMLButtonElement;
  const botonModelo = document.getElementById("config-ollama-modelo") as HTMLButtonElement;
  let ocupado = false;
  puente.alProgresoWsl((texto) => ocupado && (ollamaEstado.textContent = texto));

  async function pintarOllama() {
    const e = await puente.ollamaEstado();
    ollamaEstado.textContent = e.version ? `Ollama ${e.version} funcionando · ${e.modelos} modelo(s) instalado(s)` : e.instalado ? "Ollama está instalado pero apagado: se enciende al abrir Discalaves." : "Ollama no está instalado. Es el motor que ejecuta los modelos en tu equipo.";
    botonInstalar.hidden = e.instalado;
    botonModelo.hidden = !e.instalado || e.recomendadoInstalado;
    botonModelo.textContent = `Descargar ${e.recomendado} (recomendado)`;
  }
  async function instalar(ids: string[]) {
    ocupado = botonInstalar.disabled = botonModelo.disabled = true;
    ollamaEstado.textContent = "Preparando…";
    const { error } = await puente.instalarEjecutar(ids);
    ocupado = botonInstalar.disabled = botonModelo.disabled = false;
    await pintarOllama();
    if (error) ollamaEstado.textContent = `No se pudo: ${error}`;
    else void abrirListas();
  }
  botonInstalar.addEventListener("click", () => void instalar(["ollama", "modelo"]));
  botonModelo.addEventListener("click", () => void instalar(["modelo"]));

  async function abrir() {
    copiada.textContent = "";
    modelos.replaceChildren();
    specs.replaceChildren();
    dialogo.showModal();
    void pintarOllama();
    await abrirListas();
  }

  async function abrirListas() {
    modelos.replaceChildren();
    specs.replaceChildren();
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
  // El gestor de modelos (interfaz.ts) es otro diálogo: se cierra esta hoja antes de abrirlo.
  document.getElementById("config-gestor")!.addEventListener("click", () => {
    dialogo.close();
    void (globalThis as unknown as { abrirGestor(): Promise<void> }).abrirGestor();
  });
  document.getElementById("config-web")!.addEventListener("click", (e) => {
    e.preventDefault();
    void puente.abrirEnlace("https://discajapon.com");
  });
  document.getElementById("config-btc")!.addEventListener("click", async () => {
    try {
      await puente.copiarWallet();
      copiada.textContent = "Dirección copiada. ¡Gracias!";
    } catch {
      copiada.textContent = "No se pudo copiar: selecciona la dirección y cópiala.";
    }
  });
})();
