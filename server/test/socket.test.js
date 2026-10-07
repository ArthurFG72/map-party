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
  const disconnectGraceMs = options.disconnectGraceMs ?? 5;
  const instance = createApp({ origin: '*', ...options, routeService, disconnectGraceMs });
  await new Promise((resolve) => instance.httpServer.listen(0, '127.0.0.1', resolve));
  const port = instance.httpServer.address().port;
  const connect = (options = {}) => new Promise((resolve, reject) => {
    const socket = createClient(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true, ...options });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (error) => {
      socket.disconnect();
      reject(error);
    });
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

test('Socket.io rejeita origem fora da allowlist', async (t) => {
  const server = await startServer({ origin: 'https://app.example.test' });
  t.after(async () => { await new Promise((resolve) => server.io.close(resolve)); });

  await assert.rejects(
    server.connect({ extraHeaders: { Origin: 'https://evil.example.test' } }),
    /websocket error|xhr poll error/
  );
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
  assert.equal((await emitAck(client, 'set-route-sharing-consent', { enabled: true })).ok, true);
  const eventPromise = once(client, 'route-updated');
  const routeAck = await emitAck(client, 'update-route', payload);
  assert.equal(routeAck.ok, true);
  assert.equal(routeAck.scope, 'shared');
  assert.equal(routeAck.route.revision, 1);
  const publishedRoute = await eventPromise;
  assert.equal(publishedRoute.geometry.type, 'LineString');
  assert.equal(publishedRoute.legs[0].steps[0].name, 'Rota calculada');
  assert.equal(publishedRoute.updatedBy.name, 'Caio');
  assert.equal((await emitAck(client, 'send-location', { lat: 200, lng: 0, accuracy: 1 })).ok, false);
});

