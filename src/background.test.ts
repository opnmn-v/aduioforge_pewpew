import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNEL, LOCAL_CHANNEL, Scene, STATUS_CHANNEL, emptyState } from "./model";

const sdk = vi.hoisted(() => ({
  messages: [] as { channel: string; data: any }[],
  ready: null as null | (() => Promise<void>),
  handlers: {} as Record<string, (event: { data: unknown; connectionId?: string }) => void>,
}));

vi.mock("@owlbear-rodeo/sdk", () => ({
  default: {
    onReady: (callback: () => Promise<void>) => { sdk.ready = callback; },
    player: { getRole: async () => "GM", getConnectionId: async () => "gm", onChange: () => () => undefined },
    party: { getPlayers: async () => [], onChange: () => () => undefined },
    broadcast: {
      onMessage: (channel: string, callback: (event: { data: unknown; connectionId?: string }) => void) => { sdk.handlers[channel] = callback; },
      sendMessage: async (channel: string, data: unknown) => { sdk.messages.push({ channel, data }); },
    },
  },
}));

class FakeAudio {
  static instances: FakeAudio[] = [];
  readonly listeners = new Map<string, () => void>();
  volume = 1;
  muted = false;
  loop = false;
  preload = "";
  duration = 60;
  currentTime = 0;
  paused = true;
  playCalls = 0;

  constructor(public src = "") { FakeAudio.instances.push(this); }
  addEventListener(name: string, callback: () => void) { this.listeners.set(name, callback); }
  emit(name: string) { this.listeners.get(name)?.(); }
  play() { this.paused = false; this.playCalls += 1; this.emit("playing"); return Promise.resolve(); }
  load() {}
  pause() { this.paused = true; }
  removeAttribute(_name: string) { /* no-op */ }
}

class FakeYouTubePlayer {
  static instances: FakeYouTubePlayer[] = [];
  volume = 100;
  muted = false;
  playCalls = 0;
  duration = 60;
  currentTime = 0;
  getCurrentTime() { return this.currentTime; }
  seeks: number[] = [];
  destroyed = false;
  pauseCalls = 0;
  unMuteCalls = 0;
  events: { onReady: () => void; onStateChange: (event: { data: number }) => void; onAutoplayBlocked: () => void; onError: () => void };
  readonly onReady: () => void;

  constructor(_host: HTMLElement, options: { events: FakeYouTubePlayer["events"] }) {
    this.onReady = options.events.onReady;
    this.events = options.events;
    FakeYouTubePlayer.instances.push(this);
  }
  playVideo() { this.playCalls += 1; this.events.onStateChange({ data: 1 }); }
  pauseVideo() { this.pauseCalls++; this.events.onStateChange({ data: 2 }); }
  stopVideo() { /* no-op */ }
  destroy() { this.destroyed = true; }
  setVolume(value: number) { this.volume = value; }
  mute() { this.muted = true; }
  unMute() { this.muted = false; this.unMuteCalls++; }
  seekTo(seconds: number, _allowSeekAhead: boolean) { this.seeks.push(seconds); }
  getDuration() { return this.duration; }
}

const scene = (id: string, youtube = false): Scene => ({
  id, folderId: "folder", name: id, icon: "♫", color: "#8b6ff7",
  volume: 100, fadeIn: 0, fadeOut: 2,
  tracks: [{
    id, name: id,
    url: youtube ? `https://www.youtube.com/watch?v=${id.repeat(11)}` : `https://example.com/${id}.mp3`,
    kind: youtube ? "youtube" : "audio", volume: 100, muted: false,
    loop: true, delayMin: 0, delayMax: 0,
  }],
});

