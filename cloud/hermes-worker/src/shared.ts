// Funções e tipos reaproveitados entre o webhook do Telegram (index.ts) e
// as rotas do dashboard (dashboard.ts). Ficam fora de index.ts porque o
// Wrangler exige que o módulo 'main' só exporte um ExportedHandler default.

type StoredMessage = {
  role: "user" | "assistant";
  content: string;
};
import { compactSourceLink, isNewsSearchRequest, refineSearchQuery } from "./search_query";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export function systemPrompt(): string {
  const now = new Date();
  const dataHoje = now.toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const horaAgora = now.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  return (
    "Você é Hermes, um assistente pessoal útil, direto e confiável. Responda em português do Brasil. " +
    "Esta é a edição cloud gratuita: não afirme ter executado terminal, navegador ou editado arquivos locais. " +
    "Quando o contexto abaixo trouxer um bloco '[O QUE VOCÊ JÁ SABE SOBRE O USUÁRIO]', esses fatos são permanentes " +
    "e confirmados — use-os direto (nome, preferências etc.) sem perguntar de novo e sem dizer que não sabe. " +
    `HOJE é ${dataHoje}, ${horaAgora} (horário de Brasília) — este é o presente real, não o futuro; ` +
    "seu treinamento tem um corte antigo, então NUNCA diga 'não tenho acesso a informações futuras' pra algo até essa data — " +
    "em vez disso use o bloco [DADOS EM TEMPO REAL] quando ele vier, ou diga que não tem certeza sem esse bloco. " +
    "Você TEM acesso a dados públicos em tempo real (CEP, CNPJ, câmbio, clima, feriados, notícias, Wikipédia, IP público) " +
    "quando o contexto abaixo trouxer um bloco '[DADOS EM TEMPO REAL]'. Quando esse bloco existir, é INFORMAÇÃO REAL E ATUAL " +
    "— use OS DADOS EXATOS dele (cite títulos, números e nomes literalmente como aparecem), NUNCA substitua por algo " +
    "genérico ou inventado da sua memória de treino, mesmo que pareça razoável. " +
    "Sem esse bloco, não invente números, datas específicas ou estatísticas — diga que não tem o dado confirmado " +
    "em vez de estimar algo que soa plausível. Isso vale pra QUALQUER fato verificável (notícia, preço, taxa, " +
    "resultado esportivo, evento), não só quando a pergunta menciona 'tempo real' explicitamente. " +
    "Quando não há API específica pro que foi pedido, o sistema busca na internet de verdade (DuckDuckGo) e traz " +
    "um bloco '[BUSCA NA INTERNET]' com resultados reais — trate esse bloco com a MESMA confiança do " +
    "[DADOS EM TEMPO REAL], cite fonte/URL quando fizer sentido. Só quando NENHUM dos dois blocos vier é que você " +
    "não tem dado confirmado — nesse caso diga isso claramente, nunca invente. " +
    "Você TEM voz: entende áudios que o usuário manda e, quando ele pedir áudio/voz de qualquer jeito ('manda em áudio', " +
    "'gera o áudio', 'quero ouvir'), o SISTEMA (não você) gera e envia o áudio de verdade automaticamente logo depois " +
    "do seu texto. Por causa disso: NUNCA descreva, transcreva, fabrique ou finja um áudio dentro da sua resposta de texto " +
    "(nada de '[ÁUDIO: ...]', 'toca aqui', links falsos de Google Drive/YouTube ou qualquer coisa do tipo) — isso é sempre " +
    "mentira, o link nunca existe de verdade. Responda o conteúdo normalmente em texto; o áudio real chega sozinho depois. " +
    "Você TEM visão: quando o usuário manda uma foto, você já a descreveu e leu o texto nela (OCR) — isso aparece " +
    "como [DESCRIÇÃO DA IMAGEM] ou [MEMÓRIA VISUAL] no contexto — e ela fica salva pra buscas futuras via /memoria. " +
    "AUTOCONHECIMENTO — suas ferramentas reais: você tem acesso automático e determinístico (não decidido por você, " +
    "roda ANTES de qualquer resposta sua) a: (1) criar tarefa/lembrete/evento de agenda/lançamento financeiro quando " +
    "o pedido usa um verbo de criação claro (crie, agende, marque, lembre, anote, adicione) com dado suficiente — " +
    "quando isso acontece, o SISTEMA confirma com uma mensagem começando em ✅ e SALVA ISSO NO HISTÓRICO da conversa " +
    "ANTES de você ser chamado; (2) dados públicos em tempo real (CEP, CNPJ, câmbio, clima, feriados, notícias, " +
    "Wikipédia, IP, países, livros, terremotos, artigos científicos, conversão de moeda, QR code, código de barras); " +
    "(3) busca real na internet quando não há API dedicada; (4) voz (ouve áudio, gera áudio quando pedido); " +
    "(5) visão (descreve foto, lê texto nela). " +
    "Se esta mensagem chegou até você (o modelo) SEM nenhuma mensagem ✅ recente no histórico confirmando a ação, " +
    "significa que o pedido de criar tarefa/evento/lançamento financeiro NÃO foi reconhecido automaticamente dessa " +
    "vez — não finja que criou, peça pra reformular com data/valor mais explícitos, ou oriente a criar na aba certa " +
    "(Tarefas, Agenda, Finanças). MAS: antes de negar que criou algo, CONFIRA o histórico da conversa — se uma " +
    "mensagem sua anterior já começa com ✅ confirmando aquela ação específica, ela é real e aconteceu de verdade; " +
    "reconheça isso em vez de contradizer seu próprio histórico. Você NÃO TEM como criar meta ou contato durante a " +
    "conversa ainda — oriente a usar a aba correspondente do painel (Metas, Contatos). " +
    "REGRA ABSOLUTA sobre o símbolo ✅: você NUNCA, em hipótese alguma, inicia uma resposta sua com ✅ ou inventa " +
    "uma frase no estilo 'Evento criado'/'Tarefa criada'/'Gasto registrado' — esse símbolo é EXCLUSIVO do sistema " +
    "determinístico, que já responde por conta própria ANTES de você ser chamado quando a ação é reconhecida. Se " +
    "você foi chamado, a ação NÃO foi reconhecida dessa vez — dizer que criou algo sem ter sido você quem executou " +
    "é inventar um resultado que nunca aconteceu de verdade, mesmo que pareça útil."
  );
}


export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}


export function secureEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const left = enc.encode(a);
  const right = enc.encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}


export async function supabase(
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


export async function history(env: Env, chatId: number): Promise<StoredMessage[]> {
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


export async function embedText(env: Env, text: string): Promise<number[] | null> {
  const clipped = text.length > 2000 ? text.slice(0, 2000) : text;
  const result = (await env.AI.run("@cf/baai/bge-m3", { text: [clipped] })) as {
    data?: number[][];
  };
  const vector = result?.data?.[0];
  return Array.isArray(vector) ? vector : null;
}


export async function recallRelevantMemories(env: Env, chatId: number, queryText: string): Promise<string[]> {
  const embedding = await embedText(env, queryText).catch(() => null);
  if (!embedding) return [];
  const response = await supabase(env, "rpc/match_hermes_memories", {
    method: "POST",
    body: JSON.stringify({
      query_embedding: embedding,
      target_chat_id: String(chatId),
      match_count: 4,
      exclude_recent: 20,
    }),
  });
  if (!response.ok) return [];
  const rows = (await response.json()) as { content: string; role: string; created_at: string; similarity: number }[];
  return rows
    .filter((r) => r.similarity > 0.55)
    .map((r) => `[${new Date(r.created_at).toLocaleDateString("pt-BR")}] ${r.role === "user" ? "Usuário" : "Hermes"}: ${r.content}`);
}


export function base64FromBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const block = 0x8000;
  for (let index = 0; index < bytes.length; index += block) {
    binary += String.fromCharCode(...bytes.subarray(index, index + block));
  }
  return btoa(binary);
}

// STT real (Whisper) — usado tanto pro áudio do Telegram (transcribeVoice
// em index.ts) quanto pro microfone do dashboard/PWA (endpoint /stt em
// dashboard.ts), pra ter a MESMA precisão de transcrição nos 3 canais em
// vez do reconhecimento nativo (mais fraco) do navegador.
export async function transcribeAudioBytes(env: Env, bytes: ArrayBuffer): Promise<string> {
  const result = (await env.AI.run("@cf/openai/whisper-large-v3-turbo", {
    audio: base64FromBuffer(bytes),
    task: "transcribe",
    language: "pt",
    vad_filter: true,
    condition_on_previous_text: false,
  } as any)) as { text?: string };
  return (result.text || "").trim();
}

export async function fetchJsonWithTimeout(url: string, ms = 6000): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "HermesCloudFree/1.0" },
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}


export type ApiLookup = { label: string; fetch: () => Promise<any | null> };

