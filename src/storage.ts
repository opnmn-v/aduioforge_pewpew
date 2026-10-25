import { Library, starterLibrary, validLibrary } from "./model";

const DB_NAME = "ambient-forge";
const STORE_NAME = "library";
const KEY = "main";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
type Snapshot = { library: Library; savedAt: number };
function snapshot(value: unknown): Snapshot | null {
  if (validLibrary(value)) return { library: value, savedAt: 0 }; // migrate legacy storage lazily
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<Snapshot>;
  return validLibrary(item.library) && typeof item.savedAt === "number" && Number.isFinite(item.savedAt)
    ? { library: item.library, savedAt: item.savedAt } : null;
}
function fallbackSnapshot(): Snapshot | null {
  try { return snapshot(JSON.parse(localStorage.getItem(DB_NAME) || "null")); }
  catch { return null; }
}
export async function loadLibrary(): Promise<Library> {
  let db: IDBDatabase | undefined;
  const fallback = fallbackSnapshot();
  try {
    db = await openDb();
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = db!.transaction(STORE_NAME).objectStore(STORE_NAME).get(KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const stored = snapshot(value);
    if (fallback && (!stored || fallback.savedAt > stored.savedAt)) return fallback.library;
    return stored?.library ?? fallback?.library ?? starterLibrary();
  } catch { return fallback?.library ?? starterLibrary(); }
  finally { db?.close(); }
}
let saveSequence = 0;
let writes: Promise<void> = Promise.resolve();
export function saveLibrary(library: Library): Promise<void> {
  const captured = structuredClone(library);
  const write = writes.catch(() => undefined).then(async () => {
    const saved = { library: captured, savedAt: Date.now() * 1000 + (++saveSequence % 1000) };
    let fallbackSaved = false;
    try { localStorage.setItem(DB_NAME, JSON.stringify(saved)); fallbackSaved = true; } catch { /* IndexedDB may still work */ }
    let db: IDBDatabase | undefined;
    try {
      db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const transaction = db!.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).put(saved, KEY);
        // A successful request does not guarantee a committed transaction.
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } catch (error) { if (!fallbackSaved) throw error; }
    finally { db?.close(); }
  });
  writes = write;
  return write;
}