let revision: number;
function state(scenes: Scene[]) {
  revision += 1;
  sdk.handlers[CHANNEL]({ connectionId: "gm", data: {
    type: "STATE",
    state: {
      ...emptyState(), revision, updatedAt: Date.now(),
      active: scenes.map(item => ({ scene: item, startedAt: 1_000 })),
    },
  } });
}
function local(data: unknown) { sdk.handlers[LOCAL_CHANNEL]({ connectionId: "gm", data }); }
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(10_000));
  sdk.ready = null;
  sdk.handlers = {};
  sdk.messages = [];
  FakeAudio.instances = [];
  FakeYouTubePlayer.instances = [];
  revision = 0;
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  });
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("location", { origin: "https://example.com" });
  vi.stubGlobal("YT", { Player: FakeYouTubePlayer });
  vi.stubGlobal("document", {
    createElement: () => ({ style: { cssText: "" }, append: () => undefined, remove: () => undefined }),
    getElementById: () => ({ append: () => undefined }),
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  await import("./background");
  const ready = sdk.ready as null | (() => Promise<void>);
  if (!ready) throw new Error("Background did not register onReady");
  await ready();
  local({ type: "UNLOCK" });
  await flush();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("background playback", () => {
  it("keeps other audio playing and fades only the stopped scene", async () => {
    state([scene("a"), scene("b")]);
    await flush();
    const [first, second] = FakeAudio.instances.filter(item => item.src.startsWith("https:"));
    first.emit("loadedmetadata");
    second.emit("loadedmetadata");
    state([scene("b")]);
    expect(second.playCalls).toBe(1);
    expect(second.paused).toBe(false);
    vi.advanceTimersByTime(1_000);
    expect(first.volume).toBeLessThan(second.volume);
    vi.advanceTimersByTime(1_200);
    expect(first.paused).toBe(true);
    expect(second.paused).toBe(false);
  });

  it("removes an old fade before rapidly restarting the same audio", async () => {
    state([scene("a")]);
    await flush();
    const first = FakeAudio.instances.find(item => item.src.endsWith("/a.mp3"))!;
    first.emit("loadedmetadata");
    state([]);
    vi.advanceTimersByTime(200);
    expect(first.paused).toBe(false);
    state([scene("a")]);
    await flush();
    const second = FakeAudio.instances.filter(item => item.src.endsWith("/a.mp3"))[1];
    second.emit("loadedmetadata");
    expect(first.paused).toBe(true);
    expect(second.paused).toBe(false);
  });

  it("does not replay an unaffected YouTube track and hard-mutes it at zero", async () => {
    state([scene("a", true), scene("b", true)]);
    await flush();
    const [first, second] = FakeYouTubePlayer.instances;
    first.onReady();
    second.onReady();
    state([scene("b", true)]);
    expect(second.playCalls).toBe(1);
    local({ type: "MASTER", volume: 0, muted: false, revision: 1 });
    vi.advanceTimersByTime(200);
    expect(second.volume).toBe(0);
    expect(second.muted).toBe(true);
  });
});

it("diagnostic: volume updates must work when background animation frames are suspended", async () => {
  state([scene("a")]);
  await flush();
  const audio = FakeAudio.instances.find(item => item.src.endsWith("/a.mp3"))!;
  audio.emit("loadedmetadata");
  vi.stubGlobal("requestAnimationFrame", () => 999);
  local({ type: "MASTER", volume: 0, muted: false, revision: 1 });
  vi.advanceTimersByTime(1000);
  expect(audio.volume).toBe(0);
  expect(audio.muted).toBe(true);
});


describe("playback regressions", () => {
  it("applies every low volume, including 1%, to each independent YouTube player", async () => {
    state([scene("a", true), scene("b", true)]); await flush();
    const [a, b] = FakeYouTubePlayer.instances; a.onReady(); b.onReady();
    let masterRevision = 1000;
    for (const volume of [59, 30, 10, 1, 0, 70]) {
      local({ type: "MASTER", volume, muted: false, revision: ++masterRevision });
      expect(b.volume).toBe(volume); expect(b.muted).toBe(volume === 0);
    }
  });
  it("starts fade-in after slow YouTube readiness, not during download", async () => {
    state([{ ...scene("a", true), fadeIn: 2 }]); await flush();
    vi.advanceTimersByTime(20_000);
    const a = FakeYouTubePlayer.instances[0]; a.onReady();
    expect(a.volume).toBe(0);
    vi.advanceTimersByTime(1000); expect(a.volume).toBe(40);
    vi.advanceTimersByTime(1000); expect(a.volume).toBe(80);
  });
  it("wraps late YouTube playback at the actual duration, then loops without affecting B", async () => {
    vi.setSystemTime(131_000);
    state([scene("a", true), scene("b", true)]); await flush();
    const [a, b] = FakeYouTubePlayer.instances; a.onReady(); b.onReady();
    expect(a.seeks[0]).toBe(10);
    a.events.onStateChange({ data: 0 }); vi.advanceTimersByTime(1);
    expect(a.seeks.at(-1)).toBe(0); expect(b.pauseCalls).toBe(0);
  });
  it("waits for YouTube metadata if duration is zero at onReady", async () => {
    state([scene("a", true)]); await flush(); const a = FakeYouTubePlayer.instances[0];
    a.duration = 0; a.onReady(); expect(a.seeks).toEqual([]);
    a.duration = 5; a.events.onStateChange({ data: 1 }); expect(a.seeks).toEqual([4]);
  });
  it("recovers a blocked YouTube play when Enable audio is pressed again", async () => {
    state([scene("a", true)]); await flush(); const a = FakeYouTubePlayer.instances[0]; a.onReady();
    a.events.onAutoplayBlocked();
    expect(sdk.messages.filter(item => item.channel === STATUS_CHANNEL).at(-1)?.data.status).toBe("blocked");
    local({ type: "UNLOCK" }); await flush(); expect(a.playCalls).toBe(2);
    expect(sdk.messages.filter(item => item.channel === STATUS_CHANNEL).at(-1)?.data.status).toBe("playing");
  });
  it("preserves B through A → B → stop A, while B is still loading", async () => {
    state([scene("a", true)]); await flush(); const a = FakeYouTubePlayer.instances[0]; a.onReady();
    state([scene("a", true), { ...scene("b", true), fadeIn: 2 }]); await flush();
    state([{ ...scene("b", true), fadeIn: 2 }]); vi.advanceTimersByTime(3000);
    const b = FakeYouTubePlayer.instances[1]; b.onReady();
    expect(a.destroyed).toBe(true); expect(b.destroyed).toBe(false); expect(b.playCalls).toBe(1);
    vi.advanceTimersByTime(1000); expect(b.volume).toBe(40); expect(b.pauseCalls).toBe(0);
  });
  it("ignores onReady after an unstarted YouTube runtime is removed", async () => {
    state([scene("a", true)]); await flush(); const a = FakeYouTubePlayer.instances[0];
    state([]); a.onReady(); expect(a.destroyed).toBe(true); expect(a.playCalls).toBe(0);
  });
  it("never fades B by reissuing unMute while A stops", async () => {
    state([scene("a", true), scene("b", true)]); await flush();
    const [a, b] = FakeYouTubePlayer.instances; a.onReady(); b.onReady();
    const unMuteCalls = b.unMuteCalls;
    state([scene("b", true)]); vi.advanceTimersByTime(2500);
    expect(b.unMuteCalls).toBe(unMuteCalls); expect(b.destroyed).toBe(false); expect(b.volume).toBe(80);
  });
  it("cancels a pending random repeat during pause and resumes it afterwards", async () => {
    const s = scene("a"); s.tracks[0].delayMin = 2; s.tracks[0].delayMax = 2;
    state([s]); await flush(); const a = FakeAudio.instances.find(item => item.src.endsWith("/a.mp3"))!;
    a.emit("loadedmetadata"); a.emit("ended");
    sdk.handlers[CHANNEL]({ connectionId: "gm", data: { type: "STATE", state: { ...emptyState(), revision: ++revision, status: "paused", pausedAt: Date.now(), active: [{ scene: s, startedAt: 1000 }] } } });
    vi.advanceTimersByTime(4000); expect(a.playCalls).toBe(1);
    state([s]); vi.advanceTimersByTime(2100); expect(a.playCalls).toBe(2);
  });
  it("plays only the chosen random track on all clients", async () => {
    const s = scene("a"); s.tracks.push({ ...scene("b").tracks[0] });
    sdk.handlers[CHANNEL]({ connectionId: "gm", data: { type: "STATE", state: { ...emptyState(), revision: ++revision, active: [{ scene: s, startedAt: 1000, trackId: "b" }] } } });
    await flush();
    expect(FakeAudio.instances.filter(item => item.src.startsWith("https:"))).toHaveLength(1);
    expect(FakeAudio.instances.at(-1)?.src).toContain("/b.mp3");
  });
});

it("rejects room-state commands and local master changes from a player", async () => {
  sdk.handlers[CHANNEL]({ connectionId: "player", data: { type: "STATE", state: { ...emptyState(), revision: 50, active: [{ scene: scene("a"), startedAt: 1000 }] } } });
  await flush(); expect(FakeAudio.instances.filter(item => item.src.startsWith("https:"))).toHaveLength(0);
  state([scene("b")]); await flush(); const b = FakeAudio.instances.find(item => item.src.endsWith("/b.mp3"))!; b.emit("loadedmetadata");
  sdk.handlers[LOCAL_CHANNEL]({ connectionId: "player", data: { type: "MASTER", volume: 0, muted: true, revision: 1000 } });
  expect(b.volume).toBe(.8);
});

it("does not restart a finished one-shot when another scene changes", async () => {
  const s = scene("a"); s.tracks[0].loop = false;
  state([s]); await flush(); const a = FakeAudio.instances.find(item => item.src.endsWith("/a.mp3"))!;
  a.emit("loadedmetadata"); a.emit("ended");
  state([s, scene("b")]); await flush(); expect(a.playCalls).toBe(1);
});

it("retries native audio after a rejected play promise", async () => {
  state([scene("a")]); await flush(); const a = FakeAudio.instances.find(item => item.src.endsWith("/a.mp3"))!;
  const play = vi.spyOn(a, "play").mockRejectedValueOnce(Object.assign(new Error("Autoplay"), { name: "NotAllowedError" }));
  a.emit("loadedmetadata"); await flush();
  expect(sdk.messages.filter(item => item.channel === STATUS_CHANNEL).at(-1)?.data.status).toBe("blocked");
  local({ type: "UNLOCK" }); await flush(); expect(play).toHaveBeenCalledTimes(2); expect(a.paused).toBe(false);
});

describe("shuffled playlists in the background", () => {
  async function launch(owner = "gm", youtube = false) {
    const { playlistNext } = await import("./playback");
    const s = scene("playlist");
    s.tracks = [scene("a", youtube).tracks[0], scene("b", youtube).tracks[0], scene("c", youtube).tracks[0]];
    const active = { ...playlistNext(s, undefined, Date.now(), () => 0)!, playlistOwner: owner };
    sdk.handlers[CHANNEL]({ connectionId: "gm", data: { type: "STATE", state: { ...emptyState(), revision: 10, active: [active] } } });
    await flush();
    return active;
  }
  it("plays only one non-looping track and advances with the panel closed, without overlap or stale-ended advances", async () => {
    const active = await launch();
    FakeAudio.instances.find(audio => audio.src.startsWith("https:"))!.emit("loadedmetadata");
    const playing = () => FakeAudio.instances.filter(audio => audio.src.startsWith("https:") && !audio.paused);
    expect(playing()).toHaveLength(1);
    const first = playing()[0];
    expect(first.loop).toBe(false);
    first.emit("ended"); await flush();
    FakeAudio.instances.filter(audio => audio.src.startsWith("https:")).at(-1)!.emit("loadedmetadata");
    expect(playing()).toHaveLength(1);
    expect(first.paused).toBe(true);
    const next = sdk.messages.filter(message => message.data.type === "STATE").at(-1)!.data.state;
    expect(next.active[0].trackId).not.toBe(active.trackId);
    expect(next.active[0].playlistQueue).toHaveLength(1);
    const count = sdk.messages.filter(message => message.data.type === "STATE").length;
    first.emit("ended"); await flush();
    expect(sdk.messages.filter(message => message.data.type === "STATE")).toHaveLength(count);
  });
  it("does not let another GM choose a competing next track", async () => {
    await launch("other-gm");
    FakeAudio.instances.find(audio => audio.src.startsWith("https:"))!.emit("ended");
    await flush();
    expect(sdk.messages.filter(message => message.data.type === "STATE")).toHaveLength(0);
  });
  it("advances on YouTube ENDED as well as native audio", async () => {
    const active = await launch("gm", true);
    const first = FakeYouTubePlayer.instances[0]; first.onReady(); await flush();
    first.events.onStateChange({ data: 0 }); await flush();
    expect(sdk.messages.filter(message => message.data.type === "STATE").at(-1)!.data.state.active[0].trackId).not.toBe(active.trackId);
    expect(first.destroyed).toBe(true);
  });
});


describe("editor track preview", () => {
  it("plays locally, replaces the previous preview and stops without broadcasting playlist changes", async () => {
    const firstScene = scene("a"); firstScene.tracks[0].loop = false;
    local({ type: "PREVIEW", scene: firstScene }); await flush();
    const first = FakeAudio.instances.find(audio => audio.src.endsWith("/a.mp3"))!;
    first.emit("loadedmetadata"); expect(first.paused).toBe(false);
    local({ type: "PREVIEW", scene: scene("b") }); await flush();
    expect(first.paused).toBe(true);
    const second = FakeAudio.instances.find(audio => audio.src.endsWith("/b.mp3"))!;
    second.emit("loadedmetadata"); expect(second.paused).toBe(false);
    local({ type: "STOP_PREVIEW" }); expect(second.paused).toBe(true);
    expect(sdk.messages.some(message => message.data.type === "STATE")).toBe(false);
    expect(sdk.messages.some(message => message.data.preview === true && message.data.status === "playing")).toBe(true);
  });
  it("reports preview completion and detects YouTube from the URL", async () => {
    const s = scene("a", true); s.tracks[0].kind = "auto"; s.tracks[0].loop = false;
    local({ type: "PREVIEW", scene: s }); await flush();
    const player = FakeYouTubePlayer.instances[0]; player.onReady(); await flush();
    player.events.onStateChange({ data: 0 }); await flush();
    expect(sdk.messages.at(-1)?.data).toMatchObject({ preview: true, status: "ended", trackId: "a" });
    local({ type: "STOP_PREVIEW" }); expect(player.destroyed).toBe(true);
  });
});

it('seeks native audio to the configured start and ends the preview at the configured end', async () => {
  const s = scene('a'); s.tracks[0] = { ...s.tracks[0], loop: false, startTime: 7, endTime: 20 };
  local({ type: 'PREVIEW', scene: s }); await flush();
  const audio = FakeAudio.instances.find(a => a.src.endsWith('/a.mp3'))!;
  audio.emit('loadedmetadata'); expect(audio.currentTime).toBe(7);
  audio.currentTime = 19; audio.emit('timeupdate'); expect(audio.paused).toBe(false);
  audio.currentTime = 20; audio.emit('timeupdate'); expect(audio.paused).toBe(true);
  expect(sdk.messages.at(-1)?.data).toMatchObject({ preview: true, status: 'ended' });
});

it('cuts YouTube at the specified media position, including after a pause', async () => {
  const s = scene('a', true); s.tracks[0] = { ...s.tracks[0], loop: false, startTime: 7, endTime: 23 };
  local({ type: 'PREVIEW', scene: s }); await flush();
  const player = FakeYouTubePlayer.instances[0]; player.onReady(); await flush();
  expect(player.seeks[0]).toBe(7);
  player.currentTime = 22; vi.advanceTimersByTime(2000);
  expect(sdk.messages.at(-1)?.data.status).not.toBe('ended');
  player.currentTime = 23; vi.advanceTimersByTime(100);
  expect(sdk.messages.at(-1)?.data).toMatchObject({ preview: true, status: 'ended' });
});
