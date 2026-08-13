const AUDIO_TERMS = String.raw`(?:audio|voz)`;
const AUDIO_ACTIONS = String.raw`(?:manda|mande|envia|envie|gera|gere|cria|crie|responde|responda|fala|fale|toca|toque|transforma|transforme)`;

const AUDIO_REQUEST = new RegExp(
  String.raw`\b${AUDIO_TERMS}\b|\b${AUDIO_ACTIONS}\w*\b[^.!?\n]{0,35}\b${AUDIO_TERMS}\b|\b(?:quero|posso)\s+ouvir\b|\b(?:leia|lê)\s+(?:isso\s+)?(?:pra|para)\s+mim\b`,
  "i",
);

const AUDIO_ONLY = new RegExp(
  String.raw`^\s*(?:(?:por\s+favor|agora)[, ]*)?(?:${AUDIO_ACTIONS}\w*\s+)?(?:(?:isso|a resposta|o texto)\s+)?(?:em\s+|um\s+|o\s+|a\s+)?${AUDIO_TERMS}(?:\s+(?:agora|pra mim|para mim))?[.!? ]*$|^\s*(?:quero|posso)\s+ouvir(?:\s+isso)?[.!? ]*$`,
  "i",
);

export function wantsAudioReply(text: string): boolean {
  return AUDIO_REQUEST.test(normalizeVoiceText(text));
}

/** A short follow-up that means “speak the previous answer”, not a new prompt. */
export function isAudioReplayRequest(text: string): boolean {
  return AUDIO_ONLY.test(normalizeVoiceText(text));
}

export type VoiceRequest = {
  wantsAudio: boolean;
  replayPrevious: boolean;
  contentText: string;
};

/** Separates transport instructions from the subject that should reach search/LLM. */
export function parseVoiceRequest(text: string): VoiceRequest {
  const wantsAudio = wantsAudioReply(text);
  const replayPrevious = wantsAudio && isAudioReplayRequest(text);
  if (!wantsAudio || replayPrevious) return { wantsAudio, replayPrevious, contentText: text.trim() };

  const contentText = text
    .replace(/^\s*(?:por\s+favor[, ]*)?(?:(?:responda|responde|mande|manda|envie|envia|gere|gera|crie|cria|fale|fala)\s+)?(?:somente\s+|s[oó]\s+)?(?:em|por|com)?\s*(?:um\s+|o\s+|a\s+)?(?:[aá]udio|voz)\s*[:;,\-]?\s*/i, "")
    .replace(/\s*[,;\-]?\s*(?:e\s+)?(?:responda|responde|mande|manda|envie|envia)?\s*(?:somente\s+|s[oó]\s+)?(?:em|por|com)\s+(?:[aá]udio|voz)(?:\s+por\s+favor)?\s*[.!?]*\s*$/i, "")
    .trim();

  return { wantsAudio, replayPrevious, contentText: contentText || text.trim() };
}

function normalizeVoiceText(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
