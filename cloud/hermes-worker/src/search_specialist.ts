// Motor factual isolado para perguntas esportivas atuais. Ele não grava dados,
// não toca memória/agenda e não devolve páginas agregadoras como resposta.

export interface SearchSource {
  title: string;
  url: string;
}

export interface SpecialistAnswer {
  answer: string;
  sources: SearchSource[];
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export type SearchProvider = (query: string, limit?: number) => Promise<SearchResult[]>;

const TEAM_ALIASES: Record<string, string> = {
  flamengo: "Clube de Regatas do Flamengo",
  mengao: "Clube de Regatas do Flamengo",
};

const STRUCTURED_TEAMS: Record<string, { id: number; display: string }> = {
  "Clube de Regatas do Flamengo": { id: 5981, display: "Flamengo" },
};

function fold(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

export function detectSportsSubject(text: string): string | null {
  const normalized = fold(text);
  const alias = Object.keys(TEAM_ALIASES).find((name) => normalized.includes(name));
  if (!alias) return null;
  const factualSignal = /(?:^|\s)(jogos?|placar|resultado|campeonato|competicao|tabela|posicao|classificacao|como (?:esta|ta)|noticias?|situacao)(?:\s|[?!.,]|$)/i;
  return factualSignal.test(normalized) ? TEAM_ALIASES[alias] : null;
}

function cleanAnswer(value: string): string {
  return value
    .replace(/```(?:json)?|```/gi, "")
    .replace(/^\s*(?:resposta|answer)\s*:\s*/i, "")
    .trim();
}

function isUsefulAnswer(answer: string): boolean {
  if (answer.length < 45) return false;
  // Páginas de navegação não são fatos. Esses padrões reproduzem a regressão
  // mostrada pelo usuário ("acompanhe as notícias/resultados...").
  if (/\b(acompanhe|confira|veja)\s+(?:as|os)\s+(?:not[ií]cias|resultados|pr[oó]ximos jogos)\b/i.test(answer)) return false;
  return /\d|venceu|empatou|perdeu|disputa|lidera|colocado|posição/i.test(answer);
}

async function fetchJson(url: string): Promise<any | null> {
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; HermesSportsResearch/1.0)" },
  }).catch(() => null);
  if (!response?.ok) return null;
  return response.json().catch(() => null);
}

function eventDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function normalizeCompetition(name: string): string {
  return name.replace(/,\s*(?:Knockout stage|Group stage)$/i, "").trim();
}

async function structuredSportsAnswer(subject: string): Promise<SpecialistAnswer | null> {
  const team = STRUCTURED_TEAMS[subject];
  if (!team) return null;
  const lastUrl = `https://www.sofascore.com/api/v1/team/${team.id}/events/last/0`;
  const nextUrl = `https://www.sofascore.com/api/v1/team/${team.id}/events/next/0`;
  const [lastData, nextData] = await Promise.all([fetchJson(lastUrl), fetchJson(nextUrl)]);
  const finished = Array.isArray(lastData?.events)
    ? lastData.events
      .filter((event: any) => event?.status?.type === "finished" && Number(event.startTimestamp))
      .sort((a: any, b: any) => Number(b.startTimestamp) - Number(a.startTimestamp))
    : [];
  const upcoming = Array.isArray(nextData?.events)
    ? nextData.events
      .filter((event: any) => event?.status?.type === "notstarted" && Number(event.startTimestamp))
      .sort((a: any, b: any) => Number(a.startTimestamp) - Number(b.startTimestamp))
    : [];
  const last = finished[0];
  if (!last) return null;

  const home = String(last.homeTeam?.name || "mandante");
  const away = String(last.awayTeam?.name || "visitante");
  const homeScore = Number(last.homeScore?.current);
  const awayScore = Number(last.awayScore?.current);
  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) return null;
  const competition = normalizeCompetition(String(last.tournament?.name || "competição não informada"));
  let answer = `O último jogo do ${team.display} foi ${home} ${homeScore} x ${awayScore} ${away}, em ${eventDate(last.startTimestamp)}, pela ${competition}.`;

  const leagueEvent = [...finished, ...upcoming].find((event: any) =>
    Number(event.tournament?.uniqueTournament?.id) === 325 && Number(event.season?.id),
  );
  let standingsUrl = "";
  if (leagueEvent) {
    standingsUrl = `https://www.sofascore.com/api/v1/unique-tournament/325/season/${leagueEvent.season.id}/standings/total`;
    const standings = await fetchJson(standingsUrl);
    const rows = Array.isArray(standings?.standings)
      ? standings.standings.flatMap((group: any) => Array.isArray(group.rows) ? group.rows : [])
      : [];
    const row = rows.find((item: any) => Number(item.team?.id) === team.id);
    if (row?.position) {
      answer += ` No Brasileirão, está na ${row.position}ª posição, com ${row.points} pontos em ${row.matches} jogos`;
      if (Number.isFinite(Number(row.wins)) && Number.isFinite(Number(row.draws)) && Number.isFinite(Number(row.losses))) {
        answer += ` (${row.wins} vitórias, ${row.draws} empates e ${row.losses} derrotas)`;
      }
      answer += ".";
    }
  }

  const activeCompetitions = [...new Set(upcoming.map((event: any) => normalizeCompetition(String(event.tournament?.name || ""))).filter(Boolean))];
  if (activeCompetitions.length) {
    answer += ` Pelos jogos já programados, segue disputando ${activeCompetitions.length} competição(ões): ${activeCompetitions.join(" e ")}.`;
  }
  const next = upcoming[0];
  if (next) {
    answer += ` O próximo compromisso é ${next.homeTeam?.name} x ${next.awayTeam?.name}, em ${eventDate(next.startTimestamp)}, pela ${normalizeCompetition(String(next.tournament?.name || "competição"))}.`;
  }

  const sources: SearchSource[] = [
    { title: "Sofascore — resultados do Flamengo", url: lastUrl },
    { title: "Sofascore — próximos jogos do Flamengo", url: nextUrl },
  ];
  if (standingsUrl) sources.push({ title: "Sofascore — classificação do Brasileirão", url: standingsUrl });
  return { answer, sources };
}