test('rota pessoal não altera os demais e rota compartilhada exige consentimento de todos', async (t) => {
  const server = await startServer();
  const ana = await server.connect();
  const bia = await server.connect();
  t.after(async () => { ana.disconnect(); bia.disconnect(); await new Promise((resolve) => server.io.close(resolve)); });
  await emitAck(ana, 'join-party', { roomId: 'consent-1', name: 'Ana' });
  await emitAck(bia, 'join-party', { roomId: 'consent-1', name: 'Bia' });
  await emitAck(ana, 'send-location', { lat: -23.5, lng: -46.6, accuracy: 5, timestamp: Date.now() });

  let sharedUpdates = 0;
  bia.on('route-updated', () => { sharedUpdates += 1; });
  const personal = await emitAck(ana, 'update-route', {
    scope: 'personal',
    origin: { lat: -23.5, lng: -46.6 },
    destination: { lat: -23.6, lng: -46.7 }
  });
  assert.equal(personal.ok, true);
  assert.equal(server.store.snapshot('consent-1').route, null);
  assert.equal(sharedUpdates, 0);

  const rejected = await emitAck(ana, 'update-route', {
    origin: { lat: -23.5, lng: -46.6 },
    destination: { lat: -23.6, lng: -46.7 }
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'ROUTE_SHARING_CONSENT_REQUIRED');
  await emitAck(ana, 'set-route-sharing-consent', { enabled: true });
  assert.equal((await emitAck(ana, 'update-route', {
    origin: { lat: -23.5, lng: -46.6 },
    destination: { lat: -23.6, lng: -46.7 }
  })).code, 'ROUTE_SHARING_CONSENT_REQUIRED');
  await emitAck(bia, 'set-route-sharing-consent', { enabled: true });
  const shared = await emitAck(ana, 'update-route', {
    origin: { lat: -23.5, lng: -46.6 },
    destination: { lat: -23.6, lng: -46.7 }
  });
  assert.equal(shared.ok, true);
  assert.equal(shared.scope, 'shared');
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
  await emitAck(client, 'set-route-sharing-consent', { enabled: true });

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
  await emitAck(client, 'set-route-sharing-consent', { enabled: true });
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
  assert.equal((await emitAck(client, 'set-route-sharing-consent', { enabled: true })).ok, true);
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
  assert.equal((await emitAck(client, 'set-route-sharing-consent', { enabled: true })).ok, true);

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

test('participantToken mantém identidade, localização e rota após reconnect', async (t) => {
  const participantToken = 'participant_token_abcdefghijklmnopqrstuvwxyz_123456';
  const server = await startServer({ disconnectGraceMs: 80 });
  const first = await server.connect();
  let second;
  t.after(async () => {
    first.disconnect();
    second?.disconnect();
    await new Promise((resolve) => server.io.close(resolve));
  });

  const firstJoin = await emitAck(first, 'join-party', { roomId: 'reconnect-1', name: 'Joana', participantToken });
  assert.equal(firstJoin.ok, true);
  assert.notEqual(firstJoin.participantId, first.id, 'identidade estável não depende do socket.id');
  const repeatedJoin = await emitAck(first, 'join-party', { roomId: 'reconnect-1', name: 'Joana', participantToken });
  assert.equal(repeatedJoin.participantId, firstJoin.participantId);
  assert.equal(repeatedJoin.snapshot.participants.length, 1);
  assert.equal((await emitAck(first, 'set-route-sharing-consent', { enabled: true })).ok, true);
  assert.equal((await emitAck(first, 'send-location', { lat: -23.5, lng: -46.6, accuracy: 4 })).ok, true);
  assert.equal((await emitAck(first, 'update-route', {
    origin: { lat: -23.5, lng: -46.6 }, destination: { lat: -23.6, lng: -46.7 },
    geometry: { type: 'LineString', coordinates: [[-46.6, -23.5], [-46.7, -23.6]] },
    distance: 999, duration: 999
  })).ok, true);

  first.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 10));
  const retained = server.store.snapshot('reconnect-1');
  assert.equal(retained.participants.length, 1);
  assert.equal(retained.participants[0].online, false);

  second = await server.connect();
  const rejoined = await emitAck(second, 'join-party', { roomId: 'reconnect-1', name: 'Joana', participantToken });
  assert.equal(rejoined.ok, true);
  assert.equal(rejoined.participantId, firstJoin.participantId);
  assert.equal(rejoined.snapshot.participants.length, 1);
  assert.equal(rejoined.snapshot.participants[0].online, true);
  assert.equal(rejoined.snapshot.participants[0].location.accuracy, 4);
  assert.equal(rejoined.snapshot.route.distance, 1500);
  assert.equal('participantToken' in rejoined.snapshot.participants[0], false);

  await new Promise((resolve) => setTimeout(resolve, 90));
  assert.equal(server.store.snapshot('reconnect-1').participants.length, 1, 'timer antigo não remove participante reconectado');
});

test('party legada preserva snapshot durante grace period e expira depois', async (t) => {
  const server = await startServer({ disconnectGraceMs: 60 });
  const first = await server.connect();
  let second;
  t.after(async () => {
    first.disconnect();
    second?.disconnect();
    await new Promise((resolve) => server.io.close(resolve));
  });
  const participantToken = 'legacy_snapshot_token_abcdefghijklmnopqrstuvwxyz_123456';
  await emitAck(first, 'join-party', { roomId: 'snapshot-1', name: 'Kaio', participantToken });
  await emitAck(first, 'set-route-sharing-consent', { enabled: true });
  await emitAck(first, 'update-route', {
    origin: { lat: 1, lng: 2 }, destination: { lat: 3, lng: 4 },
    geometry: { type: 'LineString', coordinates: [[2, 1], [4, 3]] },
    distance: 1, duration: 1
  });
  first.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(server.store.snapshot('snapshot-1').route.distance, 1500);

  second = await server.connect();
  const recovered = await emitAck(second, 'join-party', { roomId: 'snapshot-1', name: 'Kaio', participantToken });
  assert.equal(recovered.snapshot.route.distance, 1500);
  assert.equal(recovered.snapshot.participants.length, 1);
  second.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 75));
  assert.equal(server.store.snapshot('snapshot-1'), null);
});

test('rejeita participantToken inválido sem criar party', async (t) => {
  const server = await startServer();
  const client = await server.connect();
  t.after(async () => { client.disconnect(); await new Promise((resolve) => server.io.close(resolve)); });
  const result = await emitAck(client, 'join-party', { roomId: 'token-1', name: 'Lia', participantToken: 'curto' });
  assert.equal(result.ok, false);
  assert.equal(server.store.snapshot('token-1'), null);
});

