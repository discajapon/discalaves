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
de UI) con **empleados** (perfiles con rol propio, ver abajo) con los que se
conversa de verdad; por defecto todos usan **qwen** (Qwen 3.5 9B):
el proceso principal (`app/src/main.ts`) lanza `llama-server` (llama.cpp,
API compatible con OpenAI) en `127.0.0.1:8089` con una clave aleatoria por
sesión, y la interfaz habla con él solo por IPC (`app/src/preload.ts`), con
respuestas en streaming. Los empleados usan herramientas (bucle de agente propio en
`main.ts`, sin límite de pasos: trabaja hasta acabar; ver `app/src/herramientas.ts`):
`terminal`, `escribir_archivo`, `buscar_web`, `abrir_pagina`, `ver_pagina`,
`hacer_clic` y `escribir_en`. Cumple el criterio 1 de "listo" (investiga en
la web y deja un informe en un archivo, ~30 s) desde su propia computadora
(un contenedor Debian con escritorio). Ya hay varios empleados y, con
`pasar_trabajo` activado, uno le pasa una tarea a otro (criterio 2 probado
el 2026-09-29: Qwen leyó una web y el Redactor la resumió; falta el hilo
compartido). Arranque: `cd app && npm install &&
npm start` (requiere Docker usable sin sudo; la primera vez construye la
imagen, ~2 min).

- Runtime y modelo, fuera del repositorio, en `~/Documents/IA-discalves`
  (cambiable con la variable `DISCALAVES_IA`): `llama.cpp/` (binarios
  oficiales con CUDA 12.8, versión en `llama.cpp/VERSION`) y
  `modelos/Qwen3.5-9B-Q4_K_M.gguf` (unsloth/Qwen3.5-9B-GGUF). El instalador
  futuro deberá traer ambos.
- Servidor: contexto 16384 con caché KV en q8_0, 1 slot, razonamiento desactivado,
  `-fitt 256` (con el margen por defecto de 1 GB, en 8 GB de VRAM quedaban
  capas en CPU: ~13 tok/s frente a ~32 tok/s) y `-cram 1024` (la caché de
  prompts en RAM llega por defecto a 8 GB: con 3 empleados y sus
  computadoras, en 16 GB el sistema mató a llama-server por falta de
  memoria, 2026-09-28). Log en
  `~/.config/discalaves/llama-server.log`.
- Historial: una conversación por empleado en `~/.config/discalaves/conversaciones/<id>.json`
  (el `indice.json` antiguo de esa carpeta ya no se usa: solo sirve para migrar); al modelo se le envían los
  últimos ~32 000 caracteres (~10 000 con Ollama, que recorta a ~4k tokens por
  defecto), siempre empezando en un mensaje del usuario.
