import { ActiveScene, PlaybackState, Scene, Track } from "./model";

export function activeTracks(active: ActiveScene): Track[] {
  const tracks = active.trackId ? active.scene.tracks.filter(track => track.id === active.trackId) : active.scene.tracks;
  return active.playlistQueue ? tracks.map(track => ({ ...track, loop: false, seamlessLoop: false, delayMin: 0, delayMax: 0 })) : tracks;
}

// Pause intervals overlap. Moving both clocks avoids counting a global pause twice
// when a scene was already paused before it began.
export function resumePlayback(state: PlaybackState, now: number): PlaybackState {
  const duration = state.pausedAt === undefined ? 0 : Math.max(0, now - state.pausedAt);
  return {
    ...state, status: "playing", pausedAt: undefined,
    active: state.active.map(item => ({ ...item, startedAt: item.startedAt + duration,
      pausedAt: item.pausedAt === undefined ? undefined : item.pausedAt + duration })),
  };
}

export function playbackOffset(startedAt: number, now: number, duration?: number, loop = true): number {
  const elapsed = Math.max(0, (now - startedAt) / 1000);
  if (!duration || !Number.isFinite(duration) || duration <= 0) return elapsed;
  return loop ? elapsed % duration : Math.min(elapsed, duration);
}

/** One shuffled bag per cycle; the previous track cannot lead the next cycle. */
export function playlistNext(scene: Scene, previous?: ActiveScene, now = Date.now(), random = Math.random): ActiveScene | undefined {
  const eligible = scene.tracks.filter(track => !track.muted && track.url.trim()).map(track => track.id);
  if (!eligible.length) return undefined;
  let queue = (previous?.playlistQueue ?? []).filter(id => eligible.includes(id));
  if (!queue.length) {
    queue = [...eligible];
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    if (queue.length > 1 && queue[0] === previous?.trackId) [queue[0], queue[1]] = [queue[1], queue[0]];
  }
  const [trackId, ...playlistQueue] = queue;
  return { scene, startedAt: now, trackId, playlistQueue, playlistOwner: previous?.playlistOwner, instanceId: crypto.randomUUID() };
}

/** Choose randomly from the unplayed remainder without restarting the cycle. */
export function playlistRandomNext(scene: Scene, previous?: ActiveScene, now = Date.now(), random = Math.random): ActiveScene | undefined {
  if (!previous?.playlistQueue?.length) return playlistNext(scene, previous, now, random);
  const queue = [...previous.playlistQueue];
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  return playlistNext(scene, { ...previous, playlistQueue: queue }, now, random);
}

/** Reset the bag to the entire playlist and start a new shuffled cycle. */
export function playlistShuffle(scene: Scene, previous?: ActiveScene, now = Date.now(), random = Math.random): ActiveScene | undefined {
  return playlistNext(scene, previous ? { ...previous, playlistQueue: [] } : undefined, now, random);
}
