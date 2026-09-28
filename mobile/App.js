import { useState } from 'react';
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

export default function App() {
  const [session, setSession] = useState(null);
  if (Platform.OS === 'web') return <WebFallback />;
  return <>
    <StatusBar barStyle={session ? 'light-content' : 'dark-content'} backgroundColor={session ? '#0b172a' : '#ffffff'} />
    {session
      ? <PartyScreen session={session} onLeave={() => setSession(null)} />
      : <HomeScreen onEnter={setSession} />}
  </>;
}

const styles = StyleSheet.create({
  webFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#f8fafc' },
  webTitle: { color: '#0f172a', fontSize: 28, fontWeight: '800' },
  webMessage: { maxWidth: 420, marginTop: 10, color: '#475569', textAlign: 'center', lineHeight: 22 },
  webButton: { marginTop: 18, minHeight: 44, paddingHorizontal: 18, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#16a34a' },
  webButtonText: { color: '#fff', fontWeight: '800' }
});
