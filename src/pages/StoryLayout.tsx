import { createContext, useContext, useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { addChapter, db, deleteChapter, getChapters, moveChapter, STATUS_LABEL, type Chapter, type Story } from '../db';
import { Icon, type IconName } from '../components/Icon';
import { StoryDialog } from '../components/StoryDialog';
import { chapterName } from '../lib/text';
import './StoryLayout.css';

type StoryCtx = {
  story: Story;
  chapters: Chapter[];
  focus: boolean;
  setFocus: (on: boolean) => void;
  openMenu: () => void;
};

const Ctx = createContext<StoryCtx | null>(null);
export const useStory = () => useContext(Ctx)!;

export function StoryLayout() {
  const { storyId = '' } = useParams();
  const story = useLiveQuery(() => db.stories.get(storyId), [storyId], null);
  const chapters = useLiveQuery(() => getChapters(storyId), [storyId]);
  const [focus, setFocus] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const location = useLocation();

  useEffect(() => setMenuOpen(false), [location.pathname]);

  if (story === null || !chapters) return null;
  if (!story) return <Navigate to="/" replace />;

  return (
    <Ctx.Provider value={{ story, chapters, focus, setFocus, openMenu: () => setMenuOpen(true) }}>
      <div className={`story ${focus ? 'is-focus' : ''}`}>
        {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} />}
        <Sidebar
          story={story}
          chapters={chapters}
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          onEdit={() => setEditing(true)}
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
  open: boolean;
  onClose: () => void;
  onEdit: () => void;
};

function Sidebar({ story, chapters, open, onClose, onEdit }: SidebarProps) {
  const navigate = useNavigate();
  const { chapterId } = useParams();
  const [arranging, setArranging] = useState(false);

  async function newChapter() {
    const c = await addChapter(story.id);
    navigate(`/historia/${story.id}/capitulo/${c.id}`);
  }

  async function removeChapter(c: Chapter) {
    if (chapters.length === 1) return alert('A história precisa de pelo menos um capítulo.');
    if (!confirm(`Apagar "${chapterName(c.order, c.title)}"? O texto e as versões salvas serão perdidos.`)) return;
    await deleteChapter(c);
    if (c.id === chapterId) navigate(`/historia/${story.id}`);
  }

  return (
    <nav className={`sidebar ${open ? 'is-open' : ''}`} aria-label="Áreas da história">
      <div className="sidebar-top">
        <Link to="/" className="sidebar-back">
          <Icon name="back" size={16} />
          Estante
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
        <Area icon="layout" label="Planejamento" soon />
        <Area icon="users" label="Personagens e universo" to={`/historia/${story.id}/universo`} />
        <Area icon="thread" label="Fios narrativos" soon />
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
    </nav>
  );
}

function Area({ icon, label, to, soon }: { icon: IconName; label: string; to?: string; soon?: boolean }) {
  if (soon || !to) {
    return (
      <span className="area is-soon" aria-disabled="true">
        <Icon name={icon} size={18} />
        {label}
        <span className="soon">em breve</span>
      </span>
    );
  }
  return (
    <NavLink to={to} className="area">
      <Icon name={icon} size={18} />
      {label}
    </NavLink>
  );
}
