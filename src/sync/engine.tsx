import Dexie, { type Table } from 'dexie';
import type { Session } from '@supabase/supabase-js';
import { db, purgeTrash, type Story } from '../db';
import { ask, tell } from '../components/Ask';
import { COVER_MAX_BYTES, shrinkCover } from '../lib/image';
import { plural } from '../lib/text';
import { markFromSync, onLocalChanges, SYNCED_TABLES, type ChangeKey, type SyncedTable } from './middleware';
import { supabase } from './supabase';
import { forgetPhoto, loadHandle, profileFrom, type Profile } from './profile';

/*
 * Local-first sync. The browser (Dexie) stays the source of truth; the
 * account keeps a copy in one Supabase table, `records`, one row per record.
 *
 * - Every committed local write lands in the outbox (a separate database).
 * - Pushing sends the current state of each outbox record, or a tombstone
 *   when it no longer exists. The server keeps whatever arrives last.
 * - Pulling fetches rows with a rev above the last one seen and applies
 *   them, except records that still have a local change waiting to go up.
 * - Cover images go to Storage (bucket `covers`); the row keeps only the path.
 * - What the server will never take (a record over its size limit, a cover
 *   past the account's covers) is set aside, so the rest keeps going up.
 */

type OutboxItem = { key: string; kind: SyncedTable; id: string; stamp: string };
type Meta = { key: string; value: unknown };
type CoverCache = { storyId: string; hash: string };
/** A record the server refused for its size; `bytes` is how big it was then. */
type HeldItem = { key: string; kind: SyncedTable; id: string; bytes: number };

const syncDb = new Dexie('lirismo-sync') as Dexie & {
  outbox: Table<OutboxItem, string>;
  meta: Table<Meta, string>;
  covers: Table<CoverCache, string>;
  held: Table<HeldItem, string>;
};
syncDb.version(1).stores({ outbox: 'key', meta: 'key', covers: 'storyId' });
syncDb.version(2).stores({ held: 'key' });

type Row = { kind: SyncedTable; id: string; data: Record<string, unknown> | null; deleted: boolean; rev: number };

const recordKey = (kind: string, id: string) => `${kind}/${id}`;
const getMeta = async <T,>(key: string) => (await syncDb.meta.get(key))?.value as T | undefined;
const setMeta = (key: string, value: unknown) => syncDb.meta.put({ key, value });

/* ---------- State shown in the interface ---------- */

/** `full`: the account reached its space limit on the server (see supabase/schema.sql). */
export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error' | 'full';

export type AccountState = {
  /** The variables are set, so accounts exist at all. */
  configured: boolean;
  /** Signed in now. */
  email: string | null;
  /** Name and photo, while signed in. */
  profile?: Profile;
  /** The account's @: undefined while loading (or on failure), null when it has none yet. */
  handle?: string | null;
  /** This browser's stories are tied to an account (even if the session expired). */
  linked: boolean;
  status: SyncStatus;
  pending: number;
  /** Records too big for the server: they stay only on this device. */
  held: number;
  lastSync?: number;
  /** Came back from a "forgot my password" link: ask for the new one. */
  recovering: boolean;
};

let state: AccountState = { configured: !!supabase, email: null, linked: false, status: 'idle', pending: 0, held: 0, recovering: false };
const subscribers = new Set<() => void>();

function setState(changes: Partial<AccountState>) {
  state = { ...state, ...changes };
  subscribers.forEach((fn) => fn());
}

export const getAccountState = () => state;
export function subscribeAccount(fn: () => void) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export const finishRecovery = () => setState({ recovering: false });

/* ---------- Outbox ---------- */

/** The account this browser's stories belong to; null while not tied to one. */
let linkedUser: string | null = null;
let session: Session | null = null;
const PUSH_DELAY = 3000;
let pushTimer = 0;

const countPending = async () => ({ pending: await syncDb.outbox.count(), held: await syncDb.held.count() });

