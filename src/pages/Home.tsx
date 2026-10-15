import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, isInTrash } from '../db';
import { Cover } from '../components/Cover';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { AccountMenu } from '../components/AccountMenu';
import { useAccount } from '../components/AccountDialogs';
import { GenreSearch } from '../components/GenreSearch';
import { chapterName, plural } from '../lib/text';
import { useReadingProgress } from '../lib/reading';
import { listFeed, usePublishedCover, type FeedCursor, type FeedItem } from '../sync/community';
import './Library.css';
import './Home.css';

const WEEK = 7 * 24 * 60 * 60 * 1000;
/** Words a reader goes through in a minute, for "8 min". */
const WORDS_PER_MINUTE = 230;

/**
 * The Home: the community's new chapters, one line per story, and above
 * them where the author stopped writing (or, without an account, an
 * invitation to start). Stories come a page at a time ("Carregar mais").
 */
export function Home() {
  const account = useAccount();
  const [genre, setGenre] = useState('');
  // undefined while the first page loads; null when it failed.
  const [feed, setFeed] = useState<FeedItem[] | null>();
  const [next, setNext] = useState<FeedCursor | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  // Read when a page is asked for, without asking again when it changes:
  // reading happens on other pages, and coming back loads the Home again.
  const progress = useRef<Record<string, number>>({});
  progress.current = useReadingProgress();
  // Answers to an older request (another genre) are dropped.
  const request = useRef(0);

  useEffect(() => {
    if (!account.configured) return setFeed(null);
    const mine = ++request.current;
    setFeed(undefined);
    setNext(null);
    setMoreFailed(false);
    listFeed(genre || undefined, progress.current).then(
      (page) => {
        if (mine !== request.current) return;
        setFeed(page.items);
        setNext(page.next);
      },
      (err) => {
        console.error(err);
        if (mine === request.current) setFeed(null);
      },
    );
  }, [genre, account.configured]);

  async function loadMore() {
    if (!next || !feed) return;
    const mine = request.current;
    setLoadingMore(true);
    setMoreFailed(false);
    try {
      const page = await listFeed(genre || undefined, progress.current, next);
      if (mine !== request.current) return;
      // A story that got a new chapter meanwhile could show up twice.
      const have = new Set(feed.map((f) => f.id));
      setFeed([...feed, ...page.items.filter((f) => !have.has(f.id))]);
      setNext(page.next);
    } catch (err) {
      console.error(err);
      setMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }

  const items = feed ?? [];
  const recentWeek = items.filter((f) => Date.now() - Date.parse(f.last_chapter_at) < WEEK);
  const older = items.filter((f) => !recentWeek.includes(f));

  return (
    <div className="library home">
      <header className="library-header home-header">
        <Link to="/" className="brand">
          <Logo size={34} />
          <span className="brand-name">Lirismo</span>
        </Link>
        <div className="library-actions">
          <Link to="/biblioteca" className="btn btn-outline">
            <Icon name="book" size={16} />
            Minha biblioteca
          </Link>
          <AccountMenu />
        </div>
      </header>

      <main className="library-main home-main">
        <WritingBand signedIn={!!account.email} />

        {account.configured && <GenreSearch value={genre} onChange={setGenre} />}

        {feed === undefined && <p className="home-quiet">Buscando os lançamentos…</p>}
        {feed === null && account.configured && (
          <p className="home-quiet">Não deu para buscar os lançamentos agora. Confira a internet e recarregue a página.</p>
        )}
        {feed?.length === 0 && (
          <div className="empty home-empty">
            {genre
              ? <>Ainda não há histórias de {genre.toLowerCase()} publicadas.</>
              : <>Ninguém publicou ainda. Que tal ser a primeira história? No menu da história, use “Publicar”.</>}
          </div>
        )}

        {recentWeek.length > 0 && <Section title="Esta semana" items={recentWeek} />}
        {older.length > 0 && <Section title={recentWeek.length ? 'Antes' : 'Lançamentos'} items={older} />}

        {next && (
          <div className="home-more">
            <button className="btn btn-outline" disabled={loadingMore} onClick={loadMore}>
              {loadingMore ? 'Carregando…' : 'Carregar mais'}
            </button>
            {moreFailed && <p className="home-quiet">Não deu para carregar. Confira a internet e tente de novo.</p>}
          </div>
        )}
      </main>

      <footer className="library-footer">
        <a href="privacidade.html">Política de Privacidade</a>
        <a href="termos.html">Termos de Serviço</a>
      </footer>
    </div>
  );
}

/** Where the author stopped writing; without a story, an invitation to start one. */
function WritingBand({ signedIn }: { signedIn: boolean }) {
  const recent = useLiveQuery(async () => {
    const stories = (await db.stories.orderBy('updatedAt').reverse().toArray()).filter((s) => !isInTrash(s));
    const story = stories[0];
    const chapter = story?.lastChapterId ? await db.chapters.get(story.lastChapterId) : undefined;
    return { story, chapter };
  }, []);
  if (!recent) return <div className="home-band-space" />;

  if (recent.story && recent.chapter) {
    return (
      <Link to={`/historia/${recent.story.id}/capitulo/${recent.chapter.id}`} className="home-band">
        <Icon name="edit" size={18} />
        <span className="home-band-text">
          Você parou em <strong>{recent.story.title}</strong>, {chapterName(recent.chapter.order, recent.chapter.title).toLowerCase()}
        </span>
        <span className="home-band-action">
          Continuar
          <Icon name="arrowRight" size={16} />
        </span>
      </Link>
    );
  }
  return (
    <div className="home-band home-band-invite">
      <span className="home-band-text">
        <strong className="home-band-title">Escreva a sua também.</strong>
        Planeje, escreva e publique a sua história, um capítulo de cada vez.
      </span>
      <Link to="/biblioteca" className="home-band-action">
        {recent.story ? 'Abrir a biblioteca' : 'Começar a escrever'}
        <Icon name="arrowRight" size={16} />
      </Link>
      {!signedIn && <span className="home-band-note">Sem conta, tudo fica guardado neste aparelho. Entre para publicar.</span>}
    </div>
  );
}

function Section({ title, items }: { title: string; items: FeedItem[] }) {
  return (
    <section className="home-section" aria-label={title}>
      <h2 className="home-day">{title}</h2>
      <ol className="home-list">
        {items.map((f) => (
          <StoryRow key={f.id} item={f} />
        ))}
      </ol>
    </section>
  );
}

function StoryRow({ item }: { item: FeedItem }) {
  const cover = usePublishedCover(item.cover_path);
  const started = item.read_count > 0;
  const upToDate = started && !item.next_chapter_id;
  // Every chapter came out this week: the story itself is new.
  const isNew = item.fresh_count === item.chapter_count;

  const pill = isNew
    ? 'história nova'
    : item.fresh_count > 1
      ? plural(item.fresh_count, 'capítulo novo', 'capítulos novos')
      : item.fresh_count === 1
        ? `capítulo ${item.latest_position}`
        : null;

  const target = item.next_chapter_id ?? item.last_chapter_id;
  const minutes = item.next_word_count ? Math.max(1, Math.round(item.next_word_count / WORDS_PER_MINUTE)) : 0;

  return (
    <li className="home-row">
      <Link to={`/ler/${item.id}`} className="home-row-cover" aria-label={`${item.title}, página da história`}>
        <Cover story={{ title: item.title, genre: '', coverColor: item.cover_color, coverImage: cover }} size="xs" />
      </Link>
      <div className="home-row-body">
        <div className="home-row-head">
          <Link to={`/ler/${item.id}`} className="home-row-title">{item.title}</Link>
          {pill && <span className={`home-pill ${isNew ? 'is-new' : ''}`}>{pill}</span>}
        </div>
        <div className="home-row-meta">
          {item.handle ? `@${item.handle}` : item.author_name}
          {item.genre && ` · ${item.genre}`} · {plural(item.chapter_count, 'capítulo', 'capítulos')}
        </div>
        {started ? (
          <>
            <ProgressBar total={item.chapter_count} read={item.read_count} />
            <div className="home-row-meta">
              {upToDate ? 'Você está em dia' : `Você leu ${item.read_count} de ${plural(item.chapter_count, 'capítulo', 'capítulos')}`}
            </div>
          </>
        ) : (
          item.next_excerpt && <p className="home-excerpt">{item.next_excerpt}</p>
        )}
      </div>
      <Link to={`/ler/${item.id}/${target}`} className={`btn btn-sm ${started && !upToDate ? 'btn-primary' : 'btn-outline'} home-row-action`}>
        {upToDate ? 'Reler o último' : started ? `Ler o ${item.next_position}` : 'Começar'}
        {!upToDate && minutes > 0 && <span className="home-minutes">{minutes} min</span>}
      </Link>
    </li>
  );
}

function ProgressBar({ total, read }: { total: number; read: number }) {
  // Long stories get one bar, filled to the share read.
  if (total > 24) {
    return (
      <span className="home-progress" aria-hidden="true">
        <span className="home-progress-one"><span style={{ width: `${(read / total) * 100}%` }} /></span>
      </span>
    );
  }
  return (
    <span className="home-progress" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < read ? 'is-read' : ''} />
      ))}
    </span>
  );
}
