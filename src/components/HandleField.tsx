import { useEffect, useState, type FormEvent } from 'react';
import { Modal } from './Modal';
import { tell } from './Ask';
import { SignOutDialog, useAccount } from './AccountDialogs';
import { setHandle } from '../sync/engine';
import { HANDLE_MAX, handleAvailable, handleProblem, HandleTaken, saveHandle } from '../sync/profile';

type HandleCheck = { handle: string; state: 'checking' | 'free' | 'taken' | 'error' };

/** The @ being typed: checked as the author types, saved on submit. */
export function useHandleForm(userId: string) {
  const { handle: current } = useAccount();
  const [handle, setHandleText] = useState(current ?? '');
  const [check, setCheck] = useState<HandleCheck>();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => setHandleText(current ?? ''), [current]);

  const problem = handle ? handleProblem(handle) : null;
  const same = !!current && handle.toLowerCase() === current.toLowerCase() && handle === current;
  const sameIgnoringCase = !!current && handle.toLowerCase() === current.toLowerCase();

  // Asks the server a moment after the author stops typing.
  useEffect(() => {
    if (!handle || problem || sameIgnoringCase) return setCheck(undefined);
    setCheck({ handle, state: 'checking' });
    let alive = true;
    const timer = window.setTimeout(() => {
      handleAvailable(handle)
        .then((free) => alive && setCheck({ handle, state: free ? 'free' : 'taken' }))
        .catch(() => alive && setCheck({ handle, state: 'error' }));
    }, 400);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [handle, problem, sameIgnoringCase]);

  const canSave = !busy && !!handle && !problem && !same && check?.state !== 'taken' && check?.state !== 'checking';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    try {
      await saveHandle(userId, handle);
      setHandle(handle);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      if (err instanceof HandleTaken) setCheck({ handle, state: 'taken' });
      else {
        console.warn('Salvar o @ falhou', err);
        tell({ title: 'Não deu para salvar o @', message: navigator.onLine ? 'Tente de novo daqui a pouco.' : 'Sem conexão com a internet. Tente de novo quando ela voltar.' });
      }
    } finally {
      setBusy(false);
    }
  }

  const status =
    problem ??
    (check?.state === 'checking' ? 'Conferindo…' : check?.state === 'taken' ? 'Este @ já é de outra pessoa.' : check?.state === 'free' ? 'Disponível.' : check?.state === 'error' ? 'Não deu para conferir agora.' : null);
  const bad = !!problem || check?.state === 'taken';

  return { current, handle, setHandleText, status, bad, free: check?.state === 'free', busy, saved, canSave, submit };
}

/** The @ box with its line of status underneath. */
export function HandleInput({ form, label = '@ (nome de usuário)' }: { form: ReturnType<typeof useHandleForm>; label?: string }) {
  const { current, handle, setHandleText, status, bad, free } = form;
  return (
    <>
      <label className="field">
        <span>{label}</span>
        <span className={`handle-input ${bad ? 'is-bad' : ''}`}>
          <span aria-hidden="true">@</span>
          <input
            className="input"
            value={handle}
            maxLength={HANDLE_MAX}
            placeholder="seu_nome"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={bad}
            aria-describedby="handle-status"
            onChange={(e) => setHandleText(e.target.value.replace(/^@/, '').trim())}
          />
        </span>
      </label>
      <p id="handle-status" className={`handle-status ${bad ? 'is-bad' : free ? 'is-good' : ''}`} aria-live="polite">
        {status ?? (current ? 'Só seu: ninguém mais pode usar este @.' : 'De 4 a 15 letras sem acento, números ou “_”.')}
      </p>
    </>
  );
}

/**
 * Every account has a @: right after signing in to an account without one,
 * this window asks for it and only closes once it is saved (or the author
 * leaves the account).
 */
export function ChooseHandleDialog({ userId }: { userId: string }) {
  const form = useHandleForm(userId);
  const [signingOut, setSigningOut] = useState(false);

  if (signingOut) return <SignOutDialog onClose={() => setSigningOut(false)} />;

  return (
    <Modal title="Escolha o seu @">
      <form className="account-form" onSubmit={form.submit}>
        <p className="account-intro">
          É o seu nome de usuário no Lirismo, só seu: ninguém mais pode ter o mesmo. Dá para trocar depois, em Configurações.
        </p>
        <HandleInput form={form} label="Seu @" />
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setSigningOut(true)}>
            Sair da conta
          </button>
          <button type="submit" className="btn btn-primary" disabled={!form.canSave}>
            {form.busy ? 'Salvando…' : 'Continuar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
