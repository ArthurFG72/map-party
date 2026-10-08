export function normalizeName(value) {
  return value.replace(/[<>\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 32);
}
export function makeRoomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function readSession(key, fallback = '') {
  try { return sessionStorage.getItem(key) ?? fallback; }
  catch { return fallback; }
}

function writeSession(key, value) {
  try { sessionStorage.setItem(key, value); } catch { /* armazenamento pode estar bloqueado */ }
}

function readLocal(key, fallback = '') {
  try { return localStorage.getItem(key) ?? fallback; }
  catch { return fallback; }
}

function writeLocal(key, value) {
  try { localStorage.setItem(key, value); } catch { /* armazenamento pode estar bloqueado */ }
}

function createParticipantToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `participant_${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export const storedName = () => readSession('map-party:name');
export const saveName = (name) => writeSession('map-party:name', name);
export const storedVisibility = () => readSession('map-party:visible', 'true') !== 'false';
export const saveVisibility = (visible) => writeSession('map-party:visible', String(Boolean(visible)));
export function getOrCreateParticipantToken() {
  const stored = readLocal('map-party:participant-token');
  if (/^[A-Za-z0-9._~-]{32,256}$/.test(stored)) return stored;
  const token = createParticipantToken();
  writeLocal('map-party:participant-token', token);
  return token;
}
