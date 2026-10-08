import { Router } from 'express';
import { cleanNavigationCommand } from '../navigationCommands.js';
import { cleanDeviceId } from '../validation.js';

function bearerToken(header) {
  const match = typeof header === 'string' ? /^Bearer\s+(.+)$/i.exec(header) : null;
  return match?.[1] || null;
}

export function navigationCommandRouter({ deviceAuth, adapterAuth = null, deliver, getResult, rateLimit }) {
  const router = Router();
  router.post('/', rateLimit, (req, res) => {
    const deviceId = cleanDeviceId(req.body?.device_id);
    const command = cleanNavigationCommand(req.body);
    const credential = adapterAuth
      ? adapterAuth.authorizes(bearerToken(req.headers.authorization))
      : deviceAuth.authorizes(bearerToken(req.headers.authorization), deviceId);
    if (!deviceId || !command || !credential) {
      return res.status(401).json({ success: false, code: 'UNAUTHORIZED_COMMAND' });
    }
    const delivered = deliver(deviceId, command);
    return res.status(delivered ? 202 : 409).json({
      success: delivered,
      command: command.command,
      action: command.command,
      request_id: command.request_id,
      ...(delivered ? {} : { code: 'DEVICE_OFFLINE' })
    });
  });
  router.get('/:requestId', rateLimit, (req, res) => {
    const deviceId = cleanDeviceId(req.query?.device_id);
    const credential = adapterAuth
      ? adapterAuth.authorizes(bearerToken(req.headers.authorization))
      : deviceAuth.authorizes(bearerToken(req.headers.authorization), deviceId);
    const requestId = typeof req.params.requestId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(req.params.requestId)
      ? req.params.requestId : null;
    if (!deviceId || !requestId || !credential) {
      return res.status(401).json({ success: false, code: 'UNAUTHORIZED_COMMAND' });
    }
    const result = getResult?.(deviceId, requestId);
    if (!result) return res.status(404).json({ success: false, code: 'COMMAND_RESULT_PENDING' });
    return res.json({ success: true, ...result });
  });
  return router;
}
