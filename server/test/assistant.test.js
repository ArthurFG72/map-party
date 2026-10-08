import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createGeminiAssistant } from '../src/services/geminiAssistantService.js';

function startServer(options = {}) {
  const server = createApp({ origin: '*', restRateLimit: (_req, _res, next) => next(), ...options });
  return new Promise((resolve) => server.httpServer.listen(0, '127.0.0.1', () => resolve({ ...server, url: `http://127.0.0.1:${server.httpServer.address().port}` })));
}

test('assistente converte resposta Gemini em chamada de ferramenta', async () => {
  const service = createGeminiAssistant({ apiKey: 'test-key', fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.tools[0].functionDeclarations.some((item) => item.name === 'search_place'), true);
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ functionCall: { name: 'search_place', args: { query: 'hotel' } } }] } }] }) };
  } });
  const result = await service.ask({ message: 'me leve para um hotel' });
  assert.deepEqual(result.toolCall, { name: 'search_place', args: { query: 'hotel' } });
});

test('rota do assistente retorna 503 sem chave sem derrubar o servidor', async (t) => {
  const server = await startServer({ assistantService: createGeminiAssistant({ apiKey: '' }) });
  t.after(() => new Promise((resolve) => server.io.close(resolve)));
  const response = await fetch(`${server.url}/api/assistant`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'oi' }) });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'ASSISTANT_NOT_CONFIGURED');
});
