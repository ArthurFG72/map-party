import { Router } from 'express';

export function offlineGraphRouter(service, rateLimit) {
  const router = Router();
  router.post('/', rateLimit, async (req, res) => {
    try { return res.json(await service.build(req.body)); }
    catch (error) {
      if (error.code === 'INVALID_OFFLINE_GRAPH') return res.status(400).json({ error: { code: error.code, message: 'Geometria de corredor offline invalida.' } });
      if (error.code === 'GRAPH_LIMIT' || error.code === 'GRAPH_EMPTY') return res.status(422).json({ error: { code: error.code, message: 'O corredor offline excede os limites do aparelho.' } });
      return res.status(error.code === 'PROVIDER_TIMEOUT' ? 504 : 502).json({ error: { code: error.code === 'PROVIDER_TIMEOUT' ? error.code : 'PROVIDER_ERROR', message: 'O provedor OSM esta indisponivel.' } });
    }
  });
  return router;
}
