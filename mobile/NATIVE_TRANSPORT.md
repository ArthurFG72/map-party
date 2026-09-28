# Native transport contract

Expo Go keeps the bounded offline queue. A release or development-client build may expose `globalThis.MapPartyLocalTransport` from a native module with this contract:

```js
{
  start: async ({ roomId, participantId }) => void,
  stop: async () => void,
  send: async (message) => void,
  onMessage: (callback) => () => void
}
```

The release module uses Google Nearby Connections on both Android and iOS with the same service ID and JSON envelope. This is the local, short-range channel only: the server remains the authoritative path whenever internet connectivity exists. It must reject packets from another `roomId`, relay ciphertext only, deduplicate by ciphertext hash, and apply a short TTL. The private emergency key never belongs on a device.

Android needs runtime nearby-device permissions and a foreground service while an SOS is active. iOS may suspend arbitrary background work, so background BLE is best-effort and must be limited to an explicit SOS. The app must not claim to invoke Apple/Google emergency SOS automatically; that flow remains user-controlled by the operating system.

Expo Go cannot load this native contract. The config plugin adds the iOS `google/nearby` package and the required Bluetooth/local-network/Bonjour declarations during `expo prebuild`. Use an EAS/custom development-client or signed native binary. Cross-platform hardware behavior still requires a physical Android↔iOS test; compilation alone cannot prove radio discovery on every OS/version.
