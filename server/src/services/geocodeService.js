import { TtlLruCache } from './ttlCache.js';

export function normalizeQuery(value) {
  if (typeof value !== 'string') return null;
  const query = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return query.length >= 3 && query.length <= 160 ? query : null;
}

export function normalizeViewbox(value) {
  if (value == null || value === '') return null;
  const coordinates = String(value).split(',').map((item) => Number(item.trim()));
  if (coordinates.length !== 4 || coordinates.some((item) => !Number.isFinite(item))) return null;
  const [west, north, east, south] = coordinates;
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) return null;
  return coordinates.map((item) => Number(item.toFixed(5))).join(',');
}

export function normalizeCenter(value) {
  if (!value || typeof value !== 'object') return null;
  const lat = Number(value.lat);
  const lng = Number(value.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) return null;
  return { lat: Number(lat.toFixed(5)), lng: Number(lng.toFixed(5)) };
}

function cleanResult(item, center) {
  const lat = Number(item?.lat);
  const lng = Number(item?.lon);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return null;
  }
  const bbox = Array.isArray(item.boundingbox) && item.boundingbox.length === 4
    ? item.boundingbox.map(Number)
    : null;
  const label = String(item.display_name ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  if (!label) return null;
  return {
    id: String(item.place_id ?? `${lat}:${lng}`),
    label,
    lat,
    lng,
    bbox: bbox?.every(Number.isFinite) ? bbox : null,
    category: typeof item.category === 'string' ? item.category : '',
    type: typeof item.type === 'string' ? item.type : '',
    importance: Number.isFinite(Number(item.importance)) ? Number(item.importance) : 0,
    distanceMeters: center ? distanceBetween(center, { lat, lng }) : null
  };
}

function overpassQueryText(value) {
  const ignored = new Set(['condominio', 'conjunto', 'residencial', 'edificio', 'edifício', 'loteamento', 'bairro']);
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 2 && !ignored.has(term))
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
}

function cleanOverpassResult(item, center) {
  const tags = item?.tags || {};
  const point = item?.center || item;
  const lat = Number(point?.lat);
  const lng = Number(point?.lon);
  const name = String(tags.name || tags['official_name'] || '').replace(/\s+/g, ' ').trim();
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const address = [tags['addr:street'], tags['addr:housenumber'], tags['addr:city']].filter(Boolean).join(', ');
  return cleanResult({
    place_id: `overpass:${item.type}:${item.id}`,
    display_name: address ? `${name}, ${address}` : name,
    lat,
    lon: lng,
    category: tags.amenity || tags.shop || tags.tourism || 'place',
    type: item.type,
    importance: 0.5
  }, center);
}

