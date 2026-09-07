import test from 'node:test';
import assert from 'node:assert/strict';
import { buildParticipantRouteStatus, routeFromNavigationRerouted } from '../src/partyNavigation.js';

const sharedRoute = {
  destination: { lat: 0, lng: 0.01 },
  geometry: { type: 'LineString', coordinates: [[0, 0], [0.01, 0]] },
  distance: 1000,
  duration: 100
};
const personalRoute = {
  ...sharedRoute,
  geometry: { type: 'LineString', coordinates: [[0, 0], [0.005, 0.001], [0.01, 0]] },
  duration: 120
};

test('aceita apenas a rota pessoal destinada ao participante atual', () => {
  assert.equal(routeFromNavigationRerouted({ participantId: 'self', route: personalRoute }, 'self'), personalRoute);
  assert.equal(routeFromNavigationRerouted({ participantId: 'other', route: personalRoute }, 'self'), null);
  assert.equal(sharedRoute.duration, 100, 'a rota compartilhada permanece intacta');
});

test('calcula ETA e idade da última atualização do participante', () => {
  const status = buildParticipantRouteStatus({
    location: { lat: 0, lng: 0.005, accuracy: 5, timestamp: 9_000 }
  }, sharedRoute, 10_000);
  assert.ok(status.etaSeconds > 45 && status.etaSeconds < 55);
  assert.equal(status.lastUpdateAgeMs, 1_000);
});
