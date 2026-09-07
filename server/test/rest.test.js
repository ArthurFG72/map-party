import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

async function startServer(options) {
  const instance = createApp({ origin: '*', restRateLimit: (_req, _res, next) => next(), ...options });
  await new Promise((resolve) => instance.httpServer.listen(0, '127.0.0.1', resolve));
  return { ...instance, url: `http://127.0.0.1:${instance.httpServer.address().port}` };
}

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
