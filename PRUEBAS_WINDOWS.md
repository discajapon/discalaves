# Pruebas manuales en Windows

El workflow de GitHub Actions (`.github/workflows/windows.yml`) compila, pasa
las pruebas de unidad y genera el instalador, pero sus runners **no tienen GPU
ni WSL2**. Todo lo que sigue solo se puede comprobar en una PC real. Hasta que
alguien lo haga y lo anote al final, **Windows no está probado**.

## Equipo necesario

- Windows 11, o Windows 10 22H2 con WSL actualizado (`wsl --install
  --no-distribution` debe existir).
- GPU NVIDIA con 8 GB de VRAM o más y controlador reciente.
- 16 GB de RAM recomendados.
- Unos 15 GB libres en el disco del sistema: modelo 5,7 GB, llama.cpp con CUDA
  ~0,6 GB, distro e imagen ~2,5 GB, más margen.
- Conexión a internet para la primera preparación (~0,5 GB, sin contar el
  modelo).

## Preparación (todavía a mano)

1. Descarga el instalador: artefacto `discalaves-instalador-windows` del
   último run verde del workflow **Windows** en GitHub Actions.
2. Descarga de las [versiones de llama.cpp](https://github.com/ggml-org/llama.cpp/releases)
   el zip `llama-…-bin-win-cuda-12.4-x64.zip` y el de `cudart` de la misma
   versión. Descomprime los dos en
   `%LOCALAPPDATA%\Discalaves\llama.cpp\`, de modo que exista
   `%LOCALAPPDATA%\Discalaves\llama.cpp\llama-server.exe`.
3. Copia el modelo a
   `%LOCALAPPDATA%\Discalaves\modelos\Qwen3.5-9B-Q4_K_M.gguf`.

## Pruebas

Anota en cada una ✅, ❌ (con lo que pasó) o "no probado".

### A. Instalación
- [ ] A1. El instalador arranca, deja elegir la carpeta e instala sin pedir
      Docker Desktop.
- [ ] A2. Aparece "Discalaves" en el menú Inicio y en el escritorio, y abre la
      app.
- [ ] A3. Desinstalar desde "Aplicaciones instaladas" quita el programa.
      Los datos de `%LOCALAPPDATA%\Discalaves` y la distro se quedan, y es lo
      esperado.

### B. Primer arranque y WSL (en un equipo **sin** WSL activado)
- [ ] B1. Al abrir la app aparece la pantalla "Preparar las computadoras de los
      empleados", con los pasos y la memoria que usará WSL. **No** se abre ningún
      diálogo de administrador hasta pulsar "Preparar".
- [ ] B2. "Ahora no" cierra la pantalla y la app sigue funcionando para
      conversar.
- [ ] B3. "Preparar" abre el diálogo de administrador de Windows (UAC). Si se
      rechaza, la app dice que no se activó y deja reintentar.
- [ ] B4. Si se acepta, la app activa WSL. Si Windows pide reiniciar, la app lo
      dice. Tras reiniciar y volver a abrir, la pantalla sigue en el paso de
      crear la distro.
- [ ] B5. La app descarga Debian 13 (se ve el porcentaje), crea la distro e
      instala Podman, y termina en "Listo". `wsl -l -v` muestra `discalaves`
      en versión 2.
- [ ] B6. Las otras distros del usuario siguen igual y `%USERPROFILE%\.wslconfig`
      no cambió (compara la fecha de modificación).
- [ ] B7. Dentro de la distro: `wsl -d discalaves -- podman info` funciona sin
      errores de cgroups; `wsl -d discalaves -- ls /mnt` no muestra los
      discos de Windows.

### C. Modelo en Windows
- [ ] C1. Al abrir la app, la cabecera de qwen pasa de "cargando el modelo…" a
      "en línea · local" en menos de 30 s, y no se abre ninguna ventana de
      consola.
- [ ] C2. `%LOCALAPPDATA%\Discalaves\datos\llama-server.log` indica que las
      capas van a la GPU (CUDA) y no a la CPU.
- [ ] C3. Una pregunta simple ("hola, ¿quién eres?") se responde en streaming.

### D. Computadora del empleado (criterio 1 de "listo")
- [ ] D1. Primera tarea con herramientas: la cabecera dice "encendiendo su
      computadora…" y la primera vez construye la imagen (unos minutos).
- [ ] D2. **Criterio 1:** "Investiga en la web qué es la computación cuántica y
      déjame un informe en informes/cuantica.md". qwen busca, abre páginas y
      escribe el archivo.
- [ ] D3. El informe existe en
      `\\wsl$\discalaves\home\discalaves\trabajo\qwen\informes\cuantica.md` y
      se abre desde el Explorador.
- [ ] D4. `sudo apt-get install -y cowsay` desde qwen funciona dentro de su
      computadora; tras cerrar y volver a abrir la app, `cowsay` sigue instalado.
- [ ] D5. Aislamiento: pide a qwen `ls /mnt; ls /home; id`. No ve discos de
      Windows ni otras carpetas, y `id` muestra un usuario sin privilegios.

### E. Pantalla en vivo
- [ ] E1. El botón del monitor muestra su escritorio (XFCE con Chromium)
      mientras trabaja.
- [ ] E2. "Tomar el control" deja usar teclado y ratón en su escritorio, y
      mientras tanto las herramientas del navegador esperan.
- [ ] E3. Si E1 falla porque no conecta: comprueba desde PowerShell
      `wsl -d discalaves -- podman port discalaves-qwen` y abre
      `http://127.0.0.1:<puerto>` en el navegador. Si no llega, revisa en
      `%USERPROFILE%\.wslconfig` si `localhostForwarding=false` o si hay un
      `networkingMode` distinto. **No lo cambies sin decidirlo con el usuario**:
      afecta a sus otras distros.

### F. Cierre y memoria
- [ ] F1. Al cerrar la app, `wsl -l --running` ya no muestra `discalaves` (se
      apaga para liberar memoria) y no queda `llama-server.exe` en el
      Administrador de tareas.
- [ ] F2. Con dos empleados trabajando, anota la memoria de "VmmemWSL" en el
      Administrador de tareas: ___ GB (de ___ GB de RAM).

### G. Linux sigue igual
- [ ] G1. En Linux, `cd app && npm run prueba` pasa ("unidad: ok" y
      "computadoras: ok").

## Resultados

| Fecha | Equipo (Windows, GPU, RAM) | Resultado | Notas |
|---|---|---|---|
| | | | |
