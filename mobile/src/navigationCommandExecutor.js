import { isLocalNavigationCommand, validateNavigationCommand } from './navigationCommands.js';

export async function executeNavigationCommand(raw, handlers = {}) {
  const command = validateNavigationCommand(raw);
  if (!command) return { success: false, status: 'error', action: raw?.command || raw?.action || null, code: 'INVALID_COMMAND', error: { code: 'INVALID_COMMAND', message: 'Invalid command' }, request_id: raw?.request_id ?? null };
  if (!isLocalNavigationCommand(command.command)) return { success: false, status: 'error', action: command.command, command: command.command, code: 'REMOTE_INTENT_REQUIRED', error: { code: 'REMOTE_INTENT_REQUIRED', message: 'User confirmation required' }, request_id: command.request_id };
  const handler = handlers[command.command];
  if (typeof handler !== 'function') return { success: false, status: 'error', action: command.command, command: command.command, code: 'COMMAND_UNAVAILABLE', error: { code: 'COMMAND_UNAVAILABLE', message: 'Command unavailable on device' }, request_id: command.request_id };
  try {
    const result = await handler(command);
    return { success: true, status: 'ok', action: command.command, command: command.command, request_id: command.request_id, ...(result && typeof result === 'object' ? { result } : {}) };
  } catch (error) {
    const message = error?.message || 'Command execution failed';
    return { success: false, status: 'error', action: command.command, command: command.command, code: 'COMMAND_FAILED', error: { code: 'COMMAND_FAILED', message }, request_id: command.request_id };
  }
}
