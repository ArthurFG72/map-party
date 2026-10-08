import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceId, validDeviceId } from '../src/deviceIdentity.js';

test('creates a stable-format device identifier', () => {
  const id = createDeviceId((bytes) => bytes.fill(15));
  assert.equal(id, 'nav_0f0f0f0f0f0f0f0f0f0f0f0f');
  assert.equal(validDeviceId(id), true);
});

test('rejects non-device identifiers', () => assert.equal(validDeviceId('nav_guessable'), false));
