const DEFAULT_CELL_SIZE = 64;
const MIN_CLUSTER_DELTA = 0.002;

function validPoi(poi) {
  return poi && Number.isFinite(poi.lat) && Number.isFinite(poi.lng);
}

function individual(poi) {
  return {
    type: 'poi',
    id: `poi:${poi.id ?? `${poi.lat}:${poi.lng}`}`,
    coordinate: { latitude: poi.lat, longitude: poi.lng },
    poi
  };
}

export function clusterPois(pois, region, viewport = {}) {
  const valid = (pois || []).filter(validPoi);
  const latitudeDelta = Number(region?.latitudeDelta);
  const longitudeDelta = Number(region?.longitudeDelta);
  const width = Math.max(1, Number(viewport.width) || 390);
  const height = Math.max(1, Number(viewport.height) || 700);
  const cellSize = Math.max(44, Number(viewport.cellSize) || DEFAULT_CELL_SIZE);
  if (!Number.isFinite(latitudeDelta) || !Number.isFinite(longitudeDelta)
    || latitudeDelta <= MIN_CLUSTER_DELTA || longitudeDelta <= MIN_CLUSTER_DELTA) {
    return valid.map(individual);
  }

  const west = region.longitude - longitudeDelta / 2;
  const north = region.latitude + latitudeDelta / 2;
  const cells = new Map();
  for (const poi of valid) {
    const x = ((poi.lng - west) / longitudeDelta) * width;
    const y = ((north - poi.lat) / latitudeDelta) * height;
    const key = `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`;
    const items = cells.get(key) || [];
    items.push(poi);
    cells.set(key, items);
  }

  return [...cells.entries()].map(([cell, items]) => {
    if (items.length === 1) return individual(items[0]);
    const coordinate = items.reduce((center, poi) => ({
      latitude: center.latitude + poi.lat / items.length,
      longitude: center.longitude + poi.lng / items.length
    }), { latitude: 0, longitude: 0 });
    const categories = items.reduce((counts, poi) => ({
      ...counts,
      [poi.category || 'place']: (counts[poi.category || 'place'] || 0) + 1
    }), {});
    const ids = items.map((poi) => String(poi.id ?? `${poi.lat}:${poi.lng}`)).sort().join('|');
    return { type: 'cluster', id: `cluster:${cell}:${ids}`, coordinate, count: items.length, categories, pois: items };
  });
}

export function clusterAccessibilityLabel(cluster) {
  const restaurants = cluster?.categories?.restaurant || 0;
  const fuel = cluster?.categories?.fuel || 0;
  const descriptions = [];
  if (restaurants) descriptions.push(`${restaurants} restaurante${restaurants === 1 ? '' : 's'}`);
  if (fuel) descriptions.push(`${fuel} posto${fuel === 1 ? '' : 's'}`);
  const places = descriptions.length ? descriptions.join(' e ') : `${cluster?.count || 0} locais`;
  return `Grupo com ${places}. Toque para aproximar o mapa.`;
}
