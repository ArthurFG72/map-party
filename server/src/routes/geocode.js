import { Router } from 'express';
import { normalizeCenter, normalizeQuery, normalizeViewbox } from '../services/geocodeService.js';

export function geocodeRouter(service, rateLimit) {
  const router = Router();
  router.get('/', rateLimit, async (req, res) => {
    const query = normalizeQuery(req.query.q);
    const viewbox = normalizeViewbox(req.query.viewbox);
    const center = normalizeCenter({ lat: req.query.lat, lng: req.query.lon });
    const requestedLimit = Number(req.query.limit ?? 5);
    if (!query || (req.query.viewbox != null && !viewbox) || (req.query.lat != null && !req.query.lon) || (req.query.lon != null && !req.query.lat) || ((req.query.lat != null || req.query.lon != null) && !center) || !Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 5) {
      return res.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Informe uma busca entre 3 e 160 caracteres.' } });
    }
    try {
      return res.json(await service.search(query, requestedLimit, viewbox, center));
    } catch (error) {
      const timeout = error.code === 'PROVIDER_TIMEOUT';
      return res.status(timeout ? 504 : 502).json({
        error: {
          code: timeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR',
          message: timeout ? 'O geocodificador excedeu o tempo limite.' : 'O geocodificador está indisponível.'
        }
      });
    }
  });
  return router;
}
