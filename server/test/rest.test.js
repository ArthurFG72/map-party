import test from 'node:test';
import assert from 'node:assert/strict';
import { constants, generateKeyPairSync, publicEncrypt } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { createApp, grayscalePng, MAP_TILE_STYLES } from '../src/app.js';
import { emergencyKeyId } from '../src/emergencyPacket.js';

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([typeBuffer, data])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length);
  return chunk;
}

async function startServer(options) {
  const instance = createApp({ origin: '*', restRateLimit: (_req, _res, next) => next(), ...options });
  await new Promise((resolve) => instance.httpServer.listen(0, '127.0.0.1', resolve));
  return { ...instance, url: `http://127.0.0.1:${instance.httpServer.address().port}` };
}

test('estilos de mapa permanecem estáveis e não expõem chave de provedor', async (t) => {
  assert.deepEqual(MAP_TILE_STYLES, {
    simple: 'https://tile.openstreetmap.org',
    detailed: 'https://tile.openstreetmap.de'
  });
  const server = await startServer();
  t.after(() => new Promise((resolve) => server.io.close(resolve)));
  const response = await fetch(`${server.url}/api/map-tiles/unknown/5/11/15.png`);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: { code: 'INVALID_TILE_STYLE', message: 'Estilo de mapa invalido.' } });
});

test('mapa simples converte paletas PNG indexadas para tons de cinza', () => {
  const header = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 3, 0, 0, 0]);
  const palette = Buffer.from([255, 0, 0, 0, 255, 0]);
  const input = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('PLTE', palette),
    pngChunk('IDAT', deflateSync(Buffer.from([0, 0]))),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
  const output = grayscalePng(input);
  const paletteOffset = output.indexOf(Buffer.from('PLTE')) + 4;
  assert.deepEqual([...output.subarray(paletteOffset, paletteOffset + 6)], [76, 76, 76, 150, 150, 150]);
});

test('endpoints REST expõem geocodificação e cálculo de rota', async (t) => {
  const server = await startServer({
    geocodeService: { search: async (query, limit) => ({ results: [{ id: '1', label: query, lat: 1, lng: 2 }].slice(0, limit) }) },
    routeService: { calculate: async ({ origin, destination }) => ({
      origin, destination,
      geometry: { type: 'LineString', coordinates: [[origin.lng, origin.lat], [destination.lng, destination.lat]] },
      distance: 42, duration: 10
    }) }
  });
  t.after(() => new Promise((resolve) => server.io.close(resolve)));

  const geocode = await fetch(`${server.url}/api/geocode?q=Curitiba&limit=3`);
  assert.equal(geocode.status, 200);
  assert.equal((await geocode.json()).results[0].label, 'Curitiba');

  const route = await fetch(`${server.url}/api/route`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile: 'driving', origin: { lat: 1, lng: 2 }, destination: { lat: 3, lng: 4 } })
  });
  assert.equal(route.status, 200);
  assert.equal((await route.json()).distance, 42);
});

test('respostas HTTP restringem permissões sensíveis do navegador', async (t) => {
  const server = await startServer();
  t.after(() => new Promise((resolve) => server.io.close(resolve)));

  const response = await fetch(`${server.url}/health`);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('permissions-policy'), 'geolocation=(self), camera=(), microphone=()');
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('produção rejeita CORS aberto', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.throws(() => createApp({ origin: '*' }), /CLIENT_ORIGIN/);
  } finally {
    if (previous == null) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test('endpoint de instaladores informa somente links publicados', async (t) => {
  const server = await startServer({ androidAppUrl: 'https://example.test/map-party.apk', expoGoUrl: 'exp://example.test' });
  t.after(() => new Promise((resolve) => server.io.close(resolve)));
  const response = await fetch(`${server.url}/api/app-downloads`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    android: 'https://example.test/map-party.apk', ios: null, expoGo: 'exp://example.test'
  });
});

test('servidor não expõe assinatura e responde JSON para payload inválido', async (t) => {
  const server = await startServer();
  t.after(() => new Promise((resolve) => server.io.close(resolve)));
  const response = await fetch(`${server.url}/api/route`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{'
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: { code: 'INVALID_JSON', message: 'JSON inválido.' } });
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
});

test('endpoints REST retornam erros previsíveis', async (t) => {
  const providerError = Object.assign(new Error('offline'), { code: 'PROVIDER_ERROR' });
  const server = await startServer({
    geocodeService: { search: async () => { throw providerError; } },
    routeService: { calculate: async () => { throw Object.assign(new Error('invalid'), { code: 'INVALID_ROUTE' }); } }
  });
  t.after(() => new Promise((resolve) => server.io.close(resolve)));

  assert.equal((await fetch(`${server.url}/api/geocode?q=x`)).status, 400);
  assert.equal((await fetch(`${server.url}/api/geocode?q=valid`)).status, 502);
  const invalidRoute = await fetch(`${server.url}/api/route`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
  });
  assert.equal(invalidRoute.status, 400);
});

