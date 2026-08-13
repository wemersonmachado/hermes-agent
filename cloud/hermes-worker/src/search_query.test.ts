import { describe, expect, it } from "vitest";

import { compactSourceLink, isExplicitSearchRequest, isNewsSearchRequest, refineSearchQuery } from "./search_query";

describe("global search query refinement", () => {
  it.each([
    ["Busque por desenvolvimento de carros autônomos", "desenvolvimento de carros autônomos"],
    ["Bom dia, bom dia, bro. Traz uma notícia pra mim aí sobre desenvolvimento de carros autônomos, por favor.", "desenvolvimento de carros autônomos"],
    ["Pesquise na internet, por favor, os avanços da computação quântica", "avanços da computação quântica"],
    ["Como está o desenvolvimento de baterias de estado sólido?", "desenvolvimento de baterias de estado sólido"],
    ["Sobre a China e o desenvolvimento da Apple, pô", "China e o desenvolvimento da Apple"],
    ["inteligência artificial generativa", "inteligência artificial generativa"],
  ])("refines %s", (input, expected) => {
    expect(refineSearchQuery(input, { news: /notícia/i.test(input) })).toBe(expected);
  });

  it("recognizes a general news request instead of inventing a topic", () => {
    expect(refineSearchQuery("Quais são as principais notícias de hoje?", { news: true })).toBe("");
  });

  it.each(["notícia sobre carros", "notícias sobre carros", "MANCHETES de hoje"])("recognizes Unicode news request: %s", (input) => {
    expect(isNewsSearchRequest(input)).toBe(true);
  });

  it.each(["Busque carros autônomos", "pesquise computação quântica", "PROCURE baterias"])("recognizes explicit research: %s", (input) => {
    expect(isExplicitSearchRequest(input)).toBe(true);
  });

  it("limits long transcripts without dropping the leading subject", () => {
    const query = refineSearchQuery("Busque desenvolvimento de carros autônomos e sensores lidar com segurança urbana regulamentação investimentos tendências globais fabricantes testes legislação infraestrutura cidades inteligentes");
    expect(query.split(" ").length).toBeLessThanOrEqual(14);
    expect(query).toMatch(/^desenvolvimento de carros autônomos/);
  });

  it("formats every source as a compact clickable label", () => {
    expect(compactSourceLink("https://example.com/a/very/long/url")).toBe("[Clique aqui para ler](https://example.com/a/very/long/url)");
  });
});
