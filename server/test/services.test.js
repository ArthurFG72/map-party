import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeocodeService, normalizeQuery, normalizeViewbox } from '../src/services/geocodeService.js';
import { createRouteService } from '../src/services/routeService.js';
import { createPoiService, normalizePoiRequest } from '../src/services/poiService.js';
import { TtlLruCache } from '../src/services/ttlCache.js';

test('cache TTL expira e remove a entrada menos recente ao atingir o limite', () => {
  let now = 100;
  const cache = new TtlLruCache({ ttlMs: 10, maxEntries: 2, now: () => now });
  cache.set('a', 1); cache.set('b', 2);
  assert.equal(cache.get('a'), 1);
  cache.set('c', 3);
  assert.equal(cache.get('b'), undefined);
  now = 111;
  assert.equal(cache.get('a'), undefined);
});

test('geocodificação normaliza a busca, limpa resultados e usa cache', async () => {
  let calls = 0;
  const service = createGeocodeService({
    minIntervalMs: 0,
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.equal(url.searchParams.get('q'), 'São Paulo');
      assert.match(options.headers['User-Agent'], /MapParty/);
      return {
        ok: true,
        json: async () => [{ place_id: 10, display_name: ' Praça da Sé ', lat: '-23.5504', lon: '-46.6339', boundingbox: ['-24', '-23', '-47', '-46'] }]
      };
    }
  });
  assert.equal(normalizeQuery('  São   Paulo  '), 'São Paulo');
  assert.equal(normalizeViewbox('-47,-23,-46,-24'), '-47,-23,-46,-24');
  assert.equal(normalizeViewbox('invalido'), null);
  const first = await service.search('São Paulo', 5);
  const second = await service.search('São Paulo', 5);
  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  assert.equal(first.results[0].label, 'Praça da Sé');
  assert.equal(first.results[0].lat, -23.5504);
});

test('busca nomes locais no Overpass quando o Nominatim não retorna endereço', async () => {
  const calls = [];
  const service = createGeocodeService({
    minIntervalMs: 0,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (new URL(url).hostname.includes('nominatim')) return { ok: true, json: async () => [] };
      return { ok: true, json: async () => ({ elements: [{ type: 'node', id: 42, lat: -18.9, lon: -48.2, tags: { name: 'Yes Vida Boa', amenity: 'place' } }] }) };
    }
  });
  const result = await service.search('Condominio Yes Vida Boa', 5, '-48.3,-18.8,-48.1,-19.0', { lat: -18.9, lng: -48.2 });
  assert.equal(result.results[0].label, 'Yes Vida Boa');
  assert.equal(result.results[0].id, 'overpass:node:42');
  assert.equal(calls.length, 3);
  assert.match(calls[2].options.body.get('data'), /Yes.*Vida.*Boa/i);
});

test('serviço de rotas valida a solicitação e a resposta do provedor', async () => {
  const service = createRouteService({
    fetchImpl: async (url) => {
      assert.match(url.pathname, /route\/v1\/driving/);
      assert.equal(url.searchParams.get('overview'), 'full');
      assert.equal(url.searchParams.get('steps'), 'true');
      assert.equal(url.searchParams.get('geometries'), 'geojson');
      return {
        ok: true,
        json: async () => ({
          code: 'Ok',
          routes: [{
            geometry: { type: 'LineString', coordinates: [[-46.6, -23.5], [-46.7, -23.6]] },
            distance: 1500,
            duration: 300,
            legs: [{
              distance: 1500,
              duration: 300,
              summary: 'Centro',
              steps: [{
                distance: 1500,
                duration: 300,
                name: 'Avenida Central',
                ref: 'BR-001',
                mode: 'driving',
                geometry: { type: 'LineString', coordinates: [[-46.6, -23.5], [-46.7, -23.6]] },
                intersections: [{ location: [-46.6, -23.5] }],
                maneuver: {
                  type: 'turn', modifier: 'right', location: [-46.6, -23.5],
                  bearing_before: 10, bearing_after: 90
                }
              }]
            }]
          }]
        })
      };
    }
  });
  await assert.rejects(() => service.calculate({ profile: 'walking' }), { code: 'INVALID_ROUTE' });
  await assert.rejects(() => service.calculate({ contractVersion: 99, profile: 'driving' }), { code: 'INVALID_ROUTE' });
  const route = await service.calculate({
    profile: 'driving',
    origin: { lat: -23.5, lng: -46.6, label: 'Origem', source: 'search' },
    destination: { lat: -23.6, lng: -46.7, label: 'Destino', source: 'map' }
  });
  assert.equal(route.origin.label, 'Origem');
  assert.equal(route.distance, 1500);
  assert.equal(route.contractVersion, 1);
  assert.equal(route.legs[0].steps[0].maneuver.bearingBefore, 10);
  assert.equal(route.legs[0].steps[0].maneuver.bearingAfter, 90);
  assert.equal(route.legs[0].steps[0].name, 'Avenida Central');
  assert.equal('geometry' in route.legs[0].steps[0], false, 'remove geometria duplicada do step');
  assert.equal('intersections' in route.legs[0].steps[0], false, 'remove detalhes não usados do step');
});

