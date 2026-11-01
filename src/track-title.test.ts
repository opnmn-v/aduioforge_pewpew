import { afterEach, expect, it, vi } from "vitest";
import { trackTitle } from "./track-title";

afterEach(() => vi.unstubAllGlobals());

it("decodes Dropbox filenames without query parameters or audio extensions", async () => {
  expect(await trackTitle("https://www.dropbox.com/scl/fi/abc/Night%20Rain.mp3?rlkey=secret&dl=0")).toBe("Night Rain");
  expect(await trackTitle("invalid")).toBeUndefined();
});

it("uses YouTube oEmbed for watch and short links, and tolerates unavailable metadata", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ title: "Forest music" }) });
  vi.stubGlobal("fetch", fetcher);
  expect(await trackTitle("https://youtu.be/abcdefghijk")).toBe("Forest music");
  expect(new URL(fetcher.mock.calls[0][0]).searchParams.get("url")).toBe("https://www.youtube.com/watch?v=abcdefghijk");
  fetcher.mockRejectedValue(new Error("Network unavailable"));
  expect(await trackTitle("https://www.youtube.com/watch?v=abcdefghijk")).toBeUndefined();
});
