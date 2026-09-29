const EARTH_RADIUS_METERS = 6_371_000;
const DEFAULT_OFF_ROUTE_METERS = 75;
const ARRIVAL_RADIUS_METERS = 45;
const COMPLEX_MANEUVER_RADIUS_METERS = 180;
const COMPLEX_MANEUVER_TYPES = new Set([
  'fork', 'roundabout', 'rotary', 'roundabout turn', 'exit roundabout',
  'exit rotary', 'end of road', 'merge', 'on ramp', 'off ramp',
  'turn', 'continue', 'notification'
]);

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function distanceMeters(first, second) {
  if (!first || !second) return Number.POSITIVE_INFINITY;
  const latitude = (second.lat - first.lat) * Math.PI / 180;
  const longitude = (second.lng - first.lng) * Math.PI / 180;
  const a = Math.sin(latitude / 2) ** 2
    + Math.cos(first.lat * Math.PI / 180) * Math.cos(second.lat * Math.PI / 180) * Math.sin(longitude / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function coordinatePoint(coordinate) {
  if (!Array.isArray(coordinate) || coordinate.length < 2) return null;
  const lng = Number(coordinate[0]);
  const lat = Number(coordinate[1]);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function projectOnSegment(position, start, end) {
  const latitudeRadians = position.lat * Math.PI / 180;
  const metersPerLongitudeDegree = 111_320 * Math.max(0.01, Math.cos(latitudeRadians));
  const metersPerLatitudeDegree = 110_540;
  const startX = (start.lng - position.lng) * metersPerLongitudeDegree;
  const startY = (start.lat - position.lat) * metersPerLatitudeDegree;
  const endX = (end.lng - position.lng) * metersPerLongitudeDegree;
  const endY = (end.lat - position.lat) * metersPerLatitudeDegree;
  const segmentX = endX - startX;
  const segmentY = endY - startY;
  const segmentSquared = segmentX ** 2 + segmentY ** 2;
  const fraction = segmentSquared > 0
    ? clamp(-(startX * segmentX + startY * segmentY) / segmentSquared, 0, 1)
    : 0;
  const closestX = startX + segmentX * fraction;
  const closestY = startY + segmentY * fraction;
  return { fraction, distance: Math.hypot(closestX, closestY) };
}

function routeGeometry(route) {
  return (route?.geometry?.coordinates || []).map(coordinatePoint).filter(Boolean);
}

function closestRoutePosition(coordinates, position, preferredHeading = null) {
  if (coordinates.length < 2 || !position) return null;
  let closest = null;
  let distanceAlong = 0;
  let totalDistance = 0;
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const start = coordinates[index];
    const end = coordinates[index + 1];
    const segmentDistance = distanceMeters(start, end);
    const projection = projectOnSegment(position, start, end);
    const segmentHeading = bearingBetween(start, end);
    const headingDifference = Number.isFinite(preferredHeading) && Number.isFinite(segmentHeading)
      ? angularDifference(preferredHeading, segmentHeading)
      : 0;
    const directionPenalty = Number.isFinite(preferredHeading) && headingDifference > 100
      ? Math.min(120, (headingDifference - 100) * 2)
      : 0;
    const candidate = {
      distanceFromRoute: projection.distance,
      selectionDistance: projection.distance + directionPenalty,
      distanceAlong: distanceAlong + segmentDistance * projection.fraction,
      segmentIndex: index,
      fraction: projection.fraction
    };
    if (!closest || candidate.selectionDistance < closest.selectionDistance) closest = candidate;
    distanceAlong += segmentDistance;
    totalDistance += segmentDistance;
  }
  return closest ? { ...closest, totalDistance } : null;
}

export function snapPositionToRoute(route, position, maxDistance = 60) {
  if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return position;
  const coordinates = routeGeometry(route);
  const preferredHeading = Number(position.speed) >= 2.5 && Number.isFinite(Number(position.heading))
    ? Number(position.heading)
    : null;
  const nearest = closestRoutePosition(coordinates, position, preferredHeading);
  if (!nearest || nearest.distanceFromRoute > maxDistance) return position;
  const start = coordinates[nearest.segmentIndex];
  const end = coordinates[nearest.segmentIndex + 1];
  return {
    ...position,
    lat: start.lat + (end.lat - start.lat) * nearest.fraction,
    lng: start.lng + (end.lng - start.lng) * nearest.fraction,
    snappedToRoute: true
  };
}

function directionText(modifier) {
  return ({
    uturn: 'para fazer o retorno',
    'sharp right': 'acentuadamente à direita',
    right: 'à direita',
    'slight right': 'levemente à direita',
    straight: 'em frente',
    'slight left': 'levemente à esquerda',
    left: 'à esquerda',
    'sharp left': 'acentuadamente à esquerda'
  })[modifier] || '';
}

export function instructionForStep(step) {
  const maneuver = step?.maneuver || {};
  const direction = directionText(maneuver.modifier);
  const road = step?.name ? ` na ${step.name}` : '';
  switch (maneuver.type) {
    case 'depart': return step?.name ? `Siga pela ${step.name}` : 'Inicie a rota';
    case 'arrive': return 'Chegue ao destino';
    case 'turn': return `Vire${direction ? ` ${direction}` : ''}${road}`;
    case 'new name': return `Continue${road}`;
    case 'merge': return `Entre${direction ? ` ${direction}` : ''}${road}`;
    case 'on ramp': return `Pegue a entrada${direction ? ` ${direction}` : ''}${road}`;
    case 'off ramp': return `Pegue a saída${direction ? ` ${direction}` : ''}${road}`;
    case 'fork': return `Mantenha-se${direction ? ` ${direction}` : ''}${road}`;
    case 'end of road': return `No fim da via, siga${direction ? ` ${direction}` : ''}${road}`;
    case 'roundabout':
    case 'rotary': return maneuver.exit ? `Na rotatória, pegue a ${maneuver.exit}ª saída${road}` : `Entre na rotatória${road}`;
    case 'roundabout turn': return `Na rotatória, siga${direction ? ` ${direction}` : ''}${road}`;
    case 'exit roundabout':
    case 'exit rotary': return `Saia da rotatória${road}`;
    default: return `Continue${direction ? ` ${direction}` : ''}${road}`;
  }
}

export function isComplexManeuver(step) {
  const maneuver = step?.maneuver || {};
  const bearingChange = angularDifference(Number(maneuver.bearingBefore), Number(maneuver.bearingAfter));
  return COMPLEX_MANEUVER_TYPES.has(maneuver.type)
    || bearingChange >= 25
    || maneuver.modifier === 'uturn'
    || maneuver.modifier === 'sharp left'
    || maneuver.modifier === 'sharp right';
}

function bearingBetween(first, second) {
  if (!first || !second) return null;
  const lat1 = first.lat * Math.PI / 180;
  const lat2 = second.lat * Math.PI / 180;
  const longitude = (second.lng - first.lng) * Math.PI / 180;
  const y = Math.sin(longitude) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(longitude);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function angularDifference(first, second) {
  if (!Number.isFinite(first) || !Number.isFinite(second)) return Number.POSITIVE_INFINITY;
  const difference = Math.abs(first - second) % 360;
  return difference > 180 ? 360 - difference : difference;
}
function routeSteps(route, coordinates) {
  const steps = (route?.legs || []).flatMap((leg) => leg?.steps || []);
  return steps.map((step) => {
    const point = coordinatePoint(step?.maneuver?.location);
    const position = point ? closestRoutePosition(coordinates, point) : null;
    return position ? { step, distanceAlong: position.distanceAlong } : null;
  }).filter(Boolean);
}

export function buildNavigationGuidance(route, location) {
  if (!route || !location || !route.destination) return null;
  const coordinates = routeGeometry(route);
  const preferredHeading = Number(location.speed) >= 2.5 && Number.isFinite(Number(location.heading))
    ? Number(location.heading)
    : null;
  const routePosition = closestRoutePosition(coordinates, location, preferredHeading);
  const directToDestination = distanceMeters(location, route.destination);
  const routeDistance = Number.isFinite(route.distance) && route.distance > 0
    ? route.distance
    : routePosition?.totalDistance;
  const routeDuration = Number.isFinite(route.duration) && route.duration >= 0
    ? route.duration
    : (route.legs || []).reduce((total, leg) => total + (Number(leg?.duration) || 0), 0);
  const progress = routePosition?.totalDistance > 0
    ? clamp(routePosition.distanceAlong / routePosition.totalDistance, 0, 1)
    : clamp(1 - directToDestination / Math.max(1, routeDistance || directToDestination), 0, 1);
  const remainingMeters = Math.max(0, (routeDistance || directToDestination) * (1 - progress));
  const remainingSeconds = Math.max(0, routeDuration * (1 - progress));
  const threshold = Math.max(DEFAULT_OFF_ROUTE_METERS, (Number(location.accuracy) || 0) * 1.5);
  const steps = routeSteps(route, coordinates);
  const tolerance = 15;
  const next = steps.find((item) => item.distanceAlong >= (routePosition?.distanceAlong || 0) - tolerance) || steps.at(-1);
  const current = [...steps].reverse().find((item) => item.distanceAlong <= (routePosition?.distanceAlong || 0) + tolerance);
  const geometryScale = routePosition?.totalDistance > 0 && routeDistance > 0
    ? routeDistance / routePosition.totalDistance
    : 1;
  const instructionDistance = next && routePosition
    ? Math.max(0, (next.distanceAlong - routePosition.distanceAlong) * geometryScale)
    : null;
  const maneuverPoint = coordinatePoint(next?.step?.maneuver?.location);
  const routeHeading = routePosition && coordinates[routePosition.segmentIndex + 1]
    ? bearingBetween(coordinates[routePosition.segmentIndex], coordinates[routePosition.segmentIndex + 1])
    : null;
  const deviceHeading = Number(location.heading);
  const deviceSpeed = Number(location.speed);
  const headingDifference = angularDifference(deviceHeading, routeHeading);
  const directionMismatch = Boolean(
    routePosition
    && deviceSpeed >= 1
    && headingDifference > 125
    && routePosition.distanceFromRoute > Math.max(18, Number(location.accuracy) || 0)
    && (instructionDistance == null || instructionDistance > 60)
  );
  const maneuverType = next?.step?.maneuver?.type;
  const instructionReady = Boolean(next && (
    instructionDistance == null
    || instructionDistance <= 140
    || maneuverType === 'depart'
    || maneuverType === 'arrive'
  ));
  const guidanceInstruction = directionMismatch
    ? 'Reoriente-se para seguir a rota azul.'
    : steps.length === 0
      ? 'Continue pela rota até o destino'
      : instructionReady
        ? instructionForStep(next.step)
        : current?.step?.name
          ? `Siga pela ${current.step.name}`
          : next?.step?.name
            ? `Siga pela ${next.step.name}`
            : 'Siga pela rota azul.';
  const precisionMode = Boolean(next && isComplexManeuver(next.step)
    && instructionDistance <= COMPLEX_MANEUVER_RADIUS_METERS);

  return {
    arrived: directToDestination <= ARRIVAL_RADIUS_METERS,
    progress,
    remainingMeters,
    remainingSeconds,
    offRoute: Boolean((routePosition && routePosition.distanceFromRoute > threshold) || directionMismatch),
    offRouteDistance: routePosition?.distanceFromRoute ?? null,
    instruction: guidanceInstruction,
    instructionDistance,
    maneuverPoint,
    precisionMode,
    hasSteps: steps.length > 0
  };
}
