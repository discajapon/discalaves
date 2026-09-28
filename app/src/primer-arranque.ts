// Primer arranque en Windows: si WSL o la distro de Discalaves no están listos, explica qué se va a hacer
// y pide permiso. Solo con "Preparar" se activa WSL (con el diálogo de administrador de Windows) y se crea
// la distro. En Linux no aparece nunca.

interface EstadoWsl { estado: "no-aplica" | "sin-wsl" | "sin-distro" | "lista"; memoriaGB?: number; limiteWslGB?: number }
interface PuenteWsl {
  wslEstado(): Promise<EstadoWsl>;
  wslActivar(): Promise<"lista" | "reiniciar" | "cancelado">;
  wslPreparar(): Promise<{ error?: string }>;
  alProgresoWsl(f: (texto: string) => void): void;
}

(async () => {
  const puente = (globalThis as unknown as { discalaves: PuenteWsl }).discalaves;
  const e = await puente.wslEstado();
  if (e.estado === "no-aplica" || e.estado === "lista") return;

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
  paso("Descargar Debian 13 (30 MB, verificado) y crear con él una distro propia, «discalaves». No toca tus otras distros ni tus archivos.");
  paso("Instalar Podman en esa distro (unos 100 MB). La primera vez que un empleado use su computadora se descargará su escritorio (unos 400 MB).");
  document.getElementById("wsl-memoria")!.textContent =
    `Memoria: WSL podrá usar hasta ${e.limiteWslGB} GB de tus ${e.memoriaGB} GB de RAM. Cada empleado usa unos 0,8 GB mientras trabaja.`;

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
    const { error } = await puente.wslPreparar();
    if (error) {
      estado.textContent = `No se pudo preparar: ${error}`;
      preparar.disabled = ahoraNo.disabled = false;
      return;
    }
    estado.textContent = "Listo: los empleados ya tienen dónde trabajar.";
    ahoraNo.disabled = false;
    ahoraNo.textContent = "Cerrar";
  });
  dialogo.showModal();
})();
