import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { createEntry, db, KIND_LABEL, type Entry } from '../db';
import { Icon } from './Icon';
import './ReferencePanel.css';

type Tab = 'personagens' | 'universo' | 'fios';

export function ReferencePanel({ storyId, onClose }: { storyId: string; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('personagens');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string>();
  const navigate = useNavigate();
  const entries = useLiveQuery(() => db.entries.where('storyId').equals(storyId).sortBy('name'), [storyId]);

  const q = query.trim().toLowerCase();
  const list = (entries ?? []).filter(
    (e) =>
      (tab === 'personagens' ? e.kind === 'personagem' : e.kind !== 'personagem') &&
      (!q || [e.name, e.summary, e.description].some((t) => t.toLowerCase().includes(q))),
  );

  async function newEntry() {
    const e = await createEntry(storyId, tab === 'personagens' ? 'personagem' : 'lugar');
    navigate(`/historia/${storyId}/universo/${e.id}`);
  }

  return (
    <aside className="refs" aria-label="Referências">
      <div className="refs-grip" aria-hidden="true" />
      <div className="refs-head">
        <div role="tablist" aria-label="Tipo de referência" className="refs-tabs">
          <TabButton current={tab} value="personagens" onSelect={setTab}>Personagens</TabButton>
          <TabButton current={tab} value="universo" onSelect={setTab}>Universo</TabButton>
          <TabButton current={tab} value="fios" onSelect={setTab}>Fios</TabButton>
        </div>
        <button className="icon-btn" aria-label="Fechar referências" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>

      {tab === 'fios' ? (
        <div className="empty refs-soon">
          <Icon name="thread" size={24} />
          <p>O painel de fios narrativos chega na próxima fase: mistérios, promessas e conflitos em aberto, ligados às cenas.</p>
        </div>
      ) : (
        <>
          <label className="search refs-search">
            <Icon name="search" size={16} />
            <span className="sr-only">Buscar nas fichas</span>
            <input type="search" placeholder="Buscar" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>

          <div className="refs-list">
            {entries && list.length === 0 && (
              <p className="refs-empty">
                {q ? 'Nada encontrado.' : tab === 'personagens' ? 'Nenhum personagem ainda.' : 'Nenhum lugar, objeto ou regra ainda.'}
              </p>
            )}
            {list.map((e) => (
              <RefCard key={e.id} entry={e} open={openId === e.id} onToggle={() => setOpenId(openId === e.id ? undefined : e.id)} />
            ))}
          </div>

          <button className="btn btn-dashed" onClick={newEntry}>
            <Icon name="plus" size={16} />
            {tab === 'personagens' ? 'Novo personagem' : 'Nova ficha do universo'}
          </button>
        </>
      )}
    </aside>
  );
}

function TabButton({ current, value, onSelect, children }: { current: Tab; value: Tab; onSelect: (t: Tab) => void; children: string }) {
  return (
    <button role="tab" aria-selected={current === value} className="refs-tab" onClick={() => onSelect(value)}>
      {children}
    </button>
  );
}

function RefCard({ entry, open, onToggle }: { entry: Entry; open: boolean; onToggle: () => void }) {
  const details = [
    { label: 'Descrição', text: entry.description },
    { label: 'Motivações', text: entry.motivations },
    { label: 'Relações', text: entry.relations },
  ].filter((d) => d.text.trim());

  return (
    <article className={`ref-card ${open ? 'is-open' : ''}`}>
      <button className="ref-card-head" aria-expanded={open} onClick={onToggle}>
        <span className="eyebrow">{KIND_LABEL[entry.kind].one}</span>
        <span className="ref-name">{entry.name || 'Sem nome'}</span>
        {entry.summary && <span className="ref-summary">{entry.summary}</span>}
      </button>
      {open && (
        <div className="ref-details">
          {details.length === 0 && <p className="ref-summary">Sem detalhes ainda.</p>}
          {details.map((d) => (
            <div key={d.label}>
              <span className="eyebrow">{d.label}</span>
              <p>{d.text}</p>
            </div>
          ))}
          <Link to={`/historia/${entry.storyId}/universo/${entry.id}`} className="ref-edit">
            <Icon name="edit" size={14} />
            Editar ficha
          </Link>
        </div>
      )}
    </article>
  );
}
