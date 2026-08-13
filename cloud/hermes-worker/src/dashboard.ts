// Backend do dashboard/PWA do Hermes. Chamado pelo fetch() de index.ts sob
// /api/dashboard/*, autenticado por bearer HERMES_DASHBOARD_API_SECRET
// (verificado em index.ts antes de chegar aqui). Painel de um usuário só —
// sem login, sem multi-tenant — todas as rotas operam sobre o "dono" do bot
// (primeiro id de TELEGRAM_ALLOWED_USERS).
import {
  json,
  supabase,
  history,
  embedText,
  detectApiLookups,
  generateSummary,
  extractEntityGraph,
  persistEntityGraph,
  buildRealtimeContext,
  answerWithAI,
  synthesizeVoiceReply,
  tryActionRouter,
  extractAndSaveFacts,
  getFacts,
  tryNewsShortcut,
  tryWebSearchShortcut,
  tryCurrencyConversionShortcut,
  tryOwnDataQueryShortcut,
  tryMemoryCommand,
  fetchCategoryNews,
  transcribeAudioBytes,
  webSearch,
} from "./shared";
import { detectSportsSubject, formatSpecialistAnswer, trySportsSearchSpecialist } from "./search_specialist";

function ownerChatId(env: Env): string {
  return env.TELEGRAM_ALLOWED_USERS.split(",")[0]?.trim() ?? "";
}

const TELEMETRY_FRESH_MS = 60_000;

async function getTelemetrySnapshot(env: Env, chatId: string, source: "pc" | "phone"): Promise<Response> {
  const resp = await supabase(env, `hermes_cloud_telemetry?chat_id=eq.${chatId}&source=eq.${source}&select=payload,updated_at&limit=1`);
  const rows = resp.ok ? ((await resp.json()) as any[]) : [];
  const row = rows[0];
  if (!row) return json({ ok: true, telemetry: null, freshness: "never" });
  const age = Date.now() - new Date(row.updated_at).getTime();
  return json({ ok: true, telemetry: row.payload, freshness: age < TELEMETRY_FRESH_MS ? "fresh" : "stale" });
}

async function saveTelemetrySnapshot(env: Env, chatId: string, source: "pc" | "phone", payload: Record<string, unknown>): Promise<void> {
  await supabase(env, "hermes_cloud_telemetry?on_conflict=chat_id,source", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ chat_id: chatId, source, payload, updated_at: new Date().toISOString() }),
  });
}

const OVERLOAD_CPU_PCT = 90;
const OVERLOAD_RAM_PCT = 90;
const OVERLOAD_ALERT_COOLDOWN_MS = 15 * 60 * 1000;

// Várias frases pro mesmo aviso — antes era sempre o mesmo texto fixo,
// pedido do usuário pra soar menos robótico/repetitivo em uso real.
// Cada uma cita a métrica real e o processo real (sem inventar dado).
const OVERLOAD_MESSAGE_TEMPLATES: ((metric: string, pct: number, proc: string, procPct: number) => string)[] = [
  (metric, pct, proc, procPct) =>
    `⚠️ Seu PC está sobrecarregado: ${metric} em ${pct}%.\nMaior consumidor: ${proc} (${procPct}%).\n\nSugestão: feche ${proc}, verifique abas/processos em segundo plano, e se for recorrente considere reiniciar o app ou o PC.`,
  (metric, pct, proc, procPct) =>
    `🔥 Notei ${metric} em ${pct}% agora — bem acima do normal. O ${proc} está puxando ${procPct}% sozinho. Vale fechar ele um instante e ver se alivia.`,
  (metric, pct, proc, procPct) =>
    `👀 Fiquei de olho na sua máquina: ${metric} bateu ${pct}%. O ${proc} é o principal responsável (${procPct}%). Se não estiver usando ele agora, dá pra fechar sem perder nada.`,
  (metric, pct, proc, procPct) =>
    `⚙️ Seu PC está trabalhando pesado — ${metric} a ${pct}%, puxado principalmente por ${proc} (${procPct}%). Recomendo pausar ele um pouco ou reiniciar se isso continuar se repetindo.`,
];

function buildOverloadMessage(metric: string, pct: number, proc: string, procPct: number): string {
  const template = OVERLOAD_MESSAGE_TEMPLATES[Math.floor(Math.random() * OVERLOAD_MESSAGE_TEMPLATES.length)];
  return template(metric, pct, proc, procPct);
}

