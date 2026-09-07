import { acceptsContractVersion, CONTRACT_VERSION } from '../contracts.js';
import { cleanPoint, cleanRoute } from '../validation.js';

export function createRouteService({
  baseUrl = process.env.OSRM_BASE_URL || 'https://router.project-osrm.org',
  fetchImpl = fetch,
  timeoutMs = 10_000
} = {}) {
  return {
    async calculate(payload) {
      const requestRoute = cleanRouteRequest(payload);
      if (!requestRoute) throw Object.assign(new Error('Invalid route request'), { code: 'INVALID_ROUTE' });
      const { origin, destination } = requestRoute;
      const coordinates = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
      const url = new URL(`/route/v1/driving/${coordinates}`, baseUrl);
      url.searchParams.set('overview', 'simplified');
      url.searchParams.set('geometries', 'geojson');
      url.searchParams.set('steps', 'true');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
        if (!response.ok) throw Object.assign(new Error('Provider error'), { code: 'PROVIDER_ERROR' });
        const body = await response.json();
        const candidate = body?.routes?.[0];
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
