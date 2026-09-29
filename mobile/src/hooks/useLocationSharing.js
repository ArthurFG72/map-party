import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import { LOCATION_TASK_NAME } from '../locationTask';
import { loadPermissionPrompted, markPermissionPrompted, setActiveTrackingRoom } from '../offlineStore';
import { stabilizePosition } from '../locationStabilization';

// Evita que uma leitura grosseira reposicione o marcador. O iOS costuma
// entregar uma primeira leitura com raio grande antes de fixar o GPS.
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
    let subscription;
    async function start() {
      setPermissionGranted(null);
      setStatus('Solicitando localização…');
      const existingPermission = await Location.getForegroundPermissionsAsync();
      const permission = existingPermission.status === 'granted'
        ? existingPermission
        : (await loadPermissionPrompted('location-foreground'))
          ? existingPermission
          : await markPermissionPrompted('location-foreground').then(() => Location.requestForegroundPermissionsAsync());
      if (!mounted) return;
      if (permission.status !== 'granted') {
        setPermissionGranted(false);
        setStatus('Permissão de localização negada');
        return;
      }
      setPermissionGranted(true);
      await setActiveTrackingRoom(shareLocation ? roomId : null);
      // Hidden participants still need foreground GPS for local navigation, but
      // must not request or start background tracking for sharing.
      // Expo Go supports foreground GPS only; native builds keep background tracking.
      const supportsBackgroundLocation = Constants.appOwnership !== 'expo';
      if (shareLocation && supportsBackgroundLocation) {
        // Do not block foreground GPS on the iOS "Always" permission dialog.
        // The live party marker must start publishing as soon as the user has
        // granted foreground location; background tracking is best-effort.
        void (async () => {
          try {
          const currentBackgroundPermission = await Location.getBackgroundPermissionsAsync();
          const backgroundPermission = currentBackgroundPermission.status === 'granted'
            ? currentBackgroundPermission
            : (await loadPermissionPrompted('location-background'))
              ? currentBackgroundPermission
              : await markPermissionPrompted('location-background').then(() => Location.requestBackgroundPermissionsAsync());
          if (backgroundPermission.status === 'granted') {
            const backgroundOptions = {
              accuracy: Platform.OS === 'ios' ? Location.Accuracy.BestForNavigation : Location.Accuracy.High,
              timeInterval: Platform.OS === 'ios' ? 1_000 : 5_000,
              distanceInterval: Platform.OS === 'ios' ? 1 : 5,
              deferredUpdatesInterval: 5_000,
              pausesUpdatesAutomatically: false,
              showsBackgroundLocationIndicator: true
            };
            if (Platform.OS === 'android') {
              backgroundOptions.foregroundService = {
                notificationTitle: 'Map Party ativo',
                notificationBody: 'Sua rota e localização continuam sendo acompanhadas.'
              };
            }
            if (mounted) await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, backgroundOptions);
          }
          } catch {
            // Foreground GPS remains available when background permission is declined.
          }
        })();
      }
      setStatus('Localização ativa');
      subscription = await Location.watchPositionAsync({
        accuracy: Platform.OS === 'ios' ? Location.Accuracy.BestForNavigation : Location.Accuracy.High,
        timeInterval: Platform.OS === 'ios' ? 1_000 : 5_000,
        distanceInterval: Platform.OS === 'ios' ? 1 : 5
      }, ({ coords, timestamp }) => {
        const next = {
          lat: coords.latitude,
          lng: coords.longitude,
          accuracy: coords.accuracy || 0,
          timestamp,
          ...(Number.isFinite(coords.speed) && coords.speed >= 0 ? { speed: coords.speed } : {}),
          ...(Number.isFinite(coords.heading) && coords.heading >= 0 ? { heading: coords.heading } : {})
        };
        if (Date.now() - next.timestamp > MAX_LOCATION_AGE_MS || next.timestamp - Date.now() > 30_000) return;
        if (next.accuracy > MAX_ACCEPTABLE_ACCURACY && positionRef.current) return;
        const stable = stabilizePosition(positionRef.current, next);
        if (!stable) return;
        positionRef.current = stable;
        setPosition(stable);
        setStatus(`Precisão aproximada: ${Math.round(next.accuracy)} m`);
        callback.current(stable);
      });
    }
    start().catch(() => mounted && setStatus('Não foi possível iniciar o GPS'));
    return () => {
      mounted = false;
      subscription?.remove();
      setActiveTrackingRoom(null);
      Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)
        .then((started) => started && Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME))
        .catch(() => undefined);
    };
  }, [enabled, roomId, shareLocation]);

  return { position, status, permissionGranted };
}