/** The size of a record as sent, close to what the server measures. */
const wireSize = (record: unknown) => JSON.stringify(record).length;

async function enqueue(changes: ChangeKey[]) {
  const items = new Map<string, OutboxItem>();
  for (const c of changes) items.set(recordKey(c.kind, c.id), { key: recordKey(c.kind, c.id), ...c, stamp: crypto.randomUUID() });
  // A record set aside for its size goes back in line only once it shrank (or was deleted).
  for (const h of await syncDb.held.bulkGet([...items.keys()])) {
    if (!h) continue;
    const record = await db.table(h.kind).get(h.id);
    if (record && wireSize(record) >= h.bytes) items.delete(h.key);
    else await syncDb.held.delete(h.key);
  }
  if (items.size) await syncDb.outbox.bulkPut([...items.values()]);
  setState(await countPending());
}

onLocalChanges((changes) => {
  if (!linkedUser) return;
  enqueue(changes).then(() => {
    window.clearTimeout(pushTimer);
    pushTimer = window.setTimeout(() => syncNow(), PUSH_DELAY);
  });
});

/* ---------- Covers ---------- */

async function blobHash(blob: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const coverPath = (storyId: string) => `${linkedUser}/${storyId}`;

async function removeCover(storyId: string) {
  if (!(await syncDb.covers.get(storyId))) return;
  await supabase!.storage.from('covers').remove([coverPath(storyId)]);
  await syncDb.covers.delete(storyId);
  // A slot opened up: the covers left out get another try.
  const left = await coversLeftOut();
  if (left.length) await enqueue(left.map((id) => ({ kind: 'stories', id })));
}

/**
 * Stories whose cover Storage refused (the account's 50 covers, see
 * supabase/schema.sql). They go up without it and keep it on this device.
 */
const coversLeftOut = async () => (await getMeta<string[]>('coversLeftOut')) ?? [];

async function leaveCoverOut(storyId: string, out: boolean) {
  const left = await coversLeftOut();
  if (out === left.includes(storyId)) return;
  await setMeta('coversLeftOut', out ? [...left, storyId] : left.filter((id) => id !== storyId));
}

/** Storage turned the file down for good (a rule or its size), not a network or session hiccup. */
function refused(err: unknown) {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500 && ![401, 408, 429].includes(status);
}

/**
 * A cover kept before covers were shrunk on picking, made small and saved so
 * locally too. If the story got another cover meanwhile, that one stays.
 */
async function shrinkOldCover(storyId: string, cover: Blob): Promise<Blob> {
  let small: Blob;
  try {
    small = await shrinkCover(cover);
  } catch {
    return cover;
  }
  await db.transaction('rw', db.stories, async (tx) => {
    // It goes up right now, so this write need not wait in the outbox.
    markFromSync(tx.idbtrans);
    const current = await db.stories.get(storyId);
    if (current?.coverImage?.size === cover.size) await db.stories.update(storyId, { coverImage: small });
  });
  return small;
}

/**
 * Puts in the outbox, once per page load, the stories whose cover is still
 * large and those whose cover was left out, for another try. Only after a
 * pull: the story that goes up must be the latest one.
 */
let oldCoversChecked = false;
async function queueOldCovers() {
  if (oldCoversChecked) return;
  oldCoversChecked = true;
  const again: ChangeKey[] = (await coversLeftOut()).map((id) => ({ kind: 'stories', id }));
  await db.stories.each((s) => {
    if (s.coverImage && s.coverImage.size > COVER_MAX_BYTES) again.push({ kind: 'stories', id: s.id });
  });
  if (!again.length) return;
  await enqueue(again);
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => syncNow(), PUSH_DELAY);
}

/** Covers left out during this page load, to tell the author once. */
const newlyLeftOut = new Set<string>();

/**
 * The story as stored on the server: the image goes to Storage, the row keeps
 * its path. A cover Storage refuses stays here, and `coverOnlyHere` tells the
 * other devices to keep whatever cover they have.
 */