- **Empleados como perfiles** (desde 2026-09-28, ver la decisión abajo):
  cada empleado es una carpeta de texto en `~/.config/discalaves/empleados/<id>/`
  (`empleados.ts`): `identidad.md` (encabezado `nombre`, `rol`, `color`,
  `modelo` = `qwen` u `ollama:<modelo>`, `herramientas`; debajo, tono y 3–5
  reglas, <150 palabras), `procedimientos/*.md` (el oficio: pasos y formato
  de salida; NO van en el prompt, solo un índice nombre + descripción, y se
  leen con la herramienta `leer_procedimiento`) y `memoria.md` (notas que
  añade `recordar`; al prompt van las más recientes hasta 1500 caracteres).
  `empleados/indice.json` guarda orden, carpeta de su computadora
  (`usuario`), modo libre y si su modelo usa herramientas. Se relee de disco
  en cada mensaje: una edición a mano se nota en el siguiente. Al modelo solo
  se le envían las herramientas del puesto (más `leer_procedimiento` y
  `recordar`) y la app rechaza cualquier otra. Herramientas **adicionales**
  (inspiradas en OpenClaw, 2026-09-29), apagadas en todas las plantillas y
  activables por empleado en su perfil: `leer_archivo`, `editar_archivo`
  (reemplazo exacto y único), `leer_web` (curl desde su computadora, solo
  http/https, HTML a texto), `preguntar` (para la tarea y deja la pregunta en
  el hilo) y `pasar_trabajo` (la tarea entra en el hilo del compañero como
  "(tarea de X)", trabaja con sus herramientas y su respuesta vuelve como
  resultado; sin encargos en círculo; Detener corta la cadena). Probadas con
  Qwen 9B: las cinco funcionan; `preguntar` solo la usa si se le pide
  explícitamente (si no, pregunta en texto). Prompt de sistema = base común
  (`baseConHerramientas` en `main.ts`) + lo propio del empleado
  (`promptEmpleado`). 7 plantillas en `app/plantillas/`: asistente,
  investigador, redactor, marketing, contador, talento-humano y
  desarrollador (2–3 procedimientos cada una; contador y talento humano sin
  terminal). El botón + abre "nuevo empleado": una plantilla o "describir el
  puesto" (qwen redacta un borrador que el usuario revisa); en ambos casos se
  elige el modelo. Desde la cabecera: editar el perfil y abrir su carpeta.
  Migración (una vez, si no existe `empleados/`): la conversación de qwen
  pasa a "Asistente" (id `qwen`, misma computadora) y las de Ollama a
  asistentes con su modelo, sin perder historial.
  - Verificación de honestidad (`verificar()` en `herramientas.ts`): al
    terminar una tarea, si el empleado dice que guardó un archivo sin
    `escribir_archivo`, o cita una dirección que no salió de ninguna
    herramienta ni del usuario, la app retira esa respuesta y le pide que lo
    haga o diga que no pudo (una vez por tipo y tarea). Hacía falta: Qwen 9B
    afirmó guardar un informe que no guardó y dio una web oficial "confirmada"
    sin abrirla.
  - Mediciones (qwen, 2026-09-28): prompt de sistema 526–549 tokens por
    empleado (303 de la base común + 223–246 propios) más los esquemas de 6–7
    herramientas (~1300–1400 tokens en total con el primer mensaje). Primer
    token al estrenar un empleado: ~0,95 s; al seguir con el mismo o volver a
    uno anterior: 0,24–0,35 s (la caché en RAM recupera su estado). La base
    común **no** se reutiliza al cambiar a un empleado distinto: Qwen 3.5 es
    híbrido (capas recurrentes) y llama.cpp no puede recortar su estado a un
    prefijo; los puntos de control solo guardan el final de cada prompt.
  - Cómo sigue Qwen 9B los procedimientos: los lee antes de la tarea (3 de 3
    empleados probados) y copia el formato de salida; el Desarrollador cumplió
    todos los pasos (README, prueba, ejecución). Falla en: saltarse pasos
    obligatorios si cree saber la respuesta (el Contador respondía de memoria
    sin buscar; se corrigió endureciendo el procedimiento y con la
    verificación), llamar "fuente oficial" a una web que él mismo dice que no
    lo es, y aplicar una regla añadida a mano (2 de 3 veces). Los borradores
    de "describir el puesto" salen usables pero a veces con herramientas de más
    (`hacer_clic`, `escribir_en`).
- Otras IAs vía **Ollama** (si el usuario lo tiene instalado): cualquier
  empleado se puede asignar a un modelo de `127.0.0.1:11434` (`/api/tags`;
  `/api/show` dice si admiten herramientas) y habla con su API compatible con
  OpenAI. Los modelos sin herramientas se marcan "solo chat" en negrita y reciben un
  mensaje de sistema que les prohíbe fingir que navegan o ejecutan comandos.
  Cada empleado con herramientas tiene su propia computadora (contenedor, ver
  abajo; `computadora()` en `main.ts`) con su carpeta
  `IA-discalves/trabajo/<usuario>` como `/home/<usuario>` y su propio
  navegador (`Navegador` en `navegador.ts`). La pantalla en vivo muestra la de la
  conversación abierta. Paralelo (decisión del usuario, 2026-09-30): los
  empleados de qwen trabajan a la vez con el mismo modelo cargado
  (`RANURAS` = 3 ranuras de llama-server, `-c 32768 -kvu`: contexto
  compartido; los que no caben esperan en la cola del servidor; VRAM y
  velocidad **sin medir todavía**). Un empleado de Ollama no trabaja a la vez
  que otro local (carga otro modelo en la misma VRAM). Con qwen cargado, Ollama no
  tuvo RAM para gemma3:4b (necesitaba 3,9 GiB, había 2,2): la app lo explica
  en el hilo.
