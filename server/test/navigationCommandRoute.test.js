import test from 'node:test';
import assert from 'node:assert/strict';
import { io as createClient } from 'socket.io-client';
import { createApp } from '../src/app.js';

function emit(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

test('delivers an authorized command only to its connected device', async (t) => {
  const instance = createApp({
    origin: '*',
    deviceAuthSecret: 'test-device-auth-secret-with-more-than-32-characters',
    routeService: { calculate: async () => null }
  });
  await new Promise((resolve) => instance.httpServer.listen(0, '127.0.0.1', resolve));
  const port = instance.httpServer.address().port;
  const socket = createClient(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true });
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  t.after(async () => { socket.disconnect(); await new Promise((resolve) => instance.io.close(resolve)); });

  const joined = await emit(socket, 'join-party', {
    roomId: 'device-command', name: 'Ana',
    deviceId: 'nav_0123456789abcdef', participantToken: 'a'.repeat(32)
  });
  assert.equal(joined.ok, true);
  assert.ok(joined.deviceCredential);

  const command = new Promise((resolve) => socket.once('navigation-command', resolve));
  const response = await fetch(`http://127.0.0.1:${port}/api/navigation/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${joined.deviceCredential}` },
    body: JSON.stringify({ device_id: 'nav_0123456789abcdef', command: 'navigation.pause', request_id: 'request_123' })
  });
  assert.equal(response.status, 202);
  assert.deepEqual(await command, { command: 'navigation.pause', request_id: 'request_123' });

  socket.emit('navigation-command-result', {
    command: 'navigation.pause', request_id: 'request_123', success: true,
    result: { message: 'Navegação pausada.' }
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const resultResponse = await fetch(`http://127.0.0.1:${port}/api/navigation/commands/request_123?device_id=nav_0123456789abcdef`, {
    headers: { authorization: `Bearer ${joined.deviceCredential}` }
  });
  assert.equal(resultResponse.status, 200);
  assert.equal((await resultResponse.json()).result.message, 'Navegação pausada.');

  const rejected = await fetch(`http://127.0.0.1:${port}/api/navigation/commands`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device_id: 'nav_0123456789abcdef', command: 'navigation.pause', request_id: 'request_123' })
  });
  assert.equal(rejected.status, 401);
});

test('accepts location, message and SOS command payloads', async () => {
  const instance = createApp({
    origin: '*',
    deviceAuthSecret: 'test-device-auth-secret-with-more-than-32-characters'
  });
  await new Promise((resolve) => instance.httpServer.listen(0, '127.0.0.1', resolve));
  const port = instance.httpServer.address().port;
  const socket = createClient(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true });
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  const joined = await emit(socket, 'join-party', {
    roomId: 'device-command-2', name: 'Ana', deviceId: 'nav_0123456789abcdef', participantToken: 'b'.repeat(32)
  });
  const received = [];
  socket.on('navigation-command', (command) => received.push(command));
  for (const body of [
    { command: 'location.get' },
    { command: 'location.share', enabled: false },
    { command: 'message.send', target_participant_id: 'participant_1', text: 'Olá' },
    { command: 'sos.send', message: 'Preciso de ajuda' }
  ]) {
    const response = await fetch(`http://127.0.0.1:${port}/api/navigation/commands`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${joined.deviceCredential}` },
      body: JSON.stringify({ device_id: 'nav_0123456789abcdef', request_id: `request_${received.length + 20}`, ...body })
    });
    assert.equal(response.status, 202);
  }
  assert.equal(received.length, 4);
  socket.disconnect();
  await new Promise((resolve) => instance.io.close(resolve));
});

test('accepts the universal action and parameters contract', async (t) => {
  const instance = createApp({ origin: '*', deviceAuthSecret: 'test-device-auth-secret-with-more-than-32-characters' });
  await new Promise((resolve) => instance.httpServer.listen(0, '127.0.0.1', resolve));
  const port = instance.httpServer.address().port;
  const socket = createClient(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true });
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  t.after(async () => { socket.disconnect(); await new Promise((resolve) => instance.io.close(resolve)); });
  const joined = await emit(socket, 'join-party', {
    roomId: 'universal-contract', name: 'Ana', deviceId: 'nav_0123456789abcdef', participantToken: 'c'.repeat(32)
  });
  const received = new Promise((resolve) => socket.once('navigation-command', resolve));
  const response = await fetch(`http://127.0.0.1:${port}/api/navigation/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${joined.deviceCredential}` },
    body: JSON.stringify({
      request_id: 'uuid-request-123', device_id: 'nav_0123456789abcdef', action: 'navigation.pause', parameters: {}
    })
  });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).action, 'navigation.pause');
  assert.deepEqual(await received, { command: 'navigation.pause', request_id: 'uuid-request-123' });
});

