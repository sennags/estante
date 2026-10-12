import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  addChapter,
  createScene,
  db,
  NO_CHAPTER,
  placeScenes,
  reorderChapters,
  SCENE_STATUS_LABEL,
  type Chapter,
  type Narrator,
  type Scene,
} from '../db';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { NarratorSelect } from '../components/NarratorSelect';
import { SceneDialog } from '../components/SceneDialog';
import { initials, narratorName, sceneName } from '../lib/plot';
import { chapterLabel, chapterName, plural } from '../lib/text';
import { useStory } from './StoryLayout';
import './Planning.css';

/** Column ids carry a prefix so they never clash with scene ids. */
const colId = (chapterId: string) => `col:${chapterId}`;
const fromColId = (id: UniqueIdentifier) => String(id).slice(4);
const isCol = (id: UniqueIdentifier) => String(id).startsWith('col:');

type Columns = Record<string, string[]>;

function useNarrow() {
  const query = '(max-width: 900px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

export function Planning() {
  const { story, chapters, scenes, threads, entries, openMenu } = useStory();
  const [params, setParams] = useSearchParams();
  const narrow = useNarrow();
  const [current, setCurrent] = useState<string>();
  const [narratorFor, setNarratorFor] = useState<Chapter>();

  const openScene = scenes.find((s) => s.id === params.get('cena'));
  const showScene = (id?: string) => setParams(id ? { cena: id } : {}, { replace: !id });

  // Board as stored, and the copy that moves around while dragging.
  const stored = useMemo(() => {
    const cols: Columns = Object.fromEntries(chapters.map((c) => [c.id, [] as string[]]));
    const loose: string[] = [];
    for (const s of scenes) (cols[s.chapterId] ?? loose).push(s.id);
    if (loose.length) cols[NO_CHAPTER] = loose;
    return cols;
  }, [chapters, scenes]);
  const [dragCols, setDragCols] = useState<Columns | null>(null);
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const [active, setActive] = useState<{ id: string; type: 'scene' | 'column' }>();
  const columns = dragCols ?? stored;
  const order = dragOrder ?? chapters.map((c) => c.id);

  // Drop the local copy once the database has caught up.
  useEffect(() => {
    if (!active) {
      setDragCols(null);
      setDragOrder(null);
    }
  }, [scenes, chapters]); // eslint-disable-line react-hooks/exhaustive-deps

  // A click that ends a drag should not open the card.
  const lastDrop = useRef(0);

  const keys = [...order, ...(columns[NO_CHAPTER] ? [NO_CHAPTER] : [])];
  const shown = current !== undefined && keys.includes(current) ? current : (openScene?.chapterId ?? keys[0]);

  // Following a link to a scene shows its chapter on the phone.
  useEffect(() => {
    if (openScene) setCurrent(openScene.chapterId);
  }, [openScene?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const containerOf = (id: UniqueIdentifier, cols: Columns) =>
    isCol(id) ? fromColId(id) : Object.keys(cols).find((k) => cols[k].includes(String(id)));

  const collision: CollisionDetection = (args) => {
    if (args.active.data.current?.type === 'column') {
      return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => c.data.current?.type === 'column' && !c.data.current.fixed) });
    }
    const hits = pointerWithin(args);
    const found = hits.length ? hits : rectIntersection(args);
    const card = found.find((h) => !isCol(h.id) && h.id !== args.active.id);
    return card ? [card] : found.filter((h) => isCol(h.id)).slice(0, 1);
  };

  function onDragStart(e: DragStartEvent) {
    const type = e.active.data.current?.type === 'column' ? 'column' : 'scene';
    setActive({ id: String(e.active.id), type });
    if (type === 'scene') setDragCols(structuredClone(stored));
    else setDragOrder(chapters.map((c) => c.id));
  }

  function onDragOver({ active: a, over }: DragOverEvent) {
    if (!over || a.data.current?.type === 'column') return;
    setDragCols((cols) => {
      if (!cols) return cols;
      const from = containerOf(a.id, cols);
      const to = containerOf(over.id, cols);
      if (from === undefined || to === undefined || from === to) return cols;
      const target = cols[to];
      const at = isCol(over.id) ? target.length : Math.max(0, target.indexOf(String(over.id)));
      return {
        ...cols,
        [from]: cols[from].filter((id) => id !== a.id),
        [to]: [...target.slice(0, at), String(a.id), ...target.slice(at)],
      };
    });
  }

  async function onDragEnd({ active: a, over }: DragEndEvent) {
    lastDrop.current = Date.now();
    setActive(undefined);
    if (a.data.current?.type === 'column') {
      if (over && over.id !== a.id && dragOrder) {
        const next = arrayMove(dragOrder, dragOrder.indexOf(fromColId(a.id)), dragOrder.indexOf(fromColId(over.id)));
        setDragOrder(next);
        await reorderChapters(next);
      } else setDragOrder(null);
      return;
    }
    if (!dragCols) return;
    let cols = dragCols;
    const to = over ? containerOf(over.id, cols) : undefined;
    if (over && to !== undefined && !isCol(over.id)) {
      const list = cols[to];
      const fromIndex = list.indexOf(String(a.id));
      const toIndex = list.indexOf(String(over.id));
      if (fromIndex >= 0 && toIndex >= 0 && fromIndex !== toIndex) cols = { ...cols, [to]: arrayMove(list, fromIndex, toIndex) };
    }
    if (!over) cols = stored;
    setDragCols(cols);
    await placeScenes(Object.entries(cols).flatMap(([chapterId, ids]) => ids.map((id, i) => ({ id, chapterId, order: i + 1 }))));
  }

  const sceneTitle = (id: UniqueIdentifier) => {
    const s = scenes.find((x) => x.id === id);
    return s ? sceneName(s, scenes) : 'cena';
  };
  const columnTitle = (id: UniqueIdentifier) => {
    const key = isCol(id) ? fromColId(id) : containerOf(id, columns);
    const c = chapters.find((x) => x.id === key);
    return c ? chapterName(c.order, c.title) : 'Cenas sem capítulo';
  };
  const announcements: Announcements = {
    onDragStart: ({ active: a }) => (isCol(a.id) ? `Movendo o capítulo ${columnTitle(a.id)}.` : `Movendo a cena ${sceneTitle(a.id)}.`),
    onDragOver: ({ active: a, over }) => (over ? `${isCol(a.id) ? 'Capítulo' : 'Cena'} sobre ${isCol(over.id) ? columnTitle(over.id) : sceneTitle(over.id)}.` : undefined),
    onDragEnd: ({ active: a, over }) => (over ? `Solto em ${columnTitle(over.id)}.` : `${isCol(a.id) ? 'Capítulo' : 'Cena'} solto.`),
    onDragCancel: () => 'Movimento cancelado.',
  };

  async function newScene(chapterId: string) {
    const s = await createScene(story.id, chapterId);
    showScene(s.id);
  }

  async function newChapter() {
    const c = await addChapter(story.id);
    setCurrent(c.id);
  }

  const activeScene = active?.type === 'scene' ? scenes.find((s) => s.id === active.id) : undefined;
  const activeChapter = active?.type === 'column' ? chapters.find((c) => colId(c.id) === active.id) : undefined;

  const columnProps = (chapterId: string) => ({
    sceneIds: columns[chapterId] ?? [],
    onNewScene: () => newScene(chapterId),
    renderCard: (id: string) => {
      const s = scenes.find((x) => x.id === id);
      return s ? (
        <SortableScene key={id} scene={s} onOpen={() => Date.now() - lastDrop.current > 250 && showScene(id)} />
      ) : null;
    },
  });

  return (
    <div className="planning">
      <div className="planning-head">
        <div className="page-head">
          <button className="icon-btn menu-btn" aria-label="Abrir menu da história" onClick={openMenu}>
            <Icon name="menu" />
          </button>
          <h1>Planejamento</h1>
        </div>
        <p className="page-intro">
          Cada capítulo é uma coluna e cada cena é um cartão. Arraste os cartões para mudar a ordem ou o capítulo
          {narrow ? '' : ', e as colunas para reordenar os capítulos'}.
        </p>
      </div>

      {narrow && (
        <ChapterTabs
          keys={keys}
          chapters={chapters}
          current={shown}
          onPick={setCurrent}
          counts={Object.fromEntries(keys.map((k) => [k, columns[k]?.length ?? 0]))}
        />
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setActive(undefined);
          setDragCols(null);
          setDragOrder(null);
        }}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable: 'Para mover, aperte espaço ou Enter. Use as setas para escolher o lugar, espaço ou Enter para soltar e Esc para cancelar.',
          },
        }}
      >
        <div className={`board ${narrow ? 'is-single' : ''}`}>
          <SortableContext items={order.map(colId)} strategy={horizontalListSortingStrategy}>
            {order.map((id) => {
              const chapter = chapters.find((c) => c.id === id);
              if (!chapter) return null;
              return (
                <SortableColumn
                  key={id}
                  chapter={chapter}
                  hidden={narrow && shown !== id}
                  draggable={!narrow}
                  narrator={narratorName(chapter.narrator, entries)}
                  openThreads={threads.filter((t) => t.status === 'aberto' && (t.originChapterId === id || scenes.some((s) => s.id === t.originSceneId && s.chapterId === id))).length}
                  onNarrator={() => setNarratorFor(chapter)}
                  {...columnProps(id)}
                />
              );
            })}
          </SortableContext>
          {columns[NO_CHAPTER] && <LooseColumn hidden={narrow && shown !== NO_CHAPTER} {...columnProps(NO_CHAPTER)} onNewScene={undefined} />}
          {!narrow && (
            <button className="board-add" onClick={newChapter}>
              <Icon name="plus" size={18} />
              Novo capítulo
            </button>
          )}
        </div>

        <DragOverlay>
          {activeScene && <SceneCard scene={activeScene} overlay />}
          {activeChapter && (
            <div className="column is-overlay">
              <ColumnHeading chapter={activeChapter} narrator={narratorName(activeChapter.narrator, entries)} count={columns[activeChapter.id]?.length ?? 0} />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {narrow && (
        <button className="btn btn-dashed planning-new-chapter" onClick={newChapter}>
          <Icon name="plus" size={16} />
          Novo capítulo
        </button>
      )}

      {openScene && <SceneDialog key={openScene.id} scene={openScene} onClose={() => showScene()} />}
      {narratorFor && <ChapterNarratorDialog chapter={narratorFor} onClose={() => setNarratorFor(undefined)} />}
    </div>
  );
}

