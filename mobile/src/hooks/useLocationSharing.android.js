import { useEffect, useRef, useState } from 'react';
import { DeviceEventEmitter, Linking, NativeModules } from 'react-native';
import { setActiveTrackingRoom } from '../offlineStore';
import { stabilizePosition } from '../locationStabilization';

const MAX_ACCEPTABLE_ACCURACY = 80;
const MAX_LOCATION_AGE_MS = 120_000;

export function useLocationSharing({ enabled, roomId, shareLocation = true, mode = 'tracking', onLocation }) {
  const [position, setPosition] = useState(null);
  const [status, setStatus] = useState('Localização pausada');
  const [permissionGranted, setPermissionGranted] = useState(null);
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
    const native = NativeModules.MapPartyLocation;
    const maxLocationAge = mode === 'navigation' || mode === 'boat' ? 15_000 : MAX_LOCATION_AGE_MS;
    const subscription = DeviceEventEmitter.addListener('MapPartyLocation', (value) => {
      const next = { lat: value.latitude, lng: value.longitude, accuracy: value.accuracy || 0, timestamp: value.timestamp || Date.now(), ...(Number.isFinite(value.speed) ? { speed: value.speed } : {}), ...(Number.isFinite(value.heading) ? { heading: value.heading } : {}) };
      if (Date.now() - next.timestamp > maxLocationAge || next.timestamp - Date.now() > 30_000) return;
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
      const alreadyGranted = await native.isPermissionGranted();
      // A decisão persistida de “já perguntado” pode ficar desatualizada
      // depois de Ajustes, atualização ou restauração do aparelho. A fonte
      // de verdade é sempre o estado nativo atual; se não está concedido,
      // deixe o Android decidir se deve mostrar o diálogo ou abrir Ajustes.
      const granted = alreadyGranted || await native.requestPermission();
      if (!mounted) return;
      if (!granted) { setPermissionGranted(false); setStatus('Permita a localização nas configurações do Android'); return; }
      setPermissionGranted(true);
      await native.setMode?.(mode);
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
  }, [enabled, mode, roomId, shareLocation]);

  return { position, status, permissionGranted, openSettings: () => Linking.openSettings().catch(() => undefined) };
}
