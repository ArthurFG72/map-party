const COMMANDS = new Set([
  'navigation.start', 'navigation.cancel', 'navigation.pause', 'navigation.resume',
  'navigation.reroute', 'navigation.set_destination', 'navigation.get_status',
  'navigation.get_position', 'navigation.search_place', 'navigation.add_waypoint',
  'navigation.remove_waypoint', 'location.get', 'location.share',
  'message.send', 'sos.send'
]);

function requestId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value) ? value : null;
}

function destination(value) {
  if (!value || typeof value !== 'object') return null;
  const query = typeof value.query === 'string' ? value.query.trim().slice(0, 160) : '';
  // A remote AI may name a place, but cannot take ownership of device GPS.
  if (!query) return null;
  return { query };
}

function text(value, max = 500) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

export function cleanNavigationCommand(value) {
  if (!value || typeof value !== 'object') return null;
  const action = typeof value.command === 'string' ? value.command : value.action;
  if (!COMMANDS.has(action)) return null;
  const parameters = value.parameters && typeof value.parameters === 'object' && !Array.isArray(value.parameters)
    ? value.parameters : value;
  const id = requestId(value.request_id);
  if (!id) return null;
  if (action === 'navigation.start' || action === 'navigation.set_destination') {
    const target = destination(parameters.destination || parameters);
    if (!target) return null;
    return { command: action, request_id: id, destination: target };
  }
  if (action === 'message.send') {
    const targetParticipantId = text(parameters.target_participant_id, 128);
    const message = text(parameters.text);
    if (!targetParticipantId || !message) return null;
    return { command: action, request_id: id, target_participant_id: targetParticipantId, text: message };
  }
  if (action === 'sos.send') {
    const message = text(parameters.message, 240);
    return { command: action, request_id: id, ...(message ? { message } : {}) };
  }
  if (action === 'location.share') {
    if (typeof parameters.enabled !== 'boolean') return null;
    return { command: action, request_id: id, enabled: parameters.enabled };
  }
  return { command: action, request_id: id };
}
