export const CONNECTIVITY_LEVEL = Object.freeze({
  OFFLINE: 'offline',
  TEXT: 'text',
  LIMITED: 'limited',
  NORMAL: 'normal',
  RICH: 'rich'
});

const CELLULAR_LEVELS = new Set(['2g', '3g', '4g', '5g']);

export function classifyConnectivity(state = {}, latencyMs = null) {
  if (state.isConnected === false || state.isInternetReachable === false) return CONNECTIVITY_LEVEL.OFFLINE;
  const generation = String(state.details?.cellularGeneration || '').toLowerCase();
  const slow = Number.isFinite(latencyMs) && latencyMs >= 1_500;
  if (state.type === 'cellular' && generation === '2g') return CONNECTIVITY_LEVEL.TEXT;
  if (state.type === 'cellular' && generation === '3g') return CONNECTIVITY_LEVEL.LIMITED;
  if (slow) return CONNECTIVITY_LEVEL.LIMITED;
  if (state.type === 'cellular' && generation === '4g') return CONNECTIVITY_LEVEL.NORMAL;
  if (state.type === 'cellular' && generation === '5g') return CONNECTIVITY_LEVEL.RICH;
  if (state.type === 'wifi' || state.type === 'ethernet') return CONNECTIVITY_LEVEL.RICH;
  if (CELLULAR_LEVELS.has(generation)) return generation === '2g' ? CONNECTIVITY_LEVEL.TEXT : CONNECTIVITY_LEVEL.LIMITED;
  return CONNECTIVITY_LEVEL.NORMAL;
}

export function connectivityCapabilities(level) {
  return {
    level,
    canSyncText: level !== CONNECTIVITY_LEVEL.OFFLINE,
    canSyncLocation: level !== CONNECTIVITY_LEVEL.OFFLINE,
    canSyncRoute: level === CONNECTIVITY_LEVEL.NORMAL || level === CONNECTIVITY_LEVEL.RICH,
    canSearch: level === CONNECTIVITY_LEVEL.NORMAL || level === CONNECTIVITY_LEVEL.RICH,
    canLoadPois: level === CONNECTIVITY_LEVEL.RICH,
    canUseConversationalAi: level === CONNECTIVITY_LEVEL.NORMAL || level === CONNECTIVITY_LEVEL.RICH,
    canUseVoice: level === CONNECTIVITY_LEVEL.RICH,
    locationIntervalMs: level === CONNECTIVITY_LEVEL.TEXT ? 30_000 : level === CONNECTIVITY_LEVEL.LIMITED ? 15_000 : 10_000
  };
}

export function connectivityLabel(level) {
  return {
    [CONNECTIVITY_LEVEL.OFFLINE]: 'Sem internet — usando dados salvos',
    [CONNECTIVITY_LEVEL.TEXT]: 'Rede muito limitada — somente texto e navegação',
    [CONNECTIVITY_LEVEL.LIMITED]: 'Conexão limitada — modo econômico ativo',
    [CONNECTIVITY_LEVEL.NORMAL]: 'Conectado',
    [CONNECTIVITY_LEVEL.RICH]: 'Conexão rápida'
  }[level] || 'Verificando conexão';
}
