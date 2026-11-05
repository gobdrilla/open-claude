// Local history as in Rider/IntelliJ: every saved version of a file and every version before an outside change
// (Claude, git checkout), kept in the webview's IndexedDB, independent of git. Shown and restored by HistoryDialog.
// shortcut: lives in the webview profile (gone if its data is cleared); move to the app data dir if that matters.

export type Snap = { id: number; key: string; time: number; text: string; why: string };

const MAX_TEXT = 2_000_000;
/** Newest versions kept per file, and how long. */
export const KEEP = 50;
export const DAYS = 30;

const key = (repo: string, path: string) => `${repo}\n${path}`;

/** ids to drop: beyond the newest KEEP or older than DAYS; the newest one always stays. */
export function prune(snaps: { id: number; time: number }[], now: number): number[] {
  const old = now - DAYS * 86_400_000;
  return [...snaps]
    .sort((a, b) => b.time - a.time || b.id - a.id)
    .filter((s, i) => i > 0 && (i >= KEEP || s.time < old))
    .map((s) => s.id);
}

let db: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  db ??= new Promise((resolve, reject) => {
    const r = indexedDB.open("local-history", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("snaps", { keyPath: "id", autoIncrement: true }).createIndex("key", "key");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => {
      db = null;
      reject(r.error);
    };
  });
  return db;
}

const done = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

/** Versions of the file, newest first. */
export async function history(repo: string, path: string): Promise<Snap[]> {
  const d = await open();
  const all = await done(d.transaction("snaps").objectStore("snaps").index("key").getAll(key(repo, path)) as IDBRequest<Snap[]>);
  return all.sort((a, b) => b.time - a.time || b.id - a.id);
}

/** Keep this version unless it equals the newest one; best effort, a failing store must never block saving. */
export async function record(repo: string, path: string, text: string, why: string): Promise<void> {
  if (text.length > MAX_TEXT) return;
  try {
    const all = await history(repo, path);
    if (all[0]?.text === text) return;
    const now = Date.now();
    const d = await open();
    const id = await done(d.transaction("snaps", "readwrite").objectStore("snaps").add({ key: key(repo, path), time: now, text, why }));
    // Own transaction: one may already have ended by the time an awaited request continues.
    const drop = prune([...all, { id: id as number, time: now }], now);
    if (drop.length) {
      const store = d.transaction("snaps", "readwrite").objectStore("snaps");
      for (const old of drop) store.delete(old);
    }
  } catch (e) {
    console.warn("local history", e);
  }
}
