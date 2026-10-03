# Discalaves

> **Estado: la v1 cumple sus dos criterios de "listo".** Un empleado
> investiga un tema en la web y deja un informe en un archivo, y un empleado
> investiga y le pasa el resultado a otro, que lo resume. Probado con Qwen 3.5
> 9B en una RTX 3060 Ti de 8 GB. Hay instaladores para Linux y Windows que
> descargan solos lo que falta en el primer arranque (ver
> [Instalar](#instalar)). Es una versión preliminar: Windows y varias
> descargas reales siguen sin probarse (ver [Qué falta](#qué-falta)).

Discalaves es un equipo de "empleados" de IA que corre en tu propia
computadora. Les asignas tareas como a compañeros de trabajo; cada empleado
tiene su propia computadora aislada (un escritorio Linux con navegador y
terminal) y trabaja por su cuenta. Es una alternativa local y abierta a
Grok Bot.

## Qué funciona hoy

- **Empleados con modelo local.** Por defecto usan [Ollama](https://ollama.com)
  (la app lo instala o usa el tuyo) con `qwen3:8b`, en tu GPU; nada sale de tu
  equipo. Si tienes llama.cpp con Qwen 3.5 9B (el servidor propio de
  Discalaves, con varias ranuras), también funciona. Conversas con cada
  empleado desde una app de escritorio y ves sus respuestas mientras las
  escribe.
- **Cada uno con su puesto.** Un empleado es un perfil en archivos de texto
  que puedes leer y editar: nombre, rol, tono y reglas, las herramientas que
  puede usar, sus procedimientos (cómo hace su trabajo y en qué formato lo
  entrega) y su memoria. Hay plantillas (asistente, investigador, redactor,
  marketing, contador, talento humano, desarrollador) o puedes describir el
  puesto con tus palabras para que el modelo redacte un borrador que tú
  revisas. Por defecto comparten el mismo modelo cargado: especializarse no
  gasta más memoria de la GPU.
- **Honestidad comprobada.** Si un empleado dice que guardó un archivo que no
  guardó, o cita una web que no abrió, la app lo detecta y le pide que lo haga
  de verdad o que diga que no pudo.
- **Su propia computadora.** Cada empleado trabaja en un contenedor Debian
  con escritorio XFCE, terminal y Chromium. No ve tus carpetas personales
  (solo la suya) ni tu sistema, y puede instalar programas dentro de su
  computadora sin tocar la tuya. Su computadora tampoco llega a tu red local
  (ni a tu router ni a otros servicios de tu equipo), solo a internet.
- **Usa sus herramientas.** Terminal, crear archivos, buscar en la web, abrir
  páginas y rellenar formularios. Maneja el navegador por la estructura de la
  página, no haciendo clic en píxeles. Ya investiga un tema y deja un informe
  en un archivo.
- **Lo ves en vivo.** Un botón muestra su escritorio mientras trabaja, y
  puedes tomar el control con tu teclado y ratón.
- **Trabaja hasta acabar.** No se detiene a preguntar "¿sigo?"; te cuenta
  cada paso, y un botón **Detener** lo corta cuando quieras. Si se queda
  repitiendo lo mismo, se frena solo y te lo explica.
- **Herramientas adicionales, a tu elección.** En el perfil de cada empleado
  puedes activar leer y editar archivos, leer una web sin navegador, que te
  pregunte, o que le pase trabajo a un compañero y reciba su respuesta.
- **Trabajan en equipo, y lo ves.** Un empleado le encarga una parte a un
  compañero ("pasar trabajo", activado en todas las plantillas). En el hilo **Equipo** ves a
  los dos colaborar: quién le encarga qué a quién, sus pasos y sus respuestas,
  mientras ocurre. Desde ahí también puedes encargar algo con `@nombre`.
  Varios empleados pueden trabajar a la vez con el mismo modelo (2 en una GPU
  de 8 GB, algo más lentos que uno solo).
- **Motor OpenClaw, a tu elección.** Cada empleado puede trabajar con el
  bucle propio de Discalaves o con [OpenClaw](https://openclaw.ai) y sus
  herramientas (terminal, archivos, web, navegador), siempre dentro de su
  computadora aislada. Probado en Linux con Qwen 9B en tareas cortas.
- **Tú apruebas lo delicado.** Antes de borrar, enviar o pagar algo, te pide
  permiso. Hay un **modo libre** opcional por empleado que quita esas
  aprobaciones; está apagado por defecto.
- **Otras IAs vía Ollama.** Si tienes [Ollama](https://ollama.com), puedes
  asignar cualquiera de tus modelos a un empleado. Los que saben usar
  herramientas tienen su propia computadora; los que no, se marcan como "solo
  chat".
- **Gestor de modelos.** Busca modelos en Hugging Face, te dice si cada versión
  cabe en tu GPU y los instala en Ollama con una barra de progreso. También
  acepta nombres de la biblioteca de Ollama (`llama3.2:3b`) y archivos `.gguf`
  de tu disco. Lo instalado se asigna enseguida a cualquier empleado.
- **Configuración.** El engranaje junto a tu perfil muestra los modelos
  locales, las especificaciones de tu equipo (CPU, RAM, GPU) y permite
  instalar Ollama y el modelo recomendado cuando quieras.
- **Tu perfil.** Tu nombre y tu foto, guardados solo en tu equipo.

## Modelos fuera de tu equipo (opcional)

Por defecto todo es local. Si quieres, puedes asignar a un empleado una API con
clave (OpenAI, Gemini, Claude u otra compatible con OpenAI), un servidor tuyo
(por URL o túnel SSH) o ChatGPT vía Codex. La app te avisa qué datos salen y
hacia dónde, marca a esos empleados en la lista y nunca cambia su origen sola.

- Codex (ChatGPT) no es oficial y puede dejar de funcionar. Lo instalas tú
  aparte y respondes por cumplir los términos de OpenAI.
- Claude por suscripción no está soportado: las condiciones de Anthropic no lo
  permiten a apps de terceros. Claude funciona con clave de API.
- Solo se ha probado con servidores falsos locales, no con proveedores reales.

## Principios

- **Cero fricción.** Un instalador nativo que trae todo lo necesario. Sin
  Docker ni pasos previos. Al terminar se abre la interfaz con los empleados
  listos. *(El instalador ya descarga Ollama, el modelo y Podman, pero solo
  está probado en Linux y partes sueltas; si ya tienes Docker, se usa.)*
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
- Con el instalador no necesitas nada más: Discalaves descarga Ollama, un
  modelo y, en Linux, Podman. Para seguir el desarrollo desde el código, además:
  Node.js 24 o superior (y un motor de contenedores: Docker o Podman).

El desarrollo y las pruebas se hacen con Qwen 3.5 9B (Q4) en una RTX 3060 Ti
de 8 GB.

## Instalar

En Windows, descarga el `.exe` de los artefactos de GitHub Actions
(`discalaves-instalador-windows`). En Linux, por ahora se genera con
`cd app && npm ci && npm run instalador:linux` (un AppImage en
`app/instalador/`); aún no hay descarga publicada. Ábrelo. La primera vez, Discalaves te muestra qué falta y lo prepara
cuando pulsas **Preparar**:

- **Ollama**, el motor que ejecuta los modelos (unos 1,5 GB). Se instala en tu
  carpeta, sin permisos de administrador; si ya lo tienes, se usa el tuyo.
- **Qwen3 8B** (5,2 GB), un modelo con herramientas que cabe en 8 GB de VRAM. Es
  solo el recomendado: puedes usar cualquier otro desde Configuración. Lo que
  se descarga de GitHub o de Hugging Face se verifica con sha256 y, si se
  corta, continúa donde se quedó.
- **Podman** en Linux si no hay Docker ni Podman usable (pide tu contraseña de
  administrador una vez) o, en Windows, una distro WSL propia con Podman.

Desde el engranaje junto a tu perfil, **Configuración → Ollama** instala Ollama
y baja el modelo recomendado cuando quieras. llama.cpp con Qwen 3.5 9B (el
servidor propio de Discalaves) sigue funcionando si ya lo tienes, pero ya no se
instala por defecto.

Probado: la instalación de Ollama contra un servidor local que imita su
release, la descarga reanudable, la descarga real de llama.cpp en Linux y la
pantalla de preparación en la app empaquetada. **Sin probar:** la descarga real
de Ollama y del modelo, la instalación de Podman con `pkexec` en una distro
sin él, y Windows.

## Probarlo desde el código

Para seguir el desarrollo. Necesitas Node.js 24 o superior y, en Linux, Docker
(usable sin `sudo`) o Podman; si falta algo, la pantalla de primer arranque
ofrece instalarlo.

```bash
cd app
npm install
npm start
```

La primera vez construye la imagen de las computadoras de los empleados (~2
minutos) y la pantalla de primer arranque descarga Ollama y `qwen3:8b`. Si ya
tienes llama.cpp en `~/Documents/IA-discalaves/llama.cpp/` (o la ruta de
`DISCALAVES_IA`) y `modelos/Qwen3.5-9B-Q4_K_M.gguf`, los empleados de qwen
también funcionan.

Pruebas:

```bash
cd app
npm run prueba:unidad   # rutas, adaptadores, instalación y Ollama (sin Docker)
npm run prueba          # todas, incluidas las computadoras con contenedores reales
```

En Windows, la app y el modelo corren nativos y solo las computadoras de los
empleados van en una distro WSL2 propia con Podman. Para probarlo en una PC
real sigue [`PRUEBAS_WINDOWS.md`](PRUEBAS_WINDOWS.md); al abrir la app por
primera vez, **Preparar** activa WSL2 (pide permiso de administrador), crea la
distro e instala Podman. Los archivos de cada empleado quedan en
`\\wsl$\discalaves\home\discalaves\trabajo\<empleado>`.

## Qué falta

- **Windows:** nunca se ha probado en una PC real (WSL2, reenvío de puertos de
  la pantalla en vivo, llama.cpp con CUDA, memoria con varios empleados).
- **Descargas reales:** Ollama, `qwen3:8b` y la instalación de Podman con
  `pkexec` en una distro limpia solo se han probado contra servidores falsos o
  en parte.
- **Modelos fuera del equipo:** ningún proveedor ni servidor remoto real, ni
  Codex con una cuenta real; solo servidores falsos locales.
- **Motor de contenedores:** Podman rootless solo se ha probado en un contenedor
  que simula WSL, no como motor principal en un equipo; falta empaquetar uno
  propio para Linux.
- **OpenClaw:** probado en Linux con tareas cortas; faltan tareas largas, varios
  empleados a la vez y Windows.
- **Varios empleados a la vez:** la memoria RAM con muchos contenedores
  trabajando sin medir.
- **Distribución:** el instalador de Linux se genera a mano; falta publicar
  descargas.
- **Más adelante:** Mac, microVMs como modo seguro, y conectores (Matrix,
  Discord, Telegram) y acceso desde el celular.

## Licencia

Apache License 2.0. Consulta [LICENSE](LICENSE) y [NOTICE](NOTICE).

Discalaves — Copyright 2026 Disca.
