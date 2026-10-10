import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PartyStore } from '../src/partyStore.js';

test('PartyStore restaura salas, identidades, localizacao e rotas apos reinicio', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'map-party-state-'));
  const file = join(directory, 'party-state.json');
  try {
    const original = new PartyStore();
    const joined = original.join('socket-a', 'room-a', 'Ana', 'participant-token', true);
    const room = original.rooms.get('room-a');
    room.participants.get(joined.participant.id).location = { lat: -23.5, lng: -46.6, timestamp: Date.now() };
    room.route = { destination: { lat: -23.4, lng: -46.5 }, geometry: { type: 'LineString', coordinates: [[-46.6, -23.5], [-46.5, -23.4]] } };
    await original.persistToFile(file);

    const restored = new PartyStore();
    assert.equal(await restored.restoreFromFile(file), true);
    const snapshot = restored.snapshot('room-a');
    assert.equal(snapshot.participants.length, 1);
    assert.equal(snapshot.participants[0].online, false);
    assert.equal(snapshot.participants[0].location.lat, -23.5);
    assert.equal(snapshot.route.destination.lat, -23.4);
    const rejoined = restored.join('socket-b', 'room-a', 'Ana', 'participant-token', true);
    assert.equal(rejoined.participant.id, joined.participant.id);
    assert.equal(rejoined.participant.online, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('PartyStore serializa checkpoints concorrentes e preserva o snapshot mais novo', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'map-party-state-concurrent-'));
  const file = join(directory, 'party-state.json');
  const store = new PartyStore();
  store.join('socket-1', 'concurrent-room', 'Antes', 'a'.repeat(32));
  const first = store.persistToFile(file);
  store.join('socket-2', 'concurrent-room', 'Depois', 'b'.repeat(32));
  const second = store.persistToFile(file);
  assert.equal(await first, true);
  assert.equal(await second, true);
  const restored = new PartyStore();
  assert.equal(await restored.restoreFromFile(file), true);
  assert.equal(restored.snapshot('concurrent-room').participants.length, 2);
});

test('PartyStore recorre ao checkpoint .bak quando o arquivo principal está corrompido', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'map-party-state-backup-'));
  const file = join(directory, 'party-state.json');
  const store = new PartyStore();
  store.join('socket-1', 'backup-room', 'Persistido', 'a'.repeat(32));
  assert.equal(await store.persistToFile(file), true);
  await writeFile(`${file}.bak`, await readFile(file, 'utf8'), 'utf8');
  await writeFile(file, '{corrompido', 'utf8');
  const restored = new PartyStore();
  assert.equal(await restored.restoreFromFile(file), true);
  assert.equal(restored.snapshot('backup-room').participants[0].name, 'Persistido');
});
