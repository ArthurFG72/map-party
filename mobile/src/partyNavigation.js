import { buildNavigationGuidance } from './navigationGuidance.js';

function validRoute(route) {
  return route?.geometry?.type === 'LineString'
    && Array.isArray(route.geometry.coordinates)
    && route.geometry.coordinates.length > 1
    && route?.destination;
}

export function routeFromNavigationRerouted(payload, participantId) {
  const targetParticipantId = payload?.participantId ?? payload?.targetParticipantId;
  if (targetParticipantId && participantId && targetParticipantId !== participantId) return null;
  const route = payload?.route ?? payload?.personalRoute ?? payload;
  return validRoute(route) ? route : null;
}

export function buildParticipantRouteStatus(participant, route, now = Date.now()) {
  const location = participant?.location;
  const updatedAt = Number(location?.serverReceivedAt ?? location?.timestamp ?? participant?.lastSeenAt);
  const guidance = location && route ? buildNavigationGuidance(route, location) : null;
  return {
    etaSeconds: Number.isFinite(guidance?.remainingSeconds) ? guidance.remainingSeconds : null,
    lastUpdateAgeMs: Number.isFinite(updatedAt) ? Math.max(0, now - updatedAt) : null
  };
}
