import assert from 'node:assert/strict';
import test from 'node:test';
import { createSealedEmergencyPacket, encodeEmergencyPayload } from '../src/emergencyPacket.js';

test('codifica payload SOS binario compacto de 32 bytes', () => {
  const payload = encodeEmergencyPayload({ type: 'sos', timestamp: 4, lat: 1.25, lng: -2.5, sequence: 7 });
  const view = new DataView(payload);
  assert.equal(payload.byteLength, 32);
  assert.equal(view.getUint32(0), 0x4d50534f);
  assert.equal(view.getUint8(4), 1);
  assert.equal(view.getUint8(5), 2);
  assert.equal(view.getUint32(28), 7);
});

test('usa bridge nativa para selar sem expor a chave privada', async () => {
  globalThis.MapPartyEmergencyCrypto = {
    seal: async (key, payload) => ({ keyId: key.keyId, ciphertext: 'abc', bytes: payload.byteLength })
  };
  try {
    const packet = await createSealedEmergencyPacket(
      { keyId: 'key-1', publicKeyPem: 'native-only' },
      { lat: 1, lng: 2, accuracy: 3, timestamp: 4 },
      { sequence: 5 }
    );
    assert.deepEqual(packet, { keyId: 'key-1', ciphertext: 'abc', bytes: 32 });
  } finally {
    delete globalThis.MapPartyEmergencyCrypto;
  }
});

test('rejeita coordenadas SOS invalidas', () => {
  assert.throws(() => encodeEmergencyPayload({ lat: 91, lng: 0 }), /Localizacao SOS invalida/);
});
