import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';

export function useLocationSharing({ enabled, onLocation }) {
  const [position, setPosition] = useState(null);
  const [status, setStatus] = useState('Localização pausada');
  const callback = useRef(onLocation);
  callback.current = onLocation;

  useEffect(() => {
    if (!enabled) return undefined;
    let mounted = true;
    let subscription;
    async function start() {
      setStatus('Solicitando localização…');
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!mounted) return;
      if (permission.status !== 'granted') {
        setStatus('Permissão de localização negada');
        return;
      }
      setStatus('Localização ativa');
      subscription = await Location.watchPositionAsync({
        accuracy: Location.Accuracy.High,
        timeInterval: 3_000,
        distanceInterval: 2
      }, ({ coords, timestamp }) => {
        const next = {
          lat: coords.latitude,
          lng: coords.longitude,
          accuracy: coords.accuracy || 0,
          timestamp,
          ...(Number.isFinite(coords.speed) && coords.speed >= 0 ? { speed: coords.speed } : {}),
          ...(Number.isFinite(coords.heading) && coords.heading >= 0 ? { heading: coords.heading } : {})
        };
        setPosition(next);
        setStatus(`Precisão aproximada: ${Math.round(next.accuracy)} m`);
        callback.current(next);
      });
    }
    start().catch(() => mounted && setStatus('Não foi possível iniciar o GPS'));
    return () => {
      mounted = false;
      subscription?.remove();
    };
  }, [enabled]);

  return { position, status };
}
