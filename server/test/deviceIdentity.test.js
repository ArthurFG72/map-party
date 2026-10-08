import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanDeviceId } from '../src/validation.js';

test('accepts only the mobile device identifier format', () => {
  assert.equal(cleanDeviceId('nav_0123456789abcdef'), 'nav_0123456789abcdef');
  assert.equal(cleanDeviceId('nav_bad'), null);
  assert.equal(cleanDeviceId('other_0123456789abcdef'), null);
});
