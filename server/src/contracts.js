export const CONTRACT_VERSION = 1;

// Payloads without a version are the legacy v0 contract and remain accepted.
export function acceptsContractVersion(payload) {
  return payload?.contractVersion == null || payload.contractVersion === CONTRACT_VERSION;
}

export function versioned(payload) {
  return { ...payload, contractVersion: CONTRACT_VERSION };
}
