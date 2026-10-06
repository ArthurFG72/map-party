import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import v8 from 'node:v8';
import { deflateSync, inflateSync } from 'node:zlib';
import { Server } from 'socket.io';
import { registerSocketHandlers } from './socket.js';
import { PartyStore } from './partyStore.js';
import { geocodeRouter } from './routes/geocode.js';
import { createIpRateLimit } from './routes/rateLimit.js';
import { routeRouter } from './routes/route.js';
import { createGeocodeService } from './services/geocodeService.js';
import { createRouteService } from './services/routeService.js';
import { createTrafficStore } from './services/trafficStore.js';
import { createRouteLearningStore } from './services/routeLearningStore.js';
import { poiRouter } from './routes/poi.js';
import { createPoiService } from './services/poiService.js';
import { emergencyRouter } from './routes/emergency.js';
import { createDeviceAuth } from './deviceAuth.js';
import { navigationCommandRouter } from './routes/navigationCommands.js';
import { offlineGraphRouter } from './routes/offlineGraph.js';
import { mcpRouter } from './routes/mcp.js';
import { createAdapterAuth } from './adapterAuth.js';
import { createOfflineGraphService } from './services/offlineGraphService.js';
import { createGeminiAssistant } from './services/geminiAssistantService.js';
import { assistantRouter } from './routes/assistant.js';

export const MAP_TILE_STYLES = Object.freeze({
  simple: 'https://tile.openstreetmap.org',
  detailed: 'https://tile.openstreetmap.de'
});

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([typeBuffer, data])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length);
  return chunk;
}

export function grayscalePng(input) {
  if (!Buffer.isBuffer(input) || input.length < 33 || !input.subarray(0, 8).equals(PNG_SIGNATURE)) return input;
  let width;
  let height;
  let bitDepth;
  let colorType;
  let interlace;
  const imageData = [];
  for (let offset = 8; offset + 12 <= input.length;) {
    const length = input.readUInt32BE(offset);
    const type = input.toString('ascii', offset + 4, offset + 8);
    const data = input.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') imageData.push(data);
    offset += length + 12;
    if (type === 'IEND') break;
  }
  if (colorType === 3 && [1, 2, 4, 8].includes(bitDepth)) {
    const chunks = [];
    let palette;
    for (let offset = 8; offset + 12 <= input.length;) {
      const length = input.readUInt32BE(offset);
      const type = input.toString('ascii', offset + 4, offset + 8);
      const data = input.subarray(offset + 8, offset + 8 + length);
      chunks.push({ type, data });
      if (type === 'PLTE') palette = data;
      offset += length + 12;
      if (type === 'IEND') break;
    }
    if (!palette || palette.length % 3 !== 0) return input;
    const grayscalePalette = Buffer.from(palette);
    for (let index = 0; index < grayscalePalette.length; index += 3) {
      const gray = Math.round(grayscalePalette[index] * 0.299 + grayscalePalette[index + 1] * 0.587 + grayscalePalette[index + 2] * 0.114);
      grayscalePalette[index] = gray;
      grayscalePalette[index + 1] = gray;
      grayscalePalette[index + 2] = gray;
    }
    return Buffer.concat([PNG_SIGNATURE, ...chunks.map(({ type, data }) => pngChunk(type, type === 'PLTE' ? grayscalePalette : data))]);
  }
  if (!width || !height || bitDepth !== 8 || ![2, 6].includes(colorType) || interlace !== 0) return input;
  const channels = colorType === 6 ? 4 : 3;
  const bytesPerRow = width * channels;
  const decoded = inflateSync(Buffer.concat(imageData));
  const pixels = Buffer.alloc(height * bytesPerRow);
  let sourceOffset = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = decoded[sourceOffset++];
    const rowOffset = row * bytesPerRow;
    const previousOffset = rowOffset - bytesPerRow;
    for (let index = 0; index < bytesPerRow; index += 1) {
      const raw = decoded[sourceOffset++];
      const left = index >= channels ? pixels[rowOffset + index - channels] : 0;
      const above = row ? pixels[previousOffset + index] : 0;
      const upperLeft = row && index >= channels ? pixels[previousOffset + index - channels] : 0;
      pixels[rowOffset + index] = (filter === 1 ? raw + left : filter === 2 ? raw + above : filter === 3 ? raw + Math.floor((left + above) / 2) : filter === 4 ? raw + paethPredictor(left, above, upperLeft) : raw) & 0xff;
    }
    for (let x = 0; x < width; x += 1) {
      const pixel = rowOffset + x * channels;
      const gray = Math.round(pixels[pixel] * 0.299 + pixels[pixel + 1] * 0.587 + pixels[pixel + 2] * 0.114);
      pixels[pixel] = gray; pixels[pixel + 1] = gray; pixels[pixel + 2] = gray;
    }
  }
  const scanlines = Buffer.alloc(height * (bytesPerRow + 1));
  for (let row = 0; row < height; row += 1) {
    scanlines[row * (bytesPerRow + 1)] = 0;
    pixels.copy(scanlines, row * (bytesPerRow + 1) + 1, row * bytesPerRow, (row + 1) * bytesPerRow);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = colorType; header[10] = 0; header[11] = 0; header[12] = 0;
  return Buffer.concat([PNG_SIGNATURE, pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(scanlines)), pngChunk('IEND', Buffer.alloc(0))]);
}

