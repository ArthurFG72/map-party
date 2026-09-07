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
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
        if (!response.ok) throw Object.assign(new Error('Provider error'), { code: 'PROVIDER_ERROR' });
        const body = await response.json();
        const candidate = body?.routes?.[0];
        const route = body?.code === 'Ok' && candidate ? cleanRoute({
          contractVersion: CONTRACT_VERSION,
          origin,
          destination,
          geometry: candidate.geometry,
          distance: candidate.distance,
          duration: candidate.duration
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

function cleanRouteRequest(payload) {
  if (!acceptsContractVersion(payload) || payload?.profile !== 'driving') return null;
  const origin = cleanPoint(payload.origin);
  const destination = cleanPoint(payload.destination);
  return origin && destination ? { origin, destination } : null;
}
