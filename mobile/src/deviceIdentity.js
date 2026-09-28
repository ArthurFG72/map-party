const DEVICE_ID_RE = /^nav_[a-z0-9]{16,48}$/;

export function createDeviceId(random = globalThis.crypto?.getRandomValues?.bind(globalThis.crypto)) {
  const bytes = new Uint8Array(12);
  if (random) random(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return `nav_${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function validDeviceId(value) {
  return typeof value === 'string' && DEVICE_ID_RE.test(value);
}
