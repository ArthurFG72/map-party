import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import PartyMap from '../components/PartyMap.jsx';
import PartyPanel from '../components/PartyPanel.jsx';
import { useGeolocation } from '../hooks/useGeolocation.js';
import { useParty } from '../hooks/useParty.js';
import { fetchRoute } from '../lib/api.js';
import { normalizeName, saveName, storedName } from '../lib/identity.js';

const MAX_ROUTE_BYTES = 120_000;

export default function Party() {
  const { roomId = '' } = useParams();
  const navigate = useNavigate();
  const [name, setName] = useState(storedName);
  const [draftName, setDraftName] = useState(storedName);
  const [mode, setMode] = useState(null);
  const [points, setPoints] = useState({ origin: null, destination: null });
  const [focusPoint, setFocusPoint] = useState(null);
  const [message, setMessage] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const validRoom = /^[a-z0-9-]{4,48}$/.test(roomId);
  const party = useParty(validRoom && name ? roomId : '', name);
  const locationStatus = useGeolocation({ enabled: Boolean(validRoom && name && party.joined), onLocation: party.sendLocation });

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);

  useEffect(() => {
    if (party.route) setPoints({ origin: party.route.origin, destination: party.route.destination });
  }, [party.route]);

  const calculateRoute = useCallback(async (origin, destination) => {
    if (!online) throw new Error('O cálculo de rota exige conexão com a internet.');
    const payload = await fetchRoute(origin, destination);
    if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > MAX_ROUTE_BYTES) {
      throw new Error('A rota calculada excede o tamanho permitido.');
    }
    await party.publishRoute(payload);
  }, [online, party.publishRoute]);

  async function selectPoint(kind, point) {
    const next = { ...points, [kind]: point };
    setPoints(next);
    setFocusPoint(point);
    setMode(kind === 'origin' ? 'destination' : null);
    setMessage('');
    if (next.origin && next.destination) {
      setMessage('Calculando rota…');
      try { await calculateRoute(next.origin, next.destination); setMessage('Rota compartilhada.'); }
      catch (error) { setMessage(error.message); }
    }
  }

  function pickPoint(point) {
    if (mode) selectPoint(mode, { ...point, label: 'Ponto selecionado no mapa', source: 'map' });
  }

  function join(event) {
    event.preventDefault();
    const clean = normalizeName(draftName);
    if (clean.length < 2) return setMessage('Digite um nome com pelo menos 2 caracteres.');
    saveName(clean); setName(clean); setMessage('');
  }

  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Map Party', text: 'Entre na minha party e acompanhe a rota.', url: window.location.href });
        setMessage('Convite compartilhado.');
        return;
      }
      await navigator.clipboard.writeText(window.location.href); setMessage('Link copiado.');
    }
    catch (error) {
      if (error.name === 'AbortError') return;
      setMessage('Copie o endereço desta página para compartilhar.');
    }
  }

  if (!validRoom) return <main className="grid min-h-full place-items-center p-5"><section className="text-center"><p className="text-red-700">Código de party inválido.</p><button onClick={() => navigate('/')} className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-white">Voltar</button></section></main>;
  if (!name) return <main className="grid min-h-full place-items-center p-5"><form onSubmit={join} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow"><h1 className="text-xl font-bold">Entrar na party</h1><label htmlFor="join-name" className="mt-5 block text-sm font-medium">Seu nome</label><input id="join-name" autoFocus maxLength={40} value={draftName} onChange={(event) => setDraftName(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2" />{message && <p className="mt-2 text-sm text-red-600">{message}</p>}<button className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-2 text-white">Entrar</button></form></main>;

  return <main className="flex h-full min-h-0 flex-col md:flex-row">
    <PartyPanel roomId={roomId} connected={party.connected} joined={party.joined} participants={party.participants} route={party.route} points={points} locationStatus={locationStatus} mode={mode} onMode={setMode} onSelectPoint={selectPoint} onShare={share} />
    <section className="relative min-h-0 flex-1">
      <PartyMap participants={party.participants} route={party.route} points={points} focusPoint={focusPoint} selectionMode={mode} onPick={pickPoint} />
      {mode && <div className="pointer-events-none absolute left-1/2 top-3 z-[1000] -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow">Clique para marcar {mode === 'origin' ? 'a origem' : 'o destino'}</div>}
      {(!online || party.error || message) && <div role="status" className="absolute bottom-4 left-1/2 z-[1000] max-w-[90%] -translate-x-1/2 rounded-lg bg-white px-4 py-2 text-center text-sm shadow-lg">{!online ? 'Offline: o mapa, as localizações e as rotas ao vivo ficam indisponíveis.' : party.error || message}</div>}
    </section>
  </main>;
}
