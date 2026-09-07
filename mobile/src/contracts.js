export const CONTRACT_VERSION = 1;

export function createCommandId() {
  return `cmd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
}
