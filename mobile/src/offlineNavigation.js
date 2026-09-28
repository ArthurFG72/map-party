import { calculateOfflineRoute } from './offlineRouter.js';
import { validateOfflineRoutePackage } from './offlineRoutePackage.js';

function validPoint(value) {
  return value && Number.isFinite(value.lat) && Number.isFinite(value.lng);
}

function inside(bounds, point) {
  return point.lng >= bounds.minLongitude && point.lng <= bounds.maxLongitude &&
    point.lat >= bounds.minLatitude && point.lat <= bounds.maxLatitude;
}

export function pointIsCovered(coverage, point) {
  return validPoint(point) && Array.isArray(coverage?.segments) &&
    coverage.segments.some((segment) => segment?.bounds && inside(segment.bounds, point));
}

/**
 * Calculates only from a validated package already held by the device.
 * It has no network fallback by design: callers may choose an online route
 * before a trip, but an active offline session must remain deterministic.
 */
export function calculatePackagedOfflineRoute(rawPackage, origin, destination, options) {
  const offlinePackage = validateOfflineRoutePackage(rawPackage);
  if (!offlinePackage || !validPoint(origin) || !validPoint(destination)) {
    return { ok: false, code: 'INVALID_OFFLINE_PACKAGE' };
  }
  if (!pointIsCovered(offlinePackage.coverage, origin) || !pointIsCovered(offlinePackage.coverage, destination)) {
    return { ok: false, code: 'OUTSIDE_OFFLINE_CORRIDOR' };
  }
  const route = calculateOfflineRoute(offlinePackage.graph, origin, destination, options);
  if (!route) return { ok: false, code: 'OFFLINE_ROUTE_UNAVAILABLE' };
  return {
    ok: true,
    route: {
      origin,
      destination,
      distance: Math.round(route.distance),
      duration: null,
      geometry: { type: 'LineString', coordinates: route.coordinates },
      offlinePackageId: offlinePackage.id,
      offline: true,
    },
  };
}
