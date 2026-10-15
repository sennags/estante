import { useSyncExternalStore } from 'react';

/*
 * How far this device read each published story: the position of the last
 * chapter opened, in localStorage (lirismo:leitura). It never goes to the
 * server, works without an account and stays after signing out.
 */

const KEY = 'lirismo:leitura';
type Progress = Record<string, number>;

let cache: Progress | undefined;
const subscribers = new Set<() => void>();

function read(): Progress {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    cache = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    cache = {};
  }
  return cache!;
}

/** Notes that this chapter was opened; going back to an earlier one keeps the furthest. */
export function markRead(publicationId: string, position: number) {
  const all = read();
  if ((all[publicationId] ?? 0) >= position) return;
  cache = { ...all, [publicationId]: position };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Storage blocked: the progress lasts while the tab is open.
  }
  subscribers.forEach((fn) => fn());
}

export function useReadingProgress(): Progress {
  return useSyncExternalStore(
    (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    read,
  );
}
