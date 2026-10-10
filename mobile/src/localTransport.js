export const MAX_QUEUE = 20;
export const MAX_ENVELOPE_BYTES = 16 * 1024;
export const MAX_TTL_MS = 180_000;
export const MAX_HOPS = 3;
const MAX_SEEN = 512;
const SERVICE_ID = 'com.arthur.mapparty.offline';
const VERIFICATION_EVENTS = new Set([
  'connectionVerification',
  'verificationRequired',
  'connectionVerificationRequested',
  'verificationCompleted',
  'verificationFailed',
  'connectionVerified'
]);

function nativeBridge() {
  const bridge = globalThis?.MapPartyLocalTransport;
  return bridge && typeof bridge.start === 'function' && typeof bridge.stop === 'function' ? bridge : null;
}

function cleanup(subscription) {
  if (typeof subscription === 'function') return subscription;
  if (subscription && typeof subscription.remove === 'function') return () => subscription.remove();
  return undefined;
}

function queueKey(item) {
  return item.type === 'emergency' && item.packet?.ciphertext
    ? `emergency:${item.packet.ciphertext}`
    : item.type === 'location'
      ? `location:${item.participantId || 'self'}`
      : item.messageId
        ? `${item.type || 'message'}:${item.messageId}`
        : item.type || 'message';
}

function byteLength(value) {
  try {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(value).length;
  } catch { /* Use the conservative fallback below. */ }
  return unescape(encodeURIComponent(value)).length;
}

function envelope(message, roomId) {
  const now = Date.now();
  const createdAt = Number.isFinite(Number(message.createdAt)) ? Number(message.createdAt) : now;
  const expiresAt = Math.min(
    Number.isFinite(Number(message.expiresAt)) ? Number(message.expiresAt) : now + MAX_TTL_MS,
    createdAt + MAX_TTL_MS
  );
  const item = {
    roomId,
    ...message,
    messageId: typeof message.messageId === 'string' && message.messageId.trim()
      ? message.messageId.trim().slice(0, 96)
      : `local-${now}-${Math.random().toString(36).slice(2, 10)}`,
    createdAt,
    expiresAt,
    hops: Math.min(Math.max(Number(message.hops) || 0, 0), MAX_HOPS)
  };
  if (byteLength(JSON.stringify(item)) > MAX_ENVELOPE_BYTES) return null;
  return item;
}

export function createLocalTransport({ roomId, participantId, onMessage, onVerification, onStatus, onEvent } = {}) {
  let bridge = nativeBridge();
  let currentParticipantId = participantId;
  let running = false;
  let unsubscribe;
  const queue = [];
  const seen = new Set();
  const seenOrder = [];

  function remember(messageId) {
    if (!messageId) return true;
    if (seen.has(messageId)) return false;
    seen.add(messageId);
    seenOrder.push(messageId);
    while (seenOrder.length > MAX_SEEN) seen.delete(seenOrder.shift());
    return true;
  }

  function receive(message) {
    if (!message || typeof message !== 'object') return;
    if (message.message && typeof message.message === 'object') return receive(message.message);
    if (message.roomId !== roomId) return;
    if (message.type === 'message' && message.payload && typeof message.payload === 'object') return receive(message.payload);
    if (message.expiresAt != null && Number(message.expiresAt) <= Date.now()) return;
    if (message.hops != null && (Number(message.hops) < 0 || Number(message.hops) > MAX_HOPS)) return;
    if (!remember(message.messageId)) return;
    onMessage?.(message);
  }

  function handleEvent(event) {
    if (!event || typeof event !== 'object') return;
    if (typeof event.json === 'string') {
      try { return receive(JSON.parse(event.json)); } catch { return; }
    }
    onEvent?.(event);
    const type = typeof event.type === 'string' ? event.type : '';
    if (VERIFICATION_EVENTS.has(type)) return onVerification?.(event);
    if (type === 'status' || type === 'connected' || type === 'disconnected') {
      onStatus?.(event.status || type, event);
      if (type === 'started' || type === 'connected' || event.status === 'connected') flushQueue();
      return;
    }
    if (type === 'started') { onStatus?.('started', event); flushQueue(); return; }
    if (type === 'message' || type === 'data' || event.roomId || event.message) receive(event);
  }

  function subscribe() {
    if (typeof bridge?.subscribe === 'function') return cleanup(bridge.subscribe(handleEvent));
    if (typeof bridge?.onEvent === 'function') return cleanup(bridge.onEvent(handleEvent));
    if (typeof bridge?.onMessage === 'function') return cleanup(bridge.onMessage(handleEvent));
    if (typeof bridge?.addListener === 'function') return cleanup(bridge.addListener('event', handleEvent));
    return undefined;
  }

  function status() { return bridge ? 'available' : 'unavailable'; }

  async function flushQueue() {
    if (!bridge || !running || typeof bridge.send !== 'function') return;
    while (queue.length) {
      try {
        if (await bridge.send(queue[0]) !== true) break;
        queue.shift();
      } catch { break; }
    }
  }

  async function start() {
    if (running) return status();
    running = true;
    bridge = nativeBridge();
    if (!bridge) return status();
    if (typeof bridge.requestPermissions === 'function' && !(await bridge.requestPermissions())) {
      running = false;
      onStatus?.('permissionsRequired');
      return status();
    }
    unsubscribe = subscribe();
    try {
      await bridge.start({ roomId, participantId: currentParticipantId, serviceId: SERVICE_ID });
      await flushQueue();
      onStatus?.('started');
    } catch (error) {
      onStatus?.('error', error);
    }
    return status();
  }

  async function stop() {
    running = false;
    unsubscribe?.();
    unsubscribe = undefined;
    if (bridge) await bridge.stop();
  }

  async function setIdentity(nextParticipantId) {
    if (typeof nextParticipantId !== 'string' || !nextParticipantId.trim()) return false;
    const next = nextParticipantId.trim();
    if (next === currentParticipantId) return true;
    currentParticipantId = next;
    if (!running || !bridge) return true;
    await bridge.stop();
    await bridge.start({ roomId, participantId: currentParticipantId, serviceId: SERVICE_ID });
    return true;
  }

  async function send(message) {
    if (!message || typeof message !== 'object') return false;
    if (message.roomId && message.roomId !== roomId) return false;
    const item = envelope(message, roomId);
    if (!item) return false;
    if (bridge && running && typeof bridge.send === 'function') {
      try {
        const accepted = await bridge.send(item);
        if (accepted === true) return true;
      } catch { /* Keep it for reconnection. */ }
    }
    const queued = { ...item, queuedAt: Date.now() };
    const key = queueKey(queued);
    const withoutSame = queue.filter((current) => queueKey(current) !== key);
    queue.splice(0, queue.length, ...withoutSame.slice(-(MAX_QUEUE - 1)), queued);
    return false;
  }

  async function verifyConnection(endpointId, accepted = true) {
    if (!bridge || typeof bridge.verifyConnection !== 'function') return false;
    await bridge.verifyConnection({ endpointId, accepted: Boolean(accepted) });
    return true;
  }

  function takeQueue() { return queue.splice(0, queue.length); }

  return { start, stop, setIdentity, send, verifyConnection, takeQueue, status, get running() { return running; } };
}

export function localTransportCapabilities() {
  const bridge = nativeBridge();
  return { platform: globalThis?.navigator?.userAgent || 'native', available: Boolean(bridge), name: bridge ? 'native' : 'offline-queue' };
}
