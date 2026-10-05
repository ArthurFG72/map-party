const STATIONARY_SPEED = 2.5;
const MIN_STATIONARY_MOVEMENT = 8;
const MAX_REALISTIC_SPEED = 90;

function distanceMeters(first, second) {
  const lat = (second.lat - first.lat) * Math.PI / 180;
  const lng = (second.lng - first.lng) * Math.PI / 180;
  const a = Math.sin(lat / 2) ** 2
    + Math.cos(first.lat * Math.PI / 180) * Math.cos(second.lat * Math.PI / 180) * Math.sin(lng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function stabilizePosition(previous, next) {
  if (!previous) return next;
  if (!Number.isFinite(next?.lat) || !Number.isFinite(next?.lng)
    || !Number.isFinite(next?.timestamp) || next.timestamp <= previous.timestamp) return null;
  const elapsedSeconds = Math.max(0.1, (next.timestamp - previous.timestamp) / 1000);
  const distance = distanceMeters(previous, next);
  const reportedSpeed = Number.isFinite(next.speed) ? next.speed : 0;
  const previousSpeed = Number.isFinite(previous.speed) ? previous.speed : 0;
  const accuracyLimit = Math.max(MIN_STATIONARY_MOVEMENT, Math.min(previous.accuracy || 0, next.accuracy || 0));
  const stationaryRadius = Math.min(35, Math.max(MIN_STATIONARY_MOVEMENT, accuracyLimit * 1.5));
  const measuredSpeed = distance / elapsedSeconds;
  if (previousSpeed < STATIONARY_SPEED && distance > 150 && elapsedSeconds < 30) return null;
  // O valor de speed fornecido pelo sistema pode permanecer congelado por uma
  // leitura quando o veículo para. A distância/tempo entre duas posições é a
  // fonte de verdade para detectar a parada; não mantenha a velocidade antiga
  // apenas porque o GPS repetiu um speed positivo.
  if (distance <= stationaryRadius && measuredSpeed < 1.2) {
    return { ...previous, timestamp: next.timestamp, accuracy: Math.min(previous.accuracy || next.accuracy, next.accuracy), speed: 0 };
  }
  const maximumDistance = MAX_REALISTIC_SPEED * elapsedSeconds + (previous.accuracy || 0) + (next.accuracy || 0);
  if (distance > maximumDistance) return null;
  return next;
}
