import { useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import { EventEmitter, requireOptionalNativeModule } from 'expo-modules-core';
import { setActiveTrackingRoom } from '../offlineStore';
import { hasUsableAccuracy, stabilizePosition } from '../locationStabilization';

const MAX_ACCEPTABLE_ACCURACY = 60;
const MAX_LOCATION_AGE_MS = 120_000;

export function useLocationSharing({ enabled, roomId, shareLocation = true, mode = 'tracking', onLocation }) {
  const [position, setPosition] = useState(null);
  const [permissionGranted, setPermissionGranted] = useState(null);
  const [status, setStatus] = useState('Localização pausada');
  const callback = useRef(onLocation);
  const positionRef = useRef(null);
  callback.current = onLocation;

  useEffect(() => {
    if (!enabled) return undefined;
    let mounted = true;
    // A mode transition must not carry the last tracking fix/speed into a
    // newly started navigation session.
    positionRef.current = null;
    setPosition(null);
    const native = requireOptionalNativeModule('MapPartyLocation');
    if (!native) {
      setPermissionGranted(null);
      setStatus('GPS nativo iOS indisponível nesta versão');
      return undefined;
    }
    const maxLocationAge = mode === 'navigation' || mode === 'boat' ? 15_000 : MAX_LOCATION_AGE_MS;
    const emitter = new EventEmitter(native);
    const subscription = emitter.addListener('onLocation', (value) => {
      const next = { lat: value.latitude, lng: value.longitude, accuracy: Number(value.accuracy), timestamp: value.timestamp || Date.now(), ...(Number.isFinite(value.speed) && value.speed >= 0 ? { nativeSpeed: value.speed } : {}), ...(Number.isFinite(value.heading) && value.heading >= 0 ? { heading: value.heading } : {}) };
      if (Date.now() - next.timestamp > maxLocationAge || next.timestamp - Date.now() > 30_000) return;
      // Do not let a coarse first fix place the marker far from the real
      // position. Later fixes are subject to the same bound as well.
      if (!hasUsableAccuracy(next, MAX_ACCEPTABLE_ACCURACY)) return;
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
      await native.setMode?.(mode);
      // Start foreground GPS first. iOS may defer the Always/background
      // authorization request; it must not block the first location fix.
      await native.start();
      await setActiveTrackingRoom(shareLocation ? roomId : null);
      if (shareLocation) native.requestBackgroundPermission().catch(() => false);
      if (mounted) setStatus('Localização nativa ativa');
    }
    start().catch((error) => mounted && setStatus(error?.message || 'Não foi possível iniciar o GPS nativo'));
    return () => { mounted = false; subscription.remove(); errorSubscription?.remove?.(); setActiveTrackingRoom(null); native.stop?.().catch?.(() => undefined); };
  }, [enabled, mode, roomId, shareLocation]);

  return { position, status, permissionGranted, openSettings: () => Linking.openSettings().catch(() => undefined) };
}
