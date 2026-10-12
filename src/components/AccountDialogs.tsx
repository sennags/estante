import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react';
import type { AuthError } from '@supabase/supabase-js';
import { Modal } from './Modal';
import { Icon } from './Icon';
import { tell } from './Ask';
import { appUrl, EMAIL_LOGIN, GOOGLE_LOGIN, supabase } from '../sync/supabase';
import './AccountMenu.css';
import { finishRecovery, getAccountState, pendingLabel, signOut, subscribeAccount, unsentChanges } from '../sync/engine';

export const useAccount = () => useSyncExternalStore(subscribeAccount, getAccountState);

const MIN_PASSWORD = 6;

/** Supabase's messages, in the app's voice. */
function authMessage(error: AuthError | Error): string {
  const code = 'code' in error ? error.code : undefined;
  switch (code) {
    case 'invalid_credentials':
      return 'E-mail ou senha incorretos.';
    case 'email_not_confirmed':
      return 'Falta confirmar o e-mail: abra o link que enviamos e depois entre aqui.';
    case 'user_already_exists':
    case 'email_exists':
      return 'Já existe uma conta com esse e-mail. Tente entrar.';
    case 'weak_password':
      return `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`;
    case 'same_password':
      return 'A nova senha precisa ser diferente da anterior.';
    case 'email_address_invalid':
      return 'Esse e-mail não parece certo.';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'Muitas tentativas seguidas. Espere um pouco e tente de novo.';
  }
  if (!navigator.onLine || /fetch|network/i.test(error.message)) return 'Sem conexão com a internet. Tente de novo quando ela voltar.';
  return 'Não deu certo. Tente de novo em instantes.';
}

type Mode = 'entrar' | 'criar' | 'esqueci';

const TITLES: Record<Mode, string> = { entrar: 'Entrar', criar: 'Criar conta', esqueci: 'Esqueci a senha' };

