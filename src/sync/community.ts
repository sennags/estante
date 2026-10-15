import { useEffect, useState } from 'react';
import type { JSONContent } from '@tiptap/react';
import type { Chapter, Story } from '../db';
import { toGenre } from '../lib/genres';
import { plainText } from '../lib/text';
import { supabase } from './supabase';

/*
 * The community: stories authors chose to publish, readable by anyone, even
 * without an account (tables `publications` and `published_chapters`, in
 * supabase/schema.sql). Publishing copies the chapter: what readers see
 * changes only when the author updates it. The cover image, when there is
 * one, is a copy at covers/{user_id}/publicada-{storyId}, the only file of
 * the bucket anyone can read.
 */

export type Publication = {
  id: string;
  story_id: string;
  title: string;
  synopsis: string;
  genre: string;
  cover_color: string;
  cover_path: string | null;
  author_name: string;
  chapter_count: number;
  last_chapter_at: string;
  profiles: { handle: string } | null;
};

/** A published chapter without its text, for the table of contents. */
export type PublishedChapterInfo = {
  chapter_id: string;
  position: number;
  title: string;
  word_count: number;
  excerpt: string;
  source_updated_at: number;
  published_at: string;
};

export type PublishedChapter = PublishedChapterInfo & { content: JSONContent };

const PUBLICATION_FIELDS = 'id, story_id, title, synopsis, genre, cover_color, cover_path, author_name, chapter_count, last_chapter_at, profiles(handle)';
const CHAPTER_INFO_FIELDS = 'chapter_id, position, title, word_count, excerpt, source_updated_at, published_at';

/** The account went over the limits for published stories (supabase/schema.sql). */
export const isPublishQuota = (error: { message?: string } | null) => !!error?.message?.includes('lirismo_pub_quota');

