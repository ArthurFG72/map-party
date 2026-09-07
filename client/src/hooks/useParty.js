import { useCallback, useEffect, useState } from 'react';
import { socket } from '../lib/socket.js';

export function useParty(roomId, name) {
  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [route, setRoute] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!roomId || !name) return undefined;
    let active = true;
    function applySnapshot(snapshot) { setParticipants(snapshot.participants); setRoute(snapshot.route); }
    function attemptJoin(retriesLeft) {
      socket.timeout(5000).emit('join-party', { roomId, name }, (timeoutError, reply) => {
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
    function onLocation({ participantId, location }) {
      setParticipants((current) => current.map((item) => item.id === participantId ? { ...item, location } : item));
    }
    socket.on('connect', onConnect); socket.on('disconnect', onDisconnect);
    socket.on('connect_error', () => setError('Servidor indisponível. Tentando reconectar…'));
    socket.on('participants-snapshot', applySnapshot); socket.on('participant-location', onLocation);
    socket.on('route-updated', setRoute); socket.connect();
    if (socket.connected) onConnect();
    return () => {
      active = false;
      socket.off('connect', onConnect); socket.off('disconnect', onDisconnect); socket.off('connect_error');
      socket.off('participants-snapshot', applySnapshot); socket.off('participant-location', onLocation);
      socket.off('route-updated', setRoute); socket.disconnect();
    };
  }, [roomId, name]);
  const sendLocation = useCallback((location) => {
    if (!socket.connected) return;
    socket.timeout(5000).emit('send-location', location, (timeoutError, reply) => {
      if (timeoutError) return setError('A localização não foi confirmada pelo servidor.');
      if (!reply?.ok) return setError(reply?.error || 'Localização rejeitada.');
      setError('');
    });
  }, []);
  const publishRoute = useCallback((nextRoute) => new Promise((resolve, reject) => {
    if (!socket.connected) return reject(new Error('Sem conexão com a party.'));
    socket.timeout(5000).emit('update-route', nextRoute, (timeoutError, reply) => {
      if (timeoutError) return reject(new Error('O servidor não confirmou a rota a tempo.'));
      return reply?.ok ? resolve(reply.route) : reject(new Error(reply?.error || 'Rota rejeitada.'));
    });
  }), []);
  return { connected, joined, participants, route, error, sendLocation, publishRoute };
}
