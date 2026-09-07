import test from 'node:test';
import assert from 'node:assert/strict';
import { io as createClient } from 'socket.io-client';
import { createApp } from '../src/app.js';

function calculatedRoute({ origin, destination }) {
  return {
    contractVersion: 1,
    origin,
    destination,
    geometry: { type: 'LineString', coordinates: [[origin.lng, origin.lat], [destination.lng, destination.lat]] },
    distance: 1500,
    duration: 300,
    legs: [{
      distance: 1500,
      duration: 300,
      steps: [{
        distance: 1500,
        duration: 300,
        name: 'Rota calculada',
        mode: 'driving',
        maneuver: { type: 'turn', modifier: 'right', location: [origin.lng, origin.lat] }
      }]
    }]
  };
}

async function startServer(options = {}) {
  const routeService = options.routeService || { calculate: async (request) => calculatedRoute(request) };
  const instance = createApp({ origin: '*', ...options, routeService });
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
  assert.equal(joinedAna.contractVersion, 1);
  assert.equal(joinedAna.snapshot.contractVersion, 1);
  const snapshotPromise = once(ana, 'participants-snapshot');
  const joinedBia = await emitAck(bia, 'join-party', { roomId: 'grupo-1', name: 'Bia' });
  assert.equal(joinedBia.snapshot.participants.length, 2);
  assert.equal((await snapshotPromise).participants.length, 2);

  const locationPromise = once(bia, 'participant-location');
  const locationAck = await emitAck(ana, 'send-location', { lat: -23.5, lng: -46.6, accuracy: 8, socketId: bia.id });
  const locationEvent = await locationPromise;
  assert.equal(locationAck.ok, true);
  assert.equal(locationEvent.participantId, ana.id, 'servidor ignora socketId informado pelo cliente');
  assert.equal(locationEvent.contractVersion, 1);
  assert.equal(typeof locationEvent.location.serverReceivedAt, 'number');

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
  assert.equal(publishedRoute.legs[0].steps[0].name, 'Rota calculada');
  assert.equal(publishedRoute.updatedBy.name, 'Caio');
  assert.equal((await emitAck(client, 'send-location', { lat: 200, lng: 0, accuracy: 1 })).ok, false);
});

test('servidor ignora rota enviada e publica cálculo autoritativo', async (t) => {
  let receivedRequest;
  const authoritative = calculatedRoute({
    origin: { lat: -23.5, lng: -46.6 },
    destination: { lat: -23.6, lng: -46.7 }
  });
  authoritative.distance = 321;
  authoritative.duration = 45;
  authoritative.legs[0].distance = 321;
  authoritative.legs[0].duration = 45;
  authoritative.legs[0].steps[0].distance = 321;
  authoritative.legs[0].steps[0].duration = 45;
  const server = await startServer({ routeService: { calculate: async (request) => {
    receivedRequest = request;
    return authoritative;
  } } });
  const client = await server.connect();
  t.after(async () => { client.disconnect(); await new Promise((resolve) => server.io.close(resolve)); });
  await emitAck(client, 'join-party', { roomId: 'autoridade-1', name: 'Helena' });

  const result = await emitAck(client, 'update-route', {
    origin: { lat: -23.5, lng: -46.6 },
    destination: { lat: -23.6, lng: -46.7 },
    geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
    distance: 999999,
    duration: 999999
  });
  assert.equal(result.ok, true);
  assert.equal(result.route.distance, 321);
  assert.deepEqual(result.route.geometry.coordinates, authoritative.geometry.coordinates);
  assert.equal(receivedRequest.profile, 'driving');
  assert.deepEqual(receivedRequest.origin, { lat: -23.5, lng: -46.6 });
});

test('aceita intenção versionada sem geometria e reporta falha do OSRM', async (t) => {
  const providerError = Object.assign(new Error('offline'), { code: 'PROVIDER_ERROR' });
  const server = await startServer({ routeService: { calculate: async () => { throw providerError; } } });
  const client = await server.connect();
  t.after(async () => { client.disconnect(); await new Promise((resolve) => server.io.close(resolve)); });
  await emitAck(client, 'join-party', { roomId: 'autoridade-2', name: 'Iara' });
  const result = await emitAck(client, 'update-route', {
    contractVersion: 1,
    commandId: 'route_intent_123',
    routeRevision: 0,
    profile: 'driving',
    origin: { lat: -23.5, lng: -46.6 },
    destination: { lat: -23.6, lng: -46.7 }
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PROVIDER_ERROR');
  assert.equal(server.store.snapshot('autoridade-2').route, null);
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

test('contrato versionado deduplica localização e comando de rota e protege revisão', async (t) => {
  const server = await startServer();
  const client = await server.connect();
  t.after(async () => { client.disconnect(); await new Promise((resolve) => server.io.close(resolve)); });

  const unsupported = await emitAck(client, 'join-party', { contractVersion: 99, roomId: 'contrato-1', name: 'Gabi' });
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.code, 'UNSUPPORTED_CONTRACT_VERSION');
  assert.equal((await emitAck(client, 'join-party', { contractVersion: 1, roomId: 'contrato-1', name: 'Gabi' })).ok, true);

  const firstLocation = await emitAck(client, 'send-location', {
    contractVersion: 1, locationSequence: 7, lat: -23.5, lng: -46.6, accuracy: 5
  });
  assert.equal(firstLocation.ok, true);
  assert.equal(firstLocation.locationSequence, 7);
  const duplicateLocation = await emitAck(client, 'send-location', {
    contractVersion: 1, locationSequence: 7, lat: -23.7, lng: -46.8, accuracy: 5
  });
  assert.equal(duplicateLocation.duplicate, true);
  assert.equal(server.store.snapshot('contrato-1').participants[0].location.lat, -23.5);

  const route = {
    contractVersion: 1,
    commandId: 'route_command_456',
    routeRevision: 0,
    origin: { lat: -23.5, lng: -46.6 },
    destination: { lat: -23.6, lng: -46.7 },
    geometry: { type: 'LineString', coordinates: [[-46.6, -23.5], [-46.7, -23.6]] },
    distance: 1500,
    duration: 300
  };
  const firstRoute = await emitAck(client, 'update-route', route);
  assert.equal(firstRoute.ok, true);
  assert.equal(firstRoute.route.revision, 1);
  assert.equal(firstRoute.route.commandId, route.commandId);

  const duplicateRoute = await emitAck(client, 'update-route', { ...route, distance: 9999 });
  assert.equal(duplicateRoute.ok, true);
  assert.equal(duplicateRoute.duplicate, true);
  assert.equal(duplicateRoute.route.distance, 1500);
  assert.equal(server.store.snapshot('contrato-1').route.revision, 1);

  const conflict = await emitAck(client, 'update-route', {
    ...route,
    commandId: 'route_command_789',
    routeRevision: 0
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, 'ROUTE_REVISION_CONFLICT');
  assert.equal(conflict.currentRouteRevision, 1);
});
