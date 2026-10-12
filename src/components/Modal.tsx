import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

type ModalProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** Ignore Esc and clicks on the backdrop; only the buttons close it. */
  locked?: boolean;
};

/** Native <dialog> shown as a modal while mounted. */
export function Modal({ title, onClose, children, wide, locked }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current!;
    let mounted = true;
    // Chrome closes a dialog on a repeated Esc even when cancel is prevented;
    // a locked dialog reopens itself.
    const reopen = () => mounted && locked && !dialog.open && dialog.showModal();
    dialog.addEventListener('close', reopen);
    if (!dialog.open) dialog.showModal();
    // showModal() focuses the close button; start in the first field instead.
    dialog.querySelector<HTMLElement>('form input:not([type=file]), form textarea')?.focus();
    return () => {
      mounted = false;
      dialog.removeEventListener('close', reopen);
      dialog.close();
    };
  }, [locked]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      style={wide ? { width: 'min(760px, calc(100vw - 32px))' } : undefined}
      onKeyDown={(e) => {
        // Handling Esc here stops the browser from starting a cancel at all.
        if (e.key === 'Escape') {
          e.preventDefault();
          if (!locked) onClose();
        }
      }}
      onCancel={(e) => {
        e.preventDefault();
        if (!locked) onClose();
      }}
      onClick={(e) => {
        if (!locked && e.target === ref.current) onClose();
      }}
    >
      <div className="dialog-body">
        <div className="dialog-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Fechar" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
