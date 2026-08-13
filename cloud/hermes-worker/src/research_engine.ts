import {
  fetchGoogleNewsHeadlines,
  duckDuckGoSearch,
  googleGroundedSearch,
  hackerNewsSearch,
  redditSearch,
  type GroundedSearchResult,
  type WebSearchResult,
} from "./shared";
import { compactSourceLink, refineSearchQuery } from "./search_query";

export type ResearchMode = "news" | "web";
export type ResearchProvider = "google-grounding" | "google-news-rss" | "gdelt" | "editorial-rss" | "duckduckgo" | "hacker-news" | "reddit" | "wikipedia";

export interface ResearchAudit {
  query: string;
  elapsedMs: number;
  providers: Partial<Record<ResearchProvider, number>>;
  sourceCount: number;
}

export interface ResearchAnswer {
  reply: string;
  audit: ResearchAudit;
}

interface Evidence extends WebSearchResult {
  provider: ResearchProvider;
  source: string;
  publishedAt?: string | null;
}

const PROVIDER_BUDGET_MS = 4_500;
const NEWS_MAX_AGE_MS = 14 * 86_400_000;

function within<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), PROVIDER_BUDGET_MS)),
  ]);
}

function clean(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}

function sourceFromUrl(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "fonte externa"; }
}

function safeHttpUrl(url: string): boolean {
  try { return ["http:", "https:"].includes(new URL(url).protocol); } catch { return false; }
}

function parseGoogleNews(xml: string): Evidence[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
  return items.slice(0, 10).flatMap((item) => {
    const title = clean(item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1] || "");
    const url = clean(item.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || "");
    const source = clean(item.match(/<source[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/source>/i)?.[1] || "Google News");
    const publishedAt = clean(item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || "") || null;
    return title && safeHttpUrl(url) ? [{ title, url, snippet: title, source, provider: "google-news-rss" as const, publishedAt }] : [];
  });
}

async function googleNewsRss(query: string): Promise<Evidence[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:7d`)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
  const response = await fetch(url, { headers: { "user-agent": "HermesResearch/1.0" } });
  if (!response.ok) return [];
  return parseGoogleNews(await response.text());
}

async function gdeltSearch(query: string): Promise<Evidence[]> {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=ArtList&maxrecords=10&format=json&sort=HybridRel&timespan=1week`;
  const response = await fetch(url, { headers: { "user-agent": "HermesResearch/1.0" } });
  if (!response.ok) return [];
  const data = await response.json() as { articles?: Array<{ title?: string; url?: string; domain?: string; seendate?: string }> };
  return (data.articles || []).flatMap((item) => item.title && item.url && safeHttpUrl(item.url) ? [{
    title: clean(item.title), url: item.url, snippet: clean(item.title), source: item.domain || sourceFromUrl(item.url),
    provider: "gdelt" as const, publishedAt: item.seendate || null,
  }] : []);
}