function getHeapPressure() {
  const memory = process.memoryUsage();
  const heapLimit = v8.getHeapStatistics().heap_size_limit;
  return heapLimit > 0 ? memory.heapUsed / heapLimit : 0;
}

function normalizeOrigins(origin) {
  return (Array.isArray(origin) ? origin : String(origin).split(','))
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildContentSecurityPolicy() {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.tile.openstreetmap.org",
    "connect-src 'self' https: wss: ws:"
  ].join('; ');
}

export function createApp({
  origin = 'http://localhost:5173',
  maxRoomParticipants,
  maxRooms,
  disconnectGraceMs = 10_000,
  geocodeService,
  routeService,
  trafficStore,
  routeLearningStore,
  offlineGraphService,
  poiService,
  emergencyService,
  restRateLimit,
  clientDist,
  androidAppUrl = process.env.APP_ANDROID_URL || '',
  iosAppUrl = process.env.APP_IOS_URL || '',
  expoGoUrl = process.env.EXPO_GO_URL || '',
  deviceAuthSecret = process.env.DEVICE_AUTH_SECRET,
  navigatorAdapterToken = process.env.NAVIGATOR_ADAPTER_TOKEN,
  assistantService
} = {}) {
  const app = express();
  const production = process.env.NODE_ENV === 'production';
  const allowlist = normalizeOrigins(origin);
  if (production && allowlist.includes('*')) {
    throw new Error('CLIENT_ORIGIN must be an explicit HTTPS origin in production.');
  }
  const nativeAppOrigin = (requestOrigin) => typeof requestOrigin === 'string'
    && /^(mapparty|exp):\/\//i.test(requestOrigin);
  const allowedOrigin = (requestOrigin) => !requestOrigin
    || allowlist.includes('*')
    || allowlist.includes(requestOrigin)
    || nativeAppOrigin(requestOrigin);
  const corsOrigin = (requestOrigin, callback) => {
    callback(null, allowedOrigin(requestOrigin));
  };
  if (production) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (production && req.protocol !== 'https') {
      if (req.method === 'GET' || req.method === 'HEAD') {
        return res.redirect(308, `https://${req.headers.host}${req.originalUrl}`);
      }
      return res.status(400).json({ error: { code: 'HTTPS_REQUIRED', message: 'HTTPS obrigatorio.' } });
    }
    res.set({
      'Content-Security-Policy': buildContentSecurityPolicy(),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'geolocation=(self), camera=(), microphone=()'
    });
    if (production) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json({ limit: '32kb' }));
  app.get('/health', (_req, res) => {
    const memory = process.memoryUsage();
    const heapUsedRatio = getHeapPressure();
    const payload = {
      ok: true,
      uptimeSeconds: Math.round(process.uptime()),
      rooms: store?.rooms.size ?? 0,
      memory: {
        rssMb: Math.round(memory.rss / 1024 / 1024),
        heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(memory.heapTotal / 1024 / 1024),
        pressure: heapUsedRatio >= 0.9
      }
    };
    res.json(payload);
  });
  app.get('/health-lite', (_req, res) => res.json({ ok: true }));
  app.get('/ready', (_req, res) => {
    const pressure = getHeapPressure() >= 0.9;
    const full = store?.rooms.size >= store?.maxRooms;
    res.status(pressure || full ? 503 : 200).json({ ok: !pressure && !full, pressure, full });
  });
  app.get('/api/app-downloads', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ android: androidAppUrl || null, ios: iosAppUrl || null, expoGo: expoGoUrl || null });
  });
  const serveMapTile = async (req, res, style = 'detailed') => {
    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(req.params.y);
    const limit = 2 ** z;
    if (!Number.isInteger(z) || z < 0 || z > 19 || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= limit || y >= limit) {
      return res.status(400).json({ error: { code: 'INVALID_TILE', message: 'Tile invalido.' } });
    }
    const tileHost = MAP_TILE_STYLES[style] || MAP_TILE_STYLES.detailed;
    try {
      const upstream = await fetch(`${tileHost}/${z}/${x}/${y}.png`, {
        headers: { Accept: 'image/png', 'User-Agent': 'PasseiosDasAguias/1.0 (+https://18-228-44-32.sslip.io)' }
      });
      if (!upstream.ok) return res.status(502).json({ error: { code: 'TILE_UNAVAILABLE', message: 'Tile indisponivel.' } });
      res.set({ 'Cache-Control': 'public, max-age=86400', 'Content-Type': 'image/png' });
      const tile = Buffer.from(await upstream.arrayBuffer());
      return res.send(style === 'simple' ? grayscalePng(tile) : tile);
    } catch {
      return res.status(502).json({ error: { code: 'TILE_UNAVAILABLE', message: 'Tile indisponivel.' } });
    }
  };
  app.get('/api/map-tiles/:style/:z/:x/:y.png', (req, res) => {
    if (!['simple', 'detailed'].includes(req.params.style)) {
      return res.status(400).json({ error: { code: 'INVALID_TILE_STYLE', message: 'Estilo de mapa invalido.' } });
    }
    return serveMapTile(req, res, req.params.style);
  });
  app.get('/api/map-tiles/:z/:x/:y.png', (req, res) => serveMapTile(req, res));
  const limiter = restRateLimit || createIpRateLimit();
  const deviceAuth = createDeviceAuth({
    secret: deviceAuthSecret || (production ? '' : 'development-device-auth-secret-change-me'),
  });
  const adapterAuth = createAdapterAuth({
    token: navigatorAdapterToken || (production ? '' : 'development-navigator-adapter-token-change-me')
  });
  let io;
  const commandResults = new Map();
  const rememberCommandResult = (deviceId, result) => {
    if (!deviceId || !result?.request_id) return;
    const key = `${deviceId}:${result.request_id}`;
    commandResults.set(key, { ...result, received_at: Date.now() });
    const timer = setTimeout(() => commandResults.delete(key), 15 * 60 * 1000);
    timer.unref?.();
  };
  const deliverNavigationCommand = (deviceId, command) => {
    let delivered = false;
    for (const socket of io?.sockets?.sockets?.values?.() || []) {
      if (socket.data?.deviceId !== deviceId) continue;
      socket.emit('navigation-command', command);
      delivered = true;
    }
    return delivered;
  };
  const resolvedTrafficStore = trafficStore || createTrafficStore();
  const resolvedRouteLearningStore = routeLearningStore || createRouteLearningStore();
  const resolvedRouteService = routeService || createRouteService({ trafficStore: resolvedTrafficStore, routeLearningStore: resolvedRouteLearningStore });
  app.use('/api/assistant', assistantRouter(assistantService || createGeminiAssistant(), limiter));
  app.use('/api/geocode', geocodeRouter(geocodeService || createGeocodeService(), limiter));
  app.use('/api/route', routeRouter(resolvedRouteService, limiter, resolvedRouteLearningStore));
  app.use('/api/offline/graph', offlineGraphRouter(offlineGraphService || createOfflineGraphService(), limiter));
  app.use('/api/pois', poiRouter(poiService || createPoiService(), limiter));
  app.use('/api/emergency', emergencyRouter(emergencyService, limiter));
  app.use('/api/navigation/commands', navigationCommandRouter({
    deviceAuth,
    rateLimit: limiter,
    getResult: (deviceId, requestId) => commandResults.get(`${deviceId}:${requestId}`),
    deliver: (deviceId, command) => {
      let delivered = false;
      for (const socket of io?.sockets?.sockets?.values?.() || []) {
        if (socket.data?.deviceId !== deviceId) continue;
        socket.emit('navigation-command', command);
        delivered = true;
      }
      return delivered;
    }
  }));
  app.use('/api/mcp', mcpRouter({
    adapterAuth,
    rateLimit: limiter,
    deliver: (deviceId, command) => {
      let delivered = false;
      for (const socket of io?.sockets?.sockets?.values?.() || []) {
        if (socket.data?.deviceId !== deviceId) continue;
        socket.emit('navigation-command', command);
        delivered = true;
      }
      return delivered;
    }
  }));
  app.use('/api/navigator/commands', navigationCommandRouter({
    adapterAuth,
    rateLimit: limiter,
    getResult: (deviceId, requestId) => commandResults.get(`${deviceId}:${requestId}`),
    deliver: (deviceId, command) => {
      let delivered = false;
      for (const socket of io?.sockets?.sockets?.values?.() || []) {
        if (socket.data?.deviceId !== deviceId) continue;
        socket.emit('navigation-command', command);
        delivered = true;
      }
      return delivered;
    }
  }));
  if (clientDist) {
    app.use(express.static(clientDist));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path === '/health') return next();
      return res.sendFile('index.html', { root: clientDist });
    });
  }
  app.use((error, _req, res, _next) => {
    if (error?.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Requisição muito grande.' } });
    }
    if (error instanceof SyntaxError && error.status === 400 && error.body != null) {
      return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'JSON inválido.' } });
    }
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno do servidor.' } });
  });

  const httpServer = createServer(app);
  io = new Server(httpServer, {
    cors: { origin: corsOrigin, methods: ['GET', 'POST'] },
    maxHttpBufferSize: 128_000,
    perMessageDeflate: false,
    allowRequest: (req, callback) => callback(null, allowedOrigin(req.headers.origin))
  });
  const store = registerSocketHandlers(io, new PartyStore({ maxRoomParticipants, maxRooms }), {
    routeService: resolvedRouteService,
    trafficStore: resolvedTrafficStore,
    disconnectGraceMs,
    deviceAuth,
    recordCommandResult: rememberCommandResult,
    requireDeviceAuth: production
  });
  return { app, httpServer, io, store };
}