test('personal reroute preserves shared route, returns ETA and notifies only its participant', async (t) => {
  const server = await startServer();
  const ana = await server.connect(); const bia = await server.connect();
  t.after(async () => { ana.disconnect(); bia.disconnect(); await new Promise((resolve) => server.io.close(resolve)); });
  const joinedAna = await emitAck(ana, 'join-party', { roomId: 'personal-1', name: 'Ana' });
  await emitAck(bia, 'join-party', { roomId: 'personal-1', name: 'Bia' });
  await emitAck(ana, 'set-route-sharing-consent', { enabled: true });
  await emitAck(bia, 'set-route-sharing-consent', { enabled: true });

  const shared = await emitAck(ana, 'update-route', {
    origin: { lat: -23.5, lng: -46.6 }, destination: { lat: -23.6, lng: -46.7 }
  });
  const locationTimestamp = Date.now() - 1_000;
  await emitAck(ana, 'send-location', {
    contractVersion: 1, locationSequence: 1, lat: -23.51, lng: -46.61, accuracy: 5, timestamp: locationTimestamp
  });

  let otherReroutes = 0;
  let sharedUpdates = 0;
  bia.on('navigation-rerouted', () => { otherReroutes += 1; });
  bia.on('route-updated', () => { sharedUpdates += 1; });
  const eventPromise = once(ana, 'navigation-rerouted');
  const personal = await emitAck(ana, 'update-route', {
    contractVersion: 1,
    scope: 'personal',
    commandId: 'personal_route_123',
    routeRevision: 0,
    origin: { lat: -23.51, lng: -46.61 },
    destination: { lat: -23.6, lng: -46.7 }
  });
  const event = await eventPromise;
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(personal.ok, true);
  assert.equal(personal.scope, 'personal');
  assert.equal(personal.route.scope, 'personal');
  assert.equal('revision' in personal.route, false);
  assert.deepEqual(event.eta, personal.eta);
  assert.equal(personal.eta.participantId, joinedAna.participantId);
  assert.equal(personal.eta.distanceMeters, 1500);
  assert.equal(personal.eta.durationSeconds, 300);
  assert.equal(personal.eta.locationTimestamp, locationTimestamp);
  assert.equal(personal.eta.estimatedArrivalAt, locationTimestamp + 300_000);
  assert.equal(server.store.snapshot('personal-1').route.revision, shared.route.revision);
  assert.equal(server.store.snapshot('personal-1').route.scope, 'shared');
  assert.equal(otherReroutes, 0);
  assert.equal(sharedUpdates, 0);

  const duplicate = await emitAck(ana, 'update-route', {
    contractVersion: 1,
    scope: 'personal',
    commandId: 'personal_route_123',
    origin: { lat: 0, lng: 0 },
    destination: { lat: 1, lng: 1 }
  });
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(duplicate.eta, personal.eta);
});

test('personal reroute requires a location and invalid scope is rejected', async (t) => {
  const server = await startServer();
  const client = await server.connect();
  t.after(async () => { client.disconnect(); await new Promise((resolve) => server.io.close(resolve)); });
  await emitAck(client, 'join-party', { roomId: 'personal-2', name: 'Caio' });
  const route = { origin: { lat: 1, lng: 2 }, destination: { lat: 3, lng: 4 } };

  const missingLocation = await emitAck(client, 'update-route', { ...route, scope: 'personal' });
  assert.equal(missingLocation.ok, false);
  assert.equal(missingLocation.code, 'LOCATION_REQUIRED');
  assert.equal((await emitAck(client, 'update-route', { ...route, scope: 'private' })).ok, false);
  assert.equal(server.store.snapshot('personal-2').route, null);
});

