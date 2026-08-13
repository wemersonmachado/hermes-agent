import {
  fetchGoogleNewsHeadlines,
  googleGroundedSearch,
  type GroundedSearchResult,
  type WebSearchResult,
  webSearch,
} from "./shared";
import { compactSourceLink, refineSearchQuery } from "./search_query";

export type ResearchMode = "news" | "web";
export type ResearchProvider = "google-grounding" | "google-news-rss" | "gdelt" | "editorial-rss" | "duckduckgo-community";

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
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
  const response = await fetch(url, { headers: { "user-agent": "HermesResearch/1.0" } });
  if (!response.ok) return [];
  return parseGoogleNews(await response.text());
}

async function gdeltSearch(query: string): Promise<Evidence[]> {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=ArtList&maxrecords=10&format=json&sort=HybridRel`;
  const response = await fetch(url, { headers: { "user-agent": "HermesResearch/1.0" } });
  if (!response.ok) return [];
  const data = await response.json() as { articles?: Array<{ title?: string; url?: string; domain?: string; seendate?: string }> };
  return (data.articles || []).flatMap((item) => item.title && item.url && safeHttpUrl(item.url) ? [{
    title: clean(item.title), url: item.url, snippet: clean(item.title), source: item.domain || sourceFromUrl(item.url),
    provider: "gdelt" as const, publishedAt: item.seendate || null,
  }] : []);
}

function rankAndDiversify(items: Evidence[], query: string, limit = 5): Evidence[] {
  const terms = query.toLocaleLowerCase("pt-BR").split(/\s+/).filter((term) => term.length > 2);
  const unique = new Map<string, Evidence>();
  for (const item of items) {
    if (!safeHttpUrl(item.url)) continue;
    const key = clean(item.title).toLocaleLowerCase("pt-BR").replace(/\W/g, "").slice(0, 100);
    if (key && !unique.has(key)) unique.set(key, item);
  }
  const scored = [...unique.values()].map((item) => {
    const haystack = `${item.title} ${item.snippet}`.toLocaleLowerCase("pt-BR");
    const relevance = terms.reduce((score, term) => score + (haystack.includes(term) ? 2 : 0), 0);
    const recency = item.publishedAt && Date.now() - new Date(item.publishedAt).getTime() < 7 * 86_400_000 ? 2 : 0;
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
  const lead = factual || evidence[0]?.snippet || evidence[0]?.title;
  const details = evidence.slice(factual ? 0 : 1, factual ? 4 : 5).map((item) =>
    `• ${item.title}\n  Fonte: ${item.source} — ${compactSourceLink(item.url)}`,
  );
  return `🔎 Sobre ${query}:\n\n${lead}${details.length ? `\n\n${details.join("\n\n")}` : ""}`;
}

export async function research(env: Env, text: string, mode: ResearchMode): Promise<ResearchAnswer | null> {
  const started = Date.now();
  const query = refineSearchQuery(text, { news: mode === "news" });
  if (!query && mode !== "news") return null;
  const effectiveQuery = query || "principais notícias do Brasil e do mundo hoje";
  const [grounded, googleNews, gdelt, editorial, general] = await Promise.all([
    within(googleGroundedSearch(env, effectiveQuery), null),
    mode === "news" ? within(googleNewsRss(effectiveQuery), []) : Promise.resolve([]),
    mode === "news" ? within(gdeltSearch(effectiveQuery), []) : Promise.resolve([]),
    mode === "news" ? within(fetchGoogleNewsHeadlines(query).then((items) => (items || []).map((item) => ({ ...item, provider: "editorial-rss" as const }))), []) : Promise.resolve([]),
    within(webSearch(effectiveQuery, 6).then((items) => items.map((item) => ({ ...item, source: sourceFromUrl(item.url), provider: "duckduckgo-community" as const }))), []),
  ]);
  const groundedEvidence: Evidence[] = (grounded?.sources || []).map((item) => ({ ...item, snippet: grounded?.summary || item.title, source: sourceFromUrl(item.url), provider: "google-grounding" }));
  const evidence = rankAndDiversify([...groundedEvidence, ...googleNews, ...gdelt, ...editorial, ...general], effectiveQuery);
  if (!evidence.length) return null;
  const all = [...groundedEvidence, ...googleNews, ...gdelt, ...editorial, ...general];
  const providers = all.reduce<ResearchAudit["providers"]>((counts, item) => ({ ...counts, [item.provider]: (counts[item.provider] || 0) + 1 }), {});
  const audit = { query: effectiveQuery, elapsedMs: Date.now() - started, providers, sourceCount: evidence.length };
  console.log(JSON.stringify({ event: "research_complete", ...audit }));
  return { reply: formatAnswer(effectiveQuery, grounded, evidence), audit };
}
