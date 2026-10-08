import assert from "node:assert/strict";
import test from "node:test";
import { calculateOfflineRoute } from "../src/offlineRouter.js";

const graph = { nodes: [
  { lat: 0, lng: 0, edges: [{ to: 1, distance: 10 }, { to: 2, distance: 50 }] },
  { lat: 0, lng: 0.001, edges: [{ to: 2, distance: 10 }] },
  { lat: 0, lng: 0.002, edges: [] }
] };

test("roteia localmente pelo menor caminho", () => {
  const route = calculateOfflineRoute(graph, { lat: 0, lng: 0 }, { lat: 0, lng: 0.002 });
  assert.deepEqual(route.coordinates, [[0, 0], [0.001, 0], [0.002, 0]]);
  assert.equal(route.distance, 20);
});

test("limita trabalho em aparelhos de baixo recurso", () => {
  assert.equal(calculateOfflineRoute(graph, { lat: 0, lng: 0 }, { lat: 0, lng: 0.002 }, { maxVisited: 1 }), null);
});