import Dexie, { type Table } from 'dexie';
import type { Session } from '@supabase/supabase-js';
import { db, purgeTrash, type Story } from '../db';
import { ask, tell } from '../components/Ask';
import { plural } from '../lib/text';
import { markFromSync, onLocalChanges, SYNCED_TABLES, type ChangeKey, type SyncedTable } from './middleware';
import { supabase } from './supabase';

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
 */

type OutboxItem = { key: string; kind: SyncedTable; id: string; stamp: string };
type Meta = { key: string; value: unknown };
type CoverCache = { storyId: string; hash: string };

const syncDb = new Dexie('lirismo-sync') as Dexie & {
  outbox: Table<OutboxItem, string>;
  meta: Table<Meta, string>;
  covers: Table<CoverCache, string>;
};
syncDb.version(1).stores({ outbox: 'key', meta: 'key', covers: 'storyId' });

type Row = { kind: SyncedTable; id: string; data: Record<string, unknown> | null; deleted: boolean; rev: number };

const recordKey = (kind: string, id: string) => `${kind}/${id}`;
const getMeta = async <T,>(key: string) => (await syncDb.meta.get(key))?.value as T | undefined;
const setMeta = (key: string, value: unknown) => syncDb.meta.put({ key, value });

/* ---------- State shown in the interface ---------- */

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

export type AccountState = {
  /** The variables are set, so accounts exist at all. */
  configured: boolean;
  /** Signed in now. */
  email: string | null;
  /** This browser's stories are tied to an account (even if the session expired). */
  linked: boolean;
  status: SyncStatus;
  pending: number;
  lastSync?: number;
  /** Came back from a "forgot my password" link: ask for the new one. */
  recovering: boolean;
};

let state: AccountState = { configured: !!supabase, email: null, linked: false, status: 'idle', pending: 0, recovering: false };
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

async function enqueue(changes: ChangeKey[]) {
  const items = new Map<string, OutboxItem>();
  for (const c of changes) items.set(recordKey(c.kind, c.id), { key: recordKey(c.kind, c.id), ...c, stamp: crypto.randomUUID() });
  await syncDb.outbox.bulkPut([...items.values()]);
  setState({ pending: await syncDb.outbox.count() });
}