test('endpoint REST de POIs aceita resposta injetada e valida parâmetros', async (t) => {
  const server = await startServer({ poiService: { search: async ({ bbox, categories }) => {
    if (!String(bbox).includes(',')) throw Object.assign(new Error('invalid'), { code: 'INVALID_POI_REQUEST' });
    return { results: [{ name: 'Posto', category: String(categories).split(',')[0], lat: 1, lng: 2 }] };
  } } });
  t.after(() => new Promise((resolve) => server.io.close(resolve)));
  const pois = await fetch(`${server.url}/api/pois?bbox=-49,-26,-48,-25&categories=fuel&limit=5`);
  assert.equal(pois.status, 200);
  assert.equal((await pois.json()).results[0].category, 'fuel');
  const invalid = await fetch(`${server.url}/api/pois?bbox=bad`);
  assert.equal(invalid.status, 400);
});

test('endpoint REST de grafo offline aceita serviço injetado', async (t) => {
  const server = await startServer({ offlineGraphService: { build: async ({ geometry }) => ({ version: 1, id: 'route-a', source: 'test', geometry }) } });
  t.after(() => new Promise((resolve) => server.io.close(resolve)));
  const response = await fetch(`${server.url}/api/offline/graph`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ geometry: { type: 'LineString', coordinates: [[1, 2], [3, 4]] }, id: 'route-a' })
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).source, 'test');
});

function emergencyPayload({ type = 2, timestamp = Date.now(), lat = -23.5, lng = -46.6, accuracy = 8, battery = 73, sequence = 1 } = {}) {
  const buffer = Buffer.alloc(32);
  buffer.writeUInt32BE(0x4d50534f, 0);
  buffer.writeUInt8(1, 4);
  buffer.writeUInt8(type, 5);
  buffer.writeBigUInt64BE(BigInt(timestamp), 8);
  buffer.writeInt32BE(Math.round(lat * 10_000_000), 16);
  buffer.writeInt32BE(Math.round(lng * 10_000_000), 20);
  buffer.writeUInt16BE(accuracy, 24);
  buffer.writeUInt8(battery, 26);
  buffer.writeUInt32BE(sequence, 28);
  return buffer;
}

test('relay SOS publica chave, abre pacote cifrado e deduplica', async (t) => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const server = await startServer({ emergencyService: { publicKeyPem, privateKeyPem } });
  t.after(() => new Promise((resolve) => server.io.close(resolve)));

  const key = await fetch(`${server.url}/api/emergency/public-key`);
  assert.equal(key.status, 200);
  assert.equal((await key.json()).keyId, emergencyKeyId(publicKeyPem));

  const ciphertext = publicEncrypt({
    key: publicKeyPem,
    padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256'
  }, emergencyPayload()).toString('base64url');
  const first = await fetch(`${server.url}/api/emergency/relay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyId: emergencyKeyId(publicKeyPem), ciphertext })
  });
  assert.equal(first.status, 202);
  const accepted = await first.json();
  assert.equal(accepted.ok, true);
  assert.equal(accepted.type, 'sos');

  const duplicate = await fetch(`${server.url}/api/emergency/relay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyId: emergencyKeyId(publicKeyPem), ciphertext })
  });
  assert.deepEqual(await duplicate.json(), { ok: true, duplicate: true, packetId: accepted.packetId });
});

test('relay SOS falha fechado sem chaves configuradas', async (t) => {
  const server = await startServer();
  t.after(() => new Promise((resolve) => server.io.close(resolve)));
  assert.equal((await fetch(`${server.url}/api/emergency/public-key`)).status, 503);
  assert.equal((await fetch(`${server.url}/api/emergency/relay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyId: 'x', ciphertext: 'abc' })
  })).status, 503);
});
