const NUMBER_WORDS = { primeiro: 0, primeira: 0, um: 0, uma: 0, segundo: 1, segunda: 1, dois: 1, duas: 1, terceiro: 2, terceira: 2, tres: 2, três: 2 };

function normalize(value) {
  return String(value || '').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

Object.assign(NUMBER_WORDS, { quarto: 3, quarta: 3, quatro: 3, quinto: 4, quinta: 4, cinco: 4, sexto: 5, sexta: 5, seis: 5, setimo: 6, setima: 6, sete: 6, oitavo: 7, oitava: 7, oito: 7, nono: 8, nona: 8, nove: 8, decimo: 9, decima: 9, dez: 9 });

export function parseAssistantIntent(value, context = {}) {
  const text = normalize(value);
  if (!text) return { type: 'empty' };
  if (/\b(cancelar|pare|parar(?!\s+para\s+dormir)|encerre)\b/.test(text)) return { type: 'navigation.cancel' };
  if (/\b(pausar|pause)\b/.test(text)) return { type: 'navigation.pause' };
  if (/\b(retomar|continuar|continue|voltar|retornar|volte|volta)\b/.test(text)
    && /\b(navega[cç][aã]o|rota|caminho|trajeto)\b/.test(text)) return { type: 'navigation.resume' };
  if (/\b(iniciar|começar|comecar|sim|pode ir)\b/.test(text)) return { type: 'navigation.start' };
  if (/\b(status|quanto falta|onde estou|minha posicao)\b/.test(text)) return { type: 'navigation.get_status' };
  const numericChoice = text.match(/\b(?:op[cç][aã]o\s*)?(\d{1,2})\b/);
  const lastChoice = /\b(ultimo|ultima)\b/.test(text) && context.options?.length ? context.options.length - 1 : null;
  const choice = lastChoice != null
    ? ['ultimo', lastChoice]
    : numericChoice
      ? ['numero', Number(numericChoice[1]) - 1]
      : Object.entries(NUMBER_WORDS).find(([word]) => new RegExp(`\\b${word}\\b`).test(text));
  if (choice && context.options?.length) return { type: 'choose_place', index: choice[1], option: context.options[choice[1]] || null };
  const hasSearchVerb = /\b(procure|encontre|busque|ache|achar|localize|localizar)\b/.test(text);
  const query = text
    .replace(/\b(me leve|leve-me|quero ir|quero dormir|preciso parar para dormir|preciso parar|parar para dormir|va|vou|procure|encontre|busque|ache|achar|localize|localizar|gostaria de ir|dormir|pernoitar|me hospedar)\b/g, '')
    .replace(/\b(perto de mim|proximo de mim|proxima de mim|nas proximidades|por perto)\b/g, '')
    .replace(/^\s*(para|a|ao|ate)\s+/, '')
    .trim();
  const stopSearch = /\b(dormir|pernoitar|hospedagem|me hospedar|parar para)\b/.test(text);
  const searchQuery = stopSearch && !/\b(hotel|pousada|motel)\b/.test(query)
    ? `hotel ${query || text}`
    : query || text;
  if (hasSearchVerb || stopSearch || /\b(hotel|restaurante|posto|farmacia|hospital|mercado|delegacia)\b/.test(text) || /^para\s+/.test(text)) {
    return { type: 'search_place', query: searchQuery };
  }
  return { type: 'unknown', text: value };
}

export function assistantReplyForIntent(intent) {
  if (intent?.type === 'navigation.cancel') return 'Navegação cancelada.';
  if (intent?.type === 'navigation.pause') return 'Navegação pausada.';
  if (intent?.type === 'navigation.resume') return 'Navegação retomada.';
  if (intent?.type === 'navigation.start') return 'Vou iniciar a navegação.';
  if (intent?.type === 'navigation.get_status') return 'Vou consultar o estado da sua navegação.';
  if (intent?.type === 'search_place') return `Vou procurar ${intent.query}.`;
  if (intent?.type === 'choose_place') return intent.option ? `Você escolheu ${intent.option.name || intent.option.label || 'este local'}.` : 'Não encontrei essa opção.';
  if (intent?.type === 'unknown') return 'Não entendi. Você pode dizer, por exemplo, me leve para um hotel.';
  return '';
}
