import { Router } from 'express';

export function poiRouter(service, rateLimit) {
  const router = Router();
  router.get('/', rateLimit, async (req, res) => {
    try { return res.json(await service.search({ bbox: req.query.bbox, lat: req.query.lat, lng: req.query.lng ?? req.query.lon, radius: req.query.radius, categories: req.query.categories, limit: req.query.limit ?? 80 })); }
    catch (error) {
      if (error.code === 'INVALID_POI_REQUEST') return res.status(400).json({ error: { code: error.code, message: 'Informe bbox válido e categorias restaurant ou fuel.' } });
      const timeout = error.code === 'PROVIDER_TIMEOUT';
      // POIs sao complementares ao mapa; preserve a party quando o Overpass falhar.
      return res.json({
        results: [],
        warning: timeout ? 'Pontos de interesse demoraram para responder.' : 'Pontos de interesse temporariamente indisponiveis.',
        attribution: 'Dados OpenStreetMap (Overpass)'
      });
      return res.status(timeout ? 504 : 502).json({ error: { code: timeout ? error.code : 'PROVIDER_ERROR', message: timeout ? 'O serviço de pontos de interesse excedeu o tempo limite.' : 'O serviço de pontos de interesse está indisponível.' } });
    }
  });
  return router;
}