test('serviço de rotas rejeita resposta OSRM sem steps válidos', async () => {
  const service = createRouteService({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [{
          geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
          distance: 100,
          duration: 10,
          legs: [{ distance: 100, duration: 10, steps: [] }]
        }]
      })
    })
  });
  await assert.rejects(() => service.calculate({
    profile: 'driving', origin: { lat: 0, lng: 0 }, destination: { lat: 1, lng: 1 }
  }), { code: 'PROVIDER_ERROR' });
});

test('servico de rotas rejeita uma saida marcada pelo OSRM como proibida', async () => {
  const service = createRouteService({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [{
          geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
          distance: 100,
          duration: 10,
          legs: [{
            distance: 100,
            duration: 10,
            steps: [{
              distance: 100,
              duration: 10,
              intersections: [{ entry: [true, false], out: 1 }],
              maneuver: { type: 'turn', location: [0, 0] }
            }]
          }]
        }]
      })
    })
  });
  await assert.rejects(() => service.calculate({
    profile: 'driving', origin: { lat: 0, lng: 0 }, destination: { lat: 1, lng: 1 }
  }), { code: 'PROVIDER_ERROR' });
});

test('serviço de rotas usa histórico resumido para escolher a melhor alternativa', async () => {
  const service = createRouteService({
    routeLearningStore: {
      evaluate: (route) => ({ duration: route.geometry.coordinates[1][0] === 0.5 ? 20 : 400, samples: 3 })
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [
          { geometry: { type: 'LineString', coordinates: [[0, 0], [0.1, 0.1], [1, 1]] }, distance: 100, duration: 100, legs: [{ distance: 100, duration: 100, steps: [{ distance: 100, duration: 100, maneuver: { type: 'depart', location: [0, 0] } }] }] },
          { geometry: { type: 'LineString', coordinates: [[0, 0], [0.5, 0.5], [1, 1]] }, distance: 120, duration: 120, legs: [{ distance: 120, duration: 120, steps: [{ distance: 120, duration: 120, maneuver: { type: 'depart', location: [0, 0] } }] }] }
        ]
      })
    })
  });
  const route = await service.calculate({ profile: 'driving', origin: { lat: 0, lng: 0 }, destination: { lat: 1, lng: 1 } });
  assert.equal(route.geometry.coordinates[1][0], 0.5);
});

test('serviÃ§o de rotas preserva rota vÃ¡lida quando o provedor desloca o pino para a via', async () => {
  const service = createRouteService({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [{
          geometry: { type: 'LineString', coordinates: [[0.004, 0], [0.014, 0]] },
          distance: 1200,
          duration: 180,
          legs: [{
            distance: 1200,
            duration: 180,
            steps: [{ maneuver: { type: 'depart', location: [0.004, 0] }, distance: 1200, duration: 180 }]
          }]
        }]
      })
    })
  });
  const route = await service.calculate({
    profile: 'driving', origin: { lat: 0, lng: 0 }, destination: { lat: 0, lng: 0.01 }
  });
  assert.equal(route.distance, 1200);
  assert.equal(route.destination.lng, 0.01);
});

test('POIs valida bbox, normaliza centros de ways e deduplica resultados', async () => {
  assert.equal(normalizePoiRequest({ bbox: '-49,-26,-48,-25', categories: 'restaurant', limit: 10 }).limit, 10);
  assert.equal(normalizePoiRequest({ bbox: 'invalido' }), null);
  let calls = 0;
  const service = createPoiService({ fetchImpl: async (_url, options) => {
    calls += 1;
    assert.equal(options.method, 'POST');
    assert.match(options.headers['User-Agent'], /MapParty/);
    return { ok: true, json: async () => ({ elements: [
      { type: 'node', id: 1, lat: -25.1, lon: -48.1, tags: { amenity: 'restaurant', name: 'A' } },
      { type: 'way', id: 2, center: { lat: -25.1, lon: -48.1 }, tags: { amenity: 'restaurant', name: 'Duplicado' } },
      { type: 'node', id: 3, lat: -25.2, lon: -48.2, tags: { amenity: 'fuel', name: 'Posto' } }
    ] }) };
  } });
  const first = await service.search({ bbox: '-49,-26,-48,-25', categories: 'restaurant,fuel', limit: 20 });
  const second = await service.search({ bbox: '-49,-26,-48,-25', categories: 'restaurant,fuel', limit: 20 });
  assert.equal(first.results.length, 2);
  assert.equal(first.results[0].category, 'restaurant');
  assert.equal(calls, 1);
  assert.equal(second.results.length, 2);
});

test('servico de rotas rejeita geometria que nao termina nos pontos solicitados', async () => {
  const service = createRouteService({
    fetchImpl: async () => ({ ok: true, json: async () => ({
      code: 'Ok',
      routes: [{
        geometry: { type: 'LineString', coordinates: [[10, 10], [11, 11]] },
        distance: 100,
        duration: 10,
        legs: [{ distance: 100, duration: 10, steps: [{ maneuver: { type: 'depart', location: [0, 0] } }] }]
      }]
    }) })
  });
  await assert.rejects(() => service.calculate({
    profile: 'driving', origin: { lat: 0, lng: 0 }, destination: { lat: 1, lng: 1 }
  }), { code: 'PROVIDER_ERROR' });
});
