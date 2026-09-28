# Discalaves

> **Estado: prototipo funcional, todavía sin instalador.** El prototipo de
> [`app/`](app/) ya trabaja de verdad: un empleado con un modelo local usa su
> propia computadora aislada para investigar en la web y dejar informes en
> archivos. Todavía no hay equipo de empleados que colaboren entre sí ni un
> instalador para el público: hoy solo lo puede arrancar alguien que prepare
> el entorno a mano (ver [Probarlo hoy](#probarlo-hoy)).

Discalaves es un equipo de "empleados" de IA que corre en tu propia
computadora. Les asignas tareas como a compañeros de trabajo; cada empleado
tiene su propia computadora aislada (un escritorio Linux con navegador y
terminal) y trabaja por su cuenta. Es una alternativa local y abierta a
Grok Bot.

## Qué funciona hoy

- **Un empleado de verdad, con modelo local.** qwen (Qwen 3.5 9B) corre en tu
  GPU con llama.cpp; nada sale de tu equipo. Conversas con él desde una app
  de escritorio y ves sus respuestas mientras las escribe.
- **Su propia computadora.** Cada empleado trabaja en un contenedor Debian
  con escritorio XFCE, terminal y Chromium. No ve tus carpetas personales
  (solo la suya) ni tu sistema, y puede instalar programas dentro de su
  computadora sin tocar la tuya.
- **Usa sus herramientas.** Terminal, crear archivos, buscar en la web, abrir
  páginas y rellenar formularios. Maneja el navegador por la estructura de la
  página, no haciendo clic en píxeles. Ya investiga un tema y deja un informe
  en un archivo.
- **Lo ves en vivo.** Un botón muestra su escritorio mientras trabaja, y
  puedes tomar el control con tu teclado y ratón.
- **Trabaja hasta acabar.** No se detiene a preguntar "¿sigo?"; te cuenta
  cada paso, y un botón **Detener** lo corta cuando quieras. Si se queda
  repitiendo lo mismo, se frena solo y te lo explica.
- **Tú apruebas lo delicado.** Antes de borrar, enviar o pagar algo, te pide
  permiso. Hay un **modo libre** opcional por empleado que quita esas
  aprobaciones; está apagado por defecto.
- **Otras IAs vía Ollama.** Si tienes [Ollama](https://ollama.com), el botón
  + muestra tus modelos instalados y abre una conversación con cada uno. Los
  que saben usar herramientas tienen su propia computadora; los que no, se
  marcan como "solo chat".
- **Tu perfil.** Tu nombre y tu foto, guardados solo en tu equipo.

## Qué falta

- **Probar Windows en una PC real.** Ya existe el soporte (ver
  [Windows](#windows-en-preparación)) y un instalador que se genera
  automáticamente, pero nadie lo ha probado todavía en un equipo con Windows y
  GPU.
- **Un equipo que colabore:** que un empleado le pase su trabajo a otro en un
  hilo compartido. Hoy puedes hablar con varias IAs, pero cada una por
  separado y de a una trabajando a la vez.
- **Instalador:** hoy hay que preparar a mano el modelo, llama.cpp y Docker.
  La meta es un instalador nativo que traiga todo, sin Docker ni pasos
  previos.
- **Gestor de modelos** dentro de la app (buscar, ver la VRAM necesaria,
  descargar) y elegir el modelo de cada empleado.
- **Memoria de cada empleado** en archivos que puedas leer y editar.
- **Aislamiento de red:** hoy la computadora de un empleado puede llegar a tu
  red local (tu router, por ejemplo). Está pendiente cerrarlo.
- **Interfaz web** para abrirla desde el navegador y el celular (hoy es una
  app de escritorio).
- **Uso de memoria RAM:** con el modelo cargado y varios escritorios
  abiertos, 16 GB se quedan justos.

## Principios

- **Cero fricción.** Un instalador nativo que trae todo lo necesario. Sin
  Docker ni pasos previos. Al terminar se abre la interfaz con los empleados
  listos. *(Todavía no: el prototipo usa Docker.)*
- **Privacidad primero.** Los modelos corren en tu máquina por defecto. Usar
  una API externa es opcional, lo decides tú, y la app te avisa claramente
  de que en ese caso tus datos salen de tu equipo.
- **Honestidad con los modelos pequeños.** Un modelo local no es un modelo
  gigante en la nube. Los empleados te cuentan qué hacen paso a paso, dicen
  cuando algo falla en lugar de inventar, y no prometen "trabajo terminado"
  que no hicieron.
- **Tú mandas.** Las acciones delicadas (borrar, enviar, pagar) necesitan tu
  aprobación, salvo que actives el modo libre de un empleado.

## Requisitos

- Linux o Windows 10/11 (Windows todavía sin probar; Mac después).
- GPU NVIDIA con al menos 8 GB de VRAM.
- 16 GB de RAM recomendados.
- Para el prototipo actual en Linux, además: Docker usable sin `sudo` y
  Node.js 24 o superior. En Windows no hace falta Docker (ver abajo).

El desarrollo y las pruebas se hacen con Qwen 3.5 9B (Q4) en una RTX 3060 Ti
de 8 GB.

## Probarlo hoy

Esto es para quien quiera seguir el desarrollo; todavía no es una
instalación para el público.

### Linux

#### 1. Preparación

1. **Descarga y configura llama.cpp con CUDA:**
   - Descarga desde [ggml-org/llama.cpp/releases](https://github.com/ggml-org/llama.cpp/releases) el archivo `llama-*-bin-linux-cuda-12.4-x64.tar.gz`.
   - Descomprime en `~/Documents/IA-discalaves/llama.cpp/` para que exista `~/Documents/IA-discalaves/llama.cpp/llama-server`.
   - (O establece la variable de entorno `DISCALAVES_IA` a otra ruta).

2. **Descarga el modelo:**
   - Coloca `Qwen3.5-9B-Q4_K_M.gguf` en `~/Documents/IA-discalaves/modelos/`.

3. **Requisitos del sistema:**
   - Docker corriendo e instalado sin `sudo` (añade tu usuario al grupo `docker`):
     ```bash
     sudo usermod -aG docker $USER
     newgrp docker
     ```
   - Node.js 24 o superior:
     ```bash
     node --version
     ```

#### 2. Arrancar

```bash
cd app
npm install
npm start
```

La primera vez:
- Construye la imagen del contenedor de los empleados (~2 minutos).
- Carga el modelo en la GPU (~10-30 segundos).

#### 3. Pruebas rápidas

```bash
cd app
npm run prueba:unidad
```

Todas las pruebas:
```bash
cd app
npm run prueba
```

---

### Windows

#### 1. Preparación

1. **Descarga el instalador:**
   - Ve a [Actions](https://github.com/discajapon/discalaves/actions/workflows/windows.yml) del repositorio.
   - Abre el último run **verde** del workflow **Windows**.
   - Descarga el artefacto `discalaves-instalador-windows`.

2. **Descarga llama.cpp con CUDA:**
   - Desde [ggml-org/llama.cpp/releases](https://github.com/ggml-org/llama.cpp/releases), descarga `llama-…-bin-win-cuda-12.4-x64.zip` y `cudart` de la misma versión.
   - Descomprime ambos en `%LOCALAPPDATA%\Discalaves\llama.cpp\` para que exista `%LOCALAPPDATA%\Discalaves\llama.cpp\llama-server.exe`.

3. **Descarga el modelo:**
   - Coloca `Qwen3.5-9B-Q4_K_M.gguf` en `%LOCALAPPDATA%\Discalaves\modelos\`.

4. **Requisitos del equipo:**
   - Windows 10 22H2 o Windows 11.
   - GPU NVIDIA con 8 GB de VRAM o más.
   - 16 GB de RAM recomendados.
   - ~15 GB libres en el disco del sistema (modelo + WSL2 + contenedores).

#### 2. Arrancar

- Ejecuta el instalador descargado (`Discalaves-*-instalador-windows.exe`).
- Elige la carpeta de instalación.
- Al abrir la app por primera vez, si WSL2 no está activado, aparecerá una pantalla "Preparar las computadoras de los empleados".
  - **"Ahora no":** sigas usando la app en modo chat (sin herramientas de los empleados).
  - **"Preparar":** activa WSL2 (pide permiso de administrador), descarga Debian 13, instala Podman y crea la distro (puede pedir reinicio).

#### 3. Primer uso con herramientas

Tras preparar WSL:
- La primera tarea con herramientas construye la imagen de Docker en Podman (~minutos).
- Luego los empleados pueden investigar en la web y crear archivos.
- Los archivos se guardan en `\\wsl$\discalaves\home\discalaves\trabajo\...` (accesible desde el Explorador).

#### 4. Ver el escritorio del empleado

- El botón del monitor muestra su escritorio (XFCE con Chromium) en vivo.
- Puedes "Tomar el control" con tu teclado y ratón.

---

## Licencia

Apache License 2.0. Consulta [LICENSE](LICENSE) y [NOTICE](NOTICE).

Discalaves — Copyright 2026 Disca.
