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

function cleanResult(item) {
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
    type: typeof item.type === 'string' ? item.type : ''
  };
}

export function createGeocodeService({
  baseUrl = process.env.GEOCODER_BASE_URL || 'https://nominatim.openstreetmap.org',
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

  async function request(query, limit, viewbox) {
    const normalizedViewbox = normalizeViewbox(viewbox);
    const key = `${query.toLocaleLowerCase('pt-BR')}|${limit}|${normalizedViewbox || ''}`;
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
        url.searchParams.set('addressdetails', '0');
        if (normalizedViewbox) {
          url.searchParams.set('viewbox', normalizedViewbox);
          url.searchParams.set('bounded', '0');
        }
        const response = await fetchImpl(url, {
          headers: { Accept: 'application/json', 'User-Agent': userAgent },
          signal: controller.signal
        });
        if (!response.ok) throw Object.assign(new Error('Provider error'), { code: 'PROVIDER_ERROR' });
        const payload = await response.json();
        if (!Array.isArray(payload)) throw Object.assign(new Error('Invalid provider response'), { code: 'PROVIDER_ERROR' });
        const result = {
          results: payload.slice(0, limit).map(cleanResult).filter(Boolean),
          attribution: 'Dados de busca © contribuidores do OpenStreetMap (Nominatim)'
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
