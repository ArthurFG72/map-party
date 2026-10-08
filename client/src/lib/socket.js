import { io } from 'socket.io-client';
const defaultServerUrl = import.meta.env.DEV
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : window.location.origin;
const configuredServerUrl = import.meta.env.VITE_SERVER_URL;
const serverUrl = configuredServerUrl && !(window.location.hostname !== 'localhost' && configuredServerUrl.includes('localhost'))
  ? configuredServerUrl
  : defaultServerUrl;
export const socket = io(serverUrl, {
  autoConnect: false, transports: ['websocket', 'polling']
});
