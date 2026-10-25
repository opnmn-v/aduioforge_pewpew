import { describe, expect, it } from "vitest";
import { chooseRandom, playbackOffset, replaceFolderScene, resumePlayback } from "./playback";
import { Scene, emptyState } from "./model";
const a = { id: "a", folderId: "music" } as Scene;
const b = { id: "b", folderId: "music" } as Scene;
const rain = { id: "rain", folderId: "ambience" } as Scene;
describe("random launch and clocks", () => {
  it("avoids an immediate repeat, handles singletons and empty playlists", () => {
    expect(chooseRandom([a, b], "a", () => 0)).toBe(b);
    expect(chooseRandom([a], "a", () => 0)).toBe(a);
    expect(chooseRandom([], undefined, () => 0)).toBeUndefined();
  });
  it("changes only the music folder, preserving rain and its position", () => {
    const state = { ...emptyState(), active: [{ scene: a, startedAt: 1 }, { scene: rain, startedAt: 2 }] };
    expect(replaceFolderScene(state, b, 5000).active).toEqual([{ scene: rain, startedAt: 2 }, expect.objectContaining({ scene: b, startedAt: 5000 })]);
  });
  it("counts overlapping scene/global pauses only once", () => {
    const state = { ...emptyState(), status: "paused" as const, pausedAt: 4000, active: [{ scene: a, startedAt: 1000, pausedAt: 3000 }] };
    const resumed = resumePlayback(state, 8000);
    expect(resumed.active[0].startedAt).toBe(5000);
    expect(resumed.active[0].pausedAt).toBe(7000);
    // Scene resumes at 9000: shift start by 9000 - 7000, leaving 2s elapsed.
    expect(playbackOffset(7000, 9000, 60)).toBe(2);
  });
  it("wraps looped audio but clamps one-shots, and tolerates unknown/live duration", () => {
    expect(playbackOffset(0, 130000, 60, true)).toBe(10);
    expect(playbackOffset(0, 130000, 60, false)).toBe(60);
    expect(playbackOffset(0, 130000, Infinity)).toBe(130);
    expect(playbackOffset(2000, 1000, 60)).toBe(0);
  });
});
