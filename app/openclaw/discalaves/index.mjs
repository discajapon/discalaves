// Plugin de Discalaves para OpenClaw: antes de cada herramienta pregunta a la app qué hacer (seguir, bloquear
// —Detener, acción delicada rechazada— o cambiar parámetros: el navegador del propio empleado) y después le
// cuenta el resultado para que lo muestre en el hilo. La app escucha solo en 127.0.0.1 y pide un token.
// Si la app no responde, se bloquea: sin su visto bueno no corre nada.
const ESPERA_APROBACION = 580_000; // la app puede tardar lo que tarde el usuario en decidir (el tope de OpenClaw es 600 s)

async function avisar(config, ruta, cuerpo, tiempo) {
  const r = await fetch(`${config.url}${ruta}`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(tiempo),
  });
  if (!r.ok) throw new Error(`la app respondió ${r.status}`);
  return r.json();
}

export default {
  id: "discalaves",
  name: "Discalaves",
  register(api) {
    api.on(
      "before_tool_call",
      async (event, ctx) => {
        try {
          const d = await avisar(event.context?.pluginConfig ?? api.pluginConfig, "/antes", { agente: ctx.agentId, herramienta: event.toolName, parametros: event.params }, ESPERA_APROBACION);
          if (d.bloquear) return { block: true, blockReason: String(d.motivo ?? "la app de Discalaves no lo permitió") };
          return d.parametros ? { params: d.parametros } : undefined;
        } catch (e) {
          return { block: true, blockReason: `sin respuesta de la app de Discalaves (${e.message}); no se hizo nada` };
        }
      },
      { priority: 1000, timeoutMs: 600_000 },
    );
    api.on("after_tool_call", async (event, ctx) => {
      try {
        await avisar(event.context?.pluginConfig ?? api.pluginConfig, "/despues", {
          agente: ctx.agentId, herramienta: event.toolName, parametros: event.params, resultado: event.result, error: event.error,
        }, 10_000);
      } catch {
        // solo informativo: el paso ya se hizo
      }
    });
  },
};
