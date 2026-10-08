import { TtlLruCache } from './ttlCache.js';

const EARTH_RADIUS_METERS = 6_371_000;
const ROAD_TYPES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'track']);
const MAX_ROUTE_POINTS = 256;
const MAX_NODES = 8_000;
const MAX_EDGES = 24_000;

function distanceMeters(a, b) {
  const lat = (b.lat - a.lat) * Math.PI / 180;
  const lng = (b.lng - a.lng) * Math.PI / 180;
  const value = Math.sin(lat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(lng / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function cleanId(value) { return String(value || '').replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 80); }

export function normalizeOfflineGraphRequest({ geometry, id, corridorMeters = 450 } = {}) {
  const coordinates = geometry?.coordinates;
  if (geometry?.type !== 'LineString' || !Array.isArray(coordinates) || coordinates.length < 2 || coordinates.length > MAX_ROUTE_POINTS) return null;
  const route = coordinates.map((point) => [Number(point?.[0]), Number(point?.[1])]);
  if (route.some(([lng, lat]) => !Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90)) return null;
  const radius = Number(corridorMeters);
  if (!Number.isFinite(radius) || radius < 100 || radius > 1_200) return null;
  const latitudeMeters = 111_320;
  const longitudeMeters = latitudeMeters * Math.max(0.2, Math.cos(route[0][1] * Math.PI / 180));
  const deltaLat = radius / latitudeMeters;
  const deltaLng = radius / longitudeMeters;
  const lats = route.map((point) => point[1]);
  const lngs = route.map((point) => point[0]);
  const bbox = [Math.min(...lngs) - deltaLng, Math.min(...lats) - deltaLat, Math.max(...lngs) + deltaLng, Math.max(...lats) + deltaLat];
  if ((bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) > 0.12) return null;
  return { id: cleanId(id) || `route-${route[0].join('-')}-${route.at(-1).join('-')}`, route, radius, bbox };
}

function buildGraph(payload, request) {
  const elements = Array.isArray(payload?.elements) ? payload.elements : [];
  const nodesById = new Map(elements.filter((item) => item.type === 'node' && Number.isFinite(item.lat) && Number.isFinite(item.lon)).map((item) => [item.id, { lat: item.lat, lng: item.lon }]));
  const sourceWays = elements.filter((item) => item.type === 'way' && ROAD_TYPES.has(item.tags?.highway) && Array.isArray(item.nodes));
  const used = new Set();
  for (const way of sourceWays) for (const nodeId of way.nodes) if (nodesById.has(nodeId)) used.add(nodeId);
  if (!used.size || used.size > MAX_NODES) throw Object.assign(new Error('Offline graph is too large'), { code: 'GRAPH_LIMIT' });
  const indexById = new Map([...used].map((nodeId, index) => [nodeId, index]));
  const nodes = [...used].map((nodeId) => ({ ...nodesById.get(nodeId), edges: [] }));
  let edgeCount = 0;
  const connect = (fromId, toId) => {
    const from = indexById.get(fromId); const to = indexById.get(toId);
    if (from == null || to == null || from === to) return;
    const distance = Math.max(1, distanceMeters(nodes[from], nodes[to]));
    nodes[from].edges.push({ to, distance }); edgeCount += 1;
  };
  for (const way of sourceWays) {
    const direction = way.tags?.oneway;
    const pairs = direction === '-1' ? [...way.nodes].reverse() : way.nodes;
    for (let index = 1; index < pairs.length; index += 1) {
      connect(pairs[index - 1], pairs[index]);
      if (direction !== 'yes' && direction !== '1' && direction !== 'true') connect(pairs[index], pairs[index - 1]);
      if (edgeCount > MAX_EDGES) throw Object.assign(new Error('Offline graph has too many edges'), { code: 'GRAPH_LIMIT' });
    }
  }
  if (!nodes.some((node) => node.edges.length)) throw Object.assign(new Error('Offline graph has no usable roads'), { code: 'GRAPH_EMPTY' });
  return { version: 1, id: request.id, source: 'osm-overpass', corridorMeters: request.radius, bbox: request.bbox, nodes };
}

export function createOfflineGraphService({ baseUrl = process.env.OVERPASS_BASE_URL || 'https://overpass-api.de/api/interpreter', userAgent = process.env.OVERPASS_USER_AGENT || 'MapParty/1.0', fetchImpl = fetch, cache = new TtlLruCache({ ttlMs: 300_000, maxEntries: 20 }), timeoutMs = 10_000 } = {}) {
  const providers = [...new Set([baseUrl, ...(process.env.OVERPASS_FALLBACK_URLS || 'https://overpass.kumi.systems/api/interpreter').split(',').map((value) => value.trim()).filter(Boolean)])];
  return {
    async build(request) {
      const normalized = normalizeOfflineGraphRequest(request);
      if (!normalized) throw Object.assign(new Error('Invalid offline graph request'), { code: 'INVALID_OFFLINE_GRAPH' });
      const key = `${normalized.bbox.join(',')}|${normalized.radius}`;
      const cached = cache.get(key);
      if (cached) return { ...cached, id: normalized.id };
      const [minLng, minLat, maxLng, maxLat] = normalized.bbox;
      const query = `[out:json][timeout:20];(way["highway"](${minLat},${minLng},${maxLat},${maxLng}););out body;>;out skel qt;`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response;
        for (const provider of providers) {
          try {
            response = await fetchImpl(provider, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': userAgent }, body: new URLSearchParams({ data: query }), signal: controller.signal });
            if (response.ok) break;
          } catch (error) {
            if (provider === providers.at(-1)) throw error;
          }
        }
        if (!response?.ok) throw Object.assign(new Error('Overpass provider error'), { code: 'PROVIDER_ERROR' });
        const graph = buildGraph(await response.json(), normalized);
        cache.set(key, graph);
        return graph;
      } catch (error) {
        if (error.code) throw error;
        if (error.name === 'AbortError') throw Object.assign(new Error('Provider timeout'), { code: 'PROVIDER_TIMEOUT' });
        throw Object.assign(new Error('Provider error'), { code: 'PROVIDER_ERROR' });
      } finally { clearTimeout(timeoutId); }
    }
  };
}
