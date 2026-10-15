import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, isInTrash } from '../db';
import { Icon } from './Icon';
import { Avatar } from './Avatar';
import { SignInDialog, SignOutDialog, useAccount } from './AccountDialogs';
import { pendingLabel, syncNow, type AccountState } from '../sync/engine';
import { relativeTime } from '../lib/text';
import './AccountMenu.css';

export function statusText(a: AccountState): string {
  switch (a.status) {
    case 'syncing':
      return 'Sincronizando…';
    case 'offline':
      return a.pending
        ? `Sem internet. ${pendingLabel(a.pending)}: ficam guardadas aqui e sobem quando a conexão voltar.`
        : 'Sem internet. O que você escrever fica guardado aqui e sobe quando a conexão voltar.';
    case 'error':
      return 'Não foi possível sincronizar agora. Tentamos de novo em um minuto.';
    case 'full':
      return 'A nuvem da sua conta está cheia: as mudanças novas ficam só neste aparelho. Apagar versões antigas libera espaço.';
    case 'synced':
      return a.pending ? `${pendingLabel(a.pending)}.` : `Tudo salvo na nuvem${a.lastSync ? `, ${relativeTime(a.lastSync)}` : ''}.`;
    default:
      return 'Preparando a sincronização…';
  }
}

/** Link to the settings page (theme, sheet color, profile). */
function SettingsLink() {
  return (
    <Link to="/configuracoes" className="icon-btn" aria-label="Configurações" title="Configurações">
      <Icon name="settings" size={20} stroke={1.8} />
    </Link>
  );
}

/** "Entrar" button, or the author's photo with the account menu once signed in. */
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

  if (!account.configured) return <SettingsLink />;

  if (!account.email) {
    return (
      <>
        <SettingsLink />
        <button className="btn btn-outline" onClick={() => setSigningIn(true)} title={account.linked ? 'Entre de novo para continuar sincronizando' : undefined}>
          <Icon name="user" size={16} />
          {account.linked ? 'Entrar de novo' : 'Entrar'}
        </button>
        {signingIn && <SignInDialog onClose={() => setSigningIn(false)} />}
      </>
    );
  }

  return (
    <div className="account" ref={ref}>
      <button
        className={`icon-btn account-btn is-${account.status}`}
        aria-label={`Conta: ${account.email}`}
        aria-expanded={open}
        title={statusText(account)}
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar profile={account.profile} email={account.email} size={38} />
        <span className="account-dot" aria-hidden="true" />
      </button>
      {open && (
        <AccountCard
          onClose={() => setOpen(false)}
          onSignOut={() => {
            setOpen(false);
            setSigningOut(true);
          }}
        />
      )}
      {signingOut && <SignOutDialog onClose={() => setSigningOut(false)} />}
    </div>
  );
}

/** A word or two for the chip on the card's cover. */
const SHORT_STATUS: Record<AccountState['status'], string> = {
  idle: 'Preparando',
  syncing: 'Sincronizando',
  synced: 'Salvo',
  offline: 'Sem internet',
  error: 'Não sincronizou',
  full: 'Nuvem cheia',
};

const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

/** The account menu: a card with a cover, the author's photo, name, @ and a few numbers. */
function AccountCard({ onClose, onSignOut }: { onClose: () => void; onSignOut: () => void }) {
  const account = useAccount();
  const stats = useLiveQuery(async () => {
    const stories = (await db.stories.toArray()).filter((s) => !isInTrash(s));
    const ids = new Set(stories.map((s) => s.id));
    const words = (await db.chapters.toArray()).reduce((n, c) => (ids.has(c.storyId) ? n + c.wordCount : n), 0);
    const open = (await db.threads.where('status').equals('aberto').toArray()).filter((t) => ids.has(t.storyId)).length;
    return { stories: stories.length, words, open };
  }, []);
  if (!account.email) return null;
  const name = account.profile?.name;
  const trouble = account.pending > 0 || account.status === 'offline' || account.status === 'error' || account.status === 'full';

  return (
    <div className="account-pop" role="dialog" aria-label="Conta">
      <div className="account-cover">
        <span className={`account-chip is-${account.status}`} title={statusText(account)}>
          <span aria-hidden="true" />
          {SHORT_STATUS[account.status]}
        </span>
      </div>
      <div className="account-card-body">
        <span className="account-photo">
          <Avatar profile={account.profile} email={account.email} size={64} />
        </span>
        <strong className="account-name">{name || account.email.split('@')[0]}</strong>
        <span className="account-email">
          {account.handle ? <>@{account.handle} · </> : null}
          {account.email}
        </span>
        {stats && (
          <dl className="account-stats">
            <div>
              <dt>{stats.stories === 1 ? 'história' : 'histórias'}</dt>
              <dd>{stats.stories}</dd>
            </div>
            <div>
              <dt>palavras</dt>
              <dd>{compact.format(stats.words)}</dd>
            </div>
            <div>
              <dt>{stats.open === 1 ? 'fio aberto' : 'fios abertos'}</dt>
              <dd>{stats.open}</dd>
            </div>
          </dl>
        )}
        {trouble && (
          <p className={`account-status is-${account.status}`} aria-live="polite">
            {statusText(account)}
          </p>
        )}
        {!account.handle && account.handle !== undefined && (
          <Link className="account-nudge" to="/configuracoes/perfil" onClick={onClose}>
            Escolha o seu @
          </Link>
        )}
      </div>
      <nav className="account-menu" aria-label="Menu da conta">
        <Link to="/configuracoes/perfil" onClick={onClose}>
          <Icon name="user" size={18} />
          Editar perfil
        </Link>
        <Link to="/configuracoes/aparencia" onClick={onClose}>
          <Icon name="palette" size={18} />
          Aparência
        </Link>
        <button disabled={account.status === 'syncing'} onClick={() => syncNow()} title={statusText(account)}>
          <Icon name="refresh" size={18} />
          {account.status === 'syncing' ? 'Sincronizando…' : 'Sincronizar agora'}
          {account.status === 'synced' && account.lastSync && !account.pending && <small>{relativeTime(account.lastSync)}</small>}
        </button>
        <hr />
        <button onClick={onSignOut}>
          <Icon name="logout" size={18} />
          Sair
        </button>
      </nav>
    </div>
  );
}
