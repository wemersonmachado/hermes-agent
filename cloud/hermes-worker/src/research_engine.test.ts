import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./shared", () => ({
  fetchGoogleNewsHeadlines: vi.fn(async () => []),
  duckDuckGoSearch: vi.fn(async () => [
    { title: "Análise independente", url: "https://news.example.net/story", snippet: "Empresas ampliaram testes e investimentos." },
  ]),
  googleGroundedSearch: vi.fn(async () => ({
    summary: "A pesquisa confirmou avanços recentes no setor.",
    sources: [{ title: "Relatório", url: "https://example.org/report" }],
  })),
  hackerNewsSearch: vi.fn(async () => []),
  redditSearch: vi.fn(async () => []),
}));

import { isCurrentNewsDate, research } from "./research_engine";

describe("isolated multi-source research engine", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ query: { search: [] } }), { status: 200 })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("uses refined keywords and returns compact, auditable sources", async () => {
    const bucket = { get: vi.fn(async () => null), put: vi.fn(async () => undefined) };
    const answer = await research({ GEMINI_API_KEY: "test", HERMES_STORAGE: bucket } as unknown as Env, "Busque por desenvolvimento de carros autônomos", "web");
    expect(answer?.audit.query).toBe("desenvolvimento de carros autônomos");
    expect(answer?.audit.sourceCount).toBeGreaterThan(0);
    expect(answer?.reply).toContain("[Clique aqui para ler](https://example.org/report)");
    expect(answer?.reply).not.toContain("Busque por");
  });

  it("rejects unsafe source protocols", async () => {
    const bucket = { get: vi.fn(async () => null), put: vi.fn(async () => undefined) };
    const answer = await research({ GEMINI_API_KEY: "test", HERMES_STORAGE: bucket } as unknown as Env, "Pesquise segurança de software", "web");
    expect(answer?.reply).not.toContain("javascript:");
  });

  it("strictly rejects stale or undated news", () => {
    const now = Date.UTC(2026, 7, 13, 12);
    expect(isCurrentNewsDate("2026-08-12T12:00:00Z", now)).toBe(true);
    expect(isCurrentNewsDate("2021-08-10T12:00:00Z", now)).toBe(false);
    expect(isCurrentNewsDate(null, now)).toBe(false);
  });

  it("accepts the compact GDELT timestamp only inside the freshness window", () => {
    const now = Date.UTC(2026, 7, 13, 12);
    expect(isCurrentNewsDate("20260812T120000Z", now)).toBe(true);
    expect(isCurrentNewsDate("20200101T120000Z", now)).toBe(false);
  });
});
