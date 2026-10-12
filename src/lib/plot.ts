import type { Chapter, Entry, Narrator, Scene, Thread } from '../db';
import { chapterName } from './text';

/** Chapters open this long without an end get a gentle warning. */
export const STALE_CHAPTERS = 4;

export function narratorName(narrator: Narrator | undefined, entries: Entry[]): string | undefined {
  if (!narrator) return undefined;
  if (narrator.kind === 'externo') return narrator.label;
  return entries.find((e) => e.id === narrator.id)?.name || (entries.some((e) => e.id === narrator.id) ? 'Sem nome' : 'Personagem removido');
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** "Cena 3" when the scene has no title yet. */
export function sceneName(scene: Scene, scenes: Scene[]) {
  if (scene.title.trim()) return scene.title.trim();
  const n = scenes.filter((s) => s.chapterId === scene.chapterId && s.order <= scene.order).length;
  return `Cena ${n}`;
}

/** Position of a scene inside its chapter, counting from 1. */
export function sceneNumber(scene: Scene, scenes: Scene[]) {
  return scenes.filter((s) => s.chapterId === scene.chapterId && s.order <= scene.order).length;
}

export type Place = {
  chapter?: Chapter;
  scene?: Scene;
  /** "Cap. 2 · cena 3" */
  short: string;
  /** "O sótão · A chave na gaveta" */
  long: string;
  /** For ordering: chapter order then scene order. Undefined when it can't be placed. */
  rank?: [number, number];
};

/** Where a thread started or ended, from its scene when there is one. */
export function place(chapters: Chapter[], scenes: Scene[], sceneId?: string, chapterId?: string): Place | undefined {
  const scene = sceneId ? scenes.find((s) => s.id === sceneId) : undefined;
  const chapter = chapters.find((c) => c.id === (scene ? scene.chapterId : chapterId));
  if (!scene && !chapter) return undefined;
  if (!chapter) {
    return { scene, short: 'Cenas', long: scene ? `Cenas · ${sceneName(scene, scenes)}` : 'Cenas' };
  }
  const name = chapterName(chapter.order, chapter.title);
  if (!scene) return { chapter, short: `Cap. ${chapter.order}`, long: name, rank: [chapter.order, 0] };
  return {
    chapter,
    scene,
    short: `Cap. ${chapter.order} · cena ${sceneNumber(scene, scenes)}`,
    long: `${name} · ${sceneName(scene, scenes)}`,
    rank: [chapter.order, scene.order],
  };
}

export const origin = (t: Thread, chapters: Chapter[], scenes: Scene[]) => place(chapters, scenes, t.originSceneId, t.originChapterId);
export const ending = (t: Thread, chapters: Chapter[], scenes: Scene[]) => place(chapters, scenes, t.endSceneId, t.endChapterId);

export function compareRank(a?: [number, number], b?: [number, number]) {
  if (!a || !b) return 0;
  return a[0] - b[0] || a[1] - b[1];
}

/** True when `end` surely comes before `start`. Within one chapter, both need a scene to tell. */
export function isBefore(end?: Place, start?: Place) {
  const a = end?.rank, b = start?.rank;
  if (!a || !b) return false;
  if (a[0] !== b[0]) return a[0] < b[0];
  return a[1] > 0 && b[1] > 0 && a[1] < b[1];
}

/** True when a thread was resolved before the place it started. */
export function endsBeforeOrigin(t: Thread, chapters: Chapter[], scenes: Scene[]) {
  return t.status === 'resolvido' && isBefore(ending(t, chapters, scenes), origin(t, chapters, scenes));
}

/** The furthest chapter that already has text: where the writing "is". */
export function currentChapter(chapters: Chapter[]): Chapter | undefined {
  return [...chapters].reverse().find((c) => c.wordCount > 0);
}

/** "aberto desde o capítulo 2, já estamos no 9", or nothing. */
export function staleWarning(t: Thread, chapters: Chapter[], scenes: Scene[]) {
  if (t.status !== 'aberto') return undefined;
  const from = origin(t, chapters, scenes)?.chapter;
  const now = currentChapter(chapters);
  if (!from || !now || now.order - from.order < STALE_CHAPTERS) return undefined;
  return `Aberto desde o capítulo ${from.order}, e a escrita já está no ${now.order}.`;
}

/** Open threads first, then by where they started. */
export function sortThreads(threads: Thread[], chapters: Chapter[], scenes: Scene[]) {
  const status = { aberto: 0, resolvido: 1, abandonado: 2 };
  return [...threads].sort(
    (a, b) =>
      status[a.status] - status[b.status] ||
      compareRank(origin(a, chapters, scenes)?.rank ?? [Infinity, 0], origin(b, chapters, scenes)?.rank ?? [Infinity, 0]) ||
      a.createdAt - b.createdAt,
  );
}
