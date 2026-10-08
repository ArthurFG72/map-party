import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanNavigationCommand } from '../src/navigationCommands.js';

test('accepts a place intent but not coordinates controlled by an AI', () => {
  assert.deepEqual(cleanNavigationCommand({
    command: 'navigation.set_destination', request_id: 'request_123',
    destination: { query: 'Mix Flora', latitude: -23.5, longitude: -46.6 }
  }), {
    command: 'navigation.set_destination', request_id: 'request_123', destination: { query: 'Mix Flora' }
  });
});

test('rejects unknown commands and malformed request ids', () => {
  assert.equal(cleanNavigationCommand({ command: 'delete_device', request_id: 'request_123' }), null);
  assert.equal(cleanNavigationCommand({ command: 'navigation.pause', request_id: 'bad' }), null);
});
