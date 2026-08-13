type TelegramMessage = {
  message_id: number;
  text?: string;
  caption?: string;
  voice?: { file_id: string; duration: number; mime_type?: string };
  photo?: { file_id: string; width: number; height: number; file_size?: number }[];
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

import {
  systemPrompt,
  json,
  secureEqual,
  supabase,
  history,
  embedText,
  recallRelevantMemories,
  fetchJsonWithTimeout,
  detectApiLookups,
  fetchGoogleNewsHeadlines,
  generateSummary,
  extractEntityGraph,
  persistEntityGraph,
  formatEntityGraph,
  recallRelevantImages,
  synthesizeVoiceReply,
  buildRealtimeContext,
  answerWithAI,
  tryActionRouter,
  extractAndSaveFacts,
  tryNewsShortcut,
  tryWebSearchShortcut,
  tryCurrencyConversionShortcut,
  tryOwnDataQueryShortcut,
  tryMemoryCommand,
  transcribeAudioBytes,
} from "./shared";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

async function telegram(env: Env, method: string, body: unknown): Promise<any> {
  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw new Error(`Telegram ${method} failed: ${response.status}`);
  return response.json();
}

async function telegramMultipartResult(env: Env, method: string, form: FormData): Promise<any> {
  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
    { method: "POST", body: form },
  );
  const body: any = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Telegram ${method} failed: ${response.status} ${JSON.stringify(body)}`);
  return body?.result;
}

async function sendText(env: Env, chatId: number, text: string): Promise<void> {
  const chunks = text.match(/[\s\S]{1,4000}/g) ?? ["Não consegui gerar uma resposta."];
  for (const chunk of chunks) {
    await telegram(env, "sendMessage", { chat_id: chatId, text: chunk });
  }
}

async function sendVoiceNote(env: Env, chatId: number, mp3: ArrayBuffer): Promise<void> {
  const form = new FormData();
  form.set("chat_id", String(chatId));
  form.set("voice", new Blob([mp3], { type: "audio/mpeg" }), "hermes.mp3");
  const result = await telegramMultipartResult(env, "sendVoice", form);
  if (!result?.voice) throw new Error("telegram_voice_reclassified");
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

async function saveMessage(
  env: Env,
  message: TelegramMessage,
  role: StoredMessage["role"],
  content: string,
): Promise<void> {
  const embedding = await embedText(env, content).catch(() => null);
  const response = await supabase(env, "hermes_cloud_messages", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      chat_id: String(message.chat.id),
      user_id: String(message.from?.id ?? message.chat.id),
      telegram_message_id: role === "user" ? message.message_id : null,
      role,
      content,
      embedding,
    }),
  });
  if (!response.ok) throw new Error(`Supabase save failed: ${response.status}`);
}

// ---------------------------------------------------------------------------
// Memória semântica: embedding multilíngue (bge-m3) por mensagem, permitindo
// trazer de volta trechos antigos relevantes que já saíram da janela corrida
// (os últimos MAX_HISTORY_MESSAGES). Falha em silêncio — sem embedding a
// mensagem ainda é salva, só não entra na busca por similaridade.
// ---------------------------------------------------------------------------

async function clearHistory(env: Env, chatId: number): Promise<void> {
  const response = await supabase(
    env,
    `hermes_cloud_messages?chat_id=eq.${encodeURIComponent(String(chatId))}`,
    { method: "DELETE", headers: { prefer: "return=minimal" } },
  );
  if (!response.ok) throw new Error(`Supabase clear failed: ${response.status}`);
}

// ---------------------------------------------------------------------------
// Voz: STT (transcrever áudio recebido) + TTS (responder em áudio só quando
// pedido). Ambos rodam 100% dentro do Workers AI, sem chave externa.
// ---------------------------------------------------------------------------

async function transcribeVoice(env: Env, fileId: string): Promise<string> {
  const fileInfo = await telegram(env, "getFile", { file_id: fileId });
  const filePath = fileInfo?.result?.file_path;
  if (!filePath) throw new Error("Telegram getFile sem file_path");
  const fileUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`;
  const audioResp = await fetch(fileUrl);
  if (!audioResp.ok) throw new Error(`Download do áudio falhou: ${audioResp.status}`);
  const bytes = await audioResp.arrayBuffer();
  return transcribeAudioBytes(env, bytes);
}

const AUDIO_REQUEST_PATTERN = /\b(audio|áudio)\b|\b(manda|gera|gere|cria|crie|envia|fala|toca)\w*\s+(a\s+)?voz\b/i;

function wantsAudioReply(text: string): boolean {
  return AUDIO_REQUEST_PATTERN.test(text);
}

