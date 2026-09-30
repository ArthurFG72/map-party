import { useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import { EventEmitter, requireOptionalNativeModule } from 'expo-modules-core';
import { setActiveTrackingRoom } from '../offlineStore';
import { stabilizePosition } from '../locationStabilization';

const MAX_ACCEPTABLE_ACCURACY = 60;
const MAX_LOCATION_AGE_MS = 120_000;

export function useLocationSharing({ enabled, roomId, shareLocation = true, onLocation }) {
  const [position, setPosition] = useState(null);
  const [permissionGranted, setPermissionGranted] = useState(null);
  const [status, setStatus] = useState('Localização pausada');
  const callback = useRef(onLocation);
  const positionRef = useRef(null);
  callback.current = onLocation;

  useEffect(() => {
    if (!enabled) return undefined;
    let mounted = true;
    const native = requireOptionalNativeModule('MapPartyLocation');
    if (!native) {
      setPermissionGranted(null);
      setStatus('GPS nativo iOS indisponível nesta versão');
      return undefined;
    }
    const emitter = new EventEmitter(native);
    const subscription = emitter.addListener('onLocation', (value) => {
      const next = { lat: value.latitude, lng: value.longitude, accuracy: value.accuracy || 0, timestamp: value.timestamp || Date.now(), ...(Number.isFinite(value.speed) && value.speed >= 0 ? { speed: value.speed } : {}), ...(Number.isFinite(value.heading) && value.heading >= 0 ? { heading: value.heading } : {}) };
      if (Date.now() - next.timestamp > MAX_LOCATION_AGE_MS || next.timestamp - Date.now() > 30_000) return;
      if (next.accuracy > MAX_ACCEPTABLE_ACCURACY && positionRef.current) return;
      const stable = stabilizePosition(positionRef.current, next);
      if (!stable) return;
      positionRef.current = stable;
      setPosition(stable);
      setStatus(`Precisão aproximada: ${Math.round(next.accuracy)} m`);
      callback.current(stable);
    });
    const errorSubscription = emitter.addListener('onLocationError', (value) => {
      if (mounted) setStatus(value?.message || 'O GPS nativo iOS informou um erro');
    });
    async function start() {
      setStatus('Solicitando localização nativa…');
      const alreadyGranted = await native.isPermissionGranted();
      const granted = alreadyGranted || await native.requestPermission();
      if (!mounted) return;
      if (!granted) {
        let authorizationStatus = null;
        try { authorizationStatus = await native.authorizationStatus?.(); } catch { /* Keep the generic status below. */ }
        setPermissionGranted(false);
        setStatus(`Permissão de localização negada no iOS${authorizationStatus ? ` (${authorizationStatus})` : ''}; abra os Ajustes`);
        return;
      }
      setPermissionGranted(true);
      await setActiveTrackingRoom(shareLocation ? roomId : null);
      if (shareLocation) await native.requestBackgroundPermission().catch(() => false);
      await native.start();
      if (mounted) setStatus('Localização nativa ativa');
    }
    start().catch((error) => mounted && setStatus(error?.message || 'Não foi possível iniciar o GPS nativo'));
    return () => { mounted = false; subscription.remove(); errorSubscription?.remove?.(); setActiveTrackingRoom(null); native.stop?.().catch?.(() => undefined); };
  }, [enabled, roomId, shareLocation]);

  return { position, status, permissionGranted, openSettings: () => Linking.openSettings().catch(() => undefined) };
}
