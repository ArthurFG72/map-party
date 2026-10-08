import { createHash, constants, privateDecrypt } from 'node:crypto';

const MAGIC = 0x4d50534f; // MPSO
const VERSION = 1;
const PACKET_BYTES = 32;
const MAX_CIPHERTEXT_BYTES = 512;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

export function normalizePem(value) {
  let pem = typeof value === 'string' ? value.replace(/\\n/g, '\n').trim() : '';
  if (!pem.includes('\n') && pem.includes('-----BEGIN') && pem.includes('n-----END')) {
    const headerEnd = pem.indexOf('-----', 10) + 5;
    const footerStart = pem.lastIndexOf('n-----END');
    const header = pem.slice(0, headerEnd);
    const footer = pem.slice(footerStart + 1);
    const rawBody = pem.slice(headerEnd, footerStart);
    let body = '';
    let lineLength = 0;
    for (const character of rawBody) {
      if (character === 'n' && (lineLength === 0 || lineLength === 64)) {
        lineLength = 0;
        continue;
      }
      body += character;
      lineLength += 1;
    }
    pem = `${header}\n${body.match(/.{1,64}/g)?.join('\n') || body}\n${footer}`;
  }
  return pem;
}

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function fromBase64url(value, maxBytes = MAX_CIPHERTEXT_BYTES) {
  if (typeof value !== 'string' || !value || !BASE64URL_RE.test(value)) return null;
  const buffer = Buffer.from(value, 'base64url');
  return buffer.length > 0 && buffer.length <= maxBytes ? buffer : null;
}

export function emergencyKeyId(publicKeyPem) {
  const pem = normalizePem(publicKeyPem);
  if (!pem) return null;
  return base64url(createHash('sha256').update(pem).digest()).slice(0, 16);
}

export function decodeEmergencyPayload(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length !== PACKET_BYTES) return null;
  if (buffer.readUInt32BE(0) !== MAGIC || buffer.readUInt8(4) !== VERSION) return null;
  const type = buffer.readUInt8(5);
  const timestamp = Number(buffer.readBigUInt64BE(8));
  const lat = buffer.readInt32BE(16) / 10_000_000;
  const lng = buffer.readInt32BE(20) / 10_000_000;
  const accuracy = buffer.readUInt16BE(24);
  const battery = buffer.readUInt8(26);
  const sequence = buffer.readUInt32BE(28);
  if (![1, 2].includes(type) || !Number.isSafeInteger(timestamp)
    || lat < -90 || lat > 90 || lng < -180 || lng > 180 || battery > 100) return null;
  return { version: VERSION, type: type === 2 ? 'sos' : 'location', timestamp, lat, lng, accuracy, battery, sequence };
}

export function decryptEmergencyPacket(ciphertext, privateKeyPem) {
  const pem = normalizePem(privateKeyPem);
  if (!pem) return null;
  try {
    return decodeEmergencyPayload(privateDecrypt({
      key: pem,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256'
    }, ciphertext));
  } catch {
    return null;
  }
}

export function cleanSealedEmergencyPacket(value, expectedKeyId) {
  if (!value || typeof value !== 'object') return null;
  const keyId = typeof value.keyId === 'string' ? value.keyId.trim() : '';
  if (!keyId || (expectedKeyId && keyId !== expectedKeyId)) return null;
  const ciphertext = fromBase64url(value.ciphertext);
  if (!ciphertext) return null;
  const packetId = base64url(createHash('sha256').update(ciphertext).digest()).slice(0, 32);
  return { keyId, packetId, ciphertext };
}

export function createEmergencyStore({ maxPackets = 1000 } = {}) {
  const packets = new Map();
  return {
    remember(packetId, payload) {
      if (packets.has(packetId)) return false;
      packets.set(packetId, { ...payload, receivedAt: Date.now() });
      while (packets.size > maxPackets) packets.delete(packets.keys().next().value);
      return true;
    },
    has(packetId) {
      return packets.has(packetId);
    },
    all() {
      return [...packets.values()];
    }
  };
}
