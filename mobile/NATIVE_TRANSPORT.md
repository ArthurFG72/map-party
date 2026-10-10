# Native transport contract

Expo Go is not a supported target. Native Android/iOS builds expose `globalThis.MapPartyLocalTransport`; the JavaScript queue is only a bounded fallback when the native bridge is unavailable, with this contract:

```js
{
  start: async ({ roomId, participantId }) => void,
  stop: async () => void,
  // true means the native transport accepted the request; it is not a receipt.
  // false or a missing result keeps the message queued.
  send: async (message) => boolean,
  onMessage: (callback) => () => void
}
```

The release module uses Google Nearby Connections on both Android and iOS with the same service ID and JSON envelope. This is the local, short-range channel only: the server remains the authoritative path whenever internet connectivity exists. A local connection requires users to compare and confirm the same verification code on both devices. A missing code or a rejected code must reject that peer. Both platforms reject packets from another `roomId`, enforce the 16 KB envelope limit, relay bounded envelopes, deduplicate by `messageId`, validate `hops` and apply a short TTL. The private emergency key never belongs on a device.

The bounded JavaScript queue is in memory and survives radio disconnections while the app process remains alive; it is not durable across force-quit or device restart. A `true` result means the native stack accepted the send request, not that every peer received it. The application should use its message-specific acknowledgements where available (for example, SOS acknowledgements) for delivery status.

Location recovery is a separate native path. After the server issues a device-bound credential, Android's foreground location service and iOS's native location module persist the latest fix and upload it to `POST /api/party/:roomId/location` over HTTPS. The upload remains independent from the JavaScript socket and uses a timestamp-based sequence to prevent channel regression.

Android needs runtime nearby-device permissions and a foreground service while an SOS is active. iOS may suspend arbitrary background work, so background BLE is best-effort and must be limited to an explicit SOS. The app must not claim to invoke Apple/Google emergency SOS automatically; that flow remains user-controlled by the operating system.

Expo Go cannot load this native contract. The config plugin adds the iOS `google/nearby` package and the required Bluetooth/local-network/Bonjour declarations during `expo prebuild`. Use an EAS/custom development-client or signed native binary. Cross-platform hardware behavior still requires a physical Android↔iOS test; compilation alone cannot prove radio discovery on every OS/version.
