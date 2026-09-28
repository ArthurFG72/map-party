import * as SQLite from 'expo-sqlite';
import { prepareOfflineRoutePackageForStorage, validateOfflineRoutePackage } from './offlineRoutePackage';
import { createDeviceId, validDeviceId } from './deviceIdentity';

let databasePromise;
let placeMutationQueue = Promise.resolve();
let participantTokenPromise;
let deviceIdPromise;

const FAVORITE_PLACES_KEY = 'places:favorites';
const RECENT_PLACES_KEY = 'places:recent';
const ROUTE_ORIGINS_KEY = 'routes:origins';
const ROUTE_HISTORY_KEY = 'routes:history';
const PARTICIPANT_TOKEN_KEY = 'identity:participant-token';
const DEVICE_ID_KEY = 'identity:device-id';
const ACTIVE_TRACKING_ROOM_KEY = 'tracking:active-room';
const PERMISSION_PROMPT_PREFIX = 'permissions:prompted:';
const MAX_FAVORITE_PLACES = 50;
const MAX_RECENT_PLACES = 12;
const MAX_ROUTE_ORIGINS = 10;
const MAX_ROUTE_HISTORY = 10;
const OFFLINE_ROUTE_PACKAGE_PREFIX = 'offline:route-package:';

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

function createParticipantToken() {
  const values = new Uint32Array(8);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values);
  } else {
    for (let index = 0; index < values.length; index += 1) {
      values[index] = Math.floor(Math.random() * 0x1_0000_0000);
    }
  }
  const entropy = [...values].map((value) => value.toString(16).padStart(8, '0')).join('');
  return `participant_${Date.now().toString(36)}_${entropy}`;
}

export function getOrCreateParticipantToken() {
  if (!participantTokenPromise) {
    participantTokenPromise = (async () => {
      let stored;
      try { stored = await readState(PARTICIPANT_TOKEN_KEY); } catch { /* Create an in-memory fallback below. */ }
      if (typeof stored === 'string' && /^[A-Za-z0-9._~-]{32,256}$/.test(stored)) return stored;
      const token = createParticipantToken();
      try { await writeState(PARTICIPANT_TOKEN_KEY, token); } catch { /* Keep a stable token for this app session. */ }
      return token;
    })();
  }
  return participantTokenPromise;
}

export function getOrCreateDeviceId() {
  if (!deviceIdPromise) {
    deviceIdPromise = (async () => {
      let stored;
      try { stored = await readState(DEVICE_ID_KEY); } catch { /* Create a stable in-memory fallback below. */ }
      if (validDeviceId(stored)) return stored;
      const deviceId = createDeviceId();
      try { await writeState(DEVICE_ID_KEY, deviceId); } catch { /* Keep the device ID for this app session. */ }
      return deviceId;
    })();
  }
  return deviceIdPromise;
}

export function placeStorageId(place) {
  if (typeof place === 'string') return place;
  if (typeof place?.storageId === 'string' && place.storageId) return place.storageId;
  if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return '';
  const providerId = place.id == null ? 'coordinate' : String(place.id);
  return `${providerId}:${place.lat.toFixed(6)}:${place.lng.toFixed(6)}`;
}

function normalizeStoredPlace(place) {
  const storageId = placeStorageId(place);
  if (!storageId) return null;
  const label = String(place.label || place.name || 'Local salvo').trim().slice(0, 160);
  const name = String(place.name || label.split(',')[0] || 'Local salvo').trim().slice(0, 100);
  const address = String(place.address || (label.includes(',') ? label.split(',').slice(1).join(',').trim() : '')).slice(0, 180);
  return {
    storageId,
    id: place.id == null ? storageId : String(place.id),
    name,
    label,
    address,
    lat: place.lat,
    lng: place.lng,
    source: place.source === 'saved' ? 'saved' : 'search',
    ...(place.category ? { category: String(place.category).slice(0, 40) } : {}),
    ...(Number.isFinite(place.savedAt) ? { savedAt: place.savedAt } : {}),
    ...(Number.isFinite(place.lastUsedAt) ? { lastUsedAt: place.lastUsedAt } : {})
  };
}

function mutatePlaces(key, mutation) {
  const operation = async () => {
    const current = (await readState(key) || []).map(normalizeStoredPlace).filter(Boolean);
    const next = mutation(current);
    await writeState(key, next);
    return next;
  };
  const pending = placeMutationQueue.then(operation, operation);
  placeMutationQueue = pending.catch(() => undefined);
  return pending;
}

export async function loadFavoritePlaces() {
  try { return (await readState(FAVORITE_PLACES_KEY) || []).map(normalizeStoredPlace).filter(Boolean).slice(0, MAX_FAVORITE_PLACES); }
  catch { return []; }
}

