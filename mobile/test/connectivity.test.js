import assert from 'node:assert/strict';
import test from 'node:test';
import { CONNECTIVITY_LEVEL, classifyConnectivity, connectivityCapabilities, voiceCapabilities } from '../src/connectivity.js';

test('classifica 2G como modo texto', () => {
  assert.equal(classifyConnectivity({ type: 'cellular', isConnected: true, isInternetReachable: true, details: { cellularGeneration: '2g' } }), CONNECTIVITY_LEVEL.TEXT);
  assert.equal(connectivityCapabilities(CONNECTIVITY_LEVEL.TEXT).canLoadPois, false);
});

test('reduz recursos em 3G e latência alta', () => {
  assert.equal(classifyConnectivity({ type: 'cellular', isConnected: true, isInternetReachable: true, details: { cellularGeneration: '3g' } }), CONNECTIVITY_LEVEL.LIMITED);
  assert.equal(classifyConnectivity({ type: 'wifi', isConnected: true, isInternetReachable: true }, 2_000), CONNECTIVITY_LEVEL.LIMITED);
});

test('mantém a navegação local sem internet', () => {
  const capabilities = connectivityCapabilities(classifyConnectivity({ isConnected: false }));
  assert.equal(capabilities.canSyncText, false);
  assert.equal(capabilities.canSearch, false);
});

test('usa voz continua somente quando a rede suporta conversa', () => {
  assert.equal(voiceCapabilities(CONNECTIVITY_LEVEL.RICH).continuous, true);
  assert.equal(voiceCapabilities(CONNECTIVITY_LEVEL.NORMAL).continuous, true);
  assert.equal(voiceCapabilities(CONNECTIVITY_LEVEL.LIMITED).continuous, false);
  assert.equal(voiceCapabilities(CONNECTIVITY_LEVEL.TEXT).interimResults, false);
  assert.equal(voiceCapabilities(CONNECTIVITY_LEVEL.OFFLINE).allowRecognition, true);
});