/** The latest stories with at least one chapter, the most recently added chapter first. */
export async function listPublications(limit = 30): Promise<Publication[]> {
  const { data, error } = await supabase!
    .from('publications')
    .select(PUBLICATION_FIELDS)
    .gt('chapter_count', 0)
    .order('last_chapter_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data as unknown as Publication[];
}

/** A story and its table of contents; null when it is not (or no longer) published. */
export async function getPublication(id: string): Promise<{ publication: Publication; chapters: PublishedChapterInfo[] } | null> {
  // Not a uuid: no such story, without asking the server.
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [pub, chapters] = await Promise.all([
    supabase!.from('publications').select(PUBLICATION_FIELDS).eq('id', id).maybeSingle(),
    supabase!.from('published_chapters').select(CHAPTER_INFO_FIELDS).eq('publication_id', id).order('position'),
  ]);
  if (pub.error) throw pub.error;
  if (chapters.error) throw chapters.error;
  if (!pub.data) return null;
  return { publication: pub.data as unknown as Publication, chapters: chapters.data as PublishedChapterInfo[] };
}

export async function getPublishedChapter(publicationId: string, chapterId: string): Promise<PublishedChapter | null> {
  const { data, error } = await supabase!
    .from('published_chapters')
    .select(`${CHAPTER_INFO_FIELDS}, content`)
    .eq('publication_id', publicationId)
    .eq('chapter_id', chapterId)
    .maybeSingle();
  if (error) throw error;
  return data as PublishedChapter | null;
}

/**
 * A story of the Home, already summed up by the server (community_feed in
 * supabase/schema.sql): how many chapters came out this week, how far this
 * reader got and the next chapter to read, without the table of contents.
 */
export type FeedItem = {
  id: string;
  title: string;
  synopsis: string;
  genre: string;
  cover_color: string;
  cover_path: string | null;
  author_name: string;
  chapter_count: number;
  last_chapter_at: string;
  created_at: string;
  handle: string | null;
  fresh_count: number;
  latest_position: number | null;
  read_count: number;
  next_chapter_id: string | null;
  next_position: number | null;
  next_word_count: number | null;
  next_excerpt: string | null;
  last_chapter_id: string;
};

/** Where the next page starts: right after the last story of this one. */
export type FeedCursor = { at: string; id: string };

export const FEED_PAGE = 20;

/**
 * One page of the Home, newest chapter first. `progress` is how far this
 * device read each story (lib/reading.ts). `next` is null on the last page.
 */
export async function listFeed(
  genre: string | undefined,
  progress: Record<string, number>,
  after?: FeedCursor,
): Promise<{ items: FeedItem[]; next: FeedCursor | null }> {
  const { data, error } = await supabase!.rpc('community_feed', {
    genre_filter: genre ?? null,
    before_at: after?.at ?? null,
    before_id: after?.id ?? null,
    progress,
    page_size: FEED_PAGE,
  });
  if (error) throw error;
  const items = data as FeedItem[];
  const last = items[items.length - 1];
  return { items, next: items.length === FEED_PAGE ? { at: last.last_chapter_at, id: last.id } : null };
}

/* ---------- The author's side ---------- */

export type MyPublication = { id: string; chapters: Map<string, PublishedChapterInfo> };

/** What of this story is published, or null when nothing is. */
export async function getMyPublication(userId: string, storyId: string): Promise<MyPublication | null> {
  const { data, error } = await supabase!.from('publications').select('id').eq('user_id', userId).eq('story_id', storyId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const chapters = await supabase!.from('published_chapters').select(CHAPTER_INFO_FIELDS).eq('publication_id', data.id);
  if (chapters.error) throw chapters.error;
  return { id: data.id, chapters: new Map((chapters.data as PublishedChapterInfo[]).map((c) => [c.chapter_id, c])) };
}

const coverPath = (userId: string, storyId: string) => `${userId}/publicada-${storyId}`;

/**
 * Creates the publication or brings its title, synopsis and cover up to date.
 * A cover image Storage refuses is left out: the story shows its color.
 */
async function savePublication(userId: string, authorName: string, story: Story): Promise<string> {
  let cover: string | null = null;
  if (story.coverImage) {
    const { error } = await supabase!.storage
      .from('covers')
      .upload(coverPath(userId, story.id), story.coverImage, { upsert: true, contentType: story.coverImage.type || 'image/jpeg' });
    if (error) console.warn('Capa publicada', error);
    else cover = coverPath(userId, story.id);
  }
  const { data, error } = await supabase!
    .from('publications')
    .upsert(
      {
        story_id: story.id,
        title: story.title.trim().slice(0, 200) || 'Sem título',
        synopsis: story.synopsis.slice(0, 2000),
        genre: toGenre(story.genre),
        cover_color: /^#[0-9A-Fa-f]{6}$/.test(story.coverColor) ? story.coverColor : '#2F4A3F',
        cover_path: cover,
        author_name: authorName.slice(0, 60),
      },
      { onConflict: 'user_id,story_id' },
    )
    .select('id')
    .single();
  if (error) throw error;
  if (!cover) await supabase!.storage.from('covers').remove([coverPath(userId, story.id)]);
  return data.id;
}

/**
 * Publishes (or updates) the given chapters, and brings the positions of the
 * ones already published in line with the current order.
 */
export async function publishChapters(userId: string, authorName: string, story: Story, all: Chapter[], chapters: Chapter[]) {
  const id = await savePublication(userId, authorName, story);
  const { error } = await supabase!.from('published_chapters').upsert(
    chapters.map((c) => ({
      publication_id: id,
      chapter_id: c.id,
      position: c.order,
      title: c.title.trim().slice(0, 200),
      content: publishableDoc(c.content),
      word_count: c.wordCount,
      excerpt: excerpt(c.content),
      source_updated_at: c.updatedAt,
    })),
    { onConflict: 'publication_id,chapter_id' },
  );
  if (error) throw error;
  await fixPositions(id, all);
  return id;
}

async function fixPositions(publicationId: string, all: Chapter[]) {
  const { data, error } = await supabase!.from('published_chapters').select('chapter_id, position').eq('publication_id', publicationId);
  if (error) throw error;
  for (const row of data) {
    const local = all.find((c) => c.id === row.chapter_id);
    if (local && local.order !== row.position) {
      const { error: moved } = await supabase!
        .from('published_chapters')
        .update({ position: local.order })
        .eq('publication_id', publicationId)
        .eq('chapter_id', row.chapter_id);
      if (moved) throw moved;
    }
  }
}

/** Takes one chapter down; the last one takes the whole story down with it. */
export async function unpublishChapter(userId: string, publication: MyPublication, chapterId: string) {
  if (publication.chapters.size <= 1 && publication.chapters.has(chapterId)) return unpublishStory(userId, publication);
  const { error } = await supabase!.from('published_chapters').delete().eq('publication_id', publication.id).eq('chapter_id', chapterId);
  if (error) throw error;
}

/**
 * A story going to the trash leaves the community right away, cover and all.
 * The server does the same once the change syncs (supabase/schema.sql), so a
 * failure here, offline for one, only delays it.
 */
export async function unpublishTrashed(userId: string, storyId: string) {
  const { error } = await supabase!.from('publications').delete().eq('user_id', userId).eq('story_id', storyId);
  if (error) throw error;
  await supabase!.storage.from('covers').remove([coverPath(userId, storyId)]);
}

export async function unpublishStory(userId: string, publication: MyPublication) {
  const { data, error } = await supabase!.from('publications').delete().eq('id', publication.id).select('story_id');
  if (error) throw error;
  const storyId = data?.[0]?.story_id as string | undefined;
  if (storyId) await supabase!.storage.from('covers').remove([coverPath(userId, storyId)]);
}

/* ---------- Text ---------- */

const EXCERPT_MAX = 280;

/** The first lines of a chapter, cut at a word, for the Home. */
export function excerpt(doc: JSONContent) {
  const text = plainText(publishableDoc(doc)).replace(/\s+/g, ' ').trim();
  if (text.length <= EXCERPT_MAX) return text;
  const cut = text.slice(0, EXCERPT_MAX - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 200 ? cut.lastIndexOf(' ') : cut.length).replace(/[\s,;:.—-]+$/, '')}…`;
}

const ALIGN = new Set(['left', 'center', 'right', 'justify']);
const BLOCKS = new Set(['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'horizontalRule', 'pageBreak', 'hardBreak', 'text']);
const MARKS = new Set(['bold', 'italic', 'strike', 'underline']);

/**
 * Only what the reader knows how to show: the editor's nodes and marks, the
 * alignment, the heading level. Runs before sending and again when reading,
 * since the server takes any JSON the author's account sends.
 */
export function publishableDoc(node: JSONContent): JSONContent {
  const content = (node.content ?? []).filter((n) => n && BLOCKS.has(n.type ?? '')).map(publishableDoc);
  const out: JSONContent = { type: node.type === 'doc' ? 'doc' : node.type };
  if (node.type === 'text') {
    out.text = typeof node.text === 'string' ? node.text : '';
    const marks = (node.marks ?? []).filter((m) => MARKS.has(m.type)).map((m) => ({ type: m.type }));
    if (marks.length) out.marks = marks;
    return out;
  }
  const attrs: Record<string, unknown> = {};
  if (ALIGN.has(node.attrs?.textAlign)) attrs.textAlign = node.attrs!.textAlign;
  if (node.type === 'heading') attrs.level = node.attrs?.level === 3 ? 3 : 2;
  if (Object.keys(attrs).length) out.attrs = attrs;
  if (content.length) out.content = content;
  return out;
}

/* ---------- Covers ---------- */

const covers = new Map<string, Promise<Blob | undefined>>();

/** The cover image of a published story, downloaded once per visit. */
export function usePublishedCover(path: string | null): Blob | undefined {
  const [blob, setBlob] = useState<Blob>();
  useEffect(() => {
    if (!path) return setBlob(undefined);
    let alive = true;
    if (!covers.has(path)) {
      covers.set(
        path,
        supabase!.storage
          .from('covers')
          .download(path)
          .then(({ data }) => data ?? undefined, () => undefined),
      );
    }
    covers.get(path)!.then((b) => alive && setBlob(b));
    return () => {
      alive = false;
    };
  }, [path]);
  return blob;
}
