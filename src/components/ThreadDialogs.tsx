import { useState, type FormEvent } from 'react';
import { createThread, db, NO_CHAPTER, THREAD_KIND_LABEL, updateThread, type Chapter, type Scene, type Thread, type ThreadKind } from '../db';
import { isBefore, origin, place, sceneName } from '../lib/plot';
import { chapterName } from '../lib/text';
import { useStory } from '../pages/StoryLayout';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { ask } from './Ask';
import './ThreadDialogs.css';

export const THREAD_KINDS = Object.keys(THREAD_KIND_LABEL) as ThreadKind[];

type Spot = { chapterId?: string; sceneId?: string };

type PickerProps = {
  chapters: Chapter[];
  scenes: Scene[];
  value: Spot;
  onChange: (s: Spot) => void;
  chapterLabel: string;
};

/** Chapter, then optionally one of its scenes. */
function PlacePicker({ chapters, scenes, value, onChange, chapterLabel }: PickerProps) {
  const loose = scenes.some((s) => s.chapterId === NO_CHAPTER);
  // A scene without chapter is chosen through the "Cenas" option.
  const [loosePicked, setLoosePicked] = useState(!value.chapterId && !!value.sceneId);
  const chapterValue = loosePicked ? 'solta' : (value.chapterId ?? '');
  const inChapter = scenes.filter((s) => (chapterValue === 'solta' ? s.chapterId === NO_CHAPTER : s.chapterId === value.chapterId));

  return (
    <div className="place-picker">
      <label className="field">
        <span>{chapterLabel}</span>
        <select
          className="select"
          value={chapterValue}
          onChange={(e) => {
            setLoosePicked(e.target.value === 'solta');
            onChange({ chapterId: e.target.value === 'solta' || !e.target.value ? undefined : e.target.value, sceneId: undefined });
          }}
        >
          <option value="">Escolha o capítulo</option>
          {chapters.map((c) => (
            <option key={c.id} value={c.id}>{`${c.order}. ${chapterName(c.order, c.title)}`}</option>
          ))}
          {loose && <option value="solta">Cenas (sem capítulo)</option>}
        </select>
      </label>
      <label className="field">
        <span>Cena</span>
        <select
          className="select"
          value={value.sceneId ?? ''}
          disabled={!chapterValue}
          onChange={(e) => onChange({ chapterId: value.chapterId, sceneId: e.target.value || undefined })}
        >
          <option value="">{inChapter.length ? 'Sem cena específica' : 'Este capítulo ainda não tem cenas'}</option>
          {inChapter.map((s) => (
            <option key={s.id} value={s.id}>{sceneName(s, scenes)}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

type ThreadDialogProps = {
  storyId: string;
  chapters: Chapter[];
  scenes: Scene[];
  /** Edits this thread; without it, registers a new one. */
  thread?: Thread;
  /** Where a new thread starts. */
  initial?: Spot;
  onClose: () => void;
};

export function ThreadDialog({ storyId, chapters, scenes, thread, initial, onClose }: ThreadDialogProps) {
  const [kind, setKind] = useState<ThreadKind>(thread?.kind ?? 'misterio');
  const [title, setTitle] = useState(thread?.title ?? '');
  const [note, setNote] = useState(thread?.note ?? '');
  const [spot, setSpot] = useState<Spot>(
    thread ? { chapterId: thread.originChapterId, sceneId: thread.originSceneId } : (initial ?? { chapterId: chapters[0]?.id }),
  );
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError('Dê um nome ao fio, como uma pergunta: “O que a chave abre?”.');
    if (!spot.chapterId && !spot.sceneId) return setError('Escolha o capítulo em que o fio surgiu.');
    const data = { kind, title: title.trim(), note: note.trim(), originChapterId: spot.chapterId, originSceneId: spot.sceneId };
    if (thread) await updateThread(thread.id, data);
    else await createThread({ storyId, ...data });
    onClose();
  }

  async function remove() {
    if (!thread) return;
    const ok = await ask({
      title: 'Apagar o fio?',
      message: (
        <>
          <p>O fio <strong>{thread.title}</strong> será apagado.</p>
          <p>Se ele só foi resolvido ou deixado de lado, é melhor marcar assim: o painel guarda o caminho que ele fez.</p>
        </>
      ),
      confirm: 'Apagar fio',
      danger: true,
    });
    if (!ok) return;
    await db.threads.delete(thread.id);
    onClose();
  }

  return (
    <Modal title={thread ? 'Editar fio' : 'Registrar novo fio'} onClose={onClose} locked>
      <form onSubmit={submit} className="thread-form">
        <fieldset className="field thread-kinds">
          <span>Tipo</span>
          <div className="chips" role="radiogroup" aria-label="Tipo de fio">
            {THREAD_KINDS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} className={`chip kind-chip kind-${k}`} onClick={() => setKind(k)}>
                {THREAD_KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="field">
          <span>Fio</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="O que a chave abre?" />
        </label>

        <label className="field">
          <span>Nota (opcional)</span>
          <textarea className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ana encontra a chave na gaveta da avó." />
        </label>

        <PlacePicker chapters={chapters} scenes={scenes} value={spot} onChange={setSpot} chapterLabel="Onde surgiu" />

        {error && <p role="alert" className="form-error">{error}</p>}

        <div className="dialog-actions">
          {thread && (
            <button type="button" className="btn btn-danger" style={{ marginRight: 'auto' }} onClick={remove}>
              <Icon name="trash" size={16} />
              Apagar fio
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary">{thread ? 'Salvar' : 'Registrar fio'}</button>
        </div>
      </form>
    </Modal>
  );
}

type EndDialogProps = {
  thread: Thread;
  mode: 'resolvido' | 'abandonado';
  chapters: Chapter[];
  scenes: Scene[];
  /** Chapter to start from, e.g. the one open in the editor. */
  chapterId?: string;
  onClose: () => void;
};

/** Marks a thread as resolved in a scene, or dropped on purpose with a reason. */
export function ThreadEndDialog({ thread, mode, chapters, scenes, chapterId, onClose }: EndDialogProps) {
  const start = origin(thread, chapters, scenes);
  const [spot, setSpot] = useState<Spot>(() => {
    if (thread.status === mode) return { chapterId: thread.endChapterId, sceneId: thread.endSceneId };
    return { chapterId: chapterId ?? start?.chapter?.id };
  });
  const [note, setNote] = useState(thread.status === mode ? thread.endNote : '');
  const [error, setError] = useState('');
  const resolving = mode === 'resolvido';

  const end = place(chapters, scenes, spot.sceneId, spot.chapterId);
  const early = resolving && isBefore(end, start);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (resolving && !spot.chapterId && !spot.sceneId) return setError('Escolha onde o fio foi resolvido.');
    if (!resolving && !note.trim()) return setError('Conte em poucas palavras por que este fio fica para trás.');
    await updateThread(thread.id, {
      status: mode,
      endChapterId: resolving ? spot.chapterId : undefined,
      endSceneId: resolving ? spot.sceneId : undefined,
      endNote: note.trim(),
    });
    onClose();
  }

  return (
    <Modal title={resolving ? 'Fio resolvido' : 'Abandonar de propósito'} onClose={onClose} locked>
      <form onSubmit={submit} className="thread-form">
        <p className="thread-form-lead">
          <span className="eyebrow">{THREAD_KIND_LABEL[thread.kind]}</span>
          <span className="thread-form-title">{thread.title}</span>
          {start && <span className="thread-form-origin">Surgiu em {start.long}</span>}
        </p>

        {resolving && <PlacePicker chapters={chapters} scenes={scenes} value={spot} onChange={setSpot} chapterLabel="Onde foi resolvido" />}

        {early && (
          <p className="thread-warning" role="status">
            <Icon name="alert" size={16} />
            Essa cena vem antes da cena em que o fio surgiu. Pode ser de propósito, mas vale conferir.
          </p>
        )}

        <label className="field">
          <span>{resolving ? 'Como foi resolvido (opcional)' : 'Por que fica para trás'}</span>
          <textarea
            className="textarea"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={resolving ? 'A chave abre o baú do sótão.' : 'A história mudou de rumo e esse mistério não cabe mais.'}
          />
        </label>
        {!resolving && <p className="thread-hint">Assim fica claro, para você no futuro, que não foi esquecimento.</p>}

        {error && <p role="alert" className="form-error">{error}</p>}

        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className={`btn ${resolving ? 'btn-primary' : 'btn-dark'}`}>
            {resolving ? 'Marcar como resolvido' : 'Abandonar de propósito'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export type ThreadDialogState =
  | { kind: 'novo'; chapterId?: string; sceneId?: string }
  | { kind: 'editar'; thread: Thread }
  | { kind: 'fim'; thread: Thread; mode: 'resolvido' | 'abandonado'; chapterId?: string };

/** Renders whichever thread dialog is open. */
export function ThreadDialogs({ storyId, state, onClose }: { storyId: string; state?: ThreadDialogState; onClose: () => void }) {
  const { chapters, scenes } = useStory();
  if (!state) return null;
  if (state.kind === 'fim') {
    return <ThreadEndDialog thread={state.thread} mode={state.mode} chapters={chapters} scenes={scenes} chapterId={state.chapterId} onClose={onClose} />;
  }
  return (
    <ThreadDialog
      storyId={storyId}
      chapters={chapters}
      scenes={scenes}
      thread={state.kind === 'editar' ? state.thread : undefined}
      initial={state.kind === 'novo' ? { chapterId: state.chapterId, sceneId: state.sceneId } : undefined}
      onClose={onClose}
    />
  );
}
