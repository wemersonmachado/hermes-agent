import { afterEach, describe, expect, it, vi } from "vitest";

import { parseRssItems, tryActionRouter, tryMemoryCommand, tryNewsShortcut } from "./shared";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("news responses", () => {
  it("preserves title, description, publication date and source URL from RSS", () => {
    const xml = `
      <rss><channel><item>
        <title><![CDATA[Notícia de teste]]></title>
        <link>https://g1.globo.com/teste</link>
        <description><![CDATA[<p>Resumo completo do fato.</p>]]></description>
        <pubDate>Thu, 13 Aug 2026 12:00:00 GMT</pubDate>
      </item></channel></rss>`;
    expect(parseRssItems(xml, "g1.globo.com", 5)).toEqual([
      expect.objectContaining({
        title: "Notícia de teste",
        url: "https://g1.globo.com/teste",
        source: "g1.globo.com",
        snippet: "Resumo completo do fato.",
        publishedAt: "2026-08-13T12:00:00.000Z",
      }),
    ]);
  });

  it("always returns details and links for news without requiring the word links", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(`
      <rss><channel><item>
        <title><![CDATA[Fato atual confirmado]]></title>
        <link>https://g1.globo.com/fato-atual</link>
        <description><![CDATA[Detalhes verificáveis da notícia, não apenas a manchete.]]></description>
      </item></channel></rss>`, { status: 200 })));
    const reply = await tryNewsShortcut({} as Env, "Quais são as principais notícias de hoje?");
    expect(reply).toContain("Detalhes verificáveis da notícia");
    expect(reply).toContain("Fonte: g1.globo.com");
    expect(reply).toContain("https://g1.globo.com/fato-atual");
  });
});

describe("deterministic personal data routing", () => {
  it("never creates an agenda event from a question about the agenda", async () => {
    const result = await tryActionRouter({} as Env, 123, "Qual é a minha agenda amanhã, você sabe?");
    expect(result).toBeNull();
  });

  it("stores an explicit memory command through Supabase", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: "1" }]), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "secret" } as unknown as Env;
    const result = await tryMemoryCommand(env, 123, "Grave na memória que meu café favorito é sem açúcar");
    expect(result?.reply).toContain("✅ Memória gravada");
    const request = fetchMock.mock.calls[0];
    expect(String(request[0])).toContain("hermes_cloud_memories");
    expect(String((request[1] as RequestInit).body)).toContain("meu café favorito é sem açúcar");
  });

  it("does not bulk-delete vague memory commands", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await tryMemoryCommand({} as Env, 123, "Apague todas as memórias");
    expect(result?.reply).toContain("use a seleção da aba Memória");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