async function storyToWire(local: Story) {
  const story = withoutCover({ ...local }) as Omit<Story, 'coverImage'>;
  let coverImage = local.coverImage;
  if (!coverImage) {
    await leaveCoverOut(story.id, false);
    await removeCover(story.id);
    return story;
  }
  if (coverImage.size > COVER_MAX_BYTES) coverImage = await shrinkOldCover(story.id, coverImage);
  const hash = await blobHash(coverImage);
  if ((await syncDb.covers.get(story.id))?.hash !== hash) {
    const { error } = await supabase!.storage
      .from('covers')
      .upload(coverPath(story.id), coverImage, { upsert: true, contentType: coverImage.type || undefined });
    if (error && !refused(error)) throw error;
    if (error) {
      if (!(await coversLeftOut()).includes(story.id)) newlyLeftOut.add(story.id);
      await leaveCoverOut(story.id, true);
      return { ...story, coverOnlyHere: true };
    }
    await syncDb.covers.put({ storyId: story.id, hash });
  }
  await leaveCoverOut(story.id, false);
  return { ...story, coverPath: coverPath(story.id), coverHash: hash };
}

/* ---------- Push ---------- */

const MAX_BATCH_BYTES = 1_000_000;

type WireRow = { user_id: string | null; kind: SyncedTable; id: string; data: Record<string, unknown> | null; deleted: boolean };

const upsert = (rows: WireRow[]) => supabase!.from('records').upsert(rows, { onConflict: 'user_id,kind,id' });

/** A record over the server's size limit (check records_data_size in supabase/schema.sql). */
const isTooBig = (err: unknown) => (err as { code?: unknown } | null)?.code === '23514';

/** Takes sent items out of the outbox; one that changed again while it was being sent stays for the next round. */
async function markSent(items: OutboxItem[]) {
  await syncDb.transaction('rw', syncDb.outbox, async () => {
    for (const item of items) {
      if ((await syncDb.outbox.get(item.key))?.stamp === item.stamp) await syncDb.outbox.delete(item.key);
    }
  });
}

/** Records set aside during this page load, to tell the author once. */
const newlyHeld = new Set<string>();

/**
 * A batch with a record the server will never take: each goes alone, and the
 * ones too big are set aside (see enqueue), so they stop holding up the rest.
 */
async function pushOneByOne(items: OutboxItem[], rows: WireRow[]) {
  for (let i = 0; i < rows.length; i++) {
    const { error } = await upsert([rows[i]]);
    if (error && !isTooBig(error)) throw error;
    if (error) {
      const { key, kind, id } = items[i];
      await syncDb.held.put({ key, kind, id, bytes: wireSize(rows[i].data) });
      newlyHeld.add(key);
    }
    await markSent([items[i]]);
  }
}

async function push() {
  for (let round = 0; round < 50; round++) {
    const items = await syncDb.outbox.limit(100).toArray();
    if (!items.length) return;
    const rows: WireRow[] = [];
    let bytes = 0;
    for (const item of items) {
      const record = await db.table(item.kind).get(item.id);
      let data: Record<string, unknown> | null = null;
      if (record) data = item.kind === 'stories' ? await storyToWire(record) : record;
      else if (item.kind === 'stories') await removeCover(item.id);
      rows.push({ user_id: linkedUser, kind: item.kind, id: item.id, data, deleted: !record });
      bytes += data ? wireSize(data) : 0;
      if (bytes > MAX_BATCH_BYTES) break;
    }
    const sent = items.slice(0, rows.length);
    const { error } = await upsert(rows);
    if (error && !isTooBig(error)) throw error;
    if (error) await pushOneByOne(sent, rows);
    else await markSent(sent);
    setState(await countPending());
  }
}

/**
 * With the account full, deletions go first: they free space, and a batch
 * of new records ahead of them in line would be refused with them.
 * Returns how many went up.
 */
