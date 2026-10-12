import Dexie, { type EntityTable } from 'dexie';
import type { JSONContent } from '@tiptap/react';

export type StoryStatus = 'planejamento' | 'escrita' | 'revisao';

export const STATUS_LABEL: Record<StoryStatus, string> = {
  planejamento: 'Em planejamento',
  escrita: 'Em escrita',
  revisao: 'Em revisão',
};

export interface Story {
  id: string;
  title: string;
  synopsis: string;
  genre: string;
  status: StoryStatus;
  coverColor: string;
  coverImage?: Blob;
  lastChapterId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Chapter {
  id: string;
  storyId: string;
  order: number;
  title: string;
  content: JSONContent;
  wordCount: number;
  pageCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface ChapterVersion {
  id: string;
  chapterId: string;
  content: JSONContent;
  wordCount: number;
  label: string;
  createdAt: number;
}

export type EntryKind = 'personagem' | 'lugar' | 'objeto' | 'regra';

export const KIND_LABEL: Record<EntryKind, { one: string; many: string }> = {
  personagem: { one: 'Personagem', many: 'Personagens' },
  lugar: { one: 'Lugar', many: 'Lugares' },
  objeto: { one: 'Objeto', many: 'Objetos' },
  regra: { one: 'Regra do mundo', many: 'Regras do mundo' },
};

export interface Entry {
  id: string;
  storyId: string;
  kind: EntryKind;
  name: string;
  summary: string;
  description: string;
  motivations: string;
  relations: string;
  createdAt: number;
  updatedAt: number;
}

export const db = new Dexie('trama') as Dexie & {
  stories: EntityTable<Story, 'id'>;
  chapters: EntityTable<Chapter, 'id'>;
  versions: EntityTable<ChapterVersion, 'id'>;
  entries: EntityTable<Entry, 'id'>;
};

db.version(1).stores({
  stories: 'id, status, updatedAt',
  chapters: 'id, storyId, [storyId+order]',
  versions: 'id, chapterId, createdAt',
  entries: 'id, storyId, kind',
});

export const COVER_COLORS = ['#6E2E2B', '#24344D', '#2F4A3F', '#B88A3B', '#D9CBB0', '#4B3B5C'];

/** Text color that stays readable on a given cover color. */
export function coverInk(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 140 ? '#1F1A12' : '#F6EFE3';
}

const uid = () => crypto.randomUUID();
const emptyDoc = (): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph' }] });

export async function createStory(data: Pick<Story, 'title' | 'synopsis' | 'genre' | 'coverColor' | 'coverImage'>): Promise<Story> {
  const now = Date.now();
  const story: Story = { id: uid(), status: 'planejamento', createdAt: now, updatedAt: now, ...data };
  await db.transaction('rw', db.stories, db.chapters, async () => {
    await db.stories.add(story);
    const chapter = await addChapter(story.id);
    await db.stories.update(story.id, { lastChapterId: chapter.id });
  });
  return story;
}

export async function deleteStory(id: string) {
  await db.transaction('rw', [db.stories, db.chapters, db.versions, db.entries], async () => {
    const chapterIds = (await db.chapters.where('storyId').equals(id).primaryKeys()) as string[];
    await db.versions.where('chapterId').anyOf(chapterIds).delete();
    await db.chapters.where('storyId').equals(id).delete();
    await db.entries.where('storyId').equals(id).delete();
    await db.stories.delete(id);
  });
}

export async function getChapters(storyId: string): Promise<Chapter[]> {
  return db.chapters.where('[storyId+order]').between([storyId, Dexie.minKey], [storyId, Dexie.maxKey]).toArray();
}

export async function addChapter(storyId: string): Promise<Chapter> {
  const chapters = await getChapters(storyId);
  const now = Date.now();
  const chapter: Chapter = {
    id: uid(),
    storyId,
    order: chapters.length ? chapters[chapters.length - 1].order + 1 : 1,
    title: '',
    content: emptyDoc(),
    wordCount: 0,
    pageCount: 1,
    createdAt: now,
    updatedAt: now,
  };
  await db.chapters.add(chapter);
  return chapter;
}

export async function deleteChapter(chapter: Chapter) {
  await db.transaction('rw', db.chapters, db.versions, db.stories, async () => {
    await db.versions.where('chapterId').equals(chapter.id).delete();
    await db.chapters.delete(chapter.id);
    const rest = await getChapters(chapter.storyId);
    await Promise.all(rest.map((c, i) => db.chapters.update(c.id, { order: i + 1 })));
    const story = await db.stories.get(chapter.storyId);
    if (story?.lastChapterId === chapter.id) {
      await db.stories.update(story.id, { lastChapterId: rest[0]?.id });
    }
  });
}

/** Swap a chapter with its neighbour (dir -1 = up, 1 = down). */
export async function moveChapter(chapter: Chapter, dir: -1 | 1) {
  const chapters = await getChapters(chapter.storyId);
  const i = chapters.findIndex((c) => c.id === chapter.id);
  const other = chapters[i + dir];
  if (!other) return;
  await db.transaction('rw', db.chapters, async () => {
    await db.chapters.update(chapter.id, { order: other.order });
    await db.chapters.update(other.id, { order: chapter.order });
  });
}

const VERSION_INTERVAL = 10 * 60 * 1000;
const MAX_VERSIONS = 50;

export async function saveChapterContent(chapter: Chapter, content: JSONContent, wordCount: number, pageCount: number) {
  const now = Date.now();
  await db.chapters.update(chapter.id, { content, wordCount, pageCount, updatedAt: now });
  await db.stories.update(chapter.storyId, { updatedAt: now, lastChapterId: chapter.id });
  const last = await db.versions.where('chapterId').equals(chapter.id).reverse().sortBy('createdAt');
  if (!last.length || now - last[0].createdAt > VERSION_INTERVAL) {
    await snapshotVersion(chapter.id, content, wordCount, 'Automática');
  }
}

export async function snapshotVersion(chapterId: string, content: JSONContent, wordCount: number, label: string) {
  await db.versions.add({ id: uid(), chapterId, content, wordCount, label, createdAt: Date.now() });
  const all = await db.versions.where('chapterId').equals(chapterId).sortBy('createdAt');
  if (all.length > MAX_VERSIONS) {
    await db.versions.bulkDelete(all.slice(0, all.length - MAX_VERSIONS).map((v) => v.id));
  }
}

export async function createEntry(storyId: string, kind: EntryKind): Promise<Entry> {
  const now = Date.now();
  const entry: Entry = { id: uid(), storyId, kind, name: '', summary: '', description: '', motivations: '', relations: '', createdAt: now, updatedAt: now };
  await db.entries.add(entry);
  return entry;
}
