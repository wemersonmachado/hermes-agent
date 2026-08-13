import { describe, expect, it } from "vitest";
import { isAudioReplayRequest, parseVoiceRequest, wantsAudioReply } from "./voice_intent";

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

  it.each([
    ["Responda somente em áudio: diga bom dia", "diga bom dia"],
    ["Gere um áudio explicando energia solar", "explicando energia solar"],
    ["Qual é o clima amanhã? Responda em áudio", "Qual é o clima amanhã?"],
  ])("removes transport instructions from %s", (input, expected) => {
    expect(parseVoiceRequest(input)).toMatchObject({ wantsAudio: true, replayPrevious: false, contentText: expected });
  });

  it("keeps a pure replay request out of the content pipeline", () => {
    expect(parseVoiceRequest("Gere o áudio")).toMatchObject({ wantsAudio: true, replayPrevious: true });
  });
});
