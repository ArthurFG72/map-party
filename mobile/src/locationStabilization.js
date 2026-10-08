const STATIONARY_SPEED = 2.5;
const MIN_STATIONARY_MOVEMENT = 8;
const MAX_REALISTIC_SPEED = 90;
const MIN_CONFIRMED_MOVEMENT_METERS = 2;

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
  // Ignore a short GPS jump that contradicts both consecutive low-speed fixes.
  // A real move remains valid when its measured speed is plausible.
  if (previousSpeed < STATIONARY_SPEED && reportedSpeed < STATIONARY_SPEED
    && distance > stationaryRadius && measuredSpeed > Math.max(8, reportedSpeed * 3)) return null;
  // O valor de speed fornecido pelo sistema pode permanecer congelado por uma
  // leitura quando o veículo para. A distância/tempo entre duas posições é a
  // fonte de verdade para detectar a parada; não mantenha a velocidade antiga
  // apenas porque o GPS repetiu um speed positivo.
  // iOS can report a few metres of horizontal drift while the device is
  // stopped. When both fixes say "almost stopped", keep the newest timestamp
  // but do not turn that drift into movement/speed in the UI.
  if (distance <= stationaryRadius && measuredSpeed < 1.2) {
    return { ...previous, timestamp: next.timestamp, accuracy: Math.min(previous.accuracy || next.accuracy, next.accuracy), speed: 0 };
  }
  if (distance >= MIN_STATIONARY_MOVEMENT && distance <= stationaryRadius && measuredSpeed < 4) {
    return { ...previous, timestamp: next.timestamp, accuracy: Math.min(previous.accuracy || next.accuracy, next.accuracy), speed: 0 };
  }
  const maximumDistance = MAX_REALISTIC_SPEED * elapsedSeconds + (previous.accuracy || 0) + (next.accuracy || 0);
  if (distance > maximumDistance) return null;
  // O speed nativo pode ficar congelado depois que o aparelho para. Para não
  // carregar essa leitura antiga para a UI, use o deslocamento observado entre
  // duas posições aceitas. A posição continua sendo a fonte de verdade.
  return { ...next, speed: Math.min(MAX_REALISTIC_SPEED, Math.max(0, measuredSpeed)) };
}

export function classifyMovement(previous, next, evidence = 0) {
  if (!previous || !next || !Number.isFinite(previous.timestamp) || !Number.isFinite(next.timestamp)
    || next.timestamp <= previous.timestamp) return { moving: false, confirmed: false, score: 0, meters: 0, speed: 0 };
  const elapsedSeconds = Math.max(0.1, (next.timestamp - previous.timestamp) / 1000);
  const meters = distanceMeters(previous, next);
  // A GPS fix is an area of uncertainty, not an exact point. Use the worse
  // accuracy from the pair so a single optimistic reading cannot turn noise
  // into movement.
  const accuracy = Math.max(3, Math.min(25,
    Math.max(Number(previous.accuracy) || 0, Number(next.accuracy) || 0) || 5));
  // Keep the threshold below the displacement of a 5 km/h vehicle between
  // normal fixes, while still requiring repeated coherent readings below.
  const movementThreshold = Math.max(MIN_CONFIRMED_MOVEMENT_METERS, Math.min(8, accuracy * 0.3));
  const stationaryRadius = Math.max(MIN_CONFIRMED_MOVEMENT_METERS, Math.min(12, accuracy * 0.8));
  const speed = meters / elapsedSeconds;
  if (meters <= stationaryRadius && speed < 0.8) return { moving: false, confirmed: false, score: 0, meters, speed: 0 };
  const nativeSpeed = Number(next.nativeSpeed);
  const previousNativeSpeed = Number(previous.nativeSpeed);
  const nativeSpeedSaysMoving = Number.isFinite(nativeSpeed) && nativeSpeed >= 0.8
    && (!Number.isFinite(previousNativeSpeed) || previousNativeSpeed >= 0.8);
  const nativeSpeedSaysStationary = Number.isFinite(nativeSpeed) && nativeSpeed < 0.8;
  const moving = meters >= movementThreshold && speed >= 0.5 && speed <= MAX_REALISTIC_SPEED
    && !nativeSpeedSaysStationary;
  const score = moving ? Math.min(3, Number(evidence) + 1) : 0;
  // Slow movement needs three coherent fixes. A faster movement is confirmed
  // after two fixes, keeping turn guidance responsive without trusting GPS
  // drift while the device is stopped.
  return { moving, confirmed: moving && (score >= 3 || (score >= 2 && speed >= 4))
    && (!Number.isFinite(nativeSpeed) || nativeSpeedSaysMoving), score, meters, speed };
}
