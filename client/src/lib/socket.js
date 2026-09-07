import { io } from 'socket.io-client';
const defaultServerUrl = import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin;
export const socket = io(import.meta.env.VITE_SERVER_URL || defaultServerUrl, {
  autoConnect: false, transports: ['websocket', 'polling']
});
