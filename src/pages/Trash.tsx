import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, deleteStory, purgeDate, restoreStory, TRASH_DAYS, type Story } from '../db';
import { Cover } from '../components/Cover';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import './Library.css';
import './Trash.css';

const DAY = 24 * 60 * 60 * 1000;

function timeLeft(s: Story) {
  const ms = purgeDate(s) - Date.now();
  const days = Math.ceil(ms / DAY);
  if (days > 1) return `Some em ${days} dias`;
  const hours = Math.max(1, Math.ceil(ms / (60 * 60 * 1000)));
  return hours >= 24 ? 'Some amanhã' : `Some em ${hours} ${hours === 1 ? 'hora' : 'horas'}`;
}

export function Trash() {
  const stories = useLiveQuery(() => db.stories.where('deletedAt').above(0).reverse().sortBy('deletedAt'), []);
  const [deleting, setDeleting] = useState<Story>();

  return (
    <div className="library">
      <header className="library-header">
        <Link to="/biblioteca" className="btn btn-ghost" style={{ marginLeft: -12 }}>
          <Icon name="back" size={16} />
          Biblioteca
        </Link>
      </header>

      <main className="library-main trash">
        <div className="trash-head">
          <span className="trash-icon"><Icon name="trash" size={26} stroke={1.6} /></span>
          <div>
            <h1>Lixeira</h1>
            <p>Para caso você mude de ideia… :(</p>
            <p className="trash-sub">As histórias ficam aqui por {TRASH_DAYS} dias e depois são apagadas sozinhas.</p>
          </div>
        </div>

        {stories?.length === 0 && (
          <p className="empty">Nenhuma história por aqui. Todas estão seguras na estante.</p>
        )}

        <ul className="trash-list">
          {stories?.map((s) => (
            <li key={s.id} className="trash-item">
              <Cover story={s} size="sm" />
              <div className="trash-info">
                <span className="trash-title">{s.title}</span>
                <span className="trash-left">{timeLeft(s)}</span>
              </div>
              <div className="trash-actions">
                <button className="btn btn-primary" onClick={() => restoreStory(s.id)}>Devolver à estante</button>
                <button className="btn btn-danger" onClick={() => setDeleting(s)}>
                  <Icon name="trash" size={16} />
                  Apagar agora
                </button>
              </div>
            </li>
          ))}
        </ul>
      </main>

      {deleting && (
        <Modal title="Apagar para sempre?" onClose={() => setDeleting(undefined)} locked>
          <p style={{ margin: 0, fontSize: 17, lineHeight: 1.55 }}>
            É a despedida de <strong style={{ fontWeight: 600 }}>{deleting.title}</strong>. Todos os capítulos, versões e fichas
            serão apagados, e não dá para desfazer.
          </p>
          <div className="dialog-actions">
            <button className="btn btn-ghost" onClick={() => setDeleting(undefined)}>Cancelar</button>
            <button
              className="btn btn-solid-danger"
              onClick={async () => {
                await deleteStory(deleting.id);
                setDeleting(undefined);
              }}
            >
              Apagar para sempre
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
