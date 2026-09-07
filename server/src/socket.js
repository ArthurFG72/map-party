import { cleanLocation, cleanName, cleanRoomId, cleanRoute } from './validation.js';
import { PartyStore } from './partyStore.js';

const LOCATION_RATE = { windowMs: 60_000, max: 30 };
const ROUTE_RATE = { windowMs: 60_000, max: 10 };

function reject(ack, message) {
  if (typeof ack === 'function') ack({ ok: false, error: message });
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
      const roomId = cleanRoomId(payload?.roomId);
      const name = cleanName(payload?.name);
      if (!roomId || !name) return reject(ack, 'Nome ou código da party inválido.');

      const previous = store.roomFor(socket.id)?.roomId ?? null;
      const joined = store.join(socket.id, roomId, name);
      if (!joined) return reject(ack, 'A party atingiu o limite de participantes.');
      if (previous && previous !== roomId) socket.leave(previous);
      socket.join(roomId);
      if (typeof ack === 'function') ack({ ok: true, participantId: joined.participant.id, snapshot: store.snapshot(roomId) });
      socket.to(roomId).emit('participants-snapshot', store.snapshot(roomId));
      if (previous && previous !== roomId && store.rooms.has(previous)) {
        io.to(previous).emit('participants-snapshot', store.snapshot(previous));
      }
    });

    socket.on('send-location', (payload, ack) => {
      if (!allowed(rate.location, LOCATION_RATE)) return reject(ack, 'Muitas atualizações de localização. Aguarde um momento.');
      const membership = store.roomFor(socket.id);
      const location = cleanLocation(payload);
      if (!membership || !location) return reject(ack, 'Localização inválida ou participante fora da party.');
      const participant = membership.room.participants.get(socket.id);
      participant.location = location;
      io.to(membership.roomId).emit('participant-location', { participantId: socket.id, location });
      if (typeof ack === 'function') ack({ ok: true });
    });

    socket.on('update-route', (payload, ack) => {
      if (!allowed(rate.route, ROUTE_RATE)) return reject(ack, 'Muitas atualizações de rota. Aguarde um momento.');
      const membership = store.roomFor(socket.id);
      const route = cleanRoute(payload);
      if (!membership || !route) return reject(ack, 'Rota inválida ou participante fora da party.');
      const participant = membership.room.participants.get(socket.id);
      const enrichedRoute = {
        ...route,
        updatedAt: Date.now(),
        updatedBy: { participantId: socket.id, name: participant.name },
        revision: (membership.room.route?.revision || 0) + 1
      };
      membership.room.route = enrichedRoute;
      io.to(membership.roomId).emit('route-updated', enrichedRoute);
      if (typeof ack === 'function') ack({ ok: true, route: enrichedRoute });
    });

    socket.on('disconnect', () => {
      const roomId = store.leave(socket.id);
      if (roomId && store.rooms.has(roomId)) io.to(roomId).emit('participants-snapshot', store.snapshot(roomId));
    });
  });
  return store;
}
