import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalTransport, MAX_QUEUE } from '../src/localTransport.js';

test('local transport keeps only the latest message of each type offline', async () => {
  const transport = createLocalTransport({ roomId: 'ABCD' });
  assert.equal(await transport.start(), 'unavailable');
  assert.equal(await transport.send({ type: 'location', lat: 1 }), false);
  assert.equal(await transport.send({ type: 'location', lat: 2 }), false);
  assert.equal(await transport.send({ type: 'route', revision: 1 }), false);
  assert.deepEqual(transport.takeQueue().map(({ type, lat, revision }) => ({ type, lat, revision })), [
    { type: 'location', lat: 2, revision: undefined },
    { type: 'route', lat: undefined, revision: 1 }
  ]);
  await transport.stop();
});

test('local transport preserves SOS packets with different ciphertexts', async () => {
  const transport = createLocalTransport({ roomId: 'ABCD' });
  await transport.send({ type: 'emergency', packet: { ciphertext: 'one' } });
  await transport.send({ type: 'emergency', packet: { ciphertext: 'two' } });
  await transport.send({ type: 'emergency', packet: { ciphertext: 'one' } });
  assert.deepEqual(transport.takeQueue().map((item) => item.packet.ciphertext), ['two', 'one']);
});

test('local transport ignores messages from other rooms', async () => {
  let listener;
  globalThis.MapPartyLocalTransport = {
    start: async () => undefined,
    stop: async () => undefined,
    onMessage: (callback) => {
      listener = callback;
      return () => { listener = undefined; };
    }
  };
  const received = [];
  const transport = createLocalTransport({ roomId: 'room-a', onMessage: (message) => received.push(message) });

  assert.equal(await transport.start(), 'available');
  listener({ roomId: 'room-b', type: 'location', lat: 1 });
  listener({ roomId: 'room-a', type: 'location', lat: 2 });

  assert.deepEqual(received.map((message) => message.lat), [2]);
  await transport.stop();
  delete globalThis.MapPartyLocalTransport;
});

test('native transport subscribes to events and forwards verification/status', async () => {
  let listener;
  const statuses = [];
  const verifications = [];
  const received = [];
  globalThis.MapPartyLocalTransport = {
    start: async () => undefined,
    stop: async () => undefined,
    subscribe: (callback) => { listener = callback; return () => { listener = undefined; }; },
    send: async () => undefined,
    verifyConnection: async (request) => verifications.push(request)
  };
  const transport = createLocalTransport({
    roomId: 'room-a',
    onMessage: (message) => received.push(message),
    onStatus: (status) => statuses.push(status),
    onVerification: (event) => verifications.push(event)
  });
  assert.equal(await transport.start(), 'available');
  listener({ type: 'verificationRequired', endpointId: 'peer-1', token: '123' });
  listener({ type: 'status', status: 'connected' });
  listener({ type: 'message', message: { roomId: 'room-a', type: 'location', lat: 3 } });
  assert.deepEqual(received.map(({ lat }) => lat), [3]);
  assert.deepEqual(statuses, ['started', 'connected']);
  await transport.verifyConnection('peer-1', true);
  assert.deepEqual(verifications, [
    { type: 'verificationRequired', endpointId: 'peer-1', token: '123' },
    { endpointId: 'peer-1', accepted: true }
  ]);
  await transport.stop();
  delete globalThis.MapPartyLocalTransport;
});

test('native transport filters foreign rooms before sending', async () => {
  const sent = [];
  globalThis.MapPartyLocalTransport = {
    start: async () => undefined,
    stop: async () => undefined,
    send: async (message) => sent.push(message)
  };
  const transport = createLocalTransport({ roomId: 'room-a' });
  await transport.start();
  assert.equal(await transport.send({ roomId: 'room-b', type: 'location' }), false);
  assert.equal(await transport.send({ roomId: 'room-a', type: 'location', lat: 4 }), true);
  assert.deepEqual(sent, [{ roomId: 'room-a', type: 'location', lat: 4 }]);
  await transport.stop();
  delete globalThis.MapPartyLocalTransport;
});

test('offline queue is bounded', async () => {
  const transport = createLocalTransport({ roomId: 'room-a' });
  for (let index = 0; index < MAX_QUEUE + 5; index += 1) {
    await transport.send({ type: `message-${index}` });
  }
  assert.equal(transport.takeQueue().length, MAX_QUEUE);
});
