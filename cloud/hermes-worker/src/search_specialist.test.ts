import { afterEach, describe, expect, it, vi } from "vitest";

import { detectSportsSubject, trySportsSearchSpecialist } from "./search_specialist";

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

  it("rejects generic navigation text even when it has a source", async () => {
    const payload = {
      candidates: [{
        content: { parts: [{ text: "Acompanhe as notícias, resultados e próximos jogos do Flamengo no portal." }] },
        groundingMetadata: { groundingChunks: [{ web: { title: "Portal", uri: "https://example.com/flamengo" } }] },
      }],
    };
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))));
    await expect(trySportsSearchSpecialist({ GEMINI_API_KEY: "secret" } as unknown as Env, "Notícias do Flamengo")).resolves.toBeNull();
  });

  it("does not fabricate known-team facts when the structured provider is unavailable", async () => {
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
    expect(result).toBeNull();
    expect(search).not.toHaveBeenCalled();
  });

  it("uses the secondary structured provider and promotes a just-finished event", async () => {
    const recent = Math.floor(Date.now() / 1000) - 3600;
    const timestamp = new Date(recent * 1000).toISOString();
    const payloads = [
      null,
      null,
      { results: [{ strTimestamp: new Date((recent - 86400) * 1000).toISOString(), strHomeTeam: "Flamengo", strAwayTeam: "Vitória", intHomeScore: "2", intAwayScore: "0", strLeague: "Brazilian Serie A" }] },
      { events: [{ strTimestamp: timestamp, strHomeTeam: "Cruzeiro", strAwayTeam: "Flamengo", intHomeScore: "1", intAwayScore: "1", strLeague: "Copa Libertadores" }] },
      { teams: [{ idLeague: "4351", strLeague: "Brazilian Serie A", strLeague2: "Copa Libertadores", strLeague3: "Copa do Brasil", strLeague4: "FIFA Club World Cup" }] },
      { table: [{ idTeam: "134287", intRank: "2", intPoints: "37", intPlayed: "18", intWin: "11", intDraw: "4", intLoss: "3" }] },
    ];
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      const payload = payloads.shift();
      return Promise.resolve(payload ? new Response(JSON.stringify(payload), { status: 200 }) : new Response("blocked", { status: 403 }));
    }));
    const result = await trySportsSearchSpecialist({} as Env, "Como está o Flamengo?");
    expect(result?.answer).toContain("Cruzeiro 1 x 1 Flamengo");
    expect(result?.answer).toContain("2ª posição");
    expect(result?.answer).toContain("Copa Libertadores");
  });

  it("prefers structured score and standings data over search snippets", async () => {
    const responses = [
      { events: [{ id: 10, status: { type: "finished" }, startTimestamp: 1786581000, tournament: { name: "CONMEBOL Libertadores, Knockout stage", uniqueTournament: { id: 384 } }, season: { id: 1 }, homeTeam: { id: 1, name: "Cruzeiro" }, awayTeam: { id: 5981, name: "Flamengo" }, homeScore: { current: 1 }, awayScore: { current: 1 } }] },
      { events: [{ id: 11, status: { type: "notstarted" }, startTimestamp: 1786840000, tournament: { name: "Brasileirão Betano", uniqueTournament: { id: 325 } }, season: { id: 87678 }, homeTeam: { id: 2, name: "Mirassol" }, awayTeam: { id: 5981, name: "Flamengo" } }] },
      { standings: [{ rows: [{ team: { id: 5981, name: "Flamengo" }, position: 2, points: 42, matches: 21, wins: 12, draws: 6, losses: 3 }] }] },
    ];
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(responses[0]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(responses[1]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(responses[2]), { status: 200 })));
    const result = await trySportsSearchSpecialist({} as Env, "Como está o Flamengo?");
    expect(result?.answer).toContain("Cruzeiro 1 x 1 Flamengo");
    expect(result?.answer).toContain("2ª posição");
    expect(result?.answer).toContain("42 pontos");
    expect(result?.answer).toContain("Brasileirão Betano");
  });
});
