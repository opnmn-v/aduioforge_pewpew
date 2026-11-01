// Optional: install Playwright outside the checkout, set CODEX_PRIMARY_RUNTIME_NODE_MODULES to its node_modules.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(require.resolve('playwright', { paths: [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || ''] })); }
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'tests/browser/vite.config.ts', '--port', '5174', '--host', '127.0.0.1', '--strictPort'], { stdio: 'ignore' });
let browser;
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch('http://127.0.0.1:5174/tests/browser/host.html')).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  browser = await playwright.chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 740, height: 740 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const origin = 'http://127.0.0.1:5174';
  const track = id => ({ id, name: id, url: `${origin}/tone.wav?${id}`, kind: 'audio', volume: 100, muted: false, loop: true, delayMin: 0, delayMax: 0 });
  const library = { version: 1, folders: [{ id: 'music', name: 'Music', color: '#8b6ff7' }], scenes: [{ id: 'B', folderId: 'music', name: 'Playlist', icon: '♫', color: '#8b6ff7', volume: 100, fadeIn: 0, fadeOut: 2, tracks: [track('B1'), track('B2'), track('B3')] }] };
  await context.addInitScript(({ library }) => {
    if (!sessionStorage.getItem('test-seeded')) { localStorage.setItem('ambient-forge', JSON.stringify(library)); sessionStorage.setItem('test-seeded', '1'); }
    window.__audio = [];
    const NativeAudio = window.Audio;
    window.Audio = function(...args) { const audio = new NativeAudio(...args); window.__audio.push(audio); return audio; };
  }, { library });
  // Synthetic 10-second silent WAV: real audio events, no external media dependency.
  const rate = 8000, length = rate * 10, wav = Buffer.alloc(44 + length * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(length * 2, 40);
  await page.route('**/tone.wav?*', route => route.fulfill({ contentType: 'audio/wav', body: wav }));
  await page.route('https://www.youtube.com/oembed?*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ title: 'YouTube fixture title' }) }));
  await page.goto(`${origin}/tests/browser/host.html`);
  const panel = page.frameLocator('#panel');
  await panel.locator('[data-play="B"]').waitFor();
  assert.equal(await panel.locator('#random-folder').count(), 0);
  const box = await panel.locator('.scene-card').boundingBox();
  assert(box.height <= 75, `Scene height is ${box.height}`);
  await panel.locator('#unlock').click(); await panel.locator('[data-play="B"]').click();
  const bg = page.frames().find(frame => frame.url().endsWith('/background.html'));
  const active = () => page.evaluate(() => window.__messages.filter(m => m.data.type === 'STATE').at(-1).data.state.active[0]);
  const waitAudible = () => bg.waitForFunction(() => window.__audio.filter(a => a.src.includes('tone.wav') && !a.paused && a.readyState >= 2).length === 1);
  await waitAudible();
  const first = await active(); const cycle = [first.trackId];
  const endCurrent = async () => { await bg.evaluate(() => { const a = window.__audio.find(a => a.src.includes('tone.wav') && !a.paused); a.currentTime = a.duration - .04; }); };
  for (let i = 0; i < 2; i++) {
    const before = (await active()).instanceId; await endCurrent();
    await page.waitForFunction(id => window.__messages.filter(m => m.data.type === 'STATE').at(-1).data.state.active[0].instanceId !== id, before);
    await waitAudible(); cycle.push((await active()).trackId);
  }
  assert.equal(new Set(cycle).size, 3);
  for (const value of [59, 30, 0, 80]) {
    await panel.locator('#master-volume').evaluate((input, value) => { input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true })); }, value);
    await bg.waitForFunction(value => window.__audio.filter(a => a.src.includes('tone.wav') && !a.paused).every(a => Math.abs(a.volume - value / 100) < .001 && a.muted === (value === 0)), value);
  }
  await panel.locator('#pause').click();
  await bg.waitForFunction(() => window.__audio.filter(a => a.src.includes('tone.wav')).every(a => a.paused));
  await panel.locator('#pause').click(); await waitAudible();
  const beforeSkip = (await active()).trackId;
  await panel.locator('[data-random-track="B"]').click();
  await page.waitForFunction(id => window.__messages.filter(m => m.data.type === 'STATE').at(-1).data.state.active[0].trackId !== id, beforeSkip);
  await waitAudible();
  const expectedNext = (await active()).playlistQueue[0];
  const order = await panel.locator('.scene-actions').first().evaluate(node => [...node.children].map(button => button.hasAttribute('data-next-track') ? 'next' : button.hasAttribute('data-random-track') ? 'shuffle' : 'other'));
  assert.deepEqual(order.slice(0, 2), ['next', 'shuffle']);
  await panel.locator('[data-next-track="B"]').click();
  await page.waitForFunction(id => window.__messages.filter(m => m.data.type === 'STATE').at(-1).data.state.active[0].trackId === id, expectedNext);
  await waitAudible();
  await panel.locator('#stop-all').click();
  await bg.waitForFunction(() => window.__audio.filter(a => a.src.includes('tone.wav')).every(a => a.paused));
  await panel.locator('[data-edit="B"]').click();
  assert.equal(await panel.locator('dialog select, dialog [data-field="muted"]').count(), 0);
  assert.equal(await panel.getByText('Tracks play once; the playlist repeats in shuffled order.').count(), 0);
  const previewOne = panel.locator('[data-preview-track="B1"]');
  const previewTwo = panel.locator('[data-preview-track="B2"]');
  const statesBefore = await page.evaluate(() => window.__messages.filter(m => m.data.type === 'STATE').length);
  await previewOne.click(); await waitAudible();
  assert(await bg.evaluate(() => window.__audio.some(a => a.src.endsWith('?B1') && !a.paused)));
  await previewTwo.click(); await waitAudible();
  await bg.waitForFunction(() => window.__audio.some(a => a.src.endsWith('?B2') && !a.paused) && window.__audio.filter(a => a.src.endsWith('?B1')).every(a => a.paused));
  await previewTwo.click();
  await bg.waitForFunction(() => window.__audio.filter(a => a.src.includes('tone.wav')).every(a => a.paused));
  await previewOne.click(); await waitAudible();
  // A natural end resets the editor's preview button through local status feedback.
  await endCurrent();
  await page.waitForFunction(() => document.querySelector('#panel').contentDocument.querySelector('[data-preview-track="B1"]').getAttribute('aria-pressed') === 'false');
  await previewOne.click(); await waitAudible();
  await panel.locator('dialog .dialog-x').click();
  await bg.waitForFunction(() => window.__audio.filter(a => a.src.includes('tone.wav')).every(a => a.paused));
  assert.equal(await page.evaluate(() => window.__messages.filter(m => m.data.type === 'STATE').length), statesBefore);
  await panel.locator('[data-edit="B"]').click();
  await panel.locator('[data-preview-track="B1"]').click(); await waitAudible();
  await panel.locator('#save-scene').click();
  await panel.locator('dialog').waitFor({ state: 'detached' });
  await bg.waitForFunction(() => window.__audio.filter(a => a.src.includes('tone.wav')).every(a => a.paused));
  await panel.locator('[data-play="B"]').click(); await waitAudible();
  await panel.locator('#add-scene').click();
  const url = panel.locator('dialog [data-field="url"]'); const name = panel.locator('dialog [data-field="name"]');
  await url.fill('https://www.dropbox.com/scl/fi/abc/Night%20Rain.mp3?dl=0'); await url.dispatchEvent('change');
  await name.waitFor(); await page.waitForFunction(() => document.querySelector('#panel').contentDocument.querySelector('[data-field="name"]').value === 'Night Rain');
  await name.fill('New track'); await url.fill('https://youtu.be/abcdefghijk'); await url.dispatchEvent('change');
  await page.waitForFunction(() => document.querySelector('#panel').contentDocument.querySelector('[data-field="name"]').value === 'YouTube fixture title');
  await name.fill('My custom title'); await url.fill('https://example.com/other.mp3'); await url.dispatchEvent('change');
  assert.equal(await name.inputValue(), 'My custom title');
  await panel.locator('#save-scene').click();
  await panel.locator('dialog').waitFor({ state: 'detached' });
  await panel.locator('.scene-card').nth(1).waitFor();
  assert.equal(await panel.locator('.scene-card').count(), 2);
  const artifactDir = process.env.BROWSER_TEST_ARTIFACT_DIR || '/tmp/ambient-forge-browser-tests'; await mkdir(artifactDir, { recursive: true });
  await page.screenshot({ path: `${artifactDir}/browser-panel.png` });
  // Remove the UI frame entirely; the background must still advance the playlist.
  const beforeClose = (await active()).instanceId;
  await page.locator('#panel').evaluate(frame => frame.remove()); await endCurrent();
  await page.waitForFunction(id => window.__messages.filter(m => m.data.type === 'STATE').at(-1).data.state.active[0].instanceId !== id, beforeClose);
  await waitAudible(); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', checks: ['compact rows', 'no Random Scene', 'one audible track', 'natural ended advances without repeats', 'master volume', 'pause/resume', 'next preserves queue; shuffle rearranges remainder', 'single-track local editor preview; switching/stopping/ending/closing/saving', 'automatic source detection; no Mute or playlist hint', 'Dropbox and YouTube names', 'manual name retained', 'closed-panel background continuation'], pageErrors: errors }));
} finally { if (browser) await browser.close(); server.kill(); }
