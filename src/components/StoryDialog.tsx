import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { COVER_COLORS, createStory, db, deleteStory, STATUS_LABEL, type Story, type StoryStatus } from '../db';
import { Cover } from './Cover';
import { Icon } from './Icon';
import { Modal } from './Modal';

type Props = {
  story?: Story;
  onClose: () => void;
};

const MAX_COVER_BYTES = 5 * 1024 * 1024;
const COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Unfinished "new story" form. Closing the dialog keeps it, so clicking
 * outside by accident loses nothing. Text survives a reload (localStorage);
 * the cover image only lives for this tab.
 */
type Draft = { title: string; synopsis: string; genre: string; coverColor: string };
const DRAFT_KEY = 'trama:rascunho-historia';
let draftImage: Blob | undefined;

function loadDraft(): Draft {
  const empty = { title: '', synopsis: '', genre: '', coverColor: COVER_COLORS[0] };
  try {
    return { ...empty, ...JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}') };
  } catch {
    return empty;
  }
}

function storeDraft(draft: Draft, image?: Blob) {
  draftImage = image;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Storage blocked: the draft still lasts while the tab is open.
  }
}

function clearDraft() {
  draftImage = undefined;
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing stored.
  }
}

/** Creates a new story, or edits one when `story` is given. */
export function StoryDialog({ story, onClose }: Props) {
  const navigate = useNavigate();
  const [initial] = useState(() => story ?? { ...loadDraft(), coverImage: draftImage });
  const [title, setTitle] = useState(initial.title);
  const [synopsis, setSynopsis] = useState(initial.synopsis);
  const [genre, setGenre] = useState(initial.genre);
  const [status, setStatus] = useState<StoryStatus>(story?.status ?? 'planejamento');
  const [coverColor, setCoverColor] = useState(initial.coverColor);
  const [coverImage, setCoverImage] = useState<Blob | undefined>(initial.coverImage);
  const [error, setError] = useState('');

  const hasDraft = !story && !!(title || synopsis || genre || coverImage);

  useEffect(() => {
    if (!story) storeDraft({ title, synopsis, genre, coverColor }, coverImage);
  }, [story, title, synopsis, genre, coverColor, coverImage]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError('Dê um título para a história.');
    const data = { title: title.trim(), synopsis: synopsis.trim(), genre: genre.trim(), coverColor, coverImage };
    if (story) {
      await db.stories.update(story.id, { ...data, status, updatedAt: Date.now() });
      onClose();
    } else {
      const created = await createStory(data);
      clearDraft();
      navigate(`/historia/${created.id}`);
    }
  }

  function discardDraft() {
    setTitle('');
    setSynopsis('');
    setGenre('');
    setCoverColor(COVER_COLORS[0]);
    setCoverImage(undefined);
    setError('');
  }

  async function remove() {
    if (!story) return;
    if (!confirm(`Apagar "${story.title}" com todos os capítulos e fichas? Isso não pode ser desfeito.`)) return;
    await deleteStory(story.id);
    navigate('/');
  }

  function pickImage(file?: File) {
    if (!file) return;
    if (!COVER_TYPES.includes(file.type)) return setError('Use uma imagem JPG, PNG ou WebP.');
    if (file.size > MAX_COVER_BYTES) return setError('A imagem precisa ter até 5 MB.');
    setError('');
    setCoverImage(file);
  }

  return (
    <Modal title={story ? 'Detalhes da história' : 'Nova história'} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <Cover story={{ title, genre, coverColor, coverImage }} size="md" />
          <div style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label className="field">
              <span>Título</span>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="field">
              <span>Gênero</span>
              <input className="input" value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="Romance, fantasia, contos…" />
            </label>
          </div>
        </div>

        <label className="field">
          <span>Sinopse</span>
          <textarea className="textarea" value={synopsis} onChange={(e) => setSynopsis(e.target.value)} rows={3} />
        </label>

        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <span>Capa</span>
          <div className="cover-picker">
            {COVER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className="swatch"
                aria-label={`Cor ${c}`}
                aria-pressed={!coverImage && c === coverColor}
                onClick={() => {
                  setCoverColor(c);
                  setCoverImage(undefined);
                }}
                style={{ background: c }}
              />
            ))}
            <label className="btn btn-outline" style={{ minHeight: 40 }} aria-describedby="cover-hint">
              <Icon name="image" size={16} />
              {coverImage ? 'Trocar imagem' : 'Usar imagem'}
              <input type="file" accept={COVER_TYPES.join(',')} className="sr-only" onChange={(e) => pickImage(e.target.files?.[0])} />
            </label>
            <span id="cover-hint" className="cover-hint">
              JPG, PNG ou WebP
              <br />
              até 5 MB
              <br />
              ideal 600 × 900 px
            </span>
          </div>
        </fieldset>

        {story && (
          <label className="field">
            <span>Fase</span>
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value as StoryStatus)}>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
        )}

        {error && <p role="alert" style={{ margin: 0, color: 'var(--danger)' }}>{error}</p>}

        <div className="dialog-actions">
          {story && (
            <button type="button" className="btn btn-danger" style={{ marginRight: 'auto' }} onClick={remove}>
              <Icon name="trash" size={16} />
              Apagar história
            </button>
          )}
          {hasDraft && (
            <button type="button" className="btn btn-ghost" style={{ marginRight: 'auto' }} onClick={discardDraft}>
              Limpar campos
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>{story ? 'Cancelar' : 'Fechar'}</button>
          <button type="submit" className="btn btn-primary">{story ? 'Salvar' : 'Criar e começar'}</button>
        </div>
      </form>
    </Modal>
  );
}
