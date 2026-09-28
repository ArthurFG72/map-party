import { buildOfflineRouteCoverage } from './offlineRouteCoverage.js';
import { prepareOfflinePackageForStorage, validateOfflinePackage } from './offlinePackage.js';

function distanceMeters([lng1, lat1], [lng2, lat2]) {
  const radians = Math.PI / 180;
  const latitude = (lat2 - lat1) * radians;
  const longitude = (lng2 - lng1) * radians;
  const a = Math.sin(latitude / 2) ** 2 + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(longitude / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function routePackageId(coordinates) {
  const first = coordinates[0];
  const last = coordinates.at(-1);
  return `route-${first[0].toFixed(5)}-${first[1].toFixed(5)}-${last[0].toFixed(5)}-${last[1].toFixed(5)}`;
}

export function createOfflineRoutePackage(route, options = {}) {
  const coordinates = route?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2 || coordinates.some((point) => !Array.isArray(point) || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]))) return null;
  const id = String(options.id || route.offlinePackageId || routePackageId(coordinates)).slice(0, 80);
  const suppliedGraph = options.graph || route.offlineGraph;
  const validatedGraph = suppliedGraph?.version === 1 && suppliedGraph.id === id ? validateOfflinePackage(suppliedGraph) : null;
  if (validatedGraph) return { version: 1, id, route, graph: { version: 1, ...validatedGraph } };
  const nodes = coordinates.map(([lng, lat], index) => ({
    lat,
    lng,
    edges: [
      ...(index > 0 ? [{ to: index - 1, distance: Math.max(1, distanceMeters(coordinates[index - 1], coordinates[index])) }] : []),
      ...(index < coordinates.length - 1 ? [{ to: index + 1, distance: Math.max(1, distanceMeters(coordinates[index], coordinates[index + 1])) }] : [])
    ]
  }));
  return { version: 1, id, route, graph: { version: 1, id, nodes } };
}

export function prepareOfflineRoutePackageForStorage(value, maxBytes = 4 * 1024 * 1024) {
  const routePackage = validateOfflineRoutePackage(value);
  if (!routePackage) return null;
  const preparedGraph = prepareOfflinePackageForStorage({ version: 1, ...routePackage.graph }, maxBytes);
  if (!preparedGraph) return null;
  const stored = { version: 1, ...routePackage, graph: { version: 1, ...JSON.parse(preparedGraph.serialized) } };
  return new TextEncoder().encode(JSON.stringify(stored)).length <= maxBytes ? stored : null;
}

export function validateOfflineRoutePackage(value) {
  if (!value || value.version !== 1 || typeof value.id !== 'string' || !value.id.trim()) return null;
  const coordinates = value.route?.geometry?.coordinates;
  const coverage = buildOfflineRouteCoverage(coordinates, value.coverage);
  const graph = validateOfflinePackage(value.graph);
  if (!coverage || !graph || graph.id !== value.id.slice(0, 80)) return null;
  return { id: graph.id, route: { geometry: { type: 'LineString', coordinates } }, coverage, graph };
}
