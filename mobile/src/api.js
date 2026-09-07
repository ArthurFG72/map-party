import { SERVER_URL } from './config';

async function requestJson(path, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${SERVER_URL}${path}`, {
      ...options,
      headers: { Accept: 'application/json', ...options.headers },
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

export function searchPlaces(query, region) {
  const params = new URLSearchParams({ q: query.trim(), limit: '5' });
  if (region) {
    const west = region.longitude - region.longitudeDelta / 2;
    const north = region.latitude + region.latitudeDelta / 2;
    const east = region.longitude + region.longitudeDelta / 2;
    const south = region.latitude - region.latitudeDelta / 2;
    params.set('viewbox', [west, north, east, south].map((value) => value.toFixed(5)).join(','));
  }
  return requestJson(`/api/geocode?${params}`);
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

export function calculateRoute(origin, destination) {
  return requestJson('/api/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origin, destination, profile: 'driving' })
  });
}