export function detectApiLookups(text: string): ApiLookup[] {
  const lookups: ApiLookup[] = [];
  const lower = text.toLowerCase();

  const cep = text.match(/\b(\d{5})-?(\d{3})\b/);
  if (cep && /cep|endere[cç]o/.test(lower)) {
    const clean = `${cep[1]}${cep[2]}`;
    lookups.push({
      label: `CEP ${clean}`,
      fetch: () => fetchJsonWithTimeout(`https://brasilapi.com.br/api/cep/v2/${clean}`),
    });
  }

  const cnpj = text.match(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/);
  if (cnpj) {
    const clean = cnpj[0].replace(/\D/g, "");
    lookups.push({
      label: `CNPJ ${clean}`,
      fetch: () => fetchJsonWithTimeout(`https://brasilapi.com.br/api/cnpj/v1/${clean}`),
    });
  }

  if (/(cota[cç][ãa]o|d[oó]lar|euro|bitcoin|c[aâ]mbio)/.test(lower)) {
    lookups.push({
      label: "Câmbio USD/EUR/BTC → BRL",
      fetch: () =>
        fetchJsonWithTimeout("https://economia.awesomeapi.com.br/last/USD-BRL,EUR-BRL,BTC-BRL"),
    });
  }

  if (/(clima|tempo|previs[ãa]o|chuva|temperatura)/.test(lower)) {
    const cityMatch = lower.match(/(?:tempo|clima|previs[ãa]o)(?:\s+(?:em|para|de|no|na))?\s+([a-zà-ú\s]{3,40})/);
    const city = cityMatch ? cityMatch[1].trim().replace(/[?.!]+$/, "") : "São Paulo";
    lookups.push({
      label: `Clima em ${city}`,
      fetch: async () => {
        const geo = await fetchJsonWithTimeout(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=pt`,
        );
        const place = geo?.results?.[0];
        const lat = place?.latitude ?? -23.55;
        const lon = place?.longitude ?? -46.63;
        const weather = await fetchJsonWithTimeout(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation,wind_speed_10m`,
        );
        return weather ? { resolved_location: place?.name ?? city, ...weather } : null;
      },
    });
  }

  if (/(feriad[oa]s?)/.test(lower)) {
    const year = new Date().getUTCFullYear() || 2026;
    lookups.push({
      label: `Feriados nacionais ${year}`,
      fetch: () => fetchJsonWithTimeout(`https://date.nager.at/api/v3/PublicHolidays/${year}/BR`),
    });
  }

  if (/(meu ip|ip p[uú]blico)/.test(lower)) {
    lookups.push({ label: "IP público", fetch: () => fetchJsonWithTimeout("https://api.ipify.org?format=json") });
  }

  const wikiMatch = lower.match(/(?:quem [ée]|o que [ée]|wikip[eé]dia(?: sobre)?)\s+(.{3,60})/);
  if (wikiMatch) {
    const topic = wikiMatch[1].replace(/[?.!]+$/, "").trim();
    lookups.push({
      label: `Wikipédia: ${topic}`,
      fetch: () =>
        fetchJsonWithTimeout(
          `https://pt.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`,
        ),
    });
  }

  if (isNewsSearchRequest(text) || /(?:^|\s)(?:acontecendo|eventos?|jornal|jogo de hoje|resultado de|placar)(?=$|\s|[?!,.;:])/i.test(lower)) {
    const topic = refineSearchQuery(text, { news: true });
    lookups.push({
      label: topic ? `Notícias sobre ${topic}` : "Manchetes de hoje (Brasil)",
      fetch: () => fetchGoogleNewsHeadlines(topic),
    });
  }

  // ---------------------------------------------------------------------
  // APIs adicionais (13/08/2026, pedido do usuário: "instalar as 20 APIs
  // gratuitas"). Cada uma é isolada — regex própria + fetch() próprio, e
  // todas usam fetchJsonWithTimeout (nunca lança exceção, sempre null em
  // falha) — uma API quebrando NUNCA derruba as outras nem a resposta
  // normal, porque buildRealtimeContext roda todos os lookups num
  // Promise.all e filtra null depois.
  // ---------------------------------------------------------------------

  const countryMatch = lower.match(/(?:dados|informa[çc][õo]es?|sobre)\s+(?:d[eo]\s+)?pa[íi]s\s+(.{2,40})|pa[íi]s\s+(.{2,40})/);
  if (countryMatch) {
    const name = (countryMatch[1] || countryMatch[2] || "").replace(/[?.!]+$/, "").trim();
    if (name) {
      lookups.push({
        label: `País: ${name}`,
        fetch: () => fetchJsonWithTimeout(`https://restcountries.com/v3.1/translation/${encodeURIComponent(name)}?fields=name,capital,population,region,currencies,languages`),
      });
    }
  }

  const bookMatch = lower.match(/(?:livro sobre|quem escreveu|autor de|livro chamado)\s+(.{2,60})/);
  if (bookMatch) {
    const title = bookMatch[1].replace(/[?.!]+$/, "").trim();
    lookups.push({
      label: `Livro: ${title}`,
      fetch: () => fetchJsonWithTimeout(`https://openlibrary.org/search.json?q=${encodeURIComponent(title)}&limit=3&fields=title,author_name,first_publish_year`),
    });
  }

  if (/terremotos?|abalos? s[íi]smicos?/.test(lower)) {
    lookups.push({
      label: "Terremotos recentes (24h, magnitude 4.5+)",
      fetch: () => fetchJsonWithTimeout("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson"),
    });
  }

  const articleMatch = lower.match(/(?:artigo cient[íi]fico|paper|pesquisa acad[eê]mica)\s+(?:sobre\s+)?(.{2,60})/);
  if (articleMatch) {
    const topic = articleMatch[1].replace(/[?.!]+$/, "").trim();
    lookups.push({
      label: `Artigos científicos: ${topic}`,
      fetch: async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6000);
        try {
          const resp = await fetch(`http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(topic)}&max_results=3`, { signal: controller.signal });
          if (!resp.ok) return null;
          const xml = await resp.text();
          const titles = [...xml.matchAll(/<title>([\s\S]*?)<\/title>/g)].map((m) => m[1].trim()).slice(1, 4);
          return titles.length ? { results: titles } : null;
        } catch {
          return null;
        } finally {
          clearTimeout(timer);
        }
      },
    });
  }

  // Conversão de moeda foi promovida a atalho determinístico (ver
  // tryCurrencyConversionShortcut) — testado ao vivo 13/08/2026: mesmo
  // recebendo o total JÁ CONVERTIDO pré-formatado no contexto, o modelo
  // pequeno ignorava o dado e recalculava sozinho, errando o valor (chegou
  // a devolver 300 GBP ≈ 205 BRL, quando o real era ~2070). Injetar como
  // contexto pro LLM decidir não é confiável o bastante pra matemática —
  // só o bypass total resolve, mesmo tema já visto em notícias/busca.

  if (/qr\s*code/.test(lower)) {
    const qrMatch = text.match(/qr\s*code\s+(?:de|para|do|da)?\s*(.{2,120})/i);
    const payload = qrMatch?.[1]?.replace(/[?.!]+$/, "").trim();
    if (payload) {
      lookups.push({
        label: `QR Code de "${payload}"`,
        fetch: async () => ({ qr_code_url: `https://quickchart.io/qr?text=${encodeURIComponent(payload)}&size=300` }),
      });
    }
  }

  const barcodeMatch = text.match(/c[óo]digo de barras\s+(\d{8,14})/i);
  if (barcodeMatch) {
    lookups.push({
      label: `Produto (código de barras ${barcodeMatch[1]})`,
      fetch: () => fetchJsonWithTimeout(`https://world.openfoodfacts.org/api/v2/product/${barcodeMatch[1]}.json`),
    });
  }

  return lookups.slice(0, 3); // no máximo 3 buscas por mensagem — mantém a resposta rápida
}

// Notícias em português via LLM pequeno tendem a virar paráfrase/alucinação
// mesmo com os dados reais no contexto — atalho determinístico: se a
// mensagem é só um pedido de notícia, devolve os títulos reais direto,
// sem passar pelo modelo.

export type NewsItem = {
  title: string;
  url: string;
  source: string;
  snippet: string;
  publishedAt: string | null;
};

function decodeXml(value: string): string {
  return stripHtmlTags(
    value
      .replace(/^<!\[CDATA\[/, "")
      .replace(/\]\]>$/, "")
      .trim(),
  );
}

export function parseRssItems(xml: string, source: string, limit: number): NewsItem[] {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => match[1]);
  const results: NewsItem[] = [];
  for (const item of items) {
    const rawTitle = item.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "";
    const rawLink = item.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "";
    const rawDescription = item.match(/<description>([\s\S]*?)<\/description>/)?.[1] || "";
    const rawDate = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || "";
    const title = decodeXml(rawTitle);
    const url = decodeXml(rawLink);
    if (!title || !/^https?:\/\//i.test(url)) continue;
    const parsedDate = rawDate ? new Date(decodeXml(rawDate)) : null;
    results.push({
      title,
      url,
      source,
      snippet: decodeXml(rawDescription).slice(0, 320),
      publishedAt: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : null,
    });
    if (results.length >= limit) break;
  }
  return results;
}

export async function fetchGoogleNewsHeadlines(topic: string): Promise<NewsItem[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const resp = await fetch("https://g1.globo.com/rss/g1/", {
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; HermesCloudFree/1.0)" },
    });
    if (!resp.ok) return null;
    const xml = await resp.text();
    let items = parseRssItems(xml, "g1.globo.com", 20);
    if (topic) {
      const needle = topic.toLowerCase();
      items = items.filter((item) => `${item.title} ${item.snippet}`.toLowerCase().includes(needle));
    }
    items = items.slice(0, 6);
    return items.length ? items : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Notícias por categoria pro dashboard: RSS editorial de verdade (G1/Exame),
// não busca genérica — evita o problema de resultado patrocinado/ruído que
// aparecia quando cada categoria virava uma query de busca solta (achado
// 13/08/2026, categoria "futebol" devolvendo anúncio de Mercado Livre).
// ---------------------------------------------------------------------------

