# Guía de diseño de Discalaves — vidrio líquido y animaciones

Esta guía es la referencia visual del proyecto. **Léela entera antes de tocar
`app/estilos.css`, `app/index.html` (filtros SVG) o cualquier animación de
`app/src/`**, igual que `CLAUDE.md` antes de tocar el código.

Orden de prioridad cuando algo choque:

1. Lo que el usuario decide en la conversación (y queda anotado en
   `CLAUDE.md`).
2. Esta guía.
3. Las referencias externas (liquidglassdesign.com, Apple). Sirven para
   inspirarse, no para copiarlas tal cual.

Si algo de esta guía deja de ser cierto porque cambió el código, actualiza la
guía en el mismo commit.

---

## 1. Qué es el vidrio líquido

La referencia es [liquidglassdesign.com](https://liquidglassdesign.com), una
colección de más de 170 diseños en el estilo que Apple presentó en la WWDC de
2025 (iOS 26, macOS 26 Tahoe) con el nombre de **Liquid Glass**. De su guía
([¿Qué es Liquid Glass?](https://liquidglassdesign.com/what-is-liquid-glass))
salen las ideas que usamos:

- **Es un material, no un color ni un filtro.** Una superficie de vidrio
  líquido se comporta como un objeto físico: una lente transparente que flota
  sobre el contenido.
- **Refracta, no solo desenfoca.** El *glassmorphism* de 2020 era una receta
  fija: fondo desenfocado, borde fino claro y sombra suave. El vidrio líquido
  *dobla* lo que hay detrás, como una lente de verdad: las líneas rectas se
  curvan en los bordes. Su frase: "el glassmorphism desenfoca lo que hay
  detrás; el Liquid Glass lo refracta".
- **Tiene brillos especulares.** Un reflejo de luz en el canto (arriba, casi
  siempre) que le da volumen.
- **Se tiñe con lo que pasa por debajo.** El color del vidrio se adapta al
  contenido y al fondo.
- **Se mueve como un líquido.** Las formas se estiran, se funden y cambian de
  forma entre estados. Casi todo lo que lo distingue del glassmorphism solo se
  ve cuando algo se mueve.

Lo que el propio sitio advierte, y aquí es regla:

- **El texto sobre vidrio, con un fondo movido, deja de leerse.** Por eso el
  vidrio es para la capa que *flota encima* del contenido (barras,
  controles, menús), **no para el contenido**. El texto largo no va sobre
  vidrio.
- **La contención demuestra intención.** "Vidrio sobre vidrio sobre vidrio
  parece una demo." Una o dos capas de vidrio y lo demás sólido.
- **El contraste es obligatorio.** Cada superficie de vidrio se prueba sobre
  el fondo más cargado donde pueda caer, no sobre uno cómodo.
- Apple tuvo que añadir un modo más opaco tras las quejas de legibilidad: la
  transparencia se dosifica.

---

## 2. Reglas de Discalaves (resumen)

1. **Nuestra paleta, nunca la de la referencia.** Los modelos del sitio usan
   azules y verdes, rosas y morados, neón, dorado… No se copia ninguna: se
   toma la estructura (capas, cantos, reflejos, movimiento) y se viste con
   los tokens de `estilos.css` (sección 3).
2. **Todo color, radio, espacio y curva sale de un token.** Nada de hex
   sueltos en reglas nuevas. Si hace falta un valor nuevo, se crea el token
   en `:root` con un comentario de para qué sirve. Los tintes se mezclan con
   `color-mix()` entre tokens.
3. **Vidrio solo en lo que flota:** barra lateral, cabecera, cuadro de
   mensaje, pantalla en vivo, menús, lente de selección e interruptores. Las
   burbujas del chat, los diálogos (perfil) y las tarjetas de aprobación son
   **sólidos**.
4. **Máximo dos capas de vidrio superpuestas** (por ejemplo, la barra
   lateral y la lente dentro de ella). No se pone vidrio dentro de vidrio
   dentro de vidrio.
5. **Solo se anima lo que cambia.** Una transición mueve el elemento
   implicado y nada más. **Prohibido** ondular, deformar o desplazar el hilo,
   las filas o la pantalla entera (decisión del usuario, 2026-09-27).
6. **Movimiento de líquido, corto y físico:** estirar, aplastar, rebotar un
   poco. Entre 200 y 650 ms. Nada de bucles decorativos.
7. **Toda animación respeta `prefers-reduced-motion`.** Con esa preferencia
   activa, el elemento salta a su estado final.
8. **Legibilidad antes que efecto:** contraste AA como mínimo (4,5:1 para
   texto normal), halo claro detrás del texto sobre vidrio muy transparente,
   foco visible siempre.

---

## 3. Paleta y tokens

Todos viven en `:root` de `app/estilos.css`. Esta tabla es el resumen; el
archivo es la fuente de verdad.

### 3.1 Base (superficies y texto)

| Token | Valor | Uso |
|---|---|---|
| `--fondo` | `#FFFFFF` | Fondo general y superficies sólidas (diálogos, aprobaciones). |
| `--lateral` | `#F8F8F8` | Tono de la barra lateral (anillos de avatares). |
| `--gris-suave` | `#F0F0F0` | Burbujas de la IA, buscador, botones secundarios, hover de íconos. |
| `--tinta` | `#1A1A1A` | Texto principal. |
| `--secundario` | `#5E5E5E` | Texto secundario (horas, vistas previas, etiquetas). Se oscureció desde `#8A8A8A` para cumplir AA incluso sobre vidrio: **no aclararlo**. |
| `--borde` | `#E5E5E5` | Bordes finos de superficies sólidas y barras de desplazamiento. |
| `--burbuja-mia` | `#111111` | Burbujas del usuario y botón principal (enviar, detener, "permitir"). |
| `--sobre-oscuro` | `#FFFFFF` | Texto e íconos sobre `--burbuja-mia` y sobre avatares. |
| `--notificacion` | `#E5484D` | Punto de no leído. |
| `--notificacion-texto` | `#C4262B` | Rojo para texto (errores, avisos, modo libre encendido): ≥4,5:1 sobre blanco. |
| `--velo` | negro al 35 % | Fondo detrás de diálogos modales y sombra grande. |

### 3.2 Acentos: el color de cada IA

| Token | Valor |
|---|---|
| `--acento-violeta` | `#7C5CE6` |
| `--acento-turquesa` | `#4DB6A5` |
| `--acento-naranja` | `#F0A030` |
| `--acento-azul` | `#3D7BF0` |
| `--acento-rojizo` | `#F06A35` |

- Cada IA (o empleado) tiene un acento, asignado en orden
  (`ACENTOS` en `interfaz.ts`: violeta, turquesa, naranja, azul, rojizo). Es
  su avatar y el tinte de su lente de selección.
- El azul también es el color del **foco** (`:focus-visible`) y de "tienes
  el control" en la pantalla en vivo.
- El rojo (`--notificacion-texto`) significa **peligro o sin red de
  seguridad**: errores y modo libre encendido. No se usa para decorar.
- Los acentos tiñen el vidrio **como máximo al 12–18 %**
  (`color-mix(in srgb, var(--acento) 12%, …)`). El vidrio es neutro con un
  toque de color, nunca un bloque de color.
- Las **manchas del fondo** (`.fondo .mancha`) son los acentos desenfocados
  60 px al 45 % de opacidad. Existen para que la refracción se note: sin
  ellas el vidrio sobre blanco parece plano. No se quitan ni se saturan más.

### 3.3 Vidrio

| Token | Valor | Papel en la receta |
|---|---|---|
| `--vidrio-tinte` | `#F8F8F8` al 55 % | Cuerpo de los paneles de vidrio (`.vidrio`). |
| `--vidrio-brillo` | blanco al 95 % | Canto especular superior (línea de 1 px arriba). |
| `--vidrio-canto` | blanco al 50 % | Canto interior de 1 px alrededor. |
| `--vidrio-canto-fuerte` | blanco al 85 % | Canto de lentes, tarjetas y menús (más marcado). |
| `--vidrio-reflejo` | blanco al 70 % | Reflejo radial de la parte de arriba. |
| `--vidrio-seleccion` | blanco al 28 % | Cuerpo de la lente de selección de la lista. |
| `--vidrio-lente` | blanco al 6 % | Cuerpo casi invisible de la gota del interruptor. |
| `--vidrio-widget` | blanco al 22 % | Cuerpo del menú tipo widget. |
| `--tarjeta-widget` / `--tarjeta-widget-activa` | blanco al 38 % / 66 % | Tarjeta en reposo / con el puntero encima o foco. |
| `--halo` | blanco al 85 % | `text-shadow` claro detrás del texto sobre vidrio muy transparente. |
| `--vidrio-sombra` | negro al 6 % | Sombra de contacto (1–3 px) y sombra interior inferior. |
| `--vidrio-sombra-fuerte` | negro al 18 % | Sombra de elevación (elementos que flotan más). |

### 3.4 Forma, espacio y letra

| Token | Valor | Uso |
|---|---|---|
| `--radio-fila` | 10 px | Filas, campos, lente de selección, escritorio en vivo. |
| `--radio-burbuja` | 16 px | Burbujas del chat. |
| `--radio-panel` | 18 px | Paneles grandes (lateral, cabecera, pantalla, diálogo). |
| `--radio-widget` | 24 px | Menús tipo widget. Las tarjetas dentro usan 18 px (concéntricas: radio interior = exterior − relleno). |
| `--radio-total` | 999 px | Píldoras y círculos (botones, avatares, cuadro de mensaje, interruptor). |
| `--e1 … --e8` | 4, 8, 12, 16, 24, 32 px | Escala de espacios. No inventar 10 px o 20 px sueltos. |
| `--fuente` | Inter, Cantarell, Noto Sans, system-ui | Texto. |
| `--fuente-mono` | JetBrains Mono, DejaVu Sans Mono | Comandos y salidas de herramientas. |
| `--texto` / `--texto-chico` | 15 px / 12 px | Cuerpo / secundario (≈ 0,8×). |
| `--rebote` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Curva de llegada con rebote de líquido. |

**Formas concéntricas** (idea de Apple): cuando una forma redondeada está
dentro de otra, su radio es el de la de fuera menos el hueco que las separa.
Así los bordes corren paralelos. Ejemplo: menú de 24 px con 12 px de relleno
→ tarjetas de 18 px (aproximado).

---

## 4. Materiales: las recetas

Una capa de vidrio de Discalaves se construye siempre con las mismas piezas,
de atrás hacia delante:

1. **Lo de detrás, doblado:** `backdrop-filter` con refracción SVG
   (`url(#vidrio)` o `url(#lente)`), opcionalmente con `blur()` y
   `saturate()`.
2. **Cuerpo:** un color translúcido (`--vidrio-tinte`, `--vidrio-seleccion`…).
3. **Tinte opcional:** un acento mezclado al 12 % hacia abajo.
4. **Reflejo:** `radial-gradient` blanco arriba a la izquierda
   (`--vidrio-reflejo` → transparente).
5. **Canto especular:** `inset 0 1px 0 var(--vidrio-brillo)` (una línea de luz
   en el borde superior).
6. **Canto interior:** `inset 0 0 0 1px var(--vidrio-canto…)`.
7. **Grosor abajo (opcional):** `inset 0 -3px 8px` con sombra o acento: el
   vidrio parece tener espesor.
8. **Elevación:** sombra exterior suave; cuanto más flota, más grande y difusa.

### 4.1 Panel de vidrio — `.vidrio`

Para barra lateral, cabecera, cuadro de mensaje y pantalla en vivo.

```css
.vidrio {
  background: var(--vidrio-tinte);
  backdrop-filter: url(#vidrio);            /* refracción en los bordes */
  box-shadow:
    inset 0 1px 0 var(--vidrio-brillo),     /* canto especular */
    inset 0 0 0 1px var(--vidrio-canto),    /* canto interior */
    0 1px 2px var(--vidrio-sombra);         /* contacto */
}
```

### 4.2 Lente — `.seleccion` y `.lente`

Un trozo de vidrio pequeño y más brillante que se mueve (la selección de la
lista, la gota del interruptor). Usa `url(#lente)`, pensado para elementos
pequeños.

```css
.seleccion {
  background:
    radial-gradient(120% 80% at 25% 0%, var(--vidrio-reflejo), transparent 60%),
    linear-gradient(to bottom, var(--vidrio-seleccion),
                    color-mix(in srgb, var(--acento) 12%, var(--vidrio-seleccion)));
  backdrop-filter: blur(6px) saturate(1.5) url(#lente);
  box-shadow:
    inset 0 1px 0 var(--vidrio-canto-fuerte),
    inset 0 0 0 1px var(--vidrio-canto),
    inset 0 -4px 10px color-mix(in srgb, var(--acento) 14%, transparent),
    0 4px 14px var(--vidrio-sombra-fuerte);
}
```

La lente va **detrás** del contenido (las filas tienen `z-index: 1` y la lente
`pointer-events: none`): marca, no tapa.

### 4.3 Vidrio de menú y widget — `.menu-ia`

Chromium **no aplica filtros SVG (`url()`) al fondo de lo que está en la capa
superior** (`popover`, `<dialog>` modal). Ahí el vidrio se hace sin
refracción: desenfoque fuerte, saturación, canto, reflejo y halo en el texto.

```css
.menu-ia {
  border-radius: var(--radio-widget);
  background:
    radial-gradient(120% 35% at 30% 0%, var(--vidrio-reflejo), transparent 70%),
    var(--vidrio-widget);
  backdrop-filter: blur(22px) saturate(1.8);
  text-shadow: 0 0 1px var(--halo), 0 0 8px var(--halo);   /* se lee sobre cualquier fondo */
  box-shadow:
    inset 0 1px 0 var(--vidrio-brillo),
    inset 0 0 0 1px var(--vidrio-canto-fuerte),
    0 20px 50px var(--vidrio-sombra-fuerte);
}
```

Las **tarjetas** dentro de un widget (`.opcion-ia`) son un segundo nivel de
vidrio sin desenfoque propio: cuerpo `--tarjeta-widget`, canto fuerte y, al
pasar el puntero o con foco, `--tarjeta-widget-activa` + reflejo + sombra de
elevación.

### 4.4 Superficies sólidas

Burbujas, diálogo de perfil, tarjetas de aprobación y campos de texto son
sólidos (`--fondo`, `--gris-suave`, `--burbuja-mia`) con bordes `--borde`. Es
deliberado: ahí se lee y se decide. Los diálogos modales se separan con
`--velo`, no con vidrio.

### 4.5 Botones

- **Principal** (enviar, detener, "permitir"): píldora o círculo sólido
  `--burbuja-mia` con `--sobre-oscuro`. Es la acción; no es de vidrio.
- **Secundario** (`.boton.secundario`): `--gris-suave` con `--tinta`.
- **Ícono** (`.icono`): 32 × 32 px como mínimo, fondo solo al pasar el
  puntero.
- **Botón de vidrio** (si hace falta uno flotante sobre contenido; referencia:
  *Liquid Glass Button in Framer*): receta de lente (4.2) sin tinte, texto en
  `--tinta`, y al pulsar `transform: scale(0.97)` con transición de 200 ms.

---

## 5. Técnica: cómo se hace la refracción en la web

La referencia distingue tres niveles:

1. **Solo CSS** (`backdrop-filter: blur()` + borde + sombra): funciona en
   todas partes, pero es glassmorphism, sin refracción.
2. **Filtros SVG** (`feDisplacementMap` con un mapa que dobla el fondo en los
   bordes): refracción real sin WebGL. **Es lo que usamos.**
3. **WebGL o shaders:** lo más fiel (refracción, dispersión de color,
   brillos), pero caro y complejo. No lo usamos.

### 5.1 Nuestros filtros (en `app/index.html`, dentro de `<svg class="oculto">`)

- **`#vidrio`** (paneles): un `feImage` genera un mapa de desplazamiento con
  dos degradados (rojo en horizontal, verde en vertical) y un rectángulo gris
  neutro desenfocado en el centro. Gris = sin desplazamiento, así que el
  centro no se deforma y los **bordes** refractan. Después: `feGaussianBlur`
  suave (2), `feDisplacementMap` con `scale="70"` y `feColorMatrix` de
  saturación 1,6.
- **`#lente`** (elementos pequeños): mismo principio con un degradado radial,
  para que la gota refracte en su contorno redondo.

Se aplican con `backdrop-filter: url(#vidrio)`. **Solo funciona en
Chromium**, que es lo que usa Electron. En otros navegadores, el día que
haya interfaz web, hará falta un respaldo con `blur()`.

### 5.2 Trampas conocidas

- **Capa superior** (popover, dialog modal): `url()` no se aplica; usar 4.3.
- **Iframes dentro de vidrio:** no poner `outline` ni borde al iframe de la
  pantalla en vivo. Chromium aplica el filtro de vidrio encima del escritorio
  y lo deja borroso. El aviso de control es un anillo del propio panel
  (`.pantalla.controlando`).
- **Recortes:** una lista con `overflow` recorta lo que se ensancha. Si algo
  debe crecer al animarse, que crezca hacia dentro (lección de la lente, que
  al ensancharse perdía los bordes).
- **Rendimiento:** cada `backdrop-filter` con `url()` cuesta. Pocas capas,
  `will-change` solo en lo que se mueve (la lente), y **nunca animar los
  atributos de un filtro SVG fotograma a fotograma** (así eran las ondas que
  se quitaron).

---

## 6. Movimiento

### 6.1 Principios

- **El movimiento revela el material.** El vidrio se entiende cuando se
  mueve: se estira al acelerar, se aplasta al frenar y rebota un poco al
  asentarse, como una gota.
- **Solo se mueve lo que cambia**, y desde donde estaba hacia donde va. La
  animación explica el cambio (de esta conversación a aquella), no decora.
- **Corto:** 200 ms para respuestas al tacto, 450–650 ms para viajes y
  aperturas. Cerrar es más rápido que abrir.
- **Físico, sin exagerar:** estiramientos del 5–40 %, aplastamientos de unos
  pocos píxeles, un rebote.
- **Continuidad:** si se interrumpe (otro clic a mitad), el elemento parte
  desde donde está, no salta.

### 6.2 Curvas y tiempos

| Uso | Curva | Duración |
|---|---|---|
| Llegada con rebote (interruptor, menú que se abre, tarjetas) | `var(--rebote)` = `cubic-bezier(0.34, 1.56, 0.64, 1)` | 450–500 ms |
| Salida suave (elementos que aparecen, deslizamientos) | `cubic-bezier(0.22, 1, 0.36, 1)` | 350 ms |
| Arrancar un viaje (acelera) | `cubic-bezier(0.55, 0, 0.35, 1)` | primer tramo |
| Cierre / desaparición | `ease` | 200–220 ms |
| Respuesta al tacto (hover, pulsar) | `ease` / `var(--rebote)` | 200 ms |
| Aparición escalonada de elementos de una lista | igual que la salida suave | +35 ms por elemento, empieza a los 90 ms |

### 6.3 Patrones (plantillas de animación)

**A. Gota que viaja — selección de la lista** (`moverLente()` en
`interfaz.ts`; es la **única** animación al cambiar de conversación). 520 ms
con fotogramas clave sobre `transform` y `height`:

1. 0 %: en la fila de origen.
2. 45 %: el borde delantero ya llegó a la fila de destino y el trasero sigue
   en el origen. La gota cubre las filas intermedias y se estrecha un poco
   (`scaleX(0.95)`).
3. 80 %: recoge el borde trasero y llega aplastada (2 px pasada y 4 px más
   baja). **No se ensancha**: la lista la recortaría.
4. 100 %: tamaño y sitio exactos de la fila.

Se tiñe con el acento de la IA de destino.

**B. Gota que crece desde su origen — menús** (`.menu-ia`). Se abre
escalando desde la esquina del botón que la abrió
(`transform-origin: top left`, de `scale(0.35, 0.15)` a `1`) con
`var(--rebote)` en 500 ms. Se cierra encogiéndose en 220 ms. Para que se
anime al aparecer: `@starting-style` y
`transition: … overlay … allow-discrete, display … allow-discrete`. Su
contenido aparece escalonado (`--orden` × 35 ms).

**C. Interruptor con lente** (`.modo-libre`). La gota se desliza con
`var(--rebote)` en 450 ms. Al pulsar se estira como una gota
(`scale(1.18, 0.88)`). La pista cambia de color en 300 ms (rojo = modo libre
encendido).

**D. Presión.** Tarjetas y botones de vidrio: `scale(0.97–0.98)` al pulsar,
200 ms con rebote al soltar.

**E. Latido de espera.** Los tres puntos de "pensando" bajan la opacidad a
0,3 en un ciclo de 1 s. Es la única animación en bucle permitida, porque
indica un proceso real, y se apaga con `prefers-reduced-motion`.

### 6.4 Prohibido

- Ondas, turbulencia (`feTurbulence`) o deformaciones del hilo, las filas o
  la pantalla. Se probaron y el usuario las rechazó.
- Animar la pantalla completa o varias zonas a la vez por un solo cambio.
- Bucles decorativos (brillos que recorren, fondos que respiran), parallax y
  animaciones de más de 700 ms.
- Animar atributos de filtros SVG por fotograma.
- Animaciones sin respaldo para `prefers-reduced-motion`.

### 6.5 Menos movimiento

En CSS, cada `transition`/`animation` nueva lleva su bloque:

```css
@media (prefers-reduced-motion: reduce) {
  .mi-componente { transition: none; animation: none; transform: none; }
}
```

En TypeScript se comprueba `sinMovimiento.matches` (un `matchMedia` en
`interfaz.ts`) y, si es verdadero, se salta directamente al estado final.

---

## 7. Plantillas de componentes (modelos del sitio → Discalaves)

Cada plantilla indica el modelo de la galería de
[liquidglassdesign.com/ui](https://liquidglassdesign.com/ui) que sirve de
referencia, qué se toma de él, qué se descarta y cómo se hace aquí. De todos
ellos se hereda la misma lista de cosas a **evitar**, que aparece en los
prompts de estilo del sitio: poco contraste, sombras duras, composición
recargada, esquinas afiladas, colores chillones o saturados, degradados
excesivos, demasiado texto.

### 7.1 Barra de pestañas / lista de navegación

- **Modelos:** *Liquid Glass Tab Bar UI* (Shamnad) y *Apple Liquid Glass
  Design Navigation Bar* (Nikolashvili Nodo).
- **Se toma:** una barra de vidrio esmerilado con la opción activa marcada
  por una pieza más brillante y con más brillo especular, iluminación
  ambiental suave, sombras mínimas y espacio entre elementos. La del tab bar
  es monocroma (negros y grises), igual que nuestra base.
- **Se descarta:** los rosas y morados de la barra de Nodo.
- **En Discalaves:** la barra lateral (`.lateral.vidrio`) con la lente
  `.seleccion` que viaja (patrón A). Si algún día hay pestañas horizontales,
  se usa la misma lente y el mismo viaje en horizontal (el borde delantero se
  adelanta por la izquierda o la derecha).

### 7.2 Barra de herramientas flotante

- **Modelo:** *Liquid Glass Camera Toolbar* (MAni Ghafouri).
- **Se toma:** controles que flotan sobre el contenido, en superficies
  redondeadas y brillantes, con profundidad por capas y sombra sutil.
- **Se descarta:** los pasteles con dorado.
- **En Discalaves:** la cabecera y el cuadro de mensaje flotan sobre el hilo,
  que pasa por debajo (`.hilo` tiene relleno arriba y abajo). Los controles
  nuevos de la cabecera (ver pantalla, modo libre) siguen esta pauta:
  íconos de 32 px o píldoras, nunca bloques rectangulares.

### 7.3 Widget

- **Modelo:** *Weather Widget Liquid Glass* (Rener Aljustyo).
- **Se toma:** tarjeta con esquinas generosas, capas translúcidas con el
  fondo visible detrás, luz difusa y jerarquía clara (dato grande, etiqueta
  pequeña).
- **Se descarta:** los azules.
- **En Discalaves:** el menú del + (`.menu-ia`, receta 4.3) con una tarjeta
  por IA (`.opcion-ia`): nombre grande, etiquetas en mayúsculas pequeñas con
  espaciado (`.etiqueta`, `.dato`) y estado con un punto de color. Cualquier
  panel de datos futuro (uso de VRAM, estado de un empleado) sigue esta
  plantilla.

### 7.4 Tarjeta

- **Modelos:** *Liquid glass card* (Serhii Antoniuk) y *LB\* Frosted Glass
  Card Design* (Lukáš Miško).
- **Se toma:** tarjeta esmerilada minimalista, bordes redondeados suaves y un
  único punto de atención.
- **Se descarta:** los azules claros.
- **En Discalaves:** una tarjeta sobre vidrio = cuerpo `--tarjeta-widget`,
  canto `--vidrio-canto-fuerte`, radio concéntrico con su contenedor y
  estado activo con reflejo y elevación. Una tarjeta **fuera** del vidrio
  (dentro del hilo) es sólida, como las aprobaciones.

### 7.5 Botón

- **Modelos:** *Liquid Glass Button in Framer* (Shaheer Malik) y los
  conceptos de botones de Designi.
- **Se toma:** botón redondeado, transparencia esmerilada, sombras suaves,
  reflejo sutil y paleta monocroma.
- **En Discalaves:** ver 4.5. La acción principal es sólida y oscura (más
  legible); el vidrio queda para botones que flotan sobre imagen o escritorio.

### 7.6 Interruptor

- **Modelos:** *Swap box liquid glass* (Serhii Antoniuk) y el "liquid glass
  switch" de Apple.
- **Se toma:** una gota de vidrio casi invisible (solo reflejo y canto) que
  se desliza sobre una pista y se estira al pulsar.
- **Se descarta:** los verdes.
- **En Discalaves:** `.modo-libre` (patrón C). Tiene `role="switch"` y
  `aria-checked`, y el texto al lado dice qué controla. El color de la pista
  lleva significado (rojo = sin aprobaciones), así que no se cambia por
  estética.

### 7.7 Panel de control o tablero

- **Modelos:** *iOS Liquid Glass Effect – Smart Home UI*, *Payrix SaaS –
  Mobile Finance Dashboard* y los reproductores de música (*Audio Player
  Card*, *Music App*).
- **Se toma:** paneles de vidrio agrupados, con controles grandes y táctiles
  y una sola capa de profundidad.
- **Se descarta:** el fondo oscuro con verde neón del smart home y los
  morados de los reproductores.
- **En Discalaves (futuro):** el gestor de modelos y el tablero de
  empleados. Cuadrícula de tarjetas 7.4 dentro de un único panel de vidrio,
  **no** un vidrio por tarjeta. Barras de progreso y deslizadores: pista
  `--gris-suave` hundida (sombra interior) con relleno de acento y una lente
  como tirador.

### 7.8 Campo de texto

- **Modelo:** el campo de comentario de Curtis Oyenuga.
- **En Discalaves:** el cuadro de mensaje (`.redactor`) es una píldora de
  vidrio con el botón principal redondo dentro. El foco oscurece el borde a
  `--secundario`. Los campos dentro de diálogos son sólidos (`.campo input`).

### 7.9 Hojas y diálogos

- **Referencia:** las hojas (*sheets*) de iOS 26.
- **En Discalaves:** `<dialog>` sólido (`--fondo`, `--radio-panel`, sombra
  con `--velo`) y `::backdrop` con `--velo`. No lleva vidrio, porque está en
  la capa superior, donde la refracción no funciona (5.2), y porque ahí se
  lee y se escribe. Se centra con `margin: auto`: el reinicio global lo
  quita.

---

## 8. Accesibilidad

- **Contraste:** texto normal ≥ 4,5:1 sobre el peor fondo posible (vidrio
  sobre la mancha más saturada). `--secundario` y `--notificacion-texto` ya
  están elegidos para eso: no se aclaran.
- **Halo:** todo texto sobre vidrio con cuerpo por debajo del 30 % de
  opacidad lleva el `text-shadow` con `--halo` (receta 4.3).
- **Foco:** `:focus-visible` con un contorno azul de 2 px. No se quita. Los
  contenedores con campos usan `:focus-within`.
- **No solo color:** un estado nunca se comunica solo con color. "Solo chat"
  lleva texto en negrita además del punto naranja, y el modo libre, texto y
  posición del interruptor además del rojo.
- **Tamaño táctil:** 32 × 32 px como mínimo en íconos (`--e8`) y 36 px en el
  botón principal.
- **Menos movimiento:** obligatorio (6.5).
- **Pendiente:** todavía no se respetan `prefers-reduced-transparency` ni
  `prefers-contrast: more`. Apple las trata como ajustes de primera clase.
  Cuando se implementen, bajo esas preferencias, el vidrio pasa a un cuerpo
  casi opaco (`--lateral` o `--fondo`) y desaparecen la refracción y el
  desenfoque. Mientras tanto, **no presentes esto como hecho**.

---

## 9. Antes de hacer commit de un cambio visual

- [ ] Todos los colores, radios, espacios y curvas nuevos son tokens (o
      mezclas de tokens).
- [ ] La paleta es la de Discalaves, no la del modelo de referencia.
- [ ] El vidrio está solo en capas que flotan, con dos capas superpuestas
      como máximo.
- [ ] El texto sobre vidrio se lee sobre la mancha más saturada del fondo.
- [ ] Solo se anima lo que cambia; nada ondula ni deforma el hilo o la
      pantalla.
- [ ] Hay bloque `prefers-reduced-motion` (CSS) o comprobación de
      `sinMovimiento` (TS).
- [ ] Duraciones entre 200 y 650 ms; la salida es más corta que la entrada.
- [ ] Nada se recorta al animarse (sobre todo dentro de listas con
      `overflow`).
- [ ] Probado en la app real (Electron) con capturas. Si hay animación,
      congelando fotogramas intermedios
      (`el.getAnimations()[0].pause(); currentTime = …`).
- [ ] Si cambió una receta, un token o un patrón, esta guía se actualizó en
      el mismo commit.

---

## 10. Vocabulario

| Término | Qué es |
|---|---|
| **Vidrio** | Superficie translúcida que refracta lo de detrás (`.vidrio`). |
| **Lente** | Trozo pequeño de vidrio que se mueve (selección, gota del interruptor). |
| **Refracción** | Doblar lo que hay detrás en los bordes (`feDisplacementMap`). Lo que separa el vidrio líquido del glassmorphism. |
| **Canto** | Línea de luz de 1 px en el borde: arriba (especular) o alrededor (interior). |
| **Reflejo** | Degradado radial blanco en la parte de arriba. |
| **Tinte** | Toque de acento (≤ 18 %) mezclado en el vidrio. |
| **Halo** | Resplandor claro detrás del texto para que se lea sobre vidrio. |
| **Velo** | Oscurecimiento detrás de un diálogo modal. |
| **Gota** | Forma de moverse del vidrio: se estira, viaja, se aplasta y rebota. |
| **Rebote** | La curva `--rebote`, que se pasa un poco y vuelve. |
| **Capa superior** | Popovers y diálogos modales: donde `backdrop-filter: url()` no funciona. |

---

## 11. Referencias

- Guía: [¿Qué es Liquid Glass?](https://liquidglassdesign.com/what-is-liquid-glass)
- Galerías: [interfaces](https://liquidglassdesign.com/ui),
  [movimiento](https://liquidglassdesign.com/video) y
  [prompts de estilo](https://liquidglassdesign.com/prompts).
- Recursos: [lista](https://liquidglassdesign.com/resources). Los más útiles
  para la web: *Liquid Glass SVG filters* (Shu Ding,
  `github.com/shuding/liquid-glass`), *Real liquid glass for the web*,
  *Liquid Gooey*, *liquid glass studio* (WebGL) y las Human Interface
  Guidelines de Apple ("Adopting Liquid Glass").
- Modelos citados en la sección 7: `/gallery/liquid-glass-tab-bar-ui`,
  `/gallery/apple-liquid-glass-design-navigation-bar`,
  `/gallery/liquid-glass-camera-toolbar`,
  `/gallery/weather-widget-liquid-glass`, `/gallery/liquid-glass-card`,
  `/gallery/lb-frosted-glass-card-design`,
  `/gallery/liquid-glass-button-in-framer`,
  `/gallery/swap-box-liquid-glass`,
  `/gallery/ios-liquid-glass-effect-smart-home-ui`,
  `/gallery/payrix-saas-mobile-finance-dashboard`,
  `/gallery/audio-player-card-design-liquid-glass-effect`,
  `/gallery/music-app-modern-music-player-ui-ux-interaction-design`.
