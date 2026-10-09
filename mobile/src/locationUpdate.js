import { CONTRACT_VERSION } from './contracts.js';

// Socket validation accepts the coordinates at the top level. Keep the
// foreground and background producers on exactly the same wire format.
export function createLocationUpdate(location, locationSequence = Date.now(), options = {}) {
  return {
    ...location,
    contractVersion: CONTRACT_VERSION,
    locationSequence: Math.max(1, Math.trunc(locationSequence)),
    ...(options.forceBroadcast ? { forceBroadcast: true } : {})
  };
}
