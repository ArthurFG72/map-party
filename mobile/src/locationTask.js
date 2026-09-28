import * as TaskManager from 'expo-task-manager';
import { loadActiveTrackingRoom, savePendingLocation } from './offlineStore';
import { createLocationUpdate } from './locationUpdate';

export const LOCATION_TASK_NAME = 'map-party-background-location';

function normalizeLocation(location) {
  const coords = location?.coords;
  if (!coords || !Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) return null;
  return {
    lat: coords.latitude,
    lng: coords.longitude,
    accuracy: Number.isFinite(coords.accuracy) ? coords.accuracy : 0,
    timestamp: Number.isFinite(location.timestamp) ? location.timestamp : Date.now(),
    ...(Number.isFinite(coords.speed) && coords.speed >= 0 ? { speed: coords.speed } : {}),
    ...(Number.isFinite(coords.heading) && coords.heading >= 0 ? { heading: coords.heading } : {})
  };
}

if (!TaskManager.isTaskDefined(LOCATION_TASK_NAME)) {
  TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
    if (error || !Array.isArray(data?.locations) || data.locations.length === 0) return;
    const roomId = await loadActiveTrackingRoom();
    const latest = normalizeLocation(data.locations.at(-1));
    if (roomId && latest) await savePendingLocation(roomId, createLocationUpdate(latest, latest.timestamp));
  });
}
