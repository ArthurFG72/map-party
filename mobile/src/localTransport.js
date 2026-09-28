export const MAX_QUEUE = 20;
const SERVICE_ID = 'com.arthur.mapparty.offline';
const VERIFICATION_EVENTS = new Set([
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
    : item.type || 'message';
}

export function createLocalTransport({ roomId, participantId, onMessage, onVerification, onStatus, onEvent } = {}) {
  let bridge = nativeBridge();
  let running = false;
  let unsubscribe;
  const queue = [];

  function receive(message) {
    if (!message || typeof message !== 'object') return;
    if (message.message && typeof message.message === 'object') return receive(message.message);
    if (message.roomId !== roomId) return;
    if (message.type === 'message' && message.payload && typeof message.payload === 'object') return receive(message.payload);
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
    if (type === 'status' || type === 'connected' || type === 'disconnected') return onStatus?.(event.status || type, event);
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
      try { await bridge.send(queue[0]); queue.shift(); } catch { break; }
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
      await bridge.start({ roomId, participantId, serviceId: SERVICE_ID });
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

  async function send(message) {
    if (!message || typeof message !== 'object') return false;
    if (message.roomId && message.roomId !== roomId) return false;
    const item = { roomId, ...message };
    if (bridge && running && typeof bridge.send === 'function') {
      try { await bridge.send(item); return true; } catch { /* Keep it for reconnection. */ }
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

  return { start, stop, send, verifyConnection, takeQueue, status, get running() { return running; } };
}

export function localTransportCapabilities() {
  const bridge = nativeBridge();
  return { platform: globalThis?.navigator?.userAgent || 'native', available: Boolean(bridge), name: bridge ? 'native' : 'offline-queue' };
}
