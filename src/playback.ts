import { ActiveScene, PlaybackState, Scene, Track } from "./model";

export function activeTracks(active: ActiveScene): Track[] {
  return active.trackId ? active.scene.tracks.filter(track => track.id === active.trackId) : active.scene.tracks;
}

export function chooseRandom<T extends { id: string }>(items: T[], previousId?: string, random = Math.random): T | undefined {
  const candidates = items.length > 1 ? items.filter(item => item.id !== previousId) : items;
  return candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
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

export function replaceFolderScene(state: PlaybackState, scene: Scene, now: number): PlaybackState {
  const resumed = state.status === "paused" ? resumePlayback(state, now) : state;
  return { ...resumed, active: [...resumed.active.filter(item => item.scene.folderId !== scene.folderId), { scene, startedAt: now, instanceId: crypto.randomUUID() }] };
}