function distanceBetween(first, second) {
  const latitude = (second.lat - first.lat) * Math.PI / 180;
  const longitude = (second.lng - first.lng) * Math.PI / 180;
  const a = Math.sin(latitude / 2) ** 2
    + Math.cos(first.lat * Math.PI / 180) * Math.cos(second.lat * Math.PI / 180) * Math.sin(longitude / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function createGeocodeService({
  baseUrl = process.env.GEOCODER_BASE_URL || 'https://nominatim.openstreetmap.org',
  overpassBaseUrl = process.env.OVERPASS_BASE_URL || 'https://overpass-api.de/api/interpreter',
  userAgent = process.env.GEOCODER_USER_AGENT || 'MapParty/1.0 (local-development)',
  fetchImpl = fetch,
  cache = new TtlLruCache(),
  timeoutMs = 8_000,
  minIntervalMs = 1_000,
  now = () => Date.now(),
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
} = {}) {
  let queue = Promise.resolve();
  let lastStartedAt = 0;

  async function request(query, limit, viewbox, center) {
    const normalizedViewbox = normalizeViewbox(viewbox);
    const normalizedCenter = normalizeCenter(center);
    const key = `${query.toLocaleLowerCase('pt-BR')}|${limit}|${normalizedViewbox || ''}|${normalizedCenter ? `${normalizedCenter.lat},${normalizedCenter.lng}` : ''}`;
    const cached = cache.get(key);
    if (cached) return cached;

    const run = async () => {
      const queuedCached = cache.get(key);
      if (queuedCached) return queuedCached;
      const delay = Math.max(0, minIntervalMs - (now() - lastStartedAt));
      if (delay) await wait(delay);
      lastStartedAt = now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const url = new URL('/search', baseUrl);
        url.searchParams.set('q', query);
        url.searchParams.set('format', 'jsonv2');
        url.searchParams.set('limit', String(limit));
        url.searchParams.set('addressdetails', '1');
        url.searchParams.set('accept-language', 'pt-BR');
        if (normalizedCenter) {
          url.searchParams.set('lat', String(normalizedCenter.lat));
          url.searchParams.set('lon', String(normalizedCenter.lng));
          url.searchParams.set('countrycodes', 'br');
        }
        if (normalizedViewbox) {
          url.searchParams.set('viewbox', normalizedViewbox);
          url.searchParams.set('bounded', normalizedCenter ? '1' : '0');
        }
        let response = await fetchImpl(url, {
          headers: { Accept: 'application/json', 'User-Agent': userAgent },
          signal: controller.signal
        });
        if (!response.ok) throw Object.assign(new Error('Provider error'), { code: 'PROVIDER_ERROR' });
        let payload = await response.json();
        if (!Array.isArray(payload)) throw Object.assign(new Error('Invalid provider response'), { code: 'PROVIDER_ERROR' });
        // Keep local results first, but retry globally when the local country filter
        // hides a valid result (for example an international address explicitly typed).
        if (!payload.length && normalizedCenter) {
          const fallbackUrl = new URL(url);
          fallbackUrl.searchParams.delete('countrycodes');
          fallbackUrl.searchParams.set('bounded', '0');
          response = await fetchImpl(fallbackUrl, {
            headers: { Accept: 'application/json', 'User-Agent': userAgent },
            signal: controller.signal
          });
          if (!response.ok) throw Object.assign(new Error('Provider error'), { code: 'PROVIDER_ERROR' });
          payload = await response.json();
          if (!Array.isArray(payload)) throw Object.assign(new Error('Invalid provider response'), { code: 'PROVIDER_ERROR' });
        }
        let results = payload.map((item) => cleanResult(item, normalizedCenter)).filter(Boolean);
        if (!results.length && (normalizedCenter || normalizedViewbox)) {
          const searchText = overpassQueryText(query);
          if (searchText) {
            const overpassUrl = new URL(overpassBaseUrl);
            const area = normalizedViewbox
              ? (() => {
                const [west, north, east, south] = normalizedViewbox.split(',').map(Number);
                return `(${south},${west},${north},${east})`;
              })()
              : `(around:10000,${normalizedCenter.lat},${normalizedCenter.lng})`;
            const overpassQuery = `[out:json][timeout:15];nwr["name"~"${searchText}",i]${area};out center tags;`;
            try {
              const overpassResponse = await fetchImpl(overpassUrl, {
                method: 'POST',
                headers: { Accept: 'application/json', 'Content-Type': 'text/plain', 'User-Agent': userAgent },
                body: overpassQuery,
                signal: controller.signal
              });
              if (overpassResponse.ok) {
                const overpassPayload = await overpassResponse.json();
                results = (Array.isArray(overpassPayload?.elements) ? overpassPayload.elements : [])
                  .map((item) => cleanOverpassResult(item, normalizedCenter)).filter(Boolean);
              }
            } catch {
              // Nominatim remains the authoritative fallback when Overpass is unavailable.
            }
          }
        }
        if (normalizedCenter) {
          results.sort((first, second) => {
            const firstScore = (first.distanceMeters ?? Number.MAX_SAFE_INTEGER) * (1.15 - Math.min(first.importance, 1) * 0.15);
            const secondScore = (second.distanceMeters ?? Number.MAX_SAFE_INTEGER) * (1.15 - Math.min(second.importance, 1) * 0.15);
            return firstScore - secondScore;
          });
        }
        const result = {
          results: results.slice(0, limit),
          attribution: 'Dados de busca © contribuidores do OpenStreetMap (Nominatim/Overpass)'
        };
        cache.set(key, result);
        return result;
      } catch (error) {
        if (error.name === 'AbortError') throw Object.assign(new Error('Provider timeout'), { code: 'PROVIDER_TIMEOUT' });
        if (error.code) throw error;
        throw Object.assign(new Error('Provider error'), { code: 'PROVIDER_ERROR' });
      } finally {
        clearTimeout(timeoutId);
      }
    };

    const pending = queue.then(run, run);
    queue = pending.catch(() => undefined);
    return pending;
  }

  return { search: request };
}