async function pushDeletions() {
  const items = await syncDb.outbox.toArray();
  const gone: OutboxItem[] = [];
  for (const kind of SYNCED_TABLES) {
    const ofKind = items.filter((i) => i.kind === kind);
    if (!ofKind.length) continue;
    const exist = new Set(await db.table(kind).where(':id').anyOf(ofKind.map((i) => i.id)).primaryKeys());
    gone.push(...ofKind.filter((i) => !exist.has(i.id)));
  }
  for (let i = 0; i < gone.length; i += 100) {
    const batch = gone.slice(i, i + 100);
    for (const item of batch) if (item.kind === 'stories') await removeCover(item.id);
    const rows = batch.map((item): WireRow => ({ user_id: linkedUser, kind: item.kind, id: item.id, data: null, deleted: true }));
    const { error } = await upsert(rows);
    if (error && !isQuotaError(error)) throw error;
    if (error) {
      // Removing a row the server has always passes. One refused was never
      // there (created and deleted while the account was full): nothing to remove.
      for (let j = 0; j < rows.length; j++) {
        const { error: alone } = await upsert([rows[j]]);
        if (alone && !isQuotaError(alone)) throw alone;
      }
    }
    await markSent(batch);
    setState(await countPending());
  }
  return gone.length;
}

/* ---------- Pull ---------- */

/** JSON with sorted keys: the server (jsonb) does not keep the key order. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function withoutCover(record: Record<string, unknown>) {
  const { coverImage: _i, coverPath: _p, coverHash: _h, coverOnlyHere: _o, ...rest } = record;
  return rest;
}

/**
 * The cover for a story coming from the server. `same` means the local story
 * already has that image (or neither has one), so it need not be replaced.
 */
async function remoteCover(storyId: string, data: Record<string, unknown>): Promise<{ blob?: Blob; same: boolean }> {
  const local = await db.stories.get(storyId);
  // The cover stayed on the device that sent it: keep the one here, if any.
  if (data.coverOnlyHere) return { blob: local?.coverImage, same: true };
  if (typeof data.coverPath !== 'string') return { same: !local?.coverImage };
  if (local?.coverImage && (await syncDb.covers.get(storyId))?.hash === data.coverHash) return { blob: local.coverImage, same: true };
  const { data: blob, error } = await supabase!.storage.from('covers').download(data.coverPath);
  if (error || !blob) return { blob: local?.coverImage, same: true };
  await syncDb.covers.put({ storyId, hash: String(data.coverHash) });
  return { blob, same: false };
}

async function applyRemote(rows: Row[]) {
  const keys = rows.map((r) => recordKey(r.kind, r.id));
  // Records set aside for their size are newer here than on the server too.
  const waiting = new Set([
    ...(await syncDb.outbox.where('key').anyOf(keys).primaryKeys()),
    ...(await syncDb.held.where('key').anyOf(keys).primaryKeys()),
  ]);
  const incoming = rows.filter((r) => !waiting.has(recordKey(r.kind, r.id)));
  if (!incoming.length) return;

  // Downloads cannot happen inside the database transaction, so covers come first.
  const covers = new Map<string, { blob?: Blob; same: boolean }>();
  for (const r of incoming) {
    if (r.kind === 'stories' && r.data && !r.deleted) covers.set(r.id, await remoteCover(r.id, r.data));
  }

  const changedChapters: string[] = [];
  await db.transaction('rw', SYNCED_TABLES.map((t) => db.table(t)), async (tx) => {
    markFromSync(tx.idbtrans);
    for (const r of incoming) {
      const table = db.table(r.kind);
      const local = await table.get(r.id);
      if (r.deleted || !r.data) {
        if (local) await table.delete(r.id);
        if (local && r.kind === 'chapters') changedChapters.push(r.id);
        continue;
      }
      const sameCover = r.kind !== 'stories' || !!covers.get(r.id)?.same;
      if (local && sameCover && stable(withoutCover(local)) === stable(withoutCover(r.data))) continue;
      const record = withoutCover(r.data);
      const cover = covers.get(r.id)?.blob;
      if (r.kind === 'stories' && cover) record.coverImage = cover;
      await table.put(record);
      if (r.kind === 'chapters') changedChapters.push(r.id);
    }
  });
  for (const r of incoming) if (r.kind === 'stories' && r.deleted) await syncDb.covers.delete(r.id);
  if (changedChapters.length) window.dispatchEvent(new CustomEvent('lirismo:remote', { detail: { chapters: changedChapters } }));
}

