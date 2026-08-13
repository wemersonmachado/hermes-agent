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

  // O bearer do Worker fica protegido nesta Function, mas isso só é útil se
  // terceiros não puderem usar a própria Function como um proxy público para
  // os dados do proprietário. Navegadores do PWA/dashboard sempre enviam
  // Sec-Fetch-Site e/ou Referer nas chamadas same-origin; clientes diretos e
  // embeds de outros sites são recusados antes de tocar no Worker.
  const incomingUrl = new URL(request.url);
  const fetchSite = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const sameOrigin = origin === incomingUrl.origin || (referer && new URL(referer).origin === incomingUrl.origin);
  if ((fetchSite && fetchSite !== "same-origin") || (!fetchSite && !sameOrigin)) {
    return new Response(JSON.stringify({ ok: false, error: "FORBIDDEN" }), {
      status: 403,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  const allowedMethods = new Set(["GET", "POST", "PATCH", "PUT", "DELETE", "HEAD", "OPTIONS"]);
  if (!allowedMethods.has(request.method)) {
    return new Response(JSON.stringify({ ok: false, error: "METHOD_NOT_ALLOWED" }), {
      status: 405,
      headers: { "Content-Type": "application/json", "Allow": [...allowedMethods].join(", "), "Cache-Control": "no-store" },
    });
  }
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > 12 * 1024 * 1024) {
    return new Response(JSON.stringify({ ok: false, error: "PAYLOAD_TOO_LARGE" }), {
      status: 413,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
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
    headers: {
      "Content-Type": response.headers.get("Content-Type") || "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
    },
  });
}
