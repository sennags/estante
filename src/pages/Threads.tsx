import { useState } from 'react';
import { THREAD_KIND_LABEL, type Thread, type ThreadKind, type ThreadStatus } from '../db';
import { Icon } from '../components/Icon';
import { ThreadCard, type ThreadAction } from '../components/ThreadCard';
import { THREAD_KINDS, ThreadDialogs, type ThreadDialogState } from '../components/ThreadDialogs';
import { ending, origin, sortThreads } from '../lib/plot';
import { chapterName, formatNumber } from '../lib/text';
import { useStory } from './StoryLayout';
import './Threads.css';

const STATUS_FILTERS: { value: ThreadStatus | 'todos'; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'aberto', label: 'Abertos' },
  { value: 'resolvido', label: 'Resolvidos' },
  { value: 'abandonado', label: 'Abandonados' },
];

export function Threads() {
  const { story, chapters, scenes, threads, openMenu } = useStory();
  const [status, setStatus] = useState<ThreadStatus | 'todos'>('todos');
  const [kind, setKind] = useState<ThreadKind | 'todos'>('todos');
  const [chapterId, setChapterId] = useState('');
  const [dialog, setDialog] = useState<ThreadDialogState>();

  const count = (s: ThreadStatus) => threads.filter((t) => t.status === s).length;
  const visible = sortThreads(threads, chapters, scenes).filter(
    (t) =>
      (status === 'todos' || t.status === status) &&
      (kind === 'todos' || t.kind === kind) &&
      (!chapterId || [origin(t, chapters, scenes), ending(t, chapters, scenes)].some((p) => p?.chapter?.id === chapterId)),
  );

  const act = (thread: Thread, action: ThreadAction) =>
    setDialog(action === 'editar' ? { kind: 'editar', thread } : { kind: 'fim', thread, mode: action });

  return (
    <div className="threads">
      <div className="threads-inner">
        <div className="page-head">
          <button className="icon-btn menu-btn" aria-label="Abrir menu da história" onClick={openMenu}>
            <Icon name="menu" />
          </button>
          <h1>Fios narrativos</h1>
          <button className="btn btn-primary page-head-action" onClick={() => setDialog({ kind: 'novo', chapterId: chapters[0]?.id })}>
            <Icon name="plus" size={16} />
            <span>Registrar fio</span>
          </button>
        </div>
        <p className="page-intro">
          Mistérios, promessas e conflitos que a história abriu. Cada fio fica aberto até você dizer onde ele foi resolvido, ou
          que foi deixado de lado de propósito.
        </p>

        {threads.length > 0 && (
          <div className="threads-filters">
            <div className="chips" role="group" aria-label="Filtrar por situação">
              {STATUS_FILTERS.map((f) => (
                <button key={f.value} className="chip" aria-pressed={status === f.value} onClick={() => setStatus(f.value)}>
                  {f.label}
                  {f.value !== 'todos' && <span className="chip-count">{formatNumber(count(f.value))}</span>}
                </button>
              ))}
            </div>
            <div className="threads-filters-row">
              <label className="sr-only" htmlFor="filter-kind">Tipo</label>
              <select id="filter-kind" className="select" value={kind} onChange={(e) => setKind(e.target.value as ThreadKind | 'todos')}>
                <option value="todos">Todos os tipos</option>
                {THREAD_KINDS.map((k) => (
                  <option key={k} value={k}>{THREAD_KIND_LABEL[k]}</option>
                ))}
              </select>
              <label className="sr-only" htmlFor="filter-chapter">Capítulo</label>
              <select id="filter-chapter" className="select" value={chapterId} onChange={(e) => setChapterId(e.target.value)}>
                <option value="">Todos os capítulos</option>
                {chapters.map((c) => (
                  <option key={c.id} value={c.id}>{`${c.order}. ${chapterName(c.order, c.title)}`}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {threads.length === 0 ? (
          <div className="empty threads-empty">
            <Icon name="thread" size={28} stroke={1.6} />
            <p>
              Nenhum fio registrado ainda. Por exemplo: no capítulo 2, Ana encontra uma chave. Registre “O que a chave abre?” e o
              fio fica aberto até você indicar o destino da chave.
            </p>
            <button className="btn btn-primary" onClick={() => setDialog({ kind: 'novo', chapterId: chapters[0]?.id })}>
              <Icon name="plus" size={16} />
              Registrar o primeiro fio
            </button>
          </div>
        ) : (
          <div className="threads-list">
            {visible.length === 0 && <p className="empty">Nenhum fio com esses filtros.</p>}
            {visible.map((t) => (
              <ThreadCard key={t.id} thread={t} chapters={chapters} scenes={scenes} onAction={act} />
            ))}
          </div>
        )}
      </div>

      <ThreadDialogs storyId={story.id} state={dialog} onClose={() => setDialog(undefined)} />
    </div>
  );
}
