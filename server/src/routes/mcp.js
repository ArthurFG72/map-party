import { Router } from 'express';
import { cleanNavigationCommand } from '../navigationCommands.js';
import { cleanDeviceId } from '../validation.js';

function bearerToken(header) {
  const match = typeof header === 'string' ? /^Bearer\s+(.+)$/i.exec(header) : null;
  return match?.[1] || null;
}

const TOOL = {
  name: 'navigator_command',
  description: 'Envia uma ação estruturada ao Navigator Control API. Destinos e mudanças de rota continuam sujeitos à confirmação no aparelho.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['request_id', 'device_id', 'action', 'parameters'],
    properties: {
      request_id: { type: 'string', minLength: 8, maxLength: 64 },
      device_id: { type: 'string', pattern: '^nav_[A-Za-z0-9_-]{8,96}$' },
      action: { type: 'string', enum: [
        'navigation.start', 'navigation.pause', 'navigation.resume', 'navigation.cancel',
        'navigation.set_destination', 'navigation.get_status', 'navigation.get_position',
        'location.get', 'location.share', 'message.send', 'sos.send'
      ] },
      parameters: { type: 'object' }
    }
  }
};

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function rpcResult(id, value) {
  return { jsonrpc: '2.0', id, result: value };
}

export function mcpRouter({ adapterAuth, deliver, rateLimit }) {
  const router = Router();
  router.post('/', rateLimit, (req, res) => {
    const id = req.body?.id;
    const method = req.body?.method;
    if (req.body?.jsonrpc !== '2.0' || typeof method !== 'string') {
      return res.status(400).json(rpcError(id, -32600, 'Invalid JSON-RPC request'));
    }
    if (method === 'notifications/initialized') return res.status(202).end();
    if (method === 'initialize') {
      return res.json(rpcResult(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'map-party-navigator', version: '1.0.0' }
      }));
    }
    if (method === 'tools/list') return res.json(rpcResult(id, { tools: [TOOL] }));
    if (method !== 'tools/call') return res.status(404).json(rpcError(id, -32601, 'Method not found'));
    if (req.body?.params?.name !== TOOL.name) return res.status(400).json(rpcError(id, -32602, 'Unknown tool'));

    const args = req.body.params.arguments;
    const deviceId = cleanDeviceId(args?.device_id);
    const command = cleanNavigationCommand(args);
    const credential = adapterAuth.authorizes(bearerToken(req.headers.authorization));
    if (!deviceId || !command || !credential) {
      return res.status(401).json(rpcError(id, -32001, 'Unauthorized navigator command'));
    }
    const delivered = deliver(deviceId, command);
    const payload = {
      success: delivered,
      status: delivered ? 'accepted' : 'error',
      action: command.command,
      request_id: command.request_id,
      ...(delivered ? {} : { error: { code: 'DEVICE_OFFLINE', message: 'Device is offline' } })
    };
    return res.json(rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload }));
  });
  return router;
}
