import { describe, expect, it } from "vitest";
import { needsSemanticRecall } from "./context_policy";

describe("semantic context policy", () => {
  it.each(["Você lembra da foto do carro?", "O que conversamos antes?", "busque na memória", "mostre o documento anterior"])(
    "recalls long-term context for %s",
    (text) => expect(needsSemanticRecall(text)).toBe(true),
  );

  it.each(["Olá, tudo bem?", "Explique computação quântica", "Qual o clima de amanhã?", "gere o áudio"])(
    "keeps the fast path for %s",
    (text) => expect(needsSemanticRecall(text)).toBe(false),
  );
});