- Computadora de cada IA (desde 2026-09-27): un contenedor con **Debian 13
  (trixie)**, escritorio XFCE mínimo, terminal de XFCE, Chromium con ventana
  y KasmVNC (`app/computadora/Dockerfile`, imagen base fijada por digest y
  `.deb` de KasmVNC verificado con sha256). Se enciende en su primer uso y se
  detiene al cerrar la app (también al cerrarla con una señal); el
  contenedor **persiste** entre sesiones (lo instalado con `sudo` se
  conserva) y se recrea solo si cambia la imagen. `app/src/computadora.ts` es el único
  módulo que llama al motor de contenedores: `docker` por defecto,
  `DISCALAVES_MOTOR=podman` para Podman (el Dockerfile es OCI estándar; con
  Podman aún no se ha probado). Encima de la imagen base se construye una
  capa mínima por IA con su usuario (mismo uid que el usuario del equipo).
  Endurecimiento: la IA trabaja como usuario sin privilegios y sin
  capacidades (no puede escribir fuera de su `/home`), `no-new-privileges`,
  `--cap-drop=ALL` más solo CHOWN, DAC_OVERRIDE, FOWNER, SETUID y SETGID para
  el root del contenedor (lo que necesita `apt`), `/tmp` y `/run` en tmpfs,
  2 GB de memoria y 512 procesos como máximo, sin socket de Docker, una red
  propia por IA (en la compartida una IA llegaba al CDP de otra), y del
  equipo solo se monta su carpeta. Las claves de KasmVNC llegan en un
  archivo de un solo uso en su carpeta, que `iniciar.sh` lee y borra. Puertos (KasmVNC y CDP) publicados solo en
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
  lo controla por el árbol de accesibilidad. Búsquedas en DuckDuckGo (versión
  HTML) con Yahoo de respaldo: Bing le sirve resultados de relleno sin
  relación con la consulta al navegador automatizado (probado 2026-09-28,
  también con perfil limpio); Brave, Startpage y Qwant no devuelven nada y
  Mojeek pide captcha. Chromium corre con
  `--no-sandbox`: el aislamiento lo da el contenedor.
