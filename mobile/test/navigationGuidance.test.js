import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNavigationGuidance, instructionForStep, snapPositionToRoute } from '../src/navigationGuidance.js';

const route = {
  origin: { lat: 0, lng: 0 },
  destination: { lat: 0, lng: 0.01 },
  geometry: { type: 'LineString', coordinates: [[0, 0], [0.005, 0], [0.01, 0]] },
  distance: 1000,
  duration: 100,
  legs: [{
    distance: 1000,
    duration: 100,
    steps: [
      { distance: 500, duration: 50, name: 'Rua A', maneuver: { type: 'depart', location: [0, 0] } },
      { distance: 500, duration: 50, name: 'Rua B', maneuver: { type: 'turn', modifier: 'right', location: [0.005, 0] } },
      { distance: 0, duration: 0, maneuver: { type: 'arrive', location: [0.01, 0] } }
    ]
  }]
};

test('calcula progresso, distância e ETA usando a geometria da rota', () => {
  const guidance = buildNavigationGuidance(route, { lat: 0, lng: 0.004, accuracy: 5 });
  assert.ok(guidance.progress > 0.35 && guidance.progress < 0.45);
  assert.ok(guidance.remainingMeters > 550 && guidance.remainingMeters < 650);
  assert.ok(guidance.remainingSeconds > 55 && guidance.remainingSeconds < 65);
  assert.equal(guidance.offRoute, false);
});

test('seleciona e traduz a próxima instrução de legs/steps', () => {
  const guidance = buildNavigationGuidance(route, { lat: 0, lng: 0.004, accuracy: 5 });
  assert.equal(guidance.instruction, 'Vire à direita na Rua B');
  assert.ok(guidance.instructionDistance > 80 && guidance.instructionDistance < 130);
  assert.equal(instructionForStep(route.legs[0].steps[2]), 'Chegue ao destino');
});

test('detecta saída da rota respeitando a margem de precisão do GPS', () => {
  assert.equal(buildNavigationGuidance(route, { lat: 0.001, lng: 0.004, accuracy: 5 }).offRoute, true);
  assert.equal(buildNavigationGuidance(route, { lat: 0.001, lng: 0.004, accuracy: 100 }).offRoute, false);
});

test('projeta a posição visual sobre a rota quando o desvio está dentro da precisão do GPS', () => {
  const snapped = snapPositionToRoute(route, { lat: 0.00025, lng: 0.004, accuracy: 18, speed: 4 }, 60);
  assert.equal(snapped.lat, 0);
  assert.equal(snapped.lng, 0.004);
  assert.equal(snapped.speed, 4);
  assert.equal(snapPositionToRoute(route, { lat: 0.002, lng: 0.004 }, 60).lat, 0.002);
});

test('prefere o sentido da faixa ao projetar em vias paralelas', () => {
  const route = {
    geometry: {
      coordinates: [[0, 0], [0.01, 0], [0.01, 0.001], [0, 0.001]]
    }
  };
  const snapped = snapPositionToRoute(route, { lat: 0.00075, lng: 0.005, speed: 12, heading: 90 }, 100);
  assert.ok(snapped.lat < 0.0002);
});

test('mantém orientação e progresso para rotas antigas sem steps', () => {
  const legacyRoute = { ...route, legs: undefined };
  const guidance = buildNavigationGuidance(legacyRoute, { lat: 0, lng: 0.005, accuracy: 5 });
  assert.equal(guidance.hasSteps, false);
  assert.equal(guidance.instruction, 'Continue pela rota até o destino');
  assert.ok(guidance.progress > 0.49 && guidance.progress < 0.51);
});

test('ativa detalhe apenas perto de manobras complexas', () => {
  const complexRoute = structuredClone(route);
  complexRoute.legs[0].steps[1].maneuver = {
    type: 'roundabout', exit: 3, modifier: 'right', location: [0.005, 0]
  };
  const nearby = buildNavigationGuidance(complexRoute, { lat: 0, lng: 0.004, accuracy: 5 });
  const distant = buildNavigationGuidance(complexRoute, { lat: 0, lng: 0.002, accuracy: 5 });
  assert.equal(nearby.precisionMode, true);
  assert.deepEqual(nearby.maneuverPoint, { lat: 0, lng: 0.005 });
  assert.equal(distant.precisionMode, false);
  assert.match(nearby.instruction, /3/);
});

test('amplia conversões e cruzamentos com mudança forte de direção', () => {
  const complexRoute = structuredClone(route);
  complexRoute.legs[0].steps[1].maneuver = {
    type: 'turn', modifier: 'left', bearingBefore: 0, bearingAfter: 90, location: [0.005, 0]
  };
  const nearby = buildNavigationGuidance(complexRoute, { lat: 0, lng: 0.004, accuracy: 5 });
  const distant = buildNavigationGuidance(complexRoute, { lat: 0, lng: 0.001, accuracy: 5 });
  assert.equal(nearby.precisionMode, true);
  assert.equal(distant.precisionMode, false);
});


test('segura a instrucao de conversao ate a aproximacao da manobra', () => {
  const distant = buildNavigationGuidance(route, { lat: 0, lng: 0.002, accuracy: 5 });
  assert.equal(distant.instruction, 'Siga pela Rua A');
  assert.ok(distant.instructionDistance > 60);
});

test('detecta sentido incompativel e orienta o condutor para a rota', () => {
  const guidance = buildNavigationGuidance(route, {
    lat: 0.0004,
    lng: 0.004,
    accuracy: 5,
    speed: 8,
    heading: 270
  });
  assert.equal(guidance.offRoute, true);
  assert.equal(guidance.instruction, 'Reoriente-se para seguir a rota azul.');
});
