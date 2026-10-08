import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectMobileSourceManifest } from '../../scripts/mobile-source-manifest.mjs';

test('keeps only mobile source files in the release manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'maps-mobile-manifest-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'node_modules', 'package'), { recursive: true });
  await mkdir(join(root, 'dist-android'), { recursive: true });
  await writeFile(join(root, 'src', 'app.js'), 'source');
  await writeFile(join(root, '.env'), 'secret');
  await writeFile(join(root, 'node_modules', 'package', 'index.js'), 'dependency');
  await writeFile(join(root, 'dist-android', 'app.apk'), 'artifact');

  const manifest = await collectMobileSourceManifest(root);
  assert.equal(manifest.length, 1);
  assert.match(manifest[0], /  src\/app\.js$/);
});
