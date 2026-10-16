import { useEffect, useRef, useState, type ReactNode } from 'react';
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
import {
  FEED_PAGE,
  getFeatured,
  listFeed,
  listShelves,
  usePublishedCover,
  type Collection,
  type FeedCursor,
  type FeedItem,
  type Shelf,
} from '../sync/community';
import './Library.css';
import './Home.css';

/** Words a reader goes through in a minute, for "8 min". */
const WORDS_PER_MINUTE = 230;
const minutesOf = (words: number | null) => (words ? Math.max(1, Math.round(words / WORDS_PER_MINUTE)) : 0);

const COLLECTIONS: Record<Collection, { title: string; note: (n: number) => string }> = {
  curtas: { title: 'Para ler numa sentada', note: (n) => `${plural(n, 'história', 'histórias')} de até 20 min` },
  novas: { title: 'Histórias novas', note: (n) => `${plural(n, 'publicada', 'publicadas')} esta semana` },
};

/**
 * The Home: the story of the day on a banner, and below it the community's
 * stories in a mosaic of covers, newest chapter first, with blocks that open
 * a collection or a genre. Above all, where the author stopped writing (or,
 * without an account, an invitation to start). Stories come a page at a
 * time ("Carregar mais").
 */
export function Home() {
  const account = useAccount();
  const [genre, setGenre] = useState('');
  const [collection, setCollection] = useState<Collection>();
  // undefined while the first page loads; null when it failed.
  const [feed, setFeed] = useState<FeedItem[] | null>();
  const [next, setNext] = useState<FeedCursor | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [featured, setFeatured] = useState<FeedItem | null>(null);
  const [shelves, setShelves] = useState<Shelf[]>([]);
  // Read when a page is asked for, without asking again when it changes:
  // reading happens on other pages, and coming back loads the Home again.
  const progress = useRef<Record<string, number>>({});
  progress.current = useReadingProgress();
  // Answers to an older request (another filter) are dropped.
  const request = useRef(0);
  const filtered = !!genre || !!collection;

  useEffect(() => {
    if (!account.configured) return;
    // The banner and the blocks are extras: without them, the mosaic still shows.
    getFeatured(progress.current).then(setFeatured, (err) => console.error(err));
    listShelves().then(setShelves, (err) => console.error(err));
  }, [account.configured]);

  useEffect(() => {
    if (!account.configured) return setFeed(null);
    const mine = ++request.current;
    setFeed(undefined);
    setNext(null);
    setMoreFailed(false);
    listFeed({ genre, collection }, progress.current).then(
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
  }, [genre, collection, account.configured]);

  async function loadMore() {
    if (!next || !feed) return;
    const mine = request.current;
    setLoadingMore(true);
    setMoreFailed(false);
    try {
      const page = await listFeed({ genre, collection }, progress.current, next);
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

  function openShelf(shelf: Shelf) {
    if (shelf.kind === 'genero') {
      setGenre(shelf.key);
      setCollection(undefined);
    } else {
      setCollection(shelf.key as Collection);
      setGenre('');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // The banner's story is not repeated right below it.
  const showBanner = !filtered && !!featured;
  const items = (feed ?? []).filter((f) => !showBanner || f.id !== featured!.id);

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

        {showBanner && <Banner item={featured!} />}

        {account.configured && (
          <div className="home-filters">
            {collection && (
              <div className="genre-search">
                <span className="genre-search-label">Coleção:</span>
                <span className="genre-tag">
                  {COLLECTIONS[collection].title}
                  <button type="button" className="genre-tag-clear" aria-label="Tirar o filtro da coleção" onClick={() => setCollection(undefined)}>
                    <Icon name="close" size={14} />
                  </button>
                </span>
              </div>
            )}
            <GenreSearch value={genre} onChange={setGenre} />
          </div>
        )}

        {feed === undefined && <p className="home-quiet">Buscando os lançamentos…</p>}
        {feed === null && account.configured && (
          <p className="home-quiet">Não deu para buscar os lançamentos agora. Confira a internet e recarregue a página.</p>
        )}
        {feed?.length === 0 && (
          <div className="empty home-empty">
            {collection
              ? <>Nenhuma história nesta coleção{genre && <> com o gênero {genre.toLowerCase()}</>} por enquanto.</>
              : genre
                ? <>Ainda não há histórias de {genre.toLowerCase()} publicadas.</>
                : <>Ninguém publicou ainda. Que tal ser a primeira história? No menu da história, use “Publicar”.</>}
          </div>
        )}

        {items.length > 0 && <Mosaic items={items} shelves={filtered ? [] : shelves} onShelf={openShelf} />}

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

/** How far this reader got, or what is new: the little tag on a cover. */
function tagOf(item: FeedItem): { text: string; isNew?: boolean } | null {
  if (item.read_count > 0) {
    return item.next_chapter_id ? { text: `cap. ${item.next_position} de ${item.chapter_count}` } : { text: 'em dia' };
  }
  // Every chapter came out this week: the story itself is new.
  if (item.fresh_count === item.chapter_count) return { text: 'nova', isNew: true };
  if (item.fresh_count > 1) return { text: `+${item.fresh_count} capítulos` };
  if (item.fresh_count === 1) return { text: `cap. ${item.latest_position}` };
  return null;
}

/** The button that opens the next chapter (or the last one, for a reader who is up to date). */
function ReadLink({ item, className }: { item: FeedItem; className: string }) {
  const started = item.read_count > 0;
  const upToDate = started && !item.next_chapter_id;
  const minutes = minutesOf(item.next_word_count);
  return (
    <Link to={`/ler/${item.id}/${item.next_chapter_id ?? item.last_chapter_id}`} className={className}>
      {upToDate ? 'Reler o último' : started ? `Continuar no ${item.next_position}` : 'Começar'}
      {!upToDate && minutes > 0 && <span className="home-minutes">{minutes} min</span>}
    </Link>
  );
}

/** The average color of an image, from a 1 × 1 copy of it. */
async function averageColor(blob: Blob): Promise<string | undefined> {
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, 1, 1);
    bitmap.close();
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  } catch {
    return undefined;
  }
}

/**
 * The story of the day: the whole cover, never stretched, and the rest of
 * the banner in the cover's color, darkened so light letters always read.
 */
function Banner({ item }: { item: FeedItem }) {
  const cover = usePublishedCover(item.cover_path);
  const [color, setColor] = useState(item.cover_color);
  useEffect(() => {
    if (!cover) return setColor(item.cover_color);
    let alive = true;
    averageColor(cover).then((c) => alive && setColor(c ?? item.cover_color));
    return () => {
      alive = false;
    };
  }, [cover, item.cover_color]);
  const tag = tagOf(item);
  const total = minutesOf(item.total_words);

  return (
    <section className="home-banner" style={{ background: `color-mix(in srgb, ${color} 42%, #14110d)` }} aria-label="Destaque do dia">
      <Link to={`/ler/${item.id}`} className="home-banner-cover" aria-label={`${item.title}, página da história`}>
        <Cover story={{ title: item.title, genre: '', coverColor: item.cover_color, coverImage: cover }} size="fill" />
      </Link>
      <div className="home-banner-body">
        <span className="home-banner-kicker">
          Destaque do dia{tag?.isNew ? ' · história nova' : ''}{item.genre && ` · ${item.genre}`}
        </span>
        <Link to={`/ler/${item.id}`} className="home-banner-title">{item.title}</Link>
        <span className="home-banner-meta">
          {item.handle ? `@${item.handle}` : item.author_name} · {plural(item.chapter_count, 'capítulo', 'capítulos')}
          {total > 0 && ` · ${total} min`}
        </span>
        {item.next_excerpt && <p className="home-banner-excerpt">{item.next_excerpt}</p>}
        <ReadLink item={item} className="home-banner-action" />
      </div>
    </section>
  );
}

/**
 * The stories as a mosaic of covers, always in the shape of a book: in each
 * page, the one with the most new chapters this week gets a big cover. The
 * blocks of collections and genres go in between, each one once.
 */
function Mosaic({ items, shelves, onShelf }: { items: FeedItem[]; shelves: Shelf[]; onShelf: (s: Shelf) => void }) {
  const tiles: ReactNode[] = [];
  let shelf = 0;
  for (let start = 0; start < items.length; start += FEED_PAGE) {
    const page = items.slice(start, start + FEED_PAGE);
    const big = page.reduce((best, f) => (f.fresh_count > best.fresh_count ? f : best), page[0]);
    page.forEach((f, i) => {
      tiles.push(<StoryTile key={f.id} item={f} big={f === big} />);
      if ((i === 4 || i === 11) && shelf < shelves.length) {
        const s = shelves[shelf++];
        tiles.push(<ShelfTile key={`${s.kind}:${s.key}`} shelf={s} onOpen={() => onShelf(s)} />);
      }
    });
  }
  return (
    <section className="home-mosaic-wrap" aria-label="Lançamentos">
      <div className="home-mosaic">{tiles}</div>
    </section>
  );
}

function StoryTile({ item, big }: { item: FeedItem; big: boolean }) {
  const cover = usePublishedCover(item.cover_path);
  const tag = tagOf(item);
  const by = item.handle ? `@${item.handle}` : item.author_name;
  return (
    <Link
      to={`/ler/${item.id}`}
      className={`home-tile ${big ? 'is-big' : ''}`}
      aria-label={[item.title, by && `de ${by}`, tag?.text].filter(Boolean).join(', ')}
    >
      <Cover story={{ title: item.title, genre: '', coverColor: item.cover_color, coverImage: cover }} size="fill" />
      {tag && <span className={`home-tag ${tag.isNew ? 'is-new' : ''}`}>{tag.text}</span>}
      {(cover || big) && (
        <span className="home-tile-caption">
          {cover && <span className="home-tile-name">{item.title}</span>}
          {big && <span className="home-tile-by">{by}</span>}
        </span>
      )}
    </Link>
  );
}

function ShelfTile({ shelf, onOpen }: { shelf: Shelf; onOpen: () => void }) {
  const collection = shelf.kind === 'colecao' ? COLLECTIONS[shelf.key as Collection] : undefined;
  return (
    <button type="button" className={`home-shelf ${collection ? 'is-collection' : ''}`} onClick={onOpen}>
      <span className="home-shelf-title">{collection?.title ?? shelf.key}</span>
      <span className="home-shelf-note">
        {collection ? collection.note(shelf.story_count) : plural(shelf.story_count, 'história', 'histórias')}
      </span>
    </button>
  );
}
