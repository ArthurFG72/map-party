import { acceptsContractVersion, CONTRACT_VERSION, versioned } from './contracts.js';
import { cleanLocationUpdate, cleanName, cleanRoomId, cleanRouteUpdate } from './validation.js';
import { PartyStore } from './partyStore.js';

const LOCATION_RATE = { windowMs: 60_000, max: 30 };
const ROUTE_RATE = { windowMs: 60_000, max: 10 };

function reject(ack, message, code = 'INVALID_REQUEST', extra = {}) {
  if (typeof ack === 'function') ack(versioned({ ok: false, code, error: message, ...extra }));
}

function allowed(timestamps, { windowMs, max }) {
  const cutoff = Date.now() - windowMs;
  while (timestamps.length && timestamps[0] <= cutoff) timestamps.shift();
  if (timestamps.length >= max) return false;
  timestamps.push(Date.now());
  return true;
}

export function registerSocketHandlers(io, store = new PartyStore()) {
  io.on('connection', (socket) => {
    const rate = { location: [], route: [] };
    socket.on('join-party', (payload, ack) => {
      if (!acceptsContractVersion(payload)) return reject(ack, 'Versão de contrato não suportada.', 'UNSUPPORTED_CONTRACT_VERSION');
      const roomId = cleanRoomId(payload?.roomId);
      const name = cleanName(payload?.name);
      if (!roomId || !name) return reject(ack, 'Nome ou código da party inválido.');

      const previous = store.roomFor(socket.id)?.roomId ?? null;
      const joined = store.join(socket.id, roomId, name);
      if (!joined) return reject(ack, 'A party atingiu o limite de participantes.');
      if (previous && previous !== roomId) socket.leave(previous);
      socket.join(roomId);
      const snapshot = versioned(store.snapshot(roomId));
      if (typeof ack === 'function') ack(versioned({ ok: true, participantId: joined.participant.id, snapshot }));
      socket.to(roomId).emit('participants-snapshot', snapshot);
      if (previous && previous !== roomId && store.rooms.has(previous)) {
        io.to(previous).emit('participants-snapshot', versioned(store.snapshot(previous)));
      }
    });

    socket.on('send-location', (payload, ack) => {
      if (!allowed(rate.location, LOCATION_RATE)) return reject(ack, 'Muitas atualizações de localização. Aguarde um momento.');
      const membership = store.roomFor(socket.id);
      const update = cleanLocationUpdate(payload);
      if (!membership || !update) return reject(ack, 'Localização inválida ou participante fora da party.');
      const { locationSequence } = update;
      const previousSequence = store.locationSequence(socket.id);
      if (locationSequence != null && previousSequence != null && locationSequence <= previousSequence) {
        if (typeof ack === 'function') ack(versioned({ ok: true, duplicate: true, locationSequence: previousSequence }));
        return;
      }
      const serverReceivedAt = Date.now();
      const location = { ...update.location, serverReceivedAt };
      const participant = membership.room.participants.get(socket.id);
      participant.location = location;
      store.setLocationSequence(socket.id, locationSequence);
      io.to(membership.roomId).emit('participant-location', versioned({ participantId: socket.id, location, locationSequence }));
      if (typeof ack === 'function') ack(versioned({ ok: true, locationSequence }));
    });

    socket.on('update-route', (payload, ack) => {
      if (!allowed(rate.route, ROUTE_RATE)) return reject(ack, 'Muitas atualizações de rota. Aguarde um momento.');
      const membership = store.roomFor(socket.id);
      const update = cleanRouteUpdate(payload);
      if (!membership || !update) return reject(ack, 'Rota inválida ou participante fora da party.');
      const { commandId, routeRevision, route } = update;
      const processedRoute = store.routeCommand(membership.roomId, commandId);
      if (processedRoute) {
        if (typeof ack === 'function') ack(versioned({ ok: true, duplicate: true, route: processedRoute }));
        return;
      }
      const currentRevision = membership.room.route?.revision || 0;
      if (routeRevision != null && routeRevision !== currentRevision) {
        return reject(ack, 'A rota foi atualizada por outro participante.', 'ROUTE_REVISION_CONFLICT', {
          currentRouteRevision: currentRevision
        });
      }
      const participant = membership.room.participants.get(socket.id);
      const enrichedRoute = {
        ...route,
        contractVersion: CONTRACT_VERSION,
        updatedAt: Date.now(),
        updatedBy: { participantId: socket.id, name: participant.name },
        revision: currentRevision + 1,
        ...(commandId ? { commandId } : {})
      };
      membership.room.route = enrichedRoute;
      store.rememberRouteCommand(membership.roomId, commandId, enrichedRoute);
      io.to(membership.roomId).emit('route-updated', enrichedRoute);
      if (typeof ack === 'function') ack(versioned({ ok: true, route: enrichedRoute }));
    });

    socket.on('disconnect', () => {
      const roomId = store.leave(socket.id);
      if (roomId && store.rooms.has(roomId)) io.to(roomId).emit('participants-snapshot', versioned(store.snapshot(roomId)));
    });
  });
  return store;
}