const NEWS_CATEGORY_FEEDS: Record<string, { url: string; source: string }[]> = {
  politica: [{ url: "https://g1.globo.com/rss/g1/politica/", source: "g1.globo.com" }],
  tecnologia: [{ url: "https://g1.globo.com/rss/g1/tecnologia/", source: "g1.globo.com" }],
  financas: [{ url: "https://g1.globo.com/rss/g1/economia/", source: "g1.globo.com" }],
  negocios: [{ url: "https://exame.com/feed/", source: "exame.com" }],
  investimentos: [{ url: "https://exame.com/feed/", source: "exame.com" }],
};

async function fetchRssItems(feed: { url: string; source: string }, limit: number): Promise<NewsItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const resp = await fetch(feed.url, {
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; HermesCloudFree/1.0)" },
    });
    if (!resp.ok) return [];
    const xml = await resp.text();
    return parseRssItems(xml, feed.source, limit);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// Notícias reais por categoria: feed RSS editorial dedicado quando existe
// (confiável, sem anúncio); pra categorias/tópicos sem feed dedicado (ex.:
// futebol, IA, um assunto customizado do usuário) cai pra busca real na
// internet (webSearch, já filtrada de anúncio).
export async function fetchCategoryNews(category: string, query: string, limit = 8): Promise<NewsItem[]> {
  const feeds = NEWS_CATEGORY_FEEDS[category];
  if (feeds?.length) {
    const perFeed = Math.ceil(limit / feeds.length);
    const results = (await Promise.all(feeds.map((f) => fetchRssItems(f, perFeed)))).flat();
    const needle = query && query !== category ? query.toLowerCase() : "";
    const filtered = needle ? results.filter((r) => r.title.toLowerCase().includes(needle)) : results;
    const final = filtered.length ? filtered : results; // query não bateu com nada do feed — mostra o feed geral em vez de vazio
    if (final.length) return final.slice(0, limit);
  }
  const searchTerm = query ? `notícias ${query}` : `notícias ${category} Brasil hoje`;
  const found = await webSearch(searchTerm, limit);
  return found.map((r) => {
    let source = "Fonte Externa";
    try {
      source = new URL(r.url).hostname.replace(/^www\./, "");
    } catch {
      /* url malformada — mantém fallback */
    }
    return { title: r.title, url: r.url, source, snippet: r.snippet, publishedAt: null };
  });
}


// ---------------------------------------------------------------------------
// Busca real na internet (DuckDuckGo HTML — funciona a partir de Workers;
// Google/Google News bloqueiam o range de IPs da Cloudflare, confirmado em
// teste). Usada quando nenhuma API dedicada cobre o pedido. Tenta a
// pergunta como veio; se não achar nada, tenta de novo com uma versão mais
// curta/genérica antes de desistir — "loop de alternativas" pedido pelo
// usuário, sem ficar tentando pra sempre (máximo 2 tentativas).
// ---------------------------------------------------------------------------

export type WebSearchResult = { title: string; url: string; snippet: string };

function decodeDuckDuckGoUrl(href: string): string {
  const match = href.match(/uddg=([^&]+)/);
  if (!match) return href.startsWith("//") ? `https:${href}` : href;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return href;
  }
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Domínios de anúncio/tracking que às vezes aparecem misturados nos
// resultados "orgânicos" do DDG HTML (achado 13/08/2026: query sobre
// Flamengo devolveu um link patrocinado do Mercado Livre) — descarta antes
// de contar pro limite, pra não empurrar resultado editorial de verdade
// pra fora da lista.
const AD_URL_PATTERN = /duckduckgo\.com\/y\.js|bing\.com\/aclick|doubleclick\.net|googleadservices\.com|\/aclk\?/i;

async function duckDuckGoSearch(query: string, limit = 5): Promise<WebSearchResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const resp = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36" },
    });
    if (!resp.ok) return [];
    const html = await resp.text();
    const results: WebSearchResult[] = [];
    const blockRe = /<a rel="nofollow" class="result__a" href="([^"]+)">([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let match: RegExpExecArray | null;
    while ((match = blockRe.exec(html)) && results.length < limit) {
      if (AD_URL_PATTERN.test(match[1])) continue;
      const url = decodeDuckDuckGoUrl(match[1]);
      if (AD_URL_PATTERN.test(url)) continue;
      const title = stripHtmlTags(match[2]);
      const snippet = stripHtmlTags(match[3]);
      if (title && url) results.push({ title, url, snippet });
    }
    return results;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// Fontes extras gratuitas e sem chave — sem cobertura de notícias BR, mas
