import { useState } from 'react';
import { Icon } from './Icon';
import { SignInDialog, useAccount } from './AccountDialogs';
import './OldAddressNotice.css';

const NEW_ADDRESS = 'https://lirismo.com.br';
const DISMISSED = 'lirismo:aviso-endereco-fechado';

/**
 * lirismo.pages.dev was the first address. Each address keeps its own
 * stories on the device, so redirecting would hide them from whoever writes
 * without an account; instead, this notice explains how to take them along.
 * Branch previews (<branch>.lirismo.pages.dev) do not show it. In development,
 * ?endereco-antigo shows it.
 */
const onOldAddress =
  window.location.hostname === 'lirismo.pages.dev' ||
  (import.meta.env.DEV && new URLSearchParams(window.location.search).has('endereco-antigo'));

function wasDismissed() {
  try {
    return localStorage.getItem(DISMISSED) === '1';
  } catch {
    return false;
  }
}

export function OldAddressNotice({ stories }: { stories: number }) {
  const account = useAccount();
  const [dismissed, setDismissed] = useState(wasDismissed);
  const [signingIn, setSigningIn] = useState(false);

  if (!onOldAddress || dismissed) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED, '1');
    } catch {
      // Without storage, it only closes until the next visit.
    }
    setDismissed(true);
  };

  // Stories that live only here need an account to reach the new address.
  const strandedHere = stories > 0 && !account.email;

  return (
    <section className="old-address" aria-labelledby="old-address-title">
      <div className="old-address-text">
        <h2 id="old-address-title">O Lirismo mudou de endereço: agora é lirismo.com.br</h2>
        {account.email ? (
          <p>Suas histórias estão na sua conta. Entre com ela em lirismo.com.br e continue de lá.</p>
        ) : strandedHere && account.configured ? (
          <p>
            As histórias deste aparelho ficam guardadas neste endereço e não aparecem sozinhas no novo. Para levá-las, entre numa
            conta aqui (ou crie uma) e depois entre com a mesma conta em lirismo.com.br.
          </p>
        ) : strandedHere ? (
          <p>As histórias deste aparelho ficam guardadas neste endereço e não aparecem sozinhas no novo. Continue usando este endereço por enquanto.</p>
        ) : (
          <p>Use o endereço novo daqui em diante.</p>
        )}
      </div>
      <div className="old-address-actions">
        {strandedHere && account.configured && (
          <button className="btn btn-sm btn-primary" onClick={() => setSigningIn(true)}>
            <Icon name="user" size={15} />
            Entrar aqui
          </button>
        )}
        <a className={`btn btn-sm ${strandedHere ? 'btn-outline' : 'btn-primary'}`} href={NEW_ADDRESS}>
          Ir para lirismo.com.br
          <Icon name="arrowRight" size={15} />
        </a>
        <button className="btn btn-sm btn-ghost" onClick={dismiss}>
          Agora não
        </button>
      </div>
      {signingIn && <SignInDialog onClose={() => setSigningIn(false)} />}
    </section>
  );
}
