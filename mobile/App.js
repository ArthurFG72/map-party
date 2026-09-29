import { Component, useState } from 'react';
import { DeviceEventEmitter, Linking, NativeModules, Platform, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { EventEmitter, requireOptionalNativeModule } from 'expo-modules-core';
import HomeScreen from './src/screens/HomeScreen';
import PartyScreen from './src/screens/PartyScreen';

function installNativeTransport() {
  const nativeModule = NativeModules?.MapPartyLocalTransport;
  const expoModule = !nativeModule ? requireOptionalNativeModule('MapPartyLocalTransport') : null;
  const native = nativeModule || expoModule;
  if (!native || globalThis.MapPartyLocalTransport) return;
  const eventNames = ['message', 'connectionVerification', 'connected', 'disconnected', 'connectionFailed', 'endpointLost', 'permissionsRequired', 'started', 'error'];
  const emitter = expoModule ? new EventEmitter(expoModule) : null;
  globalThis.MapPartyLocalTransport = {
    start: (options = {}) => expoModule ? native.start(options.roomId, options.participantId || 'participant') : native.start(options),
    stop: () => native.stop(),
    send: (message) => expoModule ? native.sendJson(JSON.stringify(message)) : native.send(message),
    requestPermissions: () => native.requestPermissions?.() ?? Promise.resolve(true),
    verifyConnection: ({ endpointId, accepted }) => expoModule ? native.verify(endpointId, Boolean(accepted)) : native.acceptConnection(endpointId, Boolean(accepted)),
    subscribe: (callback) => {
      const subscriptions = expoModule
        ? [
            emitter.addListener('onMessage', (data) => callback({ type: 'message', ...(data || {}) })),
            emitter.addListener('onVerification', (data) => callback({ type: 'connectionVerification', ...(data || {}) })),
            emitter.addListener('onPeer', (data) => callback({ type: data?.state || 'status', ...(data || {}) }))
          ]
        : eventNames.map((eventName) => DeviceEventEmitter.addListener(eventName, (data) => callback({ type: eventName, ...(data || {}) })));
      return { remove: () => subscriptions.forEach((subscription) => subscription.remove()) };
    }
  };
}

installNativeTransport();

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary);
}

function installNativeEmergencyCrypto() {
  const nativeModule = NativeModules?.MapPartyEmergencyCrypto;
  const expoModule = !nativeModule ? requireOptionalNativeModule('MapPartyEmergencyCrypto') : null;
  const native = nativeModule || expoModule;
  if (!native || globalThis.MapPartyEmergencyCrypto) return;
  globalThis.MapPartyEmergencyCrypto = {
    seal: async (publicKey, payload) => {
      const ciphertext = await native.seal(publicKey.publicKeyPem, arrayBufferToBase64(payload));
      return {
        keyId: publicKey.keyId,
        ciphertext: String(ciphertext).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      };
    }
  };
}

installNativeEmergencyCrypto();


function webAppUrl() {
  if (typeof window === 'undefined') return 'https://18-228-44-32.sslip.io';
  const url = new URL(window.location.href);
  url.port = '3001';
  return url.toString().replace(/\/$/, '');
}

function WebFallback() {
  const url = webAppUrl();
  return <View style={styles.webFallback}>
    <Text style={styles.webTitle}>Map Party</Text>
      <Text style={styles.webMessage}>A versão Expo usa componentes nativos e não roda a party no navegador.</Text>
    <Pressable accessibilityRole="link" onPress={() => Linking.openURL(url)} style={styles.webButton}>
      <Text style={styles.webButtonText}>Abrir versÃ£o web</Text>
    </Pressable>
  </View>;
}

class NativeRenderBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[MapParty] render failure', error, info?.componentStack || '');
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <View style={styles.renderFailure}>
      <Text style={styles.renderFailureTitle}>Não foi possível abrir o mapa</Text>
      <Text style={styles.renderFailureMessage}>O aplicativo continua aberto. Feche e abra novamente para tentar restaurar a sessão.</Text>
      <Text selectable style={styles.renderFailureDetails}>{String(this.state.error?.message || this.state.error)}</Text>
    </View>;
  }
}

export default function App() {
  const [session, setSession] = useState(null);
  if (Platform.OS === 'web') return <WebFallback />;
  return <NativeRenderBoundary><>
    <StatusBar barStyle={session ? 'light-content' : 'dark-content'} backgroundColor={session ? '#0b172a' : '#ffffff'} />
    {session
      ? <PartyScreen session={session} onLeave={() => setSession(null)} />
      : <HomeScreen onEnter={setSession} />}
  </></NativeRenderBoundary>;
}

const styles = StyleSheet.create({
  webFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#f8fafc' },
  webTitle: { color: '#0f172a', fontSize: 28, fontWeight: '800' },
  webMessage: { maxWidth: 420, marginTop: 10, color: '#475569', textAlign: 'center', lineHeight: 22 },
  webButton: { marginTop: 18, minHeight: 44, paddingHorizontal: 18, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#16a34a' },
  webButtonText: { color: '#fff', fontWeight: '800' },
  renderFailure: { flex: 1, padding: 24, justifyContent: 'center', backgroundColor: '#0f172a' },
  renderFailureTitle: { color: '#fff', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  renderFailureMessage: { marginTop: 12, color: '#cbd5e1', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  renderFailureDetails: { marginTop: 18, color: '#fca5a5', fontSize: 11 }
});
