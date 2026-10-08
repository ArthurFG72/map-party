import test from 'node:test';
import assert from 'node:assert/strict';
import { executeNavigationCommand } from '../src/navigationCommandExecutor.js';

test('executes cancel locally without network', async () => {
  let cancelled = false;
  const response = await executeNavigationCommand({ command: 'navigation.cancel', request_id: 'request_123' }, {
    'navigation.cancel': () => { cancelled = true; return { state: 'IDLE' }; },
  });
  assert.equal(cancelled, true);
  assert.deepEqual(response, { success: true, status: 'ok', action: 'navigation.cancel', command: 'navigation.cancel', request_id: 'request_123', result: { state: 'IDLE' } });
});

test('never executes an AI destination as a local side effect', async () => {
  const response = await executeNavigationCommand({ command: 'navigation.set_destination', request_id: 'request_123', destination: { query: 'Mix Flora' } });
  assert.equal(response.code, 'REMOTE_INTENT_REQUIRED');
});