async function maybeAlertOverload(env: Env, chatId: string, telemetry: any): Promise<void> {
  const cpu = Number(telemetry?.cpuPercent) || 0;
  const ram = Number(telemetry?.ramPercent) || 0;
  if (cpu < OVERLOAD_CPU_PCT && ram < OVERLOAD_RAM_PCT) return;

  const resp = await supabase(env, `hermes_cloud_telemetry?chat_id=eq.${chatId}&source=eq.pc&select=last_alert_at&limit=1`);
  const rows = resp.ok ? ((await resp.json()) as any[]) : [];
  const lastAlert = rows[0]?.last_alert_at ? new Date(rows[0].last_alert_at).getTime() : 0;
  if (Date.now() - lastAlert < OVERLOAD_ALERT_COOLDOWN_MS) return;

  const topProcesses: any[] = Array.isArray(telemetry?.topProcesses) ? telemetry.topProcesses : [];
  const worst = topProcesses[0];
  const worstName = worst?.name || "um processo não identificado";
  const worstPct = Math.round(worst?.cpuPercent ?? worst?.ramPercent ?? 0);
  const metricLabel = cpu >= OVERLOAD_CPU_PCT ? "CPU" : "RAM";
  const metricPct = Math.round(cpu >= OVERLOAD_CPU_PCT ? cpu : ram);
  const message = buildOverloadMessage(metricLabel, metricPct, worstName, worstPct);

  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: Number(chatId), text: message }),
  }).catch(() => undefined);

  await supabase(env, "hermes_cloud_telemetry?on_conflict=chat_id,source", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ chat_id: chatId, source: "pc", payload: telemetry, last_alert_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  });
}

async function readJson(request: Request): Promise<any> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function badRequest(message: string): Response {
  return json({ ok: false, error: message }, 400);
}

// Mesma tabela hermes_cloud_messages do Telegram — sem TelegramMessage aqui
// (o dashboard não tem message_id/from real), então grava direto.
async function saveDashboardMessage(env: Env, chatId: string, role: "user" | "assistant", content: string): Promise<void> {
  const embedding = await embedText(env, content).catch(() => null);
  await supabase(env, "hermes_cloud_messages", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ chat_id: chatId, user_id: chatId, telegram_message_id: null, role, content, embedding }),
  });
}

// ---------------------------------------------------------------------------
// CRUD genérico sobre uma tabela hermes_cloud_* simples (list/create/delete),
// reaproveitado pelas 4 abas mais simples (tasks, goals, agenda, contacts).
// ---------------------------------------------------------------------------
async function listRows(env: Env, table: string, chatId: string, order = "created_at.desc", limit = 200): Promise<any[]> {
  const resp = await supabase(env, `${table}?chat_id=eq.${encodeURIComponent(chatId)}&order=${order}&limit=${limit}`);
  if (!resp.ok) return [];
  return resp.json() as Promise<any[]>;
}

