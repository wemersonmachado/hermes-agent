// Pages Function: GET /api/tts?text=... — usado pelo player de voz do
// dashboard/PWA (speakWithEdgeTTS em app.js/pwa.js). Proxy fino pro Worker,
// mesma voz Edge Neural pt-BR-AntonioNeural usada no Telegram.
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const text = url.searchParams.get("text") || "";

  if (!text) {
    return new Response(JSON.stringify({ ok: false, error: "text é obrigatório" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const secret = env.HERMES_DASHBOARD_API_SECRET;
  const workerUrl = env.HERMES_WORKER_URL || "https://hermes-cloud-free.clienteswell.workers.dev";
  if (!secret) {
    return new Response(JSON.stringify({ ok: false, error: "NOT_CONFIGURED" }), {
      status: 503, headers: { "Content-Type": "application/json" },
    });
  }

  const response = await fetch(new URL("/api/dashboard/tts", workerUrl), {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return new Response(JSON.stringify({ ok: false, error: `tts_upstream_${response.status}`, detail: detail.slice(0, 300) }), {
      status: response.status >= 500 ? 502 : response.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  const audio = await response.arrayBuffer();
  return new Response(audio, {
    status: 200,
    headers: { "Content-Type": "audio/mpeg" },
  });
}
