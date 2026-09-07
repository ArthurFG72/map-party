import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { SERVER_URL } from '../config';
import { CONTRACT_VERSION, createCommandId } from '../contracts';
import { loadPartySnapshot, savePartySnapshot, savePendingLocation, takePendingLocation } from '../offlineStore';

const MAX_ESTIMATE_MS = 5 * 60 * 1000;
const EARTH_RADIUS_METERS = 6_371_000;

function projectLocation(location, now) {
  if (!location) return location;
  const ageMs = Math.max(0, now - Number(location.timestamp || now));
  if (ageMs < 10_000) return { ...location, estimated: false, ageMs };
  const speed = Number(location.speed);
  const heading = Number(location.heading);
  const canProject = Number.isFinite(speed) && speed > 0.3 && Number.isFinite(heading) && ageMs <= MAX_ESTIMATE_MS;
  if (!canProject) return { ...location, estimated: true, stale: ageMs > 120_000, ageMs };

  const seconds = Math.min(ageMs, MAX_ESTIMATE_MS) / 1000;
  const distance = speed * seconds;
  const headingRadians = (heading * Math.PI) / 180;
  const latitudeRadians = (location.lat * Math.PI) / 180;
  const lat = location.lat + (distance * Math.cos(headingRadians) / EARTH_RADIUS_METERS) * (180 / Math.PI);
  const lng = location.lng + (distance * Math.sin(headingRadians) / (EARTH_RADIUS_METERS * Math.cos(latitudeRadians))) * (180 / Math.PI);
  return { ...location, lat, lng, estimated: true, stale: ageMs > 120_000, ageMs };
}

export function useParty(roomId, name) {
  const socket = useMemo(() => io(SERVER_URL, {
    autoConnect: false,
    transports: ['websocket', 'polling'],
    reconnection: true
  }), []);
  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [participants, setParticipants] = useState([]);
  const [route, setRoute] = useState(null);
  const [error, setError] = useState('');
  const [clock, setClock] = useState(Date.now());
  const joinedRef = useRef(false);
  const participantIdRef = useRef(null);
  const locationSequenceRef = useRef(Date.now());
  const routeRevisionRef = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    loadPartySnapshot(roomId).then((snapshot) => {
      if (!active || !snapshot) return;
      setParticipants(snapshot.participants || []);
      setRoute(snapshot.route || null);
    });
    return () => { active = false; };
  }, [roomId]);

  useEffect(() => {
    let active = true;
    function persistSnapshot(nextParticipants, nextRoute) {
      savePartySnapshot(roomId, { participants: nextParticipants, route: nextRoute });
    }
    function applySnapshot(snapshot) {
      if (!snapshot) return;
      const nextParticipants = snapshot.participants || [];
      const nextRoute = snapshot.route || null;
      setParticipants(nextParticipants);
      setRoute(nextRoute);
      routeRevisionRef.current = nextRoute?.revision || 0;
      persistSnapshot(nextParticipants, nextRoute);
    }
    function flushPending() {
      takePendingLocation(roomId).then((pending) => {
        if (!pending || !socket.connected || !joinedRef.current) return;
        socket.timeout(5_000).emit('send-location', pending, (timeoutError, reply) => {
          if (timeoutError || !reply?.ok) savePendingLocation(roomId, pending);
        });
      });
    }
    function join() {
      socket.timeout(5_000).emit('join-party', { contractVersion: CONTRACT_VERSION, roomId, name }, (timeoutError, reply) => {
        if (!active) return;
        if (timeoutError) {
          setConnectionStatus('unavailable');
          return setError('O servidor não confirmou a entrada.');
        }
        if (!reply?.ok) {
          setConnectionStatus('join-error');
          return setError(reply?.error || 'Não foi possível entrar na party.');
        }
        participantIdRef.current = reply.participantId;
        joinedRef.current = true;
        applySnapshot(reply.snapshot);
        setJoined(true);
        setConnectionStatus('online');
        setError('');
        flushPending();
      });
    }
    function onConnect() {
      setConnected(true);
      joinedRef.current = false;
      setJoined(false);
      setConnectionStatus('joining');
      setError('');
      join();
    }
    function onDisconnect() {
      joinedRef.current = false;
      setConnected(false);
      setJoined(false);
      setConnectionStatus('reconnecting');
    }
    function onConnectError() {
      setConnectionStatus('unavailable');
      setError(`Servidor indisponível em ${SERVER_URL}. Últimos dados mantidos offline.`);
    }
    function onReconnectAttempt() { setConnectionStatus('reconnecting'); }
    function onLocation({ participantId, location }) {
      setParticipants((current) => {
        const next = current.map((item) => item.id === participantId ? { ...item, location } : item);
        savePartySnapshot(roomId, { participants: next, route });
        return next;
      });
    }
    function onRoute(nextRoute) {
      routeRevisionRef.current = nextRoute?.revision || 0;
      setRoute(nextRoute);
      savePartySnapshot(roomId, { participants, route: nextRoute });
    }
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('participants-snapshot', applySnapshot);
    socket.on('participant-location', onLocation);
    socket.on('route-updated', onRoute);
    socket.io.on('reconnect_attempt', onReconnectAttempt);
    setConnectionStatus('connecting');
    socket.connect();
    return () => {
      active = false;
      joinedRef.current = false;
      socket.io.off('reconnect_attempt', onReconnectAttempt);
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [name, roomId, socket]);

  const sendLocation = useCallback((location) => {
    locationSequenceRef.current = Math.max(locationSequenceRef.current + 1, Date.now());
    const update = {
      ...location,
      contractVersion: CONTRACT_VERSION,
      locationSequence: locationSequenceRef.current
    };
    if (!socket.connected || !joinedRef.current) {
      savePendingLocation(roomId, update);
      if (participantIdRef.current) setParticipants((current) => current.map((item) => item.id === participantIdRef.current ? { ...item, location } : item));
      return;
    }
    socket.timeout(5_000).emit('send-location', update, (timeoutError, reply) => {
      if (timeoutError || !reply?.ok) {
        savePendingLocation(roomId, update);
        setError(reply?.error || 'Localização guardada; será sincronizada quando a conexão voltar.');
      }
    });
  }, [roomId, socket]);

  const publishRoute = useCallback((nextRoute) => new Promise((resolve, reject) => {
    if (!socket.connected || !joinedRef.current) return reject(new Error('Sem conexão. A rota anterior permanece disponível e será recalculada quando a internet voltar.'));
    socket.timeout(5_000).emit('update-route', {
      ...nextRoute,
      contractVersion: CONTRACT_VERSION,
      commandId: createCommandId(),
      routeRevision: routeRevisionRef.current
    }, (timeoutError, reply) => {
      if (timeoutError) return reject(new Error('O servidor não confirmou a rota.'));
      if (reply?.ok) {
        routeRevisionRef.current = reply.route?.revision || routeRevisionRef.current;
        return resolve(reply.route);
      }
      return reject(new Error(reply?.error || 'Rota rejeitada.'));
    });
  }), [socket]);

  const displayParticipants = useMemo(() => participants.map((item) => ({
    ...item,
    location: projectLocation(item.location, clock)
  })), [participants, clock]);
  const offline = !connected && (participants.length > 0 || !!route);

  return { connected, joined, connectionStatus, offline, participants: displayParticipants, route, error, sendLocation, publishRoute };
}