async function createRow(env: Env, table: string, payload: Record<string, unknown>): Promise<Response> {
  const resp = await supabase(env, table, {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) return json({ ok: false, error: await resp.text() }, 500);
  const rows = (await resp.json()) as any[];
  return json({ ok: true, row: rows[0] ?? null });
}

async function updateRow(env: Env, table: string, id: string, chatId: string, patch: Record<string, unknown>): Promise<Response> {
  const resp = await supabase(env, `${table}?id=eq.${encodeURIComponent(id)}&chat_id=eq.${encodeURIComponent(chatId)}`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!resp.ok) return json({ ok: false, error: await resp.text() }, 500);
  const rows = (await resp.json()) as any[];
  return json({ ok: true, row: rows[0] ?? null });
}

async function deleteRow(env: Env, table: string, id: string, chatId: string): Promise<Response> {
  const resp = await supabase(env, `${table}?id=eq.${encodeURIComponent(id)}&chat_id=eq.${encodeURIComponent(chatId)}`, {
    method: "DELETE",
    headers: { prefer: "return=minimal" },
  });
  return json({ ok: resp.ok });
}

// O frontend às vezes manda o UUID completo, às vezes só os 8 primeiros
// caracteres (maiúsculos) como "shortId" de exibição — cobre os dois.
async function deleteRowByIdOrPrefix(env: Env, table: string, idOrPrefix: string, chatId: string): Promise<Response> {
  const filter = idOrPrefix.length >= 32 ? `id=eq.${encodeURIComponent(idOrPrefix)}` : `id=ilike.${encodeURIComponent(idOrPrefix)}*`;
  const resp = await supabase(env, `${table}?${filter}&chat_id=eq.${encodeURIComponent(chatId)}`, {
    method: "DELETE",
    headers: { prefer: "return=minimal" },
  });
  return json({ ok: resp.ok });
}

async function financeSummaryCents(env: Env, chatId: string): Promise<{ income: number; expense: number; balance: number }> {
  const rows = await listRows(env, "hermes_cloud_finance_entries", chatId, "occurred_at.desc", 1000);
  const income = rows.filter((r) => r.kind === "income").reduce((s, r) => s + r.amount_cents, 0);
  const expense = rows.filter((r) => r.kind === "expense").reduce((s, r) => s + r.amount_cents, 0);
  return { income, expense, balance: income - expense };
}

function mapAgendaRow(r: any): any {
  return {
    key: String(r.id),
    id: String(r.id),
    text: r.title || r.description || "",
    description: r.description,
    dueAt: r.starts_at,
    time: undefined,
    sentAt: r.notified_at || null,
    createdAt: r.created_at,
  };
}

// Sem colunas de status/vencimento/parcelas ainda (tabela simples
// kind/amount_cents/category) — mapeia pro shape que a aba Finanças espera,
// sem inventar dado: sempre "pago" (não há conceito de pendente hoje) e sem
// parcelamento/vencimento.
function mapFinanceRow(r: any): any {
  return {
    id: String(r.id),
    type: r.kind === "income" ? "receita" : "despesa",
    amount: r.amount_cents / 100,
    category: r.category,
    description: r.description,
    status: "pago",
    dueDate: undefined,
    occurred_at: r.occurred_at,
  };
}

async function loadMemoryItems(env: Env, chatId: string, limit = 100): Promise<any[]> {
  const [manual, facts, summaries] = await Promise.all([
    listRows(env, "hermes_cloud_memories", chatId, "created_at.desc", limit),
    getFacts(env, Number(chatId)),
    listRows(env, "hermes_cloud_summaries", chatId, "created_at.desc", 20),
  ]);
  const manualItems = manual.map((m: any) => ({
    id: m.id,
    key: m.id,
    title: m.title,
    summary: m.summary || "",
    mainCategory: m.main_category,
    category: m.category,
    priority: m.priority,
    tags: m.tags || [],
    createdAt: m.created_at,
    source: "manual",
  }));
  const factItems = (facts || []).map((f: any) => ({
    id: `fact-${f.key}`,
    key: `fact-${f.key}`,
    title: f.key,
    summary: f.value,
    mainCategory: "fato",
    category: "fato",
    tags: [],
    createdAt: f.updated_at || f.created_at,
    source: "fact",
  }));
  const summaryItems = (summaries || []).map((s: any) => ({
    id: `summary-${s.id}`,
    key: `summary-${s.id}`,
    title: `Resumo ${s.period || ""}`.trim(),
    summary: s.content || "",
    mainCategory: "resumo",
    category: "resumo",
    tags: [],
    createdAt: s.created_at,
    source: "summary",
  }));
  return [...manualItems, ...factItems, ...summaryItems].sort(
    (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
  );
}

export async function handleDashboardRequest(request: Request, env: Env, path: string): Promise<Response> {
  const method = request.method;
  const chatId = ownerChatId(env);
  const segments = path.split("/").filter(Boolean); // e.g. ["tasks", "42"]
  const resource = segments[0] ?? "";
  const id = segments[1];

  // ---- status / overview -----------------------------------------------
  if ((resource === "" || resource === "status") && method === "GET") {
    return json({ service: "hermes-dashboard-api", status: "ok" });
  }

  // Telemetria em tempo real: "pc" vem de um script Python local (psutil,
  // ver tools/pc_telemetry_reporter.py) que faz POST periódico; "phone" vem
  // do próprio PWA (APIs do navegador: bateria, rede, memória, GPS).
  // Sempre snapshot único por (chat_id, source), não histórico.
  if (resource === "telemetry" && method === "GET") {
    return getTelemetrySnapshot(env, chatId, "pc");
  }
  if (resource === "telemetry" && method === "POST") {
    const body = await readJson(request);
    await saveTelemetrySnapshot(env, chatId, "pc", body);
    await maybeAlertOverload(env, chatId, body);
    return json({ ok: true });
  }
  if (resource === "device-telemetry" && method === "GET") {
    return getTelemetrySnapshot(env, chatId, "phone");
  }
  if (resource === "device-telemetry" && method === "POST") {
    const body = await readJson(request);
    await saveTelemetrySnapshot(env, chatId, "phone", body);
    return json({ ok: true });
  }

  if (resource === "overview" && method === "GET") {
    const [messages, images, summaries, entities, openTasks, upcomingAgenda, memoryItems, finances] = await Promise.all([
      supabase(env, `hermes_cloud_messages?chat_id=eq.${chatId}&select=id`).then((r): any[] | Promise<any[]> => (r.ok ? r.json() : [])),
      supabase(env, `hermes_cloud_images?chat_id=eq.${chatId}&select=id`).then((r): any[] | Promise<any[]> => (r.ok ? r.json() : [])),
      supabase(env, `hermes_cloud_summaries?chat_id=eq.${chatId}&select=id`).then((r): any[] | Promise<any[]> => (r.ok ? r.json() : [])),
      supabase(env, `hermes_cloud_entities?chat_id=eq.${chatId}&select=id`).then((r): any[] | Promise<any[]> => (r.ok ? r.json() : [])),
      supabase(env, `hermes_cloud_tasks?chat_id=eq.${chatId}&done=eq.false&select=id`).then((r): any[] | Promise<any[]> => (r.ok ? r.json() : [])),
      supabase(
        env,
        `hermes_cloud_agenda?chat_id=eq.${chatId}&starts_at=gte.${new Date().toISOString()}&order=starts_at.asc&limit=5`,
      ).then((r): any[] | Promise<any[]> => (r.ok ? r.json() : [])),
      loadMemoryItems(env, chatId, 100),
      financeSummaryCents(env, chatId),
    ]);
    return json({
      ok: true,
      counts: {
        messages: messages.length,
        images: images.length,
        summaries: summaries.length,
        entities: entities.length,
        open_tasks: openTasks.length,
      },
      upcoming_agenda: upcomingAgenda,
      memories: { recent: memoryItems.slice(0, 40), count: memoryItems.length },
      finances: {
        saldo: finances.balance / 100,
        receitas: finances.income / 100,
        despesas: finances.expense / 100,
      },
    });
  }

  // ---- memória (fatos+resumos automáticos + memórias manuais da aba) ----
  if (resource === "memories" && method === "GET") {
    return json({ ok: true, items: await loadMemoryItems(env, chatId, 200) });
  }
  if (resource === "memories" && method === "POST") {
    const body = await readJson(request);
    if (!body.title) return badRequest("title é obrigatório");
    return createRow(env, "hermes_cloud_memories", {
      chat_id: chatId,
      title: body.title,
      summary: body.summary || "",
      main_category: body.mainCategory || null,
      category: body.category || null,
      priority: body.priority || null,
      tags: body.tags || [],
    });
  }
  if (resource === "memories" && method === "DELETE" && id) {
    return deleteRowByIdOrPrefix(env, "hermes_cloud_memories", id, chatId);
  }

  if (resource === "facts" && method === "GET") {
    return json({ ok: true, facts: await getFacts(env, Number(chatId)) });
  }
  if (resource === "facts" && method === "DELETE" && id) {
    return deleteRow(env, "hermes_cloud_facts", id, chatId);
  }

  if (resource === "chat-history" && method === "GET") {
    const sinceId = new URL(request.url).searchParams.get("sinceId");
    let rows: any[];
    if (sinceId) {
      rows = await supabase(
        env,
        `hermes_cloud_messages?chat_id=eq.${chatId}&select=id,role,content,telegram_message_id,created_at&id=gt.${encodeURIComponent(sinceId)}&order=id.asc&limit=200`,
      ).then((r): any[] | Promise<any[]> => (r.ok ? r.json() : []));
    } else {
      rows = await supabase(
        env,
        `hermes_cloud_messages?chat_id=eq.${chatId}&select=id,role,content,telegram_message_id,created_at&order=id.desc&limit=200`,
      ).then((r): any[] | Promise<any[]> => (r.ok ? r.json() : []));
      rows.reverse();
    }
    const messages = rows.map((r) => ({
      id: r.id,
      text: r.content,
      role: r.role,
      channel: r.telegram_message_id ? "telegram" : "dashboard",
      createdAt: r.created_at,
    }));
    return json({ ok: true, messages });
  }

  if (resource === "graph" && method === "GET") {
    const [entities, edges] = await Promise.all([
      listRows(env, "hermes_cloud_entities", chatId, "mention_count.desc", 200),
      listRows(env, "hermes_cloud_entity_edges", chatId, "created_at.desc", 200),
    ]);
    return json({ ok: true, entities, edges });
  }

  if (resource === "graph" && method === "POST") {
    const { entities, edges } = await extractEntityGraph(env, Number(chatId));
    await persistEntityGraph(env, Number(chatId), entities, edges);
    return json({ ok: true, entities, edges });
  }

  if (resource === "gallery" && method === "GET") {
    const rows = await listRows(env, "hermes_cloud_images", chatId, "created_at.desc", 100);
    return json({ ok: true, images: rows });
  }

  // ---- voz -----------------------------------------------------------
  if (resource === "voice" && method === "GET") {
    return json({
      ok: true,
      provider: "edge-tts",
      voice: "en-US-AndrewMultilingualNeural",
      pitch: "-10Hz",
      rate: "+40%",
      stt: "@cf/openai/whisper-large-v3-turbo",
    });
  }

  // Transcrição real (Whisper) do áudio gravado no dashboard/PWA — mesma
  // engine que já transcreve o áudio do Telegram, pedido do usuário
  // 13/08/2026 pra ter a mesma precisão nos 3 canais (o reconhecimento
  // nativo do navegador era bem mais fraco).
  if (resource === "stt" && method === "POST") {
    const form = await request.formData().catch(() => null);
    const file = form?.get("audio");
    if (!(file instanceof File)) return badRequest("arquivo de áudio ausente");
    const bytes = await file.arrayBuffer();
    if (!bytes.byteLength) return badRequest("áudio vazio");
    try {
      const text = await transcribeAudioBytes(env, bytes);
      return json({ ok: true, text });
    } catch (e) {
      return json({ ok: false, error: "falha na transcrição", detail: String(e) }, 500);
    }
  }

  // ---- notícias por categoria: RSS editorial real (G1/Exame) quando existe
  // feed dedicado, busca real como fallback pras demais (ver fetchCategoryNews)
  if (resource === "news" && method === "GET") {
    const url = new URL(request.url);
    const category = url.searchParams.get("category") || "";
    const query = url.searchParams.get("query") || url.searchParams.get("q") || "";
    const news = await fetchCategoryNews(category, query, 8);
    const items = news.map((n) => ({
      title: n.title,
      summary: n.snippet,
      source: n.source,
      url: n.url,
      publishedAt: n.publishedAt,
      badge: category || "notícias",
      category,
      time: n.publishedAt ? new Date(n.publishedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "agora",
    }));
    return json({ ok: true, items, updatedAtStr: new Date().toLocaleTimeString("pt-BR") });
  }

  if (resource === "tools" && method === "GET") {
    const tool = segments[1];
    const query = new URL(request.url).searchParams.get("q") || "";
    if (tool === "cambio") {
      const lookups = detectApiLookups("cotação do dólar euro bitcoin");
      const data = lookups.length ? await lookups[0].fetch() : null;
      return json({ ok: true, data });
    }
    if (tool === "clima") {
      const lookups = detectApiLookups(`clima em ${query || "São Paulo"}`);
      const data = lookups.length ? await lookups[0].fetch() : null;
      return json({ ok: true, data });
    }
    if (tool === "cep" && query) {
      const lookups = detectApiLookups(`cep ${query}`);
      const data = lookups.length ? await lookups[0].fetch() : null;
      return json({ ok: true, data });
    }
    return badRequest("ferramenta desconhecida");
  }

  // ---- agenda (shape próprio: o frontend espera items/text/dueAt/sentAt) -
  if (resource === "agenda" && method === "GET") {
    const rows = await listRows(env, "hermes_cloud_agenda", chatId, "starts_at.asc");
    return json({ ok: true, rows, items: rows.map(mapAgendaRow) });
  }
  if (resource === "agenda" && method === "POST") {
    const body = await readJson(request);
    const title = body.text || body.title;
    const startsAt = body.dueAt || body.starts_at;
    if (!title || !startsAt) return badRequest("text/dueAt são obrigatórios");
    return createRow(env, "hermes_cloud_agenda", {
      chat_id: chatId,
      title,
      description: body.description || "",
      starts_at: startsAt,
      ends_at: body.ends_at || null,
    });
  }
  if (resource === "agenda" && method === "PATCH" && id) {
    const body = await readJson(request);
    const patch: Record<string, unknown> = {};
    if (body.text) patch.title = body.text;
    if (body.dueAt) patch.starts_at = body.dueAt;
    if (body.description !== undefined) patch.description = body.description;
    return updateRow(env, "hermes_cloud_agenda", id, chatId, Object.keys(patch).length ? patch : body);
  }
  if (resource === "agenda" && method === "DELETE" && id) {
    return deleteRow(env, "hermes_cloud_agenda", id, chatId);
  }

  // ---- tasks / goals / contacts (CRUD simples) -----------------------
  const simpleTables: Record<string, string> = {
    tasks: "hermes_cloud_tasks",
    goals: "hermes_cloud_goals",
    contacts: "hermes_cloud_contacts",
  };
  if (simpleTables[resource]) {
    const table = simpleTables[resource];
    if (method === "GET") {
      return json({ ok: true, rows: await listRows(env, table, chatId, "created_at.desc") });
    }
    if (method === "POST") {
      const body = await readJson(request);
      return createRow(env, table, { ...body, chat_id: chatId });
    }
    if (method === "PATCH" && id) {
      const body = await readJson(request);
      if (resource === "tasks" && body.done === true) body.completed_at = new Date().toISOString();
      return updateRow(env, table, id, chatId, body);
    }
    if (method === "DELETE" && id) {
      return deleteRow(env, table, id, chatId);
    }
  }

  // ---- finanças --------------------------------------------------------
  if (resource === "finances" && segments[1] === "budget" && method === "GET") {
    const rows = await listRows(env, "hermes_cloud_finance_entries", chatId, "occurred_at.desc", 1000);
    const byCategory: Record<string, number> = {};
    for (const row of rows) {
      if (row.kind !== "expense") continue;
      byCategory[row.category] = (byCategory[row.category] || 0) + row.amount_cents / 100;
    }
    return json({ ok: true, budget: byCategory, by_category: byCategory });
  }
  if (resource === "finances" && segments[1] === "health" && method === "GET") {
    const rows = await listRows(env, "hermes_cloud_finance_entries", chatId, "occurred_at.desc", 1000);
    const now = new Date();
    const curMonth = now.toISOString().slice(0, 7);
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7);
    const sum = (list: any[], kind: string) => list.filter((r) => r.kind === kind).reduce((s, r) => s + r.amount_cents, 0) / 100;
    const curRows = rows.filter((r) => String(r.occurred_at || "").slice(0, 7) === curMonth);
    const prevRows = rows.filter((r) => String(r.occurred_at || "").slice(0, 7) === prevMonth);
    const receitas = sum(curRows, "income");
    const despesas = sum(curRows, "expense");
    const saldo = receitas - despesas;
    const receitasPrevMonth = sum(prevRows, "income");
    const despesasPrevMonth = sum(prevRows, "expense");
    const savingsRate = receitas > 0 ? saldo / receitas : 0;
    const healthStatus = savingsRate >= 0.15 ? "boa" : savingsRate >= 0 ? "atencao" : "critica";
    const byCategory: Record<string, number> = {};
    for (const r of curRows) {
      if (r.kind !== "expense") continue;
      byCategory[r.category] = (byCategory[r.category] || 0) + r.amount_cents / 100;
    }
    return json({
      ok: true,
      health: { saldo, receitas, despesas, savingsRate, healthStatus, receitasPrevMonth, despesasPrevMonth, byCategory, upcoming: [] },
    });
  }
  if (resource === "finances" && method === "GET") {
    const [rows, s] = await Promise.all([
      listRows(env, "hermes_cloud_finance_entries", chatId, "occurred_at.desc"),
      financeSummaryCents(env, chatId),
    ]);
    return json({
      ok: true,
      rows,
      items: rows.map(mapFinanceRow),
      summary: { saldo: s.balance / 100, receitas: s.income / 100, despesas: s.expense / 100 },
    });
  }
  if (resource === "finances" && method === "POST") {
    const body = await readJson(request);
    const kind = body.kind || (body.type === "receita" ? "income" : body.type === "despesa" ? "expense" : undefined);
    const amount = Number(body.amount_cents != null ? body.amount_cents / 100 : body.amount);
    if (!kind || !Number.isFinite(amount) || !body.category) return badRequest("type/amount/category são obrigatórios");
    return createRow(env, "hermes_cloud_finance_entries", {
      chat_id: chatId,
      kind,
      category: body.category,
      amount_cents: Math.round(amount * 100),
      description: body.description || "",
      occurred_at: body.dueDate || body.occurred_at || new Date().toISOString().slice(0, 10),
    });
  }
  if (resource === "finances" && method === "PATCH" && id) {
    // Sem coluna de status ainda (tabela não distingue pendente/pago) — não
    // há o que persistir, mas responde ok pra não travar a UI com erro falso.
    return json({ ok: true });
  }
  if (resource === "finances" && method === "DELETE" && id) {
    return deleteRow(env, "hermes_cloud_finance_entries", id, chatId);
  }

  // ---- documentos --------------------------------------------------------
  if (resource === "documents" && method === "GET") {
    const rows = await listRows(env, "hermes_cloud_documents", chatId, "created_at.desc", 100);
    const items = rows.map((r: any) => ({ ...r, embedding: undefined }));
    return json({ ok: true, documents: items, items });
  }
  if (resource === "documents" && segments[1] === "upload" && method === "POST") {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return badRequest("arquivo ausente");
    const bytes = await file.arrayBuffer();
    const r2Key = `documents/${chatId}/${Date.now()}-${file.name}`;
    await env.HERMES_STORAGE.put(r2Key, bytes, { httpMetadata: { contentType: file.type || "application/octet-stream" } });
    let extractedText = "";
    if (file.type.startsWith("text/") || /\.(txt|md)$/i.test(file.name)) {
      extractedText = new TextDecoder().decode(bytes).slice(0, 20000);
    }
    const embedding = extractedText ? await embedText(env, extractedText).catch(() => null) : null;
    return createRow(env, "hermes_cloud_documents", {
      chat_id: chatId,
      r2_key: r2Key,
      filename: file.name,
      mime_type: file.type || "application/octet-stream",
      extracted_text: extractedText,
      embedding,
    });
  }
  if (resource === "documents" && method === "DELETE" && id) {
    return deleteRow(env, "hermes_cloud_documents", id, chatId);
  }

  // ---- automações (CRUD; execução é manual nesta edição) -------------
  if (resource === "automations" && method === "GET") {
    return json({ ok: true, rows: await listRows(env, "hermes_cloud_automations", chatId) });
  }
  if (resource === "automations" && method === "POST") {
    const body = await readJson(request);
    if (!body.name) return badRequest("name é obrigatório");
    return createRow(env, "hermes_cloud_automations", { ...body, chat_id: chatId });
  }
  if (resource === "automations" && method === "PATCH" && id) {
    const body = await readJson(request);
    return updateRow(env, "hermes_cloud_automations", id, chatId, body);
  }
  if (resource === "automations" && method === "DELETE" && id) {
    return deleteRow(env, "hermes_cloud_automations", id, chatId);
  }
  if (resource === "automations" && segments[2] === "run" && method === "POST") {
    // Cloudflare Workers Free não tem scheduler de usuário arbitrário — só
    // Cron Triggers fixos do próprio Worker. Disparo é manual, honesto sobre
    // essa limitação (nunca finge automação real rodando sozinha).
    await updateRow(env, "hermes_cloud_automations", id!, chatId, { last_run_at: new Date().toISOString() });
    return json({ ok: true, note: "Disparo manual registrado. Execução automática por gatilho não está disponível nesta edição." });
  }

  // ---- skills (liga/desliga capacidades reais) ------------------------
  const DEFAULT_SKILLS = [
    { key: "voice_auto", label: "Resposta em áudio sob pedido", description: "Gera voz quando você pede 'em áudio'/'por áudio'." },
    { key: "news", label: "Notícias em tempo real", description: "Manchetes reais via RSS do G1." },
    { key: "market_data", label: "Câmbio, clima, CEP, CNPJ", description: "Dados públicos em tempo real nas respostas." },
    { key: "semantic_memory", label: "Memória semântica", description: "Recupera trechos antigos relevantes automaticamente." },
    { key: "entity_graph", label: "Grafo de entidades", description: "Extrai pessoas/lugares/assuntos e relações da conversa." },
    { key: "vision_ocr", label: "Visão + OCR", description: "Descreve fotos e lê texto nelas, salva pra busca futura." },
  ];
  if (resource === "skills" && method === "GET") {
    const rows = await listRows(env, "hermes_cloud_skills", chatId, "key.asc", 100);
    const byKey = new Map(rows.map((r: any) => [r.key, r]));
    const merged = DEFAULT_SKILLS.map((s) => byKey.get(s.key) ?? { ...s, chat_id: chatId, enabled: true });
    return json({ ok: true, skills: merged });
  }
  if (resource === "skills" && method === "PATCH" && id) {
    const body = await readJson(request);
    const resp = await supabase(env, `hermes_cloud_skills?on_conflict=chat_id,key`, {
      method: "POST",
      headers: { prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        chat_id: chatId,
        key: id,
        label: body.label ?? id,
        description: body.description ?? "",
        enabled: Boolean(body.enabled),
        updated_at: new Date().toISOString(),
      }),
    });
    if (!resp.ok) return json({ ok: false, error: await resp.text() }, 500);
    return json({ ok: true });
  }

  // ---- resumos (reaproveita generateSummary já usado no Telegram) ------
  if (resource === "summary" && method === "GET") {
    const period = new URL(request.url).searchParams.get("period") === "month" ? "month" : "week";
    const summary = await generateSummary(env, Number(chatId), period);
    return json({ ok: true, period, summary });
  }

  // ---- chat (dashboard/PWA conversam com o MESMO cérebro do Telegram: ----
  // ---- mesma janela hermes_cloud_messages, mesma memória semântica) ------
  if (resource === "chat" && method === "POST") {
    const body = await readJson(request);
    const text = String(body.message || "").trim();
    if (!text) return badRequest("message vazio");

    const memoryResult = await tryMemoryCommand(env, Number(chatId), text).catch(() => null);
    if (memoryResult) {
      await saveDashboardMessage(env, chatId, "user", text);
      await saveDashboardMessage(env, chatId, "assistant", memoryResult.reply);
      return json({ ok: true, reply: memoryResult.reply, imageFileIds: memoryResult.imageFileIds || [] });
    }

    const sportsResult = await trySportsSearchSpecialist(env, text, webSearch).catch(() => null);
    const sportsSubject = detectSportsSubject(text);
    if (sportsResult || sportsSubject) {
      const reply = sportsResult
        ? formatSpecialistAnswer(sportsResult)
        : `Não consegui confirmar agora os dados atuais de ${sportsSubject}. Prefiro não inventar placar, posição ou competições; tente novamente em instantes.`;
      await saveDashboardMessage(env, chatId, "user", text);
      await saveDashboardMessage(env, chatId, "assistant", reply);
      return json({ ok: true, reply, kind: "sports_fact" });
    }

    const newsShortcut = await tryNewsShortcut(env, text).catch(() => null);
    if (newsShortcut) {
      await saveDashboardMessage(env, chatId, "user", text);
      await saveDashboardMessage(env, chatId, "assistant", newsShortcut);
      return json({ ok: true, reply: newsShortcut });
    }

    const currencyResult = await tryCurrencyConversionShortcut(text).catch(() => null);
    if (currencyResult) {
      await saveDashboardMessage(env, chatId, "user", text);
      await extractAndSaveFacts(env, Number(chatId), text);
      await saveDashboardMessage(env, chatId, "assistant", currencyResult);
      return json({ ok: true, reply: currencyResult });
    }

    const actionResult = await tryActionRouter(env, Number(chatId), text).catch(() => null);
    if (actionResult) {
      await saveDashboardMessage(env, chatId, "user", text);
      await extractAndSaveFacts(env, Number(chatId), text);
      await saveDashboardMessage(env, chatId, "assistant", actionResult);
      return json({ ok: true, reply: actionResult });
    }

    const ownDataResult = await tryOwnDataQueryShortcut(env, Number(chatId), text).catch(() => null);
    if (ownDataResult) {
      await saveDashboardMessage(env, chatId, "user", text);
      await extractAndSaveFacts(env, Number(chatId), text);
      await saveDashboardMessage(env, chatId, "assistant", ownDataResult);
      return json({ ok: true, reply: ownDataResult });
    }

    const searchResult = await tryWebSearchShortcut(env, text).catch(() => null);
    if (searchResult) {
      await saveDashboardMessage(env, chatId, "user", text);
      await extractAndSaveFacts(env, Number(chatId), text);
      await saveDashboardMessage(env, chatId, "assistant", searchResult);
      return json({ ok: true, reply: searchResult });
    }

    await saveDashboardMessage(env, chatId, "user", text);
    await extractAndSaveFacts(env, Number(chatId), text);
    const [currentHistory, realtimeContext] = await Promise.all([
      history(env, Number(chatId)),
      buildRealtimeContext(env, Number(chatId), text),
    ]);
    const reply = await answerWithAI(env, currentHistory, realtimeContext);
    await saveDashboardMessage(env, chatId, "assistant", reply);
    return json({ ok: true, reply });
  }

  // ---- tts (mesma voz Edge Neural AndrewMultilingualNeural do Telegram) --
  if (resource === "tts" && method === "POST") {
    const body = await readJson(request);
    const text = String(body.text || "").trim();
    if (!text) return badRequest("text vazio");
    const audio = await synthesizeVoiceReply(env, text);
    if (!audio) return json({ ok: false, error: "tts_failed" }, 502);
    return new Response(audio, { headers: { "content-type": "audio/mpeg" } });
  }

  return json({ ok: false, error: "not_found", resource }, 404);
}
