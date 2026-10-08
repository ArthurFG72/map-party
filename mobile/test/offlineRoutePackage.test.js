import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfflineRoutePackage, prepareOfflineRoutePackageForStorage, validateOfflineRoutePackage } from '../src/offlineRoutePackage.js';

const graph = { version: 1, id: 'route-1', nodes: [{ lat: -23.55, lng: -46.63, edges: [{ to: 1, distance: 100 }] }, { lat: -23.551, lng: -46.631, edges: [] }] };
const route = { geometry: { coordinates: [[-46.63, -23.55], [-46.631, -23.551]] } };

test('accepts a graph only when bound to a valid route corridor', () => {
  assert.equal(validateOfflineRoutePackage({ version: 1, id: 'route-1', route, graph }).graph.id, 'route-1');
});

test('rejects a package whose graph identity differs from its manifest', () => {
  assert.equal(validateOfflineRoutePackage({ version: 1, id: 'other', route, graph }), null);
});

test('builds a bounded local graph from a calculated route', () => {
  const generated = createOfflineRoutePackage(route);
  assert.equal(generated.graph.nodes.length, 2);
  assert.equal(validateOfflineRoutePackage(generated).id, generated.id);
});

test('prefers a graph OSM recebido quando sua identidade corresponde a rota', () => {
  const base = createOfflineRoutePackage(route);
  const osmGraph = { version: 1, id: base.id, nodes: [
    { lat: -23.55, lng: -46.63, edges: [{ to: 1, distance: 50 }] },
    { lat: -23.5505, lng: -46.6305, edges: [{ to: 0, distance: 50 }] }
  ] };
  const packaged = createOfflineRoutePackage({ ...route, offlineGraph: osmGraph });
  assert.equal(packaged.graph.nodes[0].edges[0].distance, 50);
});

test('prepares the complete route package for bounded storage', () => {
  const generated = createOfflineRoutePackage(route);
  const stored = prepareOfflineRoutePackageForStorage(generated);
  assert.deepEqual(stored.route.geometry.coordinates, generated.route.geometry.coordinates);
  assert.equal(stored.graph.id, generated.id);
  assert.equal(validateOfflineRoutePackage(stored).id, generated.id);
});
