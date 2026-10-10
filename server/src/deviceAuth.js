import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const TOKEN_VERSION = 1;
const MIN_SECRET_LENGTH = 32;

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function decode(value) {
  try { return Buffer.from(value, 'base64url').toString('utf8'); } catch { return null; }
}

function ownerId(participantToken) {
  return createHash('sha256').update(participantToken).digest('base64url');
}

function signature(secret, encodedPayload) {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

export function createDeviceAuth({ secret, now = () => Date.now(), ttlMs = 24 * 60 * 60 * 1000 } = {}) {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
    throw new Error('DEVICE_AUTH_SECRET must contain at least 32 characters.');
  }
  if (!Number.isFinite(ttlMs) || ttlMs < 60_000) throw new Error('Device token TTL is invalid.');

  function issue({ deviceId, participantToken, roomId = null, participantId = null }) {
    if (typeof deviceId !== 'string' || typeof participantToken !== 'string' || !participantToken) return null;
    const issuedAt = now();
    const payload = {
      v: TOKEN_VERSION,
      did: deviceId,
      sub: ownerId(participantToken),
      ...(typeof roomId === 'string' && roomId ? { rid: roomId } : {}),
      ...(typeof participantId === 'string' && participantId ? { pid: participantId } : {}),
      iat: issuedAt,
      exp: issuedAt + ttlMs
    };
    const encoded = base64url(JSON.stringify(payload));
    return `${encoded}.${signature(secret, encoded)}`;
  }

  function verify(token) {
    if (typeof token !== 'string') return null;
    const [encoded, provided] = token.split('.');
    if (!encoded || !provided || token.split('.').length !== 2) return null;
    const expected = Buffer.from(signature(secret, encoded));
    const received = Buffer.from(provided);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
    let payload;
    try { payload = JSON.parse(decode(encoded)); } catch { return null; }
    if (!payload || payload.v !== TOKEN_VERSION || typeof payload.did !== 'string' || typeof payload.sub !== 'string' ||
        !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) || payload.exp <= now()) return null;
    return payload;
  }

  function authorizes(token, deviceId) {
    const payload = verify(token);
    return payload?.did === deviceId ? payload : null;
  }

  return { issue, verify, authorizes };
}