- Pantalla en vivo: el ícono de monitor muestra el escritorio entero con el
  cliente web de KasmVNC. Cambio instantáneo (decisión del usuario,
  2026-09-30: prima la inmediatez sobre el consumo): al arrancar, la app
  enciende todas las computadoras (una tras otra) y la interfaz tiene un
  iframe por empleado, siempre conectado y apilado con los demás; cambiar de
  empleado o abrir el panel solo cambia cuál se ve (~0,1 s medido; ocultos con
  `visibility`, no `display`, para que no pierdan su tamaño). Coste: ~220 MB
  de RAM por computadora en reposo y transmisión continua. KasmVNC tiene dos usuarios con claves aleatorias por sesión
  (como la de llama-server), que el proceso principal entrega en el evento
  `login`: "ver" solo mira y "control" usa teclado y ratón ("tomar el
  control"). Mientras el usuario tiene el control, las herramientas del
  navegador le dicen a la IA que espere. Portapapeles desactivado. No poner
  `outline`/borde al iframe: dentro de un panel con `backdrop-filter:
  url(#vidrio)`, Chromium aplica el filtro de vidrio encima del escritorio y
  lo deja borroso (el aviso de control es un anillo del propio panel). La
  calidad de imagen la decide el servidor (`kasmvnc.yaml`); KasmVNC ignora
  los parámetros de calidad del cliente.
- **Windows** (desde 2026-09-28; **sin probar en una PC real**, ver
  `PRUEBAS_WINDOWS.md`): modo híbrido. La app de Electron y llama-server (binarios
  oficiales de llama.cpp para Windows con CUDA, mismos parámetros) corren
  nativos; solo las computadoras de los empleados corren en una distro WSL2
  propia, "discalaves", con **Podman rootless** y la misma imagen. Nada de
  Docker Desktop.
  - `app/src/rutas.ts` es el único módulo que decide rutas: en Windows,
    runtime, modelos y datos en `%LOCALAPPDATA%\Discalaves` (datos en
    `…\datos`, disco de la distro en `…\wsl`); las carpetas de trabajo
    viven dentro de la distro (`/home/discalaves/trabajo/<usuario>`) y la app
    las ve como `\\wsl$\discalaves\home\discalaves\trabajo\<usuario>`.
    `DISCALAVES_IA` sigue moviendo runtime y modelos.
  - `app/src/wsl.ts`: estado de WSL, activación (`wsl --install
    --no-distribution` con UAC, solo tras pulsar "Preparar" en la pantalla de
    primer arranque, `primer-arranque.ts`) y creación de la distro: raíz de
    Debian 13 = la capa de `debian:trixie-slim` que fija el Dockerfile,
    descargada del registro por su digest y verificada con sha256,
    `wsl --import`, y el script `PREPARAR` (usuario `discalaves` uid 1000,
    Podman, `/etc/wsl.conf` propio: systemd, sin discos ni programas de
    Windows). Nunca toca el `.wslconfig` global. Al cerrar la app se apaga la
    distro (`wsl --terminate`) para liberar memoria.
  - `computadora.ts` invoca `wsl.exe -d discalaves -u discalaves -- podman`,
    copia el contexto del Dockerfile dentro de la distro y monta la carpeta por
    su ruta de Linux. Diferencias de Podman que el código ya cubre (no
    quitarlas): `--userns=keep-id`; `setpriv` para que los procesos del
    usuario no hereden las capacidades de su `sudo` (Podman se las da como
    ambientales; Docker no); redes por IA creadas con `isolate=true` (Podman
    no las aísla entre sí por defecto); la red del contenedor se lee de
    `NetworkSettings.Networks` (en Podman `HostConfig.NetworkMode` dice
    "bridge").
  - Persistencia: el contenedor se reutiliza si coincide la **huella** de la
    imagen (sha256 de su configuración y sus capas), no su `.Id`: con Docker 29
    (almacén de containerd) el `.Id` cambia en cada build aunque todo salga de
    la caché, y en Linux la computadora se recreaba en cada arranque
    (corregido el 2026-09-28).
  - Probado de verdad en Linux: pruebas de unidad de rutas y adaptadores, y
    `prueba.ts` completa con Podman rootless dentro de un contenedor Debian 13
    que simula la distro (mismo `PREPARAR`, red del equipo como el reenvío de
    localhost de WSL). No probado: `wsl.exe`, la activación, el reenvío real de
    puertos de WSL, systemd y cgroups en WSL, llama.cpp con CUDA en Windows.
  - Instalador: `npm run instalador:win` (electron-builder, NSIS x64, menú
    Inicio). El workflow `.github/workflows/windows.yml` compila, pasa
    `prueba-unidad` y sube el instalador como artefacto (sin GPU ni WSL).
- `sudo` (decisión del usuario, 2026-09-27; reemplaza la del 2026-09-25 con
  `pkexec`): un comando que empieza por `sudo` corre como **root de su
  contenedor** (`exec -u 0`), sin contraseña, y nunca toca el sistema del
  usuario. La imagen trae un `sudo` sustituto para que un `sudo` a mitad de
  comando funcione dentro de ese root (no es setuid: `no-new-privileges` lo
  impediría).
- **Modo libre** (decisión del usuario, 2026-09-27): interruptor por IA en la
  cabecera, apagado por defecto y guardado en `indice.json`. Encendido: no
  pide aprobación para acciones delicadas, el mensaje de sistema le dice que
  actúe sin preguntar. Ojo: el
  contenedor protege el equipo, pero lo que haga en la web (enviar, pagar)
  es real.
- **Sin límite de pasos** (decisión del usuario, 2026-09-27, en ambos modos):
  la IA trabaja hasta acabar la tarea sin preguntar "¿sigo?"; el mensaje de
  sistema le pide contar en una frase cada paso y probar otro camino si algo
  falla. Frenos: el botón **Detener** (sustituye al de enviar mientras
  trabaja; aborta la respuesta en curso, cuenta como "no" las aprobaciones
  pendientes y deja "me detuviste" en el hilo; un comando que ya corre
  termina antes de parar) y la detección de repeticiones (misma herramienta
  con los mismos argumentos: a la 3.ª no se ejecuta y se le pide otro camino,
  a la 5.ª se detiene y lo explica). Si una sola tarea no cabe en la ventana,
  `contexto()` recorta las salidas de herramientas más antiguas (las 3
  últimas quedan enteras). Choca con el principio 3 (puntos de control):
  lo decidió el usuario.
- Aprobación de acciones delicadas (borrar, enviar, pagar): obligatoria en el
  código salvo en modo libre (`delicado()` en `herramientas.ts`): `rm`/`rmdir`/`-delete` en la
  terminal, clics en botones como "enviar", "pagar", "comprar", "borrar", y
  enviar formularios que no son de búsqueda. La interfaz muestra una tarjeta
  con "permitir"/"no". Es por palabras clave: puede dejar pasar acciones
  delicadas con otros nombres.

- **Orígenes de modelo fuera del equipo** (decisión del usuario, 2026-09-29; código en
  `proveedores.ts`, `boveda.ts`, `gasto.ts`, `tunel.ts`, `codex.ts`): el usuario elige el
  origen de cada empleado y la app **nunca lo cambia por su cuenta** (ni por velocidad, ni
  por cola, ni si algo falla). Mismo prompt base y reglas que los locales.
  - API con clave: OpenAI, Gemini, Claude (adaptador nativo) y cualquier servidor compatible
    con OpenAI. Modelos listados desde el proveedor; los que no admiten herramientas son
    "solo chat". Perfil: `modelo: nube:<id>:<modelo>`.
  - Servidor remoto del usuario: URL directa (HTTPS con clave) o túnel SSH con su configuración
    (alias, ProxyJump). Huella del host confirmada en el primer contacto; contraseña solo en
    memoria; si el túnel cae, el empleado se detiene y avisa, sin reconexión. Sin SLURM.
  - Claves y URLs con credenciales: un único archivo cifrado (`safeStorage`); sin almacén
    seguro no se guarda nada. Nunca en perfiles, contenedor, prompt ni logs.
  - Privacidad: aviso concreto al asignar un origen externo y marca permanente en la lista
    (distinta para nube y servidor remoto). Gasto por empleado con tabla de precios editable
    y tope mensual (13 USD por defecto) que pausa y pregunta; un corte del proveedor detiene
    y avisa, sin reintentos. Los externos no esperan en la cola de VRAM.
  - **ChatGPT vía Codex** ("no oficial, puede dejar de funcionar"): el usuario instala el CLI
    aparte (Apache-2.0) e inicia sesión con `codex login`; Discalaves no toca sus tokens. Corre
    en el equipo con TODAS sus herramientas propias apagadas y solo las de Discalaves, servidas
    por MCP hacia el contenedor; `sonda()` lo comprueba antes de usarlo.
  - **Claude por suscripción (Agent SDK): NO implementado** (revisado 2026-09-30). Las
    condiciones oficiales ([Legal y cumplimiento de Claude Code](https://code.claude.com/docs/en/legal-and-compliance))
    dicen que Anthropic no permite a terceros "route requests through Free, Pro, or Max plan
    credentials on behalf of their users" y piden clave de API para productos con el Agent SDK.
    Otra página ([Agent SDK con tu plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan))
    dice lo contrario y está marcada como en pausa; ante la contradicción manda la más
    restrictiva. Claude se usa solo con clave de API. Revisar si Anthropic las aclara.
  - Probado con un servidor falso (`npm run prueba:nube`, dentro de `npm run prueba`): respuestas,
    herramientas, tokens, cuota, caídas, bóveda, túnel contra un sshd local, sonda de Codex y la
    app real (criterio 1 en contenedor, local y nube a la vez, tope, claves ausentes del disco
    en claro). **No probado:** ningún proveedor ni servidor real, Codex con cuenta real, túnel con
    ProxyJump real, Windows. **RAM con varios contenedores trabajando a la vez: sin medir.**

**Diseño:** antes de tocar estilos, filtros SVG o animaciones, lee
`GUIA_DE_DISEÑO.md` (reglas del vidrio líquido, tokens, recetas de
materiales, patrones de movimiento y plantillas de componentes).

La interfaz se escribe como HTML/CSS/TS estándar para poder servirla como web
local (y en el celular) más adelante; Electron es solo la ventana. Los tokens
de diseño viven en `app/estilos.css` (nada de hex sueltos). El "vidrio
líquido" (filtro SVG de refracción vía `backdrop-filter: url(#vidrio)`) solo
funciona en Chromium.

Cambio de conversación (preferencia del usuario, 2026-09-27): la única
animación es la lente de vidrio de la lista lateral, que viaja como una gota
de la conversación actual a la elegida (`moverLente()` en `interfaz.ts`),
con un toque del color de esa IA. Nada de ondas ni deformaciones en el hilo,
en las filas ni en el resto de la pantalla.

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

- **Plataforma v1:** Linux y Windows (computadoras vía WSL2); Mac después
  (decisión del usuario, 2026-09-28).
- **Computadora de cada empleado:** contenedor endurecido — sin privilegios,
  sin acceso a carpetas personales ni a la red local del usuario, con salida
  a internet — con escritorio Linux liviano, navegador y terminal. El
  instalador trae su propio motor de contenedores rootless. La "computadora"
  es una pieza intercambiable: las microVMs entrarán después como modo seguro.
- **Escritorios en vivo:** visibles desde la interfaz web, con opción de
  tomar el control. Se transmiten siempre para que cambiar de empleado sea
  instantáneo (decisión del usuario, 2026-09-30; antes: solo mientras mira).
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
- **Empleados como perfiles** (decisión del usuario, 2026-09-28): un empleado
  es un perfil en archivos (identidad corta, herramientas permitidas,
  procedimientos que se leen bajo demanda y memoria) asignado a un modelo;
  por defecto todos comparten el mismo Qwen 9B cargado, así especializarse no
  cuesta VRAM. Nada de adaptadores LoRA. Varios slots sí (decisión del
  usuario, 2026-09-30): para que trabajen a la vez.
- **Interfaz:** web local propia, instalable como app en el celular.
  Matrix/Discord/Telegram quedan como conectores opcionales futuros.

## Fuera de la v1

- Aprender tareas mirando al usuario (grabar rutinas).
- Marketplace de bots.
- Empleado coordinador.
- Iniciar sesión en cuentas reales del usuario.
- Mac.
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
- **Windows sin probar:** falta pasar `PRUEBAS_WINDOWS.md` en una PC con GPU
  NVIDIA. Riesgos: WSL usa por defecto hasta la mitad de la RAM (cada empleado
  ~0,8 GB trabajando, más el modelo en Windows); el reenvío de puertos de
  KasmVNC y CDP a 127.0.0.1 de Windows depende de `localhostForwarding` (activo
  por defecto) del `.wslconfig` del usuario; los límites de memoria de Podman
  rootless necesitan cgroups delegados (por eso systemd en la distro); primera
  descarga ~0,5 GB (Debian, Podman, imagen) más el modelo (5,7 GB) y llama.cpp
  con CUDA (~0,6 GB), que todavía se colocan a mano.
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
