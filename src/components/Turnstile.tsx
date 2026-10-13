import { useEffect, useRef, useState } from 'react';

/*
 * Cloudflare Turnstile, the CAPTCHA Supabase checks on e-mail sign-in,
 * sign-up and password reset. It stays invisible unless Cloudflare needs the
 * author to click; most people never see it.
 */

type TurnstileApi = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile() {
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile')));
    script.onerror = () => {
      loading = null; // try again next time the dialog opens
      script.remove();
      reject(new Error('Turnstile'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

type Props = {
  siteKey: string;
  /** Each new token, or '' while there is none. */
  onToken: (token: string) => void;
  /** True while Cloudflare waits for the author to tick the box. */
  onAsk: (asking: boolean) => void;
  /** Tokens are single-use: bump it after every request that spent one. */
  resetKey: number;
};

export function Turnstile({ siteKey, onToken, onAsk, resetKey }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const callbacks = useRef({ onToken, onAsk });
  callbacks.current = { onToken, onAsk };
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let alive = true;
    loadTurnstile()
      .then((api) => {
        if (!alive || !ref.current) return;
        widget.current = api.render(ref.current, {
          sitekey: siteKey,
          appearance: 'interaction-only',
          language: 'pt-br',
          callback: (token: string) => callbacks.current.onToken(token),
          'expired-callback': () => callbacks.current.onToken(''),
          'error-callback': () => callbacks.current.onToken(''),
          'before-interactive-callback': () => callbacks.current.onAsk(true),
          'after-interactive-callback': () => callbacks.current.onAsk(false),
        });
      })
      .catch(() => callbacks.current.onToken(''));
    return () => {
      alive = false;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey]);

  // The widget stays on screen after the click (it shows "Sucesso!"), so the
  // room it takes follows its real size, not the interactive callbacks.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setShown(el.offsetHeight > 0));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!resetKey || !widget.current) return;
    callbacks.current.onToken('');
    window.turnstile?.reset(widget.current);
  }, [resetKey]);

  return <div ref={ref} className={`account-captcha${shown ? ' is-visible' : ''}`} />;
}
