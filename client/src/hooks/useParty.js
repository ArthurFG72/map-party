import { useCallback, useEffect, useRef, useState } from 'react';
import { socket } from '../lib/socket.js';
import { CONTRACT_VERSION, createCommandId } from '../lib/contracts.js';
import { getOrCreateParticipantToken } from '../lib/identity.js';

export function useParty(roomId, name, visible = true) {
  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [route, setRoute] = useState(null);
  const [error, setError] = useState('');
  const locationSequence = useRef(Date.now());
  const routeRevision = useRef(0);
  const visibleRef = useRef(visible);
  const participantToken = useRef(getOrCreateParticipantToken());
  useEffect(() => { visibleRef.current = visible; }, [visible]);
  useEffect(() => {
    if (!roomId || !name) return undefined;
    let active = true;
    function applySnapshot(snapshot) {
      setParticipants(snapshot.participants);
      setRoute(snapshot.route);
      routeRevision.current = snapshot.route?.revision || 0;
    }
    function attemptJoin(retriesLeft) {
      socket.timeout(5000).emit('join-party', {
        contractVersion: CONTRACT_VERSION,
        roomId,
        clientCode: 'AGUIA',
        name: name.startsWith('A-') ? name : `A-${name}`,
        visible: visibleRef.current,
        participantToken: participantToken.current
      }, (timeoutError, reply) => {
        if (!active) return;
        if (timeoutError && retriesLeft > 0 && socket.connected) return attemptJoin(retriesLeft - 1);
        if (timeoutError) return setError('O servidor não confirmou a entrada. Tentando reconectar pode resolver.');
        if (!reply?.ok) return setError(reply?.error || 'Não foi possível entrar.');
        applySnapshot(reply.snapshot); setJoined(true);
      });
    }
    function onConnect() {
      setConnected(true); setJoined(false); setError(''); attemptJoin(1);
    }
    function onDisconnect() { setConnected(false); setJoined(false); }
    function onConnectError() { setError('Servidor indisponível. Tentando reconectar…'); }
    function onLocation({ participantId, location }) {
      setParticipants((current) => current.map((item) => item.id === participantId ? { ...item, location } : item));
    }
    function onRoute(nextRoute) {
      routeRevision.current = nextRoute?.revision || 0;
      setRoute(nextRoute);
    }
    socket.on('connect', onConnect); socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('participants-snapshot', applySnapshot); socket.on('participant-location', onLocation);
    socket.on('route-updated', onRoute); socket.connect();
    if (socket.connected) onConnect();
    return () => {
      active = false;
      socket.off('connect', onConnect); socket.off('disconnect', onDisconnect); socket.off('connect_error', onConnectError);
      socket.off('participants-snapshot', applySnapshot); socket.off('participant-location', onLocation);
      socket.off('route-updated', onRoute); socket.disconnect();
    };
  }, [roomId, name]);
  const sendLocation = useCallback((location) => {
    if (!socket.connected || visibleRef.current === false) return;
    locationSequence.current = Math.max(locationSequence.current + 1, Date.now());
    socket.timeout(5000).emit('send-location', {
      ...location,
      contractVersion: CONTRACT_VERSION,
      locationSequence: locationSequence.current
    }, (timeoutError, reply) => {
      if (timeoutError) return setError('A localização não foi confirmada pelo servidor.');
      if (!reply?.ok) return setError(reply?.error || 'Localização rejeitada.');
      setError('');
    });
  }, []);
  const publishRoute = useCallback((nextRoute) => new Promise((resolve, reject) => {
    if (!socket.connected) return reject(new Error('Sem conexão com a party.'));
    socket.timeout(5000).emit('update-route', {
      ...nextRoute,
      contractVersion: CONTRACT_VERSION,
      commandId: createCommandId(),
      routeRevision: routeRevision.current
    }, (timeoutError, reply) => {
      if (timeoutError) return reject(new Error('O servidor não confirmou a rota a tempo.'));
      if (reply?.ok) {
        routeRevision.current = reply.route?.revision || routeRevision.current;
        return resolve(reply.route);
      }
      return reject(new Error(reply?.error || 'Rota rejeitada.'));
    });
  }), []);
  const setVisibility = useCallback((nextVisible) => {
    const next = Boolean(nextVisible);
    visibleRef.current = next;
    if (!socket.connected) {
      setError('Sem conexão com a party. A alteração será aplicada ao reconectar.');
      return;
    }
    socket.timeout(5000).emit('set-visibility', { visible: next }, (timeoutError, reply) => {
      if (timeoutError || !reply?.ok) setError(reply?.error || 'Nao foi possivel alterar a visibilidade.');
    });
  }, []);
  return { connected, joined, participants, route, error, sendLocation, publishRoute, setVisibility };
}
