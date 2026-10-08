import { TtlLruCache } from './ttlCache.js';

const CATEGORIES = new Set(['restaurant', 'fuel']);

export function normalizePoiRequest({ bbox, lat, lng, radius = 5000, categories = 'restaurant,fuel', limit = 80 } = {}) {
  let values = Array.isArray(bbox) ? bbox : String(bbox ?? '').split(',').map((value) => Number(value.trim()));
  const centerLat = Number(lat);
  const centerLng = Number(lng);
  const requestedRadius = Number(radius);
  const hasCenter = Number.isFinite(centerLat) && centerLat >= -90 && centerLat <= 90
    && Number.isFinite(centerLng) && centerLng >= -180 && centerLng <= 180;
  if ((values.length !== 4 || values.some((value) => !Number.isFinite(value))) && hasCenter
    && Number.isFinite(requestedRadius) && requestedRadius >= 100 && requestedRadius <= 10_000) {
    const latitudePadding = requestedRadius / 111_320;
    const longitudePadding = requestedRadius / (111_320 * Math.max(0.2, Math.cos(centerLat * Math.PI / 180)));
    values = [centerLng - longitudePadding, centerLat - latitudePadding, centerLng + longitudePadding, centerLat + latitudePadding];
  }
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) return null;
  const [minLng, minLat, maxLng, maxLat] = values;
  if (minLng < -180 || maxLng > 180 || minLat < -90 || maxLat > 90 || minLng >= maxLng || minLat >= maxLat) return null;
  if ((maxLng - minLng) * (maxLat - minLat) > 4) return null;
  const selected = String(categories).split(',').map((item) => item.trim().toLowerCase()).filter((item) => CATEGORIES.has(item));
  const unique = [...new Set(selected)];
  const requestedLimit = Number(limit);
  if (!unique.length || !Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 200) return null;
  return { bbox: [minLng, minLat, maxLng, maxLat], center: hasCenter ? { lat: centerLat, lng: centerLng } : null, radius: hasCenter ? Math.min(10_000, Math.max(100, requestedRadius)) : null, categories: unique.sort(), limit: requestedLimit };
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

