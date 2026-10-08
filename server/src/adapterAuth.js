import { timingSafeEqual } from 'node:crypto';

const MIN_TOKEN_LENGTH = 32;

export function createAdapterAuth({ token } = {}) {
  if (typeof token !== 'string' || token.length < MIN_TOKEN_LENGTH) {
    throw new Error('NAVIGATOR_ADAPTER_TOKEN must contain at least 32 characters.');
  }
  function authorizes(candidate) {
    if (typeof candidate !== 'string') return false;
    const expected = Buffer.from(token);
    const received = Buffer.from(candidate);
    return expected.length === received.length && timingSafeEqual(expected, received);
  }
  return { authorizes };
}
