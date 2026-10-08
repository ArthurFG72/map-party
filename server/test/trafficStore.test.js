import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrafficStore } from '../src/services/trafficStore.js';

test('agrega posições recentes e precisas e calcula congestionamento', () => {
  let clock = 10_000;
  const traffic = createTrafficStore({ now: () => clock });
  for (let index = 0; index < 3; index += 1) {
    assert.equal(traffic.observe({ lat: -23.55, lng: -46.63, accuracy: 8, speed: 2, timestamp: clock }), true);
  }
  const result = traffic.evaluate({ duration: 100, geometry: { coordinates: [[-46.63, -23.55], [-46.629, -23.55]] } });
  assert.equal(result.status, 'congestion');
  assert.ok(result.adjustedDuration > 100);
});

test('ignora GPS impreciso ou leitura velha', () => {
  let clock = 10_000;
  const traffic = createTrafficStore({ now: () => clock });
  assert.equal(traffic.observe({ lat: 0, lng: 0, accuracy: 80, speed: 1, timestamp: clock }), false);
  clock += 31_000;
  assert.equal(traffic.observe({ lat: 0, lng: 0, accuracy: 5, speed: 1, timestamp: 10_000 }), false);
  assert.equal(traffic.size(), 0);
});
