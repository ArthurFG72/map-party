import { Router } from 'express';

export function assistantRouter(service, rateLimit) {
  const router = Router();
  router.post('/', rateLimit, async (req, res) => {
    const body = req.body || {};
    const message = typeof body.message === 'string' ? body.message : '';
    const history = Array.isArray(body.history) ? body.history : [];
    if (message.trim().length > 1200 || history.length > 20) return res.status(400).json({ error: { code: 'INVALID_ASSISTANT_MESSAGE', message: 'Mensagem ou histórico muito grande.' } });
    try {
      const result = await service.ask({ message, history, context: body.context });
      return res.json({ ok: true, ...result });
    } catch (error) {
      const status = error.code === 'ASSISTANT_NOT_CONFIGURED' ? 503 : error.code === 'INVALID_ASSISTANT_MESSAGE' ? 400 : error.code === 'ASSISTANT_TIMEOUT' ? 504 : 502;
      return res.status(status).json({ error: { code: error.code || 'ASSISTANT_ERROR', message: error.message } });
    }
  });
  return router;
}