async function synthesizeSearchResults(env: Env, text: string, subject: string, search: SearchProvider): Promise<SpecialistAnswer | null> {
  const queries = [
    `${subject} último jogo placar resultado data competição`,
    `${subject} posição atual tabela Brasileirão`,
    `${subject} competições que disputa atualmente`,
  ];
  const batches = await Promise.all(queries.map((query) => search(query, 4).catch(() => [])));
  const unique = new Map<string, SearchResult>();
  for (const result of batches.flat()) {
    if (!/^https?:\/\//i.test(result.url) || unique.has(result.url)) continue;
    unique.set(result.url, result);
  }
  const evidence = [...unique.values()].slice(0, 10);
  if (!evidence.length) return null;

  const evidenceText = evidence.map((item, index) =>
    `[${index + 1}] ${item.title}\n${item.snippet}\n${item.url}`,
  ).join("\n\n");
  const prompt = [
    "Responda em português do Brasil usando SOMENTE as evidências numeradas abaixo.",
    `Pergunta: ${text}`,
    "Dê diretamente placar/adversário/data/competição e posição/competições quando estiverem nas evidências.",
    "Não recomende sites ou matérias. Não complete lacunas. Se houver conflito, declare que o dado não foi confirmado.",
    "Máximo 130 palavras, em um parágrafo natural.",
    evidenceText,
  ].join("\n\n");
  try {
    const result = (await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {
      messages: [{ role: "user", content: prompt }],
      max_tokens: 450,
      temperature: 0.1,
    })) as { response?: unknown };
    const answer = cleanAnswer(typeof result.response === "string" ? result.response : "");
    if (!isUsefulAnswer(answer)) return null;
    return {
      answer,
      sources: evidence.slice(0, 4).map((item) => ({ title: item.title, url: item.url })),
    };
  } catch {
    return null;
  }
}

export async function trySportsSearchSpecialist(
  env: Env,
  text: string,
  search?: SearchProvider,
): Promise<SpecialistAnswer | null> {
  const subject = detectSportsSubject(text);
  if (!subject) return null;

  const structured = await structuredSportsAnswer(subject).catch(() => null);
  if (structured) return structured;

  if (!env.GEMINI_API_KEY) return search ? synthesizeSearchResults(env, text, subject, search) : null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  const today = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const prompt = [
    `Hoje é ${today}. Atue como pesquisador esportivo factual em português do Brasil.`,
    `Pergunta do usuário: ${text}`,
    `Entidade confirmada: ${subject}.`,
    "Pesquise na web e RESPONDA A PERGUNTA, não recomende páginas, jornais ou matérias.",
    "Se pedir último jogo: informe adversário, placar, competição e data.",
    "Se perguntar como está: informe último resultado, posição atual e competições em disputa somente quando confirmadas.",
    "Cruze fontes quando possível. Não invente placar, posição ou competição. Se algum campo não estiver confirmado, diga isso em uma frase curta.",
    "Escreva 1 parágrafo natural de até 130 palavras. Não inclua URLs no parágrafo; as fontes serão anexadas pelo sistema.",
  ].join("\n");

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { maxOutputTokens: 500, temperature: 0.1 },
        }),
      },
    );
    if (!response.ok) return search ? synthesizeSearchResults(env, text, subject, search) : null;
    const data = (await response.json()) as any;
    const candidate = data?.candidates?.[0];
    const answer = cleanAnswer(candidate?.content?.parts?.map((part: any) => part.text).filter(Boolean).join(" ") || "");
    const sources: SearchSource[] = (candidate?.groundingMetadata?.groundingChunks || [])
      .map((chunk: any) => ({ title: String(chunk?.web?.title || "Fonte"), url: String(chunk?.web?.uri || "") }))
      .filter((source: SearchSource) => /^https?:\/\//i.test(source.url));
    if (!sources.length || !isUsefulAnswer(answer)) {
      return search ? synthesizeSearchResults(env, text, subject, search) : null;
    }
    return { answer, sources: sources.slice(0, 4) };
  } catch {
    return search ? synthesizeSearchResults(env, text, subject, search) : null;
  } finally {
    clearTimeout(timer);
  }
}

export function formatSpecialistAnswer(result: SpecialistAnswer): string {
  const sourceLines = result.sources.map((source) => `• ${source.title} — ${source.url}`).join("\n");
  return `${result.answer}\n\nFontes consultadas:\n${sourceLines}`;
}