const PAGE = 500;

/** Brings in what changed on the server; `fromStart` reads everything. Returns the keys it saw. */
async function pull(fromStart = false) {
  let rev = fromStart ? 0 : ((await getMeta<number>('lastRev')) ?? 0);
  const seen = new Set<string>();
  for (;;) {
    const { data, error } = await supabase!
      .from('records')
      .select('kind,id,data,deleted,rev')
      .eq('user_id', linkedUser!)
      .gt('rev', rev)
      .order('rev')
      .limit(PAGE);
    if (error) throw error;
    const rows = data as Row[];
    rows.forEach((r) => seen.add(recordKey(r.kind, r.id)));
    if (rows.length) {
      await applyRemote(rows);
      rev = rows[rows.length - 1].rev;
      await setMeta('lastRev', rev);
    }
    if (rows.length < PAGE) return seen;
  }
}

/* ---------- Running the sync ---------- */

let running: Promise<void> | null = null;
let again = false;
let forceAgain = false;
let pulledOnce = false;
let warnedFull = false;

/** When the server last said the account is full; 0 while it is not. */
let fullAt = 0;
/** With the account full, new records are offered again only this often (deletions go at once). */
const FULL_RETRY = 10 * 60 * 1000;

/** The server refuses writes past the account's limit (trigger records_quota). */
const isQuotaError = (err: unknown) => (err as { message?: unknown } | null)?.message === 'lirismo_quota';

function warnFull() {
  if (warnedFull) return;
  warnedFull = true;
  tell({
    title: 'A nuvem da sua conta está cheia',
    message: (
      <>
        <p>Suas histórias continuam guardadas neste aparelho, mas as mudanças novas não estão chegando à nuvem nem aos outros aparelhos.</p>
        <p>Apagar histórias, capítulos ou fichas que você não usa mais libera espaço. Se precisar de mais, escreva para contato@lirismo.com.br.</p>
      </>
    ),
  });
}

const quoted = (text: unknown) => `“${String(text ?? '').trim() || 'sem título'}”`;

/** "o capítulo “Um” (de “A história”)", for the warning about records set aside. */
async function describeHeld({ kind, id }: HeldItem) {
  const record = (await db.table(kind).get(id)) as Record<string, unknown> | undefined;
  if (!record) return null;
  let storyId = record.storyId;
  let what: string;
  if (kind === 'versions') {
    const chapter = await db.chapters.get(String(record.chapterId));
    storyId = chapter?.storyId;
    what = `uma versão guardada do capítulo ${quoted(chapter?.title)}`;
  } else {
    const noun = { stories: 'a história', chapters: 'o capítulo', entries: 'a ficha', scenes: 'a cena', threads: 'o fio' }[kind];
    what = `${noun} ${quoted(record.title)}`;
  }
  const story = kind === 'stories' ? undefined : await db.stories.get(String(storyId));
  return story ? `${what}, de ${quoted(story.title)}` : what;
}

