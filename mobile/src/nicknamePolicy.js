const HAIR_LOSS_TERMS = [
  /\bcare(?:c|qu)(?:a|o|as|os|inha|inho|ao|ona)?\b/,
  /\bcalv(?:o|a|os|as|inho|inha|icie)\b/,
  /\balopecia\b/,
  /\b(?:sem|falta de|pouco) cabelo(?:s)?\b/,
  /\bcabeca lisa\b/,
  /\bsem fio(?:s)?\b/,
  /\bbald(?:ness)?\b/,
  /\bhairless\b/
];

export function isHairLossNickname(name) {
  const normalized = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return HAIR_LOSS_TERMS.some((term) => term.test(normalized));
}