import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRouteLearningStore } from '../src/services/routeLearningStore.js';

test('aprende o tempo de uma rota concluída e recupera após reinício', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'map-party-route-learning-'));
  const filePath = path.join(directory, 'history.json');
  const route = {
    origin: { lat: -23.55, lng: -46.63 },
    destination: { lat: -23.56, lng: -46.64 },
    geometry: { type: 'LineString', coordinates: [[-46.63, -23.55], [-46.635, -23.555], [-46.64, -23.56]] }
  };
  const first = createRouteLearningStore({ filePath, now: () => 1_000_000 });
  assert.equal(first.record({ ...route, actualDurationSeconds: 240, completedAt: 1_000_000 }), true);
  assert.equal(first.evaluate(route).duration, 240);
  const afterRestart = createRouteLearningStore({ filePath, now: () => 1_000_001 });
  assert.equal(afterRestart.evaluate(route).duration, 240);
  fs.rmSync(directory, { recursive: true, force: true });
});
test('ignora feedback sem geometria ou com tempo inválido', () => {
  const store = createRouteLearningStore({ filePath: path.join(os.tmpdir(), `map-party-route-learning-${Date.now()}.json`) });
  assert.equal(store.record({ actualDurationSeconds: 0 }), false);
  assert.equal(store.size(), 0);
});
