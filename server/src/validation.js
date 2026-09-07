const ROOM_ID_RE = /^[a-z0-9-]{4,48}$/;
export const MAX_ROUTE_COORDINATES = 2000;

export function cleanName(value) {
  if (typeof value !== 'string') return null;
  const name = value.replace(/[<>\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  return name.length >= 2 && name.length <= 32 ? name : null;
}

export function cleanRoomId(value) {
  if (typeof value !== 'string') return null;
  const roomId = value.trim().toLowerCase();
  return ROOM_ID_RE.test(roomId) ? roomId : null;
}

function finiteInRange(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

export function cleanLocation(value) {
  if (!value || typeof value !== 'object') return null;
  const { lat, lng, accuracy } = value;
  if (!finiteInRange(lat, -90, 90) || !finiteInRange(lng, -180, 180)) return null;
  if (!finiteInRange(accuracy, 0, 100000)) return null;
  const timestamp = finiteInRange(value.timestamp, 0, Number.MAX_SAFE_INTEGER)
    ? Math.round(value.timestamp)
    : Date.now();
  const result = { lat, lng, accuracy, timestamp };
  if (finiteInRange(value.speed, 0, 100)) result.speed = value.speed;
  if (finiteInRange(value.heading, 0, 360)) result.heading = value.heading;
  return result;
}

export function cleanPoint(value) {
  if (!value || typeof value !== 'object') return null;
  if (!finiteInRange(value.lat, -90, 90) || !finiteInRange(value.lng, -180, 180)) return null;
  const result = { lat: value.lat, lng: value.lng };
  if (value.label != null) {
    if (typeof value.label !== 'string') return null;
    const label = value.label
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!label || label.length > 160) return null;
    result.label = label;
  }
  if (value.source != null) {
    if (!['search', 'map', 'geolocation', 'saved'].includes(value.source)) return null;
    result.source = value.source;
  }
  return result;
}

export function cleanRoute(value) {
  if (!value || typeof value !== 'object') return null;
  const origin = cleanPoint(value.origin);
  const destination = cleanPoint(value.destination);
  const coords = value.geometry?.coordinates;
  if (!origin || !destination || value.geometry?.type !== 'LineString' || !Array.isArray(coords)) return null;
  if (coords.length < 2 || coords.length > MAX_ROUTE_COORDINATES) return null;
  const coordinates = [];
  for (const item of coords) {
    if (!Array.isArray(item) || item.length < 2 || !finiteInRange(item[0], -180, 180) || !finiteInRange(item[1], -90, 90)) return null;
    coordinates.push([item[0], item[1]]);
  }
  if (!finiteInRange(value.distance, 0, 100000000) || !finiteInRange(value.duration, 0, 10000000)) return null;
  return {
    origin,
    destination,
    geometry: { type: 'LineString', coordinates },
    distance: value.distance,
    duration: value.duration
  };
}
