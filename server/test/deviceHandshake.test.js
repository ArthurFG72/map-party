import test from 'node:test';
import assert from 'node:assert/strict';
import { io as createClient } from 'socket.io-client';
import { createApp } from '../src/app.js';

test('rejects a malformed device id before creating party membership', async (t) => {
  const instance = createApp({ origin: '*', routeService: { calculate: async () => null } });
  await new Promise((resolve) => instance.httpServer.listen(0, '127.0.0.1', resolve));
  const port = instance.httpServer.address().port;
  const socket = createClient(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true });
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  t.after(async () => { socket.disconnect(); await new Promise((resolve) => instance.io.close(resolve)); });

  const reply = await new Promise((resolve) => socket.emit('join-party', {
    roomId: 'device-test', name: 'Ana', deviceId: 'nav_invalid',
  }, resolve));
  assert.equal(reply.ok, false);
  assert.equal(instance.store.rooms.size, 0);
});
