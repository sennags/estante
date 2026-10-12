import { useState, type FormEvent } from 'react';
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

/** Creates a new story, or edits one when `story` is given. */
export function StoryDialog({ story, onClose }: Props) {
  const navigate = useNavigate();
  const [title, setTitle] = useState(story?.title ?? '');
  const [synopsis, setSynopsis] = useState(story?.synopsis ?? '');
  const [genre, setGenre] = useState(story?.genre ?? '');
  const [status, setStatus] = useState<StoryStatus>(story?.status ?? 'planejamento');
  const [coverColor, setCoverColor] = useState(story?.coverColor ?? COVER_COLORS[0]);
  const [coverImage, setCoverImage] = useState<Blob | undefined>(story?.coverImage);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError('Dê um título para a história.');
    const data = { title: title.trim(), synopsis: synopsis.trim(), genre: genre.trim(), coverColor, coverImage };
    if (story) {
      await db.stories.update(story.id, { ...data, status, updatedAt: Date.now() });
      onClose();
    } else {
      const created = await createStory(data);
      navigate(`/historia/${created.id}`);
    }
  }

  async function remove() {
    if (!story) return;
    if (!confirm(`Apagar "${story.title}" com todos os capítulos e fichas? Isso não pode ser desfeito.`)) return;
    await deleteStory(story.id);
    navigate('/');
  }

  function pickImage(file?: File) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return setError('Escolha um arquivo de imagem.');
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
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
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
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
            {COVER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Cor ${c}`}
                aria-pressed={!coverImage && c === coverColor}
                onClick={() => {
                  setCoverColor(c);
                  setCoverImage(undefined);
                }}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: c,
                  cursor: 'pointer',
                  border: !coverImage && c === coverColor ? '3px solid var(--ink)' : '3px solid transparent',
                  boxShadow: 'inset 0 0 0 2px var(--ground)',
                }}
              />
            ))}
            <label className="btn btn-outline" style={{ minHeight: 40 }}>
              <Icon name="image" size={16} />
              Usar imagem
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => pickImage(e.target.files?.[0])} />
            </label>
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
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary">{story ? 'Salvar' : 'Criar e começar'}</button>
        </div>
      </form>
    </Modal>
  );
}