/** Tells, once per record or cover, what stays only on this device. */
async function warnLeftOut() {
  const held = (await syncDb.held.bulkGet([...newlyHeld])).filter((h): h is HeldItem => !!h);
  const covers = await db.stories.bulkGet([...newlyLeftOut]);
  newlyHeld.clear();
  newlyLeftOut.clear();
  const names = (await Promise.all(held.map(describeHeld))).filter((n): n is string => !!n);
  const titles = covers.filter((s): s is Story => !!s).map((s) => quoted(s.title));
  if (!names.length && !titles.length) return;
  tell({
    title: 'Algo ficou só neste aparelho',
    message: (
      <>
        {names.length > 0 && (
          <>
            <p>Passou do tamanho máximo de 5 MB por item, e não vai para a nuvem:</p>
            <ul>{names.map((n) => <li key={n}>{n}</li>)}</ul>
            <p>Continua guardado aqui. Se ficar menor (por exemplo, dividido em dois capítulos), volta a sincronizar sozinho.</p>
          </>
        )}
        {titles.length > 0 && (
          <p>
            {titles.length === 1 ? `A capa de ${titles[0]} ficou` : `As capas de ${titles.join(', ')} ficaram`} só neste aparelho: a conta guarda até 50 imagens
            na nuvem, contando a foto e a capa do perfil. Tirar a capa de outra história abre espaço, e então ela sobe sozinha.
          </p>
        )}
      </>
    ),
  });
}

async function syncOnce(force: boolean) {
  if (!supabase || !linkedUser || session?.user.id !== linkedUser) return;
  if (!navigator.onLine) return setState({ status: 'offline' });
  setState({ status: 'syncing' });
  try {
    if (await getMeta<boolean>('merging')) await merge();
    // A full account still receives what other devices sent.
    try {
      // While full, only deletions go up between tries, unless the author asked.
      const resting = fullAt > 0 && Date.now() - fullAt < FULL_RETRY && !force;
      if (fullAt && (await pushDeletions()) > 0) fullAt = 0;
      if (!resting || !fullAt) {
        await push();
        fullAt = 0;
      }
    } catch (err) {
      if (!isQuotaError(err)) throw err;
      fullAt = Date.now();
    }
    await pull();
    await queueOldCovers();
    setState({ status: fullAt ? 'full' : 'synced', lastSync: Date.now(), ...(await countPending()) });
    if (fullAt) warnFull();
    await warnLeftOut();
    if (!pulledOnce) {
      pulledOnce = true;
      purgeTrash();
    }
  } catch (err) {
    console.warn('Sincronização falhou', err);
    setState({ status: navigator.onLine ? 'error' : 'offline' });
  }
}

/**
 * Syncs now; if a sync is already running, runs once more after it.
 * `force` (the author asked) skips the wait while the account is full.
 */
export function syncNow(force = false): Promise<void> {
  if (running) {
    again = true;
    forceAgain ||= force;
    return running;
  }
  running = (async () => {
    let forced = force;
    do {
      again = false;
      await syncOnce(forced);
      forced = forceAgain;
      forceAgain = false;
    } while (again);
  })().finally(() => (running = null));
  return running;
}

/**
 * First sync of an account in this browser: take everything from the
 * server, then send up the local records it did not have. The flag stays
 * until the end, so an interrupted merge starts over on the next sync.
 */
async function merge() {
  await setMeta('merging', true);
  const seen = await pull(true);
  const changes: ChangeKey[] = [];
  for (const kind of SYNCED_TABLES) {
    const ids = (await db.table(kind).toCollection().primaryKeys()) as string[];
    for (const id of ids) if (!seen.has(recordKey(kind, id))) changes.push({ kind, id });
  }
  if (changes.length) await enqueue(changes);
  await syncDb.meta.delete('merging');
}

async function link(userId: string) {
  linkedUser = userId;
  await setMeta('userId', userId);
  await setMeta('lastRev', 0);
  await setMeta('merging', true);
  setState({ linked: true });
}

async function unlink() {
  linkedUser = null;
  pulledOnce = false;
  fullAt = 0;
  await syncDb.transaction('rw', [syncDb.outbox, syncDb.meta, syncDb.covers, syncDb.held], async () => {
    await syncDb.outbox.clear();
    await syncDb.meta.clear();
    await syncDb.covers.clear();
    await syncDb.held.clear();
  });
  setState({ linked: false, pending: 0, held: 0, status: 'idle', lastSync: undefined });
}

