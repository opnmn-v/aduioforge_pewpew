import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BufferedAudio, MAX_LOOP_BYTES } from "./buffered-audio";
class FakeContext {
  static latest: FakeContext;
  state = "running"; currentTime = 0; destination = {};
  sources: any[] = [];
  constructor() { FakeContext.latest = this; }
  createGain() { return { gain: { setValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() }; }
  async decodeAudioData() { return { duration: 2 }; }
  async resume() { this.state = "running"; }
  createBufferSource() {
    const source = { buffer: undefined, loop: false, onended: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() };
    this.sources.push(source); return source;
  }
}
beforeEach(() => {
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([0, 1]))));
});
afterEach(() => vi.unstubAllGlobals());
async function ready(audio: BufferedAudio) { await new Promise(resolve => audio.addEventListener("loadedmetadata", resolve, { once: true })); }
describe("buffered seamless audio", () => {
  it("uses a single looped source across many boundaries, without refetching", async () => {
    const audio = new BufferedAudio("https://example.com/loop.wav"); await ready(audio); await audio.play();
    const ctx = FakeContext.latest; expect(ctx.sources).toHaveLength(1); expect(ctx.sources[0].loop).toBe(true);
    ctx.currentTime = 21; expect(audio.currentTime).toBe(1); expect(ctx.sources).toHaveLength(1); expect(fetch).toHaveBeenCalledTimes(1);
    audio.removeAttribute("src"); expect(ctx.sources[0].stop).toHaveBeenCalledTimes(1);
  });
  it("pauses and resumes from the saved position with a new one-shot source node", async () => {
    const audio = new BufferedAudio("https://example.com/loop.wav"); await ready(audio); await audio.play();
    const ctx = FakeContext.latest, began = ctx.currentTime; ctx.currentTime = began + .75; audio.pause();
    expect(audio.paused).toBe(true); expect(audio.currentTime).toBeCloseTo(.75);
    await audio.play(); expect(ctx.sources.at(-1).start).toHaveBeenCalledWith(0, .75);
    audio.removeAttribute("src");
  });
  it("does not start after an asynchronous resume was cancelled by stop", async () => {
    const audio = new BufferedAudio("https://example.com/loop.wav"); await ready(audio);
    const promise = audio.play(); audio.removeAttribute("src");
    await expect(promise).rejects.toMatchObject({ name: "AbortError" }); expect(audio.paused).toBe(true);
  });
  it("fails visibly for files over the memory limit before decoding", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("large", { headers: { "content-length": String(MAX_LOOP_BYTES + 1) } })));
    const audio = new BufferedAudio("https://example.com/large.wav");
    await new Promise(resolve => audio.addEventListener("error", resolve, { once: true }));
    expect(Number.isNaN(audio.duration)).toBe(true); audio.removeAttribute("src");
  });
});
