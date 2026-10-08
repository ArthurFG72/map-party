import { useEffect, useState } from 'react';
import IosInstallHint from './IosInstallHint.jsx';
import { fetchAppDownloads } from '../lib/api.js';

function isIosDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function isAndroidDevice() { return /Android/i.test(navigator.userAgent); }
function isStandalone() {
  return (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches)
    || navigator.standalone === true;
}
function isLanHttp() {
  return window.location.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
}
function safeDownloadUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function Link({ href, children }) {
  const safeHref = safeDownloadUrl(href);
  if (!safeHref) return null;
  return <a href={safeHref} target="_blank" rel="noopener noreferrer" className="inline-block rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white">{children}</a>;
}

export default function InstallAppPrompt() {
  const [installEvent, setInstallEvent] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [downloads, setDownloads] = useState(null);

  useEffect(() => {
    fetchAppDownloads().then((body) => setDownloads(body && typeof body === 'object' ? body : {})).catch(() => setDownloads({}));
    if (isStandalone()) return undefined;
    const onInstallPrompt = (event) => { event.preventDefault(); setInstallEvent(event); };
    window.addEventListener('beforeinstallprompt', onInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onInstallPrompt);
  }, []);

  if (isStandalone() || dismissed) return null;
  const ios = isIosDevice();
  const android = isAndroidDevice();
  async function installPwa() {
    installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
  }

  return <aside className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="font-semibold">Usar o Map Party no dispositivo</p>
        <p className="mt-1 leading-5">O endereço do servidor abre a versão web. O app nativo aparece aqui quando o administrador publica um instalador de teste.</p>
      </div>
      <button type="button" onClick={() => setDismissed(true)} aria-label="Fechar" className="-mr-2 -mt-2 rounded-lg px-2 text-lg text-slate-600">×</button>
    </div>
    <div className="mt-3 flex flex-wrap gap-2">
      {android && downloads?.android && <Link href={downloads.android}>Baixar Android</Link>}
      {ios && downloads?.ios && <Link href={downloads.ios}>Abrir instalação iOS</Link>}
      {!ios && !android && downloads?.android && <Link href={downloads.android}>Baixar Android</Link>}
      {!ios && !android && downloads?.ios && <Link href={downloads.ios}>Abrir instalação iOS</Link>}
      {downloads?.expoGo && <Link href={downloads.expoGo}>Testar com Expo Go</Link>}
      {installEvent && <button type="button" onClick={installPwa} className="rounded-lg bg-emerald-600 px-3 py-2 font-semibold text-white">Instalar versão web</button>}
    </div>
    {ios && !downloads?.ios && <IosInstallHint />}
    {android && !downloads?.android && !installEvent && <p className="mt-3 leading-5">No Chrome, abra o menu e escolha <strong>Adicionar à tela inicial</strong>. Para APK, o administrador precisa publicar um link de teste.</p>}
    {isLanHttp() && <p className="mt-3 leading-5 text-amber-800">Esta rede usa HTTP local. A instalação PWA e o GPS funcionam melhor em HTTPS.</p>}
  </aside>;
}
