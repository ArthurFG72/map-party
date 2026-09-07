export function normalizeName(value) {
  return value.replace(/[<>\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 32);
}
export function makeRoomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
export const storedName = () => sessionStorage.getItem('map-party:name') || '';
export const saveName = (name) => sessionStorage.setItem('map-party:name', name);
