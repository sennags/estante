import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Cover } from '../components/Cover';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { StoryText } from '../components/StoryText';
import { chapterName, formatNumber, plural } from '../lib/text';
import { markRead, useReadingProgress } from '../lib/reading';
import {
  getPublication,
  getPublishedChapter,
  usePublishedCover,
  type Publication,
  type PublishedChapter,
  type PublishedChapterInfo,
} from '../sync/community';
import { supabase } from '../sync/supabase';
import './Library.css';
import './Read.css';

type Loaded = { publication: Publication; chapters: PublishedChapterInfo[] };

/** #/ler/:pubId — a published story; #/ler/:pubId/:chapterId — one of its chapters. */
export function Read() {
  const { pubId = '', chapterId } = useParams();
  // undefined while loading; null when it is not (or no longer) published.
  const [story, setStory] = useState<Loaded | null>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!supabase) return setStory(null);
    let alive = true;
    setFailed(false);
    getPublication(pubId).then(
      (s) => alive && setStory(s),
      (err) => {
        console.error(err);
        if (alive) setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [pubId]);

  return (
    <div className="reader">
      <header className="reader-header">
        <Link to="/" className="reader-brand" aria-label="Lirismo, início">
          <Logo size={28} />
          <span className="brand-name">Lirismo</span>
        </Link>
        {story && chapterId && (
          <Link to={`/ler/${pubId}`} className="reader-crumb">
            <Icon name="back" size={16} />
            {story.publication.title}
          </Link>
        )}
      </header>
      {failed ? (
        <Gone message="Não deu para abrir a história agora. Confira a internet e recarregue a página." />
      ) : story === undefined ? null : story === null ? (
        <Gone message="Esta história não está mais publicada, ou o endereço está errado." />
      ) : chapterId ? (
        <ChapterPage story={story} chapterId={chapterId} />
      ) : (
        <StoryPage story={story} />
      )}
    </div>
  );
}

function Gone({ message }: { message: string }) {
  return (
    <main className="reader-main">
      <p className="empty">
        {message} <Link to="/">Voltar ao início</Link>
      </p>
    </main>
  );
}

const reportLink = (p: Publication, chapter?: string) =>
  `mailto:contato@lirismo.com.br?subject=${encodeURIComponent(`Denúncia: ${p.title} (${p.id}${chapter ? `, capítulo ${chapter}` : ''})`)}`;

function StoryPage({ story }: { story: Loaded }) {
  const { publication: p, chapters } = story;
  const cover = usePublishedCover(p.cover_path);
  const read = useReadingProgress()[p.id] ?? 0;
  const next = chapters.find((c) => c.position > read);
  const words = chapters.reduce((n, c) => n + c.word_count, 0);

  return (
    <main className="reader-main reader-story">
      <div className="reader-story-head">
        <Cover story={{ title: p.title, genre: p.genre, coverColor: p.cover_color, coverImage: cover }} size="lg" />
        <div className="reader-story-text">
          {p.genre && <span className="eyebrow">{p.genre}</span>}
          <h1>{p.title}</h1>
          <p className="reader-author">
            de {p.author_name || 'quem escreveu'}
            {p.profiles?.handle && <span> · @{p.profiles.handle}</span>}
          </p>
          {p.synopsis && <p className="reader-synopsis">{p.synopsis}</p>}
          <p className="reader-meta">
            {plural(chapters.length, 'capítulo publicado', 'capítulos publicados')} · {formatNumber(words)} palavras
          </p>
          {chapters.length > 0 && (
            <Link className="btn btn-primary" to={`/ler/${p.id}/${(next ?? chapters[0]).chapter_id}`}>
              {!read ? 'Começar a ler' : next ? `Continuar do ${chapterName(next.position, '').toLowerCase()}` : 'Ler de novo'}
              <Icon name="arrowRight" size={16} />
            </Link>
          )}
        </div>
      </div>

      <h2 className="reader-toc-title">Capítulos</h2>
      <ol className="reader-toc">
        {chapters.map((c) => (
          <li key={c.chapter_id}>
            <Link to={`/ler/${p.id}/${c.chapter_id}`}>
              <span className="reader-toc-n">{c.position}</span>
              <span className="reader-toc-t">{chapterName(c.position, c.title)}</span>
              {c.position <= read && <span className="reader-toc-read"><Icon name="check" size={14} /> lido</span>}
            </Link>
          </li>
        ))}
      </ol>

      <p className="reader-report">
        Algo aqui não devia estar publicado? <a href={reportLink(p)}>Denunciar</a>
      </p>
    </main>
  );
}

function ChapterPage({ story, chapterId }: { story: Loaded; chapterId: string }) {
  const { publication: p, chapters } = story;
  const [chapter, setChapter] = useState<PublishedChapter | null>();
  const index = chapters.findIndex((c) => c.chapter_id === chapterId);
  const prev = chapters[index - 1];
  const next = chapters[index + 1];

  useEffect(() => {
    let alive = true;
    setChapter(undefined);
    window.scrollTo(0, 0);
    getPublishedChapter(p.id, chapterId).then(
      (c) => {
        if (!alive) return;
        setChapter(c);
        if (c) markRead(p.id, c.position);
      },
      (err) => {
        console.error(err);
        if (alive) setChapter(null);
      },
    );
    return () => {
      alive = false;
    };
  }, [p.id, chapterId]);

  if (chapter === null) return <Gone message="Este capítulo não está mais publicado." />;
  if (!chapter) return null;

  return (
    <main className="reader-main reader-chapter">
      <article className="reader-sheet">
        <header className="reader-chapter-head">
          <span className="eyebrow">{p.title}</span>
          <h1>{chapterName(chapter.position, chapter.title)}</h1>
        </header>
        <StoryText doc={chapter.content} />
      </article>

      <nav className="reader-nav" aria-label="Capítulos">
        {prev ? (
          <Link className="btn btn-outline" to={`/ler/${p.id}/${prev.chapter_id}`}>
            <Icon name="chevronLeft" size={16} />
            Anterior
          </Link>
        ) : <span />}
        {next ? (
          <Link className="btn btn-primary" to={`/ler/${p.id}/${next.chapter_id}`}>
            Próximo: {chapterName(next.position, next.title)}
            <Icon name="chevronRight" size={16} />
          </Link>
        ) : (
          <span className="reader-end">
            Você chegou ao último capítulo publicado. <Link to={`/ler/${p.id}`}>Ver a história</Link>
          </span>
        )}
      </nav>

      <p className="reader-report">
        Algo aqui não devia estar publicado? <a href={reportLink(p, String(chapter.position))}>Denunciar</a>
      </p>
    </main>
  );
}
