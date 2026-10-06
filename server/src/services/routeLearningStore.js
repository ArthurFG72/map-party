import fs from 'node:fs';
import path from 'node:path';

const GRID_SIZE = 0.002;
const MAX_KEYS = 1_000;
const MAX_VARIANTS = 5;
const MAX_SAMPLES = 64;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function validPoint(point) {
  return Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lng))
    && Number(point.lat) >= -90 && Number(point.lat) <= 90
    && Number(point.lng) >= -180 && Number(point.lng) <= 180;
}
function endpointKey(origin, destination) {
  return validPoint(origin) && validPoint(destination)
    ? [origin, destination].map((point) => `${Number(point.lat).toFixed(3)},${Number(point.lng).toFixed(3)}`).join('|')
    : null;
}

function cellKey(point) {
  return `${Math.floor(Number(point.lat) / GRID_SIZE)}:${Math.floor(Number(point.lng) / GRID_SIZE)}`;
}

function routeCells(route) {
  const coordinates = route?.geometry?.coordinates || route?.coordinates || [];
  return new Set(coordinates.filter((item) => Array.isArray(item) && validPoint({ lat: item[1], lng: item[0] }))
    .map((item) => cellKey({ lat: item[1], lng: item[0] })));
}

function similarity(first, second) {
  if (!first.size || !second.size) return 0;
  let overlap = 0;
  for (const cell of first) if (second.has(cell)) overlap += 1;
  return overlap / Math.max(first.size, second.size);
}

function sampleCoordinates(route) {
  const coordinates = route?.geometry?.coordinates || [];
  if (coordinates.length <= MAX_SAMPLES) return coordinates;
  const stride = Math.ceil(coordinates.length / MAX_SAMPLES);
  return coordinates.filter((_item, index) => index === 0 || index === coordinates.length - 1 || index % stride === 0).slice(0, MAX_SAMPLES);
}

export function createRouteLearningStore({ filePath = process.env.ROUTE_LEARNING_PATH || path.join(process.cwd(), 'data', 'route-learning.json'), now = () => Date.now() } = {}) {
  const records = new Map();

  function prune(currentTime = now()) {
    for (const [key, variants] of records) {
      const fresh = variants.filter((item) => currentTime - item.lastAt <= RETENTION_MS);
      if (fresh.length) records.set(key, fresh);
      else records.delete(key);
    }
    while (records.size > MAX_KEYS) records.delete(records.keys().next().value);
  }

  function load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      for (const [key, variants] of Object.entries(parsed || {})) if (Array.isArray(variants)) records.set(key, variants.slice(0, MAX_VARIANTS));
      prune();
    } catch {
      // First boot or a corrupt optional cache must not block route calculation.
    }
  }

  function persist() {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(Object.fromEntries(records)), 'utf8');
    } catch {
      // Learning is best-effort; route calculation remains authoritative.
    }
  }

  function record({ origin, destination, geometry, actualDurationSeconds, completedAt = now() } = {}) {
    const key = endpointKey(origin, destination);
    const duration = Number(actualDurationSeconds);
    const coordinates = sampleCoordinates({ geometry });
    if (!key || coordinates.length < 2 || !Number.isFinite(duration) || duration < 1 || duration > 7 * 24 * 60 * 60) return false;
    prune(completedAt);
    const variant = { cells: [...routeCells({ coordinates })], duration, lastAt: completedAt };
    const current = records.get(key) || [];
    const next = [variant, ...current].slice(0, MAX_VARIANTS);
    records.set(key, next);
    persist();
    return true;
  }

  function evaluate(route) {
    const key = endpointKey(route?.origin, route?.destination);
    if (!key) return null;
    prune();
    const candidateCells = routeCells(route);
    const matching = (records.get(key) || []).filter((item) => similarity(candidateCells, new Set(item.cells)) >= 0.55);
    if (!matching.length) return null;
    const duration = matching.reduce((total, item) => total + item.duration, 0) / matching.length;
    return { duration: Math.round(duration), samples: matching.length };
  }

  load();
  return { record, evaluate, size: () => records.size, prune };
}
