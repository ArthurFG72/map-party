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

test('local transport preserves distinct direct messages while offline', async () => {
  const transport = createLocalTransport({ roomId: 'ABCD' });
  await transport.send({ type: 'direct-message', messageId: 'm-1', text: 'um' });
  await transport.send({ type: 'direct-message', messageId: 'm-2', text: 'dois' });
  assert.deepEqual(transport.takeQueue().map(({ messageId, text }) => ({ messageId, text })), [
    { messageId: 'm-1', text: 'um' },
    { messageId: 'm-2', text: 'dois' }
  ]);
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
  listener({ type: 'connectionVerification', endpointId: 'peer-1', authenticationToken: '123' });
  listener({ type: 'status', status: 'connected' });
  listener({ type: 'message', message: { roomId: 'room-a', type: 'location', lat: 3 } });
  assert.deepEqual(received.map(({ lat }) => lat), [3]);
  assert.deepEqual(statuses, ['started', 'connected']);
  await transport.verifyConnection('peer-1', true);
  assert.deepEqual(verifications, [
    { type: 'connectionVerification', endpointId: 'peer-1', authenticationToken: '123' },
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
    send: async (message) => { sent.push(message); return true; }
  };
  const transport = createLocalTransport({ roomId: 'room-a' });
  await transport.start();
  assert.equal(await transport.send({ roomId: 'room-b', type: 'location' }), false);
  assert.equal(await transport.send({ roomId: 'room-a', type: 'location', lat: 4 }), true);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], {
    roomId: 'room-a',
    type: 'location',
    lat: 4,
    messageId: sent[0].messageId,
    createdAt: sent[0].createdAt,
    expiresAt: sent[0].expiresAt,
    hops: 0
  });
  assert.match(sent[0].messageId, /^local-/);
  assert.ok(sent[0].expiresAt > sent[0].createdAt);
  await transport.stop();
  delete globalThis.MapPartyLocalTransport;
});

test('native transport updates its Nearby identity after the server assigns the participant id', async () => {
  const starts = [];
  globalThis.MapPartyLocalTransport = {
    start: async (options) => starts.push(options),
    stop: async () => undefined
  };
  const transport = createLocalTransport({ roomId: 'room-a', participantId: 'display-name' });
  await transport.start();
  assert.equal(await transport.setIdentity('participant-uuid'), true);
  assert.deepEqual(starts.map(({ roomId, participantId }) => ({ roomId, participantId })), [
    { roomId: 'room-a', participantId: 'display-name' },
    { roomId: 'room-a', participantId: 'participant-uuid' }
  ]);
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

test('native envelope enforces the 16 KB payload boundary', async () => {
  const transport = createLocalTransport({ roomId: 'room-a' });
  await transport.send({ type: 'route-share', messageId: 'near-limit', text: 'x'.repeat(15_000) });
  await transport.send({ type: 'route-share', messageId: 'too-large', text: 'x'.repeat(17_000) });
  const queued = transport.takeQueue();
  assert.deepEqual(queued.map(({ messageId }) => messageId), ['near-limit']);
});

test('native transport envelopes, deduplicates and expires local messages', async () => {
  let listener;
  const sent = [];
  globalThis.MapPartyLocalTransport = {
    start: async () => undefined,
    stop: async () => undefined,
    subscribe: (callback) => { listener = callback; return () => { listener = undefined; }; },
    send: async (message) => { sent.push(message); return true; }
  };
  const received = [];
  const transport = createLocalTransport({ roomId: 'room-a', onMessage: (message) => received.push(message) });
  await transport.start();
  await transport.send({ type: 'direct-message', text: 'oi' });
  assert.equal(sent[0].roomId, 'room-a');
  assert.match(sent[0].messageId, /^local-/);
  assert.equal(sent[0].hops, 0);
  listener({ type: 'message', roomId: 'room-a', messageId: 'same', type: 'location', lat: 1, expiresAt: Date.now() + 10_000 });
  listener({ type: 'message', roomId: 'room-a', messageId: 'same', type: 'location', lat: 2, expiresAt: Date.now() + 10_000 });
  listener({ type: 'message', roomId: 'room-a', messageId: 'expired', type: 'location', lat: 3, expiresAt: Date.now() - 1 });
  assert.deepEqual(received.map(({ lat }) => lat), [1]);
  await transport.stop();
  delete globalThis.MapPartyLocalTransport;
});

test('native false send is queued for a later connection', async () => {
  globalThis.MapPartyLocalTransport = {
    start: async () => undefined,
    stop: async () => undefined,
    send: async () => false
  };
  const transport = createLocalTransport({ roomId: 'room-a' });
  await transport.start();
  assert.equal(await transport.send({ type: 'location', lat: 7 }), false);
  assert.equal(transport.takeQueue()[0].lat, 7);
  await transport.stop();
  delete globalThis.MapPartyLocalTransport;
});

test('native sends without an explicit success keep messages queued', async () => {
  globalThis.MapPartyLocalTransport = {
    start: async () => undefined,
    stop: async () => undefined,
    send: async () => undefined
  };
  const transport = createLocalTransport({ roomId: 'room-a' });
  await transport.start();
  assert.equal(await transport.send({ type: 'location', lat: 8 }), false);
  assert.equal(transport.takeQueue()[0].lat, 8);
  await transport.stop();
  delete globalThis.MapPartyLocalTransport;
});

test('queue flush retains messages when native transport reports no send', async () => {
  let listener;
  let accepted = false;
  globalThis.MapPartyLocalTransport = {
    start: async () => undefined,
    stop: async () => undefined,
    subscribe: (callback) => { listener = callback; return () => { listener = undefined; }; },
    send: async () => accepted
  };
  const transport = createLocalTransport({ roomId: 'room-a' });
  await transport.start();
  await transport.send({ type: 'route', revision: 3 });
  listener({ type: 'connected' });
  await new Promise((resolve) => setImmediate(resolve));
  const retained = transport.takeQueue();
  assert.equal(retained.length, 1);
  assert.equal(await transport.send(retained[0]), false);
  accepted = true;
  listener({ type: 'connected' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(transport.takeQueue().length, 0);
  await transport.stop();
  delete globalThis.MapPartyLocalTransport;
});
