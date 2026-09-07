import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });
const port = Number(process.env.PORT) || 3001;
const clientDist = fileURLToPath(new URL('../../client/dist/', import.meta.url));
const { httpServer } = createApp({
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  clientDist
});
httpServer.listen(port, () => console.log(`Map Party server em http://localhost:${port}`));
