import Dexie, { type EntityTable } from 'dexie';
import type { JSONContent } from '@tiptap/react';
import { syncMiddleware } from './sync/middleware';

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
  /** Set while the story sits in the trash. */
  deletedAt?: number;
  createdAt: number;
  updatedAt: number;
}

/** Who tells a chapter or scene: a character from the entries, or an outside voice. */
export type Narrator = { kind: 'personagem'; id: string } | { kind: 'externo'; label: string };

export const EXTERNAL_NARRATORS = ['Narrador onisciente', 'Narrador observador'];

export interface Chapter {
  id: string;
  storyId: string;
  order: number;
  title: string;
  /** Default narrator for the chapter's scenes. */
  narrator?: Narrator;
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

export type SceneStatus = 'planejada' | 'escrita' | 'revisada';

export const SCENE_STATUS_LABEL: Record<SceneStatus, string> = {
  planejada: 'Planejada',
  escrita: 'Escrita',
  revisada: 'Revisada',
};

/** Scenes kept in the "Cenas" section of the planning, outside any chapter. */
export const NO_CHAPTER = '';

export interface Scene {
  id: string;
  storyId: string;
  /** NO_CHAPTER while the scene is kept in "Cenas". */
  chapterId: string;
  order: number;
  title: string;
  /** A brief description; missing on scenes made before it existed. */
  description?: string;
  goal: string;
  conflict: string;
  outcome: string;
  /** Unset: the chapter's narrator. */
  narrator?: Narrator;
  characterIds: string[];
  status: SceneStatus;
  createdAt: number;
  updatedAt: number;
}

export type ThreadKind = 'misterio' | 'promessa' | 'conflito' | 'acontecimento' | 'objeto';

export const THREAD_KIND_LABEL: Record<ThreadKind, string> = {
  misterio: 'Mistério',
  promessa: 'Promessa',
  conflito: 'Conflito',
  acontecimento: 'Acontecimento',
  objeto: 'Objeto importante',
};

export type ThreadStatus = 'aberto' | 'resolvido' | 'abandonado';

export const THREAD_STATUS_LABEL: Record<ThreadStatus, string> = {
  aberto: 'Aberto',
  resolvido: 'Resolvido',
  abandonado: 'Abandonado de propósito',
};

/**
 * A mystery, promise or conflict the story opened. The scene, when set, is
 * the real link (the thread follows it to another chapter); the chapter is
 * kept in step with it and stands alone when there is no scene.
 */
export interface Thread {
  id: string;
  storyId: string;
  kind: ThreadKind;
  title: string;
  note: string;
  originChapterId?: string;
  originSceneId?: string;
  status: ThreadStatus;
  endChapterId?: string;
  endSceneId?: string;
  /** How it was resolved, or why it was dropped. */
  endNote: string;
  createdAt: number;
  updatedAt: number;
}

export const db = new Dexie('lirismo') as Dexie & {
  stories: EntityTable<Story, 'id'>;
  chapters: EntityTable<Chapter, 'id'>;
  versions: EntityTable<ChapterVersion, 'id'>;
  entries: EntityTable<Entry, 'id'>;
  scenes: EntityTable<Scene, 'id'>;
  threads: EntityTable<Thread, 'id'>;
};

db.version(1).stores({
  stories: 'id, status, updatedAt',
  chapters: 'id, storyId, [storyId+order]',
  versions: 'id, chapterId, createdAt',
  entries: 'id, storyId, kind',
});
db.version(2).stores({
  stories: 'id, status, updatedAt, deletedAt',
});
db.version(3).stores({
  scenes: 'id, storyId, chapterId',
  threads: 'id, storyId, status, originSceneId, endSceneId',
});
// "Pista plantada" became "Acontecimento".
db.version(4).upgrade((tx) =>
  tx.table('threads').toCollection().modify((t) => {
    if (t.kind === 'pista') t.kind = 'acontecimento';
  }),
);
// Notes every change so it can be copied to the account (src/sync).
db.use(syncMiddleware);

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

export const TRASH_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

export const isInTrash = (s: Story) => s.deletedAt !== undefined;

/** When a story in the trash will be deleted for good. */
export const purgeDate = (s: Story) => (s.deletedAt ?? Date.now()) + TRASH_DAYS * DAY;

export async function trashStory(id: string) {
  await db.stories.update(id, { deletedAt: Date.now() });
}

export async function restoreStory(id: string) {
  await db.stories.update(id, { deletedAt: undefined, updatedAt: Date.now() });
}

/** Deletes for good every story that has been in the trash for a week. */
export async function purgeTrash() {
  const limit = Date.now() - TRASH_DAYS * DAY;
  const expired = (await db.stories.where('deletedAt').below(limit).primaryKeys()) as string[];
  for (const id of expired) await deleteStory(id);
}

/** Permanently removes a story with everything that belongs to it. */
export async function deleteStory(id: string) {
  await db.transaction('rw', [db.stories, db.chapters, db.versions, db.entries, db.scenes, db.threads], async () => {
    const chapterIds = (await db.chapters.where('storyId').equals(id).primaryKeys()) as string[];
    await db.versions.where('chapterId').anyOf(chapterIds).delete();
    await db.chapters.where('storyId').equals(id).delete();
    await db.entries.where('storyId').equals(id).delete();
    await db.scenes.where('storyId').equals(id).delete();
    await db.threads.where('storyId').equals(id).delete();
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

/**
 * Deletes a chapter and its text. Its scenes move to "Cenas",
 * and threads tied only to the chapter lose that tie.
 */
export async function deleteChapter(chapter: Chapter) {
  await db.transaction('rw', [db.chapters, db.versions, db.stories, db.scenes, db.threads], async () => {
    await db.versions.where('chapterId').equals(chapter.id).delete();
    await db.chapters.delete(chapter.id);
    const loose = await db.scenes.where('chapterId').equals(NO_CHAPTER).filter((s) => s.storyId === chapter.storyId).toArray();
    const last = loose.reduce((n, s) => Math.max(n, s.order), 0);
    const orphans = await db.scenes.where('chapterId').equals(chapter.id).sortBy('order');
    await Promise.all(orphans.map((s, i) => db.scenes.update(s.id, { chapterId: NO_CHAPTER, order: last + i + 1 })));
    await db.threads.where('storyId').equals(chapter.storyId).modify((t) => {
      if (t.originChapterId === chapter.id) delete t.originChapterId;
      if (t.endChapterId === chapter.id) delete t.endChapterId;
    });
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

/** Puts the story's chapters in the given order. */
export async function reorderChapters(ids: string[]) {
  await db.transaction('rw', db.chapters, async () => {
    await Promise.all(ids.map((id, i) => db.chapters.update(id, { order: i + 1 })));
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

export async function getScenes(storyId: string): Promise<Scene[]> {
  const scenes = await db.scenes.where('storyId').equals(storyId).toArray();
  return scenes.sort((a, b) => a.order - b.order);
}

async function nextSceneOrder(storyId: string, chapterId: string) {
  const siblings = await db.scenes.where('chapterId').equals(chapterId).filter((s) => s.storyId === storyId).toArray();
  return siblings.reduce((n, s) => Math.max(n, s.order), 0) + 1;
}

export async function createScene(storyId: string, chapterId: string): Promise<Scene> {
  const now = Date.now();
  const scene: Scene = {
    id: uid(),
    storyId,
    chapterId,
    order: await nextSceneOrder(storyId, chapterId),
    title: '',
    description: '',
    goal: '',
    conflict: '',
    outcome: '',
    characterIds: [],
    status: 'planejada',
    createdAt: now,
    updatedAt: now,
  };
  await db.scenes.add(scene);
  return scene;
}

/**
 * Saves new places for scenes after a drag or a move to another chapter.
 * Threads tied to a scene that changed chapter follow it.
 */
export async function placeScenes(places: { id: string; chapterId: string; order: number }[]) {
  await db.transaction('rw', db.scenes, db.threads, async () => {
    for (const p of places) {
      const scene = await db.scenes.get(p.id);
      if (!scene || (scene.chapterId === p.chapterId && scene.order === p.order)) continue;
      await db.scenes.update(p.id, { chapterId: p.chapterId, order: p.order, updatedAt: Date.now() });
      if (scene.chapterId === p.chapterId) continue;
      const chapterId = p.chapterId || undefined;
      await db.threads.where('originSceneId').equals(p.id).modify({ originChapterId: chapterId });
      await db.threads.where('endSceneId').equals(p.id).modify({ endChapterId: chapterId });
    }
  });
}

/** Moves one scene to the end of another chapter. */
export async function moveSceneToChapter(scene: Scene, chapterId: string) {
  if (scene.chapterId === chapterId) return;
  await placeScenes([{ id: scene.id, chapterId, order: await nextSceneOrder(scene.storyId, chapterId) }]);
}

/** Deletes a scene; its threads stay, tied only to the chapter. */
export async function deleteScene(scene: Scene) {
  const chapterId = scene.chapterId || undefined;
  await db.transaction('rw', db.scenes, db.threads, async () => {
    await db.threads.where('originSceneId').equals(scene.id).modify((t) => {
      delete t.originSceneId;
      t.originChapterId = chapterId;
    });
    await db.threads.where('endSceneId').equals(scene.id).modify((t) => {
      delete t.endSceneId;
      t.endChapterId = chapterId;
    });
    await db.scenes.delete(scene.id);
  });
}

export async function createThread(data: Pick<Thread, 'storyId' | 'kind' | 'title' | 'note' | 'originChapterId' | 'originSceneId'>): Promise<Thread> {
  const now = Date.now();
  const thread: Thread = { id: uid(), status: 'aberto', endNote: '', createdAt: now, updatedAt: now, ...data };
  await db.threads.add(thread);
  return thread;
}

export async function updateThread(id: string, changes: Partial<Thread>) {
  await db.threads.update(id, { ...changes, updatedAt: Date.now() });
}

export async function reopenThread(id: string) {
  await updateThread(id, { status: 'aberto', endChapterId: undefined, endSceneId: undefined, endNote: '' });
}
