import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import { LOCATION_TASK_NAME } from '../locationTask';
import { loadPermissionPrompted, markPermissionPrompted, setActiveTrackingRoom } from '../offlineStore';

// Evita que uma leitura grosseira reposicione o marcador. O iOS costuma
// entregar uma primeira leitura com raio grande antes de fixar o GPS.
const MAX_ACCEPTABLE_ACCURACY = 60;
const MAX_LOCATION_AGE_MS = 120_000;
const STATIONARY_SPEED = 0.8;
const MIN_STATIONARY_MOVEMENT = 8;
const MAX_REALISTIC_SPEED = 90;

function distanceMeters(first, second) {
  const lat = (second.lat - first.lat) * Math.PI / 180;
  const lng = (second.lng - first.lng) * Math.PI / 180;
  const a = Math.sin(lat / 2) ** 2
    + Math.cos(first.lat * Math.PI / 180) * Math.cos(second.lat * Math.PI / 180) * Math.sin(lng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function stabilizePosition(previous, next) {
  if (!previous) return next;
  const elapsedSeconds = Math.max(0.1, (next.timestamp - previous.timestamp) / 1000);
  const distance = distanceMeters(previous, next);
  const reportedSpeed = Number.isFinite(next.speed) ? next.speed : 0;
  const accuracyLimit = Math.max(MIN_STATIONARY_MOVEMENT, Math.min(previous.accuracy || 0, next.accuracy || 0));
  if (reportedSpeed < STATIONARY_SPEED && distance <= accuracyLimit) {
    return { ...previous, timestamp: next.timestamp, accuracy: Math.min(previous.accuracy || next.accuracy, next.accuracy), speed: 0 };
  }
  const maximumDistance = MAX_REALISTIC_SPEED * elapsedSeconds + (previous.accuracy || 0) + (next.accuracy || 0);
  if (distance > maximumDistance) return null;
  return next;
}

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
            await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, backgroundOptions);
          }
        } catch {
          // Foreground GPS remains available when background permission is declined.
        }
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