let handledUser: string | null | undefined;
let handleOwner: string | null | undefined;

async function fetchHandle(userId: string | null) {
  handleOwner = userId;
  setState({ handle: undefined });
  if (!userId) return;
  try {
    const handle = await loadHandle(userId);
    if (handleOwner === userId) setState({ handle });
  } catch (err) {
    // Offline or the table is not there yet: the @ stays hidden.
    console.warn('Carregar o @ falhou', err);
    if (handleOwner === userId) handleOwner = undefined;
  }
}

/** After the author saved a new @. */
export const setHandle = (handle: string) => setState({ handle });

async function handleSession(next: Session | null) {
  session = next;
  const userId = next?.user.id ?? null;
  setState({ email: next?.user.email ?? null, profile: next ? profileFrom(next.user) : undefined });
  if (userId !== handleOwner) fetchHandle(userId);
  if (userId === handledUser) return;
  handledUser = userId;
  if (!userId) return setState({ status: 'idle' });

  if (linkedUser !== userId) {
    // Stories left from another account (its session expired) are treated like any local stories.
    if (linkedUser) await unlink();
    const count = await db.stories.count();
    if (count > 0) {
      const ok = await ask({
        title: 'Juntar à sua conta?',
        message: (
          <>
            <p>
              {count === 1 ? 'Juntar a história deste aparelho à sua conta?' : `Juntar as ${count} histórias deste aparelho à sua conta?`}
            </p>
            <p>Elas passam a ficar guardadas na nuvem e aparecem nos outros aparelhos em que você entrar. Em “Agora não”, você sai da conta e tudo continua só aqui.</p>
          </>
        ),
        confirm: 'Juntar',
        cancel: 'Agora não',
      });
      if (!ok) {
        handledUser = undefined;
        await supabase!.auth.signOut({ scope: 'local' });
        return;
      }
    }
    await link(userId);
  }
  syncNow();
}

let started = false;
let latestSession: Session | null = null;

if (supabase) {
  supabase.auth.onAuthStateChange((event, next) => {
    if (event === 'PASSWORD_RECOVERY') setState({ recovering: true });
    latestSession = next;
    // Calls back into Supabase must not run inside this callback.
    if (started) setTimeout(() => handleSession(next), 0);
  });
}

/** Starts accounts and sync. Call once the interface (and its dialogs) is on screen. */
export async function startSync() {
  if (started) return;
  started = true;
  const HOUR = 60 * 60 * 1000;
  // With an account, the trash is emptied only after the first pull, so a story
  // restored on another device is not deleted here from an old copy.
  const purge = () => (!linkedUser || pulledOnce) && purgeTrash();

  if (!supabase) {
    purgeTrash();
    setInterval(purgeTrash, HOUR);
    return;
  }

  linkedUser = (await getMeta<string>('userId')) ?? null;
  setState({ linked: !!linkedUser, ...(await countPending()) });
  purge();
  setInterval(purge, HOUR);
  setInterval(() => syncNow(), 60 * 1000);
  window.addEventListener('online', () => syncNow());
  window.addEventListener('offline', () => state.linked && setState({ status: 'offline' }));
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && syncNow());

  await verifyEmailLink();
  const { data } = await supabase.auth.getSession();
  await handleSession(data.session ?? latestSession);
  await reportAuthError();
}

/** Takes the ?token_hash=...&type=... params out of the address bar. */
function takeParams(names: string[]) {
  const url = new URL(window.location.href);
  const values = names.map((name) => url.searchParams.get(name));
  if (values.every((v) => v === null)) return values;
  for (const name of names) url.searchParams.delete(name);
  window.history.replaceState(window.history.state, '', url.toString());
  return values;
}

