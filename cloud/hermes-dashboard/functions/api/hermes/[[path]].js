// Pages Function proxy — guarda HERMES_DASHBOARD_API_SECRET no servidor
// (Pages secret), nunca exposto ao browser. O browser só fala com esta
// função same-origin; ela é a única coisa que chama o Worker
// hermes-cloud-free /api/dashboard/* com o bearer real. Mesmo padrão usado
// pela Valia (functions/api/valia/[[path]].js), só que apontando pro
// backend do Hermes.
export async function onRequest(context) {
  const { request, env, params } = context;
  const path = Array.isArray(params.path) ? params.path.join("/") : (params.path || "");
  const workerUrl = env.HERMES_WORKER_URL || "https://hermes-cloud-free.clienteswell.workers.dev";
  const secret = env.HERMES_DASHBOARD_API_SECRET;

  if (!secret) {
    return new Response(JSON.stringify({ ok: false, error: "NOT_CONFIGURED", message: "HERMES_DASHBOARD_API_SECRET não configurado nesta Pages Function." }), {
      status: 503, headers: { "Content-Type": "application/json" },
    });
  }

  const targetUrl = new URL(`/api/dashboard/${path}`, workerUrl);
  const incoming = new URL(request.url);
  targetUrl.search = incoming.search;

  const init = {
    method: request.method,
    headers: { Authorization: `Bearer ${secret}` },
  };
  if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "OPTIONS") {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      init.body = await request.formData();
    } else {
      init.headers["Content-Type"] = "application/json";
      init.body = await request.text();
    }
  }

  const response = await fetch(targetUrl.toString(), init);
  const body = await response.arrayBuffer();
  return new Response(body, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("Content-Type") || "application/json" },
  });
}
