/**
 * 접는 동안의 프레임 시간 재기(낮은 화질 단계). 예전 빌드와 새 빌드를 같은 방법으로 잰다.
 * 실행: node scripts/perf-paper.mjs --dir=dist-paper --port=4176 [--paper=newsprint] [--preset=dart] [--folds=0]
 * 길잡이의 모서리를 잡고 3초쯤 이리저리 끌면서 requestAnimationFrame 간격을 모은다.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1];
const DIR = arg('dir', 'dist-paper');
const PORT = Number(arg('port', '4176'));
const PAPER = arg('paper', 'newsprint');
const FOLDS = Number(arg('folds', '0'));
const BASE = `http://127.0.0.1:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = (id) => `[data-testid="${id}"]`;
async function reachable(url) { try { return (await fetch(url)).ok; } catch { return false; } }

let child = null;
if (!(await reachable(BASE))) {
  child = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1', '--outDir', DIR], { cwd: ROOT, stdio: 'ignore', detached: true });
  for (let i = 0; i < 80 && !(await reachable(BASE)); i++) await sleep(250);
}
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 360, height: 740, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument((paper) => {
    localStorage.setItem('pp-3d-tier', 'low');
    localStorage.setItem('pp.introSeen.v1', 'true');
    localStorage.setItem('pp.sound.v1', 'false');
    localStorage.setItem('pp.session.v2', JSON.stringify({ screen: 'home', deskStep: 'fold', paperId: paper, colorId: 'blue', foldMode: 'simple', presetId: 'glider', presetParams: {}, presetChosen: true, guideFolds: [], freeFolds: [], freeShaping: { keelM: 0.02, dihedralDeg: 8, wingletM: 0, wingletDeg: 0, elevatorDeg: 2 }, clip: null, throwIn: { speedMps: 7, pitchDeg: 5, rollDeg: 0 }, mode: 'distance' }));
  }, PAPER);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(T('go-desk'), { timeout: 20000 });
  await sleep(1500);
  for (let i = 0; i < 5 && !(await page.$(T('fb-svg'))); i++) { const b = await (await page.$(T('go-desk')))?.boundingBox(); if (b) await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); await sleep(900); }
  await page.waitForSelector(T('fb-svg'), { timeout: 10000 });
  for (let i = 0; i < FOLDS; i++) { const b = await (await page.$(T('fb-skip'))).boundingBox(); await page.$eval(T('fb-skip'), (el) => el.scrollIntoView({ block: 'center' })); const c = await (await page.$(T('fb-skip'))).boundingBox(); await page.touchscreen.tap(c.x + c.width / 2, c.y + c.height / 2); await sleep(500); void b; }
  await page.$eval(T('fb-svg'), (el) => el.scrollIntoView({ block: 'center' }));
  await sleep(2500);
  const cue = await page.evaluate(() => {
    const svg = document.querySelector('[data-testid="fb-svg"]');
    const m = svg.getScreenCTM();
    const f = (el) => { const x = +el.getAttribute('cx'), y = +el.getAttribute('cy'); return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }; };
    return { a: f(document.querySelector('.fb-cue__dot')), b: f(document.querySelector('.fb-cue__dest')), layers: document.querySelectorAll('.fb-layer').length };
  });
  await page.evaluate(() => {
    window.__ft = [];
    let last = 0;
    const tick = (t) => { if (last) window.__ft.push(t - last); last = t; window.__raf = requestAnimationFrame(tick); };
    window.__raf = requestAnimationFrame(tick);
  });
  await page.touchscreen.touchStart(cue.a.x, cue.a.y);
  const t0 = Date.now();
  let n = 0;
  while (Date.now() - t0 < 3500) {
    const k = 0.5 + 0.4 * Math.sin(n / 9);
    await page.touchscreen.touchMove(cue.a.x + (cue.b.x - cue.a.x) * k, cue.a.y + (cue.b.y - cue.a.y) * k);
    n++;
  }
  const ft = await page.evaluate(() => { cancelAnimationFrame(window.__raf); return window.__ft; });
  await page.touchscreen.touchEnd();
  ft.sort((a, b) => a - b);
  const mean = ft.reduce((s, v) => s + v, 0) / ft.length;
  const layersLive = await page.evaluate(() => document.querySelectorAll('.fb-layer').length);
  console.log(JSON.stringify({ dir: DIR, paper: PAPER, folds: FOLDS, frames: ft.length, meanMs: +mean.toFixed(1), medianMs: +ft[Math.floor(ft.length / 2)].toFixed(1), p95Ms: +ft[Math.floor(ft.length * 0.95)].toFixed(1), moves: n, layers: layersLive }));
} finally {
  await browser.close();
  if (child) { try { process.kill(-child.pid); } catch { /* 끝남 */ } }
}