async function maybeSendVoice(
  env: Env,
  chatId: number,
  userText: string,
  replyText: string,
  updateId: number,
): Promise<void> {
  if (!wantsAudioReply(userText)) return;
  try {
    const audio = await synthesizeVoiceReply(env, replyText);
    if (audio) {
      await sendVoiceNote(env, chatId, audio);
    } else {
      console.error(JSON.stringify({ event: "tts_no_audio", updateId }));
    }
  } catch (err) {
    console.error(JSON.stringify({ event: "tts_failed", updateId, error: String(err) }));
  }
}


// ---------------------------------------------------------------------------
// Roteador determinístico das 20 APIs públicas gratuitas: detecta a intenção
// na mensagem (regex/palavra-chave), busca o dado real, e injeta como
// contexto pro modelo responder em cima de informação verdadeira em vez de
// alucinar. Cada função tem timeout curto e falha silenciosa (o bloco de
// dados simplesmente não aparece se a API externa não responder a tempo).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Memória episódica: resumos semanais/mensais gerados sob demanda (/resumo)
// e cacheados no dia — evita reprocessar o mesmo período em toda mensagem.
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Visão + OCR: toda foto recebida é descrita e transcrita (Llama 3.2 Vision),
// o arquivo original vai pro R2 e a descrição fica pesquisável (embedding).
// ---------------------------------------------------------------------------

async function describeImage(env: Env, bytes: ArrayBuffer): Promise<{ description: string; ocrText: string }> {
  const image = [...new Uint8Array(bytes)];
  const prompt =
    "Descreva esta imagem em português, de forma objetiva: o que aparece, elementos principais, cores, contexto. " +
    "Depois, numa linha separada começando com 'TEXTO:', transcreva literalmente qualquer texto visível na imagem " +
    "(OCR). Se não houver texto, escreva 'TEXTO: (nenhum)'.";

  let raw = "";
  try {
    const result = (await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", { image, prompt, max_tokens: 500 })) as {
      response?: unknown;
    };
    raw = typeof result.response === "string" ? result.response.trim() : "";
  } catch (err) {
    console.error(JSON.stringify({ event: "vision_primary_failed", error: String(err) }));
  }

  if (!raw) {
    try {
      const fallback = (await env.AI.run("@cf/unum/uform-gen2-qwen-500m", { image, prompt, max_tokens: 400 })) as {
        description?: string;
      };
      raw = typeof fallback.description === "string" ? fallback.description.trim() : "";
    } catch (err) {
      console.error(JSON.stringify({ event: "vision_fallback_failed", error: String(err) }));
    }
  }

  const textMatch = raw.match(/TEXTO:\s*([\s\S]*)$/i);
  const ocrText = textMatch ? textMatch[1].trim().replace(/^\(nenhum\)$/i, "") : "";
  const description = (textMatch ? raw.slice(0, textMatch.index).trim() : raw) || "Não consegui descrever esta imagem.";
  return { description, ocrText };
}

