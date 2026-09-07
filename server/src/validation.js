import { acceptsContractVersion, CONTRACT_VERSION } from './contracts.js';

const ROOM_ID_RE = /^[a-z0-9-]{4,48}$/;
const COMMAND_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const PARTICIPANT_TOKEN_RE = /^[A-Za-z0-9._~-]{32,256}$/;
export const MAX_ROUTE_COORDINATES = 2000;
export const MAX_ROUTE_LEGS = 8;
export const MAX_ROUTE_STEPS = 500;
export const MAX_LOCATION_FUTURE_SKEW_MS = 5 * 60 * 1000;

const MANEUVER_TYPES = new Set([
  'turn', 'new name', 'depart', 'arrive', 'merge', 'on ramp', 'off ramp',
  'fork', 'end of road', 'continue', 'roundabout', 'rotary', 'roundabout turn',
  'notification', 'exit roundabout', 'exit rotary'
]);
const MANEUVER_MODIFIERS = new Set([
  'uturn', 'sharp right', 'right', 'slight right', 'straight',
  'slight left', 'left', 'sharp left'
]);

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

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  return text.length <= maxLength ? text : null;
}

export function cleanCommandId(value) {
  if (typeof value !== 'string') return null;
  const commandId = value.trim();
  return COMMAND_ID_RE.test(commandId) ? commandId : null;
}

export function cleanParticipantToken(value) {
  if (typeof value !== 'string') return null;
  const token = value.trim();
  return PARTICIPANT_TOKEN_RE.test(token) ? token : null;
}

export function cleanRouteRevision(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function cleanRouteScope(value) {
  if (value == null) return 'shared';
  return value === 'shared' || value === 'personal' ? value : null;
}

export function cleanLocationSequence(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function cleanLocation(value, { now = Date.now() } = {}) {
  if (!value || typeof value !== 'object') return null;
  const { lat, lng, accuracy } = value;
  if (!finiteInRange(lat, -90, 90) || !finiteInRange(lng, -180, 180)) return null;
  if (!finiteInRange(accuracy, 0, 100000)) return null;
  if (finiteInRange(value.timestamp, 0, Number.MAX_SAFE_INTEGER) && value.timestamp > now + MAX_LOCATION_FUTURE_SKEW_MS) return null;
  const timestamp = finiteInRange(value.timestamp, 0, Number.MAX_SAFE_INTEGER)
    ? Math.round(value.timestamp)
    : now;
  const result = { lat, lng, accuracy, timestamp };
  if (finiteInRange(value.speed, 0, 100)) result.speed = value.speed;
  if (finiteInRange(value.heading, 0, 360)) result.heading = value.heading;
  return result;
}

export function cleanLocationUpdate(value, options) {
  if (!acceptsContractVersion(value)) return null;
  const location = cleanLocation(value, options);
  if (!location) return null;
  const locationSequence = value.locationSequence == null ? null : cleanLocationSequence(value.locationSequence);
  if (value.locationSequence != null && locationSequence == null) return null;
  return { contractVersion: CONTRACT_VERSION, location, locationSequence };
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
    if (!['search', 'map', 'geolocation', 'saved', 'poi'].includes(value.source)) return null;
    result.source = value.source;
  }
  return result;
}

function cleanManeuver(value) {
  if (!value || typeof value !== 'object' || !MANEUVER_TYPES.has(value.type)) return null;
  if (!Array.isArray(value.location) || value.location.length < 2
    || !finiteInRange(value.location[0], -180, 180) || !finiteInRange(value.location[1], -90, 90)) return null;
  const maneuver = { type: value.type, location: [value.location[0], value.location[1]] };
  if (value.modifier != null) {
    if (!MANEUVER_MODIFIERS.has(value.modifier)) return null;
    maneuver.modifier = value.modifier;
  }
  if (value.bearingBefore != null) {
    if (!finiteInRange(value.bearingBefore, 0, 360)) return null;
    maneuver.bearingBefore = Math.round(value.bearingBefore);
  }
  if (value.bearingAfter != null) {
    if (!finiteInRange(value.bearingAfter, 0, 360)) return null;
    maneuver.bearingAfter = Math.round(value.bearingAfter);
  }
  if (value.exit != null) {
    if (!Number.isSafeInteger(value.exit) || value.exit < 1 || value.exit > 100) return null;
    maneuver.exit = value.exit;
  }
  return maneuver;
}

function cleanStep(value) {
  if (!value || typeof value !== 'object') return null;
  if (!finiteInRange(value.distance, 0, 100000000) || !finiteInRange(value.duration, 0, 10000000)) return null;
  const maneuver = cleanManeuver(value.maneuver);
  if (!maneuver) return null;
  const step = { distance: value.distance, duration: value.duration, maneuver };
  for (const [field, maxLength] of [['name', 160], ['ref', 80], ['mode', 32]]) {
    if (value[field] == null) continue;
    const text = cleanText(value[field], maxLength);
    if (text == null) return null;
    step[field] = text;
  }
  return step;
}

function cleanLegs(value) {
  if (value == null) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ROUTE_LEGS) return null;
  let stepCount = 0;
  const legs = [];
  for (const rawLeg of value) {
    if (!rawLeg || typeof rawLeg !== 'object'
      || !finiteInRange(rawLeg.distance, 0, 100000000)
      || !finiteInRange(rawLeg.duration, 0, 10000000)
      || !Array.isArray(rawLeg.steps) || rawLeg.steps.length < 1) return null;
    stepCount += rawLeg.steps.length;
    if (stepCount > MAX_ROUTE_STEPS) return null;
    const steps = rawLeg.steps.map(cleanStep);
    if (steps.some((step) => !step)) return null;
    const leg = { distance: rawLeg.distance, duration: rawLeg.duration, steps };
    if (rawLeg.summary != null) {
      const summary = cleanText(rawLeg.summary, 240);
      if (summary == null) return null;
      leg.summary = summary;
    }
    legs.push(leg);
  }
  return legs;
}

