import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./shared", () => ({
  fetchGoogleNewsHeadlines: vi.fn(async () => []),
  googleGroundedSearch: vi.fn(async () => ({
    summary: "A pesquisa confirmou avanços recentes no setor.",
    sources: [{ title: "Relatório", url: "https://example.org/report" }],
  })),
  webSearch: vi.fn(async () => [
    { title: "Análise independente", url: "https://news.example.net/story", snippet: "Empresas ampliaram testes e investimentos." },
  ]),
}));

import { research } from "./research_engine";

describe("isolated multi-source research engine", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("uses refined keywords and returns compact, auditable sources", async () => {
    const answer = await research({ GEMINI_API_KEY: "test" } as Env, "Busque por desenvolvimento de carros autônomos", "web");
    expect(answer?.audit.query).toBe("desenvolvimento de carros autônomos");
    expect(answer?.audit.sourceCount).toBeGreaterThan(0);
    expect(answer?.reply).toContain("[Clique aqui para ler](https://example.org/report)");
    expect(answer?.reply).not.toContain("Busque por");
  });

  it("rejects unsafe source protocols", async () => {
    const answer = await research({ GEMINI_API_KEY: "test" } as Env, "Pesquise segurança de software", "web");
    expect(answer?.reply).not.toContain("javascript:");
  });
});
