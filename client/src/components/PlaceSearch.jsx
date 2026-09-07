import { useState } from 'react';
import { searchPlaces } from '../lib/api.js';

export default function PlaceSearch({ kind, label, selectedPoint, disabled, onSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    const clean = query.replace(/\s+/g, ' ').trim();
    if (clean.length < 3) {
      setStatus('Digite pelo menos 3 caracteres.');
      return;
    }
    setLoading(true);
    setStatus('');
    try {
      const body = await searchPlaces(clean);
      setResults(body.results || []);
      if (!body.results?.length) setStatus('Nenhum lugar encontrado.');
    } catch (error) {
      setResults([]);
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  }

  function choose(result) {
    const point = { lat: result.lat, lng: result.lng, label: result.label, source: 'search' };
    setQuery(result.label);
    setResults([]);
    setStatus('');
    onSelect(kind, point);
  }

  return <div>
    <form onSubmit={submit} className="flex gap-2">
      <label className="sr-only" htmlFor={`search-${kind}`}>{label}</label>
      <input
        id={`search-${kind}`}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        disabled={disabled}
        maxLength={160}
        placeholder={label}
        autoComplete="off"
        className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
      />
      <button
        type="submit"
        disabled={disabled || loading}
        className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
      >{loading ? '...' : 'Buscar'}</button>
    </form>
    {selectedPoint && <p className="mt-1 truncate text-xs text-slate-500" title={selectedPoint.label}>
      {selectedPoint.label || `${selectedPoint.lat.toFixed(5)}, ${selectedPoint.lng.toFixed(5)}`}
    </p>}
    {status && <p className="mt-1 text-xs text-amber-700" role="status">{status}</p>}
    {results.length > 0 && <ul className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      {results.map((result) => <li key={result.id}>
        <button
          type="button"
          onClick={() => choose(result)}
          className="w-full px-3 py-2 text-left text-xs leading-4 hover:bg-emerald-50"
        >{result.label}</button>
      </li>)}
    </ul>}
  </div>;
}