// enriquecem pesquisa geral/técnica (discussões reais, não alucinadas).
async function hackerNewsSearch(query: string, limit = 3): Promise<WebSearchResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await fetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${limit}`, {
      signal: controller.signal,
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as { hits?: any[] };
    return (data.hits || [])
      .filter((h) => h.title && (h.url || h.objectID))
      .map((h) => ({
        title: h.title as string,
        url: (h.url as string) || `https://news.ycombinator.com/item?id=${h.objectID}`,
        snippet: `Hacker News · ${h.points ?? 0} pontos, ${h.num_comments ?? 0} comentários`,
      }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function redditSearch(query: string, limit = 3): Promise<WebSearchResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await fetch(`https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=${limit}&sort=relevance`, {
      signal: controller.signal,
      headers: { "user-agent": "HermesCloudFree/1.0 (search)" },
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as { data?: { children?: any[] } };
    return (data.data?.children || [])
      .map((c) => c.data)
      .filter((d) => d?.title)
      .map((d) => ({
        title: d.title as string,
        url: `https://www.reddit.com${d.permalink}`,
        snippet: `r/${d.subreddit} · ${d.ups ?? 0} upvotes, ${d.num_comments ?? 0} comentários`,
      }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function webSearch(query: string, limit = 5): Promise<WebSearchResult[]> {
  let results = await duckDuckGoSearch(query, limit);
  if (!results.length) {
    // Alternativa: pergunta mais curta/genérica (tira palavras de pergunta e
    // pontuação) — cobre casos onde a frase completa é longa demais pro
    // buscador casar bem.
    const simplified = query
      .replace(/[?.!]+/g, "")
      .replace(/\b(o que|quem|qual|como|quando|onde|por que|porque|é|são|foi|hoje|agora)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    if (simplified && simplified.toLowerCase() !== query.toLowerCase()) {
      results = await duckDuckGoSearch(simplified, limit);
    }
  }
  // Enriquece com fontes gratuitas extras (sem chave) SÓ quando o DDG já
  // trouxe algum resultado real — nunca como substituto de DDG=0, porque
  // HN/Reddit são majoritariamente em inglês e sem relevância local; usá-los
  // pra preencher uma busca de notícia BR que falhou trazia lixo (achado
  // 13/08/2026: "notícias vasco" sem resultado no DDG virou post do Hacker
  // News sobre extensão de VS Code).
  if (results.length > 0 && results.length < limit) {
    const seen = new Set(results.map((r) => r.url));
    const [hn, reddit] = await Promise.all([
      hackerNewsSearch(query, limit - results.length),
      redditSearch(query, limit - results.length),
    ]);
    for (const extra of [...hn, ...reddit]) {
      if (results.length >= limit) break;
      if (seen.has(extra.url)) continue;
      seen.add(extra.url);
      results.push(extra);
    }
  }
  return results;
}

function sourceFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "fonte externa";
  }
}

const NEWS_INTROS = ["📰 Olha o que saiu agora:", "📰 Aqui está o que encontrei:", "📰 O que tem de novo:"];
const NEWS_TOPIC_INTROS = (topic: string) => [
  `📰 Sobre ${topic}, o que saiu agora:`,
  `📰 Encontrei isso sobre ${topic}:`,
  `📰 Últimas sobre ${topic}:`,
];

export async function tryNewsShortcut(env: Env, text: string): Promise<string | null> {
  if (!isNewsSearchRequest(text)) return null;
  const topic = refineSearchQuery(text, { news: true });
  // 1ª tentativa: Google de verdade via grounding do Gemini — resumo
  // coerente, não lista de manchete solta (pedido do usuário 13/08/2026).
  if (topic) {
    const grounded = await googleGroundedSearch(env, `notícias mais recentes sobre ${topic} no Brasil hoje`);
    if (grounded?.summary && grounded.sources.length) {
      const intros = NEWS_TOPIC_INTROS(topic);
      const intro = intros[Math.floor(Math.random() * intros.length)];
      const sourcesTxt = `\n\nFontes:\n${grounded.sources.slice(0, 4).map((s) => `• ${s.title || sourceFromUrl(s.url)} — ${compactSourceLink(s.url)}`).join("\n")}`;
      return `${intro}\n\n${grounded.summary}${sourcesTxt}`;
    }
  }

  const headlines = await fetchGoogleNewsHeadlines(topic);
  if (headlines?.length) {
    const intros = topic ? NEWS_TOPIC_INTROS(topic) : NEWS_INTROS;
    const intro = intros[Math.floor(Math.random() * intros.length)];
    const lines = headlines.slice(0, 5).map((item) => {
      const detail = item.snippet && item.snippet !== item.title ? `\n  ${item.snippet}` : "";
      return `• ${item.title}${detail}\n  Fonte: ${item.source} — ${compactSourceLink(item.url)}`;
    });
    return `${intro}\n\n${lines.join("\n\n")}`;
  }
  // G1 não tem nada sobre esse tópico específico (o feed é geral, não uma
  // busca) — cai pra busca real na internet em vez de desistir.
  if (topic) {
    const found = await webSearch(`notícias ${topic}`, 5);
    if (found.length) {
      const intros = NEWS_TOPIC_INTROS(topic);
      const intro = intros[Math.floor(Math.random() * intros.length)];
      const lines = found.map((r) => {
        const summary = r.snippet ? r.snippet.slice(0, 160) : r.title;
        return `• ${r.title}\n  ${summary}\n  Fonte: ${sourceFromUrl(r.url)} — ${compactSourceLink(r.url)}`;
      });
      return `${intro}\n\n${lines.join("\n\n")}`;
    }
  }
  return topic
    ? `Não consegui confirmar notícias atuais sobre ${topic} em fontes reais agora. Tente novamente em instantes.`
    : "Não consegui confirmar as notícias atuais em fontes reais agora. Tente novamente em instantes.";
}

const SEARCH_INTROS = ["🔎 Encontrei isso:", "🔎 Aqui está o que achei:", "🔎 Resumindo o que encontrei:"];

// Mesmo problema encontrado nas notícias: o modelo pequeno (llama-3.1-8b)
// alucina "narrativas" plausíveis mesmo com resultado de busca real
// injetado no contexto (testado: inventou placar de jogo que não
// aconteceu). Atalho determinístico — pergunta factual sem API dedicada
// (câmbio/clima/CEP/CNPJ/wiki já tratados em detectApiLookups). Tenta
// primeiro Google de verdade via grounding do Gemini (resumo coerente,
// real); se falhar/sem chave, cai pro DuckDuckGo (snippets concatenados).
// Toda fonte aparece como link curto verificável; URLs cruas não poluem a fala.
export async function tryWebSearchShortcut(env: Env, text: string): Promise<string | null> {
  if (!looksLikeFactualQuestion(text)) return null;
  if (detectApiLookups(text).length) return null; // API específica cobre — deixa o fluxo normal tratar
  const query = toSearchQuery(text);
  if (!query) return null;

  const grounded = await googleGroundedSearch(env, query);
  if (grounded?.summary) {
    const intro = SEARCH_INTROS[Math.floor(Math.random() * SEARCH_INTROS.length)];
    const sourcesTxt = grounded.sources.length
      ? `\n\nFontes:\n${grounded.sources.slice(0, 4).map((s) => `• ${s.title || sourceFromUrl(s.url)} — ${compactSourceLink(s.url)}`).join("\n")}`
      : "";
    return `${intro}\n\n${grounded.summary}${sourcesTxt}`;
  }

  const results = await webSearch(query, 4);
  if (!results.length) return null;
  const intro = SEARCH_INTROS[Math.floor(Math.random() * SEARCH_INTROS.length)];
  const lines = results.map((r) => {
    const summary = r.snippet ? r.snippet.slice(0, 160) : r.title;
    return `• ${summary}\n  ${sourceFromUrl(r.url)} — ${compactSourceLink(r.url)}`;
  });
  return `${intro}\n\n${lines.join("\n\n")}`;
}

// Determinístico igual notícias/busca — matemática de conversão de moeda
// NÃO pode passar pelo LLM pequeno: testado ao vivo 13/08/2026, mesmo com
// o total já calculado no contexto, o modelo recalculava errado por conta
// própria (300 GBP virou "≈ 205 BRL" quando o real era ~2070). Bypass
// total: busca a taxa, calcula aqui mesmo, devolve o texto pronto.
export async function tryCurrencyConversionShortcut(text: string): Promise<string | null> {
  const lower = text.toLowerCase();
  const match = lower.match(/converter?\s+(\d+(?:[.,]\d+)?)\s*(d[óo]lares?|usd|euros?|eur|libras?|gbp)\s+(?:para|em)\s+(reais?|brl|d[óo]lares?|usd|euros?|eur)/);
  if (!match) return null;
  const amount = match[1].replace(",", ".");
  const fromMap: Record<string, string> = { dólar: "USD", dolar: "USD", dólares: "USD", dolares: "USD", usd: "USD", euro: "EUR", euros: "EUR", eur: "EUR", libra: "GBP", libras: "GBP", gbp: "GBP" };
  const toMap: Record<string, string> = { real: "BRL", reais: "BRL", brl: "BRL", dólar: "USD", dolar: "USD", dólares: "USD", dolares: "USD", usd: "USD", euro: "EUR", euros: "EUR", eur: "EUR" };
  const from = fromMap[match[2].toLowerCase()];
  const to = toMap[match[3].toLowerCase()];
  if (!from || !to) return null;
  const data = await fetchJsonWithTimeout(`https://api.frankfurter.dev/v1/latest?amount=${amount}&from=${from}&to=${to}`);
  const converted = data?.rates?.[to];
  if (converted == null) return null;
  const formatted = converted.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `💱 ${amount} ${from} = ${formatted} ${to} (câmbio de ${data.date})`;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function periodRange(period: "week" | "month"): { start: Date; end: Date } {
  const now = new Date();
  const end = now;
  const start = new Date(now);
  if (period === "week") {
    const day = (start.getUTCDay() + 6) % 7; // segunda = 0
    start.setUTCDate(start.getUTCDate() - day);
  } else {
    start.setUTCDate(1);
  }
  start.setUTCHours(0, 0, 0, 0);
  return { start, end };
}

export async function generateSummary(env: Env, chatId: number, period: "week" | "month"): Promise<string> {
  const { start, end } = periodRange(period);
  const startIso = isoDate(start);

  const cached = await supabase(
    env,
    `hermes_cloud_summaries?chat_id=eq.${chatId}&period=eq.${period}&period_start=eq.${startIso}` +
      `&created_at=gte.${isoDate(new Date())}T00:00:00&select=content&limit=1`,
  );
  if (cached.ok) {
    const rows = (await cached.json()) as { content: string }[];
    if (rows.length) return rows[0].content;
  }

  const range = await supabase(
    env,
    `hermes_cloud_messages?select=role,content,created_at&chat_id=eq.${chatId}` +
      `&created_at=gte.${start.toISOString()}&created_at=lte.${end.toISOString()}` +
      `&order=created_at.asc&limit=400`,
  );
  const rows = range.ok ? ((await range.json()) as { role: string; content: string; created_at: string }[]) : [];
  if (!rows.length) return `Não encontrei conversas nesse ${period === "week" ? "período da semana" : "mês"} ainda.`;

  const transcript = rows.map((r) => `${r.role === "user" ? "Usuário" : "Hermes"}: ${r.content}`).join("\n");
  const prompt =
    `Resuma a conversa abaixo (${period === "week" ? "última semana" : "último mês"}) em português, ` +
    "em tópicos curtos: principais assuntos, decisões, pedidos recorrentes e qualquer coisa que valha lembrar depois. " +
    `Seja direto, sem enrolação.\n\n${transcript.slice(0, 12000)}`;
  const result = (await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {
    messages: [{ role: "user", content: prompt }],
    max_tokens: 700,
  })) as { response?: unknown };
  const summary = typeof result.response === "string" && result.response.trim() ? result.response.trim() : "Não consegui gerar o resumo.";

  const embedding = await embedText(env, summary).catch(() => null);
  await supabase(env, "hermes_cloud_summaries", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      chat_id: String(chatId),
      period,
      period_start: startIso,
      period_end: isoDate(end),
      content: summary,
      embedding,
      message_count: rows.length,
    }),
  }).catch(() => undefined);

  return summary;
}

// ---------------------------------------------------------------------------
// Grafo de entidades: extraído sob demanda (/grafo) a partir do histórico
// recente — quem/o quê foi mencionado e como se relaciona.
// ---------------------------------------------------------------------------


export type ExtractedEntity = { name: string; type: string };
export type ExtractedEdge = { source: string; target: string; relation: string };

export async function extractEntityGraph(env: Env, chatId: number): Promise<{ entities: ExtractedEntity[]; edges: ExtractedEdge[] }> {
  const rows = await history(env, chatId);
  if (!rows.length) return { entities: [], edges: [] };
  const transcript = rows.map((r) => `${r.role === "user" ? "Usuário" : "Hermes"}: ${r.content}`).join("\n");
  const prompt =
    "Extraia entidades (pessoas, lugares, organizações, projetos, assuntos recorrentes) e relações entre elas " +
    "da conversa abaixo. No máximo 8 entidades e 8 relações — as mais importantes. " +
    "Responda SOMENTE com JSON válido, compacto, sem espaços/quebras de linha extras, no formato " +
    '{"entities":[{"name":"...","type":"pessoa|lugar|organizacao|projeto|assunto"}],' +
    '"edges":[{"source":"...","target":"...","relation":"..."}]}. ' +
    `Sem texto fora do JSON.\n\n${transcript.slice(0, 6000)}`;
  const result = (await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {
    messages: [{ role: "user", content: prompt }],
    max_tokens: 1400,
  })) as { response?: unknown };
  const raw = typeof result.response === "string" ? result.response.trim() : JSON.stringify(result.response ?? "{}");
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  try {
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    return {
      entities: Array.isArray(parsed.entities) ? parsed.entities.filter((e: any) => e?.name) : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges.filter((e: any) => e?.source && e?.target) : [],
    };
  } catch (err) {
    console.error(JSON.stringify({ event: "grafo_parse_failed", raw: raw.slice(0, 300), error: String(err) }));
    return { entities: [], edges: [] };
  }
}