export function saveFavoritePlace(place) {
  const normalized = normalizeStoredPlace(place);
  if (!normalized) return Promise.resolve([]);
  return mutatePlaces(FAVORITE_PLACES_KEY, (current) => [
    { ...normalized, savedAt: Date.now(), source: 'saved' },
    ...current.filter((item) => item.storageId !== normalized.storageId)
  ].slice(0, MAX_FAVORITE_PLACES)).catch(() => []);
}

export function removeFavoritePlace(place) {
  const storageId = placeStorageId(place);
  if (!storageId) return Promise.resolve([]);
  return mutatePlaces(FAVORITE_PLACES_KEY, (current) => current.filter((item) => item.storageId !== storageId)).catch(() => []);
}

export async function loadRecentPlaces() {
  try { return (await readState(RECENT_PLACES_KEY) || []).map(normalizeStoredPlace).filter(Boolean).slice(0, MAX_RECENT_PLACES); }
  catch { return []; }
}

export function saveRecentPlace(place) {
  const normalized = normalizeStoredPlace(place);
  if (!normalized) return Promise.resolve([]);
  return mutatePlaces(RECENT_PLACES_KEY, (current) => [
    { ...normalized, lastUsedAt: Date.now() },
    ...current.filter((item) => item.storageId !== normalized.storageId)
  ].slice(0, MAX_RECENT_PLACES)).catch(() => []);
}

export async function loadRouteOrigins() {
  try { return (await readState(ROUTE_ORIGINS_KEY) || []).map(normalizeStoredPlace).filter(Boolean).slice(0, MAX_ROUTE_ORIGINS); }
  catch { return []; }
}

export function saveRouteOrigin(place) {
  const normalized = normalizeStoredPlace(place);
  if (!normalized) return Promise.resolve([]);
  return mutatePlaces(ROUTE_ORIGINS_KEY, (current) => [
    { ...normalized, lastUsedAt: Date.now() },
    ...current.filter((item) => item.storageId !== normalized.storageId)
  ].slice(0, MAX_ROUTE_ORIGINS)).catch(() => []);
}

function normalizeRouteHistory(item) {
  const origin = normalizeStoredPlace(item?.origin);
  const destination = normalizeStoredPlace(item?.destination);
  if (!origin || !destination) return null;
  return {
    id: `${origin.storageId}->${destination.storageId}`,
    origin,
    destination,
    ...(Number.isFinite(item?.lastUsedAt) ? { lastUsedAt: item.lastUsedAt } : {})
  };
}

export async function loadRouteHistory() {
  try {
    return (await readState(ROUTE_HISTORY_KEY) || []).map(normalizeRouteHistory).filter(Boolean).slice(0, MAX_ROUTE_HISTORY);
  } catch { return []; }
}

export function saveRouteHistory(origin, destination) {
  const normalized = normalizeRouteHistory({ origin, destination });
  if (!normalized) return Promise.resolve([]);
  const operation = async () => {
    const current = (await readState(ROUTE_HISTORY_KEY) || []).map(normalizeRouteHistory).filter(Boolean);
    const next = [{ ...normalized, lastUsedAt: Date.now() }, ...current.filter((item) => item.id !== normalized.id)].slice(0, MAX_ROUTE_HISTORY);
    await writeState(ROUTE_HISTORY_KEY, next);
    return next;
  };
  const pending = placeMutationQueue.then(operation, operation);
  placeMutationQueue = pending.catch(() => undefined);
  return pending.catch(() => []);
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

export function setActiveTrackingRoom(roomId) {
  if (typeof roomId !== 'string' || !roomId.trim()) return writeState(ACTIVE_TRACKING_ROOM_KEY, null);
  return writeState(ACTIVE_TRACKING_ROOM_KEY, roomId.trim().slice(0, 80));
}

export function loadActiveTrackingRoom() {
  return readState(ACTIVE_TRACKING_ROOM_KEY).then((roomId) => typeof roomId === 'string' ? roomId : null).catch(() => null);
}

export function loadPermissionPrompted(permission) {
  return readState(`${PERMISSION_PROMPT_PREFIX}${permission}`).then((value) => value === true).catch(() => false);
}

export function markPermissionPrompted(permission) {
  return writeState(`${PERMISSION_PROMPT_PREFIX}${permission}`, true).catch(() => undefined);
}

export async function saveOfflineRoutePackage(value) {
  const stored = prepareOfflineRoutePackageForStorage(value);
  if (!stored) return false;
  try {
    await writeState(`${OFFLINE_ROUTE_PACKAGE_PREFIX}${stored.id}`, stored);
    return true;
  } catch {
    return false;
  }
}

export async function loadOfflineRoutePackage(id) {
  if (typeof id !== 'string' || !id.trim()) return null;
  return validateOfflineRoutePackage(await readState(`${OFFLINE_ROUTE_PACKAGE_PREFIX}${id.slice(0, 80)}`));
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
