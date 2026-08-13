// Refinamento compartilhado por toda pesquisa textual. Mantém o assunto e
// remove a moldura conversacional/transcrita antes de chamar provedores.

const LEADING_SPEECH = [
  /^(?:bom dia|boa tarde|boa noite|oi|ol[aá]|ô|e a[ií]|fala(?: a[ií])?|cara|mano|bro)[,.!\s-]*/i,
  /^(?:voc[eê] pode|pode|consegue|quero que voc[eê]|eu quero|gostaria que voc[eê])\s+/i,
  /^(?:por favor[,\s]*)/i,
];

const SEARCH_COMMANDS = /\b(?:busque|buscar|busca|pesquise|pesquisar|pesquisa|procure|procurar|procura|descubra|descobrir|veja|ver|confira|conferir|checa|pesquisa na internet|busca na internet)\b/gi;
const NEWS_WRAPPERS = /\b(?:not[ií]cias?|manchetes?|informa[çc][oõ]es?|novidades|atualiza[çc][oõ]es?)\b/gi;
const REQUEST_FILLERS = /\b(?:pra mim|para mim|por favor|a[ií]|da[ií]|agora|agora mesmo|hoje|mais recentes?|recentes?|atuais?|atualizadas?|na internet|no google|na web|online|o que saiu|me diga|me fale|fala pra mim|traz(?:er)?|mostra(?:r)?)\b/gi;
const SPEECH_FILLERS = /(?:^|[\s,])(p[oô]|tipo|assim|ent[aã]o|né|n[eé]|t[aá]|viu|sabe|cara|mano|bro|ahn+|hum+)(?=$|[\s,.!?])/gi;
const QUESTION_FRAME = /^(?:qual(?: é| foi)?|quais(?: s[aã]o)?|como (?:est[aá]|t[aá])|o que (?:tem|h[aá]) de|me conte sobre|fale sobre)\s+/i;

export function refineSearchQuery(text: string, options: { news?: boolean } = {}): string {
  let query = text.normalize("NFC").trim();
  for (let pass = 0; pass < 3; pass += 1) {
    for (const pattern of LEADING_SPEECH) query = query.replace(pattern, "");
  }
  query = query
    .replace(SEARCH_COMMANDS, " ")
    .replace(options.news ? NEWS_WRAPPERS : /$^/, " ")
    .replace(QUESTION_FRAME, "")
    .replace(REQUEST_FILLERS, " ")
    .replace(SPEECH_FILLERS, " ")
    .replace(/["“”]+/g, "")
    .replace(/[?!,;:]+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/[,.;:\s-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Remoções anteriores podem revelar novas bordas ("uma notícia ... sobre").
  // Repete somente a limpeza de moldura, nunca remove termos no meio do tema.
  for (let pass = 0; pass < 4; pass += 1) {
    const before = query;
    query = query
      .replace(/^[\s.:;!?/-]*(?:traz(?:er)?|mostra(?:r)?|fala(?:r)?|diga|dizer)\s+/i, "")
      .replace(/^[\s.:;!?/-]*(?:o|a|os|as|um|uma)\s+/i, "")
      .replace(/^[\s.:;!?/-]*(?:a[ií]|da[ií]|sobre|por|de|do|da|dos|das)\s+/i, "")
      .replace(/^[\s.:;!?/-]+/, "")
      .trim();
    if (query === before) break;
  }

  // Não envia consultas enormes de transcrição ao buscador. A primeira oração
  // após o assunto normalmente já contém a intenção; mantém até 14 termos.
  const words = query.split(/\s+/).filter(Boolean);
  const refined = words.slice(0, 14).join(" ");
  const meaningful = refined.split(/\s+/).filter((word) => !/^(?:qual|quais|são|as|os|principais|de|do|da|dos|das|dia|brasil|mundo)$/i.test(word));
  return meaningful.length ? refined : "";
}

export function isNewsSearchRequest(text: string): boolean {
  const folded = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  return /(?:^|\s)(?:noticias?|manchetes?)(?=$|\s|[?!,.;:])/.test(folded);
}

export function isExplicitSearchRequest(text: string): boolean {
  const folded = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  return /(?:^|\s)(?:busque|buscar|busca|pesquise|pesquisar|pesquisa|procure|procurar|procura|descubra|descobrir|confira|conferir|checa)(?=$|\s|[?!,.;:])/.test(folded);
}

export function compactSourceLink(url: string): string {
  const safeUrl = encodeURI(url).replace(/\)/g, "%29");
  return `[Clique aqui para ler](${safeUrl})`;
}
