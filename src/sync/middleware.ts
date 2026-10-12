import type { DBCore, DBCoreMutateRequest, DBCoreTransaction, Middleware } from 'dexie';

/** The tables copied to the account; each record becomes one row on the server. */
export const SYNCED_TABLES = ['stories', 'chapters', 'versions', 'entries', 'scenes', 'threads'] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];
export type ChangeKey = { kind: SyncedTable; id: string };

const isSynced = (name: string): name is SyncedTable => (SYNCED_TABLES as readonly string[]).includes(name);

/** Set on transactions that apply changes from the server, so they are not sent back. */
const FROM_SYNC = '__lirismoFromSync';

export function markFromSync(trans: unknown) {
  (trans as Record<string, boolean>)[FROM_SYNC] = true;
}

let listener: ((changes: ChangeKey[]) => void) | null = null;

/** Called with the keys a transaction wrote, once it has committed. */
export function onLocalChanges(fn: (changes: ChangeKey[]) => void) {
  listener = fn;
}

/** Keys a write touches. where(...).delete() arrives as a range, so it is looked up first. */
function changedKeys(table: ReturnType<DBCore['table']>, req: DBCoreMutateRequest): unknown[] | Promise<unknown[]> {
  switch (req.type) {
    case 'add':
    case 'put':
      return req.keys ?? req.values.map((v) => table.schema.primaryKey.extractKey!(v));
    case 'delete':
      return req.keys;
    case 'deleteRange':
      return table
        .query({ trans: req.trans, values: false, query: { index: table.schema.primaryKey, range: req.range } })
        .then((res) => res.result);
  }
}

/**
 * Notes every record written to a synced table, so the sync can send it.
 * The keys are handed over only after the transaction commits.
 */
export const syncMiddleware: Middleware<DBCore> = {
  stack: 'dbcore',
  name: 'LirismoSync',
  // Right above IndexedDB itself: nothing below needs Dexie's transaction zone,
  // so waiting for the key lookup here cannot break it.
  level: -10,
  create(down) {
    const pending = new WeakMap<DBCoreTransaction, ChangeKey[]>();
    return {
      ...down,
      transaction(stores, mode, options) {
        const trans = down.transaction(stores, mode, options);
        if (mode === 'readwrite') {
          const changes: ChangeKey[] = [];
          pending.set(trans, changes);
          (trans as unknown as IDBTransaction).addEventListener('complete', () => {
            if (changes.length && !(trans as unknown as Record<string, boolean>)[FROM_SYNC]) listener?.(changes);
          });
        }
        return trans;
      },
      table(name) {
        const table = down.table(name);
        if (!isSynced(name)) return table;
        return {
          ...table,
          mutate(req) {
            const changes = pending.get(req.trans);
            if (!changes || (req.trans as unknown as Record<string, boolean>)[FROM_SYNC]) return table.mutate(req);
            const record = (keys: unknown[]) =>
              table.mutate(req).then((res) => {
                keys.forEach((id, i) => {
                  if (!res.failures[i]) changes.push({ kind: name, id: String(id) });
                });
                return res;
              });
            const keys = changedKeys(table, req);
            return Array.isArray(keys) ? record(keys) : keys.then(record);
          },
        };
      },
    };
  },
};
