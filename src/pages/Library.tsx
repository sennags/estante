import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, isInTrash, STATUS_LABEL, storyStatus, type Story, type StoryStatus } from '../db';
import { Cover } from '../components/Cover';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { StoryDialog } from '../components/StoryDialog';
import { AccountMenu } from '../components/AccountMenu';
import { OldAddressNotice } from '../components/OldAddressNotice';
import { chapterName, formatNumber, plural, relativeTime } from '../lib/text';
import './Library.css';
import './Trash.css';

const SHELVES: StoryStatus[] = ['escrita', 'revisao', 'feito'];

export function Library() {
  const all = useLiveQuery(() => db.stories.orderBy('updatedAt').reverse().toArray(), []);
  const chapters = useLiveQuery(() => db.chapters.toArray(), []);
  const scenes = useLiveQuery(() => db.scenes.toArray(), []);
  const openThreads = useLiveQuery(() => db.threads.where('status').equals('aberto').toArray(), []);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);

  if (!all || !chapters || !scenes || !openThreads) return null;
  const stories = all.filter((s) => !isInTrash(s));
  const trashed = all.length - stories.length;

  const stats = (s: Story) => {
    const own = chapters.filter((c) => c.storyId === s.id);
    return {
      count: own.length,
      words: own.reduce((n, c) => n + c.wordCount, 0),
      scenes: scenes.filter((x) => x.storyId === s.id).length,
    };
  };

  const q = query.trim().toLowerCase();
  const visible = q
    ? stories.filter((s) => [s.title, s.genre, s.synopsis].some((t) => t.toLowerCase().includes(q)))
    : stories;

  const recent = stories[0];
  const recentChapter = recent && chapters.find((c) => c.id === recent.lastChapterId);
  const recentThreads = recent ? openThreads.filter((t) => t.storyId === recent.id).length : 0;

  return (
    <div className="library">
      <header className="library-header">
        <Link to="/" className="brand" style={{ color: 'inherit', textDecoration: 'none' }} title="Início">
          <Logo size={34} />
          <span className="brand-name">Lirismo</span>
        </Link>
        <div className="library-actions">
          <label className="search">
            <Icon name="search" size={16} />
            <span className="sr-only">Buscar histórias</span>
            <input type="search" placeholder="Buscar na estante" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <Link to="/lixeira" className="icon-btn trash-link" aria-label={trashed ? `Lixeira, ${trashed} na lixeira` : 'Lixeira'} title="Lixeira">
            <Icon name="trash" size={20} stroke={1.8} />
            {trashed > 0 && <span className="trash-count" aria-hidden="true">{trashed}</span>}
          </Link>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={16} />
            Nova história
          </button>
          <AccountMenu />
        </div>
      </header>

      <main className="library-main">
        <OldAddressNotice stories={stories.length} />

        {stories.length === 0 && (
          <section className="welcome">
            <h1>Sua estante está vazia</h1>
            <p>O Lirismo é um lugar para planejar e escrever suas histórias: capítulos, personagens, cenas e os fios que você não pode esquecer.</p>
            <p>Comece uma história: dê um título, escolha uma capa e vá direto para a primeira folha.</p>
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Icon name="plus" size={16} />
              Criar a primeira história
            </button>
          </section>
        )}

        {recent && recentChapter && !q && (
          <section className="continue" aria-labelledby="continue-label">
            <Cover story={recent} size="sm" />
            <div className="continue-text">
              <span id="continue-label" className="eyebrow">Continuar escrevendo</span>
              <h1>{recent.title}</h1>
              <p>
                {chapterName(recentChapter.order, recentChapter.title)} · editado {relativeTime(recent.updatedAt)}
              </p>
              {recentThreads > 0 && (
                <Link to={`/historia/${recent.id}/fios`} className="continue-threads">
                  <span className="continue-dot" aria-hidden="true" />
                  {plural(recentThreads, 'fio narrativo em aberto', 'fios narrativos em aberto')}
                </Link>
              )}
            </div>
            <Link className="btn btn-dark" to={`/historia/${recent.id}/capitulo/${recentChapter.id}`}>
              Abrir a folha
              <Icon name="arrowRight" size={16} />
            </Link>
          </section>
        )}

        {stories.length > 0 &&
          SHELVES.map((status) => {
            const books = visible.filter((s) => storyStatus(s) === status);
            if (q && !books.length) return null;
            return (
              <section key={status} className="shelf" aria-label={STATUS_LABEL[status]}>
                <div className="shelf-head">
                  <h2>{STATUS_LABEL[status]}</h2>
                  <span>{plural(books.length, 'história', 'histórias')}</span>
                </div>
                <div className="shelf-row">
                  {books.map((s) => {
                    const { count, words, scenes: sceneCount } = stats(s);
                    return (
                      <Link key={s.id} to={`/historia/${s.id}`} className="book" title={s.synopsis || s.title}>
                        <span className="book-stand"><Cover story={s} /></span>
                        <span className="book-meta">
                          <span className="book-title">{s.title}</span>
                          <span className="book-sub">
                            {plural(count, 'capítulo', 'capítulos')} ·{' '}
                            {!words && sceneCount ? plural(sceneCount, 'cena', 'cenas') : `${formatNumber(words)} palavras`}
                          </span>
                        </span>
                      </Link>
                    );
                  })}
                  {!q && (
                    <span className="book">
                      <span className="book-stand">
                        <button className="book-new" onClick={() => setCreating(true)}>
                          <Icon name="plus" size={20} stroke={1.8} />
                          Nova história
                        </button>
                      </span>
                    </span>
                  )}
                </div>
              </section>
            );
          })}

        {q && visible.length === 0 && <p className="empty">Nenhuma história encontrada para “{query}”.</p>}
      </main>

      <footer className="library-footer">
        <a href="privacidade.html">Política de Privacidade</a>
        <a href="termos.html">Termos de Serviço</a>
      </footer>

      {creating && <StoryDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
