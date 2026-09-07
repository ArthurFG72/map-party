import { Router } from 'express';

export function routeRouter(service, rateLimit) {
  const router = Router();
  router.post('/', rateLimit, async (req, res) => {
    try {
      return res.json(await service.calculate(req.body));
    } catch (error) {
      if (error.code === 'INVALID_ROUTE') {
        return res.status(400).json({ error: { code: 'INVALID_ROUTE', message: 'Origem, destino ou perfil inválido.' } });
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
  return router;
}
