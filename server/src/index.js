import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });
const port = Number(process.env.PORT) || 3001;
const clientDist = fileURLToPath(new URL('../../client/dist/', import.meta.url));
const persistencePath = process.env.PARTY_STATE_FILE || fileURLToPath(new URL('../data/party-state.json', import.meta.url));
const instance = createApp({
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  maxRoomParticipants: Number(process.env.MAX_ROOM_PARTICIPANTS) || undefined,
  maxRooms: Number(process.env.MAX_ROOMS) || undefined,
  androidAppUrl: process.env.APP_ANDROID_URL,
  iosAppUrl: process.env.APP_IOS_URL,
  expoGoUrl: process.env.EXPO_GO_URL,
  clientDist
});
await instance.store.restoreFromFile(persistencePath);
const persistenceTimer = setInterval(() => {
  instance.store.persistToFile(persistencePath).catch(() => undefined);
}, 5_000);
persistenceTimer.unref?.();
const shutdown = async () => {
  clearInterval(persistenceTimer);
  await instance.store.persistToFile(persistencePath);
  instance.httpServer.close(() => process.exit(0));
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
instance.httpServer.listen(port, () => console.log(`Map Party server em http://localhost:${port}`));
