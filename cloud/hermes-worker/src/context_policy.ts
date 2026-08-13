/**
 * Long-term semantic recall is valuable but costs an embedding inference plus
 * two database RPCs. Recent conversation history and stable user facts are
 * already loaded separately, so recall only when the turn actually refers to
 * older knowledge or visual memory.
 */
export function needsSemanticRecall(text: string): boolean {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return /\b(memoria|lembra|recorda|falamos|conversamos|anterior|antes|passado|historico|foto|imagem|documento|arquivo|ocr|mostre de novo|o que voce sabe|quem eu sou|minha preferencia|minhas preferencias)\b/.test(normalized);
}

