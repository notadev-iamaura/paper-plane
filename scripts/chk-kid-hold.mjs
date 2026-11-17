import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
const mode = process.argv[2] ?? 'normal';
const PORT = 4193; const BASE = `http://127.0.0.1:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const child = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1', '--outDir', 'dist-cast'], { cwd: '/home/claude/paper-plane', stdio: 'ignore', detached: true });
for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE)).ok) break; } catch {} await sleep(250); }
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 360, height: 740, deviceScaleFactor: 1 });
await page.setRequestInterception(true);
page.on('request', async (r) => {
  if (r.url().endsWith('.glb') && r.url().includes('kid')) {
    if (mode === 'fail') return r.abort();
    if (mode === 'slow') { await sleep(9000); return r.continue(); }
  }
  r.continue();
});
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log('  console', m.type(), m.text().slice(0, 140)); });
await page.evaluateOnNewDocument(() => { localStorage.setItem('pp.introSeen.v1', 'true'); });
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ppStage && window.__ppStage.debug, { timeout: 60000 });
const t0 = Date.now();
const log = [];
let last = '';
for (let i = 0; i < 160; i++) {
  const st = await page.evaluate(() => { const s = window.__ppStage; return { built: s.built, held: s.kidHeld, kind: s.debug.kidKind(), vis: s.kid ? s.kid.chibi.root.visible : null, frames: s.debug.frames(), ff: performance.getEntriesByName('pp3d-first-frame')[0]?.startTime ?? null }; });
  const key = `${st.built}|${st.held}|${st.kind}|${st.vis}|${st.frames > 0}`;
  if (key !== last) { log.push(`${Date.now() - t0}ms built=${st.built} held=${st.held} kind=${st.kind} visible=${st.vis} frames=${st.frames} firstFrame=${st.ff && Math.round(st.ff)}`); last = key; }
  await sleep(100);
}
console.log(mode + ':\n  ' + log.join('\n  '));
await page.screenshot({ path: `/tmp/pop-${mode}.png` });
await browser.close();
process.kill(-child.pid);
