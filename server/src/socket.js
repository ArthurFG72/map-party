import { acceptsContractVersion, CONTRACT_VERSION, versioned } from './contracts.js';
import { cleanDeviceId, cleanLocationUpdate, cleanName, cleanParticipantToken, cleanRoomId, cleanRoute, cleanRouteIntent, cleanVisibility } from './validation.js';
import { PartyStore } from './partyStore.js';
import { createRouteService } from './services/routeService.js';

const LOCATION_RATE = { windowMs: 60_000, max: 30 };
const ROUTE_RATE = { windowMs: 60_000, max: 10 };
const AGUIA_GLOBAL_ROOM = 'global';

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

function emitPartySnapshots(io, store, roomId) {
  const room = store.rooms.get(roomId);
  if (!room) return;
  for (const [participantId, sockets] of room.participantSockets) {
    for (const socketId of sockets) {
      io.to(socketId).emit('participants-snapshot', versioned(store.snapshot(roomId, participantId)));
    }
  }
}

export function registerSocketHandlers(io, store = new PartyStore(), {
  routeService = createRouteService(),
  trafficStore = null,
  disconnectGraceMs = 10_000,
  deviceAuth = null,
  requireDeviceAuth = false,
  recordCommandResult = null
} = {}) {
  const graceMs = Number.isFinite(disconnectGraceMs) ? Math.max(0, Math.min(disconnectGraceMs, 60_000)) : 10_000;
  io.on('connection', (socket) => {
    const rate = { location: [], route: [] };
    socket.on('join-party', (payload, ack) => {
      if (!acceptsContractVersion(payload)) return reject(ack, 'Versão de contrato não suportada.', 'UNSUPPORTED_CONTRACT_VERSION');
      const requestedRoomId = cleanRoomId(payload?.roomId);
      const roomId = payload?.clientCode === 'AGUIA' ? AGUIA_GLOBAL_ROOM : requestedRoomId;
      const name = cleanName(payload?.name);
      const participantToken = payload?.participantToken == null ? null : cleanParticipantToken(payload.participantToken);
      const deviceId = payload?.deviceId == null ? null : cleanDeviceId(payload.deviceId);
      const visible = cleanVisibility(payload?.visible);
      if (!roomId || !name || (payload?.participantToken != null && !participantToken) || (payload?.deviceId != null && !deviceId)) {
        return reject(ack, 'Nome, código da party ou token de participante inválido.');
      }
      if (requireDeviceAuth && (!deviceId || !participantToken || !deviceAuth)) {
        return reject(ack, 'Dispositivo autenticado obrigatório.', 'DEVICE_AUTH_REQUIRED');
      }

      const previous = store.roomFor(socket.id)?.roomId ?? null;
      const joined = store.join(socket.id, roomId, name, participantToken, visible);
      if (!joined) return reject(ack, 'A party atingiu o limite de participantes.');
      if (previous && previous !== roomId) socket.leave(previous);
      socket.join(roomId);
      socket.data.deviceId = deviceId || null;
      const deviceCredential = deviceId && participantToken && deviceAuth
        ? deviceAuth.issue({ deviceId, participantToken, roomId, participantId: joined.participant.id })
        : null;
      const snapshot = versioned(store.snapshot(roomId, joined.participant.id));
      if (typeof ack === 'function') ack(versioned({ ok: true, participantId: joined.participant.id, snapshot, ...(deviceCredential ? { deviceCredential } : {}) }));
      emitPartySnapshots(io, store, roomId);
      if (previous && previous !== roomId && store.rooms.has(previous)) {
        emitPartySnapshots(io, store, previous);
      }
      for (const invitation of store.pendingRouteShareInvitations(roomId, joined.participant.id)) {
        socket.emit('route-share-invitation', versioned(invitation));
      }
    });

    socket.on('navigation-command-result', (payload) => {
      const requestId = typeof payload?.request_id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(payload.request_id)
        ? payload.request_id : null;
      if (!socket.data.deviceId || !requestId || !payload || typeof payload.success !== 'boolean') return;
      recordCommandResult?.(socket.data.deviceId, {
        request_id: requestId,
        success: payload.success,
        status: payload.status === 'ok' ? 'ok' : 'error',
        ...(typeof payload.action === 'string' ? { action: payload.action } : {}),
        ...(typeof payload.command === 'string' ? { command: payload.command } : {}),
        ...(typeof payload.code === 'string' ? { code: payload.code } : {}),
        ...(payload.error && typeof payload.error === 'object' ? { error: payload.error } : {}),
        ...(payload.result && typeof payload.result === 'object' ? { result: payload.result } : {})
      });
    });

    socket.on('set-visibility', (payload, ack) => {
      const membership = store.roomFor(socket.id);
      if (!membership || typeof payload?.visible !== 'boolean') return reject(ack, 'Visibilidade invÃ¡lida.');
      const participant = membership.room.participants.get(membership.participantId);
      participant.visible = payload.visible;
      emitPartySnapshots(io, store, membership.roomId);
      if (typeof ack === 'function') ack(versioned({ ok: true, visible: participant.visible }));
    });

    socket.on('set-route-sharing-consent', (payload, ack) => {
      const membership = store.roomFor(socket.id);
      if (!membership || typeof payload?.enabled !== 'boolean') return reject(ack, 'Consentimento de rota inválido.');
      const result = store.setRouteSharingConsent(socket.id, payload.enabled);
      if (!result) return reject(ack, 'Participante fora da party.');
      emitPartySnapshots(io, store, membership.roomId);
      if (typeof ack === 'function') ack(versioned({ ok: true, enabled: result.participant.routeSharingConsent, ready: result.ready }));
    });

    socket.on('set-route-permission', (payload, ack) => {
      const targetParticipantId = typeof payload?.targetParticipantId === 'string' ? payload.targetParticipantId.trim() : '';
      const result = store.setRoutePermission(socket.id, targetParticipantId, payload?.enabled === true);
      if (!result) return reject(ack, 'Participante de rota inválido.', 'INVALID_ROUTE_PERMISSION');
      const ownerSocketIds = result.room.participantSockets.get(targetParticipantId) || new Set();
      for (const ownerSocketId of ownerSocketIds) {
        io.to(ownerSocketId).emit('route-permission-updated', versioned({
          participantId: result.participantId,
          targetParticipantId,
          enabled: result.enabled
        }));
      }
      if (result.enabled && result.route) {
        socket.emit('route-shared', versioned({ participantId: targetParticipantId, route: result.route }));
      } else if (!result.enabled) {
        socket.emit('route-shared', versioned({ participantId: targetParticipantId, route: null }));
      }
      if (typeof ack === 'function') ack(versioned({ ok: true, enabled: result.enabled, targetParticipantId }));
    });

    socket.on('request-route-share', (payload, ack) => {
      const targetParticipantIds = Array.isArray(payload?.targetParticipantIds)
        ? payload.targetParticipantIds.filter((id) => typeof id === 'string').map((id) => id.trim()).slice(0, 50)
        : [];
      const result = store.createRouteShareInvitations(socket.id, targetParticipantIds);
      if (!result) return reject(ack, 'Participante fora da party.', 'PARTY_NOT_FOUND');
      if (!result.route) return reject(ack, 'Defina uma rota antes de compartilhá-la.', 'ROUTE_NOT_FOUND');
      for (const invitation of result.invitations) {
        const targetSockets = result.room.participantSockets.get(invitation.targetParticipantId) || new Set();
        const target = result.room.participants.get(invitation.targetParticipantId);
        for (const targetSocketId of targetSockets) {
          io.to(targetSocketId).emit('route-share-invitation', versioned({
            invitationId: invitation.invitationId,
            participantId: result.participantId,
            participantName: result.sender.name,
            targetParticipantId: invitation.targetParticipantId,
            destination: invitation.route.destination
          }));
        }
      }
      if (typeof ack === 'function') ack(versioned({ ok: true, invited: result.invitations.map((item) => item.targetParticipantId) }));
    });

    socket.on('respond-route-share', (payload, ack) => {
      const invitationId = typeof payload?.invitationId === 'string' ? payload.invitationId.trim() : '';
      const result = store.resolveRouteShareInvitation(socket.id, invitationId, payload?.accepted === true);
      if (!result) return reject(ack, 'Convite de rota inválido ou expirado.', 'INVALID_ROUTE_INVITATION');
      const senderSockets = result.room.participantSockets.get(result.invitation.senderParticipantId) || new Set();
      for (const senderSocketId of senderSockets) {
        io.to(senderSocketId).emit('route-share-response', versioned({
          invitationId,
          participantId: result.participantId,
          accepted: result.accepted
        }));
      }
      if (result.accepted) {
        socket.emit('route-shared', versioned({ participantId: result.invitation.senderParticipantId, route: result.invitation.route }));
      }
      if (typeof ack === 'function') ack(versioned({ ok: true, accepted: result.accepted, route: result.accepted ? result.invitation.route : null }));
    });

    socket.on('send-location', (payload, ack) => {
      const membership = store.roomFor(socket.id);
      const update = cleanLocationUpdate(payload);
      if (!membership || !update) return reject(ack, 'Localização inválida ou participante fora da party.');
      if (!allowed(rate.location, LOCATION_RATE)) return reject(ack, 'Muitas atualizações de localização. Aguarde um momento.');
      const result = store.updateLocation(membership.roomId, membership.participantId, update);
      if (!result) return reject(ack, 'invalid-location');
      if (result.duplicate || result.paused) {
        if (typeof ack === 'function') ack(versioned({ ok: true, ...(result.duplicate ? { duplicate: true } : { paused: true }), locationSequence: result.locationSequence }));
        return;
      }
      const { location, locationSequence } = result;
      trafficStore?.observe(location);
      if (result.broadcast) {
        socket.to(membership.roomId).emit('participant-location', versioned({ participantId: membership.participantId, location, locationSequence }));
      }
      if (typeof ack === 'function') ack(versioned({ ok: true, locationSequence, ...(!result.broadcast ? { unchanged: true } : {}) }));
    });

    socket.on('publish-exploration-track', (payload, ack) => {
      const membership = store.roomFor(socket.id);
      const trackId = typeof payload?.trackId === 'string' ? payload.trackId.trim().slice(0, 100) : '';
      const userName = typeof payload?.userName === 'string' ? payload.userName.trim().slice(0, 100) : '';
      const points = Array.isArray(payload?.points) ? payload.points.slice(-5000) : [];
      const attentionPoints = Array.isArray(payload?.attentionPoints) ? payload.attentionPoints.slice(0, 100) : [];
      const validPoint = (point) => Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lng))
        && Number(point.lat) >= -90 && Number(point.lat) <= 90 && Number(point.lng) >= -180 && Number(point.lng) <= 180
        && Number.isFinite(Number(point?.timestamp));
      if (!membership || !/^track-[a-z0-9-]{8,100}$/i.test(trackId) || !userName || points.length < 2 || !points.every(validPoint)) {
        return reject(ack, 'Percurso de reconhecimento inválido.', 'INVALID_EXPLORATION_TRACK');
      }
      const normalized = {
        trackId,
        userName,
        startedAt: Number.isFinite(Number(payload.startedAt)) ? Number(payload.startedAt) : points[0].timestamp,
        endedAt: Number.isFinite(Number(payload.endedAt)) ? Number(payload.endedAt) : Date.now(),
        points: points.map((point) => ({ lat: Number(point.lat), lng: Number(point.lng), timestamp: Number(point.timestamp), ...(Number.isFinite(Number(point.accuracy)) ? { accuracy: Number(point.accuracy) } : {}) })),
        attentionPoints: attentionPoints.filter((point) => validPoint({ ...point, timestamp: point.createdAt || Date.now() })).map((point) => ({ id: String(point.id || '').slice(0, 100), type: String(point.type || 'outro').slice(0, 40), note: String(point.note || '').slice(0, 240), lat: Number(point.lat), lng: Number(point.lng), createdAt: Number(point.createdAt) || Date.now(), userName }))
      };
      membership.room.explorationTracks.set(trackId, normalized);
      while (membership.room.explorationTracks.size > 10) membership.room.explorationTracks.delete(membership.room.explorationTracks.keys().next().value);
      io.to(membership.roomId).emit('exploration-track', versioned({ ...normalized, participantId: membership.participantId }));
      if (typeof ack === 'function') ack(versioned({ ok: true, trackId, points: normalized.points.length, attentionPoints: normalized.attentionPoints.length }));
    });

    socket.on('update-route', async (payload, ack) => {
      const membership = store.roomFor(socket.id);
      const update = cleanRouteIntent(payload);
      if (!membership || !update) return reject(ack, 'Rota inválida ou participante fora da party.');
      const { commandId, routeRevision, scope } = update;
      const participant = membership.room.participants.get(membership.participantId);
      const locationTimestamp = participant?.location?.timestamp;
      if (scope === 'shared' && !store.routeSharingConsented(membership.roomId)) {
        return reject(ack, 'Todos os participantes devem consentir antes de compartilhar a rota.', 'ROUTE_SHARING_CONSENT_REQUIRED');
      }
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
      if (!allowed(rate.route, ROUTE_RATE)) return reject(ack, 'Muitas atualizacoes de rota. Aguarde um momento.');

      let route;
      try {
        const calculated = await routeService.calculate({
          contractVersion: CONTRACT_VERSION,
          profile: update.profile,
          origin: update.origin,
          destination: update.destination
        });
        route = cleanRoute({
          ...calculated,
          ...(update.routeOrigin ? { origin: update.routeOrigin } : {})
        });
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
        activeMembership.room.personalRoutes.set(activeMembership.participantId, enrichedRoute);
        socket.emit('navigation-rerouted', versioned(result));
        for (const viewerParticipantId of store.viewersForRoute(activeMembership.roomId, activeMembership.participantId)) {
          for (const viewerSocketId of activeMembership.room.participantSockets.get(viewerParticipantId) || []) {
            io.to(viewerSocketId).emit('route-shared', versioned({ participantId: activeMembership.participantId, route: enrichedRoute }));
          }
        }
      } else {
        activeMembership.room.route = enrichedRoute;
        io.to(activeMembership.roomId).emit('route-updated', enrichedRoute);
      }
      if (typeof ack === 'function') ack(versioned({ ok: true, ...result }));
    });

    socket.on('send-sos-signal', (payload, ack) => {
      const membership = store.roomFor(socket.id);
      const messageId = typeof payload?.messageId === 'string' ? payload.messageId.trim() : '';
      const message = typeof payload?.message === 'string' ? payload.message.trim().slice(0, 160) : '';
      const location = payload?.location && Number.isFinite(Number(payload.location.lat)) && Number.isFinite(Number(payload.location.lng))
        ? {
          lat: Number(payload.location.lat),
          lng: Number(payload.location.lng),
          ...(Number.isFinite(Number(payload.location.accuracy)) ? { accuracy: Number(payload.location.accuracy) } : {}),
          timestamp: Number.isFinite(Number(payload.location.timestamp)) ? Number(payload.location.timestamp) : Date.now()
        }
        : null;
      if (!membership || !/^sos-[a-z0-9-]{8,80}$/i.test(messageId)) {
        return reject(ack, 'Sinal SOS inválido.');
      }
      const participant = membership.room.participants.get(membership.participantId);
      socket.to(membership.roomId).emit('sos-signal', versioned({
        messageId,
        message: message || 'SOS — preciso de ajuda',
        participantId: membership.participantId,
        participantName: participant?.name || 'Participante',
        location,
        sentAt: Date.now()
      }));
      if (typeof ack === 'function') ack(versioned({ ok: true, messageId }));
    });
    socket.on('respond-sos', (payload, ack) => {
      const membership = store.roomFor(socket.id);
      const messageId = typeof payload?.messageId === 'string' ? payload.messageId.trim() : '';
      if (!membership || !/^sos-[a-z0-9-]{8,80}$/i.test(messageId)) return reject(ack, 'Resposta SOS inválida.');
      const participant = membership.room.participants.get(membership.participantId);
      const response = versioned({
        messageId,
        accepted: payload?.accepted === true,
        participantId: membership.participantId,
        participantName: participant?.name || 'Participante',
        respondedAt: Date.now()
      });
      io.to(membership.roomId).emit('sos-response', response);
      if (typeof ack === 'function') ack(versioned({ ok: true, ...response }));
    });
    socket.on('send-direct-message', (payload, ack) => {
      const membership = store.roomFor(socket.id);
      const targetParticipantId = typeof payload?.targetParticipantId === 'string' ? payload.targetParticipantId.trim() : '';
      const text = typeof payload?.text === 'string' ? payload.text.trim().slice(0, 500) : '';
      if (!membership || !targetParticipantId || !text) return reject(ack, 'Destinatario e mensagem sao obrigatorios.');
      if (targetParticipantId === membership.participantId) return reject(ack, 'Escolha outro participante.');
      const target = membership.room.participants.get(targetParticipantId);
      const targetSockets = membership.room.participantSockets.get(targetParticipantId);
      if (!target || !targetSockets?.size) return reject(ack, 'Participante indisponivel.', 'PARTICIPANT_UNAVAILABLE');
      const sender = membership.room.participants.get(membership.participantId);
      const message = versioned({
        messageId: `dm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        senderParticipantId: membership.participantId,
        senderName: sender?.name || 'Participante',
        targetParticipantId,
        text,
        sentAt: Date.now()
      });
      for (const targetSocketId of targetSockets) io.to(targetSocketId).emit('direct-message', message);
      if (typeof ack === 'function') ack(versioned({ ok: true, messageId: message.messageId }));
    });
    socket.on('disconnect', () => {
      const disconnected = store.disconnect(socket.id);
      if (!disconnected) return;
      const { roomId, participantId, retained, participantRecoveryVersion, roomRecoveryVersion } = disconnected;
      if (store.rooms.has(roomId)) emitPartySnapshots(io, store, roomId);
      const timer = setTimeout(() => {
        const participantExpired = retained && store.expireParticipant(roomId, participantId, participantRecoveryVersion);
        const roomExpired = store.expireRoom(roomId, roomRecoveryVersion);
        if (participantExpired && !roomExpired && store.rooms.has(roomId)) {
          emitPartySnapshots(io, store, roomId);
        }
      }, graceMs);
      timer.unref?.();
    });
  });
  return store;
}
