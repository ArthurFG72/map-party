import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTRACT_VERSION } from '../src/contracts.js';
import {
  cleanCommandId,
  cleanLocation,
  cleanLocationSequence,
  cleanLocationUpdate,
  cleanName,
  cleanParticipantToken,
  cleanRoomId,
  cleanRoute,
  cleanRouteRevision,
  cleanRouteUpdate,
  MAX_LOCATION_FUTURE_SKEW_MS,
  MAX_ROUTE_COORDINATES,
  MAX_ROUTE_STEPS
} from '../src/validation.js';

test('sanitiza e limita nomes e ids de sala', () => {
  assert.equal(cleanName('  Ana   <script>  '), 'Ana script');
  assert.equal(cleanName('A'), null);
  assert.equal(cleanName('x'.repeat(33)), null);
  assert.equal(cleanRoomId(' Party-123 '), 'party-123');
  assert.equal(cleanRoomId('../segredo'), null);
});

test('valida coordenadas, precisão e timestamp', () => {
  assert.deepEqual(cleanLocation({ lat: -23.5, lng: -46.6, accuracy: 12, timestamp: 10, speed: 8.5, heading: 90 }), { lat: -23.5, lng: -46.6, accuracy: 12, timestamp: 10, speed: 8.5, heading: 90 });
  assert.equal(cleanLocation({ lat: 91, lng: 0, accuracy: 2 }), null);
  assert.equal(cleanLocation({ lat: 0, lng: 0, accuracy: -1 }), null);
  assert.equal(cleanLocation({ lat: '0', lng: 0, accuracy: 1 }), null);
  const now = 1_000_000;
  assert.equal(cleanLocation({ lat: 0, lng: 0, accuracy: 1, timestamp: now + MAX_LOCATION_FUTURE_SKEW_MS + 1 }, { now }), null);
});

test('aceita contrato legado e valida metadados versionados', () => {
  assert.equal(cleanCommandId('command_123'), 'command_123');
  assert.equal(cleanCommandId('curto'), null);
  assert.equal(cleanRouteRevision(0), 0);
  assert.equal(cleanRouteRevision(-1), null);
  assert.equal(cleanLocationSequence(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
  assert.equal(cleanLocationSequence(1.5), null);
  assert.equal(cleanParticipantToken('participant_token_abcdefghijklmnopqrstuvwxyz_123456'), 'participant_token_abcdefghijklmnopqrstuvwxyz_123456');
  assert.equal(cleanParticipantToken('token-curto'), null);
  assert.equal(cleanParticipantToken('x'.repeat(257)), null);

  const legacy = cleanLocationUpdate({ lat: 1, lng: 2, accuracy: 3 });
  assert.equal(legacy.contractVersion, CONTRACT_VERSION);
  assert.equal(legacy.locationSequence, null);
  assert.equal(cleanLocationUpdate({ contractVersion: 999, lat: 1, lng: 2, accuracy: 3 }), null);
  assert.equal(cleanLocationUpdate({ contractVersion: CONTRACT_VERSION, locationSequence: -1, lat: 1, lng: 2, accuracy: 3 }), null);
});

test('aceita somente rota GeoJSON LineString dentro dos limites', () => {
  const route = cleanRoute({
    origin: { lat: 0, lng: 0, label: ' Praça Central ', source: 'search' }, destination: { lat: 1, lng: 1 },
    geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
    distance: 1000, duration: 120
  });
  assert.equal(route.geometry.type, 'LineString');
  assert.equal(route.distance, 1000);
  assert.equal(route.origin.label, 'Praça Central');
  assert.equal(cleanRoute({ ...route, origin: { lat: 0, lng: 0, source: 'arquivo' } }), null);
  assert.equal(cleanRoute({ ...route, geometry: { type: 'Point', coordinates: [0, 0] } }), null);
  assert.equal(cleanRoute({ ...route, distance: -1 }), null);
  const excessiveCoordinates = Array.from({ length: MAX_ROUTE_COORDINATES + 1 }, () => [0, 0]);
  assert.equal(cleanRoute({ ...route, geometry: { type: 'LineString', coordinates: excessiveCoordinates } }), null);
});

test('normaliza steps e limita comandos e tamanho da rota versionada', () => {
  const base = {
    contractVersion: CONTRACT_VERSION,
    commandId: 'route_command_123',
    routeRevision: 0,
    origin: { lat: 0, lng: 0, source: 'poi' },
    destination: { lat: 1, lng: 1 },
    geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
    distance: 1000,
    duration: 120,
    legs: [{
      distance: 1000,
      duration: 120,
      summary: ' Centro ',
      steps: [{
        distance: 1000,
        duration: 120,
        name: ' Avenida Central ',
        mode: 'driving',
        maneuver: { type: 'turn', modifier: 'right', location: [0.5, 0.5], bearingBefore: 10.4, bearingAfter: 90.2 }
      }]
    }]
  };
  const update = cleanRouteUpdate(base);
  assert.equal(update.commandId, 'route_command_123');
  assert.equal(update.routeRevision, 0);
  assert.equal(update.route.origin.source, 'poi');
  assert.equal(update.route.legs[0].summary, 'Centro');
  assert.equal(update.route.legs[0].steps[0].maneuver.bearingAfter, 90);

  assert.equal(cleanRouteUpdate({ ...base, commandId: '../invalid' }), null);
  assert.equal(cleanRouteUpdate({ ...base, routeRevision: 1.5 }), null);
  assert.equal(cleanRoute({ ...base, contractVersion: 2 }), null);
  assert.equal(cleanRoute({
    ...base,
    legs: [{ ...base.legs[0], steps: Array.from({ length: MAX_ROUTE_STEPS + 1 }, () => base.legs[0].steps[0]) }]
  }), null);
  assert.equal(cleanRoute({
    ...base,
    legs: [{ ...base.legs[0], steps: [{ ...base.legs[0].steps[0], maneuver: { type: 'teleport', location: [0, 0] } }] }]
  }), null);
});
