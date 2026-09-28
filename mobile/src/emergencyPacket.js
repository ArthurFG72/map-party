const MAGIC = 0x4d50534f;
const VERSION = 1;
const PACKET_BYTES = 32;

function clampInteger(value, min, max) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function base64url(bytes) {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToDer(publicKeyPem) {
  const body = String(publicKeyPem || '')
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '');
  if (!body) throw new Error('Chave publica SOS indisponivel.');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

export function encodeEmergencyPayload({
  type = 'sos',
  timestamp = Date.now(),
  lat,
  lng,
  accuracy = 0,
  battery = 0,
  sequence = 1
} = {}) {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new Error('Localizacao SOS invalida.');
  }
  const buffer = new ArrayBuffer(PACKET_BYTES);
  const view = new DataView(buffer);
  view.setUint32(0, MAGIC);
  view.setUint8(4, VERSION);
  view.setUint8(5, type === 'location' ? 1 : 2);
  view.setBigUint64(8, BigInt(clampInteger(timestamp, 0, Number.MAX_SAFE_INTEGER)));
  view.setInt32(16, clampInteger(lat * 10_000_000, -900_000_000, 900_000_000));
  view.setInt32(20, clampInteger(lng * 10_000_000, -1_800_000_000, 1_800_000_000));
  view.setUint16(24, clampInteger(accuracy, 0, 65535));
  view.setUint8(26, clampInteger(battery, 0, 100));
  view.setUint32(28, clampInteger(sequence, 0, 0xffff_ffff));
  return buffer;
}

export async function sealEmergencyPacket(publicKey, payload) {
  if (globalThis.MapPartyEmergencyCrypto?.seal) {
    return globalThis.MapPartyEmergencyCrypto.seal(publicKey, payload);
  }
  if (!globalThis.crypto?.subtle) {
    throw new Error('Criptografia SOS indisponivel neste aparelho.');
  }
  const key = await globalThis.crypto.subtle.importKey(
    'spki',
    pemToDer(publicKey.publicKeyPem),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt']
  );
  const ciphertext = await globalThis.crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, payload);
  return { keyId: publicKey.keyId, ciphertext: base64url(ciphertext) };
}

export async function createSealedEmergencyPacket(publicKey, location, options = {}) {
  const payload = encodeEmergencyPayload({
    ...options,
    lat: location?.lat,
    lng: location?.lng,
    accuracy: location?.accuracy,
    timestamp: location?.timestamp || Date.now()
  });
  return sealEmergencyPacket(publicKey, payload);
}
