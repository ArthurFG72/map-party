const REPEAT_AFTER_MS = 12_000;
const SPEECH_MIN_DISTANCE_METERS = 25;
const SPEECH_MAX_DISTANCE_METERS = 65;

function normalized(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

export function planNavigationSpeech(guidance, previous = {}, now = Date.now()) {
  if (!guidance) return { text: null, previous };
  const instruction = normalized(guidance.instruction);
  const offRoute = guidance.offRoute === true;
  const distance = Number(guidance.instructionDistance);
  if (!offRoute && instruction === 'Siga pela rota azul.') return { text: null, previous };
  if (!offRoute && Number.isFinite(distance)
    && (distance < SPEECH_MIN_DISTANCE_METERS || distance > SPEECH_MAX_DISTANCE_METERS)) {
    return { text: null, previous };
  }
  const text = offRoute
    ? 'Você saiu da rota. Procure retornar com segurança.'
    : instruction && Number.isFinite(distance)
      ? `Em aproximadamente ${Math.round(distance)} metros, ${instruction}`
      : instruction;
  if (!text) return { text: null, previous };
  const key = offRoute ? 'off-route' : instruction;
  if (previous.key === key && now - Number(previous.at || 0) < REPEAT_AFTER_MS) return { text: null, previous };
  return { text, previous: { key, at: now } };
}
