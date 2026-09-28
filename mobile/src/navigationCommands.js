const LOCAL = new Set([
  'navigation.cancel', 'navigation.pause', 'navigation.resume', 'navigation.get_status',
  'navigation.get_position', 'location.get', 'location.share', 'message.send', 'sos.send'
]);
const ALL = new Set([...LOCAL, 'navigation.start', 'navigation.reroute', 'navigation.set_destination', 'navigation.search_place', 'navigation.add_waypoint', 'navigation.remove_waypoint']);

export function validateNavigationCommand(value) {
  if (!value || typeof value !== 'object' || typeof value.command !== 'string' || !ALL.has(value.command)) return null;
  const requestId = typeof value.request_id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value.request_id) ? value.request_id : null;
  if (!requestId) return null;
  if (['navigation.start', 'navigation.set_destination'].includes(value.command)) {
    const destination = value.destination;
    if (!destination || typeof destination !== 'object') return null;
    const query = typeof destination.query === 'string' ? destination.query.trim().slice(0, 160) : '';
    const latitude = destination.latitude;
    const longitude = destination.longitude;
    if (!query && !(Number.isFinite(latitude) && Number.isFinite(longitude))) return null;
    return { command: value.command, request_id: requestId, destination: { ...(query ? { query } : {}), ...(Number.isFinite(latitude) ? { latitude } : {}), ...(Number.isFinite(longitude) ? { longitude } : {}) } };
  }
  if (value.command === 'location.share') {
    if (typeof value.enabled !== 'boolean') return null;
    return { command: value.command, request_id: requestId, enabled: value.enabled };
  }
  if (value.command === 'message.send') {
    const targetParticipantId = typeof value.target_participant_id === 'string' ? value.target_participant_id.trim().slice(0, 128) : '';
    const text = typeof value.text === 'string' ? value.text.trim().slice(0, 500) : '';
    if (!targetParticipantId || !text) return null;
    return { command: value.command, request_id: requestId, target_participant_id: targetParticipantId, text };
  }
  if (value.command === 'sos.send') {
    const message = typeof value.message === 'string' ? value.message.trim().slice(0, 240) : '';
    return { command: value.command, request_id: requestId, ...(message ? { message } : {}) };
  }
  return { command: value.command, request_id: requestId };
}

export function isLocalNavigationCommand(command) {
  return Boolean(command && LOCAL.has(command));
}
