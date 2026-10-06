import { acceptsContractVersion, CONTRACT_VERSION } from '../contracts.js';
import { cleanPoint, cleanRoute } from '../validation.js';

const ROUTE_ENDPOINT_TOLERANCE_METERS = 300;
const ROUTE_ENDPOINT_FALLBACK_TOLERANCE_METERS = 5_000;
const MANEUVER_TOLERANCE_METERS = 180;

function distanceMeters(first, second) {
  const latitude = (second.lat - first.lat) * Math.PI / 180;
  const longitude = (second.lng - first.lng) * Math.PI / 180;
  const a = Math.sin(latitude / 2) ** 2
    + Math.cos(first.lat * Math.PI / 180) * Math.cos(second.lat * Math.PI / 180) * Math.sin(longitude / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function endpointsWithinTolerance(candidate, origin, destination, toleranceMeters) {
  const coordinates = candidate?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return false;
  const first = coordinates[0];
  const last = coordinates.at(-1);
  if (!Array.isArray(first) || !Array.isArray(last)) return false;
  return distanceMeters({ lat: first[1], lng: first[0] }, origin) <= toleranceMeters
    && distanceMeters({ lat: last[1], lng: last[0] }, destination) <= toleranceMeters;
}

function auditRouteGeometry(candidate, origin, destination) {
  if (!endpointsWithinTolerance(candidate, origin, destination, ROUTE_ENDPOINT_TOLERANCE_METERS)) return false;
  const coordinates = candidate.geometry.coordinates;
  const maneuvers = (candidate.legs || []).flatMap((leg) => leg?.steps || [])
    .map((step) => step?.maneuver?.location)
    .filter((location) => Array.isArray(location) && location.length >= 2);
  return maneuvers.every((location) => coordinates.some((coordinate) => Array.isArray(coordinate)
    && distanceMeters({ lat: coordinate[1], lng: coordinate[0] }, { lat: location[1], lng: location[0] }) <= MANEUVER_TOLERANCE_METERS));
}

function respectsTurnRestrictions(rawLegs) {
  return (rawLegs || []).every((leg) => (leg?.steps || []).every((step) => (step?.intersections || []).every((intersection) => {
    const entry = intersection?.entry;
    const out = intersection?.out;
    return !Array.isArray(entry) || !Number.isInteger(out) || entry[out] !== false;
  })));
}

export function createRouteService({
  baseUrl = process.env.OSRM_BASE_URL || 'https://router.project-osrm.org',
  fetchImpl = fetch,
  timeoutMs = 10_000,
  trafficStore = null,
  routeLearningStore = null
} = {}) {
  return {
    async calculate(payload) {
      const requestRoute = cleanRouteRequest(payload);
      if (!requestRoute) throw Object.assign(new Error('Invalid route request'), { code: 'INVALID_ROUTE' });
      const { origin, destination } = requestRoute;
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
        const providerCandidates = Array.isArray(body?.routes)
          ? body.routes.filter((route) => Number.isFinite(route?.duration)
            && compactOsrmLegs(route?.legs)
            && respectsTurnRestrictions(route?.legs)
            && endpointsWithinTolerance(route, origin, destination, ROUTE_ENDPOINT_FALLBACK_TOLERANCE_METERS))
          : [];
        // Geocoders may return a POI pin that OSRM snaps to the nearest
        // accessible road. Prefer audited candidates, but keep the provider
        // route when snapping exceeds the audit tolerance; rejecting every
        // candidate made valid address searches fail with PROVIDER_ERROR.
        const auditedCandidates = providerCandidates.filter((route) => auditRouteGeometry(route, origin, destination));
        const candidates = auditedCandidates.length > 0 ? auditedCandidates : providerCandidates;
        const scored = candidates.map((route) => {
          const traffic = trafficStore?.evaluate({ ...route, origin, destination }) || null;
          const learning = routeLearningStore?.evaluate({ ...route, origin, destination }) || null;
          const trafficDuration = traffic?.adjustedDuration || route.duration;
          const learningDuration = learning?.samples >= 2 ? learning.duration : route.duration;
          return {
            route,
            traffic,
            learning,
            score: Math.round(trafficDuration * 0.7 + learningDuration * 0.3)
          };
        });
        const candidate = scored.sort((first, second) => {
          return first.score - second.score;
        })[0];
        const selected = candidate?.route;
        const legs = compactOsrmLegs(selected?.legs);
        const route = body?.code === 'Ok' && selected && legs ? cleanRoute({
          contractVersion: CONTRACT_VERSION,
          origin,
          destination,
          geometry: selected.geometry,
          distance: selected.distance,
          duration: selected.duration,
          legs
        }) : null;
        if (!route) throw Object.assign(new Error('Provider error'), { code: 'PROVIDER_ERROR' });
        return candidate.traffic ? { ...route, traffic: candidate.traffic } : route;
      } catch (error) {
        if (error.name === 'AbortError') throw Object.assign(new Error('Provider timeout'), { code: 'PROVIDER_TIMEOUT' });
        if (error.code) throw error;
        throw Object.assign(new Error('Provider error'), { code: 'PROVIDER_ERROR' });
      } finally {
        clearTimeout(timeoutId);
      }
    }
  };
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

function cleanRouteRequest(payload) {
  if (!acceptsContractVersion(payload) || payload?.profile !== 'driving') return null;
  const origin = cleanPoint(payload.origin);
  const destination = cleanPoint(payload.destination);
  return origin && destination ? { origin, destination } : null;
}
