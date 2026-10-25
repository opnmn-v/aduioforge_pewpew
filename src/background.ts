import OBR from "@owlbear-rodeo/sdk";
import {
  CHANNEL, LOCAL_CHANNEL, STATUS_CHANNEL, ActiveScene, AudioStatus, PlaybackFeedback, PlaybackState, Scene, SyncMessage, Track,
  emptyState, normalizeAudioUrl, sourceKind, validLocalMessage, validSyncMessage, youtubeId,
} from "./model";
import { BufferedAudio } from "./buffered-audio";
import { syncAccess } from "./sync-access";
import { activeTracks, playbackOffset } from "./playback";

interface YTPlayer {
  playVideo(): void; pauseVideo(): void; destroy(): void;
  setVolume(value: number): void; mute(): void; unMute(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getDuration(): number;
}
interface YTNamespace { Player: new (element: HTMLElement, options: Record<string, unknown>) => YTPlayer }
declare global { interface Window { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void } }

type Runtime = {
  key: string; instanceId?: string; scene: Scene; track: Track; startedAt: number; preview: boolean; source: string;
  audio?: HTMLAudioElement | BufferedAudio; player?: YTPlayer; host?: HTMLDivElement;
  fade?: number; retry?: number; settle?: number; repeatAt?: number; repeatRemaining?: number;
  ready: boolean; gain: number; paused: boolean; playbackRequested?: boolean;
  retiring: boolean; destroyed: boolean; began?: boolean; sought?: boolean;
  fadeStarted?: number; fadeDuration?: number; fadeFrom?: number; fadeTo?: number;
  appliedVolume?: number; appliedMute?: boolean; status: AudioStatus;
};
type PendingRuntime = { key: string; active: ActiveScene; track: Track; preview: boolean; previewRevision: number; source: string };
const runtimes = new Map<string, Runtime>();
const liveRuntimes = new Set<Runtime>();
const pendingRuntimes = new Map<string, PendingRuntime>();
let role: "GM" | "PLAYER" = "PLAYER";
let current = emptyState();
let preview: Scene | null = null;
let previewRevision = 0;
let master = { volume: 80, muted: false };
let lastMasterRevision = 0;
let ytReady: Promise<void> | null = null;
let audioUnlocked = false;

function loadMaster() {
  try {
    const value = JSON.parse(localStorage.getItem("ambient-forge-master") || "null") as typeof master | null;
    if (value && Number.isFinite(value.volume) && value.volume >= 0 && value.volume <= 100 && typeof value.muted === "boolean") master = value;
  } catch { /* use defaults */ }
}
function trackSource(track: Track) {
  const kind = sourceKind(track);
  return `${kind}:${track.seamlessLoop ? "buffer:" : ""}${kind === "audio" ? normalizeAudioUrl(track.url) : track.url.trim()}`;
}
function report(runtime: Runtime, status: AudioStatus, force = false) {
  if (runtime.destroyed || runtime.retiring || runtime.preview || (!force && runtime.status === status)) return;
  runtime.status = status;
  const message: PlaybackFeedback = { type: "PLAYBACK_STATUS", sceneId: runtime.scene.id, trackId: runtime.track.id, startedAt: runtime.startedAt, status };
  void OBR.broadcast.sendMessage(STATUS_CHANNEL, message, { destination: "LOCAL" }).catch(() => undefined);
}
function ensureYouTube(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (ytReady) return ytReady;
  ytReady = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => failed(), 15000);
    const failed = () => { clearTimeout(timeout); script.remove(); ytReady = null; reject(new Error("YouTube API unavailable")); };
    window.onYouTubeIframeAPIReady = () => { clearTimeout(timeout); resolve(); };
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = failed;
    document.head.append(script);
  });
  return ytReady;
}
function applyVolume(runtime: Runtime) {
  if (runtime.destroyed) return;
  const volume = Math.max(0, Math.min(1, master.volume / 100 * runtime.scene.volume / 100 * runtime.track.volume / 100 * runtime.gain));
  const muted = runtime.track.muted || master.muted || volume === 0;
  if (runtime.audio) { runtime.audio.volume = volume; runtime.audio.muted = muted; }
  // Commands before onReady can be lost (or throw). Repeated unMute commands
  // during another player's fade are unnecessary and can disturb iframe playback.
  if (runtime.player && runtime.ready) {
    const percent = Math.round(volume * 100);
    if (runtime.appliedVolume !== percent) { runtime.player.setVolume(percent); runtime.appliedVolume = percent; }
    if (runtime.appliedMute !== muted) {
      if (muted) runtime.player.mute(); else runtime.player.unMute();
      runtime.appliedMute = muted;
    }
  }
}
function shouldPlay(runtime: Runtime) {
  return audioUnlocked && liveRuntimes.has(runtime) && !runtime.retiring && !runtime.paused && (runtime.preview || current.status === "playing");
}
function clock(runtime: Runtime) {
  const active = current.active.find(item => item.scene.id === runtime.scene.id);
  return runtime.preview ? Date.now() : Math.min(Date.now(), active?.pausedAt ?? Infinity, current.pausedAt ?? Infinity);
}
function seek(runtime: Runtime) {
  const duration = runtime.audio?.duration ?? runtime.player?.getDuration();
  // YouTube may report duration=0 until PLAYING. Defer seeking until known.
  if (!duration || !Number.isFinite(duration) || duration <= 0) return;
  const offset = playbackOffset(runtime.startedAt, clock(runtime), duration, runtime.track.loop);
  runtime.sought = true;
  if (runtime.audio) runtime.audio.currentTime = offset;
  else runtime.player?.seekTo(offset, true);
}
function syncPlayback(runtime: Runtime) {
  if (runtime.destroyed || !runtime.ready) return;
  const play = shouldPlay(runtime);
  if (play && runtime.status === "ended" && !runtime.track.loop) return;
  if (!play && runtime.retry !== undefined) {
    clearTimeout(runtime.retry); runtime.retry = undefined;
    runtime.repeatRemaining = Math.max(0, (runtime.repeatAt ?? Date.now()) - Date.now());
  }
  if (play && runtime.repeatRemaining !== undefined) {
    if (runtime.retry === undefined) scheduleRepeat(runtime, runtime.repeatRemaining);
    return;
  }
  if (runtime.playbackRequested === play) return;
  runtime.playbackRequested = play;
  if (play) {
    if (runtime.audio) void runtime.audio.play().catch((error: unknown) => {
      if (error instanceof Error && error.name === "AbortError") return;
      if (!runtime.destroyed && !runtime.retiring && runtime.playbackRequested) {
        runtime.playbackRequested = undefined;
        report(runtime, error instanceof Error && error.name === "NotAllowedError" ? "blocked" : "error");
      }
    });
    runtime.player?.playVideo();
  } else { runtime.audio?.pause(); runtime.player?.pauseVideo(); report(runtime, audioUnlocked ? "paused" : "blocked"); }
}
function startFade(runtime: Runtime, from: number, to: number, duration: number, done?: () => void) {
  if (runtime.fade !== undefined) clearInterval(runtime.fade);
  if (runtime.settle !== undefined) clearTimeout(runtime.settle);
  runtime.settle = undefined;
  runtime.gain = from;
  runtime.fadeStarted = Date.now(); runtime.fadeDuration = duration; runtime.fadeFrom = from; runtime.fadeTo = to;
  applyVolume(runtime);
  const tick = () => {
    // Pause fade-in with playback. Fade-out is a stop operation and must finish.
    const now = Date.now();
    if (!runtime.retiring && !shouldPlay(runtime)) { runtime.fadeStarted! += now - lastTick; lastTick = now; return; }
    lastTick = now;
    const progress = Math.min(1, (now - runtime.fadeStarted!) / Math.max(1, duration));
    runtime.gain = from + (to - from) * progress;
    applyVolume(runtime);
    if (progress >= 1) {
      clearInterval(runtime.fade); runtime.fade = undefined;
      done?.();
    }
  };
  let lastTick = Date.now();
  runtime.fade = window.setInterval(tick, 40);
}
function onPlaying(runtime: Runtime) {
  if (runtime.destroyed || runtime.retiring) return;
  if (!shouldPlay(runtime)) { runtime.playbackRequested = undefined; syncPlayback(runtime); return; }
  if (!runtime.sought) seek(runtime);
  if (!runtime.began) {
    runtime.began = true;
    if (runtime.scene.fadeIn > 0) startFade(runtime, 0, 1, runtime.scene.fadeIn * 1000);
  }
  applyVolume(runtime);
  report(runtime, "playing");
}
function scheduleRepeat(runtime: Runtime, remaining?: number) {
  if (!runtime.track.loop || runtime.retiring || runtime.destroyed) { report(runtime, "ended"); return; }
  if (runtime.retry !== undefined) clearTimeout(runtime.retry);
  const min = Math.min(runtime.track.delayMin, runtime.track.delayMax);
  const max = Math.max(runtime.track.delayMin, runtime.track.delayMax);
  const delay = remaining ?? (min + Math.random() * (max - min)) * 1000;
  runtime.repeatRemaining = delay;
  report(runtime, "waiting");
  if (!shouldPlay(runtime)) return;
  runtime.repeatAt = Date.now() + delay;
  runtime.retry = window.setTimeout(() => {
    runtime.retry = undefined; runtime.repeatRemaining = undefined;
    if (!shouldPlay(runtime)) { runtime.repeatRemaining = 0; return; }
    if (runtime.audio) runtime.audio.currentTime = 0;
    runtime.player?.seekTo(0, true);
    runtime.playbackRequested = undefined; syncPlayback(runtime);
  }, delay);
}
function baseRuntime(scene: Scene, track: Track, startedAt: number, key: string, previewMode: boolean, paused: boolean): Runtime {
  return { key, scene, track, startedAt, preview: previewMode, source: trackSource(track), ready: false,
    gain: scene.fadeIn > 0 ? 0 : 1, paused, retiring: false, destroyed: false, status: "loading" };
}
function createAudio(scene: Scene, track: Track, startedAt: number, key: string, previewMode: boolean, paused: boolean) {
  const runtime = baseRuntime(scene, track, startedAt, key, previewMode, paused);
  const audio = track.seamlessLoop ? new BufferedAudio(normalizeAudioUrl(track.url)) : new Audio(); runtime.audio = audio;
  if (!(audio instanceof BufferedAudio)) audio.preload = "auto";
  audio.loop = track.loop && track.delayMax === 0 && track.delayMin === 0;
  audio.addEventListener("loadedmetadata", () => {
    if (runtime.destroyed) return;
    runtime.ready = true; seek(runtime); applyVolume(runtime); syncPlayback(runtime);
  });
  audio.addEventListener("playing", () => onPlaying(runtime));
  audio.addEventListener("waiting", () => report(runtime, "loading"));
  audio.addEventListener("pause", () => report(runtime, "paused"));
  audio.addEventListener("ended", () => scheduleRepeat(runtime));
  audio.addEventListener("error", () => { runtime.playbackRequested = undefined; report(runtime, "error"); });
  if (!(audio instanceof BufferedAudio)) audio.src = normalizeAudioUrl(track.url);
  applyVolume(runtime);
  return runtime;
}
async function createYouTube(request: PendingRuntime): Promise<Runtime | null> {
  const { active, track, key, preview: previewMode } = request;
  const videoId = youtubeId(track.url);
  if (!videoId) throw new Error("Invalid YouTube video URL");
  await ensureYouTube();
  if (!requestIsCurrent(request)) return null;
  // YT replaces its target div with an iframe. Keep an outer host to reliably
  // remove the actual iframe on cancellation, including before onReady.
  const host = document.createElement("div");
  const target = document.createElement("div"); host.append(target);
  host.style.cssText = "position:fixed;width:200px;height:200px;left:-10000px;top:0";
  document.getElementById("audio-root")?.append(host);
  const runtime = baseRuntime(active.scene, track, active.startedAt, key, previewMode, active.pausedAt !== undefined);
  runtime.host = host; runtime.instanceId = active.instanceId;
  runtime.player = new window.YT!.Player(target, {
    videoId, width: 200, height: 200,
    playerVars: { autoplay: 0, controls: 0, disablekb: 1, playsinline: 1, origin: location.origin },
    events: {
      onReady: () => {
        if (runtime.destroyed) return;
        runtime.ready = true; seek(runtime); applyVolume(runtime); syncPlayback(runtime);
      },
      onStateChange: (event: { data: number }) => {
        if (runtime.destroyed || runtime.retiring) return;
        if (event.data === 1) onPlaying(runtime);
        if (event.data === 3) report(runtime, "loading");
        if (event.data === 2) { runtime.playbackRequested = undefined; report(runtime, "paused"); }
        if (event.data === 0) { runtime.playbackRequested = undefined; scheduleRepeat(runtime); }
      },
      onAutoplayBlocked: () => { runtime.playbackRequested = undefined; report(runtime, "blocked"); },
      onError: () => { runtime.playbackRequested = undefined; report(runtime, "error"); },
    },
  });
  return runtime;
}
function requestIsCurrent(request: PendingRuntime) {
  if (pendingRuntimes.get(request.key) !== request) return false;
  if (request.preview) return request.previewRevision === previewRevision && preview?.id === request.active.scene.id
    && preview.tracks.some(track => track.id === request.track.id && trackSource(track) === request.source);
  if (current.scope !== "GLOBAL" && role !== "GM") return false;
  const active = current.active.find(item => item.scene.id === request.active.scene.id && item.startedAt === request.active.startedAt && item.instanceId === request.active.instanceId);
  return !!active && activeTracks(active).some(track => track.id === request.track.id && trackSource(track) === request.source);
}
function destroy(runtime: Runtime) {
  if (runtime.destroyed) return;
  runtime.destroyed = true;
  if (runtime.fade !== undefined) clearInterval(runtime.fade);
  if (runtime.retry !== undefined) clearTimeout(runtime.retry);
  if (runtime.settle !== undefined) clearTimeout(runtime.settle);
  runtime.audio?.pause(); runtime.audio?.removeAttribute("src"); runtime.audio?.load();
  try { runtime.player?.destroy(); } catch { /* outer host also removes a pending iframe */ }
  runtime.host?.remove(); liveRuntimes.delete(runtime);
  if (runtimes.get(runtime.key) === runtime) runtimes.delete(runtime.key);
}
function removeRuntime(runtime: Runtime, immediate = false) {
  if (runtimes.get(runtime.key) === runtime) runtimes.delete(runtime.key);
  runtime.retiring = true;
  if (runtime.retry !== undefined) clearTimeout(runtime.retry);
  runtime.retry = undefined;
  if (immediate || !runtime.began || runtime.scene.fadeOut <= 0) destroy(runtime);
  else startFade(runtime, runtime.gain, 0, runtime.scene.fadeOut * 1000, () => {
    // Let the iframe process the final mute before removing it.
    runtime.settle = window.setTimeout(() => destroy(runtime), 80);
  });
}
function activateRuntime(runtime: Runtime) {
  for (const old of [...liveRuntimes]) if (old.key === runtime.key) destroy(old);
  runtimes.set(runtime.key, runtime); liveRuntimes.add(runtime);
  report(runtime, "loading", true); applyVolume(runtime); syncPlayback(runtime);
}
function ensureRuntime(active: ActiveScene, track: Track, previewMode = false, session = 0) {
  const key = `${previewMode ? "preview" : active.scene.id}:${track.id}`;
  const source = trackSource(track);
  const pending = pendingRuntimes.get(key);
  if (pending && pending.active.startedAt === active.startedAt && pending.source === source && pending.previewRevision === session) return;
  const request: PendingRuntime = { key, active, track, preview: previewMode, previewRevision: session, source };
  pendingRuntimes.set(key, request);
  void (async () => {
    try {
      const runtime = sourceKind(track) === "youtube" ? await createYouTube(request)
        : createAudio(active.scene, track, active.startedAt, key, previewMode, active.pausedAt !== undefined);
      if (!runtime) return;
      if (!requestIsCurrent(request)) destroy(runtime);
      else {
        if (!previewMode) {
          const latest = current.active.find(item => item.scene.id === active.scene.id)!;
          runtime.scene = latest.scene; runtime.track = activeTracks(latest).find(item => item.id === track.id)!;
          runtime.startedAt = latest.startedAt; runtime.paused = latest.pausedAt !== undefined;
        }
        runtime.instanceId = active.instanceId;
        activateRuntime(runtime);
      }
    } catch {
      if (requestIsCurrent(request)) report(baseRuntime(active.scene, track, active.startedAt, key, previewMode, false), "error", true);
    } finally { if (pendingRuntimes.get(key) === request) pendingRuntimes.delete(key); }
  })();
}
function reconcile(state: PlaybackState) {
  const resumingGlobalPause = current.status === "paused" && state.status === "playing";
  current = state;
  const allowed = state.scope === "GLOBAL" || role === "GM";
  const desired = new Map<string, { active: ActiveScene; track: Track; source: string }>();
  if (allowed) for (const active of state.active) for (const track of activeTracks(active)) {
    desired.set(`${active.scene.id}:${track.id}`, { active, track, source: trackSource(track) });
  }
  for (const [key] of pendingRuntimes) if (!key.startsWith("preview:") && !desired.has(key)) pendingRuntimes.delete(key);
  // A privacy scope change must silence the player's retiring fades too.
  if (state.status === "paused") for (const runtime of [...liveRuntimes]) if (runtime.retiring) destroy(runtime);
  if (!allowed) for (const runtime of [...liveRuntimes]) if (!runtime.preview) destroy(runtime);
  for (const runtime of [...runtimes.values()]) if (!runtime.preview && !desired.has(runtime.key)) removeRuntime(runtime);
  for (const [key, item] of desired) {
    const runtime = runtimes.get(key);
    const paused = item.active.pausedAt !== undefined;
    const resumingScene = !!runtime?.paused && !paused;
    const startedAtChanged = runtime?.startedAt !== item.active.startedAt;
    if (runtime && (runtime.source !== item.source || runtime.instanceId !== item.active.instanceId || (startedAtChanged && !resumingScene && !resumingGlobalPause))) {
      removeRuntime(runtime); ensureRuntime(item.active, item.track);
    } else if (!runtime) ensureRuntime(item.active, item.track);
    else {
      const loopChanged = runtime.track.loop !== item.track.loop || runtime.track.delayMin !== item.track.delayMin || runtime.track.delayMax !== item.track.delayMax;
      runtime.scene = item.active.scene; runtime.track = item.track; runtime.startedAt = item.active.startedAt; runtime.paused = paused;
      if (runtime.audio) runtime.audio.loop = item.track.loop && item.track.delayMax === 0 && item.track.delayMin === 0;
      if (loopChanged && runtime.repeatRemaining !== undefined) {
        if (runtime.retry !== undefined) clearTimeout(runtime.retry);
        runtime.retry = undefined; runtime.repeatRemaining = undefined;
        if (item.track.loop) scheduleRepeat(runtime); else report(runtime, "ended");
      }
      applyVolume(runtime); syncPlayback(runtime); report(runtime, runtime.status, true);
    }
  }
}
function stopPreview() {
  preview = null; previewRevision += 1;
  for (const [key] of pendingRuntimes) if (key.startsWith("preview:")) pendingRuntimes.delete(key);
  for (const runtime of [...runtimes.values()]) if (runtime.preview) removeRuntime(runtime, true);
}
function previewScene(scene: Scene) {
  stopPreview(); preview = scene;
  for (const track of scene.tracks) ensureRuntime({ scene, startedAt: Date.now() }, track, true, previewRevision);
}
async function unlock() {
  const silence = new Audio("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=");
  await silence.play().catch(() => undefined); silence.pause(); audioUnlocked = true;
  for (const runtime of liveRuntimes) { runtime.playbackRequested = undefined; syncPlayback(runtime); }
}
OBR.onReady(async () => {
  loadMaster(); role = await OBR.player.getRole();
  const access = await syncAccess();
  OBR.player.onChange(player => { role = player.role; reconcile(current); });
  OBR.broadcast.onMessage(CHANNEL, ({ data, connectionId }) => {
    if (!validSyncMessage(data)) return;
    if (data.type === "STATE" && access.gm(connectionId) && data.state.revision >= current.revision) reconcile(data.state);
    if (data.type === "REQUEST_STATE" && role === "GM") void OBR.broadcast.sendMessage(CHANNEL, { type: "STATE", state: current } satisfies SyncMessage, { destination: "ALL" });
  });
  OBR.broadcast.onMessage(LOCAL_CHANNEL, ({ data, connectionId }) => {
    if (!access.local(connectionId) || !validLocalMessage(data)) return;
    if (data.type === "UNLOCK") void unlock();
    if (data.type === "REQUEST_STATUS") for (const runtime of runtimes.values()) report(runtime, runtime.status, true);
    if (data.type === "PREVIEW") previewScene(data.scene);
    if (data.type === "STOP_PREVIEW") stopPreview();
    if (data.type === "MASTER") {
      if (data.revision === undefined && lastMasterRevision > 0) return;
      if (data.revision !== undefined && data.revision <= lastMasterRevision) return;
      if (data.revision !== undefined) lastMasterRevision = data.revision;
      master = { volume: data.volume, muted: data.muted };
      try { localStorage.setItem("ambient-forge-master", JSON.stringify(master)); } catch { /* volume still applies */ }
      for (const runtime of liveRuntimes) applyVolume(runtime);
    }
  });
  void OBR.broadcast.sendMessage(CHANNEL, { type: "REQUEST_STATE" } satisfies SyncMessage, { destination: "ALL" });
});
