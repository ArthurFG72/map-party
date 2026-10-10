import assert from 'node:assert/strict';
import test from 'node:test';
import { createSealedEmergencyPacket, encodeEmergencyPayload } from '../src/emergencyPacket.js';
import { attemptEmergencyDelivery } from '../src/sosDelivery.js';

test('codifica payload SOS binario compacto de 32 bytes', () => {
  const payload = encodeEmergencyPayload({ type: 'sos', timestamp: 4, lat: 1.25, lng: -2.5, sequence: 7 });
  const view = new DataView(payload);
  assert.equal(payload.byteLength, 32);
  assert.equal(view.getUint32(0), 0x4d50534f);
  assert.equal(view.getUint8(4), 1);
  assert.equal(view.getUint8(5), 2);
  assert.equal(view.getInt32(16) / 10_000_000, 1.25);
  assert.equal(view.getInt32(20) / 10_000_000, -2.5);
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

test('envia o relay criptografado mesmo se o sinal SOS do socket falhar', async () => {
  const events = [];
  const result = await attemptEmergencyDelivery({
    online: true,
    sendLocal: async () => { events.push('local'); return true; },
    sendSignal: async () => { events.push('signal'); throw new Error('socket indisponível'); },
    relay: async () => { events.push('relay'); return { ok: true, packetId: 'packet-1' }; }
  });
  assert.deepEqual(events.sort(), ['local', 'relay', 'signal']);
  assert.equal(result.localSent, true);
  assert.equal(result.signalSent, false);
  assert.equal(result.relayAccepted, true);
});

test('falha no transporte local não bloqueia entrega de SOS pela rede', async () => {
  const result = await attemptEmergencyDelivery({
    online: true,
    sendLocal: async () => { throw new Error('Nearby indisponível'); },
    sendSignal: async () => ({ ok: true }),
    relay: async () => ({ ok: true, packetId: 'packet-2' })
  });
  assert.equal(result.localSent, false);
  assert.equal(result.signalSent, true);
  assert.equal(result.relayAccepted, true);
});

test('sem rede, SOS continua pela trilha local sem simular envio ao servidor', async () => {
  let networkAttempts = 0;
  const result = await attemptEmergencyDelivery({
    online: false,
    sendLocal: async () => true,
    sendSignal: async () => { networkAttempts += 1; },
    relay: async () => { networkAttempts += 1; }
  });
  assert.equal(result.localSent, true);
  assert.equal(result.signalSent, false);
  assert.equal(result.relayAccepted, false);
  assert.equal(networkAttempts, 0);
});
