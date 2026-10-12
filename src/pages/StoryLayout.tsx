import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { addChapter, db, deleteChapter, getChapters, getScenes, moveChapter, STATUS_LABEL, type Chapter, type Entry, type Scene, type Story, type Thread } from '../db';
import { Icon, type IconName } from '../components/Icon';
import { StoryDialog } from '../components/StoryDialog';
import { exportDocx, exportPdf } from '../lib/export';
import { chapterName } from '../lib/text';
import './StoryLayout.css';

type StoryCtx = {
  story: Story;
  chapters: Chapter[];
  scenes: Scene[];
  threads: Thread[];
  entries: Entry[];
  focus: boolean;
  setFocus: (on: boolean) => void;
  openMenu: () => void;
  /** The open chapter registers how to save pending text before an export. */
  setBeforeExport: (fn: (() => Promise<void>) | undefined) => void;
};

const Ctx = createContext<StoryCtx | null>(null);
export const useStory = () => useContext(Ctx)!;

export function StoryLayout() {
  const { storyId = '' } = useParams();
  const story = useLiveQuery(() => db.stories.get(storyId), [storyId], null);
  const chapters = useLiveQuery(() => getChapters(storyId), [storyId]);
  const scenes = useLiveQuery(() => getScenes(storyId), [storyId]);
  const threads = useLiveQuery(() => db.threads.where('storyId').equals(storyId).toArray(), [storyId]);
  const entries = useLiveQuery(() => db.entries.where('storyId').equals(storyId).sortBy('name'), [storyId]);
  const [focus, setFocus] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const location = useLocation();
  const beforeExport = useRef<() => Promise<void>>(undefined);
  const setBeforeExport = useCallback((fn: (() => Promise<void>) | undefined) => {
    beforeExport.current = fn;
  }, []);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  if (story === null || !chapters || !scenes || !threads || !entries) return null;
  if (!story || story.deletedAt) return <Navigate to="/" replace />;

  return (
    <Ctx.Provider value={{ story, chapters, scenes, threads, entries, focus, setFocus, openMenu: () => setMenuOpen(true), setBeforeExport }}>
      <div className={`story ${focus ? 'is-focus' : ''}`}>
        {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} />}
        <Sidebar
          story={story}
          chapters={chapters}
          openThreads={threads.filter((t) => t.status === 'aberto').length}
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          onEdit={() => setEditing(true)}
          beforeExport={() => beforeExport.current?.()}
        />
        <div className="story-main">
          <Outlet />
        </div>
      </div>
      {editing && <StoryDialog story={story} onClose={() => setEditing(false)} />}
    </Ctx.Provider>
  );
}

/** /historia/:id → the chapter edited last. */
export function StoryIndex() {
  const { story, chapters } = useStory();
  const target = chapters.find((c) => c.id === story.lastChapterId) ?? chapters[0];
  if (!target) return <EmptyStory />;
  return <Navigate to={`capitulo/${target.id}`} replace />;
}

function EmptyStory() {
  const { story } = useStory();
  const navigate = useNavigate();
  return (
    <div style={{ padding: 48 }}>
      <p className="empty">
        Esta história ainda não tem capítulos.{' '}
        <button
          className="btn btn-primary"
          onClick={async () => navigate(`/historia/${story.id}/capitulo/${(await addChapter(story.id)).id}`)}
        >
          Criar o primeiro capítulo
        </button>
      </p>
    </div>
  );
}

type SidebarProps = {
  story: Story;
  chapters: Chapter[];
  openThreads: number;
  open: boolean;
  onClose: () => void;
  onEdit: () => void;
  beforeExport: () => Promise<void> | undefined;
};

