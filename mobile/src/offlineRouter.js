const EARTH_RADIUS_METERS = 6_371_000;

function distanceMeters(a, b) {
  const lat = (b.lat - a.lat) * Math.PI / 180;
  const lng = (b.lng - a.lng) * Math.PI / 180;
  const value = Math.sin(lat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(lng / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function nearestNode(nodes, point) {
  let nearest = -1;
  let nearestDistance = Infinity;
  nodes.forEach((node, index) => {
    const distance = distanceMeters(node, point);
    if (distance < nearestDistance) { nearest = index; nearestDistance = distance; }
  });
  return nearest;
}

function popBest(queue) {
  let best = 0;
  for (let index = 1; index < queue.length; index += 1) if (queue[index].score < queue[best].score) best = index;
  return queue.splice(best, 1)[0];
}

export function calculateOfflineRoute(graph, origin, destination, { maxVisited = 10_000 } = {}) {
  const nodes = graph?.nodes;
  if (!Array.isArray(nodes) || !nodes.length || !origin || !destination) return null;
  const start = nearestNode(nodes, origin);
  const goal = nearestNode(nodes, destination);
  const costs = new Map([[start, 0]]);
  const previous = new Map();
  const queue = [{ node: start, score: 0 }];
  let visited = 0;

  while (queue.length && visited < maxVisited) {
    const current = popBest(queue).node;
    if (current === goal) {
      const path = [];
      for (let node = goal; node != null; node = previous.get(node)) path.unshift(node);
      return { coordinates: path.map((index) => [nodes[index].lng, nodes[index].lat]), distance: costs.get(goal), visited };
    }
    visited += 1;
    for (const edge of nodes[current].edges || []) {
      const next = Number(edge.to);
      if (!nodes[next]) continue;
      const cost = costs.get(current) + (Number(edge.distance) || distanceMeters(nodes[current], nodes[next]));
      if (cost >= (costs.get(next) ?? Infinity)) continue;
      costs.set(next, cost);
      previous.set(next, current);
      queue.push({ node: next, score: cost });
    }
  }
  return null;
}