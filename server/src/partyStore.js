import { createHash, randomUUID } from 'node:crypto';

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];
export const MAX_ROOM_PARTICIPANTS = 50;
export const MAX_ROOMS = 1000;
export const MAX_PROCESSED_ROUTE_COMMANDS = 100;

function colorFor(seed) {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}

function hashParticipantToken(roomId, token) {
  return createHash('sha256').update(`${roomId}:${token}`).digest('hex');
}

function createRoom() {
  return {
    participants: new Map(),
    participantSockets: new Map(),
    participantTokens: new Map(),
    tokenByParticipant: new Map(),
    participantRecoveryVersions: new Map(),
    recoveryVersion: 0,
    route: null,
    personalRoutes: new Map(),
    routePermissions: new Map(),
    routeShareInvitations: new Map(),
    locationSequences: new Map(),
    routeCommands: new Map(),
    explorationTracks: new Map()
  };
}

function ensureRoomState(room) {
  room.participantSockets ??= new Map();
  room.participantTokens ??= new Map();
  room.tokenByParticipant ??= new Map();
  room.participantRecoveryVersions ??= new Map();
  room.recoveryVersion ??= 0;
  room.locationSequences ??= new Map();
  room.routeCommands ??= new Map();
  room.personalRoutes ??= new Map();
  room.routePermissions ??= new Map();
  room.routeShareInvitations ??= new Map();
  room.explorationTracks ??= new Map();
  return room;
}

export class PartyStore {
  constructor({ maxRoomParticipants = MAX_ROOM_PARTICIPANTS, maxRooms = MAX_ROOMS } = {}) {
    this.rooms = new Map();
    this.memberships = new Map();
    this.maxRoomParticipants = Number.isSafeInteger(maxRoomParticipants) && maxRoomParticipants > 0
      ? maxRoomParticipants : MAX_ROOM_PARTICIPANTS;
    this.maxRooms = Number.isSafeInteger(maxRooms) && maxRooms > 0 ? maxRooms : MAX_ROOMS;
  }

  join(socketId, roomId, name, participantToken = null, visible = true) {
    const previousMembership = this.memberships.get(socketId) ?? null;
    const previousRoomId = previousMembership?.roomId ?? null;
    const tokenHash = participantToken ? hashParticipantToken(roomId, participantToken) : null;
    if (previousRoomId === roomId) {
      const room = ensureRoomState(this.rooms.get(roomId));
      const participant = room?.participants.get(previousMembership.participantId);
      const currentTokenHash = room?.tokenByParticipant.get(previousMembership.participantId) ?? null;
      if (participant && currentTokenHash === tokenHash) {
        participant.name = name;
        participant.online = true;
        participant.visible = visible;
        return { participant, previousRoomId, changedRoom: false };
      }
    }
    const target = this.rooms.has(roomId) ? ensureRoomState(this.rooms.get(roomId)) : null;
    if (!target && this.rooms.size >= this.maxRooms) return null;
    const existingParticipantId = tokenHash ? target?.participantTokens.get(tokenHash) : null;
    if (target && !existingParticipantId && target.participants.size >= this.maxRoomParticipants) return null;
    const detached = this.#detach(socketId, false);
    if (detached?.room?.participants.size === 0 && detached.roomId !== roomId) this.rooms.delete(detached.roomId);
    const room = this.rooms.has(roomId) ? ensureRoomState(this.rooms.get(roomId)) : createRoom();
    const participantId = existingParticipantId || (participantToken ? randomUUID() : socketId);
    const participant = room.participants.get(participantId) ?? {
      id: participantId,
      name,
      color: colorFor(`${roomId}:${name}`),
      location: null,
      visible: true,
      routeSharingConsent: false,
      online: true,
      lastSeenAt: Date.now()
    };
    participant.name = name;
    participant.online = true;
    participant.visible = visible;
    participant.routeSharingConsent ??= false;
    participant.lastSeenAt = Date.now();
    room.participants.set(participantId, participant);
    if (room.route?.scope === 'shared' && !this.routeSharingConsented(roomId)) room.route = null;
    room.recoveryVersion += 1;
    room.participantRecoveryVersions.set(
      participantId,
      (room.participantRecoveryVersions.get(participantId) || 0) + 1
    );
    const sockets = room.participantSockets.get(participantId) ?? new Set();
    sockets.add(socketId);
    room.participantSockets.set(participantId, sockets);
    if (tokenHash) {
      room.participantTokens.set(tokenHash, participantId);
      room.tokenByParticipant.set(participantId, tokenHash);
    }
    this.rooms.set(roomId, room);
    this.memberships.set(socketId, { roomId, participantId });
    return { participant, previousRoomId, changedRoom: previousRoomId !== roomId };
  }

