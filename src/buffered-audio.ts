/** Short audio loops are decoded once and repeated by the audio rendering thread.
 * There is no ended→play timer/network round-trip at each boundary. */
export const MAX_LOOP_BYTES = 12 * 1024 * 1024;
export const MAX_LOOP_SECONDS = 120;
let sharedContext: AudioContext | undefined;
function context() { return sharedContext ??= new AudioContext(); }

export class BufferedAudio extends EventTarget {
  readonly preload = "auto";
  readonly src: string;
  private ctx: AudioContext;
  private gain: GainNode;
  private buffer?: AudioBuffer;
  private source?: AudioBufferSourceNode;
  private offset = 0;
  private beganAt = 0;
  private level = 1;
  private silent = false;
  private looping = true;
  private destroyed = false;
  private epoch = 0;
  private controller = new AbortController();
  constructor(url: string) {
    super(); this.src = url; this.ctx = context();
    this.gain = this.ctx.createGain(); this.gain.connect(this.ctx.destination);
    void this.loadBuffer().catch(() => { if (!this.destroyed) this.dispatchEvent(new Event("error")); });
  }
  get duration() { return this.buffer?.duration ?? NaN; }
  get paused() { return !this.source; }
  get volume() { return this.level; }
  set volume(value: number) { this.level = value; this.updateVolume(); }
  get muted() { return this.silent; }
  set muted(value: boolean) { this.silent = value; this.updateVolume(); }
  get loop() { return this.looping; }
  set loop(value: boolean) { this.looping = value; if (this.source) this.source.loop = value; }
  get currentTime() {
    const value = this.offset + (this.source ? this.ctx.currentTime - this.beganAt : 0);
    return this.buffer ? (this.looping ? value % this.duration : Math.min(value, this.duration)) : value;
  }
  set currentTime(value: number) {
    const playing = !this.paused;
    this.stopSource(); this.offset = Math.max(0, value);
    if (playing) this.startSource();
  }
  private updateVolume() { this.gain.gain.setValueAtTime(this.silent ? 0 : this.level, this.ctx.currentTime); }
  private async loadBuffer() {
    const timeout = setTimeout(() => this.controller.abort(), 30000);
    try {
      const response = await fetch(this.src, { signal: this.controller.signal, credentials: "omit" });
      if (!response.ok || Number(response.headers.get("content-length")) > MAX_LOOP_BYTES || !response.body) throw new Error("Loop file unavailable or too large");
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > MAX_LOOP_BYTES) { await reader.cancel(); throw new Error("Loop exceeds 12 MiB"); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      if (this.destroyed) return;
      const buffer = await this.ctx.decodeAudioData(bytes.buffer);
      if (this.destroyed) return;
      if (!buffer.duration || buffer.duration > MAX_LOOP_SECONDS) throw new Error("Loop exceeds two minutes");
      this.buffer = buffer; this.dispatchEvent(new Event("loadedmetadata"));
    } finally { clearTimeout(timeout); }
  }
  async play() {
    const epoch = ++this.epoch;
    if (this.destroyed || !this.buffer) throw new Error("Loop not loaded");
    await this.ctx.resume();
    if (this.destroyed || epoch !== this.epoch) throw new DOMException("Playback cancelled", "AbortError");
    if (this.ctx.state !== "running") throw new DOMException("Click Enable audio", "NotAllowedError");
    if (!this.source) this.startSource();
  }
  private startSource() {
    if (!this.buffer || this.destroyed) return;
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer; source.loop = this.looping;
    source.connect(this.gain); this.source = source; this.beganAt = this.ctx.currentTime;
    this.offset = this.looping ? this.offset % this.duration : Math.min(this.offset, this.duration);
    source.onended = () => {
      if (this.source !== source || this.destroyed) return;
      this.source = undefined; source.disconnect(); this.offset = this.duration;
      this.dispatchEvent(new Event("ended"));
    };
    source.start(0, this.offset);
    this.dispatchEvent(new Event("playing"));
  }
  private stopSource() {
    const source = this.source; this.source = undefined;
    if (source) { source.onended = null; source.stop(); source.disconnect(); }
  }
  pause() {
    this.epoch++;
    if (this.source) { this.offset = this.currentTime; this.stopSource(); this.dispatchEvent(new Event("pause")); }
  }
  removeAttribute(name: string) {
    if (name !== "src") return;
    this.pause(); this.destroyed = true; this.controller.abort(); this.gain.disconnect(); this.buffer = undefined;
  }
  load() { /* streaming HTMLAudioElement compatibility; disposal above is final */ }
}
