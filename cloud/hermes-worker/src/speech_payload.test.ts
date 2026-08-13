import { describe, expect, it } from "vitest";
import { prepareSpeechPayload } from "./shared";

describe("speech payload boundary", () => {
  it("removes the reported operational wrapper and keeps only useful speech", () => {
    const input = `**O sistema gerará o áudio agora.**

(Ouça o áudio gerado pelo sistema).

"Olá! A previsão em Cabo Frio é de sol e nuvens."`;
    expect(prepareSpeechPayload(input)).toBe("Olá! A previsão em Cabo Frio é de sol e nuvens.");
  });

  it.each([
    "[ÁUDIO: resposta abaixo] Conteúdo útil.",
    "O áudio foi gerado. Conteúdo útil.",
    "Ouça o áudio gerado pelo sistema. Conteúdo útil.",
  ])("never exposes audio scaffolding from %s", (input) => {
    const payload = prepareSpeechPayload(input) || "";
    expect(payload.toLowerCase()).not.toMatch(/sistema|áudio foi gerado|ouça o áudio/);
    expect(payload).toContain("Conteúdo útil");
  });

  it("rejects a reply made only of operational scaffolding", () => {
    expect(prepareSpeechPayload("O sistema gerará o áudio agora. Ouça o áudio gerado pelo sistema.")).toBeNull();
  });
});
