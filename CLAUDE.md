# Discalaves — contexto para Claude Code

Lee este archivo completo antes de trabajar en el repositorio. Resume qué es
el proyecto, qué está decidido y qué sigue pendiente.

## Qué es

Discalaves es un proyecto open source (Apache-2.0) creado por Disca. Es una
alternativa local y abierta a Grok Bot (x.ai/bot): un equipo de "empleados"
de IA (mínimo 5) a los que el usuario les asigna tareas como a compañeros de
trabajo. Cada empleado tiene su propia computadora aislada, la usa por su
cuenta y trabaja de forma agéntica.

No es una automatización personal: es un proyecto público para que lo
instale cualquiera. Grok/xAI solo se mencionan como referencia; nunca como
nombre o identidad del proyecto.

- Repositorio: https://github.com/discajapon/discalaves (rama `main`).
- Nombre: "Discalaves"; en minúsculas solo en el nombre del repositorio.
- Licencia: Apache-2.0. Crédito en `NOTICE`: "Discalaves — Copyright 2026 Disca".
  No modificar `LICENSE`.

## Estado actual

En diseño. Hay un prototipo en `app/` (Electron + TypeScript, sin framework
de UI) con un contacto principal, **qwen**, con el que se conversa de verdad:
el proceso principal (`app/src/main.ts`) lanza `llama-server` (llama.cpp,
API compatible con OpenAI) en `127.0.0.1:8089` con una clave aleatoria por
sesión, y la interfaz habla con él solo por IPC (`app/src/preload.ts`), con
respuestas en streaming. qwen ya usa herramientas (bucle de agente propio en
`main.ts`, máximo 8 pasos por mensaje; ver `app/src/herramientas.ts`):
`terminal`, `escribir_archivo`, `buscar_web`, `abrir_pagina`, `ver_pagina`,
`hacer_clic` y `escribir_en`. Cumple el criterio 1 de "listo" (investiga en
la web y deja un informe en un archivo, ~30 s) desde su propia computadora
(un contenedor Debian con escritorio). Todavía no hay varios empleados (el
criterio 2 necesita un segundo empleado). Arranque: `cd app && npm install &&
npm start` (requiere Docker usable sin sudo; la primera vez construye la
imagen, ~2 min).

- Runtime y modelo, fuera del repositorio, en `~/Documents/IA-discalves`
  (cambiable con la variable `DISCALAVES_IA`): `llama.cpp/` (binarios
  oficiales con CUDA 12.8, versión en `llama.cpp/VERSION`) y
  `modelos/Qwen3.5-9B-Q4_K_M.gguf` (unsloth/Qwen3.5-9B-GGUF). El instalador
  futuro deberá traer ambos.
- Servidor: contexto 16384 con caché KV en q8_0, 1 slot, razonamiento desactivado,
  `-fitt 256` (con el margen por defecto de 1 GB, en 8 GB de VRAM quedaban
  capas en CPU: ~13 tok/s frente a ~32 tok/s). Log en
  `~/.config/discalaves/llama-server.log`.
- Historial: una conversación por IA en `~/.config/discalaves/conversaciones/`
  (`<id>.json`, más `indice.json` con la lista); al modelo se le envían los
  últimos ~32 000 caracteres (~10 000 con Ollama, que recorta a ~4k tokens por
  defecto), siempre empezando en un mensaje del usuario.
- Otras IAs vía **Ollama** (si el usuario lo tiene instalado): el botón + del
  lateral abre un menú con qwen y los modelos de `127.0.0.1:11434`
  (`/api/tags`; `/api/show` dice si admiten herramientas). Elegir uno abre su
  conversación (una por IA) y habla con su API compatible con OpenAI. Los
  modelos sin herramientas se marcan "solo chat" en negrita y reciben un
  mensaje de sistema que les prohíbe fingir que navegan o ejecutan comandos.
  Cada IA con herramientas tiene su propia computadora (contenedor, ver
  abajo; `computadora()` en `main.ts`) con su carpeta
  `IA-discalves/trabajo/<usuario>` como `/home/<usuario>` y su propio
  navegador (`Navegador` en `navegador.ts`). La pantalla en vivo muestra la de la
  conversación abierta. Limitaciones: solo una conversación trabaja a la vez
  (las demás reciben "está trabajando; espera"). Con qwen cargado, Ollama no
  tuvo RAM para gemma3:4b (necesitaba 3,9 GiB, había 2,2): la app lo explica
  en el hilo.
