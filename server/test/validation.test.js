import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanLocation, cleanName, cleanRoomId, cleanRoute, MAX_ROUTE_COORDINATES } from '../src/validation.js';

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
