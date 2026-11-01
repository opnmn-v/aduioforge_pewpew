import { describe, expect, it } from "vitest";
import { activeTracks, playlistNext, playlistRandomNext, playlistShuffle, playbackOffset, resumePlayback } from "./playback";
import { Scene, emptyState } from "./model";
const a = { id: "a", folderId: "music" } as Scene;
describe("random launch and clocks", () => {
  it("shuffles a full cycle, excludes muted tracks, then starts another cycle without an immediate repeat", () => {
    const tracks = ["a", "b", "c", "muted"].map(id => ({ id, url: `https://example.com/${id}.mp3`, muted: id === "muted", loop: true }));
    const scene = { id: "playlist", tracks } as Scene;
    let active = playlistNext(scene, undefined, 0, () => 0)!;
    const ids = [active.trackId];
    for (let i = 0; i < 2; i++) { active = playlistNext(scene, active, i + 1, () => 0)!; ids.push(active.trackId); }
    expect(new Set(ids)).toEqual(new Set(["a", "b", "c"]));
    const next = playlistNext(scene, active, 4, () => 0)!;
    expect(next.trackId).not.toBe(active.trackId);
    expect(activeTracks(next)).toEqual([expect.objectContaining({ id: next.trackId, loop: false, seamlessLoop: false })]);
    expect(playlistNext({ ...scene, tracks: [] })).toBeUndefined();
    const single = { ...scene, tracks: [scene.tracks[0]] };
    const first = playlistNext(single)!;
    expect(playlistNext(single, first)?.trackId).toBe(first.trackId);
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

it("Next chooses only unplayed tracks; Shuffle resets the entire cycle", () => {
  const scene = { id: "p", tracks: ["a", "b", "c", "d"].map(id => ({ id, url: `https://example.com/${id}`, muted: false })) } as Scene;
  const previous = { scene, startedAt: 1, trackId: "b", playlistQueue: ["c", "d"], playlistOwner: "gm" };
  const next = playlistRandomNext(scene, previous, 2, () => 0)!;
  expect(next.trackId).toBe("d");
  expect(next.playlistQueue).toEqual(["c"]);
  const shuffled = playlistShuffle(scene, previous, 2, () => 0)!;
  expect(shuffled.trackId).not.toBe(previous.trackId);
  expect(new Set([shuffled.trackId, ...shuffled.playlistQueue!])).toEqual(new Set(["a", "b", "c", "d"]));
  expect(shuffled.playlistOwner).toBe("gm");
  expect(previous.playlistQueue).toEqual(["c", "d"]);
});