- Computadora de cada IA (desde 2026-09-27): un contenedor con **Debian 13
  (trixie)**, escritorio XFCE mínimo, terminal de XFCE, Chromium con ventana
  y KasmVNC (`app/computadora/Dockerfile`, imagen base fijada por digest y
  `.deb` de KasmVNC verificado con sha256). Se enciende en su primer uso y se
  apaga al cerrar la app (también al cerrarla con una señal); al arrancar se
  borran restos de sesiones anteriores. `app/src/computadora.ts` es el único
  módulo que llama al motor de contenedores: `docker` por defecto,
  `DISCALAVES_MOTOR=podman` para Podman (el Dockerfile es OCI estándar; con
  Podman aún no se ha probado). Encima de la imagen base se construye una
  capa mínima por IA con su usuario (mismo uid que el usuario del equipo).
  Endurecimiento: usuario sin privilegios, `--cap-drop=ALL`,
  `no-new-privileges`, raíz de solo lectura (`/tmp` y `/run` en tmpfs), 2 GB
  de memoria y 512 procesos como máximo, sin socket de Docker, y del equipo
  solo se monta su carpeta. Puertos (KasmVNC y CDP) publicados solo en
  `127.0.0.1` con puerto aleatorio. `npm run prueba` comprueba el
  aislamiento con contenedores reales, también entre dos IAs.
- Mediciones (RTX 3060 Ti, 16 GB de RAM): imagen base ~1,6 GB en disco
  (~410 MB comprimida); la capa de cada IA es mínima. Primera construcción
  ~2 min. Arranque hasta ver el escritorio en la app: ~6,5 s (KasmVNC listo
  en ~0,7 s tras `run`). RAM de un contenedor: ~220 MB en reposo (escritorio
  sin Chromium), ~790 MB trabajando (con Chromium navegando).
- Navegador (`app/src/navegador.ts`): Playwright se conecta por CDP al
  Chromium con ventana del escritorio del contenedor (se abre en su primer
  uso; `socat` reenvía el CDP porque Chromium solo escucha en su loopback) y
  lo controla por el árbol de accesibilidad. Búsquedas en Bing (DuckDuckGo y
  Mojeek bloquean el navegador automatizado). Chromium corre con
  `--no-sandbox`: el aislamiento lo da el contenedor.
