/**
 * 3D 장면 갈무리(headless Chrome, 소프트웨어 렌더링).
 * 무대의 개발용 손잡이(window.__ppStage.debug)로 시간을 직접 넘겨 가며 원하는 순간을 찍는다.
 *
 * 준비: npx vite build --outDir dist-3d   (다른 사람의 dist 와 겹치지 않게 따로 빌드한다)
 * 실행: node scripts/shots-3d.mjs [--only=home,aim,throw,react,beauty,desk,tiers,soak] [--vp=port|land] [--tier=high] [--out=screenshots/v3-3d]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1];
const OUT = join(ROOT, arg('out', 'screenshots/v3-3d'));
const ONLY = arg('only', 'home,aim,throw,react,beauty,desk,tiers,soak').split(',');
const TIER = arg('tier', 'high');
const PORT = 4174;
const BASE = `http://127.0.0.1:${PORT}/`;
mkdirSync(OUT, { recursive: true });

// 기본 다트 비행기(세게 던지면 13 m 쯤 날아간다)
const CODE = 'P19uWgrXAv9kAn015ONpdOEaSzCL1klCelt5QC0ReLIhfeF338e14N3BxJoblqZBi1F5EVBgkLJ';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = (id) => `[data-testid="${id}"]`;
const problems = [];

async function reachable(url) { try { return (await fetch(url)).ok; } catch { return false; } }
async function startPreview() {
  if (await reachable(BASE)) return null;
  const child = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1', '--outDir', 'dist-3d'], { cwd: ROOT, stdio: 'ignore', detached: true });
  for (let i = 0; i < 80; i++) { if (await reachable(BASE)) return child; await sleep(250); }
  throw new Error('preview did not start');
}

async function newPage(browser, vp, tier = TIER) {
  const page = await browser.newPage();
  await page.setViewport(vp);
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
  await page.evaluateOnNewDocument((t) => {
    try { localStorage.setItem('pp-3d-tier', t); localStorage.setItem('pp.introSeen.v1', 'true'); } catch { /* 무시 */ }
  }, tier);
  return page;
}
async function open(page, hash = `#p${CODE}`) {
  await page.goto(`${BASE}${hash}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ppStage && window.__ppStage.debug, { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await sleep(400);
  // 코드가 든 주소로 열면 출발선에서 시작할 수 있다: 대회장으로 돌아가서 시작한다.
  if (await page.$('[data-testid="throw-btn"]')) {
    await page.click('[data-testid="nav-home"]');
    await page.waitForSelector('[data-testid="go-desk"]', { timeout: 10000 });
    await sleep(300);
  }
  await page.evaluate(() => window.__ppStage.debug.pause(true));
}
const step = (page, s) => page.evaluate((x) => window.__ppStage.debug.step(x), s);
const stage = (page, fn, ...args) => page.evaluate(new Function('a', `const s = window.__ppStage; return (${fn})(s, ...a);`), args);
const hideUi = (page, on) => page.evaluate((h) => {
  let el = document.getElementById('shot-hide');
  if (!el) { el = document.createElement('style'); el.id = 'shot-hide'; document.head.appendChild(el); }
  el.textContent = h ? '.app > *:not(.app__gym) { visibility: hidden !important; }' : '';
}, on);
async function shot(page, name) {
  await sleep(120);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log('shot', name);
}
const cam = (page, pos, look, tanH = 0.3, tanV = 0.3) => page.evaluate((c) => window.__ppStage.debug.cam(c), pos ? { pos, look, tanH, tanV } : null);

const PORTRAIT = { width: 360, height: 740, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const LAND = { width: 1280, height: 800, deviceScaleFactor: 1 };

async function goThrow(page) {
  await page.click(T('go-throw'));
  await page.waitForSelector(T('throw-btn'), { timeout: 10000 });
  await sleep(300);
  await step(page, 2.5);
}

async function run(browser, tag, vp) {
  if (ONLY.includes('home')) {
    const page = await newPage(browser, vp);
    await open(page);
    await step(page, 1.2);
    await shot(page, `${tag}-01-home`);
    await step(page, 1.6);
    await shot(page, `${tag}-01-home-b`);
    await page.close();
  }
  if (ONLY.includes('aim') || ONLY.includes('throw')) {
    const page = await newPage(browser, vp);
    await open(page);
    await step(page, 0.5);
    await goThrow(page);
    if (ONLY.includes('aim')) {
      await shot(page, `${tag}-03-aim`);
      await stage(page, '(s) => s.setAim(35, 0, 0.55)');
      await step(page, 0.8);
      await shot(page, `${tag}-04-aim-up-pull`);
      await stage(page, '(s) => s.setAim(-10, 0, 1)');
      await step(page, 0.8);
      await shot(page, `${tag}-05-aim-down-full`);
      await stage(page, '(s) => s.setAim(12, 0, 0)');
      await step(page, 0.8);
    }
    if (ONLY.includes('throw')) {
      await page.click(T('throw-btn'));
      await sleep(900); // 계산이 끝나 무대에 결과가 넘어올 때까지
      await step(page, 0.25);
      await shot(page, `${tag}-06-windup`);
      await step(page, 0.14);
      await shot(page, `${tag}-07-release`);
      await step(page, 0.2);
      await shot(page, `${tag}-08-follow`);
      await step(page, 0.5);
      await shot(page, `${tag}-09-flight-a`);
      await step(page, 0.9);
      await shot(page, `${tag}-10-flight-b`);
      await step(page, 0.9);
      await shot(page, `${tag}-11-flight-c`);
      for (let i = 0; i < 40; i++) {
        const ph = await stage(page, '(s) => s.debug.info().phase');
        if (ph === 'tape') break;
        await step(page, 0.1);
      }
      await step(page, 0.5);
      await shot(page, `${tag}-12-tape`);
      for (let i = 0; i < 40; i++) {
        const ph = await stage(page, '(s) => s.debug.info().phase');
        if (ph === 'done') break;
        await step(page, 0.1);
      }
      await step(page, 0.5);
      await sleep(500);
      await shot(page, `${tag}-13-stamp`);
      await step(page, 1.2);
      await sleep(1600);
      await step(page, 0.4);
      await shot(page, `${tag}-14-result`);
      console.log('info', JSON.stringify(await stage(page, '(s) => s.debug.info()')));
    }
    await page.close();
  }
}

async function beauty(browser) {
  const page = await newPage(browser, { width: 900, height: 900, deviceScaleFactor: 1 });
  await open(page);
  await hideUi(page, true);
  await step(page, 1.0);
  // 아이 가까이(대회장 자세)
  await cam(page, [-1.75, 1.45, 1.75], [-0.1, 1.12, -0.45], 0.36, 0.36);
  await step(page, 0.3);
  await shot(page, 'b-01-kid-home');
  // 조준 자세
  await stage(page, '(s) => { s.showAim(); s.setAim(20, 0, 0.5); }');
  await step(page, 1.2);
  await cam(page, [1.9, 1.5, 2.6], [0.05, 1.2, -0.3], 0.38, 0.38);
  await step(page, 0.1);
  await shot(page, 'b-02-kid-aim');
  await cam(page, [0.9, 1.5, 1.1], [-0.05, 1.38, -0.45], 0.36, 0.36);
  await step(page, 0.1);
  await shot(page, 'b-03-kid-face');
  // 심판
  await cam(page, [-1.2, 1.5, -0.6], [-2.8, 1.2, -3.6], 0.42, 0.42);
  await step(page, 0.1);
  await shot(page, 'b-04-referee');
  // 관중
  await cam(page, [3.5, 1.9, -6.3], [3.5, 1.25, -12], 0.5, 0.5);
  await step(page, 0.1);
  await shot(page, 'b-05-crowd-idle');
  // 체육관 전경
  await cam(page, [-6.5, 3.2, 8], [14, 3.0, -4], 0.75, 0.75);
  await step(page, 0.1);
  await shot(page, 'b-06-hall');
  await cam(page, [10, 2.2, 6], [-8, 3.6, -1], 0.7, 0.7);
  await step(page, 0.1);
  await shot(page, 'b-07-backwall');
  await cam(page, null);
  await page.close();
}

async function react(browser) {
  for (const [mood, dist, time] of [['great', 14.2, 3.1], ['good', 8.4, 2.1], ['again', 3.1, 1.1]]) {
    const page = await newPage(browser, { width: 900, height: 900, deviceScaleFactor: 1 });
    await open(page);
    await hideUi(page, true);
    await stage(page, '(s) => { s.showAim(); s.setAim(12, 0, 0); }');
    await step(page, 1.5);
    await stage(page, '(s, d, t) => s.debug.fakeThrow(d, t)', dist, time);
    if (mood === 'great') {
      await cam(page, [1.9, 1.45, 2.5], [0.05, 1.25, -0.3], 0.42, 0.42);
      await step(page, 0.25);
      await shot(page, 'r-01-windup');
      await step(page, 0.14);
      await shot(page, 'r-02-release');
      await step(page, 0.16);
      await shot(page, 'r-03-follow');
      await step(page, 0.9);
      await shot(page, 'r-04-watch');
      await cam(page, null);
    }
    for (let i = 0; i < 80; i++) {
      const ph = await stage(page, '(s) => s.debug.info().phase');
      if (ph === 'done') break;
      await step(page, 0.1);
    }
    await cam(page, [2.0, 1.5, 2.6], [-0.1, 1.3, -0.5], 0.42, 0.42);
    await step(page, mood === 'great' ? 0.42 : 0.3);
    await shot(page, `r-10-${mood}-a`);
    await step(page, mood === 'again' ? 1.4 : 0.9);
    await shot(page, `r-11-${mood}-b`);
    if (mood === 'great') {
      await cam(page, [5.5, 2.0, -5.6], [5.0, 1.3, -12], 0.55, 0.55);
      await step(page, 0.05);
      await shot(page, 'r-12-crowd-cheer');
      await cam(page, [-1.2, 1.5, -0.6], [-2.8, 1.2, -3.6], 0.42, 0.42);
      await step(page, 0.05);
      await shot(page, 'r-13-referee-cheer');
      await cam(page, null);
      await step(page, 0.05);
      await shot(page, 'r-14-landing-view');
    }
    await page.close();
  }
}

async function desk(browser) {
  const page = await newPage(browser, PORTRAIT);
  await open(page);
  await page.click(T('go-desk'));
  await sleep(2500);
  await shot(page, 'p-17-desk');
  const box = await page.$eval(T('preview-canvas'), (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
  await page.screenshot({ path: join(OUT, 'p-17-desk-preview.png'), clip: box });
  await page.close();
}

/** 되풀이해 던져도 도형, 텍스처 수가 늘지 않는지, WebGL 문맥을 잃어도 결과가 막히지 않는지 본다. */
async function soak(browser) {
  const page = await newPage(browser, PORTRAIT);
  await open(page);
  await stage(page, '(s) => { s.showAim(); s.setAim(12, 0, 0); }');
  await step(page, 1);
  const seen = [];
  for (let i = 0; i < 8; i++) {
    await stage(page, '(s, d) => s.debug.fakeThrow(d, 2.2)', 6 + i * 2);
    for (let k = 0; k < 90; k++) {
      await step(page, 0.1);
      if ((await stage(page, '(s) => s.debug.info().phase')) === 'done') break;
    }
    await step(page, 2.5);
    await stage(page, '(s) => s.showAim()');
    await step(page, 0.4);
    const inf = await stage(page, '(s) => s.debug.info()');
    const heap = await page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e5) / 10 : 0));
    seen.push({ geo: inf.geometries, tex: inf.textures, heapMB: heap, updateMs: Math.round(inf.updateMs * 100) / 100 });
    console.log('soak', i, JSON.stringify(seen[seen.length - 1]));
  }
  console.log('SOAK', JSON.stringify(seen));
  // 문맥 잃기: 진짜 던지기 도중에 잃어도 결과 패널이 떠야 한다.
  await page.close();
  const p2 = await newPage(browser, PORTRAIT);
  await open(p2);
  await goThrow(p2);
  await p2.click(T('throw-btn'));
  await sleep(900);
  await step(p2, 0.7);
  await stage(p2, '(s) => s.debug.loseContext()');
  await sleep(500);
  const afterLoss = await stage(p2, '(s) => s.debug.info()');
  let panel = false;
  try { await p2.waitForSelector(T('result-panel'), { timeout: 8000 }); panel = true; } catch { /* 아래에서 알린다 */ }
  await stage(p2, '(s) => s.debug.restoreContext()');
  await sleep(600);
  const afterRestore = await stage(p2, '(s) => s.debug.info()');
  await step(p2, 0.3);
  await shot(p2, 'x-context-restored');
  console.log('CONTEXT', JSON.stringify({ lost: afterLoss.lost, phaseAfterLoss: afterLoss.phase, resultPanel: panel, lostAfterRestore: afterRestore.lost }));
  await p2.close();
}

async function tiers(browser) {
  const rows = [];
  for (const tier of ['high', 'medium', 'low']) {
    const page = await newPage(browser, PORTRAIT, tier);
    await open(page);
    await step(page, 1.0);
    const home = await stage(page, '(s) => s.debug.info()');
    await shot(page, `t-${tier}-home`);
    await stage(page, '(s) => { s.showAim(); s.setAim(12, 0, 0.3); }');
    await step(page, 1.5);
    const aim = await stage(page, '(s) => s.debug.info()');
    await shot(page, `t-${tier}-aim`);
    await stage(page, '(s) => s.debug.fakeThrow(14, 3)');
    await step(page, 1.6);
    const flight = await stage(page, '(s) => s.debug.info()');
    await shot(page, `t-${tier}-flight`);
    rows.push({ tier, home, aim, flight });
    await page.close();
  }
  for (const r of rows) console.log('TIER', r.tier, JSON.stringify({ home: [r.home.calls, r.home.triangles], aim: [r.aim.calls, r.aim.triangles], flight: [r.flight.calls, r.flight.triangles], shadow: r.aim.shadow, pr: r.aim.pixelRatio, geo: r.aim.geometries, tex: r.aim.textures }));
  writeFileSync(join(OUT, 'tiers.json'), JSON.stringify(rows, null, 2));
}

const preview = await startPreview();
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
try {
  if (ONLY.some((o) => ['home', 'aim', 'throw'].includes(o))) {
    if (arg('vp', 'both') !== 'land') await run(browser, 'p', PORTRAIT);
    if (arg('vp', 'both') !== 'port') await run(browser, 'l', LAND);
  }
  if (ONLY.includes('beauty')) await beauty(browser);
  if (ONLY.includes('react')) await react(browser);
  if (ONLY.includes('desk')) await desk(browser);
  if (ONLY.includes('tiers')) await tiers(browser);
  if (ONLY.includes('soak')) await soak(browser);
} finally {
  await browser.close();
  if (preview) { try { process.kill(-preview.pid); } catch { /* 이미 끝남 */ } }
}
const uniq = [...new Set(problems)];
console.log(uniq.length ? `콘솔 문제 ${uniq.length}건:\n${uniq.join('\n')}` : '콘솔 오류, 경고 없음');
