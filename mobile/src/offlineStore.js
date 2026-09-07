import * as SQLite from 'expo-sqlite';

let databasePromise;

async function database() {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync('map-party-offline.db').then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS offline_state (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pending_locations (
          room_id TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
      return db;
    });
  }
  return databasePromise;
}

async function writeState(key, value) {
  const db = await database();
  await db.runAsync(
    'INSERT INTO offline_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    key,
    JSON.stringify(value),
    Date.now()
  );
}

async function readState(key) {
  const db = await database();
  const row = await db.getFirstAsync('SELECT value FROM offline_state WHERE key = ?', key);
  if (!row?.value) return null;
  try { return JSON.parse(row.value); } catch { return null; }
}

export function savePartySnapshot(roomId, snapshot) {
  return writeState(`party:${roomId}`, snapshot).catch(() => undefined);
}

export function loadPartySnapshot(roomId) {
  return readState(`party:${roomId}`).catch(() => null);
}

export function savePartyPoints(roomId, points) {
  return writeState(`points:${roomId}`, points).catch(() => undefined);
}

export function loadPartyPoints(roomId) {
  return readState(`points:${roomId}`).catch(() => null);
}

export async function savePendingLocation(roomId, location) {
  try {
    const db = await database();
    await db.runAsync(
      'INSERT INTO pending_locations (room_id, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(room_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      roomId,
      JSON.stringify(location),
      Date.now()
    );
  } catch {
    // Offline persistence must never interrupt GPS updates.
  }
}

export async function takePendingLocation(roomId) {
  try {
    const db = await database();
    const row = await db.getFirstAsync('SELECT value FROM pending_locations WHERE room_id = ?', roomId);
    await db.runAsync('DELETE FROM pending_locations WHERE room_id = ?', roomId);
    return row?.value ? JSON.parse(row.value) : null;
  } catch {
    return null;
  }
}
