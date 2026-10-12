import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { db, deleteScene, moveSceneToChapter, NO_CHAPTER, SCENE_STATUS_LABEL, THREAD_KIND_LABEL, type Scene, type SceneStatus } from '../db';
import { narratorName, sceneName } from '../lib/plot';
import { chapterName } from '../lib/text';
import { useStory } from '../pages/StoryLayout';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { NarratorSelect } from './NarratorSelect';
import { ThreadDialogs, type ThreadDialogState } from './ThreadDialogs';
import './SceneDialog.css';

const STATUSES = Object.keys(SCENE_STATUS_LABEL) as SceneStatus[];

type Editable = Pick<Scene, 'title' | 'description' | 'goal' | 'conflict' | 'outcome' | 'narrator' | 'characterIds' | 'status'>;

/** Opens a scene card: everything is saved as you type. */
export function SceneDialog({ scene, onClose }: { scene: Scene; onClose: () => void }) {
  const { story, chapters, scenes, threads, entries } = useStory();
  const [draft, setDraft] = useState<Editable>(() => {
    const { title, description = '', goal, conflict, outcome, narrator, characterIds, status } = scene;
    return { title, description, goal, conflict, outcome, narrator, characterIds, status };
  });
  const [threadDialog, setThreadDialog] = useState<ThreadDialogState>();
  const dirty = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const save = () => {
    dirty.current = false;
    return db.scenes.update(scene.id, { ...draftRef.current, updatedAt: Date.now() });
  };

  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(save, 300);
    return () => clearTimeout(t);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => void (dirty.current && save()), []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Editable>(key: K, value: Editable[K]) => {
    dirty.current = true;
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const chapter = chapters.find((c) => c.id === scene.chapterId);
  const characters = entries.filter((e) => e.kind === 'personagem');
  const removed = draft.characterIds.filter((id) => !characters.some((c) => c.id === id));
  const inherited = narratorName(chapter?.narrator, entries);
  const born = threads.filter((t) => t.originSceneId === scene.id);
  const closed = threads.filter((t) => t.endSceneId === scene.id && t.status === 'resolvido');

  const toggleCharacter = (id: string) =>
    set('characterIds', draft.characterIds.includes(id) ? draft.characterIds.filter((c) => c !== id) : [...draft.characterIds, id]);

  async function remove() {
    const linked = new Set([...born, ...closed]).size;
    const warn = linked
      ? `\n\n${linked === 1 ? 'Um fio narrativo está ligado' : `${linked} fios narrativos estão ligados`} a esta cena. ${linked === 1 ? 'Ele continua' : 'Eles continuam'}, ligado${linked === 1 ? '' : 's'} só ao capítulo.`
      : '';
    if (!confirm(`Apagar a cena "${sceneName(scene, scenes)}"?${warn}`)) return;
    dirty.current = false;
    await deleteScene(scene);
    onClose();
  }

  return (
    <Modal title="Cena" onClose={onClose} wide>
      <form className="scene-form" onSubmit={(e) => e.preventDefault()}>
        <label className="sr-only" htmlFor="scene-title">Título da cena</label>
        <input
          id="scene-title"
          className="scene-title"
          value={draft.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder={sceneName({ ...scene, title: '' }, scenes)}
        />

        <label className="field">
          <span>Descrição</span>
          <textarea
            className="textarea"
            rows={2}
            value={draft.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Em poucas linhas, o que acontece nesta cena?"
          />
        </label>

        <div className="scene-row">
          <label className="field">
            <span>Capítulo</span>
            <select className="select" value={scene.chapterId} onChange={(e) => moveSceneToChapter(scene, e.target.value)}>
              <option value={NO_CHAPTER}>Guardada em Cenas</option>
              {chapters.map((c) => (
                <option key={c.id} value={c.id}>{`${c.order}. ${chapterName(c.order, c.title)}`}</option>
              ))}
            </select>
          </label>
          <fieldset className="field scene-status">
            <span>Situação</span>
            <div className="chips" role="radiogroup" aria-label="Situação da cena">
              {STATUSES.map((s) => (
                <button key={s} type="button" role="radio" aria-checked={draft.status === s} className={`chip status-chip status-${s}`} onClick={() => set('status', s)}>
                  {SCENE_STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        <label className="field">
          <span>Objetivo</span>
          <textarea className="textarea" rows={2} value={draft.goal} onChange={(e) => set('goal', e.target.value)} placeholder="O que o personagem quer nesta cena?" />
        </label>
        <label className="field">
          <span>Conflito</span>
          <textarea className="textarea" rows={2} value={draft.conflict} onChange={(e) => set('conflict', e.target.value)} placeholder="O que o impede?" />
        </label>
        <label className="field">
          <span>Resultado</span>
          <textarea className="textarea" rows={2} value={draft.outcome} onChange={(e) => set('outcome', e.target.value)} placeholder="Como a cena termina e o que muda?" />
        </label>

        <div className="field">
          <label htmlFor="scene-narrator" className="field-label">Narrador</label>
          <NarratorSelect
            id="scene-narrator"
            value={draft.narrator}
            onChange={(n) => set('narrator', n)}
            entries={entries}
            emptyLabel={chapter ? `Do capítulo: ${inherited || 'sem narrador definido'}` : 'Sem narrador definido'}
          />
        </div>

        <fieldset className="field scene-people">
          <span>Personagens na cena</span>
          {characters.length === 0 && removed.length === 0 ? (
            <p className="scene-muted">
              Nenhum personagem nas fichas ainda.{' '}
              <Link to={`/historia/${story.id}/universo`}>Criar fichas</Link>
            </p>
          ) : (
            <div className="chips">
              {characters.map((c) => (
                <button key={c.id} type="button" className="chip" aria-pressed={draft.characterIds.includes(c.id)} onClick={() => toggleCharacter(c.id)}>
                  {c.name || 'Sem nome'}
                </button>
              ))}
              {removed.map((id) => (
                <button key={id} type="button" className="chip chip-removed" onClick={() => toggleCharacter(id)} aria-label="Personagem removido. Tirar da cena">
                  Personagem removido
                  <Icon name="close" size={12} />
                </button>
              ))}
            </div>
          )}
        </fieldset>

        <section className="scene-threads" aria-label="Fios desta cena">
          <span className="field-label">Fios narrativos</span>
          {born.length + closed.length === 0 && <p className="scene-muted">Nenhum fio surgiu ou foi resolvido nesta cena.</p>}
          <ul>
            {born.map((t) => (
              <li key={t.id} className={`kind-${t.kind}`}>
                <span className="scene-thread-kind">{THREAD_KIND_LABEL[t.kind]}</span>
                <span>{t.title}</span>
                <span className="scene-thread-tag">surgiu aqui{t.status !== 'aberto' && ` · ${t.status}`}</span>
              </li>
            ))}
            {closed.map((t) => (
              <li key={`end-${t.id}`} className={`kind-${t.kind}`}>
                <span className="scene-thread-kind">{THREAD_KIND_LABEL[t.kind]}</span>
                <span>{t.title}</span>
                <span className="scene-thread-tag is-done">resolvido aqui</span>
              </li>
            ))}
          </ul>
          <div className="scene-thread-actions">
            <button
              type="button"
              className="btn btn-dashed btn-sm"
              onClick={() => setThreadDialog({ kind: 'novo', chapterId: scene.chapterId || undefined, sceneId: scene.id })}
            >
              <Icon name="plus" size={14} />
              Registrar fio nesta cena
            </button>
            <Link to={`/historia/${story.id}/fios`} className="btn btn-ghost btn-sm">Ver todos os fios</Link>
          </div>
        </section>

        <div className="dialog-actions scene-foot">
          <button type="button" className="btn btn-danger" style={{ marginRight: 'auto' }} onClick={remove}>
            <Icon name="trash" size={16} />
            Apagar cena
          </button>
          {chapter && (
            <Link to={`/historia/${story.id}/capitulo/${chapter.id}`} className="btn btn-outline">
              Abrir o capítulo
              <Icon name="arrowRight" size={16} />
            </Link>
          )}
          <button type="button" className="btn btn-primary" onClick={onClose}>Pronto</button>
        </div>
      </form>

      <ThreadDialogs storyId={story.id} state={threadDialog} onClose={() => setThreadDialog(undefined)} />
    </Modal>
  );
}
