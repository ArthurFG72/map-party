import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOfflineRouteCoverage } from '../src/offlineRouteCoverage.js';

test('builds a bounded offline corridor for a valid route', () => {
  const coverage = buildOfflineRouteCoverage([
    [-46.6333, -23.5505],
    [-46.7000, -23.5600],
  ], { corridorMeters: 1000, lowResource: true });

  assert.equal(coverage.corridorMeters, 1000);
  assert.equal(coverage.maxPackageBytes, 24 * 1024 * 1024);
  assert.equal(coverage.segments.length, 1);
  assert.ok(coverage.segments[0].bounds.minLongitude < -46.6333);
  assert.ok(coverage.segments[0].bounds.maxLongitude > -46.7);
  assert.ok(coverage.totalRouteMeters > 0);
});

test('splits a long route into bounded download segments', () => {
  const coverage = buildOfflineRouteCoverage([
    [-46.6333, -23.5505],
    [-46.6333, -23.2505],
    [-46.6333, -22.9505],
  ], { segmentMeters: 20000 });

  assert.ok(coverage.segments.length > 1);
  assert.ok(coverage.segments.every((segment) => segment.routeMeters <= 35000));
});

test('rejects invalid route coordinates', () => {
  assert.equal(buildOfflineRouteCoverage([[-46.6, -23.5], ['x', -23.4]]), null);
});
