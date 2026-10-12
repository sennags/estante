import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { createEntry, db, KIND_LABEL, type Entry, type EntryKind } from '../db';
import { Icon } from '../components/Icon';
import { ask } from '../components/Ask';
import { useStory } from './StoryLayout';
import './Universe.css';

const KINDS = Object.keys(KIND_LABEL) as EntryKind[];

export function Universe() {
  const { story, openMenu } = useStory();
  const { entryId } = useParams();
  const navigate = useNavigate();
  const entries = useLiveQuery(() => db.entries.where('storyId').equals(story.id).sortBy('name'), [story.id]);
  const [filter, setFilter] = useState<EntryKind | 'todos'>('todos');

  const selected = entries?.find((e) => e.id === entryId);

  async function add(kind: EntryKind) {
    const e = await createEntry(story.id, kind);
    navigate(`/historia/${story.id}/universo/${e.id}`);
  }

  const visible = (entries ?? []).filter((e) => filter === 'todos' || e.kind === filter);

  return (
    <div className={`universe ${entryId ? 'has-selection' : ''}`}>
      <section className="universe-list" aria-label="Fichas">
        <div className="universe-head">
          <button className="icon-btn menu-btn" aria-label="Abrir menu da história" onClick={openMenu}>
            <Icon name="menu" />
          </button>
          <h1>Personagens e universo</h1>
        </div>
        <p className="universe-intro">Fichas de quem vive na história, onde ela acontece e as regras que o mundo segue. Elas aparecem ao lado da folha enquanto você escreve.</p>

        <div className="chips" role="group" aria-label="Filtrar fichas">
          <button className="chip" aria-pressed={filter === 'todos'} onClick={() => setFilter('todos')}>Todas</button>
          {KINDS.map((k) => (
            <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {KIND_LABEL[k].many}
            </button>
          ))}
        </div>

        <div className="universe-add">
          {KINDS.map((k) => (
            <button key={k} className="btn btn-dashed" onClick={() => add(k)}>
              <Icon name="plus" size={16} />
              {KIND_LABEL[k].one}
            </button>
          ))}
        </div>

        <ul className="entry-list">
          {entries && visible.length === 0 && <li className="empty">Nenhuma ficha aqui ainda.</li>}
          {visible.map((e) => (
            <li key={e.id}>
              <Link to={`/historia/${story.id}/universo/${e.id}`} className={`entry-item ${e.id === entryId ? 'is-current' : ''}`}>
                <span className="eyebrow">{KIND_LABEL[e.kind].one}</span>
                <span className="entry-name">{e.name || 'Sem nome'}</span>
                {e.summary && <span className="entry-summary">{e.summary}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="universe-detail" aria-label="Ficha">
        {selected ? (
          <EntryForm key={selected.id} entry={selected} onBack={() => navigate(`/historia/${story.id}/universo`)} />
        ) : (
          entries && (
            <div className="universe-placeholder">
              <Icon name="users" size={28} stroke={1.6} />
              <p>Escolha uma ficha para ver e editar, ou crie uma nova.</p>
            </div>
          )
        )}
      </section>
    </div>
  );
}

type Field = 'name' | 'summary' | 'description' | 'motivations' | 'relations';

function EntryForm({ entry, onBack }: { entry: Entry; onBack: () => void }) {
  const [draft, setDraft] = useState(entry);
  const dirty = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const isCharacter = draft.kind === 'personagem';

  // Write edits to the database shortly after typing stops; the list updates live.
  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => {
      dirty.current = false;
      db.entries.update(draft.id, { ...draft, updatedAt: Date.now() });
    }, 300);
    return () => clearTimeout(t);
  }, [draft]);

  // Flush a pending edit when switching to another entry.
  useEffect(() => () => {
    if (dirty.current) db.entries.update(draftRef.current.id, { ...draftRef.current, updatedAt: Date.now() });
  }, []);

  const set = (field: Field | 'kind') => (e: { target: { value: string } }) => {
    dirty.current = true;
    setDraft((d) => ({ ...d, [field]: e.target.value }));
  };

  async function remove() {
    const ok = await ask({
      title: 'Apagar a ficha?',
      message: <p>A ficha <strong>{draft.name || 'Sem nome'}</strong> será apagada e não poderá ser recuperada.</p>,
      confirm: 'Apagar ficha',
      danger: true,
    });
    if (!ok) return;
    dirty.current = false;
    await db.entries.delete(entry.id);
    onBack();
  }

  return (
    <form className="entry-form" onSubmit={(e) => e.preventDefault()}>
      <div className="entry-form-top">
        <button type="button" className="btn btn-ghost entry-back" onClick={onBack}>
          <Icon name="back" size={16} />
          Fichas
        </button>
        <select className="select entry-kind" value={draft.kind} onChange={set('kind')} aria-label="Tipo de ficha">
          {KINDS.map((k) => (
            <option key={k} value={k}>{KIND_LABEL[k].one}</option>
          ))}
        </select>
      </div>

      <label className="sr-only" htmlFor="entry-name">Nome</label>
      <input id="entry-name" className="entry-title" value={draft.name} onChange={set('name')} placeholder="Nome" autoFocus={!entry.name} />

      <label className="field">
        <span>Resumo em uma linha</span>
        <input className="input" value={draft.summary} onChange={set('summary')} placeholder={isCharacter ? 'Quem é, em poucas palavras' : 'O que é, em poucas palavras'} />
      </label>

      <label className="field">
        <span>{draft.kind === 'regra' ? 'Como a regra funciona' : 'Descrição'}</span>
        <textarea className="textarea" rows={5} value={draft.description} onChange={set('description')} />
      </label>

      {isCharacter && (
        <>
          <label className="field">
            <span>Motivações</span>
            <textarea className="textarea" rows={3} value={draft.motivations} onChange={set('motivations')} placeholder="O que essa pessoa quer? Do que tem medo?" />
          </label>
          <label className="field">
            <span>Relações</span>
            <textarea className="textarea" rows={3} value={draft.relations} onChange={set('relations')} placeholder="Com quem se liga e como" />
          </label>
        </>
      )}

      <div className="entry-form-foot">
        <span className="entry-saved">
          <Icon name="check" size={14} />
          Salvo automaticamente
        </span>
        <button type="button" className="btn btn-danger" onClick={remove}>
          <Icon name="trash" size={16} />
          Apagar ficha
        </button>
      </div>
    </form>
  );
}
