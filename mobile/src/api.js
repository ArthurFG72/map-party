import { GOOGLE_MAPS_API_KEY, SERVER_URL } from './config';
import { CONTRACT_VERSION } from './contracts';

async function requestJson(path, options = {}) {
  const controller = new AbortController();
  const { timeoutMs = 12_000, ...fetchOptions } = options;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${SERVER_URL}${path}`, {
      ...fetchOptions,
      headers: { Accept: 'application/json', ...fetchOptions.headers },
      signal: controller.signal
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error?.message || `Falha no servidor (${response.status}).`);
    return body;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('A solicitação excedeu o tempo limite.');
    if (error instanceof TypeError) throw new Error(`Não foi possível acessar ${SERVER_URL}.`);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function distanceBetween(first, second) {
  const latitude = (second.lat - first.lat) * Math.PI / 180;
  const longitude = (second.lng - first.lng) * Math.PI / 180;
  const a = Math.sin(latitude / 2) ** 2
    + Math.cos(first.lat * Math.PI / 180) * Math.cos(second.lat * Math.PI / 180) * Math.sin(longitude / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function searchGooglePlaces(query, location, limit = 12) {
  if (!GOOGLE_MAPS_API_KEY) return [];
  const params = new URLSearchParams({ query: query.trim(), key: GOOGLE_MAPS_API_KEY });
  if (location && Number.isFinite(location.lat) && Number.isFinite(location.lng)) {
    params.set('location', `${location.lat},${location.lng}`);
    params.set('radius', '50000');
  }
  const response = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?${params}`);
  const body = await response.json().catch(() => null);
  if (!response.ok || (body?.status && !['OK', 'ZERO_RESULTS'].includes(body.status))) return [];
  return (body?.results || []).slice(0, limit).map((item) => {
    const lat = Number(item.geometry?.location?.lat);
    const lng = Number(item.geometry?.location?.lng);
    return {
      id: String(item.place_id || `${lat}:${lng}`), name: item.name || '', label: item.formatted_address || item.name || '',
      address: item.formatted_address || '', lat, lng, category: item.types?.[0] || '', importance: Number(item.rating) || 0,
      ...(location && Number.isFinite(lat) && Number.isFinite(lng) ? { distanceMeters: distanceBetween(location, { lat, lng }) } : {})
    };
  }).filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng));
}

export async function searchPlaces(query, region, location) {
  const localRegion = location && Number.isFinite(location.lat) && Number.isFinite(location.lng)
    && (!region || region.latitudeDelta > 0.6 || region.longitudeDelta > 0.6)
    ? { latitude: location.lat, longitude: location.lng, latitudeDelta: 0.35, longitudeDelta: 0.35 }
    : region;
  const buildParams = (text) => {
    const params = new URLSearchParams({ q: text.trim(), limit: '12' });
    if (localRegion) {
      const west = localRegion.longitude - localRegion.longitudeDelta / 2;
      const north = localRegion.latitude + localRegion.latitudeDelta / 2;
      const east = localRegion.longitude + localRegion.longitudeDelta / 2;
      const south = localRegion.latitude - localRegion.latitudeDelta / 2;
      params.set('viewbox', [west, north, east, south].map((value) => value.toFixed(5)).join(','));
    }
    if (location && Number.isFinite(location.lat) && Number.isFinite(location.lng)) {
      params.set('lat', location.lat.toFixed(5));
      params.set('lon', location.lng.toFixed(5));
    }
    return params;
  };
  const originalQuery = query.trim();
  const simplifiedQuery = originalQuery.replace(/\b(vila|bairro|setor|jardim|residencial)\b/gi, '').replace(/\s+/g, ' ').trim();
  const queries = simplifiedQuery && simplifiedQuery.toLocaleLowerCase('pt-BR') !== originalQuery.toLocaleLowerCase('pt-BR')
    ? [originalQuery, simplifiedQuery]
    : [originalQuery];
  try {
    let body = await requestJson(`/api/geocode?${buildParams(queries[0])}`);
    if (!(body.results || []).length && queries[1]) body = await requestJson(`/api/geocode?${buildParams(queries[1])}`);
    if ((body.results || []).length || !GOOGLE_MAPS_API_KEY) return body;
    const googleResults = await searchGooglePlaces(query, location);
    return { ...body, results: googleResults, attribution: 'Google Places' };
  } catch (error) {
    if (!GOOGLE_MAPS_API_KEY) throw error;
    const googleResults = await searchGooglePlaces(query, location);
    if (googleResults.length) return { results: googleResults, attribution: 'Google Places' };
    throw error;
  }
}

export function searchPois(region, categories) {
  const south = region.latitude - region.latitudeDelta / 2;
  const west = region.longitude - region.longitudeDelta / 2;
  const north = region.latitude + region.latitudeDelta / 2;
  const east = region.longitude + region.longitudeDelta / 2;
  const params = new URLSearchParams({
    bbox: [west, south, east, north].map((value) => value.toFixed(5)).join(','),
    categories: categories.join(','),
    limit: '80'
  });
  return requestJson(`/api/pois?${params}`);
}

export function searchNearbyPois(location, categories = ['fuel'], radiusMeters = 5000) {
  if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)) {
    throw new Error('Aguardando uma posição do GPS.');
  }
  const params = new URLSearchParams({
    lat: location.lat.toFixed(5),
    lon: location.lng.toFixed(5),
    radius: String(Math.max(100, Math.min(10_000, Math.round(radiusMeters)))),
    categories: categories.join(','),
    limit: '5'
  });
  return requestJson(`/api/pois?${params}`);
}

export function calculateRoute(origin, destination) {
  return requestJson('/api/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contractVersion: CONTRACT_VERSION, origin, destination, profile: 'driving' })
  });
}

export function reportRoutePerformance({ origin, destination, geometry, actualDurationSeconds, completedAt = Date.now() }) {
  const coordinates = geometry?.coordinates || [];
  const sampled = coordinates.length <= 64
    ? coordinates
    : coordinates.filter((_point, index) => index === 0 || index === coordinates.length - 1 || index % Math.ceil(coordinates.length / 64) === 0).slice(0, 64);
  return requestJson('/api/route/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contractVersion: CONTRACT_VERSION, origin, destination, geometry: { type: 'LineString', coordinates: sampled }, actualDurationSeconds, completedAt })
  });
}

export function prepareOfflineGraph(route) {
  const coordinates = route?.geometry?.coordinates || [];
  const compactCoordinates = coordinates.length <= 256
    ? coordinates
    : coordinates.filter((_point, index) => index === 0 || index === coordinates.length - 1 || index % Math.ceil(coordinates.length / 256) === 0).slice(0, 256);
  return requestJson('/api/offline/graph', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: route?.offlinePackageId, geometry: { type: 'LineString', coordinates: compactCoordinates }, corridorMeters: 450 })
  });
}

export function fetchEmergencyPublicKey() {
  return requestJson('/api/emergency/public-key');
}

export function relayEmergencyPacket(packet) {
  return requestJson('/api/emergency/relay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(packet)
  });
}

export function askAssistant(message, history = [], context = {}) {
  return requestJson('/api/assistant', {
    timeoutMs: 25_000,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history, context })
  });
}
