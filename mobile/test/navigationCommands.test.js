import test from 'node:test';
import assert from 'node:assert/strict';
import { isLocalNavigationCommand, validateNavigationCommand } from '../src/navigationCommands.js';

test('accepts a structured destination without allowing GPS control', () => {
  assert.deepEqual(validateNavigationCommand({ command: 'navigation.set_destination', request_id: 'request_123', destination: { query: 'Mix Flora' } }), { command: 'navigation.set_destination', request_id: 'request_123', destination: { query: 'Mix Flora' } });
});

test('keeps critical commands local and rejects unknown commands', () => {
  assert.equal(isLocalNavigationCommand('navigation.cancel'), true);
  assert.equal(isLocalNavigationCommand('navigation.set_destination'), false);
  assert.equal(validateNavigationCommand({ command: 'delete_device', request_id: 'request_123' }), null);
});

test('validates location, message and SOS commands', () => {
  assert.deepEqual(validateNavigationCommand({ command: 'location.get', request_id: 'request_123' }).command, 'location.get');
  assert.equal(validateNavigationCommand({ command: 'location.share', request_id: 'request_123', enabled: false }).enabled, false);
  assert.equal(validateNavigationCommand({ command: 'message.send', request_id: 'request_123', target_participant_id: 'p1', text: 'Oi' }).text, 'Oi');
  assert.equal(validateNavigationCommand({ command: 'sos.send', request_id: 'request_123' }).command, 'sos.send');
  assert.equal(validateNavigationCommand({ command: 'message.send', request_id: 'request_123', text: 'sem destino' }), null);
});