function Sidebar({ story, chapters, openThreads, open, onClose, onEdit, beforeExport }: SidebarProps) {
  const navigate = useNavigate();
  const { chapterId } = useParams();
  const [arranging, setArranging] = useState(false);

  async function newChapter() {
    const c = await addChapter(story.id);
    navigate(`/historia/${story.id}/capitulo/${c.id}`);
  }

  async function removeChapter(c: Chapter) {
    if (chapters.length === 1) return alert('A história precisa de pelo menos um capítulo.');
    const scenes = await db.scenes.where('chapterId').equals(c.id).count();
    const note = scenes ? ` ${scenes === 1 ? 'A cena dele vai' : `As ${scenes} cenas dele vão`} para "Cenas" no planejamento.` : '';
    if (!confirm(`Apagar "${chapterName(c.order, c.title)}"? O texto e as versões salvas serão perdidos.${note}`)) return;
    await deleteChapter(c);
    if (c.id === chapterId) navigate(`/historia/${story.id}`);
  }

  return (
    <nav className={`sidebar ${open ? 'is-open' : ''}`} aria-label="Áreas da história">
      <div className="sidebar-top">
        <Link to="/" className="sidebar-back">
          <Icon name="back" size={16} />
          Biblioteca
        </Link>
        <button className="icon-btn sidebar-close" aria-label="Fechar menu" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>

      <button className="sidebar-story" onClick={onEdit}>
        <span className="sidebar-title">{story.title}</span>
        <span className="sidebar-status">
          {STATUS_LABEL[story.status]} · <span style={{ textDecoration: 'underline' }}>detalhes</span>
        </span>
      </button>

      <div className="sidebar-areas">
        <Area icon="layout" label="Planejamento" to={`/historia/${story.id}/planejamento`} />
        <Area icon="users" label="Personagens e universo" to={`/historia/${story.id}/universo`} />
        <Area
          icon="thread"
          label="Fios narrativos"
          to={`/historia/${story.id}/fios`}
          count={openThreads}
          countLabel={`${openThreads} ${openThreads === 1 ? 'fio aberto' : 'fios abertos'}`}
        />
      </div>

      <div className="sidebar-chapters">
        <div className="sidebar-chapters-head">
          <span className="eyebrow">Capítulos</span>
          <button className="sidebar-link" onClick={() => setArranging((a) => !a)} aria-pressed={arranging}>
            {arranging ? 'Pronto' : 'Organizar'}
          </button>
        </div>
        <ol>
          {chapters.map((c, i) => (
            <li key={c.id}>
              <NavLink to={`/historia/${story.id}/capitulo/${c.id}`} className="chapter-link">
                <span className="chapter-n">{c.order}</span>
                <span className="chapter-t">{chapterName(c.order, c.title)}</span>
              </NavLink>
              {arranging && (
                <span className="chapter-tools">
                  <button className="icon-btn" aria-label="Mover para cima" disabled={i === 0} onClick={() => moveChapter(c, -1)}>
                    <Icon name="up" size={16} />
                  </button>
                  <button className="icon-btn" aria-label="Mover para baixo" disabled={i === chapters.length - 1} onClick={() => moveChapter(c, 1)}>
                    <Icon name="down" size={16} />
                  </button>
                  <button className="icon-btn" aria-label="Apagar capítulo" onClick={() => removeChapter(c)}>
                    <Icon name="trash" size={16} />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ol>
        <button className="btn btn-dashed" onClick={newChapter} style={{ marginTop: 8 }}>
          <Icon name="plus" size={16} />
          Novo capítulo
        </button>
      </div>

      <ExportMenu story={story} beforeExport={beforeExport} />
    </nav>
  );
}

type AreaProps = { icon: IconName; label: string; to: string; count?: number; countLabel?: string };

function Area({ icon, label, to, count, countLabel }: AreaProps) {
  return (
    <NavLink to={to} className="area">
      <Icon name={icon} size={18} />
      {label}
      {!!count && (
        <span className="area-count" aria-label={countLabel}>
          {count}
        </span>
      )}
    </NavLink>
  );
}

function ExportMenu({ story, beforeExport }: { story: Story; beforeExport: () => Promise<void> | undefined }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(kind: 'docx' | 'pdf') {
    setOpen(false);
    setBusy(true);
    try {
      await beforeExport();
      const all = await getChapters(story.id);
      await (kind === 'docx' ? exportDocx(story, all) : exportPdf(story, all));
    } catch (err) {
      console.error(err);
      alert('Não foi possível exportar. Tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sidebar-export">
      <button className="btn btn-outline" aria-expanded={open} disabled={busy} onClick={() => setOpen((o) => !o)}>
        <Icon name="download" size={16} />
        {busy ? 'Exportando…' : 'Exportar história'}
        <span className="sidebar-export-chevron"><Icon name={open ? 'chevronUp' : 'chevronDown'} size={16} /></span>
      </button>
      {open && (
        <div className="sidebar-export-options">
          <button onClick={() => run('docx')}>
            <Icon name="file" size={16} />
            Word (.docx)
          </button>
          <button onClick={() => run('pdf')}>
            <Icon name="file" size={16} />
            PDF
          </button>
        </div>
      )}
    </div>
  );
}
