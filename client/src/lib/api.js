import { CONTRACT_VERSION } from './contracts.js';

const DEFAULT_SERVER_URL = import.meta.env.DEV
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : window.location.origin;
const configuredServerUrl = import.meta.env.VITE_SERVER_URL;
const SERVER_URL = (configuredServerUrl && !(window.location.hostname !== 'localhost' && configuredServerUrl.includes('localhost'))
  ? configuredServerUrl
  : DEFAULT_SERVER_URL).replace(/\/$/, '');

async function requestJson(path, options = {}) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${SERVER_URL}${path}`, {
      ...options,
      headers: { Accept: 'application/json', ...options.headers },
      signal: controller.signal
    });
    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error('O servidor retornou uma resposta inválida.');
    }
    if (!response.ok) throw new Error(body?.error?.message || `Falha no servidor (${response.status}).`);
    return body;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('A solicitação excedeu o tempo limite.');
    if (error instanceof TypeError) throw new Error('Não foi possível acessar o servidor.');
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function searchPlaces(query) {
  const params = new URLSearchParams({ q: query, limit: '12' });
  return requestJson(`/api/geocode?${params}`);
}

export function fetchRoute(origin, destination) {
  return requestJson('/api/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contractVersion: CONTRACT_VERSION, origin, destination, profile: 'driving' })
  });
}

export function fetchAppDownloads() {
  return requestJson('/api/app-downloads');
}