export async function persistEntityGraph(env: Env, chatId: number, entities: ExtractedEntity[], edges: ExtractedEdge[]): Promise<void> {
  const idByName = new Map<string, number>();
  for (const entity of entities) {
    const resp = await supabase(env, "hermes_cloud_entities?on_conflict=chat_id,name", {
      method: "POST",
      headers: { prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        chat_id: String(chatId),
        name: entity.name,
        type: entity.type || "other",
        last_seen: new Date().toISOString(),
      }),
    });
    if (!resp.ok) {
      console.error(JSON.stringify({ event: "entity_upsert_failed", status: resp.status, body: await resp.text().catch(() => "") }));
    }
    if (resp.ok) {
      const rows = (await resp.json()) as { id: number; name: string }[];
      if (rows[0]) idByName.set(rows[0].name, rows[0].id);
    }
  }
  for (const edge of edges) {
    const sourceId = idByName.get(edge.source);
    const targetId = idByName.get(edge.target);
    if (!sourceId || !targetId) continue;
    await supabase(env, "hermes_cloud_entity_edges", {
      method: "POST",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({
        chat_id: String(chatId),
        source_entity_id: sourceId,
        target_entity_id: targetId,
        relation: edge.relation,
      }),
    }).catch(() => undefined);
  }
}

export function formatEntityGraph(entities: ExtractedEntity[], edges: ExtractedEdge[]): string {
  if (!entities.length) return "Ainda não tenho conversa suficiente pra montar um grafo.";
  const lines = ["🕸️ Entidades:"];
  for (const e of entities) lines.push(`• ${e.name} (${e.type})`);
  if (edges.length) {
    lines.push("\nRelações:");
    for (const edge of edges) lines.push(`• ${edge.source} → ${edge.relation} → ${edge.target}`);
  }
  return lines.join("\n");
}

export async function recallRelevantImages(env: Env, chatId: number, queryText: string): Promise<string[]> {
  const embedding = await embedText(env, queryText).catch(() => null);
  if (!embedding) return [];
  const response = await supabase(env, "rpc/match_hermes_images", {
    method: "POST",
    body: JSON.stringify({ query_embedding: embedding, target_chat_id: String(chatId), match_count: 3 }),
  });
  if (!response.ok) return [];
  const rows = (await response.json()) as { description: string; ocr_text: string; created_at: string; similarity: number }[];
  return rows
    .filter((r) => r.similarity > 0.55)
    .map((r) => `[${new Date(r.created_at).toLocaleDateString("pt-BR")}] Imagem: ${r.description}${r.ocr_text ? ` (texto: "${r.ocr_text}")` : ""}`);
}



// ─── Microsoft Edge neural TTS — grátis, sem chave, sem limite de caracteres.
// Handshake WebSocket de saída (fetch + Upgrade, suportado nativamente pelos
// Workers) direto no serviço "Read Aloud" da Microsoft: mesma voz humana e
// natural validada localmente (pt-BR-AntonioNeural, grave/masculina).
export const EDGE_TTS_TRUSTED_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
export const EDGE_TTS_CHROMIUM_VERSION = "143.0.3650.75";
export const EDGE_TTS_VOICE_XML = "Microsoft Server Speech Text to Speech Voice (en-US, AndrewMultilingualNeural)";

export async function edgeTtsSecMsGec(): Promise<string> {
  const winEpoch = 11644473600;
  const secondsToNs = 1e9;
  let ticks = Date.now() / 1000;
  ticks += winEpoch;
  ticks -= ticks % 300;
  ticks *= secondsToNs / 100;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${ticks.toFixed(0)}${EDGE_TTS_TRUSTED_TOKEN}`),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export function edgeTtsTimestamp(): string {
  return new Date().toISOString().replace(/[-:.]/g, "").slice(0, -1);
}

export function edgeTtsEscapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Respostas chegam em markdown (**negrito**, listas com "-", links, headers
// "#", blocos ```código```) — sem isso o TTS lê os símbolos junto com o
// texto ("asterisco asterisco...", "cerquilha..."). Limpa pra soar como
// fala natural, não como texto sendo soletrado.
export function stripMarkdownForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // URLs cruas (comuns nas respostas de busca/notícias) — sem isso a voz
    // soletra "h t t p s dois pontos barra barra..." (achado 13/08/2026).
    .replace(/\(?\bhttps?:\/\/\S+\)?/gi, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*\*([^*]+)\*\*\*/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(?<!\w)_([^_]+)_(?!\w)/g, "$1")
    .replace(/^\s*[-•*]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/>\s?/g, "")
    .replace(/[*_#`~]/g, "")
    // Travessão/en-dash/aspas retas e curvas soletradas literalmente pela
    // síntese — vira pausa natural (vírgula) em vez de símbolo falado.
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/["“”'’]/g, "")
    .replace(/\s\/\s/g, " ou ")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, ". ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,!?])/g, "$1")
    .replace(/([.,!?]){2,}/g, "$1")
    .trim();
}

// ---------------------------------------------------------------------------
// Busca real com Google de verdade — Google bloqueia o range de IP do
// Cloudflare Workers direto (confirmado em teste), então em vez de raspar
// o Google diretamente usamos a ferramenta oficial "google_search" do
// Gemini API (grounding): o próprio Gemini roda a busca no Google e
// sintetiza uma resposta coerente a partir dos resultados reais — muito
// mais confiável que montar um resumo a partir de snippets soltos do
// DuckDuckGo. Pedido do usuário 13/08/2026, usando a chave GEMINI_API_KEY
// já configurada (mesma usada no fallback de voz).
// ---------------------------------------------------------------------------
export type GroundedSearchResult = { summary: string; sources: { title: string; url: string }[] };

export async function googleGroundedSearch(env: Env, query: string): Promise<GroundedSearchResult | null> {
  if (!env.GEMINI_API_KEY) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const resp = await fetch(
      // gemini-2.5-flash: generateContent devolve 404 pra contas novas
      // ("use a Interactions API") mesmo o modelo aparecendo na listagem —
      // achado 13/08/2026. gemini-3.1-flash-lite responde normalmente.
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: query }] }],
          tools: [{ google_search: {} }],
          generationConfig: { maxOutputTokens: 400 },
        }),
      },
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as any;
    const candidate = data?.candidates?.[0];
    const summary = candidate?.content?.parts?.map((p: any) => p.text).filter(Boolean).join(" ").trim();
    if (!summary) return null;
    const chunks = candidate?.groundingMetadata?.groundingChunks || [];
    const sources = chunks
      .map((c: any) => ({ title: c?.web?.title || "", url: c?.web?.uri || "" }))
      .filter((s: any) => s.url);
    return { summary, sources };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function synthesizeVoiceReply(env: Env, text: string): Promise<ArrayBuffer | null> {
  const clean = stripMarkdownForSpeech(text);
  const edge = await synthesizeEdgeVoice(clean).catch(() => null);
  if (edge) return edge;
  // Edge TTS é um protocolo não-oficial (WSS reverso) — quando falha
  // (raro, mas acontece: rate-limit, token expirado, timeout), cai pro
  // Gemini TTS antes de desistir, em vez de deixar o pedido sem áudio.
  return synthesizeGeminiVoice(env, clean).catch(() => null);
}

async function synthesizeGeminiVoice(env: Env, text: string): Promise<ArrayBuffer | null> {
  if (!env.GEMINI_API_KEY) return null;
  const clipped = text.length > 900 ? `${text.slice(0, 900)}…` : text;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: clipped }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Charon" } } },
          },
        }),
      },
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as any;
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const inline = parts.find((p: any) => p?.inlineData?.data || p?.inline_data?.data);
    const b64 = inline?.inlineData?.data || inline?.inline_data?.data;
    if (typeof b64 !== "string") return null;
    const binary = atob(b64);
    const pcm = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) pcm[i] = binary.charCodeAt(i);
    return pcmToWav(pcm.buffer, 24000, 1);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function pcmToWav(pcm: ArrayBuffer, sampleRate: number, channels: number): ArrayBuffer {
  const payload = new Uint8Array(pcm);
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeStr = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + payload.byteLength, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, payload.byteLength, true);
  const wav = new Uint8Array(44 + payload.byteLength);
  wav.set(new Uint8Array(header));
  wav.set(payload, 44);
  return wav.buffer;
}

