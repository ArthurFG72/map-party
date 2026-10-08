import { useState } from 'react';

function isIosDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches)
    || navigator.standalone === true;
}

function wasDismissed() {
  try { return sessionStorage.getItem('ios-install-hint') === 'dismissed'; }
  catch { return false; }
}

export default function IosInstallHint() {
  const [dismissed, setDismissed] = useState(wasDismissed);
  if (!isIosDevice() || isStandalone() || dismissed) return null;

  function dismiss() {
    try { sessionStorage.setItem('ios-install-hint', 'dismissed'); } catch { /* armazenamento pode estar bloqueado */ }
    setDismissed(true);
  }

  return <aside className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="font-semibold">Instalar no iPhone</p>
        <p className="mt-1 leading-5">No Safari, toque em <strong>Compartilhar</strong> e depois em <strong>Adicionar à Tela de Início</strong>.</p>
      </div>
      <button type="button" onClick={dismiss} aria-label="Fechar instrução" className="-mr-2 -mt-2 rounded-lg px-2 text-lg text-blue-700">×</button>
    </div>
  </aside>;
}