function timestamp(value?: string | null): number | null {
  if (!value) return null;
  const gdelt = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  const parsed = gdelt
    ? Date.UTC(Number(gdelt[1]), Number(gdelt[2]) - 1, Number(gdelt[3]), Number(gdelt[4]), Number(gdelt[5]), Number(gdelt[6]))
    : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function isCurrentNewsDate(value: string | null | undefined, now = Date.now()): boolean {
  const time = timestamp(value);
  return time !== null && time <= now + 3_600_000 && now - time <= NEWS_MAX_AGE_MS;
}

function isProviderCurrent(item: Evidence, now = Date.now()): boolean {
  if (isCurrentNewsDate(item.publishedAt, now)) return true;
  const time = timestamp(item.publishedAt);
  if (time === null) return false;
  // Google News e GDELT já recebem uma janela server-side (when:7d e
  // timespan=1week). Tolera diferença de calendário do runtime/fontes, mas
  // nunca conteúdo legado: no máximo o ano anterior ao relógio do Worker.
  const constrainedProvider = item.provider === "google-news-rss" || item.provider === "gdelt";
  return constrainedProvider && new Date(time).getUTCFullYear() >= new Date(now).getUTCFullYear() - 1;
}

async function wikipediaSearch(query: string): Promise<Evidence[]> {
  const url = `https://pt.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=5&format=json&origin=*`;
  const response = await fetch(url, { headers: { "user-agent": "HermesResearch/1.0" } });
  if (!response.ok) return [];
  const data = await response.json() as { query?: { search?: Array<{ title?: string; snippet?: string }> } };
  return (data.query?.search || []).flatMap((item) => item.title ? [{
    title: item.title, snippet: clean(item.snippet || item.title), source: "pt.wikipedia.org",
    url: `https://pt.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, "_"))}`,
    provider: "wikipedia" as const,
  }] : []);
}

function asEvidence(items: WebSearchResult[], provider: "duckduckgo" | "hacker-news" | "reddit"): Evidence[] {
  return items.map((item) => ({ ...item, source: sourceFromUrl(item.url), provider }));
}

function rankAndDiversify(items: Evidence[], query: string, mode: ResearchMode, limit = 5): Evidence[] {
  const terms = query.toLocaleLowerCase("pt-BR").split(/\s+/).filter((term) => term.length > 2);
  const unique = new Map<string, Evidence>();
  for (const item of items) {
    if (!safeHttpUrl(item.url)) continue;
    if (mode === "news" && !isProviderCurrent(item)) continue;
    const key = clean(item.title).toLocaleLowerCase("pt-BR").replace(/\W/g, "").slice(0, 100);
    if (key && !unique.has(key)) unique.set(key, item);
  }
  const scored = [...unique.values()].map((item) => {
    const haystack = `${item.title} ${item.snippet}`.toLocaleLowerCase("pt-BR");
    const relevance = terms.reduce((score, term) => score + (haystack.includes(term) ? 2 : 0), 0);
    const recency = item.publishedAt && isProviderCurrent(item) ? 6 : 0;
    return { item, score: relevance + recency };
  }).sort((a, b) => b.score - a.score);
  const selected: Evidence[] = [];
  const perDomain = new Map<string, number>();
  for (const { item } of scored) {
    const domain = sourceFromUrl(item.url);
    if ((perDomain.get(domain) || 0) >= 2) continue;
    selected.push(item); perDomain.set(domain, (perDomain.get(domain) || 0) + 1);
    if (selected.length >= limit) break;
  }
  return selected;
}

function formatAnswer(query: string, grounded: GroundedSearchResult | null, evidence: Evidence[]): string {
  const factual = grounded?.summary?.trim();
  const details = evidence.slice(0, factual ? 4 : 5).map((item) =>
    `• ${item.snippet || item.title}\n  Fonte: ${item.source} — ${compactSourceLink(item.url)}`,
  );
  return `🔎 Sobre ${query}:\n\n${factual ? `${factual}\n\n` : ""}${details.join("\n\n")}`;
}

export async function research(env: Env, text: string, mode: ResearchMode): Promise<ResearchAnswer | null> {
  const started = Date.now();
  const query = refineSearchQuery(text, { news: mode === "news" });
  if (!query && mode !== "news") return null;
  const effectiveQuery = query || "principais notícias do Brasil e do mundo hoje";
  const providerQuery = mode === "news" ? `notícias recentes ${effectiveQuery}` : effectiveQuery;
  const [grounded, googleNews, gdelt, editorial, ddg, hn, reddit, wikipedia] = await Promise.all([
    within(googleGroundedSearch(env, providerQuery), null),
    mode === "news" ? within(googleNewsRss(effectiveQuery), []) : Promise.resolve([]),
    within(gdeltSearch(effectiveQuery), []),
    mode === "news" ? within(fetchGoogleNewsHeadlines(query).then((items) => (items || []).map((item) => ({ ...item, provider: "editorial-rss" as const }))), []) : Promise.resolve([]),
    within(duckDuckGoSearch(providerQuery, 8).then((items) => asEvidence(items, "duckduckgo")), []),
    mode === "web" ? within(hackerNewsSearch(effectiveQuery, 4).then((items) => asEvidence(items, "hacker-news")), []) : Promise.resolve([]),
    mode === "web" ? within(redditSearch(effectiveQuery, 4).then((items) => asEvidence(items, "reddit")), []) : Promise.resolve([]),
    mode === "web" ? within(wikipediaSearch(effectiveQuery), []) : Promise.resolve([]),
  ]);
  // Grounding não fornece data por fonte. Em notícias, fonte sem data é
  // rejeitada em vez de permitir que conteúdo antigo pareça atual.
  const groundedEvidence: Evidence[] = mode === "web" ? (grounded?.sources || []).map((item) => ({ ...item, snippet: grounded?.summary || item.title, source: sourceFromUrl(item.url), provider: "google-grounding" })) : [];
  const evidence = rankAndDiversify([...groundedEvidence, ...googleNews, ...gdelt, ...editorial, ...ddg, ...hn, ...reddit, ...wikipedia], effectiveQuery, mode);
  if (!evidence.length) return null;
  const all = [...groundedEvidence, ...googleNews, ...gdelt, ...editorial, ...ddg, ...hn, ...reddit, ...wikipedia];
  const providers = all.reduce<ResearchAudit["providers"]>((counts, item) => ({ ...counts, [item.provider]: (counts[item.provider] || 0) + 1 }), {});
  const audit = { query: effectiveQuery, elapsedMs: Date.now() - started, providers, sourceCount: evidence.length };
  console.log(JSON.stringify({ event: "research_complete", ...audit }));
  return { reply: formatAnswer(effectiveQuery, mode === "web" ? grounded : null, evidence), audit };
}
