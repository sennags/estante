import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { COVER_COLORS, createStory, db, STATUS_LABEL, TRASH_DAYS, trashStory, type Story, type StoryStatus } from '../db';
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
 * Unsaved form contents. Closing the dialog keeps them, for a new story and
 * for edits to an existing one, until the user saves or clears them. Text
 * survives a reload (localStorage); a picked image only lives for this tab.
 */
type Fields = { title: string; synopsis: string; genre: string; coverColor: string; status: StoryStatus };
type Draft = Fields & { coverImage?: Blob };

const draftKey = (story?: Story) => `trama:rascunho:${story ? story.id : 'nova-historia'}`;
const draftImages = new Map<string, Blob | undefined>();

function savedFields(story?: Story): Draft {
  if (!story) return { title: '', synopsis: '', genre: '', coverColor: COVER_COLORS[0], status: 'planejamento' };
  const { title, synopsis, genre, coverColor, status, coverImage } = story;
  return { title, synopsis, genre, coverColor, status, coverImage };
}

function loadDraft(story?: Story): Draft | null {
  const key = draftKey(story);
  try {
    const raw = localStorage.getItem(key);
    if (raw) return { ...savedFields(story), ...JSON.parse(raw), coverImage: draftImages.has(key) ? draftImages.get(key) : story?.coverImage };
  } catch {
    // Unreadable storage: fall through.
  }
  return draftImages.has(key) ? { ...savedFields(story), coverImage: draftImages.get(key) } : null;
}

function storeDraft(story: Story | undefined, draft: Draft) {
  const key = draftKey(story);
  const { coverImage, ...fields } = draft;
  draftImages.set(key, coverImage);
  try {
    localStorage.setItem(key, JSON.stringify(fields));
  } catch {
    // Storage blocked: the draft still lasts while the tab is open.
  }
}

function clearDraft(story?: Story) {
  const key = draftKey(story);
  draftImages.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing stored.
  }
}

function differs(a: Draft, b: Draft) {
  return (Object.keys(a) as (keyof Draft)[]).some((k) => a[k] !== b[k]) || a.coverImage !== b.coverImage;
}

/** Creates a new story, or edits one when `story` is given. */
export function StoryDialog({ story, onClose }: Props) {
  const navigate = useNavigate();
  const [saved] = useState(() => savedFields(story));
  const [restored] = useState(() => loadDraft(story));
  const [form, setForm] = useState<Draft>(() => restored ?? saved);
  const [error, setError] = useState('');
  const [confirmTrash, setConfirmTrash] = useState(false);
  // Only true while the form still holds a draft recovered on opening.
  const [recovered, setRecovered] = useState(() => !!restored && differs(restored, saved));

  const changed = differs(form, saved);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setForm((f) => ({ ...f, [key]: value }));

  // Keep unsaved changes around; forget the draft once it matches what's saved.
  useEffect(() => {
    if (changed) storeDraft(story, form);
    else clearDraft(story);
  }, [story, form, changed]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return setError('Dê um título para a história.');
    const data = {
      title: form.title.trim(),
      synopsis: form.synopsis.trim(),
      genre: form.genre.trim(),
      coverColor: form.coverColor,
      coverImage: form.coverImage,
    };
    if (story) {
      await db.stories.update(story.id, { ...data, status: form.status, updatedAt: Date.now() });
      clearDraft(story);
      onClose();
    } else {
      const created = await createStory(data);
      clearDraft();
      navigate(`/historia/${created.id}`);
    }
  }

  function discard() {
    clearDraft(story);
    setRecovered(false);
    setForm(saved);
    setError('');
  }

  async function moveToTrash() {
    if (!story) return;
    clearDraft(story);
    await trashStory(story.id);
    navigate('/');
  }

  function pickImage(file?: File) {
    if (!file) return;
    if (!COVER_TYPES.includes(file.type)) return setError('Use uma imagem JPG, PNG ou WebP.');
    if (file.size > MAX_COVER_BYTES) return setError('A imagem precisa ter até 5 MB.');
    setError('');
    set('coverImage', file);
  }

  if (confirmTrash && story) {
    return (
      <Modal title="Mover para a lixeira?" onClose={() => setConfirmTrash(false)} locked>
        <p style={{ margin: 0, fontSize: 17, lineHeight: 1.55 }}>
          Talvez você e <strong style={{ fontWeight: 600 }}>{story.title}</strong> só precisem de um tempo… Ela vai esperar na
          lixeira por {TRASH_DAYS} dias, e depois disso some de vez.
        </p>
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setConfirmTrash(false)}>Cancelar</button>
          <button type="button" className="btn btn-dark" onClick={moveToTrash}>
            <Icon name="trash" size={16} />
            Mover para a lixeira
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={story ? 'Detalhes da história' : 'Nova história'} onClose={onClose} locked>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {recovered && changed && (
          <p className="draft-note">
            {story ? 'Recuperamos as alterações que você não salvou.' : 'Recuperamos o rascunho que você começou.'}
          </p>
        )}

        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <Cover story={form} size="md" />
          <div style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label className="field">
              <span>Título</span>
              <input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} />
            </label>
            <label className="field">
              <span>Gênero</span>
              <input className="input" value={form.genre} onChange={(e) => set('genre', e.target.value)} placeholder="Romance, fantasia, contos…" />
            </label>
          </div>
        </div>

        <label className="field">
          <span>Sinopse</span>
          <textarea className="textarea" value={form.synopsis} onChange={(e) => set('synopsis', e.target.value)} rows={3} />
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
                aria-pressed={!form.coverImage && c === form.coverColor}
                onClick={() => setForm((f) => ({ ...f, coverColor: c, coverImage: undefined }))}
                style={{ background: c }}
              />
            ))}
            <label className="btn btn-outline" aria-describedby={form.coverImage ? undefined : 'cover-hint'}>
              <Icon name="image" size={16} />
              {form.coverImage ? 'Trocar imagem' : 'Usar imagem'}
              <input
                type="file"
                accept={COVER_TYPES.join(',')}
                className="sr-only"
                onChange={(e) => {
                  pickImage(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
            {form.coverImage ? (
              <button type="button" className="btn btn-ghost" onClick={() => set('coverImage', undefined)}>
                <Icon name="close" size={16} />
                Tirar imagem
              </button>
            ) : (
              <span id="cover-hint" className="cover-hint">
                JPG, PNG ou WebP
                <br />
                até 5 MB
                <br />
                ideal 600 × 900 px
              </span>
            )}
          </div>
        </fieldset>

        {story && (
          <label className="field">
            <span>Fase</span>
            <select className="select" value={form.status} onChange={(e) => set('status', e.target.value as StoryStatus)}>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
        )}

        {error && <p role="alert" style={{ margin: 0, color: 'var(--danger)' }}>{error}</p>}

        <div className="dialog-actions">
          {story && !changed && (
            <button type="button" className="btn btn-danger" style={{ marginRight: 'auto' }} onClick={() => setConfirmTrash(true)}>
              <Icon name="trash" size={16} />
              Mover para a lixeira
            </button>
          )}
          {changed && (
            <button type="button" className="btn btn-ghost" style={{ marginRight: 'auto' }} onClick={discard}>
              {story ? 'Descartar alterações' : 'Limpar campos'}
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary">{story ? 'Salvar' : 'Criar e começar'}</button>
        </div>
      </form>
    </Modal>
  );
}