async function processIncomingImage(env: Env, message: TelegramMessage): Promise<string> {
  const photos = message.photo!;
  const largest = photos.reduce((a, b) => (b.width > a.width ? b : a));
  const fileInfo = await telegram(env, "getFile", { file_id: largest.file_id });
  const filePath = fileInfo?.result?.file_path;
  if (!filePath) throw new Error("Telegram getFile sem file_path (foto)");
  const fileUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`;
  const fileResp = await fetch(fileUrl);
  if (!fileResp.ok) throw new Error(`Download da foto falhou: ${fileResp.status}`);
  const bytes = await fileResp.arrayBuffer();

  const { description, ocrText } = await describeImage(env, bytes);

  const r2Key = `images/${message.chat.id}/${Date.now()}-${largest.file_id}.jpg`;
  await env.HERMES_STORAGE.put(r2Key, bytes, { httpMetadata: { contentType: "image/jpeg" } });

  const embedding = await embedText(env, `${description}\n${ocrText}`).catch(() => null);
  await supabase(env, "hermes_cloud_images", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      chat_id: String(message.chat.id),
      user_id: String(message.from?.id ?? message.chat.id),
      telegram_file_id: largest.file_id,
      r2_key: r2Key,
      description,
      ocr_text: ocrText,
      embedding,
    }),
  }).catch((err) => console.error(JSON.stringify({ event: "image_save_failed", error: String(err) })));

  const caption = message.caption?.trim();
  let reply = `🖼️ ${description}`;
  if (ocrText) reply += `\n\n📝 Texto na imagem: "${ocrText}"`;
  reply += "\n\n(Salvei essa imagem na memória — pode buscar depois com /memoria.)";
  if (caption) reply = `${reply}\n\n(Sobre "${caption}": já considerei isso na descrição acima.)`;
  return reply;
}


async function processUpdate(env: Env, update: TelegramUpdate): Promise<void> {
  if (!(await claimUpdate(env, update))) return;
  const message = update.message;
  try {
    if (!message || (!message.text && !message.voice && !message.photo?.length)) {
      if (message) await sendText(env, message.chat.id, "Nesta edição gratuita, envie texto, áudio de voz ou foto.");
      await markUpdate(env, update.update_id, "ignored");
      return;
    }

    const allowed = new Set(
      env.TELEGRAM_ALLOWED_USERS.split(",").map((value) => value.trim()).filter(Boolean),
    );
    if (!allowed.has(String(message.from?.id))) {
      await markUpdate(env, update.update_id, "unauthorized");
      return;
    }

    if (message.photo?.length) {
      await telegram(env, "sendChatAction", { chat_id: message.chat.id, action: "typing" });
      try {
        const summary = await processIncomingImage(env, message);
        await sendText(env, message.chat.id, summary);
      } catch (err) {
        console.error(JSON.stringify({ event: "image_failed", updateId: update.update_id, error: String(err) }));
        await sendText(env, message.chat.id, "Não consegui analisar essa imagem agora. Tenta de novo?");
      }
      await markUpdate(env, update.update_id, "done");
      return;
    }

    let userText = message.text?.trim() ?? "";
    let isVoiceInput = false;
    if (!userText && message.voice) {
      isVoiceInput = true;
      await telegram(env, "sendChatAction", { chat_id: message.chat.id, action: "typing" });
      userText = await transcribeVoice(env, message.voice.file_id);
      if (!userText) {
        await sendText(env, message.chat.id, "Não consegui entender o áudio. Pode tentar de novo ou escrever?");
        await markUpdate(env, update.update_id, "error");
        return;
      }
      await sendText(env, message.chat.id, `🎙️ Entendi: "${userText}"`);
    }

    const command = userText.toLowerCase();
    if (command === "/start" || command === "/help") {
      await sendText(
        env,
        message.chat.id,
        "Hermes Cloud Free está online. Envie texto ou áudio pra conversar.\n" +
          "Responde sempre em texto — peça \"manda em áudio\" pra receber a resposta falada.\n" +
          "/new limpa o histórico · /status verifica o serviço\n" +
          "/resumo semana · /resumo mes · /grafo · /memoria <termo> · /foto <termo>\n" +
          "Também entende: grave na memória..., exclua a memória sobre..., mostre minhas memórias.",
      );
      await markUpdate(env, update.update_id, "done");
      return;
    }
    if (command === "/status") {
      await sendText(env, message.chat.id, "Hermes Cloud Free: online, custo zero, Supabase + Cloudflare, voz + dados em tempo real ativos.");
      await markUpdate(env, update.update_id, "done");
      return;
    }
    if (command === "/new") {
      await clearHistory(env, message.chat.id);
      await sendText(env, message.chat.id, "Histórico reiniciado.");
      await markUpdate(env, update.update_id, "done");
      return;
    }
    if (command === "/resumo semana" || command === "/resumo") {
      await telegram(env, "sendChatAction", { chat_id: message.chat.id, action: "typing" });
      const summary = await generateSummary(env, message.chat.id, "week");
      await sendText(env, message.chat.id, `📅 Resumo da semana:\n\n${summary}`);
      await markUpdate(env, update.update_id, "done");
      return;
    }
    if (command === "/resumo mes" || command === "/resumo mês") {
      await telegram(env, "sendChatAction", { chat_id: message.chat.id, action: "typing" });
      const summary = await generateSummary(env, message.chat.id, "month");
      await sendText(env, message.chat.id, `🗓️ Resumo do mês:\n\n${summary}`);
      await markUpdate(env, update.update_id, "done");
      return;
    }
    if (command === "/grafo") {
      await telegram(env, "sendChatAction", { chat_id: message.chat.id, action: "typing" });
      const { entities, edges } = await extractEntityGraph(env, message.chat.id);
      await persistEntityGraph(env, message.chat.id, entities, edges).catch(() => undefined);
      await sendText(env, message.chat.id, formatEntityGraph(entities, edges));
      await markUpdate(env, update.update_id, "done");
      return;
    }
    if (userText.toLowerCase().startsWith("/memoria ")) {
      const term = userText.slice("/memoria ".length).trim();
      await telegram(env, "sendChatAction", { chat_id: message.chat.id, action: "typing" });
      const [found, foundImages] = await Promise.all([
        recallRelevantMemories(env, message.chat.id, term),
        recallRelevantImages(env, message.chat.id, term),
      ]);
      const all = [...found, ...foundImages];
      await sendText(
        env,
        message.chat.id,
        all.length ? `🔎 Achei isso na memória:\n\n${all.join("\n\n")}` : "Não achei nada relevante na memória sobre isso.",
      );
      await markUpdate(env, update.update_id, "done");
      return;
    }

    const memoryResult = await tryMemoryCommand(env, message.chat.id, userText).catch(() => null);
    if (memoryResult) {
      await saveMessage(env, message, "user", userText);
      await saveMessage(env, message, "assistant", memoryResult.reply);
      await sendText(env, message.chat.id, memoryResult.reply);
      for (const fileId of memoryResult.imageFileIds || []) {
        await telegram(env, "sendPhoto", { chat_id: message.chat.id, photo: fileId });
      }
      await markUpdate(env, update.update_id, "done");
      return;
    }

    if (!isVoiceInput) {
      await telegram(env, "sendChatAction", { chat_id: message.chat.id, action: "typing" });
    }

    const newsShortcut = await tryNewsShortcut(env, userText);
    if (newsShortcut) {
      await saveMessage(env, message, "user", userText);
      await extractAndSaveFacts(env, message.chat.id, userText);
      await saveMessage(env, message, "assistant", newsShortcut);
      await sendText(env, message.chat.id, newsShortcut);
      await maybeSendVoice(env, message.chat.id, userText, newsShortcut, update.update_id);
      await markUpdate(env, update.update_id, "done");
      return;
    }

    const currencyResult = await tryCurrencyConversionShortcut(userText).catch(() => null);
    if (currencyResult) {
      await saveMessage(env, message, "user", userText);
      await extractAndSaveFacts(env, message.chat.id, userText);
      await saveMessage(env, message, "assistant", currencyResult);
      await sendText(env, message.chat.id, currencyResult);
      await maybeSendVoice(env, message.chat.id, userText, currencyResult, update.update_id);
      await markUpdate(env, update.update_id, "done");
      return;
    }

    const actionResult = await tryActionRouter(env, message.chat.id, userText).catch(() => null);
    if (actionResult) {
      await saveMessage(env, message, "user", userText);
      await extractAndSaveFacts(env, message.chat.id, userText);
      await saveMessage(env, message, "assistant", actionResult);
      await sendText(env, message.chat.id, actionResult);
      await maybeSendVoice(env, message.chat.id, userText, actionResult, update.update_id);
      await markUpdate(env, update.update_id, "done");
      return;
    }

    const ownDataResult = await tryOwnDataQueryShortcut(env, message.chat.id, userText).catch(() => null);
    if (ownDataResult) {
      await saveMessage(env, message, "user", userText);
      await extractAndSaveFacts(env, message.chat.id, userText);
      await saveMessage(env, message, "assistant", ownDataResult);
      await sendText(env, message.chat.id, ownDataResult);
      await maybeSendVoice(env, message.chat.id, userText, ownDataResult, update.update_id);
      await markUpdate(env, update.update_id, "done");
      return;
    }

    const searchResult = await tryWebSearchShortcut(env, userText).catch(() => null);
    if (searchResult) {
      await saveMessage(env, message, "user", userText);
      await extractAndSaveFacts(env, message.chat.id, userText);
      await saveMessage(env, message, "assistant", searchResult);
      await sendText(env, message.chat.id, searchResult);
      await maybeSendVoice(env, message.chat.id, userText, searchResult, update.update_id);
      await markUpdate(env, update.update_id, "done");
      return;
    }

    await saveMessage(env, message, "user", userText);
    await extractAndSaveFacts(env, message.chat.id, userText);
    const [currentHistory, realtimeContext] = await Promise.all([
      history(env, message.chat.id),
      buildRealtimeContext(env, message.chat.id, userText),
    ]);
    const response = await answerWithAI(env, currentHistory, realtimeContext);
    await saveMessage(env, message, "assistant", response);
    await sendText(env, message.chat.id, response);
    await maybeSendVoice(env, message.chat.id, userText, response, update.update_id);

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
        voice: "stt+tts (workers-ai)",
      });
    }
    if (url.pathname.startsWith("/api/dashboard/")) {
      const authHeader = request.headers.get("authorization") ?? "";
      const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      if (!secureEqual(bearer, env.HERMES_DASHBOARD_API_SECRET)) {
        return json({ ok: false, error: "unauthorized" }, 401);
      }
      const { handleDashboardRequest } = await import("./dashboard");
      return handleDashboardRequest(request, env, url.pathname.slice("/api/dashboard/".length));
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