export function cleanRoute(value) {
  if (!value || typeof value !== 'object' || !acceptsContractVersion(value)) return null;
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
  const legs = cleanLegs(value.legs);
  if (legs === null) return null;
  const route = {
    contractVersion: CONTRACT_VERSION,
    origin,
    destination,
    geometry: { type: 'LineString', coordinates },
    distance: value.distance,
    duration: value.duration
  };
  if (legs) route.legs = legs;
  return route;
}

export function cleanRouteUpdate(value) {
  const route = cleanRoute(value);
  if (!route) return null;
  const metadata = cleanRouteCommandMetadata(value);
  const scope = cleanRouteScope(value.scope);
  if (!metadata || !scope) return null;
  return { contractVersion: CONTRACT_VERSION, scope, route, ...metadata };
}

function cleanRouteCommandMetadata(value) {
  const commandId = value.commandId == null ? null : cleanCommandId(value.commandId);
  if (value.commandId != null && commandId == null) return null;
  const routeRevision = value.routeRevision == null ? null : cleanRouteRevision(value.routeRevision);
  if (value.routeRevision != null && routeRevision == null) return null;
  return { commandId, routeRevision };
}

export function cleanRouteIntent(value) {
  if (!value || typeof value !== 'object' || !acceptsContractVersion(value)) return null;
  if (value.profile != null && value.profile !== 'driving') return null;
  const origin = cleanPoint(value.origin);
  const destination = cleanPoint(value.destination);
  const metadata = cleanRouteCommandMetadata(value);
  const scope = cleanRouteScope(value.scope);
  if (!origin || !destination || !metadata || !scope) return null;
  // Legacy clients still send the complete route. Validate that shape even
  // though the authoritative geometry and totals will come from OSRM.
  if (value.geometry != null && !cleanRoute(value)) return null;
  return {
    contractVersion: CONTRACT_VERSION,
    scope,
    profile: 'driving',
    origin,
    destination,
    ...metadata
  };
}
