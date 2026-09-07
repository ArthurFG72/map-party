import test from 'node:test';
import assert from 'node:assert/strict';
import { io as createClient } from 'socket.io-client';
import { createApp } from '../src/app.js';

async function startServer() {
  const instance = createApp({ origin: '*' });
  await new Promise((resolve) => instance.httpServer.listen(0, '127.0.0.1', resolve));
  const port = instance.httpServer.address().port;
  const connect = () => new Promise((resolve, reject) => {
    const socket = createClient(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
  return { ...instance, connect };
}

const emitAck = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));
const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve));

test('participantes entram, recebem localização e sala vazia é removida', async (t) => {
  const server = await startServer();
  const clients = [];
  t.after(async () => {
    clients.forEach((client) => client.disconnect());
    await new Promise((resolve) => server.io.close(resolve));
  });
  const ana = await server.connect(); const bia = await server.connect(); clients.push(ana, bia);
  const joinedAna = await emitAck(ana, 'join-party', { roomId: 'grupo-1', name: 'Ana' });
  assert.equal(joinedAna.ok, true);
  const snapshotPromise = once(ana, 'participants-snapshot');
  const joinedBia = await emitAck(bia, 'join-party', { roomId: 'grupo-1', name: 'Bia' });
  assert.equal(joinedBia.snapshot.participants.length, 2);
  assert.equal((await snapshotPromise).participants.length, 2);

  const locationPromise = once(bia, 'participant-location');
  const locationAck = await emitAck(ana, 'send-location', { lat: -23.5, lng: -46.6, accuracy: 8, socketId: bia.id });
  const locationEvent = await locationPromise;
  assert.equal(locationAck.ok, true);
  assert.equal(locationEvent.participantId, ana.id, 'servidor ignora socketId informado pelo cliente');

  const afterDisconnect = once(ana, 'participants-snapshot');
  bia.disconnect();
  assert.equal((await afterDisconnect).participants.length, 1);
  ana.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(server.store.rooms.size, 0);
});

test('rota sincroniza somente após join e payload válido', async (t) => {
  const server = await startServer();
  const client = await server.connect();
  t.after(async () => { client.disconnect(); await new Promise((resolve) => server.io.close(resolve)); });
  const payload = {
    origin: { lat: -23.5, lng: -46.6 }, destination: { lat: -23.6, lng: -46.7 },
    geometry: { type: 'LineString', coordinates: [[-46.6, -23.5], [-46.7, -23.6]] },
    distance: 1500, duration: 300
  };
  assert.equal((await emitAck(client, 'update-route', payload)).ok, false);
  assert.equal((await emitAck(client, 'join-party', { roomId: 'grupo-2', name: 'Caio' })).ok, true);
  const eventPromise = once(client, 'route-updated');
  const routeAck = await emitAck(client, 'update-route', payload);
  assert.equal(routeAck.ok, true);
  assert.equal(routeAck.route.revision, 1);
  const publishedRoute = await eventPromise;
  assert.equal(publishedRoute.geometry.type, 'LineString');
  assert.equal(publishedRoute.updatedBy.name, 'Caio');
  assert.equal((await emitAck(client, 'send-location', { lat: 200, lng: 0, accuracy: 1 })).ok, false);
});

test('retry de join é idempotente e preserva localização e rota', async (t) => {
  const server = await startServer();
  const client = await server.connect();
  t.after(async () => { client.disconnect(); await new Promise((resolve) => server.io.close(resolve)); });
  const route = {
    origin: { lat: -23.5, lng: -46.6 }, destination: { lat: -23.6, lng: -46.7 },
    geometry: { type: 'LineString', coordinates: [[-46.6, -23.5], [-46.7, -23.6]] },
    distance: 1500, duration: 300
  };
  assert.equal((await emitAck(client, 'join-party', { roomId: 'retry-room', name: 'Dani' })).ok, true);
  assert.equal((await emitAck(client, 'send-location', { lat: -23.5, lng: -46.6, accuracy: 7 })).ok, true);
  assert.equal((await emitAck(client, 'update-route', route)).ok, true);

  const retried = await emitAck(client, 'join-party', { roomId: 'retry-room', name: 'Dani' });
  assert.equal(retried.ok, true);
  assert.equal(retried.snapshot.participants.length, 1);
  assert.equal(retried.snapshot.participants[0].location.accuracy, 7);
  assert.equal(retried.snapshot.route.distance, 1500);
});

test('troca de sala publica snapshot atualizado na sala anterior', async (t) => {
  const server = await startServer();
  const ana = await server.connect(); const bia = await server.connect();
  t.after(async () => { ana.disconnect(); bia.disconnect(); await new Promise((resolve) => server.io.close(resolve)); });
  await emitAck(ana, 'join-party', { roomId: 'sala-antiga', name: 'Ana' });
  await emitAck(bia, 'join-party', { roomId: 'sala-antiga', name: 'Bia' });

  const oldRoomUpdate = once(bia, 'participants-snapshot');
  const switched = await emitAck(ana, 'join-party', { roomId: 'sala-nova', name: 'Ana' });
  assert.equal(switched.ok, true);
  assert.equal(switched.snapshot.participants.length, 1);
  const oldSnapshot = await oldRoomUpdate;
  assert.deepEqual(oldSnapshot.participants.map((item) => item.name), ['Bia']);
  assert.equal(server.store.snapshot('sala-antiga').participants.length, 1);
  assert.equal(server.store.snapshot('sala-nova').participants.length, 1);
});

test('aplica capacidade da sala e rate limit de localização por socket', async (t) => {
  const server = await startServer();
  server.store.maxRoomParticipants = 1;
  const first = await server.connect(); const second = await server.connect();
  t.after(async () => { first.disconnect(); second.disconnect(); await new Promise((resolve) => server.io.close(resolve)); });
  assert.equal((await emitAck(first, 'join-party', { roomId: 'sala-cheia', name: 'Eva' })).ok, true);
  assert.equal((await emitAck(second, 'join-party', { roomId: 'sala-cheia', name: 'Fê' })).ok, false);
  for (let index = 0; index < 30; index += 1) {
    assert.equal((await emitAck(first, 'send-location', { lat: 0, lng: 0, accuracy: 1 })).ok, true);
  }
  const limited = await emitAck(first, 'send-location', { lat: 0, lng: 0, accuracy: 1 });
  assert.equal(limited.ok, false);
  assert.match(limited.error, /Muitas atualizações/);
});