type ColumnBodyProps = {
  sceneIds: string[];
  renderCard: (id: string) => ReactNode;
  /** Missing on the loose column: new scenes always start in a chapter. */
  onNewScene?: () => void;
};

function ColumnBody({ sceneIds, renderCard, onNewScene, label }: ColumnBodyProps & { label: string }) {
  return (
    <>
      <SortableContext items={sceneIds} strategy={verticalListSortingStrategy}>
        <ol className="column-cards" aria-label={`Cenas de ${label}`}>
          {sceneIds.map(renderCard)}
        </ol>
      </SortableContext>
      {sceneIds.length === 0 && <p className="column-empty">Nenhuma cena ainda.</p>}
      {onNewScene && (
        <button className="btn btn-dashed column-add" onClick={onNewScene}>
          <Icon name="plus" size={16} />
          Nova cena
        </button>
      )}
    </>
  );
}

type SortableColumnProps = ColumnBodyProps & {
  chapter: Chapter;
  hidden: boolean;
  draggable: boolean;
  narrator?: string;
  openThreads: number;
  onNarrator: () => void;
};

function SortableColumn({ chapter, hidden, draggable, narrator, openThreads, onNarrator, ...body }: SortableColumnProps) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: colId(chapter.id),
    data: { type: 'column' },
    disabled: !draggable,
  });
  const name = chapterName(chapter.order, chapter.title);

  return (
    <section
      ref={setNodeRef}
      className={`column ${hidden ? 'is-hidden' : ''} ${isDragging ? 'is-dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      aria-label={name}
    >
      <ColumnHeading
        chapter={chapter}
        narrator={narrator}
        count={body.sceneIds.length}
        openThreads={openThreads}
        onNarrator={onNarrator}
        handle={
          draggable && (
            <button ref={setActivatorNodeRef} className="grip column-grip" aria-label={`Mover o capítulo ${name}`} {...attributes} {...listeners}>
              <Icon name="grip" size={18} stroke={3} />
            </button>
          )
        }
      />
      <ColumnBody {...body} label={name} />
    </section>
  );
}

type HeadingProps = {
  chapter: Chapter;
  narrator?: string;
  count: number;
  openThreads?: number;
  onNarrator?: () => void;
  handle?: ReactNode;
};

function ColumnHeading({ chapter, narrator, count, openThreads, onNarrator, handle }: HeadingProps) {
  return (
    <header className="column-head">
      <div className="column-head-top">
        <span className="eyebrow">{chapterLabel(chapter.order)}</span>
        {handle}
      </div>
      <Link to={`/historia/${chapter.storyId}/capitulo/${chapter.id}`} className="column-title" title="Abrir no editor">
        {chapter.title.trim() || <span className="is-untitled">Sem título</span>}
        <Icon name="arrowRight" size={14} />
      </Link>
      <button className="column-narrator" onClick={onNarrator} disabled={!onNarrator}>
        Narrador: <strong>{narrator || 'não definido'}</strong>
      </button>
      <span className="column-meta">
        {plural(count, 'cena', 'cenas')}
        {!!openThreads && ` · ${plural(openThreads, 'fio aberto', 'fios abertos')}`}
      </span>
    </header>
  );
}

function LooseColumn({ hidden, ...body }: ColumnBodyProps & { hidden: boolean }) {
  const { setNodeRef } = useDroppable({ id: colId(NO_CHAPTER), data: { type: 'column', fixed: true } });
  return (
    <section ref={setNodeRef} className={`column is-loose ${hidden ? 'is-hidden' : ''}`} aria-label="Cenas sem capítulo">
      <header className="column-head">
        <span className="eyebrow">Sem capítulo</span>
        <span className="column-title">Cenas soltas</span>
        <span className="column-meta">Cenas de capítulos apagados. Arraste para um capítulo ou mude o capítulo na cena.</span>
      </header>
      <ColumnBody {...body} label="sem capítulo" />
    </section>
  );
}

function SortableScene({ scene, onOpen }: { scene: Scene; onOpen: () => void }) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: scene.id,
    data: { type: 'scene' },
  });
  // Mouse drags from anywhere on the card; touch and keyboard use the handle so the page still scrolls.
  const { onTouchStart, onKeyDown, ...mouse } = (listeners ?? {}) as Record<string, (e: unknown) => void>;

  return (
    <li ref={setNodeRef} className={isDragging ? 'is-dragging' : ''} style={{ transform: CSS.Translate.toString(transform), transition }} {...mouse}>
      <SceneCard
        scene={scene}
        onOpen={onOpen}
        handle={
          <button
            ref={setActivatorNodeRef}
            className="grip"
            aria-label={`Mover a cena`}
            {...attributes}
            onTouchStart={onTouchStart}
            onKeyDown={onKeyDown}
          >
            <Icon name="grip" size={18} stroke={3} />
          </button>
        }
      />
    </li>
  );
}

function SceneCard({ scene, onOpen, handle, overlay }: { scene: Scene; onOpen?: () => void; handle?: ReactNode; overlay?: boolean }) {
  const { chapters, scenes, threads, entries } = useStory();
  const chapter = chapters.find((c) => c.id === scene.chapterId);
  const own = narratorName(scene.narrator, entries);
  const inherited = narratorName(chapter?.narrator, entries);
  const people = scene.characterIds.map((id) => entries.find((e) => e.id === id)?.name ?? null);
  const born = threads.filter((t) => t.originSceneId === scene.id).length;
  const closed = threads.filter((t) => t.endSceneId === scene.id && t.status === 'resolvido').length;
  const title = sceneName(scene, scenes);

  return (
    <article className={`scene-card status-${scene.status} ${overlay ? 'is-overlay' : ''}`}>
      <div className="scene-card-top">
        <span className="scene-status-tag">{SCENE_STATUS_LABEL[scene.status]}</span>
        {handle}
      </div>
      <button className="scene-open" onClick={onOpen} aria-label={`Abrir a cena ${title}`}>
        <span className={`scene-card-title ${scene.title.trim() ? '' : 'is-untitled'}`}>{title}</span>
        {scene.goal.trim() && <span className="scene-card-goal">{scene.goal}</span>}
        {(own || inherited) && (
          <span className="scene-card-narrator">
            Narra: {own || inherited}
            {!own && <span className="scene-card-muted"> (do capítulo)</span>}
          </span>
        )}
        {(people.length > 0 || born + closed > 0) && (
          <span className="scene-card-foot">
            <span className="faces" aria-label={`Personagens: ${people.map((p) => p ?? 'personagem removido').join(', ')}`}>
              {people.slice(0, 4).map((p, i) => (
                <span key={i} className={`face ${p === null ? 'is-removed' : ''}`} title={p ?? 'Personagem removido'} aria-hidden="true">
                  {p === null ? '?' : initials(p || '?')}
                </span>
              ))}
              {people.length > 4 && <span className="face is-more" aria-hidden="true">+{people.length - 4}</span>}
            </span>
            {born + closed > 0 && (
              <span className="scene-card-threads">
                <Icon name="thread" size={14} />
                {born > 0 && <span>{plural(born, 'surgiu', 'surgiram')}</span>}
                {closed > 0 && <span>{closed === 1 ? '1 resolvido' : `${closed} resolvidos`}</span>}
              </span>
            )}
          </span>
        )}
      </button>
    </article>
  );
}

function ChapterTabs({ keys, chapters, current, onPick, counts }: { keys: string[]; chapters: Chapter[]; current?: string; onPick: (k: string) => void; counts: Record<string, number> }) {
  const i = current === undefined ? -1 : keys.indexOf(current);
  const label = (k: string) => {
    const c = chapters.find((x) => x.id === k);
    return c ? `${c.order}. ${chapterName(c.order, c.title)}` : 'Sem capítulo';
  };
  return (
    <div className="chapter-tabs">
      <button className="icon-btn" aria-label="Capítulo anterior" disabled={i <= 0} onClick={() => onPick(keys[i - 1])}>
        <Icon name="chevronLeft" />
      </button>
      <label className="sr-only" htmlFor="planning-chapter">Capítulo</label>
      <select id="planning-chapter" className="select" value={current ?? ''} onChange={(e) => onPick(e.target.value)}>
        {keys.map((k) => (
          <option key={k} value={k}>{`${label(k)} (${counts[k]})`}</option>
        ))}
      </select>
      <button className="icon-btn" aria-label="Próximo capítulo" disabled={i < 0 || i >= keys.length - 1} onClick={() => onPick(keys[i + 1])}>
        <Icon name="chevronRight" />
      </button>
    </div>
  );
}

function ChapterNarratorDialog({ chapter, onClose }: { chapter: Chapter; onClose: () => void }) {
  const { entries } = useStory();
  const [value, setValue] = useState<Narrator | undefined>(chapter.narrator);

  async function save() {
    await db.chapters.update(chapter.id, { narrator: value?.kind === 'externo' && !value.label.trim() ? undefined : value });
    onClose();
  }

  return (
    <Modal title="Narrador do capítulo" onClose={onClose}>
      <p style={{ margin: 0, color: 'var(--ink-3)' }}>
        As cenas de <strong>{chapterName(chapter.order, chapter.title)}</strong> usam este narrador, a não ser que a cena escolha outro.
      </p>
      <NarratorSelect value={value} onChange={setValue} entries={entries} emptyLabel="Sem narrador definido" />
      <div className="dialog-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" onClick={save}>Salvar</button>
      </div>
    </Modal>
  );
}
