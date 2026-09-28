import { useEffect, useState } from 'react';
import { Directory, File, Paths } from 'expo-file-system';
import { SERVER_URL } from './config';

const TILE_ZOOM = 13;
const MAX_TILES = 64;
const TILE_ROOT = new Directory(Paths.document, 'map-party-tiles');
export const MAP_TILE_TEMPLATES = {
  simple: `${SERVER_URL}/api/map-tiles/simple/{z}/{x}/{y}.png?v=gray2`,
  detailed: `${SERVER_URL}/api/map-tiles/detailed/{z}/{x}/{y}.png`
};
export const ONLINE_TILE_TEMPLATE = MAP_TILE_TEMPLATES.simple;
const TILE_TEMPLATE = ONLINE_TILE_TEMPLATE;

function tileCoordinate(value, limit) {
  return ((value % limit) + limit) % limit;
}

export function tileForCoordinate(lat, lng, zoom = TILE_ZOOM) {
  const scale = 2 ** zoom;
  const latitude = Math.max(-85.0511, Math.min(85.0511, lat));
  const x = Math.floor(((lng + 180) / 360) * scale);
  const latitudeRadians = latitude * Math.PI / 180;
  const y = Math.floor((1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2 * scale);
  return { z: zoom, x: tileCoordinate(x, scale), y: Math.max(0, Math.min(scale - 1, y)) };
}

export function routeTileKeys(route, zoom = TILE_ZOOM, maxTiles = MAX_TILES) {
  const coordinates = route?.geometry?.coordinates || [];
  const keys = new Map();
  const samples = coordinates.length > maxTiles ? coordinates.filter((_, index) => index % Math.ceil(coordinates.length / maxTiles) === 0) : coordinates;
  for (const coordinate of samples) {
    if (!Array.isArray(coordinate) || coordinate.length < 2) continue;
    const center = tileForCoordinate(Number(coordinate[1]), Number(coordinate[0]), zoom);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const key = { z: zoom, x: tileCoordinate(center.x + dx, 2 ** zoom), y: center.y + dy };
        if (key.y < 0 || key.y >= 2 ** zoom) continue;
        keys.set(`${key.z}/${key.x}/${key.y}`, key);
        if (keys.size >= maxTiles) return [...keys.values()];
      }
    }
  }
  return [...keys.values()];
}

function tileFile(tile) {
  const directory = new Directory(TILE_ROOT, String(tile.z), String(tile.x));
  directory.create({ intermediates: true, idempotent: true });
  return new File(directory, `${tile.y}.png`);
}

export async function prepareOfflineRouteTiles(route) {
  try {
    TILE_ROOT.create({ intermediates: true, idempotent: true });
    const tiles = routeTileKeys(route);
    for (const tile of tiles) {
      const file = tileFile(tile);
      if (file.exists) continue;
      const url = TILE_TEMPLATE.replace('{z}', tile.z).replace('{x}', tile.x).replace('{y}', tile.y);
      try { await File.downloadFileAsync(url, file, { idempotent: true }); } catch { /* Cache is best effort. */ }
    }
    return TILE_ROOT.uri;
  } catch {
    return null;
  }
}

export function offlineTileTemplate() {
  try {
    TILE_ROOT.create({ intermediates: true, idempotent: true });
    return `${TILE_ROOT.uri}/{z}/{x}/{y}.png`;
  } catch {
    return null;
  }
}
export function useOfflineRouteTiles(route) {
  const [template, setTemplate] = useState(null);
  useEffect(() => {
    let active = true;
    if (!route) {
      setTemplate(null);
      return undefined;
    }
    setTemplate(offlineTileTemplate());
    prepareOfflineRouteTiles(route).then(() => {
      if (active) setTemplate(offlineTileTemplate());
    });
    return () => { active = false; };
  }, [route]);
  return template;
}
