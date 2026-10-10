export async function attemptEmergencyDelivery({ online, sendLocal, sendSignal, relay }) {
  const localAttempt = Promise.resolve().then(sendLocal).catch(() => false);
  if (!online) {
    const localSent = await localAttempt;
    return { localSent: Boolean(localSent), signalSent: false, relayAccepted: false };
  }

  const signalAttempt = Promise.resolve().then(sendSignal).then(() => true, () => false);
  const relayAttempt = Promise.resolve().then(relay).catch(() => ({ relayed: false }));
  const [localSent, signalSent, relayResult] = await Promise.all([localAttempt, signalAttempt, relayAttempt]);
  return {
    ...relayResult,
    localSent: Boolean(localSent),
    signalSent,
    // HTTP acceptance only means the server stored/opened the packet; it does
    // not prove delivery to party members.
    relayAccepted: relayResult?.ok === true
  };
}
