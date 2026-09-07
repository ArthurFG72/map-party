import { acceptsContractVersion, CONTRACT_VERSION, versioned } from './contracts.js';
import { cleanLocationUpdate, cleanName, cleanParticipantToken, cleanRoomId, cleanRoute, cleanRouteIntent } from './validation.js';
import { PartyStore } from './partyStore.js';
import { createRouteService } from './services/routeService.js';

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

function personalEta(participantId, route, locationTimestamp) {
  return {
    participantId,
    distanceMeters: route.distance,
    durationSeconds: route.duration,
    locationTimestamp,
    estimatedArrivalAt: Math.round(locationTimestamp + route.duration * 1000)
  };
}

export function registerSocketHandlers(io, store = new PartyStore(), {
  routeService = createRouteService(),
  disconnectGraceMs = 10_000
} = {}) {
  const graceMs = Number.isFinite(disconnectGraceMs) ? Math.max(0, Math.min(disconnectGraceMs, 60_000)) : 10_000;
  io.on('connection', (socket) => {
    const rate = { location: [], route: [] };
    socket.on('join-party', (payload, ack) => {
      if (!acceptsContractVersion(payload)) return reject(ack, 'Versão de contrato não suportada.', 'UNSUPPORTED_CONTRACT_VERSION');
      const roomId = cleanRoomId(payload?.roomId);
      const name = cleanName(payload?.name);
      const participantToken = payload?.participantToken == null ? null : cleanParticipantToken(payload.participantToken);
      if (!roomId || !name || (payload?.participantToken != null && !participantToken)) {
        return reject(ack, 'Nome, código da party ou token de participante inválido.');
      }

      const previous = store.roomFor(socket.id)?.roomId ?? null;
      const joined = store.join(socket.id, roomId, name, participantToken);
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
      const participant = membership.room.participants.get(membership.participantId);
      participant.location = location;
      store.setLocationSequence(socket.id, locationSequence);
      io.to(membership.roomId).emit('participant-location', versioned({ participantId: membership.participantId, location, locationSequence }));
      if (typeof ack === 'function') ack(versioned({ ok: true, locationSequence }));
    });

    socket.on('update-route', async (payload, ack) => {
      if (!allowed(rate.route, ROUTE_RATE)) return reject(ack, 'Muitas atualizações de rota. Aguarde um momento.');
      const membership = store.roomFor(socket.id);
      const update = cleanRouteIntent(payload);
      if (!membership || !update) return reject(ack, 'Rota inválida ou participante fora da party.');
      const { commandId, routeRevision, scope } = update;
      const participant = membership.room.participants.get(membership.participantId);
      const locationTimestamp = participant?.location?.timestamp;
      if (scope === 'personal' && !Number.isSafeInteger(locationTimestamp)) {
        return reject(ack, 'Envie uma localização válida antes de recalcular sua navegação.', 'LOCATION_REQUIRED');
      }
      const commandKey = scope === 'personal' && commandId
        ? `personal:${membership.participantId}:${commandId}`
        : commandId;
      const processed = store.routeCommand(membership.roomId, commandKey);
      if (processed) {
        if (typeof ack === 'function') ack(versioned({ ok: true, duplicate: true, ...processed }));
        return;
      }
      const currentRevision = membership.room.route?.revision || 0;
      if (scope === 'shared' && routeRevision != null && routeRevision !== currentRevision) {
        return reject(ack, 'A rota foi atualizada por outro participante.', 'ROUTE_REVISION_CONFLICT', {
          currentRouteRevision: currentRevision
        });
      }
      let route;
      try {
        const calculated = await routeService.calculate({
          contractVersion: CONTRACT_VERSION,
          profile: update.profile,
          origin: update.origin,
          destination: update.destination
        });
        route = cleanRoute(calculated);
        if (!route) throw Object.assign(new Error('Invalid provider route'), { code: 'PROVIDER_ERROR' });
      } catch (error) {
        const timeout = error.code === 'PROVIDER_TIMEOUT';
        return reject(
          ack,
          timeout ? 'O serviço de rotas excedeu o tempo limite.' : 'O serviço de rotas está indisponível.',
          timeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR'
        );
      }
      const activeMembership = store.roomFor(socket.id);
      if (!activeMembership || activeMembership.roomId !== membership.roomId) {
        return reject(ack, 'Participante fora da party.');
      }
      const duplicateAfterCalculation = store.routeCommand(membership.roomId, commandKey);
      if (duplicateAfterCalculation) {
        if (typeof ack === 'function') ack(versioned({ ok: true, duplicate: true, ...duplicateAfterCalculation }));
        return;
      }
      const activeRevision = activeMembership.room.route?.revision || 0;
      if (scope === 'shared' && routeRevision != null && routeRevision !== activeRevision) {
        return reject(ack, 'A rota foi atualizada por outro participante.', 'ROUTE_REVISION_CONFLICT', {
          currentRouteRevision: activeRevision
        });
      }
      const activeParticipant = activeMembership.room.participants.get(activeMembership.participantId);
      const enrichedRoute = {
        ...route,
        contractVersion: CONTRACT_VERSION,
        scope,
        updatedAt: Date.now(),
        updatedBy: { participantId: activeMembership.participantId, name: activeParticipant.name },
        ...(scope === 'shared' ? { revision: activeRevision + 1 } : {}),
        ...(commandId ? { commandId } : {})
      };
      const result = {
        scope,
        route: enrichedRoute,
        ...(scope === 'personal' ? { eta: personalEta(activeMembership.participantId, enrichedRoute, locationTimestamp) } : {})
      };
      store.rememberRouteCommand(activeMembership.roomId, commandKey, result);
      if (scope === 'personal') {
        socket.emit('navigation-rerouted', versioned(result));
      } else {
        activeMembership.room.route = enrichedRoute;
        io.to(activeMembership.roomId).emit('route-updated', enrichedRoute);
      }
      if (typeof ack === 'function') ack(versioned({ ok: true, ...result }));
    });

    socket.on('disconnect', () => {
      const disconnected = store.disconnect(socket.id);
      if (!disconnected) return;
      const { roomId, participantId, retained, participantRecoveryVersion, roomRecoveryVersion } = disconnected;
      if (store.rooms.has(roomId)) io.to(roomId).emit('participants-snapshot', versioned(store.snapshot(roomId)));
      const timer = setTimeout(() => {
        const participantExpired = retained && store.expireParticipant(roomId, participantId, participantRecoveryVersion);
        const roomExpired = store.expireRoom(roomId, roomRecoveryVersion);
        if (participantExpired && !roomExpired && store.rooms.has(roomId)) {
          io.to(roomId).emit('participants-snapshot', versioned(store.snapshot(roomId)));
        }
      }, graceMs);
      timer.unref?.();
    });
  });
  return store;
}
