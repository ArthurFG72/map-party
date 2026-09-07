const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];
export const MAX_ROOM_PARTICIPANTS = 50;
export const MAX_PROCESSED_ROUTE_COMMANDS = 100;

function colorFor(seed) {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}

export class PartyStore {
  constructor({ maxRoomParticipants = MAX_ROOM_PARTICIPANTS } = {}) {
    this.rooms = new Map();
    this.memberships = new Map();
    this.maxRoomParticipants = maxRoomParticipants;
  }

  join(socketId, roomId, name) {
    const previousRoomId = this.memberships.get(socketId) ?? null;
    if (previousRoomId === roomId) {
      const participant = this.rooms.get(roomId)?.participants.get(socketId);
      if (participant) {
        participant.name = name;
        return { participant, previousRoomId, changedRoom: false };
      }
    }
    const target = this.rooms.get(roomId);
    if (target && target.participants.size >= this.maxRoomParticipants) return null;
    this.leave(socketId);
    const room = this.rooms.get(roomId) ?? {
      participants: new Map(),
      route: null,
      locationSequences: new Map(),
      routeCommands: new Map()
    };
    room.locationSequences ??= new Map();
    room.routeCommands ??= new Map();
    const participant = { id: socketId, name, color: colorFor(`${roomId}:${name}`), location: null };
    room.participants.set(socketId, participant);
    this.rooms.set(roomId, room);
    this.memberships.set(socketId, roomId);
    return { participant, previousRoomId, changedRoom: previousRoomId !== roomId };
  }

  leave(socketId) {
    const roomId = this.memberships.get(socketId);
    if (!roomId) return null;
    const room = this.rooms.get(roomId);
    room?.participants.delete(socketId);
    room?.locationSequences?.delete(socketId);
    this.memberships.delete(socketId);
    if (room && room.participants.size === 0) this.rooms.delete(roomId);
    return roomId;
  }

  roomFor(socketId) {
    const roomId = this.memberships.get(socketId);
    return roomId ? { roomId, room: this.rooms.get(roomId) } : null;
  }

  snapshot(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    return { roomId, participants: [...room.participants.values()], route: room.route };
  }

  locationSequence(socketId) {
    const membership = this.roomFor(socketId);
    return membership?.room.locationSequences?.get(socketId) ?? null;
  }

  setLocationSequence(socketId, sequence) {
    const membership = this.roomFor(socketId);
    if (!membership || sequence == null) return;
    membership.room.locationSequences ??= new Map();
    membership.room.locationSequences.set(socketId, sequence);
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
