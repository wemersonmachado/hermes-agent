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

function normalizeVoiceText(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
