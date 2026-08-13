// Pages Function: POST /api/chat — usado pela conversa ao vivo do
// dashboard/PWA. Diferente da Valia (cascata própria de LLMs), aqui é um
// proxy fino pro Worker: MESMO cérebro, MESMO histórico e MESMA memória que
// o Telegram usa (hermes_cloud_messages compartilhado) — um único cérebro
// de verdade, não uma segunda implementação paralela.
export async function onRequestPost(context) {
  const { request, env } = context;
  const secret = env.HERMES_DASHBOARD_API_SECRET;
  const workerUrl = env.HERMES_WORKER_URL || "https://hermes-cloud-free.clienteswell.workers.dev";

  if (!secret) {
    return new Response(JSON.stringify({ ok: false, error: "NOT_CONFIGURED" }), {
      status: 503, headers: { "Content-Type": "application/json" },
    });
  }

  const incoming = await request.json().catch(() => ({}));
  const response = await fetch(new URL("/api/dashboard/chat", workerUrl), {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: incoming.message || "" }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return new Response(`Erro ao falar com o Hermes (${response.status}). ${detail.slice(0, 200)}`, {
      status: response.status,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // O front-end lê /api/chat como stream de texto puro (ver processTurn em
  // app.js/pwa.js). O Worker responde de uma vez (sem streaming token a
  // token), então devolvemos o texto completo já pronto — a leitura via
  // reader.getReader() funciona igual, só chega tudo num chunk só em vez de
  // progressivo.
  const data = await response.json().catch(() => ({}));
  const reply = typeof data.reply === "string" ? data.reply : "Não consegui gerar uma resposta agora.";
  return new Response(reply, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