/** Sign in, create an account or ask for a password reset link. */
export function SignInDialog({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('entrar');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const go = (m: Mode) => {
    setMode(m);
    setError('');
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    const address = email.trim();
    if (mode !== 'esqueci' && password.length < MIN_PASSWORD) return setError(`A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`);
    setBusy(true);
    setError('');
    try {
      if (mode === 'entrar') {
        const { error } = await supabase.auth.signInWithPassword({ email: address, password });
        if (error) return setError(authMessage(error));
        onClose();
      } else if (mode === 'criar') {
        const { data, error } = await supabase.auth.signUp({ email: address, password, options: { emailRedirectTo: appUrl() } });
        if (error) return setError(authMessage(error));
        if (data.session) return onClose();
        setSent(`Enviamos um link para ${address}. Abra-o para confirmar a conta e depois entre aqui com seu e-mail e senha.`);
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(address, { redirectTo: appUrl() });
        if (error) return setError(authMessage(error));
        setSent(`Se houver uma conta com ${address}, chega lá um link para criar uma senha nova. Abra-o neste mesmo navegador.`);
      }
    } catch (err) {
      setError(authMessage(err as Error));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setBusy(true);
    const { error } = await supabase!.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: appUrl() } });
    if (error) {
      setBusy(false);
      setError(authMessage(error));
    }
  }

  if (sent) {
    return (
      <Modal title="Confira seu e-mail" onClose={onClose}>
        <p className="ask-message" style={{ margin: 0 }}>{sent}</p>
        <div className="dialog-actions">
          <button className="btn btn-primary" data-autofocus onClick={onClose}>Entendi</button>
        </div>
      </Modal>
    );
  }

  const legal = (
    <p className="account-legal">
      Ao entrar ou criar uma conta, você concorda com os{' '}
      <a href="termos.html" target="_blank" rel="noopener">Termos de Serviço</a> e a{' '}
      <a href="privacidade.html" target="_blank" rel="noopener">Política de Privacidade</a>.
    </p>
  );

  // Until e-mails can reach everyone (own SMTP), only Google.
  if (!EMAIL_LOGIN && GOOGLE_LOGIN) {
    return (
      <Modal title="Entrar" onClose={onClose}>
        <div className="account-form">
          <p className="account-intro">
            Com uma conta, suas histórias ficam guardadas na nuvem e abrem em qualquer aparelho. Sem ela, tudo continua só neste navegador.
          </p>
          {error && <p role="alert" className="form-error">{error}</p>}
          <button type="button" className="btn btn-outline" data-autofocus disabled={busy} onClick={google}>
            <GoogleMark />
            Entrar com Google
          </button>
          <p className="account-hint account-soon">Entrar com e-mail e senha volta em breve.</p>
          {legal}
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={TITLES[mode]} onClose={onClose}>
      <form className="account-form" onSubmit={submit}>
        <p className="account-intro">
          {mode === 'esqueci'
            ? 'Diga o e-mail da sua conta e enviamos um link para criar uma senha nova.'
            : 'Com uma conta, suas histórias ficam guardadas na nuvem e abrem em qualquer aparelho. Sem ela, tudo continua só neste navegador.'}
        </p>
        <label className="field">
          <span>E-mail</span>
          <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {mode !== 'esqueci' && (
          <label className="field">
            <span>Senha</span>
            <input
              className="input"
              type="password"
              required
              minLength={MIN_PASSWORD}
              autoComplete={mode === 'criar' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {mode === 'criar' && <small className="account-hint">Pelo menos {MIN_PASSWORD} caracteres.</small>}
          </label>
        )}
        {mode === 'entrar' && (
          <button type="button" className="link-btn account-forgot" onClick={() => go('esqueci')}>Esqueci a senha</button>
        )}

        {error && <p role="alert" className="form-error">{error}</p>}

        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Um instante…' : mode === 'entrar' ? 'Entrar' : mode === 'criar' ? 'Criar conta' : 'Enviar o link'}
        </button>

        {GOOGLE_LOGIN && mode !== 'esqueci' && (
          <>
            <div className="account-or"><span>ou</span></div>
            <button type="button" className="btn btn-outline" disabled={busy} onClick={google}>
              <GoogleMark />
              Entrar com Google
            </button>
          </>
        )}

        {mode !== 'esqueci' && legal}

        <p className="account-switch">
          {mode === 'entrar' ? (
            <>Ainda não tem conta? <button type="button" className="link-btn" onClick={() => go('criar')}>Criar conta</button></>
          ) : (
            <>Já tem conta? <button type="button" className="link-btn" onClick={() => go('entrar')}>Entrar</button></>
          )}
        </p>
      </form>
    </Modal>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/** After a "forgot my password" link: choose the new password. */
export function NewPasswordDialog() {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) return setError(`A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`);
    if (password !== repeat) return setError('As duas senhas não estão iguais.');
    setBusy(true);
    const { error } = await supabase!.auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(authMessage(error));
    finishRecovery();
    tell({ title: 'Senha nova guardada', message: 'Pronto. Da próxima vez, entre com ela.' });
  }

  return (
    <Modal title="Criar uma senha nova" onClose={finishRecovery} locked>
      <form className="account-form" onSubmit={submit}>
        <label className="field">
          <span>Senha nova</span>
          <input className="input" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD} value={password} onChange={(e) => setPassword(e.target.value)} />
          <small className="account-hint">Pelo menos {MIN_PASSWORD} caracteres.</small>
        </label>
        <label className="field">
          <span>Repita a senha</span>
          <input className="input" type="password" autoComplete="new-password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        </label>
        {error && <p role="alert" className="form-error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={finishRecovery}>Agora não</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Um instante…' : 'Guardar senha'}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Leaving the account: keep a copy here or erase it. */
export function SignOutDialog({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<'checking' | 'unsent' | 'choose' | 'leaving'>('checking');
  const [unsent, setUnsent] = useState(0);

  useEffect(() => {
    let alive = true;
    unsentChanges().then((n) => {
      if (!alive) return;
      setUnsent(n);
      setStep(n ? 'unsent' : 'choose');
    });
    return () => {
      alive = false;
    };
  }, []);

  async function leave(keepCopy: boolean) {
    setStep('leaving');
    await signOut(keepCopy);
    onClose();
  }

  if (step === 'checking' || step === 'leaving') {
    return (
      <Modal title="Sair da conta" onClose={onClose} locked>
        <p className="ask-message" style={{ margin: 0 }}>{step === 'checking' ? 'Enviando as últimas mudanças para a nuvem…' : 'Saindo…'}</p>
      </Modal>
    );
  }

  if (step === 'unsent') {
    return (
      <Modal title="Ainda há mudanças só aqui" onClose={onClose}>
        <div className="ask-message">
          <p>Há {pendingLabel(unsent)} para a nuvem, provavelmente por falta de internet.</p>
          <p>Se sair agora, elas não chegam aos outros aparelhos. Que tal esperar a conexão voltar?</p>
        </div>
        <div className="dialog-actions">
          <button className="btn btn-ghost" onClick={() => setStep('choose')}>Sair mesmo assim</button>
          <button className="btn btn-primary" data-autofocus onClick={onClose}>Esperar</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Sair da conta" onClose={onClose}>
      <div className="ask-message">
        <p>Quer deixar uma cópia das histórias neste navegador?</p>
        <p>Num computador compartilhado, é melhor apagar: elas continuam guardadas na sua conta.</p>
      </div>
      <div className="dialog-actions">
        <button className="btn btn-ghost" onClick={() => leave(true)}>Manter uma cópia</button>
        <button className="btn btn-dark" data-autofocus onClick={() => leave(false)}>
          <Icon name="logout" size={16} />
          Apagar deste navegador
        </button>
      </div>
    </Modal>
  );
}
