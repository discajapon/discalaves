# Discalaves — contexto para GitHub Copilot

Hola, Claude Code.

Soy GitHub Copilot, otra IA que Disca (`discajapon`) utiliza para trabajar en el repositorio [Discalaves](https://github.com/discajapon/discalaves). Nuestro trabajo debe complementarse: tú puedes ejecutar comandos y trabajar directamente en el equipo local de Disca, mientras que yo puedo revisar el repositorio en GitHub, analizar el código y la documentación, y realizar cambios directamente en sus ramas y archivos de GitHub cuando Disca me lo solicite.

## Cómo coordinarse

- Respetar `CLAUDE.md` como contexto principal del proyecto.
- Antes de hacer cambios visuales, consultar `GUIA_DE_DISEÑO.md`.
- No dar por terminadas las funciones que la documentación marca como pendientes.
- Mantener la privacidad como prioridad: los modelos locales son la opción predeterminada y las APIs externas deben ser opcionales y explícitas.
- Evitar duplicar trabajo de otras IAs y revisar el estado actual del repositorio antes de modificarlo.
- Mantener los cambios coherentes con las decisiones ya tomadas por Disca.

## Avances realizados por GitHub Copilot

### 2026-09-28 — Primera sesión

1. Revisé la estructura del repositorio y confirmé su composición general: principalmente TypeScript, además de CSS, HTML, Dockerfile y Shell.
2. Leí los documentos Markdown principales:
   - `README.md`
   - `CLAUDE.md`
   - `GUIA_DE_DISEÑO.md`
   - `PRUEBAS_WINDOWS.md`
3. Incorporé como contexto de trabajo las decisiones principales del proyecto:
   - Discalaves es una alternativa local y abierta a Grok Bot bajo Apache-2.0.
   - El objetivo es crear empleados de IA, cada uno con una computadora aislada.
   - El prototipo utiliza Electron, TypeScript, Qwen 3.5 9B, llama.cpp, contenedores y Chromium.
   - También existe soporte para modelos locales mediante Ollama.
   - Las acciones delicadas requieren aprobación, excepto en el modo libre.
   - El soporte de Windows usa una distro WSL2 propia con Podman y todavía no se ha probado en una PC Windows real.
   - La interfaz sigue las reglas de vidrio líquido, tokens, accesibilidad y movimiento reducido descritas en `GUIA_DE_DISEÑO.md`.
4. Revisé si había integración con OpenClaw. El resultado fue:
   - OpenClaw aparece como una decisión o plan de arquitectura en `CLAUDE.md`.
   - El repositorio indica que los agentes deberían basarse en OpenClaw y que requiere Node 24 o superior.
   - La compatibilidad de OpenClaw con modelos locales pequeños sigue pendiente de verificación.
   - El código actual utiliza un bucle de agente propio; no encontré una integración efectiva con OpenClaw.
   - `app/package.json` no declara ninguna dependencia `openclaw`.
5. Creé este archivo para dejar constancia de mi papel y facilitar la coordinación con Claude Code y otras IAs que colaboran en Discalaves.

## Estado de este archivo

Este documento es una bitácora de mis avances. Cuando realice nuevas revisiones o cambios importantes desde GitHub, añadiré una entrada fechada en la sección correspondiente sin borrar el historial anterior.
