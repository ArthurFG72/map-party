import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });
const port = Number(process.env.PORT) || 3001;
const clientDist = fileURLToPath(new URL('../../client/dist/', import.meta.url));
const { httpServer } = createApp({
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  maxRoomParticipants: Number(process.env.MAX_ROOM_PARTICIPANTS) || undefined,
  maxRooms: Number(process.env.MAX_ROOMS) || undefined,
  androidAppUrl: process.env.APP_ANDROID_URL,
  iosAppUrl: process.env.APP_IOS_URL,
  expoGoUrl: process.env.EXPO_GO_URL,
  clientDist
});
httpServer.listen(port, () => console.log(`Map Party server em http://localhost:${port}`));
