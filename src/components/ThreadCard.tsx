import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { reopenThread, THREAD_KIND_LABEL, type Chapter, type Scene, type Thread } from '../db';
import { ending, endsBeforeOrigin, origin, staleWarning, type Place } from '../lib/plot';
import { Icon } from './Icon';
import './ThreadCard.css';

export type ThreadAction = 'resolvido' | 'abandonado' | 'editar';

type Props = {
  thread: Thread;
  chapters: Chapter[];
  scenes: Scene[];
  onAction: (thread: Thread, action: ThreadAction) => void;
  /** Panel version: smaller, actions only while open. */
  compact?: boolean;
  open?: boolean;
  onToggle?: () => void;
  highlight?: boolean;
};

/** Planning card for a scene, or the editor for a chapter. */
export function placeLink(storyId: string, p: Place) {
  if (p.scene) return `/historia/${storyId}/planejamento?cena=${p.scene.id}`;
  return p.chapter ? `/historia/${storyId}/capitulo/${p.chapter.id}` : undefined;
}

function PlaceRef({ storyId, p, children }: { storyId: string; p: Place; children: ReactNode }) {
  const to = placeLink(storyId, p);
  return to ? <Link to={to}>{children}</Link> : <>{children}</>;
}

export function ThreadCard({ thread: t, chapters, scenes, onAction, compact, open = true, onToggle, highlight }: Props) {
  const from = origin(t, chapters, scenes);
  const to = ending(t, chapters, scenes);
  const stale = staleWarning(t, chapters, scenes);
  const early = endsBeforeOrigin(t, chapters, scenes);

  const head = (
    <>
      <span className="thread-top">
        <span className="thread-kind">{THREAD_KIND_LABEL[t.kind]}</span>
        <span className="thread-origin">{from ? from.short : 'Sem lugar'}</span>
      </span>
      <span className="thread-title">{t.title}</span>
      {t.note && <span className="thread-note">{t.note}</span>}
    </>
  );

  return (
    <article className={`thread-card kind-${t.kind} is-${t.status} ${highlight ? 'is-highlight' : ''} ${compact ? 'is-compact' : ''}`}>
      {onToggle ? (
        <button className="thread-head" aria-expanded={open} onClick={onToggle}>
          {head}
        </button>
      ) : (
        <div className="thread-head">{head}</div>
      )}

      {open && (
        <div className="thread-body">
          {!compact && from && (
            <p className="thread-line">
              Surgiu em <PlaceRef storyId={t.storyId} p={from}>{from.long}</PlaceRef>
            </p>
          )}
          {t.status === 'resolvido' && (
            <p className="thread-line is-end">
              <Icon name="check" size={14} />
              <span>
                Resolvido {to ? <>em <PlaceRef storyId={t.storyId} p={to}>{to.long}</PlaceRef></> : ''}
                {t.endNote && <span className="thread-end-note">{t.endNote}</span>}
              </span>
            </p>
          )}
          {t.status === 'abandonado' && (
            <p className="thread-line is-end">
              <Icon name="close" size={14} />
              <span>
                Abandonado de propósito
                {t.endNote && <span className="thread-end-note">{t.endNote}</span>}
              </span>
            </p>
          )}
          {stale && (
            <p className="thread-alert">
              <Icon name="alert" size={14} />
              {stale}
            </p>
          )}
          {early && (
            <p className="thread-alert">
              <Icon name="alert" size={14} />
              Resolvido numa cena anterior à de origem.
            </p>
          )}

          <div className="thread-actions">
            {t.status === 'aberto' ? (
              <>
                <button className="btn btn-primary btn-sm" onClick={() => onAction(t, 'resolvido')}>
                  {compact ? 'Resolvido nesta cena' : 'Marcar como resolvido'}
                </button>
                <button className="btn btn-outline btn-sm" onClick={() => onAction(t, 'abandonado')}>
                  Abandonar de propósito
                </button>
              </>
            ) : (
              <button className="btn btn-outline btn-sm" onClick={() => reopenThread(t.id)}>
                <Icon name="undo" size={14} />
                Reabrir
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => onAction(t, 'editar')}>
              <Icon name="edit" size={14} />
              Editar
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