  leave(socketId) {
    const detached = this.#detach(socketId, false);
    if (!detached) return null;
    const { roomId, room } = detached;
    if (room.participants.size === 0) this.rooms.delete(roomId);
    return roomId;
  }

  disconnect(socketId) {
    const detached = this.#detach(socketId, true);
    if (!detached?.room) return detached;
    detached.room.recoveryVersion += 1;
    detached.roomRecoveryVersion = detached.room.recoveryVersion;
    if (detached.retained) {
      const participantRecoveryVersion = (detached.room.participantRecoveryVersions.get(detached.participantId) || 0) + 1;
      detached.room.participantRecoveryVersions.set(detached.participantId, participantRecoveryVersion);
      detached.participantRecoveryVersion = participantRecoveryVersion;
    }
    return detached;
  }

  #detach(socketId, retainTokenParticipant) {
    const membership = this.memberships.get(socketId);
    if (!membership) return null;
    const { roomId, participantId } = membership;
    const room = this.rooms.get(roomId);
    this.memberships.delete(socketId);
    if (!room) return { roomId, participantId, room: null, retained: false };
    ensureRoomState(room);
    const sockets = room.participantSockets.get(participantId);
    sockets?.delete(socketId);
    if (sockets?.size) return { roomId, participantId, room, retained: false };
    room.participantSockets.delete(participantId);
    const participant = room.participants.get(participantId);
    const hasToken = room.tokenByParticipant.has(participantId);
    if (participant && retainTokenParticipant && hasToken) {
      participant.online = false;
      participant.lastSeenAt = Date.now();
      return { roomId, participantId, room, retained: true };
    }
    this.#removeParticipant(room, participantId);
    return { roomId, participantId, room, retained: false };
  }

  #removeParticipant(room, participantId) {
    room.participants.delete(participantId);
    room.participantSockets.delete(participantId);
    room.locationSequences.delete(participantId);
    room.personalRoutes.delete(participantId);
    for (const key of room.routePermissions.keys()) {
      if (key.startsWith(`${participantId}:`) || key.endsWith(`:${participantId}`)) room.routePermissions.delete(key);
    }
    for (const [invitationId, invitation] of room.routeShareInvitations) {
      if (invitation.senderParticipantId === participantId || invitation.targetParticipantId === participantId) {
        room.routeShareInvitations.delete(invitationId);
      }
    }
    room.participantRecoveryVersions.delete(participantId);
    const tokenHash = room.tokenByParticipant.get(participantId);
    if (tokenHash) room.participantTokens.delete(tokenHash);
    room.tokenByParticipant.delete(participantId);
  }

  expireParticipant(roomId, participantId, recoveryVersion) {
    const room = this.rooms.get(roomId);
    const participant = room?.participants.get(participantId);
    if (!room || !participant || participant.online || room.participantSockets.get(participantId)?.size
      || (recoveryVersion != null && room.participantRecoveryVersions.get(participantId) !== recoveryVersion)) return false;
    this.#removeParticipant(room, participantId);
    return true;
  }

  expireRoom(roomId, recoveryVersion) {
    const room = this.rooms.get(roomId);
    if (!room || (recoveryVersion != null && room.recoveryVersion !== recoveryVersion)
      || [...room.participants.values()].some((participant) => participant.online)) return false;
    this.rooms.delete(roomId);
    return true;
  }

  roomFor(socketId) {
    const membership = this.memberships.get(socketId);
    return membership ? { ...membership, room: this.rooms.get(membership.roomId) } : null;
  }

  snapshot(roomId, viewerParticipantId = null) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    return {
      roomId,
      participants: [...room.participants.values()].map((participant) => ({
        ...participant,
        sharingPaused: participant.visible === false
      })),
      route: room.route,
      explorationTracks: [...room.explorationTracks.values()]
    };
  }

  routeSharingConsented(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    const participants = [...room.participants.values()].filter((participant) => participant.online);
    return participants.length > 0 && participants.every((participant) => participant.routeSharingConsent === true);
  }

  setRouteSharingConsent(socketId, enabled) {
    const membership = this.roomFor(socketId);
    if (!membership) return null;
    const participant = membership.room.participants.get(membership.participantId);
    if (!participant) return null;
    participant.routeSharingConsent = Boolean(enabled);
    if (!this.routeSharingConsented(membership.roomId) && membership.room.route?.scope === 'shared') {
      membership.room.route = null;
    }
    return { ...membership, participant, ready: this.routeSharingConsented(membership.roomId) };
  }

  setRoutePermission(socketId, targetParticipantId, enabled) {
    const membership = this.roomFor(socketId);
    if (!membership || !membership.room.participants.has(targetParticipantId) || targetParticipantId === membership.participantId) return null;
    const key = `${membership.participantId}:${targetParticipantId}`;
    if (enabled) membership.room.routePermissions.set(key, true);
    else membership.room.routePermissions.delete(key);
    return {
      ...membership,
      enabled: Boolean(enabled),
      targetParticipantId,
      route: enabled ? membership.room.personalRoutes.get(targetParticipantId) || null : null
    };
  }

  createRouteShareInvitations(socketId, targetParticipantIds) {
    const membership = this.roomFor(socketId);
    if (!membership) return null;
    const sender = membership.room.participants.get(membership.participantId);
    const route = membership.room.personalRoutes.get(membership.participantId) || membership.room.route;
    if (!sender || !route) return { ...membership, invitations: [], route: null };
    const targets = [...new Set(targetParticipantIds)].filter((id) => (
      id && id !== membership.participantId && membership.room.participants.has(id)
    ));
    const invitations = targets.map((targetParticipantId) => {
      for (const [pendingId, pending] of membership.room.routeShareInvitations) {
        if (pending.senderParticipantId === membership.participantId && pending.targetParticipantId === targetParticipantId) {
          membership.room.routeShareInvitations.delete(pendingId);
        }
      }
      const invitationId = randomUUID();
      membership.room.routeShareInvitations.set(invitationId, {
        invitationId,
        senderParticipantId: membership.participantId,
        targetParticipantId,
        route,
        createdAt: Date.now()
      });
      return { invitationId, targetParticipantId, route };
    });
    return { ...membership, sender, route, invitations };
  }

  pendingRouteShareInvitations(roomId, targetParticipantId) {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return [...room.routeShareInvitations.values()]
      .filter((invitation) => invitation.targetParticipantId === targetParticipantId)
      .map((invitation) => ({
        invitationId: invitation.invitationId,
        participantId: invitation.senderParticipantId,
        participantName: room.participants.get(invitation.senderParticipantId)?.name || 'Participante',
        targetParticipantId,
        destination: invitation.route.destination
      }));
  }

  resolveRouteShareInvitation(socketId, invitationId, accepted) {
    const membership = this.roomFor(socketId);
    const invitation = membership?.room.routeShareInvitations.get(invitationId);
    if (!membership || !invitation || invitation.targetParticipantId !== membership.participantId) return null;
    membership.room.routeShareInvitations.delete(invitationId);
    if (accepted) membership.room.routePermissions.set(`${membership.participantId}:${invitation.senderParticipantId}`, true);
    return { ...membership, invitation, accepted: Boolean(accepted) };
  }

  routePermission(roomId, viewerParticipantId, ownerParticipantId) {
    return this.rooms.get(roomId)?.routePermissions?.get(`${viewerParticipantId}:${ownerParticipantId}`) === true;
  }

  viewersForRoute(roomId, ownerParticipantId) {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return [...room.participants.keys()].filter((viewerId) => this.routePermission(roomId, viewerId, ownerParticipantId));
  }

  locationSequence(socketId) {
    const membership = this.roomFor(socketId);
    return membership?.room.locationSequences?.get(membership.participantId) ?? null;
  }

  setLocationSequence(socketId, sequence) {
    const membership = this.roomFor(socketId);
    if (!membership || sequence == null) return;
    membership.room.locationSequences ??= new Map();
    membership.room.locationSequences.set(membership.participantId, sequence);
  }

  routeCommand(roomId, commandId) {
    return commandId ? this.rooms.get(roomId)?.routeCommands?.get(commandId) ?? null : null;
  }

  rememberRouteCommand(roomId, commandId, route) {
    if (!commandId) return;
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.routeCommands ??= new Map();
    room.routeCommands.set(commandId, route);
    while (room.routeCommands.size > MAX_PROCESSED_ROUTE_COMMANDS) {
      room.routeCommands.delete(room.routeCommands.keys().next().value);
    }
  }
}
