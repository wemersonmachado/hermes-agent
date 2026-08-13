import { afterEach, describe, expect, it, vi } from "vitest";

import { detectSportsSubject, formatSpecialistAnswer, trySportsSearchSpecialist } from "./search_specialist";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sports search specialist", () => {
  it("routes natural Flamengo questions to the specialist", () => {
    expect(detectSportsSubject("Como tá o Flamengo hoje?")).toBe("Clube de Regatas do Flamengo");
    expect(detectSportsSubject("Qual foi o placar do último jogo do Mengão?")).toBe("Clube de Regatas do Flamengo");
    expect(detectSportsSubject("Gosto do Flamengo")).toBeNull();
  });

  it("returns the requested facts rather than an aggregator cover page", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{
        content: { parts: [{ text: "O último jogo do Flamengo terminou empatado em 1 a 1 com o adversário, pelo Campeonato Brasileiro, em 12 de agosto. O clube está na 2ª posição e também disputa a Libertadores e a Copa do Brasil." }] },
        groundingMetadata: { groundingChunks: [{ web: { title: "Tabela oficial", uri: "https://example.com/tabela" } }] },
      }],
    }), { status: 200 })));
    const result = await trySportsSearchSpecialist({ GEMINI_API_KEY: "secret" } as unknown as Env, "Como tá o Flamengo?");
    expect(result?.answer).toContain("1 a 1");
    expect(result?.answer).toContain("2ª posição");
    expect(formatSpecialistAnswer(result!)).toContain("https://example.com/tabela");
    expect(result?.answer).not.toMatch(/acompanhe as notícias/i);
  });

  it("rejects generic navigation text even when it has a source", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{
        content: { parts: [{ text: "Acompanhe as notícias, resultados e próximos jogos do Flamengo no portal." }] },
        groundingMetadata: { groundingChunks: [{ web: { title: "Portal", uri: "https://example.com/flamengo" } }] },
      }],
    }), { status: 200 })));
    await expect(trySportsSearchSpecialist({ GEMINI_API_KEY: "secret" } as unknown as Env, "Notícias do Flamengo")).resolves.toBeNull();
  });

  it("falls back to focused searches and grounded Workers AI synthesis on provider limits", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 })));
    const search = vi.fn().mockResolvedValue([
      { title: "Flamengo empata", url: "https://example.com/jogo", snippet: "Flamengo empatou por 1 a 1 com o rival em 12 de agosto pelo Brasileirão." },
      { title: "Tabela", url: "https://example.com/tabela", snippet: "Flamengo aparece na 2ª posição." },
    ]);
    const env = {
      GEMINI_API_KEY: "secret",
      AI: { run: vi.fn().mockResolvedValue({ response: "O Flamengo empatou o último jogo por 1 a 1, pelo Brasileirão, em 12 de agosto, e está na 2ª posição." }) },
    } as unknown as Env;
    const result = await trySportsSearchSpecialist(env, "Como tá o Flamengo?", search);
    expect(search).toHaveBeenCalledTimes(3);
    expect(result?.answer).toContain("1 a 1");
    expect(result?.sources).toHaveLength(2);
  });
});
