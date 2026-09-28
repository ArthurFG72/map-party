import { useEffect, useRef, useState } from 'react';
import { DeviceEventEmitter, Linking, NativeModules } from 'react-native';
import { loadPermissionPrompted, markPermissionPrompted, setActiveTrackingRoom } from '../offlineStore';

const MAX_ACCEPTABLE_ACCURACY = 80;
const MAX_LOCATION_AGE_MS = 120_000;
const STATIONARY_SPEED = 0.8;
const MIN_STATIONARY_MOVEMENT = 8;
const MAX_REALISTIC_SPEED = 90;

function distanceMeters(first, second) {
  const lat = (second.lat - first.lat) * Math.PI / 180;
  const lng = (second.lng - first.lng) * Math.PI / 180;
  const a = Math.sin(lat / 2) ** 2 + Math.cos(first.lat * Math.PI / 180) * Math.cos(second.lat * Math.PI / 180) * Math.sin(lng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function stabilizePosition(previous, next) {
  if (!previous) return next;
  const elapsedSeconds = Math.max(0.1, (next.timestamp - previous.timestamp) / 1000);
  const distance = distanceMeters(previous, next);
  const reportedSpeed = Number.isFinite(next.speed) ? next.speed : 0;
  const accuracyLimit = Math.max(MIN_STATIONARY_MOVEMENT, Math.min(previous.accuracy || 0, next.accuracy || 0));
  if (reportedSpeed < STATIONARY_SPEED && distance <= accuracyLimit) return { ...previous, timestamp: next.timestamp, accuracy: Math.min(previous.accuracy || next.accuracy, next.accuracy), speed: 0 };
  const maximumDistance = MAX_REALISTIC_SPEED * elapsedSeconds + (previous.accuracy || 0) + (next.accuracy || 0);
  return distance > maximumDistance ? null : next;
}

export function useLocationSharing({ enabled, roomId, shareLocation = true, onLocation }) {
  const [position, setPosition] = useState(null);
  const [status, setStatus] = useState('Localização pausada');
  const [permissionGranted, setPermissionGranted] = useState(null);
  const callback = useRef(onLocation);
  const positionRef = useRef(null);
  callback.current = onLocation;

  useEffect(() => {
    if (!enabled) return undefined;
    let mounted = true;
    const native = NativeModules.MapPartyLocation;
    const subscription = DeviceEventEmitter.addListener('MapPartyLocation', (value) => {
      const next = { lat: value.latitude, lng: value.longitude, accuracy: value.accuracy || 0, timestamp: value.timestamp || Date.now(), ...(Number.isFinite(value.speed) ? { speed: value.speed } : {}), ...(Number.isFinite(value.heading) ? { heading: value.heading } : {}) };
      if (Date.now() - next.timestamp > MAX_LOCATION_AGE_MS || next.timestamp - Date.now() > 30_000) return;
      if (next.accuracy > MAX_ACCEPTABLE_ACCURACY && positionRef.current) return;
      const stable = stabilizePosition(positionRef.current, next);
      if (!stable) return;
      positionRef.current = stable;
      setPosition(stable);
      setStatus(`Precisão aproximada: ${Math.round(next.accuracy)} m`);
      callback.current(stable);
    });
    async function start() {
      if (!native) { setPermissionGranted(false); setStatus('GPS nativo indisponível'); return; }
      setStatus('Verificando localização...');
      const prompted = await loadPermissionPrompted('location-foreground');
      const alreadyGranted = await native.isPermissionGranted();
      const granted = alreadyGranted || (!prompted && await markPermissionPrompted('location-foreground').then(() => native.requestPermission()));
      if (!mounted) return;
      if (!granted) { setPermissionGranted(false); setStatus('Permita a localização nas configurações do Android'); return; }
      setPermissionGranted(true);
      await setActiveTrackingRoom(shareLocation ? roomId : null);
      await native.start();
      if (mounted) setStatus('Localização ativa');
    }
    start().catch((error) => mounted && setStatus(error?.message || 'Não foi possível iniciar o GPS'));
    return () => {
      mounted = false;
      subscription.remove();
      setActiveTrackingRoom(null);
      native?.stop?.().catch?.(() => undefined);
    };
  }, [enabled, roomId, shareLocation]);

  return { position, status, permissionGranted, openSettings: () => Linking.openSettings().catch(() => undefined) };
}
