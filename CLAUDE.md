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

En diseño. Todavía no hay código del producto. El repositorio contiene solo
`README.md`, `LICENSE`, `NOTICE` y este archivo.

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

- **Lenguaje:** TypeScript en todo el proyecto. Supuesto provisional, porque
  OpenClaw trae Node.
- **OpenClaw con modelos pequeños:** verificar que funcione con modelos
  locales pequeños y medir el peso de su runtime. Si falla, se hará un bucle
  de agente propio. Lo investiga otra sesión.
- **Riesgo abierto:** consumo de RAM del sistema con varios escritorios y
  navegadores a la vez.

## Criterios de "listo" de la v1

Con Qwen 3.5 9B en una RTX 3060 Ti de 8 GB:

1. Un empleado investiga un tema en la web y deja un informe en un archivo.
2. Un empleado investiga y le pasa el resultado a otro, que lo resume.

## Modo de trabajo

- Hacer commit y push directo a `main` después de cada cambio coherente.
- Mensajes de commit claros, en español.
- Credenciales: se usan las ya configuradas en la máquina (`gh` como helper
  de git por HTTPS). No crear tokens ni cambiar la configuración global de git.
- La documentación pública (README) no promete capacidades que aún no existen.