function distanceBetween(first, second) {
  const latitude = (second.lat - first.lat) * Math.PI / 180;
  const longitude = (second.lng - first.lng) * Math.PI / 180;
  const a = Math.sin(latitude / 2) ** 2
    + Math.cos(first.lat * Math.PI / 180) * Math.cos(second.lat * Math.PI / 180) * Math.sin(longitude / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function createPoiService({ baseUrl = process.env.OVERPASS_BASE_URL || 'https://overpass-api.de/api/interpreter', fallbackUrl = process.env.GEOCODER_BASE_URL || 'https://nominatim.openstreetmap.org', userAgent = process.env.OVERPASS_USER_AGENT || process.env.GEOCODER_USER_AGENT || 'MapParty/1.0 (local-development)', fetchImpl = fetch, cache = new TtlLruCache({ ttlMs: 300_000, maxEntries: 100 }), timeoutMs = 10_000 } = {}) {
  const providers = [...new Set([
    baseUrl,
    ...(process.env.OVERPASS_FALLBACK_URLS || 'https://overpass.kumi.systems/api/interpreter').split(',').map((value) => value.trim()).filter(Boolean)
  ])];
  return {
    async search(request) {
      const normalized = normalizePoiRequest(request);
      if (!normalized) throw Object.assign(new Error('Invalid POI request'), { code: 'INVALID_POI_REQUEST' });
      const [minLng, minLat, maxLng, maxLat] = normalized.bbox;
      const key = `${normalized.bbox.join(',')}|${normalized.center ? `${normalized.center.lat},${normalized.center.lng}` : ''}|${normalized.radius || ''}|${normalized.categories.join(',')}|${normalized.limit}`;
      const cached = cache.get(key);
      if (cached) return cached;
      const queryArea = normalized.center
        ? `(around:${Math.round(Math.min(10_000, Math.max(100, Number(request?.radius) || 5_000)))},${normalized.center.lat},${normalized.center.lng})`
        : `(${minLat},${minLng},${maxLat},${maxLng})`;
      const query = `[out:json][timeout:15];(nwr["amenity"~"^(${normalized.categories.join('|')})$"]${queryArea};);out center tags;`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response;
        for (const provider of providers) {
          try {
            response = await fetchImpl(provider, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': userAgent }, body: new URLSearchParams({ data: query }), signal: controller.signal });
            if (response.ok) break;
          } catch (providerError) {
            if (provider === providers.at(-1)) throw providerError;
          }
        }
        if (!response.ok) throw Object.assign(new Error('Overpass provider error'), { code: 'PROVIDER_ERROR' });
        const payload = await response.json();
        if (!Array.isArray(payload?.elements)) throw Object.assign(new Error('Invalid Overpass response'), { code: 'PROVIDER_ERROR' });
        const seen = new Set();
        const results = payload.elements.map(normalizeElement).filter((item) => {
          if (!item || !normalized.categories.includes(item.category)) return false;
          const key = `${item.lat.toFixed(6)}:${item.lng.toFixed(6)}`;
          if (seen.has(key)) return false;
          seen.add(key); return true;
        });
        if (normalized.center) {
          results.forEach((item) => { item.distanceMeters = distanceBetween(normalized.center, item); });
          results.sort((first, second) => first.distanceMeters - second.distanceMeters);
        }
        const result = { results: results.slice(0, normalized.limit), attribution: 'Dados © contribuidores do OpenStreetMap (Overpass)' };
        cache.set(key, result);
        return result;
      } catch (error) {
        if (normalized.center && (error.name === 'AbortError' || error.code === 'PROVIDER_TIMEOUT' || error.code === 'PROVIDER_ERROR')) {
          try {
            const fallbackController = new AbortController();
            const fallbackTimeout = setTimeout(() => fallbackController.abort(), 5_000);
            const fallbackUrlObject = new URL('/search', fallbackUrl);
            const [minLng, minLat, maxLng, maxLat] = normalized.bbox;
            fallbackUrlObject.searchParams.set('format', 'jsonv2');
            fallbackUrlObject.searchParams.set('q', normalized.categories.includes('fuel') ? 'posto' : 'restaurante');
            fallbackUrlObject.searchParams.set('limit', '50');
            fallbackUrlObject.searchParams.set('accept-language', 'pt-BR');
            fallbackUrlObject.searchParams.set('viewbox', `${minLng},${maxLat},${maxLng},${minLat}`);
            fallbackUrlObject.searchParams.set('bounded', '1');
            const fallbackResponse = await fetchImpl(fallbackUrlObject, { headers: { Accept: 'application/json', 'User-Agent': userAgent }, signal: fallbackController.signal });
            clearTimeout(fallbackTimeout);
            const fallbackPayload = fallbackResponse.ok ? await fallbackResponse.json() : [];
            const fallbackResults = (Array.isArray(fallbackPayload) ? fallbackPayload : []).map((item) => {
              const point = { lat: Number(item?.lat), lng: Number(item?.lon) };
              if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
              return { id: String(item.place_id || `${point.lat}:${point.lng}`), name: String(item.name || 'Posto de combustível').trim() || 'Posto de combustível', category: normalized.categories[0], lat: point.lat, lng: point.lng, address: String(item.display_name || '').trim(), distanceMeters: distanceBetween(normalized.center, point) };
            }).filter((item) => item && item.distanceMeters <= normalized.radius).sort((first, second) => first.distanceMeters - second.distanceMeters).slice(0, normalized.limit);
            const fallbackResult = { results: fallbackResults, attribution: 'Dados © contribuidores do OpenStreetMap (Nominatim)' };
            cache.set(key, fallbackResult);
            return fallbackResult;
          } catch { /* Use the normal provider error below. */ }
        }
        if (error.name === 'AbortError') throw Object.assign(new Error('Provider timeout'), { code: 'PROVIDER_TIMEOUT' });
        if (error.code) throw error;
        throw Object.assign(new Error('Provider error'), { code: 'PROVIDER_ERROR' });
      } finally { clearTimeout(timeoutId); }
    }
  };
}
