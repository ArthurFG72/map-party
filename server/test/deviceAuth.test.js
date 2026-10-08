import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceAuth } from '../src/deviceAuth.js';

const secret = 'test-secret-with-more-than-thirty-two-characters';

test('issues a credential bound to one device without exposing the participant token', () => {
  const auth = createDeviceAuth({ secret, now: () => 1000, ttlMs: 60_000 });
  const token = auth.issue({ deviceId: 'nav_0123456789abcdef', participantToken: 'a'.repeat(32) });
  assert.ok(token);
  assert.equal(token.includes('a'.repeat(32)), false);
  assert.equal(auth.authorizes(token, 'nav_0123456789abcdef')?.did, 'nav_0123456789abcdef');
  assert.equal(auth.authorizes(token, 'nav_fedcba9876543210'), null);
});

test('rejects modified and expired credentials', () => {
  let clock = 1000;
  const auth = createDeviceAuth({ secret, now: () => clock, ttlMs: 60_000 });
  const token = auth.issue({ deviceId: 'nav_0123456789abcdef', participantToken: 'b'.repeat(32) });
  assert.equal(auth.verify(`${token}x`), null);
  clock += 60_001;
  assert.equal(auth.verify(token), null);
});

test('requires a production-grade signing secret', () => {
  assert.throws(() => createDeviceAuth({ secret: 'short' }), /DEVICE_AUTH_SECRET/);
});
