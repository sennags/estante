import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { SignInDialog, SignOutDialog, useAccount } from './AccountDialogs';
import { pendingLabel, syncNow, type AccountState } from '../sync/engine';
import { relativeTime } from '../lib/text';
import './AccountMenu.css';

function statusText(a: AccountState): string {
  switch (a.status) {
    case 'syncing':
      return 'Sincronizando…';
    case 'offline':
      return a.pending
        ? `Sem internet. ${pendingLabel(a.pending)}: ficam guardadas aqui e sobem quando a conexão voltar.`
        : 'Sem internet. O que você escrever fica guardado aqui e sobe quando a conexão voltar.';
    case 'error':
      return 'Não foi possível sincronizar agora. Tentamos de novo em um minuto.';
    case 'synced':
      return a.pending ? `${pendingLabel(a.pending)}.` : `Tudo salvo na nuvem${a.lastSync ? `, ${relativeTime(a.lastSync)}` : ''}.`;
    default:
      return 'Preparando a sincronização…';
  }
}

/** "Entrar" button, or the account menu once signed in. Hidden when accounts are not set up. */
export function AccountMenu() {
  const account = useAccount();
  const [open, setOpen] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!account.configured) return null;

  if (!account.email) {
    return (
      <>
        <button className="btn btn-outline" onClick={() => setSigningIn(true)} title={account.linked ? 'Entre de novo para continuar sincronizando' : undefined}>
          <Icon name="user" size={16} />
          {account.linked ? 'Entrar de novo' : 'Entrar'}
        </button>
        {signingIn && <SignInDialog onClose={() => setSigningIn(false)} />}
      </>
    );
  }

  const trouble = account.status === 'offline' || account.status === 'error';
  return (
    <div className="account" ref={ref}>
      <button
        className={`icon-btn account-btn is-${account.status}`}
        aria-label={`Conta: ${account.email}`}
        aria-expanded={open}
        title={statusText(account)}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={trouble ? 'cloudOff' : 'cloud'} size={22} stroke={1.8} />
        <span className="account-dot" aria-hidden="true" />
      </button>
      {open && (
        <div className="account-pop" role="dialog" aria-label="Conta">
          <span className="eyebrow">Sua conta</span>
          <strong className="account-email">{account.email}</strong>
          <p className={`account-status is-${account.status}`} aria-live="polite">{statusText(account)}</p>
          <div className="account-actions">
            <button className="btn btn-sm btn-outline" disabled={account.status === 'syncing'} onClick={() => syncNow()}>
              <Icon name="refresh" size={15} />
              Sincronizar agora
            </button>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setOpen(false);
                setSigningOut(true);
              }}
            >
              <Icon name="logout" size={15} />
              Sair
            </button>
          </div>
        </div>
      )}
      {signingOut && <SignOutDialog onClose={() => setSigningOut(false)} />}
    </div>
  );
}
