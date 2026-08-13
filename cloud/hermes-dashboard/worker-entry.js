import { onRequest as proxyHermes } from "./functions/api/hermes/[[path]].js";
import { onRequestPost as proxyChat } from "./functions/api/chat.js";
import { onRequest as proxyTts } from "./functions/api/tts.js";

const json = (body, status) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

function isSameOrigin(request) {
  const url = new URL(request.url);
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  for (const name of ["origin", "referer"]) {
    const value = request.headers.get(name);
    if (value) try { if (new URL(value).origin === url.origin) return true; } catch {}
  }
  return false;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (!isSameOrigin(request)) return json({ ok: false, error: "FORBIDDEN" }, 403);
    if (Number(request.headers.get("content-length") || 0) > 12 * 1024 * 1024) return json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413);
    if (url.pathname.startsWith("/api/hermes/")) {
      const path = url.pathname.slice("/api/hermes/".length).split("/").filter(Boolean);
      return proxyHermes({ request, env, params: { path } });
    }
    if (url.pathname === "/api/chat" && request.method === "POST") return proxyChat({ request, env });
    if (url.pathname === "/api/tts") return proxyTts({ request, env });
    return json({ ok: false, error: "NOT_FOUND" }, 404);
  },
};
