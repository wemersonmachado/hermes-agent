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
  looksLikeFactualQuestion,
  tryMemoryCommand,
  transcribeAudioBytes,
  webSearch,
} from "./shared";
import { parseVoiceRequest } from "./voice_intent";
import { detectSportsSubject, formatSpecialistAnswer, trySportsSearchSpecialist } from "./search_specialist";
import { isExplicitSearchRequest, isNewsSearchRequest, refineSearchQuery } from "./search_query";
import { research } from "./research_engine";
import { dispatchDueReminders } from "./reminder_dispatch";

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
    // Escapa todo o texto e converte somente links Markdown gerados pelo
    // próprio sistema em âncoras HTML. Assim títulos/snippets nunca quebram o
    // parse_mode e URLs longas viram um único "Clique aqui para ler".
    const html = chunk
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\[Clique aqui para ler\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$1">Clique aqui para ler</a>');
    await telegram(env, "sendMessage", { chat_id: chatId, text: html, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  }
}

async function sendVoiceNote(env: Env, chatId: number, audio: { bytes: ArrayBuffer; contentType: string; fileName: string }): Promise<void> {
  const form = new FormData();
  form.set("chat_id", String(chatId));
  form.set("voice", new Blob([audio.bytes], { type: audio.contentType }), audio.fileName);
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
  ctx?: ExecutionContext,
): Promise<void> {
  const response = await supabase(env, "hermes_cloud_messages", {
    method: "POST",
    headers: { prefer: ctx ? "return=representation" : "return=minimal" },
    body: JSON.stringify({
      chat_id: String(message.chat.id),
      user_id: String(message.from?.id ?? message.chat.id),
      telegram_message_id: role === "user" ? message.message_id : null,
      role,
      content,
    }),
  });
  if (!response.ok) throw new Error(`Supabase save failed: ${response.status}`);
  if (!ctx) return;
  const rows = (await response.json().catch(() => [])) as { id?: string }[];
  const id = rows[0]?.id;
  if (!id) return;
  ctx.waitUntil((async () => {
    const embedding = await embedText(env, content).catch(() => null);
    if (!embedding) return;
    await supabase(env, `hermes_cloud_messages?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({ embedding }),
    });
  })().catch((error) => console.error(JSON.stringify({ event: "embedding_backfill_failed", id, error: String(error) }))));
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

async function transcribeVoice(env: Env, fileId: string, mimeType = "audio/ogg"): Promise<string> {
  const fileInfo = await telegram(env, "getFile", { file_id: fileId });
  const filePath = fileInfo?.result?.file_path;
  if (!filePath) throw new Error("Telegram getFile sem file_path");
  const fileUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`;
  const audioResp = await fetch(fileUrl);
  if (!audioResp.ok) throw new Error(`Download do áudio falhou: ${audioResp.status}`);
  const bytes = await audioResp.arrayBuffer();
  return transcribeAudioBytes(env, bytes, mimeType);
}

async function sendRequestedVoice(
  env: Env,
  chatId: number,
  replyText: string,
  updateId: number,
): Promise<boolean> {
  const startedAt = Date.now();
  try {
    const audio = await synthesizeVoiceReply(env, replyText);
    if (audio) {
      const synthesizedAt = Date.now();
      await sendVoiceNote(env, chatId, audio);
      console.log(JSON.stringify({
        event: "tts_delivered",
        updateId,
        provider: audio.provider,
        fallback: audio.fallback,
        synthesisMs: synthesizedAt - startedAt,
        telegramMs: Date.now() - synthesizedAt,
        bytes: audio.bytes.byteLength,
        contentType: audio.contentType,
      }));
      return true;
    } else {
      console.error(JSON.stringify({ event: "tts_no_audio", updateId }));
    }
  } catch (err) {
    console.error(JSON.stringify({ event: "tts_failed", updateId, error: String(err) }));
  }
  return false;
}

/** Select exactly one response modality. Audio requests never receive the
 * generated answer as text; a text error is used only if voice delivery fails. */
async function deliverReply(
  env: Env,
  chatId: number,
  audioRequested: boolean,
  replyText: string,
  updateId: number,
): Promise<void> {
  if (!audioRequested) {
    await sendText(env, chatId, replyText);
    return;
  }
  await telegram(env, "sendChatAction", { chat_id: chatId, action: "record_voice" }).catch(() => undefined);
  if (!(await sendRequestedVoice(env, chatId, replyText, updateId))) {
    await sendText(env, chatId, "Não consegui gerar o áudio agora. Tente novamente em instantes.");
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


async function processUpdate(env: Env, update: TelegramUpdate, ctx: ExecutionContext): Promise<void> {
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
    if (!userText && message.voice) {
      await telegram(env, "sendChatAction", { chat_id: message.chat.id, action: "typing" });
      userText = await transcribeVoice(env, message.voice.file_id, message.voice.mime_type || "audio/ogg");
      if (!userText) {
        await sendText(env, message.chat.id, "Não consegui entender o áudio. Pode tentar de novo ou escrever?");
        await markUpdate(env, update.update_id, "error");
        return;
      }
      // A transcrição alimenta a mesma consulta de texto, sem ecoar a fala
      // inteira de volta. Isso evita repetir saudações, hesitações e o pedido.
    }

    const voiceRequest = parseVoiceRequest(userText);
    const requestText = voiceRequest.contentText;
    const command = requestText.toLowerCase();
    if (command === "/start" || command === "/help") {
      await sendText(
        env,
        message.chat.id,
        "Brow está online. Envie texto ou áudio para conversar.\n" +
          "Responde sempre em texto — peça \"manda em áudio\" pra receber a resposta falada.\n" +
          "/new limpa o histórico · /status verifica o serviço\n" +
          "/resumo semana · /resumo mes · /grafo · /memoria <termo> · /foto <termo>\n" +
          "Também entende: grave/exclua/mostre memórias, agende eventos, crie tarefas e lembretes. " +
          "Eventos e tarefas com data são avisados automaticamente no Telegram.",
      );
      await markUpdate(env, update.update_id, "done");
      return;
    }
    if (command === "/status") {
      await sendText(env, message.chat.id, "Brow: online, Supabase + Cloudflare, voz e dados em tempo real ativos.");
      await markUpdate(env, update.update_id, "done");
      return;
    }
    if (command === "/new") {
      await clearHistory(env, message.chat.id);
      await sendText(env, message.chat.id, "Histórico reiniciado.");
      await markUpdate(env, update.update_id, "done");
      return;
    }
    if (voiceRequest.replayPrevious) {
      await telegram(env, "sendChatAction", { chat_id: message.chat.id, action: "record_voice" });
      const previous = (await history(env, message.chat.id)).reverse().find((item) => item.role === "assistant")?.content;
      if (!previous) {
        await sendText(env, message.chat.id, "Ainda não há uma resposta anterior para transformar em áudio.");
      } else {
        await deliverReply(env, message.chat.id, true, previous, update.update_id);
      }
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
    if (requestText.toLowerCase().startsWith("/memoria ")) {
      const term = requestText.slice("/memoria ".length).trim();
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

    const memoryResult = await tryMemoryCommand(env, message.chat.id, requestText).catch(() => null);
    if (memoryResult) {
      await saveMessage(env, message, "user", requestText, ctx);
      await saveMessage(env, message, "assistant", memoryResult.reply, ctx);
      await deliverReply(env, message.chat.id, voiceRequest.wantsAudio, memoryResult.reply, update.update_id);
      for (const fileId of memoryResult.imageFileIds || []) {
        await telegram(env, "sendPhoto", { chat_id: message.chat.id, photo: fileId });
      }
      await markUpdate(env, update.update_id, "done");
      return;
    }

    await telegram(env, "sendChatAction", {
      chat_id: message.chat.id,
      action: voiceRequest.wantsAudio ? "record_voice" : "typing",
    }).catch(() => undefined);

    const sportsResult = await trySportsSearchSpecialist(env, requestText, webSearch).catch(() => null);
    const sportsSubject = detectSportsSubject(requestText);
    if (sportsResult || sportsSubject) {
      const reply = sportsResult
        ? formatSpecialistAnswer(sportsResult)
        : `Não consegui confirmar agora os dados atuais de ${sportsSubject}. Prefiro não inventar placar, posição ou competições; tente novamente em instantes.`;
      await saveMessage(env, message, "user", requestText, ctx);
      await saveMessage(env, message, "assistant", reply, ctx);
      await deliverReply(env, message.chat.id, voiceRequest.wantsAudio, reply, update.update_id);
      await markUpdate(env, update.update_id, "done");
      return;
    }

    const newsResearch = isNewsSearchRequest(requestText) ? await research(env, requestText, "news").catch(() => null) : null;
    if (newsResearch) {
      await saveMessage(env, message, "user", requestText, ctx);
      await extractAndSaveFacts(env, message.chat.id, requestText);
      await saveMessage(env, message, "assistant", newsResearch.reply, ctx);
      await deliverReply(env, message.chat.id, voiceRequest.wantsAudio, newsResearch.reply, update.update_id);
      await markUpdate(env, update.update_id, "done");
      return;
    }
    if (isNewsSearchRequest(requestText)) {
      const topic = refineSearchQuery(requestText, { news: true });
      const reply = topic
        ? `Não consegui confirmar notícias atuais sobre ${topic} em fontes reais agora. Tente novamente em instantes.`
        : "Não consegui confirmar as notícias atuais em fontes reais agora. Tente novamente em instantes.";
      await saveMessage(env, message, "user", requestText, ctx);
      await saveMessage(env, message, "assistant", reply, ctx);
      await deliverReply(env, message.chat.id, voiceRequest.wantsAudio, reply, update.update_id);
      await markUpdate(env, update.update_id, "done");
      return;
    }

    const currencyResult = await tryCurrencyConversionShortcut(requestText).catch(() => null);
    if (currencyResult) {
      await saveMessage(env, message, "user", requestText, ctx);
      await extractAndSaveFacts(env, message.chat.id, requestText);
      await saveMessage(env, message, "assistant", currencyResult, ctx);
      await deliverReply(env, message.chat.id, voiceRequest.wantsAudio, currencyResult, update.update_id);
      await markUpdate(env, update.update_id, "done");
      return;
    }

    const actionResult = await tryActionRouter(env, message.chat.id, requestText).catch(() => null);
    if (actionResult) {
      await saveMessage(env, message, "user", requestText, ctx);
      await extractAndSaveFacts(env, message.chat.id, requestText);
      await saveMessage(env, message, "assistant", actionResult, ctx);
      await deliverReply(env, message.chat.id, voiceRequest.wantsAudio, actionResult, update.update_id);
      await markUpdate(env, update.update_id, "done");
      return;
    }

    const ownDataResult = await tryOwnDataQueryShortcut(env, message.chat.id, requestText).catch(() => null);
    if (ownDataResult) {
      await saveMessage(env, message, "user", requestText, ctx);
      await extractAndSaveFacts(env, message.chat.id, requestText);
      await saveMessage(env, message, "assistant", ownDataResult, ctx);
      await deliverReply(env, message.chat.id, voiceRequest.wantsAudio, ownDataResult, update.update_id);
      await markUpdate(env, update.update_id, "done");
      return;
    }

    const useResearch = isExplicitSearchRequest(requestText) || looksLikeFactualQuestion(requestText);
    const webResearch = useResearch ? await research(env, requestText, "web").catch(() => null) : null;
    const searchResult = webResearch?.reply || await tryWebSearchShortcut(env, requestText).catch(() => null);
    if (searchResult) {
      await saveMessage(env, message, "user", requestText, ctx);
      await extractAndSaveFacts(env, message.chat.id, requestText);
      await saveMessage(env, message, "assistant", searchResult, ctx);
      await deliverReply(env, message.chat.id, voiceRequest.wantsAudio, searchResult, update.update_id);
      await markUpdate(env, update.update_id, "done");
      return;
    }
    if (isExplicitSearchRequest(requestText)) {
      const query = refineSearchQuery(requestText);
      const reply = `Não consegui confirmar resultados reais sobre ${query || "esse assunto"} agora. Tente novamente em instantes.`;
      await saveMessage(env, message, "user", requestText, ctx);
      await saveMessage(env, message, "assistant", reply, ctx);
      await deliverReply(env, message.chat.id, voiceRequest.wantsAudio, reply, update.update_id);
      await markUpdate(env, update.update_id, "done");
      return;
    }

    await saveMessage(env, message, "user", requestText, ctx);
    await extractAndSaveFacts(env, message.chat.id, requestText);
    const [currentHistory, realtimeContext] = await Promise.all([
      history(env, message.chat.id),
      buildRealtimeContext(env, message.chat.id, requestText),
    ]);
    const response = await answerWithAI(env, currentHistory, realtimeContext, voiceRequest.wantsAudio);
    await saveMessage(env, message, "assistant", response, ctx);
    await deliverReply(env, message.chat.id, voiceRequest.wantsAudio, response, update.update_id);

    await markUpdate(env, update.update_id, "done");
  } catch (error) {
    console.error(JSON.stringify({ event: "update_failed", updateId: update.update_id, error: String(error) }));
    await markUpdate(env, update.update_id, "error").catch(() => undefined);
    if (message) await sendText(env, message.chat.id, "O Brow encontrou um erro temporário. Tente novamente.");
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
    // Voice synthesis used to run in waitUntil after the immediate ACK. That
    // background lifetime could expire after a slow model call, leaving the
    // user with text but no voice. Keep the request alive until Telegram has
    // accepted the selected response modality; claimUpdate keeps retries safe.
    await processUpdate(env, update, ctx);
    return json({ ok: true });
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(dispatchDueReminders(env));
  },
} satisfies ExportedHandler<Env>;
