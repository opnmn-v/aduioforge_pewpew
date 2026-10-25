import { afterEach, describe, expect, it, vi } from "vitest";
import { starterLibrary } from "./model";
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
describe("library persistence", () => {
  it("loads the local backup when IndexedDB is empty, not just when it errors", async () => {
    const library = starterLibrary(); library.folders[0].name = "Saved music";
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify(library) });
    vi.stubGlobal("indexedDB", { open: () => {
      const open: any = {};
      queueMicrotask(() => { open.result = { close: vi.fn(), transaction: () => ({ objectStore: () => ({ get: () => {
        const request: any = {}; queueMicrotask(() => { request.result = undefined; request.onsuccess(); }); return request;
      } }) }) }; open.onsuccess(); });
      return open;
    } });
    const { loadLibrary } = await import("./storage"); expect(await loadLibrary()).toEqual(library);
  });
  it("still saves to IndexedDB if localStorage is full, and waits for commit", async () => {
    vi.stubGlobal("localStorage", { setItem: () => { throw new Error("Quota"); } });
    const committed: string[] = [];
    vi.stubGlobal("indexedDB", { open: () => {
      const open: any = {};
      queueMicrotask(() => { open.result = { close: vi.fn(), transaction: () => {
        const transaction: any = { objectStore: () => ({ put: (library: any) => {
          setTimeout(() => { committed.push(library.library.folders[0].name); transaction.oncomplete(); }, 0);
        } }) }; return transaction;
      } }; open.onsuccess(); }); return open;
    } });
    const { saveLibrary } = await import("./storage"); const library = starterLibrary(); library.folders[0].name = "First";
    const a = saveLibrary(library); library.folders[0].name = "Second"; const b = saveLibrary(library);
    await Promise.all([a, b]); expect(committed).toEqual(["First", "Second"]);
  });
  it("prefers a newer fallback after an IndexedDB write failed", async () => {
    const old = starterLibrary(), fresh = starterLibrary(); fresh.folders[0].name = "Newest";
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ library: fresh, savedAt: 20 }) });
    vi.stubGlobal("indexedDB", { open: () => {
      const open: any = {};
      queueMicrotask(() => { open.result = { close: vi.fn(), transaction: () => ({ objectStore: () => ({ get: () => {
        const request: any = {}; queueMicrotask(() => { request.result = { library: old, savedAt: 10 }; request.onsuccess(); }); return request;
      } }) }) }; open.onsuccess(); }); return open;
    } });
    const { loadLibrary } = await import("./storage"); expect(await loadLibrary()).toEqual(fresh);
  });
  it("rejects if both storage systems fail", async () => {
    vi.stubGlobal("localStorage", { setItem: () => { throw new Error("Quota"); } });
    vi.stubGlobal("indexedDB", { open: () => { throw new Error("Unavailable"); } });
    const { saveLibrary } = await import("./storage"); await expect(saveLibrary(starterLibrary())).rejects.toThrow();
  });
});
