const EARTH_RADIUS_METERS = 6371000;
const DEFAULT_CORRIDOR_METERS = 8000;
const DEFAULT_SEGMENT_METERS = 40000;
const LOW_RESOURCE_MAX_BYTES = 24 * 1024 * 1024;
const STANDARD_MAX_BYTES = 64 * 1024 * 1024;

function radians(value) {
  return (value * Math.PI) / 180;
}

function distanceMeters(a, b) {
  const lat1 = radians(a[1]);
  const lat2 = radians(b[1]);
  const deltaLat = lat2 - lat1;
  const deltaLng = radians(b[0] - a[0]);
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function validCoordinate(value) {
  return Array.isArray(value) &&
    value.length >= 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    Math.abs(value[0]) <= 180 &&
    Math.abs(value[1]) <= 90;
}

function boundsFor(points, corridorMeters) {
  const averageLatitude = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  const latitudePadding = corridorMeters / 111320;
  const longitudePadding = corridorMeters / Math.max(1000, 111320 * Math.cos(radians(averageLatitude)));

  return {
    minLongitude: Math.min(...points.map((point) => point[0])) - longitudePadding,
    minLatitude: Math.min(...points.map((point) => point[1])) - latitudePadding,
    maxLongitude: Math.max(...points.map((point) => point[0])) + longitudePadding,
    maxLatitude: Math.max(...points.map((point) => point[1])) + latitudePadding,
  };
}

/**
 * Produces bounded map-download areas for one already calculated route.
 * Coordinates use the GeoJSON order: [longitude, latitude].
 */
export function buildOfflineRouteCoverage(coordinates, options = {}) {
  if (!Array.isArray(coordinates) || coordinates.length < 2 || !coordinates.every(validCoordinate)) {
    return null;
  }

  const corridorMeters = options.corridorMeters ?? DEFAULT_CORRIDOR_METERS;
  const segmentMeters = options.segmentMeters ?? DEFAULT_SEGMENT_METERS;
  if (!Number.isFinite(corridorMeters) || corridorMeters <= 0 ||
      !Number.isFinite(segmentMeters) || segmentMeters <= 0) {
    return null;
  }

  const segments = [];
  let current = [coordinates[0]];
  let currentDistance = 0;
  let totalDistance = 0;

  for (let index = 1; index < coordinates.length; index += 1) {
    const previous = coordinates[index - 1];
    const point = coordinates[index];
    const legDistance = distanceMeters(previous, point);

    if (current.length > 1 && currentDistance + legDistance > segmentMeters) {
      segments.push({ bounds: boundsFor(current, corridorMeters), routeMeters: Math.round(currentDistance) });
      current = [previous];
      currentDistance = 0;
    }

    current.push(point);
    currentDistance += legDistance;
    totalDistance += legDistance;
  }

  segments.push({ bounds: boundsFor(current, corridorMeters), routeMeters: Math.round(currentDistance) });

  return {
    corridorMeters: Math.round(corridorMeters),
    totalRouteMeters: Math.round(totalDistance),
    maxPackageBytes: options.lowResource ? LOW_RESOURCE_MAX_BYTES : STANDARD_MAX_BYTES,
    segments,
  };
}
