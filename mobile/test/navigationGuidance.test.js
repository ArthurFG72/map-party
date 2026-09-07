import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNavigationGuidance, instructionForStep } from '../src/navigationGuidance.js';

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

test('mantém orientação e progresso para rotas antigas sem steps', () => {
  const legacyRoute = { ...route, legs: undefined };
  const guidance = buildNavigationGuidance(legacyRoute, { lat: 0, lng: 0.005, accuracy: 5 });
  assert.equal(guidance.hasSteps, false);
  assert.equal(guidance.instruction, 'Continue pela rota até o destino');
  assert.ok(guidance.progress > 0.49 && guidance.progress < 0.51);
});
