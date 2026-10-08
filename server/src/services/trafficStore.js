const GRID_SIZE = 0.002;
const MAX_CELLS = 5_000;
const SAMPLE_TTL_MS = 120_000;
const MIN_SAMPLES = 3;
const REFERENCE_SPEED_MPS = 13.9;

function cellKey(lat, lng) {
  return `${Math.floor(lat / GRID_SIZE)}:${Math.floor(lng / GRID_SIZE)}`;
}
function validCoordinate(point) {
  return Number.isFinite(point?.lat) && Number.isFinite(point?.lng)
    && point.lat >= -90 && point.lat <= 90 && point.lng >= -180 && point.lng <= 180;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function distanceMeters(first, second) {
  const latitude = (second.lat - first.lat) * Math.PI / 180;
  const longitude = (second.lng - first.lng) * Math.PI / 180;
  const a = Math.sin(latitude / 2) ** 2
    + Math.cos(first.lat * Math.PI / 180) * Math.cos(second.lat * Math.PI / 180) * Math.sin(longitude / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function createTrafficStore({ now = () => Date.now(), maxCells = MAX_CELLS } = {}) {
  const cells = new Map();

  function prune(currentTime = now()) {
    for (const [key, cell] of cells) if (currentTime - cell.lastAt > SAMPLE_TTL_MS) cells.delete(key);
    while (cells.size > maxCells) {
      const oldest = [...cells.entries()].sort((first, second) => first[1].lastAt - second[1].lastAt)[0];
      if (!oldest) break;
      cells.delete(oldest[0]);
    }
  }

  function observe(location) {
    const timestamp = Number(location?.timestamp);
    const speed = Number(location?.speed);
    const accuracy = Number(location?.accuracy);
    const currentTime = now();
    if (!validCoordinate(location) || !Number.isFinite(speed) || speed < 0 || speed > 60
      || !Number.isFinite(accuracy) || accuracy > 40 || !Number.isFinite(timestamp)
      || Math.abs(currentTime - timestamp) > 30_000) return false;
    const key = cellKey(location.lat, location.lng);
    const previous = cells.get(key);
    cells.set(key, {
      sumSpeed: (previous?.sumSpeed || 0) + speed,
      samples: Math.min(100, (previous?.samples || 0) + 1),
      lastAt: currentTime
    });
    prune(currentTime);
    return true;
  }

  function factorAt(point, currentTime = now()) {
    const cell = cells.get(cellKey(point.lat, point.lng));
    if (!cell || currentTime - cell.lastAt > SAMPLE_TTL_MS || cell.samples < MIN_SAMPLES) return null;
    const averageSpeed = cell.sumSpeed / cell.samples;
    if (averageSpeed >= REFERENCE_SPEED_MPS * 0.7) return { factor: 1, samples: cell.samples, averageSpeed };
    return { factor: clamp(REFERENCE_SPEED_MPS / Math.max(2, averageSpeed), 1, 2.5), samples: cell.samples, averageSpeed };
  }

  function evaluate(route) {
    const coordinates = route?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
    prune();
    const samples = [];
    let baseDistance = 0;
    for (let index = 1; index < coordinates.length; index += 1) {
      const previous = { lat: coordinates[index - 1][1], lng: coordinates[index - 1][0] };
      const current = { lat: coordinates[index][1], lng: coordinates[index][0] };
      baseDistance += distanceMeters(previous, current);
      const factor = factorAt(current) || factorAt(previous);
      if (factor) samples.push(factor);
    }
    if (samples.length === 0) return null;
    const averageFactor = samples.reduce((total, sample) => total + sample.factor, 0) / samples.length;
    return { status: averageFactor > 1.15 ? 'congestion' : 'normal', factor: Number(averageFactor.toFixed(2)), sampledSegments: samples.length, adjustedDuration: Math.round(Number(route.duration) * averageFactor), observedDistance: Math.round(baseDistance) };
  }

  return { observe, evaluate, size: () => cells.size, prune };
}
