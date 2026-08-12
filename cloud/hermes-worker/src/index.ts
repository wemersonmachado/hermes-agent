type TelegramMessage = {
  message_id: number;
  text?: string;
  chat: { id: number };
  from?: { id: number; first_name?: string };
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

type StoredMessage = {
  role: "user" | "assistant";
  content: string;
};

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const SYSTEM_PROMPT =
  "Você é Hermes, um assistente pessoal útil, direto e confiável. Responda em português do Brasil. " +
  "Esta é a edição cloud gratuita: não afirme ter executado terminal, navegador ou arquivos locais.";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function secureEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const left = enc.encode(a);
  const right = enc.encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

async function supabase(
  env: Env,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("apikey", env.SUPABASE_SERVICE_ROLE_KEY);
  headers.set("authorization", `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  headers.set("content-type", "application/json");
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers });
}

async function telegram(env: Env, method: string, body: unknown): Promise<void> {
  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw new Error(`Telegram ${method} failed: ${response.status}`);
}

async function sendText(env: Env, chatId: number, text: string): Promise<void> {
  const chunks = text.match(/[\s\S]{1,4000}/g) ?? ["Não consegui gerar uma resposta."];
  for (const chunk of chunks) {
    await telegram(env, "sendMessage", { chat_id: chatId, text: chunk });
  }
}

async function claimUpdate(env: Env, update: TelegramUpdate): Promise<boolean> {
  const response = await supabase(env, "hermes_cloud_updates", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ update_id: update.update_id, status: "processing" }),
  });
  if (response.status === 409) return false;
  if (!response.ok) throw new Error(`Supabase claim failed: ${response.status}`);
  return true;
}

async function markUpdate(env: Env, updateId: number, status: string): Promise<void> {
  const response = await supabase(
    env,
    `hermes_cloud_updates?update_id=eq.${encodeURIComponent(String(updateId))}`,
    {
      method: "PATCH",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({ status, finished_at: new Date().toISOString() }),
    },
  );
  if (!response.ok) throw new Error(`Supabase update failed: ${response.status}`);
}

async function history(env: Env, chatId: number): Promise<StoredMessage[]> {
  const limit = Math.min(Math.max(Number(env.MAX_HISTORY_MESSAGES) || 20, 2), 40);
  const path =
    "hermes_cloud_messages?select=role,content" +
    `&chat_id=eq.${encodeURIComponent(String(chatId))}` +
    `&order=created_at.desc&limit=${limit}`;
  const response = await supabase(env, path);
  if (!response.ok) throw new Error(`Supabase history failed: ${response.status}`);
  const rows = (await response.json()) as StoredMessage[];
  return rows.reverse();
}

async function saveMessage(
  env: Env,
  message: TelegramMessage,
  role: StoredMessage["role"],
  content: string,
): Promise<void> {
  const response = await supabase(env, "hermes_cloud_messages", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      chat_id: String(message.chat.id),
      user_id: String(message.from?.id ?? message.chat.id),
      telegram_message_id: role === "user" ? message.message_id : null,
      role,
      content,
    }),
  });
  if (!response.ok) throw new Error(`Supabase save failed: ${response.status}`);
}

async function clearHistory(env: Env, chatId: number): Promise<void> {
  const response = await supabase(
    env,
    `hermes_cloud_messages?chat_id=eq.${encodeURIComponent(String(chatId))}`,
    { method: "DELETE", headers: { prefer: "return=minimal" } },
  );
  if (!response.ok) throw new Error(`Supabase clear failed: ${response.status}`);
}

async function answerWithAI(env: Env, messages: StoredMessage[]): Promise<string> {
  const result = (await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {
    messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
    max_tokens: 900,
  })) as { response?: string };
  return result.response?.trim() || "Não consegui gerar uma resposta agora.";
}

async function processUpdate(env: Env, update: TelegramUpdate): Promise<void> {
  if (!(await claimUpdate(env, update))) return;
  const message = update.message;
  try {
    if (!message?.text || !message.from) {
      if (message) await sendText(env, message.chat.id, "Nesta edição gratuita, envie uma mensagem de texto.");
      await markUpdate(env, update.update_id, "ignored");
      return;
    }

    const allowed = new Set(
      env.TELEGRAM_ALLOWED_USERS.split(",").map((value) => value.trim()).filter(Boolean),
    );
    if (!allowed.has(String(message.from.id))) {
      await markUpdate(env, update.update_id, "unauthorized");
      return;
    }

    const command = message.text.trim().toLowerCase();
    if (command === "/start" || command === "/help") {
      await sendText(
        env,
        message.chat.id,
        "Hermes Cloud Free está online. Envie texto para conversar.\n/new limpa o histórico.\n/status verifica o serviço.",
      );
      await markUpdate(env, update.update_id, "done");
      return;
    }
    if (command === "/status") {
      await sendText(env, message.chat.id, "Hermes Cloud Free: online, custo zero, Supabase + Cloudflare.");
      await markUpdate(env, update.update_id, "done");
      return;
    }
    if (command === "/new") {
      await clearHistory(env, message.chat.id);
      await sendText(env, message.chat.id, "Histórico reiniciado.");
      await markUpdate(env, update.update_id, "done");
      return;
    }

    await telegram(env, "sendChatAction", { chat_id: message.chat.id, action: "typing" });
    await saveMessage(env, message, "user", message.text);
    const currentHistory = await history(env, message.chat.id);
    const response = await answerWithAI(env, currentHistory);
    await saveMessage(env, message, "assistant", response);
    await sendText(env, message.chat.id, response);
    await markUpdate(env, update.update_id, "done");
  } catch (error) {
    console.error(JSON.stringify({ event: "update_failed", updateId: update.update_id, error: String(error) }));
    await markUpdate(env, update.update_id, "error").catch(() => undefined);
    if (message) await sendText(env, message.chat.id, "O Hermes encontrou um erro temporário. Tente novamente.");
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return json({
        service: "hermes-cloud-free",
        status: "ok",
        zero_cost_mode: env.ZERO_COST_MODE === "true",
        storage: "hermes-agent-storage",
      });
    }
    if (request.method !== "POST" || url.pathname !== "/telegram") {
      return json({ error: "not_found" }, 404);
    }

    const secret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
    if (!secureEqual(secret, env.TELEGRAM_WEBHOOK_SECRET)) {
      return json({ error: "unauthorized" }, 401);
    }

    const update = (await request.json()) as TelegramUpdate;
    ctx.waitUntil(processUpdate(env, update));
    return json({ ok: true });
  },
} satisfies ExportedHandler<Env>;
