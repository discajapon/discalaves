# Discalaves

> **Estado: en diseño, aún no funcional.** Todavía no hay nada que instalar.
> Este README describe lo que el proyecto quiere ser, no lo que ya hace.
> Por ahora solo existe un prototipo en [`app/`](app/) con un único
> empleado que usa un modelo local y su propia computadora aislada (un
> contenedor Linux con escritorio, terminal y navegador que puedes ver en
> vivo). Todavía no hay equipo, y de momento necesita Docker.

Discalaves es un equipo de "empleados" de IA que corre en tu propia
computadora. Les asignas tareas como a compañeros de trabajo; cada empleado
tiene su propia computadora aislada (un escritorio Linux con navegador y
terminal) y trabaja por su cuenta. Es una alternativa local y abierta a
Grok Bot.

## Principios

- **Cero fricción.** Un instalador nativo que trae todo lo necesario. Sin
  Docker ni pasos previos. Al terminar se abre una interfaz web con los
  empleados listos.
- **Privacidad primero.** Los modelos corren en tu máquina por defecto. Usar
  una API externa es opcional, lo decides tú, y la app te avisa claramente
  de que en ese caso tus datos salen de tu equipo.
- **Honestidad con los modelos pequeños.** Un modelo local no es un modelo
  gigante en la nube. Los empleados trabajan en tareas cortas, con puntos de
  control y reportes de avance, y te preguntan cuando tienen dudas.
- **Tú apruebas lo delicado.** Antes de borrar, enviar o pagar algo, el
  empleado pide tu confirmación.

## Cómo se pensó (resumen)

- Cada empleado usa un contenedor aislado: sin privilegios, sin acceso a tus
  carpetas personales ni a tu red local, con salida a internet.
- Puedes ver los escritorios en vivo desde la interfaz web y tomar el control.
- Los modelos son intercambiables: el runtime local incluido, un servidor
  local que ya tengas, o una API compatible con OpenAI. Cada empleado puede
  usar un modelo distinto.
- Si tu GPU no alcanza para todos los empleados a la vez, los demás esperan
  en cola.
- La memoria de cada empleado se guarda en archivos locales que puedes leer
  y editar.

Esto es el diseño previsto; puede cambiar a medida que se implemente.

## Requisitos (previstos)

- Linux (la primera versión será solo para Linux; Windows y Mac después).
- GPU con al menos 8 GB de VRAM.

El desarrollo y las pruebas se hacen con Qwen 3.5 9B (Q4) en una RTX 3060 Ti
de 8 GB.

## Licencia

Apache License 2.0. Consulta [LICENSE](LICENSE) y [NOTICE](NOTICE).

Discalaves — Copyright 2026 Disca.
