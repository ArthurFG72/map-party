import { TtlLruCache } from './ttlCache.js';

const EARTH_RADIUS_METERS = 6_371_000;
const ACCESS_LIMIT_METERS = 300;
const MAX_NODES = 8_000;
const MAX_EDGES = 24_000;
const WATERWAYS = new Set(['river', 'canal']);

function distanceMeters(a, b) {
  const lat = (b.lat - a.lat) * Math.PI / 180;
  const lng = (b.lng - a.lng) * Math.PI / 180;
  const value = Math.sin(lat / 2) ** 2
    + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(lng / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function normalizePoint(value) {
  const lat = Number(value?.lat);
  const lng = Number(value?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
    ? { lat, lng } : null;
}

function buildGraph(payload) {
  const elements = Array.isArray(payload?.elements) ? payload.elements : [];
  const points = new Map(elements
    .filter((item) => item.type === 'node' && Number.isFinite(item.lat) && Number.isFinite(item.lon))
    .map((item) => [item.id, { lat: item.lat, lng: item.lon }]));
  const ways = elements.filter((item) => item.type === 'way'
    && WATERWAYS.has(item.tags?.waterway)
    && item.tags?.boat !== 'no'
    && item.tags?.motorboat !== 'no'
    && Array.isArray(item.nodes));
  const used = new Set();
  for (const way of ways) for (const id of way.nodes) if (points.has(id)) used.add(id);
  if (!used.size || used.size > MAX_NODES) throw Object.assign(new Error('No usable navigable waterways'), { code: 'WATERWAY_UNAVAILABLE' });
  const ids = [...used];
  const index = new Map(ids.map((id, position) => [id, position]));
  const nodes = ids.map((id) => ({ ...points.get(id), edges: [] }));
  let edgeCount = 0;
  const connect = (fromId, toId) => {
    const from = index.get(fromId); const to = index.get(toId);
    if (from == null || to == null || from === to) return;
    nodes[from].edges.push({ to, distance: Math.max(1, distanceMeters(nodes[from], nodes[to])) });
    edgeCount += 1;
    if (edgeCount > MAX_EDGES) throw Object.assign(new Error('Waterway graph too large'), { code: 'WATERWAY_LIMIT' });
  };
  for (const way of ways) {
    for (let i = 1; i < way.nodes.length; i += 1) {
      connect(way.nodes[i - 1], way.nodes[i]);
      if (way.tags?.oneway !== 'yes' && way.tags?.oneway !== 'true') connect(way.nodes[i], way.nodes[i - 1]);
    }
  }
  return nodes;
}

function nearestNode(nodes, point) {
  let best = null;
  for (let i = 0; i < nodes.length; i += 1) {
    const distance = distanceMeters(point, nodes[i]);
    if (!best || distance < best.distance) best = { index: i, distance };
  }
  return best;
}

function shortestPath(nodes, start, end) {
  const distances = new Array(nodes.length).fill(Infinity);
  const previous = new Array(nodes.length).fill(-1);
  const visited = new Set();
  distances[start] = 0;
  while (visited.size < nodes.length) {
    let current = -1;
    for (let i = 0; i < distances.length; i += 1) {
      if (!visited.has(i) && (current < 0 || distances[i] < distances[current])) current = i;
    }
    if (current < 0 || !Number.isFinite(distances[current])) break;
    if (current === end) break;
    visited.add(current);
    for (const edge of nodes[current].edges) {
      const next = distances[current] + edge.distance;
      if (next < distances[edge.to]) { distances[edge.to] = next; previous[edge.to] = current; }
    }
  }
  if (!Number.isFinite(distances[end])) return null;
  const path = [];
  for (let current = end; current >= 0; current = previous[current]) path.push(nodes[current]);
  return { nodes: path.reverse(), distance: distances[end] };
}

export function createWaterwayRouteService({
  baseUrl = process.env.OVERPASS_BASE_URL || 'https://overpass-api.de/api/interpreter',
  userAgent = process.env.OVERPASS_USER_AGENT || 'MapParty/1.0',
  fetchImpl = fetch,
  cache = new TtlLruCache({ ttlMs: 300_000, maxEntries: 20 }),
  timeoutMs = 10_000
} = {}) {
  const providers = [...new Set([baseUrl, ...(process.env.OVERPASS_FALLBACK_URLS || 'https://overpass.kumi.systems/api/interpreter').split(',').map((value) => value.trim()).filter(Boolean)])];
  return {
    async route(originValue, destinationValue) {
      const origin = normalizePoint(originValue); const destination = normalizePoint(destinationValue);
      if (!origin || !destination) throw Object.assign(new Error('Invalid waterway points'), { code: 'INVALID_ROUTE' });
      const delta = 0.02;
      const bbox = [Math.min(origin.lat, destination.lat) - delta, Math.min(origin.lng, destination.lng) - delta, Math.max(origin.lat, destination.lat) + delta, Math.max(origin.lng, destination.lng) + delta];
      const key = bbox.join(',');
      let nodes = cache.get(key);
      if (!nodes) {
        const query = `[out:json][timeout:20];way["waterway"~"^(river|canal)$"](${bbox.join(',')});out body;>;out skel qt;`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
          let response;
          for (const provider of providers) {
            try {
              response = await fetchImpl(provider, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': userAgent }, body: new URLSearchParams({ data: query }), signal: controller.signal });
              if (response.ok) break;
            } catch (error) { if (provider === providers.at(-1)) throw error; }
          }
          if (!response?.ok) throw Object.assign(new Error('Waterway provider error'), { code: 'PROVIDER_ERROR' });
          nodes = buildGraph(await response.json());
          cache.set(key, nodes);
        } catch (error) {
          if (error.code) throw error;
          if (error.name === 'AbortError') throw Object.assign(new Error('Waterway provider timeout'), { code: 'PROVIDER_TIMEOUT' });
          throw Object.assign(new Error('Waterway provider error'), { code: 'PROVIDER_ERROR' });
        } finally { clearTimeout(timeoutId); }
      }
      const start = nearestNode(nodes, origin); const end = nearestNode(nodes, destination);
      if (!start || !end || start.distance > ACCESS_LIMIT_METERS || end.distance > ACCESS_LIMIT_METERS) {
        throw Object.assign(new Error('Origin or destination is not close to a navigable waterway'), { code: 'WATERWAY_UNAVAILABLE' });
      }
      const path = shortestPath(nodes, start.index, end.index);
      if (!path) throw Object.assign(new Error('No navigable waterway connects the selected points'), { code: 'WATERWAY_UNAVAILABLE' });
      const coordinates = [[origin.lng, origin.lat], ...path.nodes.map((point) => [point.lng, point.lat]), [destination.lng, destination.lat]];
      const distance = start.distance + path.distance + end.distance;
      const duration = Math.max(1, Math.round(distance / (18_000 / 3_600)));
      return { geometry: { type: 'LineString', coordinates }, distance, duration, legs: [{ distance, duration, summary: 'Rota por rio ou canal navegável', steps: [{ distance, duration, name: 'Via navegável', mode: 'boat', maneuver: { type: 'depart', location: [origin.lng, origin.lat] } }] }] };
    }
  };
}
