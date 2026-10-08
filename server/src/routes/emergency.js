import { cleanSealedEmergencyPacket, createEmergencyStore, decryptEmergencyPacket, emergencyKeyId, normalizePem } from '../emergencyPacket.js';

export function emergencyRouter({
  publicKeyPem = process.env.EMERGENCY_PUBLIC_KEY_PEM || '',
  privateKeyPem = process.env.EMERGENCY_PRIVATE_KEY_PEM || '',
  store = createEmergencyStore()
} = {}, rateLimit) {
  const keyId = emergencyKeyId(publicKeyPem);
  const normalizedPublicKeyPem = normalizePem(publicKeyPem);

  return [
    (req, res, next) => {
      if (rateLimit) return rateLimit(req, res, next);
      return next();
    },
    (req, res, next) => {
      req.emergency = { keyId, publicKeyPem: normalizedPublicKeyPem, privateKeyPem, store };
      next();
    },
    router
  ];
}

function router(req, res, next) {
  if (req.method === 'GET' && req.path === '/public-key') return publicKey(req, res);
  if (req.method === 'POST' && req.path === '/relay') return relay(req, res);
  return next();
}

function publicKey(req, res) {
  const { keyId, publicKeyPem } = req.emergency;
  if (!keyId) {
    return res.status(503).json({ error: { code: 'EMERGENCY_KEY_UNAVAILABLE', message: 'Chave publica SOS indisponivel.' } });
  }
  res.set('Cache-Control', 'public, max-age=3600');
  return res.json({ alg: 'RSA-OAEP-256', keyId, publicKeyPem });
}

function relay(req, res) {
  const { keyId, privateKeyPem, store } = req.emergency;
  if (!keyId || !privateKeyPem) {
    return res.status(503).json({ error: { code: 'EMERGENCY_RELAY_UNAVAILABLE', message: 'Relay SOS indisponivel.' } });
  }
  const sealed = cleanSealedEmergencyPacket(req.body, keyId);
  if (!sealed) {
    return res.status(400).json({ error: { code: 'INVALID_EMERGENCY_PACKET', message: 'Pacote SOS invalido.' } });
  }
  if (store.has(sealed.packetId)) return res.json({ ok: true, duplicate: true, packetId: sealed.packetId });
  const payload = decryptEmergencyPacket(sealed.ciphertext, privateKeyPem);
  if (!payload) {
    return res.status(400).json({ error: { code: 'EMERGENCY_DECRYPT_FAILED', message: 'Pacote SOS nao pode ser aberto.' } });
  }
  store.remember(sealed.packetId, { packetId: sealed.packetId, keyId: sealed.keyId, payload });
  return res.status(payload.type === 'sos' ? 202 : 200).json({ ok: true, packetId: sealed.packetId, type: payload.type });
}