async function synthesizeEdgeVoice(text: string): Promise<ArrayBuffer | null> {
  const clipped = text.length > 900 ? `${text.slice(0, 900)}…` : text;
  const secMsGec = await edgeTtsSecMsGec();
  const connectionId = crypto.randomUUID().replace(/-/g, "");
  const muidBytes = new Uint8Array(16);
  crypto.getRandomValues(muidBytes);
  const muid = Array.from(muidBytes).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  const chromiumMajor = EDGE_TTS_CHROMIUM_VERSION.split(".")[0];
  const wsUrl =
    `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1` +
    `?TrustedClientToken=${EDGE_TTS_TRUSTED_TOKEN}&Sec-MS-GEC=${secMsGec}` +
    `&Sec-MS-GEC-Version=1-${EDGE_TTS_CHROMIUM_VERSION}&ConnectionId=${connectionId}`;

  const handshakeController = new AbortController();
  const handshakeTimer = setTimeout(() => handshakeController.abort(), 8000);
  let response: Response & { webSocket?: WebSocket };
  try {
    response = (await fetch(wsUrl, {
      signal: handshakeController.signal,
      headers: {
        "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromiumMajor}.0.0.0 Safari/537.36 Edg/${chromiumMajor}.0.0.0`,
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br, zstd",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "Sec-WebSocket-Version": "13",
        Upgrade: "websocket",
        Cookie: `muid=${muid};`,
      },
    })) as Response & { webSocket?: WebSocket };
  } finally {
    clearTimeout(handshakeTimer);
  }

  if (response.status !== 101 || !response.webSocket) {
    throw new Error(`edge_tts_upgrade_${response.status}`);
  }
  const socket = response.webSocket;
  const requestId = crypto.randomUUID().replace(/-/g, "");
  const chunks: Uint8Array[] = [];

  return await new Promise<ArrayBuffer | null>((resolve) => {
    let settled = false;
    let pendingBlobReads = 0;
    let closeRequested = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      resolve(null);
    }, 12000);

    const finish = () => {
      if (settled || pendingBlobReads > 0) return;
      settled = true;
      clearTimeout(timer);
      const total = chunks.reduce((sum, c) => sum + c.length, 0);
      if (!total) {
        resolve(null);
        return;
      }
      const out = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        out.set(c, offset);
        offset += c.length;
      }
      resolve(out.buffer);
    };

    // Salvaguarda contra frame binário repetido perto do fim (relatado:
    // "duplica o final do áudio", ainda reportado em textos curtos como os
    // avisos de telemetria) — o protocolo não-oficial do Edge TTS às vezes
    // reenvia frame(s) de áudio já entregues junto com metadados de
    // fechamento, e nem sempre é o frame IMEDIATAMENTE anterior que se
    // repete (achado 13/08/2026) — compara contra as últimas 3 assinaturas,
    // não só a última.
    const recentSignatures: string[] = [];
    const handleBinary = (bin: Uint8Array) => {
      if (bin.length < 2) return;
      const headerLength = (bin[0] << 8) | bin[1];
      const headerText = new TextDecoder().decode(bin.slice(2, 2 + headerLength));
      if (!/Path:audio/.test(headerText)) return;
      const body = bin.slice(2 + headerLength);
      if (!body.length) return;
      // Assinatura barata (tamanho + primeiros/últimos bytes) — evitar
      // hash completo por frame, mas ainda pegar reenvio idêntico.
      const signature = `${body.length}:${body[0]}:${body[body.length - 1]}:${body[Math.floor(body.length / 2)]}`;
      if (recentSignatures.includes(signature)) return;
      recentSignatures.push(signature);
      if (recentSignatures.length > 3) recentSignatures.shift();
      chunks.push(body);
    };

    socket.addEventListener("message", (event: MessageEvent) => {
      if (settled) return;
      const data = event.data as unknown;
      if (typeof data === "string") {
        if (/Path:turn\.end/.test(data)) {
          closeRequested = true;
          finish();
          try {
            socket.close();
          } catch {
            /* já resolvido — fechamento é só limpeza */
          }
        }
        return;
      }
      if (data instanceof ArrayBuffer) {
        handleBinary(new Uint8Array(data));
        return;
      }
      if (typeof Blob !== "undefined" && data instanceof Blob) {
        pendingBlobReads += 1;
        data
          .arrayBuffer()
          .then((buf) => handleBinary(new Uint8Array(buf)))
          .catch(() => undefined)
          .finally(() => {
            pendingBlobReads -= 1;
            if (closeRequested) finish();
          });
      }
    });
    socket.addEventListener("close", () => finish());
    socket.addEventListener("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(null);
    });
    socket.accept();
    socket.send(
      `X-Timestamp:${edgeTtsTimestamp()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
        `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`,
    );
    const ssml =
      `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
      `<voice name='${EDGE_TTS_VOICE_XML}'><prosody pitch='-10Hz' rate='+40%' volume='+0%'>` +
      `${edgeTtsEscapeXml(clipped)}</prosody></voice></speak>`;
    socket.send(
      `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${edgeTtsTimestamp()}Z\r\nPath:ssml\r\n\r\n${ssml}`,
    );
  });
}

export async function buildRealtimeContext(env: Env, chatId: number, text: string): Promise<string> {
  const [lookups, recalled, recalledImages, facts] = await Promise.all([
    Promise.all(detectApiLookups(text).map(async (l) => ({ label: l.label, data: await l.fetch() }))),
    recallRelevantMemories(env, chatId, text),
    recallRelevantImages(env, chatId, text),
    getFacts(env, chatId),
  ]);
  const lines = lookups
    .filter((r) => r.data !== null)
    .map((r) => `${r.label}: ${JSON.stringify(r.data).slice(0, 800)}`);

  let block = "";
  // Fatos ficam SEMPRE no contexto, sem depender de similaridade — é o que
  // resolve "sempre saber o que já foi conversado" pra dados estáveis
  // (nome, preferências), diferente da memória semântica abaixo, que só
  // traz trechos parecidos com a mensagem atual e pode falhar quando a
  // pergunta é parecida com outra pergunta antiga em vez da resposta.
  if (facts.length) {
    block += `\n\n[O QUE VOCÊ JÁ SABE SOBRE O USUÁRIO — sempre válido, use sem precisar perguntar de novo]\n${facts
      .map((f) => `${f.key}: ${f.value}`)
      .join("\n")}`;
  }
  // Busca geral na internet (quando não há API dedicada) já é tratada
  // ANTES desta função, em tryWebSearchShortcut — determinístico, sem
  // passar pelo LLM (achado: o modelo pequeno alucina "narrativa" mesmo
  // com resultado real injetado). Se chegou até aqui, ou tem API
  // específica (bloco abaixo), ou não é uma pergunta factual.
  if (lines.length) block += `\n\n[DADOS EM TEMPO REAL]\n${lines.join("\n")}`;
  if (recalled.length) block += `\n\n[MEMÓRIA — trechos antigos relevantes]\n${recalled.join("\n")}`;
  if (recalledImages.length) block += `\n\n[MEMÓRIA VISUAL — imagens relevantes já salvas]\n${recalledImages.join("\n")}`;
  return block;
}

export function looksLikeFactualQuestion(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (lower.length < 6) return false;
  // Achado 13/08/2026: qualquer frase com "?" (mesmo reação/desabafo tipo
  // "Ta ficando doido? Sabe oq te perguntei") disparava busca na internet
  // e devolvia lixo (resultado de música, sem relação nenhuma). "?" sozinho
  // não basta mais — exige palavra de pergunta de verdade OU verbo de busca
  // explícito em QUALQUER posição da frase (não só no início).
  const questionWord = /\b(quem|qual|quais|quando|onde|como|quanto|quanta|por que|porque|o que)\b/.test(lower);
  const searchVerb = /\b(busque|busca|pesquis[ae]|procur[ae]|descubra|veja|checa|confere|resultado de|placar)\b/.test(lower);
  return questionWord || searchVerb;
}

// Tira instrução/comando ("busque na internet", "pesquise", pontuação de
// pergunta, pronomes de abertura) antes de usar o texto como query de
// busca — um buscador trata a frase inteira como termos literais, então
// "Como tá o Flamengo? Busque na internet" vira ruído sem isso.
export function toSearchQuery(text: string): string {
  return refineSearchQuery(text);
}

// ---------------------------------------------------------------------------
// Fatos estáveis: nome, preferências, dados pessoais que o usuário declara
// sobre si mesmo. Extraídos sob demanda (mesmo padrão do roteador de ação)
// quando a mensagem parece uma declaração, e injetados SEMPRE no contexto
// (não dependem de busca por similaridade).
// ---------------------------------------------------------------------------

const FACT_DECLARATION = /\b(meu nome [ée]|me chamo|eu sou|eu moro|eu trabalho|eu gosto de|eu prefiro|minha profiss[ãa]o|lembra que eu|guarda que eu|anota que eu)\b/i;

export async function getFacts(env: Env, chatId: number): Promise<{ key: string; value: string }[]> {
  const resp = await supabase(env, `hermes_cloud_facts?chat_id=eq.${chatId}&select=key,value&order=updated_at.desc&limit=30`);
  if (!resp.ok) return [];
  return (await resp.json()) as { key: string; value: string }[];
}

export async function extractAndSaveFacts(env: Env, chatId: number, text: string): Promise<void> {
  if (!FACT_DECLARATION.test(text)) return;
  try {
    const result = (await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {
      messages: [
        {
          role: "user",
          content:
            'Exemplo: mensagem "Meu nome é Ana" vira {"key":"nome","value":"Ana"}. ' +
            'Exemplo: mensagem "Moro em Recife" vira {"key":"cidade","value":"Recife"}. ' +
            'Exemplo: mensagem "Oi, tudo bem?" vira {} (sem fato claro pra guardar). ' +
            'Siga o MESMO padrão pra mensagem abaixo: as chaves do JSON são sempre literalmente "key" e "value" ' +
            "(nunca outro nome de campo), key é uma palavra curta (nome, cidade, profissao, preferencia, lembrete...), " +
            "value é o fato em si, direto. Responda SÓ o JSON, nada mais.\n\nMensagem: " +
            text,
        },
      ],
      max_tokens: 150,
    })) as { response?: unknown };
    const parsed =
      result.response && typeof result.response === "object"
        ? (result.response as any)
        : (() => {
            const raw = typeof result.response === "string" ? result.response.trim() : "";
            const match = raw.match(/\{[\s\S]*\}/);
            if (!match) return null;
            try {
              return JSON.parse(match[0]);
            } catch {
              return null;
            }
          })();
    // Modelo pequeno às vezes troca o nome do campo ("nome_curto_do_fato"
    // em vez de "key") mesmo com exemplos — aceita a primeira chave/valor
    // string do objeto como fallback, não só o par exato "key"/"value".
    let key = parsed?.key;
    let value = parsed?.value;
    if ((!key || !value) && parsed && typeof parsed === "object") {
      const entries = Object.entries(parsed).filter(([, v]) => typeof v === "string" && (v as string).trim());
      if (entries.length === 1) {
        key = entries[0][0];
        value = entries[0][1];
      } else if (entries.length >= 2) {
        key = entries[0][0];
        value = entries[0][1];
      }
    }
    if (!key || !value) return;
    await supabase(env, "hermes_cloud_facts?on_conflict=chat_id,key", {
      method: "POST",
      headers: { prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        chat_id: String(chatId),
        key: String(key).slice(0, 100),
        value: String(value).slice(0, 500),
        updated_at: new Date().toISOString(),
      }),
    });
  } catch {
    /* melhor esforço — nunca bloqueia a conversa */
  }
}