test('exposes the Navigator Protocol through the MCP adapter', async (t) => {
  const instance = createApp({ origin: '*', deviceAuthSecret: 'test-device-auth-secret-with-more-than-32-characters' });
  await new Promise((resolve) => instance.httpServer.listen(0, '127.0.0.1', resolve));
  const port = instance.httpServer.address().port;
  const init = await fetch(`http://127.0.0.1:${port}/api/mcp`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
  });
  assert.equal(init.status, 200);
  const tools = await fetch(`http://127.0.0.1:${port}/api/mcp`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  });
  assert.equal(tools.status, 200);
  assert.equal((await tools.json()).result.tools[0].name, 'navigator_command');
  t.after(async () => { await new Promise((resolve) => instance.io.close(resolve)); });
});

test('mandatory flow: AI to Navigator Protocol to iPhone and execution result back to AI', async (t) => {
  const instance = createApp({ origin: '*', deviceAuthSecret: 'test-device-auth-secret-with-more-than-32-characters' });
  await new Promise((resolve) => instance.httpServer.listen(0, '127.0.0.1', resolve));
  const port = instance.httpServer.address().port;
  const socket = createClient(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true });
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  t.after(async () => { socket.disconnect(); await new Promise((resolve) => instance.io.close(resolve)); });
  const joined = await emit(socket, 'join-party', {
    roomId: 'mandatory-pause-flow', name: 'iPhone', deviceId: 'nav_0123456789abcdef', participantToken: 'd'.repeat(32)
  });
  socket.once('navigation-command', (command) => {
    assert.equal(command.command, 'navigation.pause');
    socket.emit('navigation-command-result', {
      request_id: command.request_id,
      action: command.command,
      success: true,
      status: 'ok',
      result: { paused: true }
    });
  });
  const requestId = 'pause-flow-123';
  const accepted = await fetch(`http://127.0.0.1:${port}/api/navigation/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${joined.deviceCredential}` },
    body: JSON.stringify({ request_id: requestId, device_id: 'nav_0123456789abcdef', action: 'navigation.pause', parameters: {} })
  });
  assert.equal(accepted.status, 202);
  let response;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    response = await fetch(`http://127.0.0.1:${port}/api/navigation/commands/${requestId}?device_id=nav_0123456789abcdef`, {
      headers: { authorization: `Bearer ${joined.deviceCredential}` }
    });
    if (response.status === 200) break;
  }
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.success, true);
  assert.equal(result.action, 'navigation.pause');
  assert.equal(result.status, 'ok');
  assert.equal(result.result.paused, true);
});

test('adapter authentication is separate from device authentication', async (t) => {
  const adapterToken = 'adapter-token-for-tests-with-at-least-32-chars';
  const instance = createApp({ origin: '*', navigatorAdapterToken: adapterToken, deviceAuthSecret: 'test-device-auth-secret-with-more-than-32-characters' });
  await new Promise((resolve) => instance.httpServer.listen(0, '127.0.0.1', resolve));
  const port = instance.httpServer.address().port;
  const denied = await fetch(`http://127.0.0.1:${port}/api/navigator/commands`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer wrong-adapter-token' },
    body: JSON.stringify({ request_id: 'adapter-test-1', device_id: 'nav_0123456789abcdef', action: 'navigation.pause', parameters: {} })
  });
  assert.equal(denied.status, 401);
  t.after(async () => { await new Promise((resolve) => instance.io.close(resolve)); });
});
