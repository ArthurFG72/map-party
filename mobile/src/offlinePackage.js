const MAX_NODES = 25_000;
const MAX_EDGES = 100_000;

export function validateOfflinePackage(value) {
  if (!value || value.version !== 1 || typeof value.id !== "string" || !Array.isArray(value.nodes) || value.nodes.length > MAX_NODES) return null;
  let edgeCount = 0;
  const nodes = [];
  for (const node of value.nodes) {
    if (!Number.isFinite(node?.lat) || !Number.isFinite(node?.lng) || !Array.isArray(node.edges)) return null;
    edgeCount += node.edges.length;
    if (edgeCount > MAX_EDGES) return null;
    const edges = node.edges.map((edge) => ({ to: Number(edge?.to), distance: Number(edge?.distance) }));
    if (edges.some((edge) => !Number.isInteger(edge.to) || edge.to < 0 || edge.to >= value.nodes.length || !Number.isFinite(edge.distance) || edge.distance <= 0)) return null;
    nodes.push({ lat: node.lat, lng: node.lng, edges });
  }
  return { id: value.id.slice(0, 80), nodes };
}
export function prepareOfflinePackageForStorage(value, maxBytes = 4 * 1024 * 1024) {
  const graph = validateOfflinePackage(value);
  if (!graph) return null;
  const serialized = JSON.stringify(graph);
  if (new TextEncoder().encode(serialized).length > maxBytes) return null;
  return { id: graph.id, serialized };
}