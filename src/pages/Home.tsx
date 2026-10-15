import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, isInTrash } from '../db';
import { Cover } from '../components/Cover';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { AccountMenu } from '../components/AccountMenu';
import { useAccount } from '../components/AccountDialogs';
import { GENRES } from '../lib/genres';
import { chapterName, plural } from '../lib/text';
import { useReadingProgress } from '../lib/reading';
import { getExcerpts, listFeed, usePublishedCover, type FeedChapter, type FeedItem } from '../sync/community';
import './Library.css';
import './Home.css';

const WEEK = 7 * 24 * 60 * 60 * 1000;
/** Words a reader goes through in a minute, for "8 min". */
const WORDS_PER_MINUTE = 230;

/**
 * The Home: the community's new chapters, one line per story, and above
 * them where the author stopped writing (or, without an account, an
 * invitation to start).
 */
export function Home() {
  const account = useAccount();
  const [genre, setGenre] = useState('');
  const [feed, setFeed] = useState<FeedItem[] | null>();
  const [excerpts, setExcerpts] = useState<Map<string, string>>(new Map());
  const progress = useReadingProgress();

  useEffect(() => {
    if (!account.configured) return setFeed(null);
    let alive = true;
    setFeed(undefined);
    listFeed(genre || undefined).then(
      (items) => alive && setFeed(items),
      (err) => {
        console.error(err);
        if (alive) setFeed(null);
      },
    );
    return () => {
      alive = false;
    };
  }, [genre, account.configured]);

  const lines = useMemo(() => (feed ?? []).map((item) => storyLine(item, progress[item.id] ?? 0)), [feed, progress]);

  // The first lines of the chapter each story would open on.
  useEffect(() => {
    const wanted = lines.filter((l) => l.next && !excerpts.has(`${l.item.id}/${l.next.chapter_id}`));
    if (!wanted.length) return;
    getExcerpts(wanted.map((l) => ({ publicationId: l.item.id, chapterId: l.next!.chapter_id }))).then(
      (found) => setExcerpts((old) => new Map([...old, ...found])),
      (err) => console.error(err),
    );
  }, [lines]); // eslint-disable-line react-hooks/exhaustive-deps

  const recentWeek = lines.filter((l) => Date.now() - Date.parse(l.item.last_chapter_at) < WEEK);
  const older = lines.filter((l) => !recentWeek.includes(l));

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

        {account.configured && (
          <div className="home-genres" role="group" aria-label="Filtrar por gênero">
            <button className={`home-chip ${genre ? '' : 'is-on'}`} aria-pressed={!genre} onClick={() => setGenre('')}>Tudo</button>
            {GENRES.map((g) => (
              <button key={g} className={`home-chip ${genre === g ? 'is-on' : ''}`} aria-pressed={genre === g} onClick={() => setGenre(g)}>
                {g}
              </button>
            ))}
          </div>
        )}

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

        {recentWeek.length > 0 && <Section title="Esta semana" lines={recentWeek} excerpts={excerpts} />}
        {older.length > 0 && <Section title={recentWeek.length ? 'Antes' : 'Lançamentos'} lines={older} excerpts={excerpts} />}
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

type Line = {
  item: FeedItem;
  /** Chapters that came out this week. */
  fresh: FeedChapter[];
  /** The chapter the button opens: the next unread one, or the first. */
  next?: FeedChapter;
  read: number;
  isNew: boolean;
};

function storyLine(item: FeedItem, read: number): Line {
  const fresh = item.chapters.filter((c) => Date.now() - Date.parse(c.published_at) < WEEK);
  const next = item.chapters.find((c) => c.position > read);
  // Every chapter came out this week: the story itself is new.
  const isNew = fresh.length === item.chapters.length;
  return { item, fresh, next, read, isNew };
}

function Section({ title, lines, excerpts }: { title: string; lines: Line[]; excerpts: Map<string, string> }) {
  return (
    <section className="home-section" aria-label={title}>
      <h2 className="home-day">{title}</h2>
      <ol className="home-list">
        {lines.map((l) => (
          <StoryRow key={l.item.id} line={l} excerpt={l.next ? excerpts.get(`${l.item.id}/${l.next.chapter_id}`) : undefined} />
        ))}
      </ol>
    </section>
  );
}

function StoryRow({ line, excerpt }: { line: Line; excerpt?: string }) {
  const { item, fresh, next, read, isNew } = line;
  const cover = usePublishedCover(item.cover_path);
  const handle = item.profiles?.handle;
  const readCount = item.chapters.filter((c) => c.position <= read).length;
  const started = read > 0;
  const upToDate = started && !next;

  const pill = isNew
    ? 'história nova'
    : fresh.length > 1
      ? plural(fresh.length, 'capítulo novo', 'capítulos novos')
      : fresh.length === 1
        ? `capítulo ${fresh[0].position}`
        : null;

  const target = next ?? item.chapters[item.chapters.length - 1];
  const minutes = next ? Math.max(1, Math.round(next.word_count / WORDS_PER_MINUTE)) : 0;

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
          {handle ? `@${handle}` : item.author_name}
          {item.genre && ` · ${item.genre}`} · {plural(item.chapter_count, 'capítulo', 'capítulos')}
        </div>
        {started ? (
          <>
            <ProgressBar chapters={item.chapters} read={read} />
            <div className="home-row-meta">
              {upToDate ? 'Você está em dia' : `Você leu ${readCount} de ${plural(item.chapters.length, 'capítulo', 'capítulos')}`}
            </div>
          </>
        ) : (
          excerpt && <p className="home-excerpt">{excerpt}</p>
        )}
      </div>
      {target && (
        <Link to={`/ler/${item.id}/${target.chapter_id}`} className={`btn btn-sm ${started && next ? 'btn-primary' : 'btn-outline'} home-row-action`}>
          {upToDate ? 'Reler o último' : started ? `Ler o ${next!.position}` : 'Começar'}
          {!upToDate && minutes > 0 && <span className="home-minutes">{minutes} min</span>}
        </Link>
      )}
    </li>
  );
}

function ProgressBar({ chapters, read }: { chapters: FeedChapter[]; read: number }) {
  // Long stories get one bar, filled to the share read.
  if (chapters.length > 24) {
    const share = chapters.filter((c) => c.position <= read).length / chapters.length;
    return (
      <span className="home-progress" aria-hidden="true">
        <span className="home-progress-one"><span style={{ width: `${share * 100}%` }} /></span>
      </span>
    );
  }
  return (
    <span className="home-progress" aria-hidden="true">
      {chapters.map((c) => (
        <span key={c.chapter_id} className={c.position <= read ? 'is-read' : ''} />
      ))}
    </span>
  );
}
