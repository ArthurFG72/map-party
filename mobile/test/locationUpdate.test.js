import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocationUpdate } from '../src/locationUpdate.js';
import { classifyMovement, stabilizePosition } from '../src/locationStabilization.js';

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

test('zera velocidade mesmo quando o sistema repete um speed alto após a parada', () => {
  const stable = stabilizePosition(
    { lat: -23.55, lng: -46.63, accuracy: 10, timestamp: 1_000, speed: 18 / 3.6 },
    { lat: -23.550001, lng: -46.630001, accuracy: 10, timestamp: 3_000, speed: 18 / 3.6 }
  );
  assert.equal(stable.speed, 0);
});

test('descarta leitura GPS fora de ordem sem mover o marcador', () => {
  const stable = stabilizePosition(
    { lat: -23.55, lng: -46.63, accuracy: 8, timestamp: 2_000, speed: 0 },
    { lat: -23.5505, lng: -46.6305, accuracy: 8, timestamp: 1_000, speed: 20 }
  );
  assert.equal(stable, null);
});

test('descarta salto quilométrico ao iniciar navegação com o aparelho parado', () => {
  const stable = stabilizePosition(
    { lat: -23.55, lng: -46.63, accuracy: 8, timestamp: 10_000, speed: 0 },
    { lat: -23.532, lng: -46.63, accuracy: 8, timestamp: 12_000, speed: 0 }
  );
  assert.equal(stable, null);
});

test('não congela deslocamento real só porque o GPS informou velocidade residual baixa', () => {
  const stable = stabilizePosition(
    { lat: -23.55, lng: -46.63, accuracy: 5, timestamp: 1_000, speed: 0 },
    { lat: -23.55002, lng: -46.63002, accuracy: 5, timestamp: 2_000, speed: 0.2 }
  );
  assert.notEqual(stable, null);
  assert.equal(stable.lat, -23.55002);
});

test('descarta pequeno movimento fantasma que contradiz duas leituras paradas', () => {
  const stable = stabilizePosition(
    { lat: -23.55, lng: -46.63, accuracy: 5, timestamp: 1_000, speed: 0 },
    { lat: -23.5502, lng: -46.6302, accuracy: 5, timestamp: 3_000, speed: 0 }
  );
  assert.equal(stable, null);
});

test('descarta deriva iOS curta entre duas leituras paradas', () => {
  const stable = stabilizePosition(
    { lat: -23.55, lng: -46.63, accuracy: 10, timestamp: 1_000, speed: 0 },
    { lat: -23.54991, lng: -46.63, accuracy: 10, timestamp: 5_000, speed: 0 }
  );
  assert.equal(stable.lat, -23.55);
  assert.equal(stable.lng, -46.63);
  assert.equal(stable.speed, 0);
  assert.equal(stable.timestamp, 5_000);
});

test('não reaproveita velocidade antiga quando o deslocamento medido é menor', () => {
  const stable = stabilizePosition(
    { lat: -23.55, lng: -46.63, accuracy: 5, timestamp: 1_000, speed: 20 },
    { lat: -23.55018, lng: -46.63, accuracy: 5, timestamp: 11_000, speed: 20 }
  );
  assert.notEqual(stable, null);
  assert.ok(stable.speed < 3, `speed calculado: ${stable.speed}`);
});

test('aceita movimento lento depois de duas leituras coerentes', () => {
  const first = { lat: -23.55, lng: -46.63, accuracy: 5, timestamp: 1_000 };
  const second = { lat: -23.549982, lng: -46.63, accuracy: 5, timestamp: 3_000 };
  const third = { lat: -23.549964, lng: -46.63, accuracy: 5, timestamp: 5_000 };
  const one = classifyMovement(first, second, 0);
  const two = classifyMovement(second, third, one.score);
  assert.equal(one.moving, true);
  assert.equal(one.confirmed, false);
  assert.equal(two.confirmed, true);
  assert.ok(two.speed > 0.5 && two.speed < 2);
});

test('não transforma uma deriva lenta isolada em velocidade', () => {
  const stable = classifyMovement(
    { lat: -23.55, lng: -46.63, accuracy: 5, timestamp: 1_000 },
    { lat: -23.549982, lng: -46.63, accuracy: 5, timestamp: 5_000 },
    0
  );
  assert.equal(stable.moving, false);
  assert.equal(stable.confirmed, false);
  assert.equal(stable.speed, 0);
});