- Pantalla en vivo: el ícono de monitor muestra el escritorio entero con el
  cliente web de KasmVNC en un iframe; solo hay conexión mientras el panel
  está abierto. KasmVNC tiene dos usuarios con claves aleatorias por sesión
  (como la de llama-server), que el proceso principal entrega en el evento
  `login`: "ver" solo mira y "control" usa teclado y ratón ("tomar el
  control"). Mientras el usuario tiene el control, las herramientas del
  navegador le dicen a la IA que espere. Portapapeles desactivado.
- `sudo` (decisión del usuario, 2026-09-25): un comando que empieza por
  `sudo` sale del contenedor y corre en el sistema real mediante `pkexec`, que
  muestra el diálogo de GNOME para la contraseña; ni la app ni el modelo la
  ven. Es la única vía para acciones de administrador.
- Aprobación de acciones delicadas (borrar, enviar, pagar): obligatoria en el
  código (`delicado()` en `herramientas.ts`): `rm`/`rmdir`/`-delete` en la
  terminal, clics en botones como "enviar", "pagar", "comprar", "borrar", y
  enviar formularios que no son de búsqueda. La interfaz muestra una tarjeta
  con "permitir"/"no". Es por palabras clave: puede dejar pasar acciones
  delicadas con otros nombres.

La interfaz se escribe como HTML/CSS/TS estándar para poder servirla como web
local (y en el celular) más adelante; Electron es solo la ventana. Los tokens
de diseño viven en `app/estilos.css` (nada de hex sueltos). El "vidrio
líquido" (filtro SVG de refracción vía `backdrop-filter: url(#vidrio)`) solo
funciona en Chromium.

## Principios

1. **Cero fricción.** Un instalador nativo que trae todo. Sin Docker, sin
   pasos previos, sin guías largas. Al terminar se abre una interfaz web con
   los empleados listos.
2. **Privacidad primero.** Modelos locales por defecto. Las APIs externas
   (gratuitas o de pago) son opcionales, las activa el usuario y llevan un
   aviso claro de que los datos salen de su máquina.
3. **Honestidad con los modelos pequeños.** Tareas cortas con puntos de
   control, reportes de avance y pedir confirmación ante la duda. No prometer
   "trabajo terminado" como un modelo gigante en la nube.

## Decisiones tomadas (no se reabren)

Si alguna parece un error, se señala al usuario; no se cambia por cuenta
propia.

- **Plataforma v1:** solo Linux. Windows y Mac después.
- **Computadora de cada empleado:** contenedor endurecido — sin privilegios,
  sin acceso a carpetas personales ni a la red local del usuario, con salida
  a internet — con escritorio Linux liviano, navegador y terminal. El
  instalador trae su propio motor de contenedores rootless. La "computadora"
  es una pieza intercambiable: las microVMs entrarán después como modo seguro.
- **Escritorios en vivo:** visibles desde la interfaz web, con opción de
  tomar el control. Solo se transmiten cuando el usuario está mirando.
- **Cómo actúan los agentes:** por terminal y controlando el navegador por
  su estructura (DOM/accesibilidad), no haciendo clic por píxeles.
- **Modelos:** pieza enchufable — runtime local incluido, servidor local
  existente del usuario, o API compatible con OpenAI. Gestor de modelos
  dentro de la app: buscar, ver VRAM requerida vs disponible, descargar o
  cargar desde archivo local. Modelo asignable por empleado.
- **Modelo de desarrollo y pruebas:** Qwen 3.5 9B (Q4) únicamente.
- **Paralelismo según VRAM:** los empleados que no caben esperan en cola.
  Hardware mínimo: 8 GB de VRAM.
- **Agentes:** basados en OpenClaw (licencia MIT, requiere Node 24 o
  superior), empaquetado dentro del instalador.
- **Aprobación obligatoria** del usuario antes de acciones delicadas
  (borrar, enviar, pagar).
- **Organización:** el usuario es el jefe en la v1; los empleados se pasan
  trabajo en hilos compartidos. Sin empleado coordinador automático.
- **Memoria:** cada empleado guarda su memoria en archivos locales legibles
  y editables.
- **Interfaz:** web local propia, instalable como app en el celular.
  Matrix/Discord/Telegram quedan como conectores opcionales futuros.

## Fuera de la v1

- Aprender tareas mirando al usuario (grabar rutinas).
- Marketplace de bots.
- Empleado coordinador.
- Iniciar sesión en cuentas reales del usuario.
- Windows y Mac.
- MicroVMs.

## Pendientes y supuestos (sin resolver)

- **Motor de contenedores:** hoy es Docker (decisión del usuario,
  2026-09-27), aunque los principios dicen "sin Docker" y el instalador debe
  traer un motor rootless propio. El demonio de Docker corre como root y
  estar en el grupo `docker` equivale a ser root. Pendiente: probar con
  Podman rootless (`DISCALAVES_MOTOR=podman`) y empaquetarlo.
- **Red local:** los contenedores llegan a la red local de la casa (probado:
  responde el router de la casa). No se añadieron reglas de firewall.
  Los servicios del equipo que escuchan solo en 127.0.0.1 (llama-server,
  Ollama) no son accesibles. El CDP y KasmVNC publicados en 127.0.0.1 los
  puede usar cualquier proceso local del usuario (KasmVNC pide clave; el CDP
  no).
- **sudo:** con una computadora propia, tendría más sentido que `sudo`
  actuara dentro del contenedor (por ejemplo `apt install` en su Debian) y no
  en el sistema real; hoy la IA no tiene root en su contenedor.
- **Lenguaje:** TypeScript en todo el proyecto. Supuesto provisional, porque
  OpenClaw trae Node.
- **OpenClaw con modelos pequeños:** verificar que funcione con modelos
  locales pequeños y medir el peso de su runtime. Si falla, se hará un bucle
  de agente propio. Lo investiga otra sesión.
- **Riesgo abierto (ya observado con Ollama + qwen):** consumo de RAM del sistema con varios escritorios y
  navegadores a la vez.

## Criterios de "listo" de la v1

Con Qwen 3.5 9B en una RTX 3060 Ti de 8 GB:

1. Un empleado investiga un tema en la web y deja un informe en un archivo.
2. Un empleado investiga y le pasa el resultado a otro, que lo resume.

## Modo de trabajo

- Hacer commit y push directo a `main` después de cada cambio coherente.
- Commits pequeños y numerosos: una actualización entera se reparte en
  varios commits (orientativo 4–7), cada uno con un paso que compile por sí
  solo (p. ej. estructura HTML, estilos, lógica, correcciones), no en uno
  solo. Un cambio realmente pequeño puede ir en un único commit.
- Mensajes de commit claros, en español.
- Credenciales: se usan las ya configuradas en la máquina (`gh` como helper
  de git por HTTPS). No crear tokens ni cambiar la configuración global de git.
- La documentación pública (README) no promete capacidades que aún no existen.
