import test from 'node:test';
import assert from 'node:assert/strict';
import { planNavigationSpeech } from '../src/navigationSpeechPlanner.js';

test('creates a Portuguese maneuver instruction and prevents rapid repetition', () => {
  const first = planNavigationSpeech({ instruction: 'vire à direita', instructionDistance: 52 }, {}, 1000);
  assert.equal(first.text, 'Em aproximadamente 52 metros, vire à direita');
  const repeated = planNavigationSpeech({ instruction: 'vire à direita', instructionDistance: 40 }, first.previous, 2000);
  assert.equal(repeated.text, null);
});

test('ignores generic route guidance and distant maneuvers', () => {
  assert.equal(planNavigationSpeech({ instruction: 'Siga pela rota azul.', instructionDistance: 50 }, {}, 1000).text, null);
  assert.equal(planNavigationSpeech({ instruction: 'vire à direita', instructionDistance: 120 }, {}, 1000).text, null);
});

test('announces off-route safely without needing a server', () => {
  const planned = planNavigationSpeech({ offRoute: true }, {}, 1000);
  assert.equal(planned.text, 'Você saiu da rota. Procure retornar com segurança.');
});
