import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfflineGraphService, normalizeOfflineGraphRequest } from '../src/services/offlineGraphService.js';

const geometry = { type: 'LineString', coordinates: [[-49.27, -25.43], [-49.269, -25.429]] };

test('grafo offline normaliza corredor e rejeita rota grande', () => {
  const normalized = normalizeOfflineGraphRequest({ geometry, id: 'route-a' });
  assert.equal(normalized.id, 'route-a');
  assert.ok(normalized.bbox[0] < -49.27);
  assert.equal(normalizeOfflineGraphRequest({ geometry: { type: 'LineString', coordinates: Array.from({ length: 257 }, () => [-49, -25]) } }), null);
});

test('serviço offline transforma ways OSM em grafo bidirecional limitado', async () => {
  const service = createOfflineGraphService({
    fetchImpl: async () => ({ ok: true, json: async () => ({ elements: [
      { type: 'way', id: 1, nodes: [10, 11, 12], tags: { highway: 'residential' } },
      { type: 'node', id: 10, lat: -25.43, lon: -49.27 },
      { type: 'node', id: 11, lat: -25.4305, lon: -49.2695 },
      { type: 'node', id: 12, lat: -25.431, lon: -49.269 }
    ] })
  })
  });
  const graph = await service.build({ geometry, id: 'route-a' });
  assert.equal(graph.source, 'osm-overpass');
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.nodes[0].edges[0].to, 1);
  assert.ok(graph.nodes[1].edges.some((edge) => edge.to === 0));
});
