import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('render boundary remounts the native tree when recovery is requested', async () => {
  const source = await readFile(new URL('../App.js', import.meta.url), 'utf8');
  assert.match(source, /generation: 0/);
  assert.match(source, /generation: current\.generation \+ 1/);
  assert.match(source, /Fragment key=\{this\.state\.generation\}/);
  assert.match(source, /recordDiagnosticEvent\('render_failure'/);
});
