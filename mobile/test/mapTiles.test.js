import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/offlineMapTiles.js', import.meta.url), 'utf8');
const partyScreen = readFileSync(new URL('../src/screens/PartyScreen.js', import.meta.url), 'utf8');

test('mapa mantém os dois estilos no proxy do servidor sem API key', () => {
  assert.match(source, /simple: `\$\{SERVER_URL\}\/api\/map-tiles\/simple\/\{z\}\/\{x\}\/\{y\}\.png(?:\?[^`]*)?`/);
  assert.match(source, /detailed: `\$\{SERVER_URL\}\/api\/map-tiles\/detailed\/\{z\}\/\{x\}\/\{y\}\.png`/);
  assert.equal(source.includes('key='), false);
});

test('prepara uma pirâmide de tiles e usa o cache ao recriar o mapa', () => {
  assert.match(source, /const TILE_ZOOMS = \[11, 12, 13, 14, 15, 16, 17\]/);
  assert.match(source, /TILE_ZOOMS\.flatMap/);
  assert.match(partyScreen, /urlTemplate=\{offlineTileTemplate\}/);
  assert.match(partyScreen, /key=\{mapRefreshKey\}/);
});
