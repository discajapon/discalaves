// Primer arranque: si falta algo (en Windows, WSL y su distro; en todos, el runtime del modelo, el modelo y en
// Linux Podman), explica qué se va a hacer y pide permiso. Solo con "Preparar" se activa WSL (con el diálogo
// de administrador de Windows), se pide permiso de administrador para Podman y se descarga todo.

interface EstadoWsl { estado: "no-aplica" | "sin-wsl" | "sin-distro" | "lista"; memoriaGB?: number; limiteWslGB?: number }
interface Pieza { id: string; nombre: string; mb: number }
interface PuenteWsl {
  instalarEstado(): Promise<Pieza[]>;
  instalarEjecutar(): Promise<{ error?: string }>;
  wslEstado(): Promise<EstadoWsl>;
  wslActivar(): Promise<"lista" | "reiniciar" | "cancelado">;
  wslPreparar(): Promise<{ error?: string }>;
  alProgresoWsl(f: (texto: string) => void): void;
}

(async () => {
  const puente = (globalThis as unknown as { discalaves: PuenteWsl }).discalaves;
  const e = await puente.wslEstado();
  const piezas = await puente.instalarEstado();
  const conWsl = e.estado === "sin-wsl" || e.estado === "sin-distro";
  if (!conWsl && !piezas.length) return;

  const dialogo = document.getElementById("wsl") as HTMLDialogElement;
  const pasos = document.getElementById("wsl-pasos")!;
  const estado = document.getElementById("wsl-estado")!;
  const preparar = document.getElementById("wsl-preparar") as HTMLButtonElement;
  const ahoraNo = document.getElementById("wsl-ahora-no") as HTMLButtonElement;

  const paso = (texto: string) => {
    const li = document.createElement("li");
    li.textContent = texto;
    pasos.append(li);
  };
  if (e.estado === "sin-wsl") paso("Activar WSL, el Linux integrado de Windows. Windows te pedirá permiso de administrador y puede que haya que reiniciar.");
  if (conWsl) {
    paso("Descargar Debian 13 (30 MB, verificado) y crear con él una distro propia, «discalaves», donde trabajan los empleados. No toca tus otras distros ni tus archivos.");
    paso("Instalar Podman en esa distro (unos 100 MB). La primera vez que un empleado use su computadora se descargará su escritorio (unos 400 MB).");
    document.getElementById("wsl-memoria")!.textContent =
      `Memoria: WSL podrá usar hasta ${e.limiteWslGB} GB de tus ${e.memoriaGB} GB de RAM. Cada empleado usa unos 0,8 GB mientras trabaja.`;
  }
  for (const p of piezas) paso(`${p.nombre}: ${p.mb >= 1000 ? (p.mb / 1000).toFixed(1) + " GB" : p.mb + " MB"}.`);

  puente.alProgresoWsl((texto) => (estado.textContent = texto));
  ahoraNo.addEventListener("click", () => dialogo.close());
  preparar.addEventListener("click", async () => {
    preparar.disabled = ahoraNo.disabled = true;
    if (e.estado === "sin-wsl") {
      estado.textContent = "esperando el permiso de administrador de Windows…";
      const r = await puente.wslActivar();
      if (r === "cancelado") {
        estado.textContent = "No se activó WSL: Windows no dio el permiso. Puedes intentarlo otra vez.";
        preparar.disabled = ahoraNo.disabled = false;
        return;
      }
      if (r === "reiniciar") {
        estado.textContent = "WSL quedó activado. Reinicia Windows y vuelve a abrir Discalaves para terminar.";
        ahoraNo.disabled = false;
        ahoraNo.textContent = "Cerrar";
        return;
      }
    }
    const { error } = conWsl ? await puente.wslPreparar() : await puente.instalarEjecutar();
    const otro = !error && conWsl && piezas.length ? await puente.instalarEjecutar() : {};
    if (error || otro.error) {
      estado.textContent = `No se pudo preparar: ${error ?? otro.error}`;
      preparar.disabled = ahoraNo.disabled = false;
      return;
    }
    estado.textContent = piezas.some((p) => p.id === "motor") ? "Listo: Discalaves se reiniciará para usar Podman." : "Listo: Discalaves ya tiene todo lo que necesita.";
    ahoraNo.disabled = false;
    ahoraNo.textContent = "Cerrar";
  });
  dialogo.showModal();
})();
