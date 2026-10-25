// npm install --no-save playwright, then: npm run test:browser
// Starts its own Vite server using the test SDK alias; production SDK is unchanged.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(require.resolve('playwright', { paths: [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || ''] })); }
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'tests/browser/vite.config.ts', '--port', '5174', '--host', '127.0.0.1'], { stdio: 'ignore' });
for (let attempt = 0; attempt < 100; attempt++) {
  try { const response = await fetch('http://127.0.0.1:5174/tests/browser/host.html'); if (response.ok) break; } catch {}
  await new Promise(resolve => setTimeout(resolve, 50));
}
const artifactDir = process.env.BROWSER_TEST_ARTIFACT_DIR || '/tmp/ambient-forge-browser-tests';
await mkdir(artifactDir, { recursive: true });
const browser = await playwright.chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 740, height: 740 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const origin = 'http://127.0.0.1:5174';
const track = (id) => ({ id, name: id, url: `${origin}/tone.wav?${id}`, kind: 'audio', volume: 100, muted: false, loop: true, delayMin: 0, delayMax: 0 });
const scene = (id, folderId = 'music') => ({ id, folderId, name: id, icon: '♫', color: '#8b6ff7', volume: 100, fadeIn: .5, fadeOut: .5, tracks: [track(id)] });
const library = { version: 1, folders: [{ id: 'music', name: 'Music', color: '#8b6ff7' }, { id: 'ambience', name: 'Ambience', color: '#8b6ff7' }], scenes: [scene('A'), { ...scene('B'), tracks: [track('B1'), track('B2')] }, scene('Rain', 'ambience')] };
await context.addInitScript(({ library }) => {
  if (!window.sessionStorage.getItem('test-seeded')) {
    window.localStorage.setItem('ambient-forge', JSON.stringify(library));
    window.sessionStorage.setItem('test-seeded', '1');
  }
  const NativeContext = window.AudioContext;
  window.__sources = [];
  window.__contexts = [];
  window.AudioContext = class extends NativeContext {
    constructor(...args) { super(...args); window.__contexts.push(this); }
    createBufferSource() { const source = super.createBufferSource(); window.__sources.push(source); return source; }
  };
  const NativeAudio = window.Audio;
  window.__audio = [];
  window.Audio = function(...args) { const audio = new NativeAudio(...args); window.__audio.push(audio); return audio; };
}, { library });
// Synthetic fixture only; no copyrighted audio is included.
const rate = 8000, length = rate * 1, wav = Buffer.alloc(44 + length * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(length * 2, 40);
for (let i = 0; i < length; i++) wav.writeInt16LE(Math.round(1000 * Math.sin(2 * Math.PI * 220 * i / rate)), 44 + 2 * i);
await page.route('**/tone.wav?*', route => route.fulfill({ contentType: 'audio/wav', body: wav }));
try {
  await page.goto(`${origin}/tests/browser/host.html`);
  const panel = page.frameLocator('#panel');
  await panel.locator('[data-play="A"]').waitFor();
  await panel.locator('#unlock').click();
  await panel.locator('[data-play="A"]').click();
  await panel.locator('[data-play="B"]').click();
  await panel.locator('[data-play="A"]').click();
  await page.waitForTimeout(1000);
  const bg = page.frames().find(frame => frame.url().endsWith('/background.html'));
  const actual = await bg.evaluate(() => window.__audio.filter(a => a.src.includes('tone.wav')).map(a => ({ src: a.src, paused: a.paused, volume: a.volume, time: a.currentTime })));
  assert(!actual.some(a => a.src.endsWith('?A') && !a.paused));
  assert.equal(actual.filter(a => a.src.includes('?B')).length, 2);
  assert(actual.filter(a => a.src.includes('?B')).every(a => !a.paused && a.time > 0));
  for (const value of [59, 30, 10, 1, 0, 80]) {
    await panel.locator('#master-volume').evaluate((input, value) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }, String(value));
    await page.waitForTimeout(70);
    const volumes = await bg.evaluate(() => window.__audio.filter(a => a.src.includes('?B')).map(a => ({ volume: a.volume, muted: a.muted })));
    assert(volumes.every(a => Math.abs(a.volume - value / 100) < .001 && a.muted === (value === 0)), JSON.stringify({ value, volumes }));
  }
  await panel.locator('[data-random-track="B"]').click();
  await page.waitForTimeout(800);
  const before = await page.evaluate(() => window.__messages.filter(m => m.data.type === 'STATE').at(-1).data.state.active.find(a => a.scene.id === 'B').trackId);
  await panel.locator('[data-random-track="B"]').click();
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => window.__messages.filter(m => m.data.type === 'STATE').at(-1).data.state.active.find(a => a.scene.id === 'B').trackId);
  assert(before && after && before !== after);
  const audibleB = await bg.evaluate(() => window.__audio.filter(a => a.src.includes('?B') && !a.paused).length);
  assert.equal(audibleB, 1);
  await panel.locator('#random-folder').click();
  await page.waitForTimeout(800);
  const active = await page.evaluate(() => window.__messages.filter(m => m.data.type === 'STATE').at(-1).data.state.active);
  assert.equal(active.length, 1); assert.equal(active[0].scene.id, 'A');
  await panel.locator('#pause').click();
  await page.waitForTimeout(100);
  assert(await bg.evaluate(() => window.__audio.filter(a => a.src.includes('tone.wav')).every(a => a.paused)));
  await panel.locator('#pause').click();
  await page.waitForTimeout(200);
  assert(await bg.evaluate(() => window.__audio.some(a => a.src.endsWith('?A') && !a.paused)));
  await panel.locator('[data-edit="A"]').click();
  await panel.locator('dialog').waitFor();
  assert.equal(await panel.locator('dialog [data-field="kind"]').inputValue(), 'audio');
  await page.screenshot({ path: `${artifactDir}/browser-editor.png` });
  await panel.locator('dialog [data-field="seamlessLoop"]').check();
  await panel.locator('#save-scene').click();
  await page.waitForTimeout(2800);
  const buffered = await bg.evaluate(() => ({ count: window.__sources.length, loop: window.__sources.at(-1)?.loop, duration: window.__sources.at(-1)?.buffer?.duration, state: window.__contexts.at(-1)?.state }));
  assert.deepEqual(buffered, { count: 1, loop: true, duration: 1, state: 'running' });
  await panel.locator('#pause').click();
  await page.waitForTimeout(100);
  await panel.locator('#pause').click();
  await page.waitForTimeout(150);
  assert.equal(await bg.evaluate(() => window.__sources.length), 2);
  await page.screenshot({ path: `${artifactDir}/browser-panel.png` });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ buffered, result: 'PASS', checks: ['native Audio A→B→stop A', '59/30/10/1/0/80% volume', 'single random track and no immediate repeat', 'random folder scene replacement', 'global pause/resume', 'scene editor', 'native Web Audio seamless loop across multiple boundaries', 'buffered pause/resume'], pageErrors: errors }));
} finally { await browser.close(); server.kill(); }
