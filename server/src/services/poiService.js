import { TtlLruCache } from './ttlCache.js';

const CATEGORIES = new Set(['restaurant', 'fuel']);

export function normalizePoiRequest({ bbox, categories = 'restaurant,fuel', limit = 80 } = {}) {
  const values = Array.isArray(bbox) ? bbox : String(bbox ?? '').split(',').map((value) => Number(value.trim()));
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) return null;
  const [minLng, minLat, maxLng, maxLat] = values;
  if (minLng < -180 || maxLng > 180 || minLat < -90 || maxLat > 90 || minLng >= maxLng || minLat >= maxLat) return null;
  if ((maxLng - minLng) * (maxLat - minLat) > 4) return null;
  const selected = String(categories).split(',').map((item) => item.trim().toLowerCase()).filter((item) => CATEGORIES.has(item));
  const unique = [...new Set(selected)];
  const requestedLimit = Number(limit);
  if (!unique.length || !Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 200) return null;
  return { bbox: [minLng, minLat, maxLng, maxLat], categories: unique.sort(), limit: requestedLimit };
}

function cleanText(value, max = 160) { return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : ''; }

function normalizeElement(element) {
  const tags = element?.tags || {};
  const lat = Number(element.lat ?? element.center?.lat);
  const lng = Number(element.lon ?? element.center?.lon);
  const category = tags.amenity === 'fuel' ? 'fuel' : tags.amenity === 'restaurant' ? 'restaurant' : null;
  if (!category || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const name = cleanText(tags.name) || (category === 'fuel' ? 'Posto de combustível' : 'Restaurante');
  const street = cleanText(tags['addr:street']);
  const number = cleanText(tags['addr:housenumber']);
  return { id: `${element.type}/${element.id}`, name, category, lat, lng, address: street ? `${street}${number ? `, ${number}` : ''}` : '', openingHours: cleanText(tags.opening_hours), brand: cleanText(tags.brand) };
}

export function createPoiService({ baseUrl = process.env.OVERPASS_BASE_URL || 'https://overpass-api.de/api/interpreter', userAgent = process.env.OVERPASS_USER_AGENT || process.env.GEOCODER_USER_AGENT || 'MapParty/1.0 (local-development)', fetchImpl = fetch, cache = new TtlLruCache({ ttlMs: 300_000, maxEntries: 100 }), timeoutMs = 10_000 } = {}) {
  return {
    async search(request) {
      const normalized = normalizePoiRequest(request);
      if (!normalized) throw Object.assign(new Error('Invalid POI request'), { code: 'INVALID_POI_REQUEST' });
      const [minLng, minLat, maxLng, maxLat] = normalized.bbox;
      const key = `${normalized.bbox.join(',')}|${normalized.categories.join(',')}|${normalized.limit}`;
      const cached = cache.get(key);
      if (cached) return cached;
      const query = `[out:json][timeout:10];(nwr["amenity"~"^(${normalized.categories.join('|')})$"](${minLat},${minLng},${maxLat},${maxLng}););out center tags;`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(baseUrl, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': userAgent }, body: new URLSearchParams({ data: query }), signal: controller.signal });
        if (!response.ok) throw Object.assign(new Error('Overpass provider error'), { code: 'PROVIDER_ERROR' });
        const payload = await response.json();
        if (!Array.isArray(payload?.elements)) throw Object.assign(new Error('Invalid Overpass response'), { code: 'PROVIDER_ERROR' });
        const seen = new Set();
        const results = payload.elements.map(normalizeElement).filter((item) => {
          if (!item || !normalized.categories.includes(item.category)) return false;
          const key = `${item.lat.toFixed(6)}:${item.lng.toFixed(6)}`;
          if (seen.has(key)) return false;
          seen.add(key); return true;
        }).slice(0, normalized.limit);
        const result = { results, attribution: 'Dados © contribuidores do OpenStreetMap (Overpass)' };
        cache.set(key, result);
        return result;
      } catch (error) {
        if (error.name === 'AbortError') throw Object.assign(new Error('Provider timeout'), { code: 'PROVIDER_TIMEOUT' });
        if (error.code) throw error;
        throw Object.assign(new Error('Provider error'), { code: 'PROVIDER_ERROR' });
      } finally { clearTimeout(timeoutId); }
    }
  };
}
