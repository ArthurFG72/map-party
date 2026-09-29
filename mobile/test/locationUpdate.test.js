import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocationUpdate } from '../src/locationUpdate.js';
import { stabilizePosition } from '../src/locationStabilization.js';

test('usa o contrato de localização que o servidor valida no primeiro nível', () => {
  const update = createLocationUpdate({ lat: -23.55, lng: -46.63, accuracy: 8, timestamp: 123 }, 456);
  assert.deepEqual(update, {
    lat: -23.55,
    lng: -46.63,
    accuracy: 8,
    timestamp: 123,
    contractVersion: 1,
    locationSequence: 456
  });
  assert.equal('location' in update, false);
});

test('zera velocidade GPS residual quando o iOS permanece dentro do raio estacionário', () => {
  const stable = stabilizePosition(
    { lat: -23.55, lng: -46.63, accuracy: 10, timestamp: 1_000, speed: 0 },
    { lat: -23.550001, lng: -46.630001, accuracy: 10, timestamp: 3_000, speed: 6 / 3.6 }
  );
  assert.equal(stable.speed, 0);
});
