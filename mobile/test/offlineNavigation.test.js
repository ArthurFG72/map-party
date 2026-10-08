import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePackagedOfflineRoute, pointIsCovered } from '../src/offlineNavigation.js';

const route = { geometry: { coordinates: [[-46.64, -23.55], [-46.63, -23.55], [-46.62, -23.55]] } };
const graph = {
  version: 1,
  id: 'sao-paulo-corridor',
  nodes: [
    { lat: -23.55, lng: -46.64, edges: [{ to: 1, distance: 1000 }] },
    { lat: -23.55, lng: -46.63, edges: [{ to: 2, distance: 1000 }] },
    { lat: -23.55, lng: -46.62, edges: [] },
  ],
};
const offlinePackage = { version: 1, id: 'sao-paulo-corridor', route, graph, coverage: { corridorMeters: 3000 } };

test('calculates using only a package already stored on device', () => {
  const result = calculatePackagedOfflineRoute(offlinePackage, { lat: -23.55, lng: -46.64 }, { lat: -23.55, lng: -46.62 });
  assert.equal(result.ok, true);
  assert.equal(result.route.offline, true);
  assert.equal(result.route.distance, 2000);
});

test('does not calculate beyond the downloaded corridor', () => {
  const result = calculatePackagedOfflineRoute(offlinePackage, { lat: -23.55, lng: -46.64 }, { lat: -22.9, lng: -46.62 });
  assert.deepEqual(result, { ok: false, code: 'OUTSIDE_OFFLINE_CORRIDOR' });
});

test('coverage accepts coordinates within a route segment', () => {
  const result = calculatePackagedOfflineRoute(offlinePackage, { lat: -23.55, lng: -46.64 }, { lat: -23.55, lng: -46.62 });
  assert.equal(pointIsCovered({ segments: [{ bounds: { minLongitude: -47, maxLongitude: -46, minLatitude: -24, maxLatitude: -23 } }] }, { lat: -23.5, lng: -46.5 }), true);
  assert.equal(result.ok, true);
});
