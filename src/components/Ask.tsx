import { useEffect, useState, type ReactNode } from 'react';
import { Modal } from './Modal';

/**
 * The app's own replacements for window.confirm and window.alert, so the
 * browser never shows "localhost says". Call ask() or tell() from anywhere;
 * <AskHost /> at the root shows them one at a time.
 */

type Request = {
  id: number;
  title: string;
  message: ReactNode;
  /** Label of the confirming button; tell() has only this one. */
  confirm: string;
  /** Present for ask(); tell() has a single button. */
  cancel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
};

let show: ((r: Omit<Request, 'id'>) => void) | null = null;
let nextId = 0;

type AskOptions = { title: string; message: ReactNode; confirm: string; cancel?: string; danger?: boolean };

/** Asks the author to confirm; resolves to true only on the confirming button. */
export function ask({ cancel = 'Cancelar', ...opts }: AskOptions): Promise<boolean> {
  return new Promise((resolve) => (show ? show({ ...opts, cancel, resolve }) : resolve(false)));
}

/** Tells the author something; resolves once the message is dismissed. */
export function tell({ title, message, confirm = 'Entendi' }: { title: string; message: ReactNode; confirm?: string }): Promise<void> {
  return new Promise((resolve) => (show ? show({ title, message, confirm, resolve: () => resolve() }) : resolve()));
}

export function AskHost() {
  const [queue, setQueue] = useState<Request[]>([]);

  useEffect(() => {
    show = (r) => setQueue((q) => [...q, { ...r, id: nextId++ }]);
    return () => {
      show = null;
    };
  }, []);

  const current = queue[0];
  if (!current) return null;

  const answer = (ok: boolean) => {
    current.resolve(ok);
    setQueue((q) => q.slice(1));
  };

  return (
    <Modal key={current.id} title={current.title} onClose={() => answer(false)}>
      <div className="ask-message">{current.message}</div>
      <div className="dialog-actions">
        {current.cancel && (
          // A destructive question starts on Cancelar, so Enter never deletes by accident.
          <button className="btn btn-ghost" data-autofocus={current.danger || undefined} onClick={() => answer(false)}>
            {current.cancel}
          </button>
        )}
        <button className={`btn ${current.danger ? 'btn-solid-danger' : 'btn-primary'}`} data-autofocus={!current.danger || undefined} onClick={() => answer(true)}>
          {current.confirm}
        </button>
      </div>
    </Modal>
  );
}