onLocalChanges((changes) => {
  if (!linkedUser) return;
  enqueue(changes).then(() => {
    window.clearTimeout(pushTimer);
    pushTimer = window.setTimeout(syncNow, PUSH_DELAY);
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
}

/** The story as stored on the server: the image goes to Storage, the row keeps its path. */
async function storyToWire({ coverImage, ...story }: Story) {
  if (!coverImage) {
    await removeCover(story.id);
    return story;
  }
  const hash = await blobHash(coverImage);
  if ((await syncDb.covers.get(story.id))?.hash !== hash) {
    const { error } = await supabase!.storage
      .from('covers')
      .upload(coverPath(story.id), coverImage, { upsert: true, contentType: coverImage.type || undefined });
    if (error) throw error;
    await syncDb.covers.put({ storyId: story.id, hash });
  }
  return { ...story, coverPath: coverPath(story.id), coverHash: hash };
}

/* ---------- Push ---------- */

const MAX_BATCH_BYTES = 1_000_000;

async function push() {
  for (let round = 0; round < 50; round++) {
    const items = await syncDb.outbox.limit(100).toArray();
    if (!items.length) return;
    const rows = [];
    let bytes = 0;
    for (const item of items) {
      const record = await db.table(item.kind).get(item.id);
      let data: Record<string, unknown> | null = null;
      if (record) data = item.kind === 'stories' ? await storyToWire(record) : record;
      else if (item.kind === 'stories') await removeCover(item.id);
      rows.push({ user_id: linkedUser, kind: item.kind, id: item.id, data, deleted: !record });
      bytes += data ? JSON.stringify(data).length : 0;
      if (bytes > MAX_BATCH_BYTES) break;
    }
    const { error } = await supabase!.from('records').upsert(rows, { onConflict: 'user_id,kind,id' });
    if (error) throw error;
    // A record changed again while it was being sent stays in the outbox for the next round.
    const sent = items.slice(0, rows.length);
    await syncDb.transaction('rw', syncDb.outbox, async () => {
      for (const item of sent) {
        if ((await syncDb.outbox.get(item.key))?.stamp === item.stamp) await syncDb.outbox.delete(item.key);
      }
    });
    setState({ pending: await syncDb.outbox.count() });
  }
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
  const { coverImage: _i, coverPath: _p, coverHash: _h, ...rest } = record;
  return rest;
}

/**
 * The cover for a story coming from the server. `same` means the local story
 * already has that image (or neither has one), so it need not be replaced.
 */
async function remoteCover(storyId: string, data: Record<string, unknown>): Promise<{ blob?: Blob; same: boolean }> {
  const local = await db.stories.get(storyId);
  if (typeof data.coverPath !== 'string') return { same: !local?.coverImage };
  if (local?.coverImage && (await syncDb.covers.get(storyId))?.hash === data.coverHash) return { blob: local.coverImage, same: true };
  const { data: blob, error } = await supabase!.storage.from('covers').download(data.coverPath);
  if (error || !blob) return { blob: local?.coverImage, same: true };
  await syncDb.covers.put({ storyId, hash: String(data.coverHash) });
  return { blob, same: false };
}

async function applyRemote(rows: Row[]) {
  const waiting = new Set(await syncDb.outbox.where('key').anyOf(rows.map((r) => recordKey(r.kind, r.id))).primaryKeys());
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
let pulledOnce = false;

async function syncOnce() {
  if (!supabase || !linkedUser || session?.user.id !== linkedUser) return;
  if (!navigator.onLine) return setState({ status: 'offline' });
  setState({ status: 'syncing' });
  try {
    if (await getMeta<boolean>('merging')) await merge();
    await push();
    await pull();
    setState({ status: 'synced', lastSync: Date.now(), pending: await syncDb.outbox.count() });
    if (!pulledOnce) {
      pulledOnce = true;
      purgeTrash();
    }
  } catch (err) {
    console.warn('Sincronização falhou', err);
    setState({ status: navigator.onLine ? 'error' : 'offline' });
  }
}

/** Syncs now; if a sync is already running, runs once more after it. */
export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await syncOnce();
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
  await syncDb.transaction('rw', syncDb.outbox, syncDb.meta, syncDb.covers, async () => {
    await syncDb.outbox.clear();
    await syncDb.meta.clear();
    await syncDb.covers.clear();
  });
  setState({ linked: false, pending: 0, status: 'idle', lastSync: undefined });
}

let handledUser: string | null | undefined;

async function handleSession(next: Session | null) {
  session = next;
  const userId = next?.user.id ?? null;
  setState({ email: next?.user.email ?? null });
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
              {count === 1 ? 'Juntar a história deste navegador à sua conta?' : `Juntar as ${count} histórias deste navegador à sua conta?`}
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
  setState({ linked: !!linkedUser, pending: await syncDb.outbox.count() });
  purge();
  setInterval(purge, HOUR);
  setInterval(syncNow, 60 * 1000);
  window.addEventListener('online', () => syncNow());
  window.addEventListener('offline', () => state.linked && setState({ status: 'offline' }));
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && syncNow());

  const { data } = await supabase.auth.getSession();
  await handleSession(data.session ?? latestSession);
  await reportAuthError();
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
  const link = url.searchParams.get('link');
  // Supabase only exchanges ?code= in the browser that asked for it; one still
  // here means the e-mail was opened elsewhere (often the phone).
  const elsewhere = url.searchParams.has('code');
  if (!code && !link && !elsewhere) return;
  for (const name of ['error', 'error_code', 'error_description', 'link', 'code']) url.searchParams.delete(name);
  if (hash) url.hash = '';
  window.history.replaceState(window.history.state, '', url.toString());

  if (!code) {
    if (!elsewhere) return;
    if (link === 'confirmar') {
      return tell({ title: 'Conta confirmada', message: 'Seu e-mail está confirmado. Agora é só entrar com seu e-mail e senha.' });
    }
    return tell({
      title: 'Abra o link no mesmo navegador',
      message: link === 'senha'
        ? 'Por segurança, o link para criar uma senha nova só funciona no navegador em que você o pediu. Abra-o lá, ou peça um novo aqui.'
        : 'Este link só funciona no navegador em que foi pedido. Se era a confirmação da conta, ela já está confirmada: entre com seu e-mail e senha.',
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

/** Local changes not yet on the server; tries to send them first. */
export async function unsentChanges() {
  if (linkedUser) await syncNow();
  return syncDb.outbox.count();
}

/** Signs out; without `keepCopy`, also erases this browser's stories. */
export async function signOut(keepCopy: boolean) {
  await unlink();
  if (!keepCopy) {
    await db.transaction('rw', SYNCED_TABLES.map((t) => db.table(t)), async (tx) => {
      markFromSync(tx.idbtrans);
      await Promise.all(SYNCED_TABLES.map((t) => db.table(t).clear()));
    });
    Object.keys(localStorage)
      .filter((k) => k.startsWith('lirismo:'))
      .forEach((k) => localStorage.removeItem(k));
  }
  handledUser = null;
  await supabase?.auth.signOut({ scope: 'local' });
}

export const pendingLabel = (n: number) => plural(n, 'mudança ainda não enviada', 'mudanças ainda não enviadas');
