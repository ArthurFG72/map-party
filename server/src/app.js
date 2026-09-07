import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { registerSocketHandlers } from './socket.js';
import { PartyStore } from './partyStore.js';
import { geocodeRouter } from './routes/geocode.js';
import { createIpRateLimit } from './routes/rateLimit.js';
import { routeRouter } from './routes/route.js';
import { createGeocodeService } from './services/geocodeService.js';
import { createRouteService } from './services/routeService.js';
import { poiRouter } from './routes/poi.js';
import { createPoiService } from './services/poiService.js';

export function createApp({
  origin = 'http://localhost:5173',
  maxRoomParticipants,
  geocodeService,
  routeService,
  poiService,
  restRateLimit,
  clientDist
} = {}) {
  const app = express();
  const allowlist = Array.isArray(origin)
    ? origin
    : String(origin).split(',').map((item) => item.trim()).filter(Boolean);
  const corsOrigin = (requestOrigin, callback) => {
    const allowed = !requestOrigin || allowlist.includes('*') || allowlist.includes(requestOrigin);
    callback(null, allowed);
  };
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json({ limit: '32kb' }));
  app.get('/health', (_req, res) => res.json({ ok: true }));
  const limiter = restRateLimit || createIpRateLimit();
  app.use('/api/geocode', geocodeRouter(geocodeService || createGeocodeService(), limiter));
  app.use('/api/route', routeRouter(routeService || createRouteService(), limiter));
  app.use('/api/pois', poiRouter(poiService || createPoiService(), limiter));
  if (clientDist) {
    app.use(express.static(clientDist));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path === '/health') return next();
      return res.sendFile('index.html', { root: clientDist });
    });
  }

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: corsOrigin, methods: ['GET', 'POST'] },
    maxHttpBufferSize: 128_000
  });
  const store = registerSocketHandlers(io, new PartyStore({ maxRoomParticipants }));
  return { app, httpServer, io, store };
}
