import { describe, expect, it } from "vitest";
import { isAudioReplayRequest, wantsAudioReply } from "./voice_intent";

describe("voice intent", () => {
  it.each([
    "Gere o audio",
    "gere o áudio",
    "manda em áudio",
    "Responda por voz, por favor",
    "quero ouvir",
    "Leia isso pra mim",
  ])("detects %s", (text) => expect(wantsAudioReply(text)).toBe(true));

  it("separates replay from a new spoken-content request", () => {
    expect(isAudioReplayRequest("Gere o audio")).toBe(true);
    expect(isAudioReplayRequest("manda a resposta em áudio")).toBe(true);
    expect(isAudioReplayRequest("gere um áudio explicando energia solar")).toBe(false);
  });

  it("does not trigger on unrelated speech", () => {
    expect(wantsAudioReply("Qual é a previsão para amanhã?")).toBe(false);
  });
});

