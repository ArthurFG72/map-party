import test from 'node:test';
import assert from 'node:assert/strict';
import { clusterAccessibilityLabel, clusterPois } from '../src/poiClustering.js';

const region = { latitude: -23.55, longitude: -46.63, latitudeDelta: 0.1, longitudeDelta: 0.1 };
const pois = [
  { id: 'r1', name: 'Restaurante A', category: 'restaurant', lat: -23.55, lng: -46.63 },
  { id: 'r2', name: 'Restaurante B', category: 'restaurant', lat: -23.5502, lng: -46.6302 },
  { id: 'f1', name: 'Posto C', category: 'fuel', lat: -23.59, lng: -46.67 }
];

test('agrupa POIs próximos e preserva os distantes individualmente', () => {
  const markers = clusterPois(pois, region, { width: 390, height: 700, cellSize: 64 });
  const cluster = markers.find((marker) => marker.type === 'cluster');
  assert.equal(cluster.count, 2);
  assert.equal(cluster.categories.restaurant, 2);
  assert.equal(markers.filter((marker) => marker.type === 'poi').length, 1);
});

test('desativa agrupamento no zoom máximo', () => {
  const markers = clusterPois(pois, { ...region, latitudeDelta: 0.001, longitudeDelta: 0.001 });
  assert.equal(markers.every((marker) => marker.type === 'poi'), true);
});

test('descreve o conteúdo do cluster para tecnologia assistiva', () => {
  const cluster = clusterPois(pois.slice(0, 2), region)[0];
  assert.equal(clusterAccessibilityLabel(cluster), 'Grupo com 2 restaurantes. Toque para aproximar o mapa.');
});
