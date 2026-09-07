import PlaceSearch from './PlaceSearch.jsx';

function formatDistance(meters) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}
function formatDuration(seconds) {
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}min` : `${minutes} min`;
}

export default function PartyPanel({
  roomId,
  connected,
  joined,
  participants,
  route,
  points,
  locationStatus,
  mode,
  onMode,
  onSelectPoint,
  onShare
}) {
  return <aside className="flex max-h-[58%] w-full shrink-0 flex-col overflow-y-auto border-b border-slate-200 bg-white p-4 md:max-h-none md:w-96 md:border-b-0 md:border-r">
    <div className="flex items-center justify-between gap-3">
      <div><h1 className="text-lg font-bold">Map Party</h1><p className="font-mono text-xs text-slate-500">{roomId}</p></div>
      <span className={`rounded-full px-2 py-1 text-xs font-medium ${joined ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{joined ? 'Na party' : connected ? 'Entrando' : 'Reconectando'}</span>
    </div>
    <button onClick={onShare} className="mt-4 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50">Compartilhar party</button>
    <section className="mt-5">
      <h2 className="text-sm font-semibold">Definir rota</h2>
      <p className="mt-1 text-xs text-slate-500">Busque um endereço ou selecione diretamente no mapa.</p>
      <div className="mt-3 space-y-3">
        <PlaceSearch kind="origin" label="Buscar origem" selectedPoint={points.origin} disabled={!joined} onSelect={onSelectPoint} />
        <PlaceSearch kind="destination" label="Buscar destino" selectedPoint={points.destination} disabled={!joined} onSelect={onSelectPoint} />
      </div>
      <p className="mt-3 text-xs font-medium text-slate-600">Ou clique no mapa:</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button disabled={!joined} onClick={() => onMode(mode === 'origin' ? null : 'origin')} className={`rounded-lg px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${mode === 'origin' ? 'bg-emerald-600 text-white' : 'bg-slate-100'}`}>Origem</button>
        <button disabled={!joined} onClick={() => onMode(mode === 'destination' ? null : 'destination')} className={`rounded-lg px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${mode === 'destination' ? 'bg-red-600 text-white' : 'bg-slate-100'}`}>Destino</button>
      </div>
      {route && <div className="mt-3 rounded-lg bg-blue-50 p-2 text-sm text-blue-900">
        <p className="font-semibold">{formatDistance(route.distance)} · {formatDuration(route.duration)}</p>
        {route.updatedBy?.name && <p className="mt-1 text-xs text-blue-700">Atualizada por {route.updatedBy.name}</p>}
      </div>}
    </section>
    <section className="mt-5 min-h-0 md:flex-1 md:overflow-auto">
      <h2 className="text-sm font-semibold">Participantes ({participants.length})</h2>
      <ul className="mt-2 space-y-2">
        {participants.map((item) => <li key={item.id} className="flex items-center gap-2 text-sm">
          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
          <span className="min-w-0 flex-1 truncate">{item.name}</span>
          <span className="text-xs text-slate-500">{item.location ? `±${Math.round(item.location.accuracy)} m` : 'sem posição'}</span>
        </li>)}
      </ul>
    </section>
    <p className="mt-4 text-xs text-slate-500">{locationStatus}</p>
  </aside>;
}