/**
 * The e-mail templates link to ?token_hash=...&type=email|recovery (see
 * supabase/emails). Unlike ?code=, it works in any browser, so an account
 * created on the computer can be confirmed from the phone.
 */
async function verifyEmailLink() {
  const [tokenHash, type] = takeParams(['token_hash', 'type']);
  if (!tokenHash || (type !== 'email' && type !== 'recovery')) return;
  const { error } = await supabase!.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) {
    await tell({
      title: 'Não foi possível usar este link',
      message: type === 'recovery'
        ? 'Este link expirou ou já foi usado. Peça um novo em “Esqueci a senha” e abra o mais recente.'
        : 'Este link expirou ou já foi usado. Se você já confirmou a conta, é só entrar com seu e-mail e senha.',
    });
  }
}

/**
 * Google and e-mail links come back with ?error=... when something failed
 * (the author cancelled, or the link expired). Supabase leaves it in the URL.
 */
async function reportAuthError() {
  const url = new URL(window.location.href);
  const hash = url.hash.startsWith('#error') ? new URLSearchParams(url.hash.slice(1)) : null;
  const params = hash ?? url.searchParams;
  const code = params.get('error_code') ?? params.get('error');
  // A ?code= still here was not exchanged: it was opened in another browser.
  const leftover = url.searchParams.has('code');
  if (!code && !leftover) return;
  for (const name of ['error', 'error_code', 'error_description', 'code']) url.searchParams.delete(name);
  if (hash) url.hash = '';
  window.history.replaceState(window.history.state, '', url.toString());

  if (!code) {
    return tell({
      title: 'Entre de novo',
      message: 'Não deu para concluir a entrada por este link. Se ele era a confirmação da conta, ela já está confirmada: é só entrar.',
    });
  }
  if (code === 'access_denied') return; // cancelled on Google's screen
  await tell({
    title: 'Não foi possível entrar',
    message: code === 'otp_expired'
      ? 'Este link expirou ou já foi usado. Peça um novo e abra o mais recente.'
      : 'Algo deu errado na volta para o Lirismo. Tente entrar de novo.',
  });
}

/* ---------- Leaving the account ---------- */

/** Local changes not yet on the server (or that never fit there); tries to send them first. */
export async function unsentChanges() {
  if (linkedUser) await syncNow(true);
  const { pending, held } = await countPending();
  return pending + held;
}

/** Erases this browser's stories and drafts. */
export async function eraseLocal() {
  await db.transaction('rw', SYNCED_TABLES.map((t) => db.table(t)), async (tx) => {
    markFromSync(tx.idbtrans);
    await Promise.all(SYNCED_TABLES.map((t) => db.table(t).clear()));
  });
  Object.keys(localStorage)
    // The theme and sheet color are the device's, not the account's.
    .filter((k) => k.startsWith('lirismo:') && k !== 'lirismo:tema' && k !== 'lirismo:folha')
    .forEach((k) => localStorage.removeItem(k));
}

/** Signs out; without `keepCopy`, also erases this browser's stories. */
export async function signOut(keepCopy: boolean) {
  await unlink();
  forgetPhoto();
  if (!keepCopy) await eraseLocal();
  handledUser = null;
  await supabase?.auth.signOut({ scope: 'local' });
}

/**
 * Deletes the account, its stories in the cloud and its covers (Edge Function
 * supabase/functions/excluir-conta), then signs out. This browser's copy stays
 * until eraseLocal().
 */
export async function deleteAccount() {
  const { error } = await supabase!.functions.invoke('excluir-conta', { method: 'POST' });
  if (error) throw error;
  await unlink();
  forgetPhoto();
  handledUser = null;
  // The server no longer knows the session; signing out only clears it here.
  await supabase!.auth.signOut({ scope: 'local' });
}

export const pendingLabel = (n: number) => plural(n, 'mudança ainda não enviada', 'mudanças ainda não enviadas');
