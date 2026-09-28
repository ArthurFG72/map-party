import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import NetInfo from '@react-native-community/netinfo';
import { SERVER_URL } from '../config';
import { CONTRACT_VERSION, createCommandId } from '../contracts';
import { createLocationUpdate } from '../locationUpdate';
import { getOrCreateDeviceId, getOrCreateParticipantToken, loadPartySnapshot, savePartySnapshot, savePendingLocation, takePendingLocation } from '../offlineStore';
import { routeFromNavigationRerouted } from '../partyNavigation';
import { createLocalTransport } from '../localTransport';
import { relayEmergencyPacket } from '../api';
import { classifyConnectivity, connectivityCapabilities, CONNECTIVITY_LEVEL } from '../connectivity';

const MAX_ESTIMATE_MS = 15 * 1000;
const MIN_PROJECT_SPEED = 1.0;
const EARTH_RADIUS_METERS = 6_371_000;
const LOCATION_HEARTBEAT_MS = 10_000;
const LOCATION_MIN_MOVEMENT_METERS = 4;

function locationDistanceMeters(first, second) {
  if (!first || !second) return Number.POSITIVE_INFINITY;
  const lat = (second.lat - first.lat) * Math.PI / 180;
  const lng = (second.lng - first.lng) * Math.PI / 180;
  const a = Math.sin(lat / 2) ** 2
    + Math.cos(first.lat * Math.PI / 180) * Math.cos(second.lat * Math.PI / 180) * Math.sin(lng / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function compactLocation(location) {
  const compact = {
    lat: Math.round(location.lat * 1e6) / 1e6,
    lng: Math.round(location.lng * 1e6) / 1e6,
    accuracy: Math.round(Number(location.accuracy) || 0),
    timestamp: Math.round(Number(location.timestamp) || Date.now())
  };
  if (Number.isFinite(location.speed)) compact.speed = Math.round(location.speed * 10) / 10;
  if (Number.isFinite(location.heading) && location.heading >= 0) compact.heading = Math.round(location.heading);
  return compact;
}
function projectLocation(location, now) {
  if (!location) return location;
  const ageMs = Math.max(0, now - Number(location.timestamp || now));
  if (ageMs < 10_000) return { ...location, estimated: false, ageMs };
  const speed = Number(location.speed);
  const heading = Number(location.heading);
  const canProject = Number.isFinite(speed) && speed >= MIN_PROJECT_SPEED && Number.isFinite(heading) && ageMs <= MAX_ESTIMATE_MS;
  if (!canProject) return { ...location, estimated: true, stale: ageMs > 120_000, ageMs };

  const seconds = Math.min(ageMs, MAX_ESTIMATE_MS) / 1000;
  const distance = speed * seconds;
  const headingRadians = (heading * Math.PI) / 180;
  const latitudeRadians = (location.lat * Math.PI) / 180;
  const lat = location.lat + (distance * Math.cos(headingRadians) / EARTH_RADIUS_METERS) * (180 / Math.PI);
  const lng = location.lng + (distance * Math.sin(headingRadians) / (EARTH_RADIUS_METERS * Math.cos(latitudeRadians))) * (180 / Math.PI);
  return { ...location, lat, lng, estimated: true, stale: ageMs > 120_000, ageMs };
}

export function useParty(roomId, name, visible = true) {
  const socket = useMemo(() => io(SERVER_URL, {
    autoConnect: false,
    transports: ['websocket', 'polling'],
    reconnection: true
  }), []);
  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [connectivity, setConnectivity] = useState({ level: CONNECTIVITY_LEVEL.NORMAL, capabilities: connectivityCapabilities(CONNECTIVITY_LEVEL.NORMAL), latencyMs: null });
  const [participants, setParticipants] = useState([]);
  const [route, setRoute] = useState(null);
  const [personalRoute, setPersonalRoute] = useState(null);
  const [sharedRoute, setSharedRoute] = useState(null);
  const [sharedRouteOwnerId, setSharedRouteOwnerId] = useState(null);
  const [incomingRouteShareInvitation, setIncomingRouteShareInvitation] = useState(null);
  const sharedRouteOwnerIdRef = useRef(null);
  const [routeSharingConsent, setRouteSharingConsentState] = useState(false);
  const [participantId, setParticipantId] = useState(null);
  const [locationSharingEnabled, setLocationSharingEnabled] = useState(visible !== false);
  const [error, setError] = useState('');
  const [clock, setClock] = useState(Date.now());
  const joinedRef = useRef(false);
  const participantIdRef = useRef(null);
  const participantTokenRef = useRef(null);
  const deviceIdRef = useRef(null);
  const locationSharingEnabledRef = useRef(true);
  const locationSequenceRef = useRef(Date.now());
  const routeRevisionRef = useRef(0);
  const cachedRouteRef = useRef(null);
  const visibleRef = useRef(visible);
  const localTransportRef = useRef(null);
  const pendingSosRef = useRef(new Map());
  const lastSentLocationRef = useRef(null);
  const [sosDelivery, setSosDelivery] = useState(null);
  const [incomingSos, setIncomingSos] = useState(null);
  const [incomingDirectMessage, setIncomingDirectMessage] = useState(null);
  const [incomingNavigationCommand, setIncomingNavigationCommand] = useState(null);
  useEffect(() => { visibleRef.current = visible; }, [visible]);

  useEffect(() => {
    let active = true;
    let latestNetwork = {};
    let latencyMs = null;
    const apply = () => {
      if (!active) return;
      const level = classifyConnectivity(latestNetwork, latencyMs);
      setConnectivity({ level, capabilities: connectivityCapabilities(level), latencyMs });
    };
    const unsubscribe = NetInfo.addEventListener((state) => {
      latestNetwork = state;
      apply();
    });
    const probe = async () => {
      const started = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4_000);
      try {
        const response = await fetch(`${SERVER_URL}/health-lite`, { signal: controller.signal, cache: 'no-store' });
        latencyMs = response.ok ? Date.now() - started : 2_000;
      } catch {
        latencyMs = 2_000;
      } finally {
        clearTimeout(timeout);
        apply();
      }
    };
    probe();
    const timer = setInterval(probe, 30_000);
    return () => {
      active = false;
      unsubscribe();
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    loadPartySnapshot(roomId).then((snapshot) => {
      if (!active || !snapshot) return;
      setParticipants(snapshot.participants || []);
      cachedRouteRef.current = snapshot.route || null;
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
      // The server snapshot is authoritative. An explicit route:null means
      // the old local route must be cleared, not restored from SQLite cache.
      const hasRoute = Object.prototype.hasOwnProperty.call(snapshot, 'route');
      const nextRoute = hasRoute ? snapshot.route : cachedRouteRef.current;
      cachedRouteRef.current = nextRoute;
      setParticipants(nextParticipants);
      setRouteSharingConsentState(Boolean(nextParticipants.find((item) => item.id === participantIdRef.current)?.routeSharingConsent));
      setRoute(nextRoute);
      routeRevisionRef.current = nextRoute?.revision || 0;
      persistSnapshot(nextParticipants, nextRoute);
    }
    function flushPending() {
      if (!locationSharingEnabledRef.current) return;
      takePendingLocation(roomId).then((pending) => {
        if (!pending) return;
        if (!socket.connected || !joinedRef.current || !locationSharingEnabledRef.current) {
          savePendingLocation(roomId, pending);
          return;
        }
        socket.timeout(5_000).emit('send-location', pending, (timeoutError, reply) => {
          if (timeoutError || !reply?.ok) savePendingLocation(roomId, pending);
        });
      });
    }
    const localTransport = createLocalTransport({ roomId, participantId: name, onVerification: (event) => {
      if (event?.endpointId) localTransportRef.current?.verifyConnection(event.endpointId, true).catch(() => undefined);
    }, onMessage: (message) => {
      if (message?.type === 'sos-ack' && message.ackFor && pendingSosRef.current.has(message.ackFor)) {
        const current = pendingSosRef.current.get(message.ackFor);
        const next = new Set(current);
        next.add(message.participantId || message.endpointId || 'participant');
        pendingSosRef.current.set(message.ackFor, next);
        setSosDelivery({ messageId: message.ackFor, participants: [...next] });
        return;
      }
      if (message?.type === 'location' && message.participantId && message.location) return onLocation(message);
      if (message?.type === 'emergency' && message.packet && socket.connected) {
        relayEmergencyPacket(message.packet).catch(() => undefined);
      }
      if (message?.type === 'emergency' && message.messageId) {
        localTransport.send({ type: 'sos-ack', ackFor: message.messageId, participantId: name }).catch(() => undefined);
      }
    } });
    localTransportRef.current = localTransport;
    localTransport.start().catch(() => undefined);
    function join() {
      socket.timeout(5_000).emit('join-party', {
        contractVersion: CONTRACT_VERSION,
        roomId,
        clientCode: 'AGUIA',
        name,
        visible: visibleRef.current,
        participantToken: participantTokenRef.current,
        deviceId: deviceIdRef.current
      }, (timeoutError, reply) => {
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
        setParticipantId(reply.participantId);
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
      cachedRouteRef.current = nextRoute;
      setRoute(nextRoute);
      setPersonalRoute(null);
      savePartySnapshot(roomId, { participants, route: nextRoute });
    }
    function onSosSignal(payload) {
      if (payload?.messageId) setIncomingSos(payload);
    }
    function onDirectMessage(payload) {
      if (payload?.messageId && payload?.text) setIncomingDirectMessage(payload);
    }
    function onNavigationCommand(command) {
      if (command?.command && command?.request_id) setIncomingNavigationCommand(command);
    }

    function onNavigationRerouted(payload) {
      const nextRoute = routeFromNavigationRerouted(payload, participantIdRef.current);
      if (nextRoute) setPersonalRoute(nextRoute);
    }
    function onRouteShared(payload) {
      if (!payload?.participantId) return;
      if (!payload.route) {
        setSharedRoute((current) => current && sharedRouteOwnerIdRef.current === payload.participantId ? null : current);
        if (sharedRouteOwnerIdRef.current === payload.participantId) setSharedRouteOwnerId(null);
        return;
      }
      sharedRouteOwnerIdRef.current = payload.participantId;
      setSharedRoute(payload.route);
      setSharedRouteOwnerId(payload.participantId);
    }
    function onRouteShareInvitation(payload) {
      if (payload?.invitationId && payload?.participantId) setIncomingRouteShareInvitation(payload);
    }
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('participants-snapshot', applySnapshot);
    socket.on('participant-location', onLocation);
    socket.on('route-updated', onRoute);
    socket.on('navigation-rerouted', onNavigationRerouted);
    socket.on('route-shared', onRouteShared);
    socket.on('route-share-invitation', onRouteShareInvitation);
    socket.on('sos-signal', onSosSignal);
    socket.on('direct-message', onDirectMessage);
    socket.on('navigation-command', onNavigationCommand);
    socket.io.on('reconnect_attempt', onReconnectAttempt);
    setConnectionStatus('connecting');
    Promise.all([getOrCreateParticipantToken(), getOrCreateDeviceId()]).then(([participantToken, deviceId]) => {
      if (!active) return;
      participantTokenRef.current = participantToken;
      deviceIdRef.current = deviceId;
      socket.connect();
    }).catch(() => {
      if (!active) return;
      setConnectionStatus('unavailable');
      setError('Não foi possível preparar a identidade local.');
    });
    return () => {
      active = false;
      joinedRef.current = false;
      socket.io.off('reconnect_attempt', onReconnectAttempt);
      socket.removeAllListeners();
      socket.disconnect();
      localTransport.stop().catch(() => undefined);
      localTransportRef.current = null;
    };
  }, [name, roomId, socket]);

  const sendLocation = useCallback((location) => {
    if (!locationSharingEnabledRef.current) return;
    if (!visibleRef.current) return;
    const compact = compactLocation(location);
    const previous = lastSentLocationRef.current;
    const elapsed = previous ? compact.timestamp - previous.timestamp : Number.POSITIVE_INFINITY;
    const moved = previous ? locationDistanceMeters(previous, compact) : Number.POSITIVE_INFINITY;
    const locationInterval = connectivity.capabilities.locationIntervalMs;
    if (previous && elapsed < locationInterval && moved < LOCATION_MIN_MOVEMENT_METERS) return;
    lastSentLocationRef.current = compact;
    locationSequenceRef.current = Math.max(locationSequenceRef.current + 1, Date.now());
    const update = createLocationUpdate(compact, locationSequenceRef.current);
    localTransportRef.current?.send({ type: 'location', participantId: participantIdRef.current, location: compact });
    if (!socket.connected || !joinedRef.current) {
      savePendingLocation(roomId, update);
      if (participantIdRef.current) setParticipants((current) => current.map((item) => item.id === participantIdRef.current ? { ...item, location: compact } : item));
      return;
    }
    socket.timeout(5_000).emit('send-location', update, (timeoutError, reply) => {
      if (timeoutError || !reply?.ok) {
        savePendingLocation(roomId, update);
        setError(reply?.error || 'Localização guardada; será sincronizada quando a conexão voltar.');
      }
    });
  }, [connectivity.capabilities.locationIntervalMs, roomId, socket]);

  const publishRoute = useCallback((nextRoute, scope = 'personal') => new Promise((resolve, reject) => {
    if (!socket.connected || !joinedRef.current) return reject(new Error('Sem conexão. A rota anterior permanece disponível e será recalculada quando a internet voltar.'));
    socket.timeout(5_000).emit('update-route', {
      ...nextRoute,
      contractVersion: CONTRACT_VERSION,
      scope,
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

  const setLocationSharing = useCallback((enabled) => {
    const nextEnabled = Boolean(enabled);
    locationSharingEnabledRef.current = nextEnabled;
    setLocationSharingEnabled(nextEnabled);
  }, []);

  const setVisibility = useCallback((nextVisible) => {
    visibleRef.current = Boolean(nextVisible);
    setLocationSharingEnabled(Boolean(nextVisible));
    setParticipants((current) => current.map((item) => (
      (item.id === participantIdRef.current || item.name === name) ? { ...item, sharingPaused: !visibleRef.current } : item
    )));
    socket.timeout(5_000).emit('set-visibility', { visible: visibleRef.current }, (timeoutError, reply) => {
      if (timeoutError || !reply?.ok) setError(reply?.error || 'Nao foi possivel alterar a visibilidade.');
    });
  }, [socket]);

  const setRouteSharingConsent = useCallback((enabled) => new Promise((resolve, reject) => {
    const nextEnabled = Boolean(enabled);
    if (!socket.connected || !joinedRef.current) return reject(new Error('Sem conexao com a party.'));
    socket.timeout(5_000).emit('set-route-sharing-consent', { enabled: nextEnabled }, (timeoutError, reply) => {
      if (timeoutError) return reject(new Error('O servidor nao confirmou o consentimento de rota.'));
      if (!reply?.ok) return reject(new Error(reply?.error || 'Nao foi possivel alterar o consentimento de rota.'));
      setRouteSharingConsentState(reply.enabled === true);
      resolve(reply);
    });
  }), [socket]);

  const setRoutePermission = useCallback((targetParticipantId, enabled) => new Promise((resolve, reject) => {
    if (!targetParticipantId || !socket.connected || !joinedRef.current) return reject(new Error('Sem conexao com a party.'));
    socket.timeout(5_000).emit('set-route-permission', { targetParticipantId, enabled: Boolean(enabled) }, (timeoutError, reply) => {
      if (timeoutError) return reject(new Error('O servidor nao confirmou a autorizacao de rota.'));
      if (!reply?.ok) return reject(new Error(reply?.error || 'Nao foi possivel alterar a autorizacao de rota.'));
      resolve(reply);
    });
  }), [socket]);

  const requestRouteShare = useCallback((targetParticipantIds) => new Promise((resolve, reject) => {
    const ids = [...new Set((targetParticipantIds || []).filter(Boolean))];
    if (!ids.length || !socket.connected || !joinedRef.current) return reject(new Error('Selecione pelo menos um participante conectado.'));
    socket.timeout(5_000).emit('request-route-share', { targetParticipantIds: ids }, (timeoutError, reply) => {
      if (timeoutError) return reject(new Error('O servidor não confirmou o convite de rota.'));
      if (!reply?.ok) return reject(new Error(reply?.error || 'Não foi possível compartilhar a rota.'));
      resolve(reply);
    });
  }), [socket]);

  const respondRouteShareInvitation = useCallback((invitationId, accepted) => new Promise((resolve, reject) => {
    if (!invitationId || !socket.connected || !joinedRef.current) return reject(new Error('Convite indisponível.'));
    socket.timeout(5_000).emit('respond-route-share', { invitationId, accepted: Boolean(accepted) }, (timeoutError, reply) => {
      setIncomingRouteShareInvitation(null);
      if (timeoutError) return reject(new Error('O servidor não confirmou sua resposta.'));
      if (!reply?.ok) return reject(new Error(reply?.error || 'Não foi possível responder ao convite.'));
      resolve(reply);
    });
  }), [socket]);

  const clearPersonalRoute = useCallback(() => setPersonalRoute(null), []);

  const sendEmergencyPacket = useCallback(async (packet) => {
    const messageId = `sos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    pendingSosRef.current.set(messageId, new Set());
    setSosDelivery({ messageId, participants: [] });
    await localTransportRef.current?.send({ type: 'emergency', messageId, participantId: participantIdRef.current, packet });
    if (!socket.connected || !joinedRef.current) return { relayed: false, signalSent: false, messageId };

    const signal = await new Promise((resolve, reject) => {
      socket.timeout(5_000).emit('send-sos-signal', { messageId }, (timeoutError, reply) => {
        if (timeoutError) return reject(new Error('O servidor nao confirmou o SOS.'));
        if (!reply?.ok) return reject(new Error(reply?.error || 'O servidor rejeitou o SOS.'));
        resolve(reply);
      });
    });
    const relay = await relayEmergencyPacket(packet).catch(() => ({ relayed: false }));
    return { ...relay, signalSent: signal.ok === true, relayed: relay.relayed !== false, messageId };
  }, [socket]);

  const sendDirectMessage = useCallback((targetParticipantId, text) => new Promise((resolve, reject) => {
    const message = String(text || '').trim().slice(0, 500);
    if (!targetParticipantId || !message) return reject(new Error('Informe uma mensagem.'));
    if (!socket.connected || !joinedRef.current) return reject(new Error('Sem conexao com a party.'));
    socket.timeout(5_000).emit('send-direct-message', { targetParticipantId, text: message }, (timeoutError, reply) => {
      if (timeoutError) return reject(new Error('O servidor nao confirmou a mensagem.'));
      if (!reply?.ok) return reject(new Error(reply?.error || 'Nao foi possivel enviar a mensagem.'));
      resolve(reply);
    });
  }), [socket]);

  const reportNavigationCommandResult = useCallback((result) => {
    if (!result?.request_id || !socket.connected || !joinedRef.current) return;
    socket.emit('navigation-command-result', {
      request_id: result.request_id,
      success: result.success === true,
      ...(result.command ? { command: result.command } : {}),
      ...(result.code ? { code: result.code } : {}),
      ...(result.result && typeof result.result === 'object' ? { result: result.result } : {})
    });
  }, [socket]);

  const displayParticipants = useMemo(() => participants.map((item) => ({
    ...item,
    location: item.sharingPaused ? (item.location ? { ...item.location, estimated: false } : null) : projectLocation(item.location, clock)
  })), [participants, clock]);
  const offline = !connected && (participants.length > 0 || !!route);

  return {
    connected,
    joined,
    connectionStatus,
    connectivity,
    offline,
    participantId,
    participants: displayParticipants,
    route,
    personalRoute,
    sharedRoute,
    sharedRouteOwnerId,
    incomingRouteShareInvitation,
    routeSharingConsent,
    locationSharingEnabled,
    error,
    sendLocation,
    setLocationSharing,
    setVisibility,
    setRouteSharingConsent,
    setRoutePermission,
    requestRouteShare,
    respondRouteShareInvitation,
    sendEmergencyPacket,
    sosDelivery,
    incomingSos,
    incomingDirectMessage,
    incomingNavigationCommand,
    clearPersonalRoute,
    publishRoute,
    sendDirectMessage,
    reportNavigationCommandResult
  };
}
