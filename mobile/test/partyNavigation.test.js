import test from 'node:test';
import assert from 'node:assert/strict';
import { buildParticipantRouteStatus, preserveRouteEndpoints, routeFromNavigationRerouted } from '../src/partyNavigation.js';
import { buildReturnPoints } from '../src/routeReturn.js';

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


test('preserva origem e destino ao recalcular a geometria', () => {
  const originalOrigin = { lat: -23.55, lng: -46.63, label: 'Saida' };
  const destination = { lat: -23.56, lng: -46.64, label: 'Destino' };
  const currentPosition = { lat: -23.555, lng: -46.635, label: 'Local atual' };
  const rerouted = preserveRouteEndpoints({
    ...sharedRoute,
    origin: currentPosition,
    destination,
    geometry: { type: 'LineString', coordinates: [[-46.635, -23.555], [-46.64, -23.56]] }
  }, originalOrigin, destination, currentPosition);
  assert.deepEqual(rerouted.origin, originalOrigin);
  assert.deepEqual(rerouted.destination, destination);
  assert.deepEqual(rerouted.reroutedFrom, currentPosition);
  assert.deepEqual(rerouted.geometry.coordinates[0], [-46.635, -23.555]);
});

test('retorno usa a origem concluída como destino e a posição atual como origem', () => {
  const points = buildReturnPoints(
    { origin: { lat: -23.55, lng: -46.63, label: 'Partida' }, destination: { lat: -23.56, lng: -46.64 } },
    { lat: -23.57, lng: -46.65 }
  );
  assert.deepEqual(points.origin, { lat: -23.57, lng: -46.65, label: 'Minha localização atual', source: 'geolocation' });
  assert.deepEqual(points.destination, { lat: -23.55, lng: -46.63, label: 'Partida' });
});
