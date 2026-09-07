import { createHash, randomUUID } from 'node:crypto';

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];
export const MAX_ROOM_PARTICIPANTS = 50;
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
    locationSequences: new Map(),
    routeCommands: new Map()
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
  return room;
}

export class PartyStore {
  constructor({ maxRoomParticipants = MAX_ROOM_PARTICIPANTS } = {}) {
    this.rooms = new Map();
    this.memberships = new Map();
    this.maxRoomParticipants = maxRoomParticipants;
  }

  join(socketId, roomId, name, participantToken = null) {
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
        return { participant, previousRoomId, changedRoom: false };
      }
    }
    const target = this.rooms.has(roomId) ? ensureRoomState(this.rooms.get(roomId)) : null;
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
      online: true,
      lastSeenAt: Date.now()
    };
    participant.name = name;
    participant.online = true;
    participant.lastSeenAt = Date.now();
    room.participants.set(participantId, participant);
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

  snapshot(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    return { roomId, participants: [...room.participants.values()], route: room.route };
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
