import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import InstallAppPrompt from '../components/InstallAppPrompt.jsx';
import { normalizeName, saveName, saveVisibility, storedName, storedVisibility } from '../lib/identity.js';

export default function Home() {
  const [name, setName] = useState(storedName);
  const [visible, setVisible] = useState(storedVisibility);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  function createParty(event) {
    event.preventDefault();
    const clean = normalizeName(name);
    if (clean.length < 2) return setError('Digite um nome com pelo menos 2 caracteres.');
    saveName(clean); saveVisibility(visible); navigate('/party/global');
  }
  return <main className="grid min-h-full place-items-center p-5">
    <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-bold">Map Party</h1>
      <p className="mt-2 text-sm text-slate-600">Crie uma sala e compartilhe o link para acompanhar o grupo no mapa.</p>
      <form className="mt-6 space-y-4" onSubmit={createParty}>
        <label className="block text-sm font-medium" htmlFor="name">Seu nome</label>
        <input id="name" autoFocus autoComplete="name" maxLength={40} value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Ex.: Ana" />
        <label className="flex items-start gap-2 text-sm text-slate-600"><input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} className="mt-1" />Compartilhar minha posição com a party</label>
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        <button className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 font-semibold text-white hover:bg-emerald-700">Criar party</button>
      </form>
      <InstallAppPrompt />
    </section>
  </main>;
}
