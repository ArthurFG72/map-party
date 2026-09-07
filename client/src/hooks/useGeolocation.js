import { useEffect, useRef, useState } from 'react';

export function useGeolocation({ enabled, onLocation }) {
  const [status, setStatus] = useState('Localização pausada');
  const lastSent = useRef({ time: 0, lat: null, lng: null });
  const callback = useRef(onLocation);
  callback.current = onLocation;
  useEffect(() => {
    if (!enabled) { setStatus('Localização pausada'); return undefined; }
    if (!navigator.geolocation) { setStatus('Geolocalização indisponível'); return undefined; }
    setStatus('Solicitando localização…');
    const watchId = navigator.geolocation.watchPosition(({ coords, timestamp }) => {
      setStatus(`Precisão aproximada: ${Math.round(coords.accuracy)} m`);
      const now = Date.now();
      const previous = lastSent.current;
      const moved = previous.lat == null || Math.abs(coords.latitude - previous.lat) + Math.abs(coords.longitude - previous.lng) > 0.00002;
      if (now - previous.time >= 3000 && (moved || now - previous.time >= 15000)) {
        lastSent.current = { time: now, lat: coords.latitude, lng: coords.longitude };
        callback.current({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy, timestamp });
      }
    }, (error) => {
      const messages = { 1: 'Permissão de localização negada', 2: 'Localização indisponível', 3: 'Localização demorou demais' };
      setStatus(messages[error.code] || 'Erro ao obter localização');
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
    return () => navigator.geolocation.clearWatch(watchId);
  }, [enabled]);
  return status;
}