export async function answerWithAI(env: Env, messages: StoredMessage[], realtimeContext: string): Promise<string> {
  const system = systemPrompt() + realtimeContext;
  const result = (await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {
    messages: [{ role: "system", content: system }, ...messages],
    max_tokens: 900,
  })) as { response?: unknown };
  return typeof result.response === "string" && result.response.trim() ? result.response.trim() : "Não consegui gerar uma resposta agora.";
}

type MemoryCommandResult = { reply: string; imageFileIds?: string[] };

function memorySubject(text: string): string {
  return text
    .replace(/^\s*(?:por favor\s+)?(?:grave|grava|salve|salva|memorize|lembre|anote|registre)(?:\s+(?:na|em sua))?\s+(?:mem[oó]ria\s+)?(?:que\s+)?/i, "")
    .replace(/^\s*(?:por favor\s+)?(?:apague|apaga|delete|deleta|exclua|excluir|remova|remover)(?:\s+(?:da|de sua))?\s+(?:mem[oó]ria\s+)?(?:sobre\s+)?/i, "")
    .replace(/[.!?]+$/, "")
    .trim();
}

// Comandos de memória são executados antes do LLM. Assim o assistente nunca
// precisa alegar que não consegue salvar/apagar algo que o backend realmente
// suporta, e uma exclusão só acontece quando há verbo destrutivo explícito.
export async function tryMemoryCommand(env: Env, chatId: number, text: string): Promise<MemoryCommandResult | null> {
  const lower = text.toLowerCase().trim();
  const chatIdStr = String(chatId);
  const saveIntent = /^(?:por favor\s+)?(?:grave|grava|salve|salva|memorize|lembre|anote|registre)\b/i.test(text);
  const deleteIntent = /^(?:por favor\s+)?(?:apague|apaga|delete|deleta|exclua|excluir|remova|remover)\b/i.test(text)
    && /\b(mem[oó]rias?|lembran[çc]as?|fatos?)\b/i.test(text);
  const listIntent = /\b(o que (?:voc[êe] )?(?:tem|sabe|lembra)|minhas mem[oó]rias|mem[oó]rias salvas)\b/i.test(text);
  const imageIntent = /^(?:\/foto|\/imagem)\b|\b(?:traga|mostre|mande|recupere|busque).{0,25}(?:foto|imagem)\b/i.test(lower);

  if (saveIntent) {
    const subject = memorySubject(text);
    if (subject.length < 3) return { reply: "Diga o que você quer que eu grave na memória." };
    const response = await supabase(env, "hermes_cloud_memories", {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({
        chat_id: chatIdStr,
        title: subject.slice(0, 80),
        summary: subject.slice(0, 2000),
        main_category: "pessoal",
        category: "conversa",
        tags: ["chat"],
      }),
    });
    if (!response.ok) return { reply: "Não consegui gravar essa memória agora. Nada foi confirmado como salvo." };
    return { reply: `✅ Memória gravada: "${subject.slice(0, 180)}".` };
  }

  if (deleteIntent) {
    const subject = memorySubject(text);
    if (subject.length < 2 || /^(isso|tudo|todas?|todas? as mem[oó]rias?)$/i.test(subject)) {
      return { reply: "Diga qual memória devo excluir. Para apagar tudo, use a seleção da aba Memória, que exige confirmação." };
    }
    const pattern = `*${subject.replace(/[,*()]/g, " ").trim()}*`;
    const response = await supabase(
      env,
      `hermes_cloud_memories?chat_id=eq.${encodeURIComponent(chatIdStr)}&or=(title.ilike.${encodeURIComponent(pattern)},summary.ilike.${encodeURIComponent(pattern)})&select=id,title&limit=6`,
    );
    const rows = response.ok ? ((await response.json()) as { id: string; title: string }[]) : [];
    if (!rows.length) return { reply: `Não encontrei memória manual sobre "${subject}" para excluir.` };
    if (rows.length > 1) {
      return { reply: `Encontrei mais de uma memória sobre "${subject}". Exclua a desejada na aba Memória para evitar apagar a errada:\n${rows.map((row) => `• ${row.title} (${row.id.slice(0, 8).toUpperCase()})`).join("\n")}` };
    }
    const deletion = await supabase(env, `hermes_cloud_memories?id=eq.${encodeURIComponent(rows[0].id)}&chat_id=eq.${encodeURIComponent(chatIdStr)}`, {
      method: "DELETE",
      headers: { prefer: "return=minimal" },
    });
    return deletion.ok
      ? { reply: `🗑️ Memória excluída: "${rows[0].title}".` }
      : { reply: "Não consegui excluir essa memória agora. Nada foi confirmado como apagado." };
  }

  if (imageIntent) {
    const subject = text.replace(/^\s*\/(?:foto|imagem)\s*/i, "").replace(/^.*?\b(?:foto|imagem)(?:s)?\b(?:\s+(?:de|do|da|sobre))?\s*/i, "").trim();
    const pattern = subject ? `*${subject.replace(/[,*()]/g, " ")}*` : "*";
    const response = await supabase(
      env,
      `hermes_cloud_images?chat_id=eq.${encodeURIComponent(chatIdStr)}&or=(description.ilike.${encodeURIComponent(pattern)},ocr_text.ilike.${encodeURIComponent(pattern)})&select=telegram_file_id,description&order=created_at.desc&limit=3`,
    );
    const rows = response.ok ? ((await response.json()) as { telegram_file_id: string; description: string }[]) : [];
    if (!rows.length) return { reply: subject ? `Não encontrei foto sobre "${subject}" na memória visual.` : "Ainda não há fotos salvas na memória visual." };
    return { reply: `🖼️ Encontrei ${rows.length} foto(s) na memória visual.`, imageFileIds: rows.map((row) => row.telegram_file_id).filter(Boolean) };
  }

  if (listIntent) {
    const response = await supabase(env, `hermes_cloud_memories?chat_id=eq.${encodeURIComponent(chatIdStr)}&select=id,title,summary&order=created_at.desc&limit=10`);
    const rows = response.ok ? ((await response.json()) as { id: string; title: string; summary?: string }[]) : [];
    return rows.length
      ? { reply: `🧠 Memórias manuais mais recentes:\n\n${rows.map((row) => `• ${row.title} (${row.id.slice(0, 8).toUpperCase()})${row.summary && row.summary !== row.title ? ` — ${row.summary.slice(0, 160)}` : ""}`).join("\n")}` }
      : { reply: "🧠 Nenhuma memória manual foi salva ainda." };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Roteador de ações: mesmo padrão determinístico de tryNewsShortcut —
// detecta intenção de criar tarefa/evento/lançamento financeiro por regex
// ANTES do LLM genérico, e só paga uma chamada estruturada pequena quando
// bate. Roda no mesmo ponto pro Telegram (processUpdate) e pro
// dashboard/PWA (/api/dashboard/chat) — uma implementação, três canais.
// ---------------------------------------------------------------------------

// Achado 13/08/2026: "cria(r)?"/"marca(r)?" só cobriam duas conjugações
// (infinitivo/3ª pessoa) — "Marque uma reunião" (imperativo) não batia em
// nada, caiu no chat genérico e o modelo alucinou "você já tem uma reunião
// marcada" (evento que nunca existiu). Trocado por radical + \w* pra pegar
// qualquer conjugação comum (marca/marque/marcar/marcando etc.) sem
// enumerar cada forma.
const TASK_INTENT = /\b(lembr[ae]|lembrete|tarefa|n[ãa]o esque[cç]a|cri\w*\s+(uma\s+)?tarefa)\b/i;
// "(marc|marqu)\w*" sozinho (sem exigir "reunião" depois) — achado ao vivo
// 13/08/2026, dois bugs empilhados: (1) "Marque um checkup médico..." não
// continha "reunião", não batia em nada, caiu no chat genérico, que
// ALUCINOU um "✅ Evento criado" falso (nunca foi pro banco); (2) mesmo
// depois de tirar a exigência de "reunião", "marc\w*" ainda não batia
// com "marque" porque "marcar" muda C→QU antes de E (marco/marca MAS
// marque/marquei) — erro de ortografia no regex, não só de cobertura.
const AGENDA_INTENT = /\b(agend\w*|compromisso|(marc|marqu)\w*\s+(um|uma)\b|evento\s+(de|no|na))\b/i;
const FINANCE_INTENT = /\b(gastei|recebi|paguei|comprei.{0,20}(por|de)\s*r?\$?\s*\d|entrada\s+de|sa[íi]da\s+de)\b/i;

// Achado 13/08/2026 (real, ao vivo): "Qual é a minha agenda amanhã você
// sabe" continha a palavra "agenda" e o router criou um evento FALSO com
// a pergunta inteira como título. AGENDA_INTENT/TASK_INTENT reagem à
// PALAVRA (agenda/lembrar), não à intenção — uma pergunta SOBRE o que já
// existe não é um comando pra criar algo novo. Guard: pergunta (tem "?"
// ou palavra interrogativa) sem verbo de criação explícito nunca vira
// ação — só then os regexes acima decidem o tipo.
const STRONG_CREATE_VERBS = /\b(criar?|crie|adicionar?|adicione|marcar?|marque|lembrar?|lembre|anotar?|anote|colocar?|coloque|registrar?|registre)\b/i;
const QUESTION_SIGNAL = /\?|\b(qual|quais|que horas|quando|onde|quanto|voc[êe] sabe|voc[êe] lembra|tenho)\b/i;

function isQueryNotCommand(text: string): boolean {
  return QUESTION_SIGNAL.test(text) && !STRONG_CREATE_VERBS.test(text);
}

type ActionKind = "task" | "agenda" | "finance";

async function extractActionFields(env: Env, kind: ActionKind, text: string): Promise<any | null> {
  const schemaHint =
    kind === "task"
      ? '{"title":"...","due_date":"YYYY-MM-DD ou null"}'
      : kind === "agenda"
        ? '{"title":"...","starts_at":"YYYY-MM-DDTHH:mm:00 ou null","description":"..."}'
        : '{"kind":"income ou expense","category":"...","amount_cents":numero_inteiro,"description":"..."}';
  const now = new Date().toISOString();
  // Achado 13/08/2026: sem exemplo explícito, o modelo pequeno às vezes
  // copiava a frase de comando inteira ("Agende uma reunião com o cliente
  // amanhã às 15h") como título em vez de resumir ("Reunião com o
  // cliente") — few-shot corrige.
  const titleExample =
    kind === "agenda"
      ? ' Exemplo: "Agende uma reunião com o cliente amanhã às 15h" → title "Reunião com o cliente" (SEM o verbo "agende"/"marque" nem a data/hora, que já vão em starts_at).'
      : kind === "task"
        ? ' Exemplo: "Não esqueça de ligar pro médico amanhã" → title "Ligar pro médico" (SEM "não esqueça"/"lembrete", SEM a data, que já vai em due_date).'
        : "";
  const prompt =
    `Extraia os campos do pedido abaixo em JSON compacto, sem texto fora do JSON, formato ${schemaHint}. ` +
    `O título deve ser um resumo curto e natural do que precisa acontecer, nunca a frase de comando inteira.${titleExample} ` +
    `Data/hora de agora para referência: ${now} (America/Sao_Paulo). Se não houver data/hora explícita, use null. ` +
    `Valores em reais viram amount_cents (multiplique por 100, inteiro).\n\nPedido: ${text}`;
  const result = (await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {
    messages: [{ role: "user", content: prompt }],
    max_tokens: 200,
  })) as { response?: unknown };
  // O modelo às vezes devolve JSON já parseado como objeto em `response`
  // (não uma string) — cobre os dois formatos.
  if (result.response && typeof result.response === "object") return result.response;
  const raw = typeof result.response === "string" ? result.response.trim() : "";
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

async function insertActionRow(env: Env, table: string, payload: Record<string, unknown>): Promise<any | null> {
  const resp = await supabase(env, table, {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) return null;
  const rows = (await resp.json()) as any[];
  return rows[0] ?? null;
}

// Achado 13/08/2026: mesmo com few-shot no prompt, o modelo pequeno
// continuava devolvendo a frase de comando inteira como título ("Marque
// uma reunião de planejamento com a equipe na sexta-feira às 10h" em vez
// de "Reunião de planejamento com a equipe"). Limpeza determinística por
// regex como camada extra — não depende do modelo acertar.
function cleanActionTitle(raw: string): string {
  const cleaned = raw
    .replace(/^(agende|agenda|marque|marca|crie|criar?|adicione|adicionar?|lembre(-me)?|lembrar?|anote|anotar?|n[ãa]o esque[cç]a de|coloque|colocar?)\s+(uma?\s+)?/i, "")
    .replace(
      /\b(amanh[ãa]|depois de amanh[ãa]|hoje|na (segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo)(-feira)?|no dia \d{1,2}(\/\d{1,2})?|[àa]s?\s*\d{1,2}h(\d{2})?)\b[\s\S]*$/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
  const result = cleaned || raw.trim();
  return result.charAt(0).toUpperCase() + result.slice(1);
}

export async function tryActionRouter(env: Env, chatId: number, text: string): Promise<string | null> {
  if (isQueryNotCommand(text)) return null; // pergunta sobre o que já existe, não pedido de criação
  const chatIdStr = String(chatId);
  let kind: ActionKind | null = null;
  if (TASK_INTENT.test(text)) kind = "task";
  else if (AGENDA_INTENT.test(text)) kind = "agenda";
  else if (FINANCE_INTENT.test(text)) kind = "finance";
  if (!kind) return null;

  const fields = await extractActionFields(env, kind, text).catch(() => null);
  if (!fields?.title && kind !== "finance") return null;
  if (kind === "finance" && (!fields?.amount_cents || !fields?.kind)) return null;

  if (kind === "task") {
    const row = await insertActionRow(env, "hermes_cloud_tasks", {
      chat_id: chatIdStr,
      title: cleanActionTitle(String(fields.title)).slice(0, 300),
      due_date: fields.due_date || null,
    });
    if (!row) return null;
    return `✅ Tarefa criada: "${row.title}"${row.due_date ? ` — prazo ${row.due_date}` : ""}.`;
  }

  if (kind === "agenda") {
    // O modelo devolve data/hora "ingênua" (sem offset) pensando em horário
    // de Brasília — sem marcar isso explicitamente, o Postgres grava como
    // UTC e o evento aparece 3h adiantado. Marca -03:00 quando não vier
    // offset nenhum (nem Z nem +/-HH:MM).
    // O modelo é inconsistente sobre timezone (às vezes manda hora "ingênua",
    // às vezes gruda um "Z" por conta própria) mas o horário em si sempre se
    // refere ao horário de Brasília pedido pelo usuário — normaliza tirando
    // qualquer sufixo de timezone que venha e fixando -03:00 sempre.
    let startsAt: string = fields.starts_at || new Date().toISOString();
    startsAt = startsAt.replace(/(Z|[+-]\d{2}:\d{2})$/i, "");
    startsAt = `${startsAt}-03:00`;
    const row = await insertActionRow(env, "hermes_cloud_agenda", {
      chat_id: chatIdStr,
      title: cleanActionTitle(String(fields.title)).slice(0, 300),
      description: fields.description || "",
      starts_at: startsAt,
    });
    if (!row) return null;
    const when = new Date(row.starts_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    return `✅ Evento criado: "${row.title}" — ${when}.`;
  }

  const amountReais = (Number(fields.amount_cents) / 100).toFixed(2).replace(".", ",");
  const row = await insertActionRow(env, "hermes_cloud_finance_entries", {
    chat_id: chatIdStr,
    kind: fields.kind === "income" ? "income" : "expense",
    category: fields.category || "geral",
    amount_cents: Math.round(Number(fields.amount_cents)),
    description: fields.description || text.slice(0, 200),
  });
  if (!row) return null;
  const label = row.kind === "income" ? "Entrada registrada" : "Gasto registrado";
  return `✅ ${label}: R$ ${amountReais} (${row.category}).`;
}

// ---------------------------------------------------------------------------
// "Autoconhecimento" real (pedido do usuário 13/08/2026): perguntas sobre o
// que o PRÓPRIO usuário já tem cadastrado (agenda/tarefas) respondem com
// dado real do banco, não com busca genérica na internet — achado ao vivo:
// "Qual é a minha agenda amanhã" caía no atalho de busca web e devolvia
// resultado sobre apps de agenda em geral, não os compromissos reais.
// Determinístico, sem LLM, mesmo padrão dos outros atalhos.
// ---------------------------------------------------------------------------
export async function tryOwnDataQueryShortcut(env: Env, chatId: number, text: string): Promise<string | null> {
  const lower = text.toLowerCase();
  const asksAgenda = /\b(minha agenda|meus compromissos|meu compromisso|meus eventos)\b/.test(lower);
  const asksTasks = /\b(minhas tarefas|meus lembretes|tarefas pendentes|que tarefas eu tenho)\b/.test(lower);
  if (!asksAgenda && !asksTasks) return null;

  const chatIdStr = String(chatId);
  if (asksAgenda) {
    const resp = await supabase(
      env,
      `hermes_cloud_agenda?chat_id=eq.${chatIdStr}&starts_at=gte.${new Date().toISOString()}&order=starts_at.asc&limit=8`,
    );
    const rows = resp.ok ? ((await resp.json()) as any[]) : [];
    if (!rows.length) return "📅 Sua agenda está vazia — nenhum compromisso futuro registrado.";
    const lines = rows.map((r) => {
      const when = new Date(r.starts_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
      return `• ${r.title} — ${when}`;
    });
    return `📅 Sua agenda:\n\n${lines.join("\n")}`;
  }

  const resp = await supabase(env, `hermes_cloud_tasks?chat_id=eq.${chatIdStr}&done=eq.false&order=created_at.desc&limit=8`);
  const rows = resp.ok ? ((await resp.json()) as any[]) : [];
  if (!rows.length) return "✅ Você não tem tarefas pendentes registradas.";
  const lines = rows.map((r) => `• ${r.title}${r.due_date ? ` — prazo ${r.due_date}` : ""}`);
  return `📋 Suas tarefas pendentes:\n\n${lines.join("\n")}`;
}