test('participante pode ocultar a posição e alterar a visibilidade', async (t) => {
  const server = await startServer();
  const clients = [];
  t.after(async () => {
    clients.forEach((client) => client.disconnect());
    await new Promise((resolve) => server.io.close(resolve));
  });
  const hidden = await server.connect(); const viewer = await server.connect(); clients.push(hidden, viewer);
  await emitAck(hidden, 'join-party', { roomId: 'privacidade-1', name: 'Oculto', visible: false });
  const snapshotPromise = once(hidden, 'participants-snapshot');
  const viewerSnapshotPromise = once(viewer, 'participants-snapshot');
  await emitAck(viewer, 'join-party', { roomId: 'privacidade-1', name: 'Visivel' });
  const snapshot = await snapshotPromise;
  const viewerSnapshot = await viewerSnapshotPromise;
  const pausedViewerParticipant = viewerSnapshot.participants.find((participant) => participant.name === 'Oculto');
  assert.equal(pausedViewerParticipant.visible, false);
  assert.equal(pausedViewerParticipant.sharingPaused, true);
  const hiddenParticipant = snapshot.participants.find((participant) => participant.name === 'Oculto');
  assert.equal(hiddenParticipant.visible, false);
  assert.equal(hiddenParticipant.location, null);
  let received = false;
  viewer.once('participant-location', () => { received = true; });
  assert.equal((await emitAck(hidden, 'send-location', { lat: -23.5, lng: -46.6, accuracy: 8 })).ok, true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(received, false);
  assert.equal((await emitAck(hidden, 'set-visibility', { visible: true })).ok, true);
});

test('clientes AGUIA usam o mapa global e pausa conserva a ultima posicao', async (t) => {
  const server = await startServer();
  const clients = [];
  t.after(async () => {
    clients.forEach((client) => client.disconnect());
    await new Promise((resolve) => server.io.close(resolve));
  });
  const android = await server.connect();
  const ios = await server.connect();
  clients.push(android, ios);

  await emitAck(android, 'join-party', { roomId: 'aparelho-android', clientCode: 'AGUIA', name: 'A-Android' });
  const snapshotPromise = once(ios, 'participants-snapshot');
  await emitAck(ios, 'join-party', { roomId: 'aparelho-ios', clientCode: 'AGUIA', name: 'A-iPhone' });
  const joinedSnapshot = await snapshotPromise;
  assert.equal(joinedSnapshot.roomId, 'global');
  assert.deepEqual(joinedSnapshot.participants.map((participant) => participant.name).sort(), ['A-Android', 'A-iPhone']);

  await emitAck(android, 'send-location', { lat: -23.5505, lng: -46.6333, accuracy: 8 });
  const pausedSnapshotPromise = once(ios, 'participants-snapshot');
  await emitAck(android, 'set-visibility', { visible: false });
  const pausedSnapshot = await pausedSnapshotPromise;
  const paused = pausedSnapshot.participants.find((participant) => participant.name === 'A-Android');
  assert.equal(paused.visible, false);
  assert.equal(paused.sharingPaused, true);
  assert.equal(paused.location.lat, -23.5505);
  assert.equal(paused.location.lng, -46.6333);
});
test('SOS confirmado notifica os demais participantes da party', async (t) => {
  const server = await startServer();
  const clients = [];
  t.after(async () => {
    clients.forEach((client) => client.disconnect());
    await new Promise((resolve) => server.io.close(resolve));
  });
  const ana = await server.connect(); const bia = await server.connect(); clients.push(ana, bia);
  await emitAck(ana, 'join-party', { roomId: 'sos-1', name: 'Ana' });
  await emitAck(bia, 'join-party', { roomId: 'sos-1', name: 'Bia' });
  const signal = once(bia, 'sos-signal');
  const ack = await emitAck(ana, 'send-sos-signal', { messageId: 'sos-12345678', message: 'SOS — preciso de ajuda', location: { lat: -23.55, lng: -46.63, accuracy: 8 } });
  const received = await signal;
  assert.equal(ack.ok, true);
  assert.equal(received.participantName, 'Ana');
  assert.equal(received.messageId, 'sos-12345678');
  assert.equal(received.message, 'SOS — preciso de ajuda');
  assert.equal(received.location.lat, -23.55);
  assert.equal(received.location.lng, -46.63);
  assert.equal(received.location.accuracy, 8);
  const anaResponse = once(ana, 'sos-response');
  const biaResponse = once(bia, 'sos-response');
  const responseAck = await emitAck(bia, 'respond-sos', { messageId: 'sos-12345678', accepted: true });
  const [responseForAna, responseForBia] = await Promise.all([anaResponse, biaResponse]);
  assert.equal(responseAck.ok, true);
  assert.equal(responseForAna.accepted, true);
  assert.equal(responseForAna.participantName, 'Bia');
  assert.equal(responseForBia.participantId, responseForAna.participantId);
});

test('participante envia mensagem direta ao selecionar outro participante', async (t) => {
  const server = await startServer();
  const clients = [];
  t.after(async () => {
    clients.forEach((client) => client.disconnect());
    await new Promise((resolve) => server.io.close(resolve));
  });
  const ana = await server.connect(); const bia = await server.connect(); clients.push(ana, bia);
  const anaJoin = await emitAck(ana, 'join-party', { roomId: 'mensagem-1', name: 'Ana' });
  await emitAck(bia, 'join-party', { roomId: 'mensagem-1', name: 'Bia' });
  const target = server.store.snapshot('mensagem-1').participants.find((participant) => participant.name === 'Bia');
  const receivedPromise = once(bia, 'direct-message');
  const ack = await emitAck(ana, 'send-direct-message', { targetParticipantId: target.id, text: 'Tudo certo?' });
  const received = await receivedPromise;
  assert.equal(ack.ok, true);
  assert.equal(received.senderParticipantId, anaJoin.participantId);
  assert.equal(received.senderName, 'Ana');
  assert.equal(received.text, 'Tudo certo?');
});

test('publica percurso de reconhecimento com pontos de atenção para toda a party', async (t) => {
  const server = await startServer();
  const clients = [];
  t.after(async () => { clients.forEach((client) => client.disconnect()); await new Promise((resolve) => server.io.close(resolve)); });
  const ana = await server.connect(); const bia = await server.connect(); clients.push(ana, bia);
  const anaJoin = await emitAck(ana, 'join-party', { roomId: 'reconhecimento-1', name: 'Ana' });
  await emitAck(bia, 'join-party', { roomId: 'reconhecimento-1', name: 'Bia' });
  const track = {
    trackId: 'track-12345678',
    userName: 'Ana',
    startedAt: 1000,
    points: [{ lat: -23.55, lng: -46.63, timestamp: 1000 }, { lat: -23.551, lng: -46.631, timestamp: 2000 }],
    attentionPoints: [{ id: 'attention-1', type: 'buraco', note: 'Faixa direita', lat: -23.5505, lng: -46.6305, createdAt: 1500 }]
  };
  const receivedPromise = once(bia, 'exploration-track');
  const ack = await emitAck(ana, 'publish-exploration-track', track);
  const received = await receivedPromise;
  assert.equal(ack.ok, true);
  assert.equal(received.trackId, track.trackId);
  assert.equal(received.userName, 'Ana');
  assert.equal(received.points.length, 2);
  assert.equal(received.attentionPoints[0].type, 'buraco');
  assert.equal(received.participantId, anaJoin.participantId);
});

test('convite de rota pendente Ã© reenviado quando o participante retorna', async (t) => {
  const server = await startServer({ disconnectGraceMs: 50 });
  const clients = [];
  t.after(async () => { clients.forEach((client) => client.disconnect()); await new Promise((resolve) => server.io.close(resolve)); });
  const owner = await server.connect();
  const target = await server.connect();
  clients.push(owner, target);
  const ownerToken = 'a'.repeat(32);
  const targetToken = 'b'.repeat(32);
  const roomId = 'route-reinvite-1';
  const ownerJoin = await emitAck(owner, 'join-party', { roomId, name: 'Ana', participantToken: ownerToken });
  const targetJoin = await emitAck(target, 'join-party', { roomId, name: 'Bia', participantToken: targetToken });
  await emitAck(owner, 'send-location', { lat: -23.5, lng: -46.6, accuracy: 5, timestamp: Date.now() });
  const route = await emitAck(owner, 'update-route', {
    scope: 'personal',
    origin: { lat: -23.5, lng: -46.6 },
    destination: { lat: -23.6, lng: -46.7 }
  });
  assert.equal(route.ok, true);
  const firstInvitation = once(target, 'route-share-invitation');
  assert.equal((await emitAck(owner, 'request-route-share', { targetParticipantIds: [targetJoin.participantId] })).ok, true);
  const invitation = await firstInvitation;
  assert.equal((await emitAck(target, 'respond-route-share', { invitationId: invitation.invitationId, accepted: true })).ok, true);

  const reverseInvitationPromise = once(owner, 'route-share-invitation');
  const reverseShare = await emitAck(target, 'request-route-share', { targetParticipantIds: [ownerJoin.participantId] });
  assert.equal(reverseShare.ok, true);
  const reverseInvitation = await reverseInvitationPromise;
  assert.equal(reverseInvitation.participantId, targetJoin.participantId);

  target.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal((await emitAck(owner, 'request-route-share', { targetParticipantIds: [targetJoin.participantId] })).ok, true);

  const returnedTarget = await server.connect();
  clients.push(returnedTarget);
  const returnedInvitation = once(returnedTarget, 'route-share-invitation');
  const rejoin = await emitAck(returnedTarget, 'join-party', { roomId, name: 'Bia', participantToken: targetToken });
  assert.equal(rejoin.participantId, targetJoin.participantId);
  assert.equal((await returnedInvitation).participantId, ownerJoin.participantId);
});
