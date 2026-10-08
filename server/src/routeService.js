import { acceptsContractVersion, CONTRACT_VERSION } from '../contracts.js';
import { cleanPoint, cleanRoute, cleanRouteProfile } from '../validation.js';

const ROUTE_CACHE_TTL_MS = 60_000;
const ROUTE_CACHE_MAX = 64;
const ROUTE_ENDPOINT_TOLERANCE_METERS = 300;
const MANEUVER_TOLERANCE_METERS = 180;

function distanceMeters(first, second) {
  if (!first || !second) return Number.POSITIVE_INFINITY;
  const latitude = (second.lat - first.lat) * Math.PI / 180;
  const longitude = (second.lng - first.lng) * Math.PI / 180;
  const a = Math.sin(latitude / 2) ** 2
    + Math.cos(first.lat * Math.PI / 180) * Math.cos(second.lat * Math.PI / 180) * Math.sin(longitude / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function coordinateDistance(coordinate, point) {
  return distanceMeters({ lat: coordinate[1], lng: coordinate[0] }, point);
}

function closestGeometryDistance(coordinates, point) {
  return coordinates.reduce((minimum, coordinate) => Math.min(minimum, coordinateDistance(coordinate, point)), Number.POSITIVE_INFINITY);
}

export function auditRouteGeometry(candidate, origin, destination) {
  const coordinates = candidate?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return false;
  if (coordinateDistance(coordinates[0], origin) > ROUTE_ENDPOINT_TOLERANCE_METERS) return false;
  if (coordinateDistance(coordinates.at(-1), destination) > ROUTE_ENDPOINT_TOLERANCE_METERS) return false;
  const maneuvers = (candidate.legs || []).flatMap((leg) => leg?.steps || [])
    .map((step) => step?.maneuver?.location)
    .filter((location) => Array.isArray(location) && location.length >= 2);
  return maneuvers.every((location) => closestGeometryDistance(coordinates, { lat: location[1], lng: location[0] }) <= MANEUVER_TOLERANCE_METERS);
}

function routeCacheKey(origin, destination, profile) {
  return [profile, origin.lat, origin.lng, destination.lat, destination.lng].map((value) => Number.isFinite(value) ? Number(value).toFixed(5) : value).join(',');
}

export function createRouteService({
  baseUrl = process.env.OSRM_BASE_URL || 'https://router.project-osrm.org',
  fetchImpl = fetch,
  timeoutMs = 10_000,
  cacheTtlMs = ROUTE_CACHE_TTL_MS,
  cacheMax = ROUTE_CACHE_MAX
} = {}) {
  const cache = new Map();
  const inFlight = new Map();

  function remember(key, route) {
    cache.delete(key);
    cache.set(key, { route, expiresAt: Date.now() + cacheTtlMs });
    while (cache.size > cacheMax) cache.delete(cache.keys().next().value);
  }

  function cached(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      cache.delete(key);
      return null;
    }
    cache.delete(key);
    cache.set(key, entry);
    return entry.route;
  }

  async function calculate(payload) {
    const requestRoute = cleanRouteRequest(payload);
    if (!requestRoute) throw Object.assign(new Error('Invalid route request'), { code: 'INVALID_ROUTE' });
    const key = routeCacheKey(requestRoute.origin, requestRoute.destination, requestRoute.profile);
    const previous = cached(key);
    if (previous) return previous;
    if (inFlight.has(key)) return inFlight.get(key);
    const pending = calculateProviderRoute(requestRoute)
      .then((route) => {
        remember(key, route);
        return route;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
    return pending;
  }

  async function calculateProviderRoute({ origin, destination, profile }) {
    if (profile === 'boat') return createBoatRoute(origin, destination);
    const coordinates = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
    const url = new URL(`/route/v1/driving/${coordinates}`, baseUrl);
    url.searchParams.set('overview', 'full');
    url.searchParams.set('geometries', 'geojson');
    url.searchParams.set('steps', 'true');
    url.searchParams.set('alternatives', 'true');
    url.searchParams.set('continue_straight', 'false');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
      if (!response.ok) throw Object.assign(new Error('Provider error'), { code: 'PROVIDER_ERROR' });
      const body = await response.json();
      const candidates = Array.isArray(body?.routes)
        ? body.routes.filter((route) => Number.isFinite(route?.duration) && auditRouteGeometry(route, origin, destination))
        : [];
      const candidate = candidates.sort((first, second) => first.duration - second.duration)[0];
      const legs = compactOsrmLegs(candidate?.legs);
      const route = body?.code === 'Ok' && candidate && legs ? cleanRoute({
        contractVersion: CONTRACT_VERSION,
        origin,
        destination,
        geometry: candidate.geometry,
        distance: candidate.distance,
        duration: candidate.duration,
        legs
      }) : null;
      if (!route) throw Object.assign(new Error('Provider error'), { code: 'PROVIDER_ERROR' });
      return route;
    } catch (error) {
      if (error.name === 'AbortError') throw Object.assign(new Error('Provider timeout'), { code: 'PROVIDER_TIMEOUT' });
      if (error.code) throw error;
      throw Object.assign(new Error('Provider error'), { code: 'PROVIDER_ERROR' });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return { calculate };
}

export function compactOsrmLegs(rawLegs) {
  if (!Array.isArray(rawLegs) || rawLegs.length < 1) return null;
  return rawLegs.map((leg) => ({
    distance: leg?.distance,
    duration: leg?.duration,
    ...(leg?.summary != null ? { summary: leg.summary } : {}),
    steps: Array.isArray(leg?.steps) ? leg.steps.map((step) => ({
      distance: step?.distance,
      duration: step?.duration,
      ...(step?.name != null ? { name: step.name } : {}),
      ...(step?.ref != null ? { ref: step.ref } : {}),
      ...(step?.mode != null ? { mode: step.mode } : {}),
      maneuver: {
        type: step?.maneuver?.type,
        location: step?.maneuver?.location,
        ...(step?.maneuver?.modifier != null ? { modifier: step.maneuver.modifier } : {}),
        ...(step?.maneuver?.bearing_before != null ? { bearingBefore: step.maneuver.bearing_before } : {}),
        ...(step?.maneuver?.bearing_after != null ? { bearingAfter: step.maneuver.bearing_after } : {}),
        ...(step?.maneuver?.exit != null ? { exit: step.maneuver.exit } : {})
      }
    })) : null
  }));
}

function createBoatRoute(origin, destination) {
  const distance = distanceMeters(origin, destination);
  const speedMetersPerSecond = 18_000 / 3_600;
  const duration = Math.max(1, Math.round(distance / speedMetersPerSecond));
  return cleanRoute({
    contractVersion: CONTRACT_VERSION,
    profile: 'boat',
    origin,
    destination,
    geometry: { type: 'LineString', coordinates: [[origin.lng, origin.lat], [destination.lng, destination.lat]] },
    distance,
    duration,
    legs: [{
      distance,
      duration,
      summary: 'Rota náutica direta entre os pontos selecionados',
      steps: [{
        distance,
        duration,
        name: 'Rota náutica',
        mode: 'boat',
        maneuver: { type: 'depart', location: [origin.lng, origin.lat] }
      }]
    }]
  });
}

function cleanRouteRequest(payload) {
  if (!acceptsContractVersion(payload)) return null;
  const profile = cleanRouteProfile(payload?.profile);
  const origin = cleanPoint(payload.origin);
  const destination = cleanPoint(payload.destination);
  return profile && origin && destination ? { origin, destination, profile } : null;
}
