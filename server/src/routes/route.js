import { Router } from 'express';
import { acceptsContractVersion } from '../contracts.js';

export function routeRouter(service, rateLimit, routeLearningStore = null) {
  const router = Router();
  router.post('/', rateLimit, async (req, res) => {
    try {
      return res.json(await service.calculate(req.body));
    } catch (error) {
      if (error.code === 'INVALID_ROUTE') {
        return res.status(400).json({ error: { code: 'INVALID_ROUTE', message: 'Origem, destino ou perfil inválido.' } });
      }
      if (error.code === 'WATERWAY_UNAVAILABLE') {
        return res.status(422).json({ error: { code: error.code, message: 'Não existe um trecho de rio ou canal navegável entre os pontos selecionados.' } });
      }
      const timeout = error.code === 'PROVIDER_TIMEOUT';
      return res.status(timeout ? 504 : 502).json({
        error: {
          code: timeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR',
          message: timeout ? 'O serviço de rotas excedeu o tempo limite.' : 'O serviço de rotas está indisponível.'
        }
      });
    }
  });
  router.post('/feedback', rateLimit, (req, res) => {
    const payload = req.body || {};
    if (!acceptsContractVersion(payload)) return res.status(400).json({ error: { code: 'INVALID_ROUTE_FEEDBACK', message: 'Versão de contrato inválida.' } });
    const recorded = routeLearningStore?.record(payload) === true;
    return res.json({ ok: true, recorded });
  });
  return router;
}
