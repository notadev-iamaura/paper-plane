/**
 * 종이 겉모습과 접는 동안의 비행기 보기 갈무리.
 *
 * 준비: npx vite build --outDir dist-paper   (다른 빌드와 겹치지 않게 따로 빌드한다)
 * 실행: node scripts/shots-paper.mjs [--only=papers,fold,presets,inspect,reveal,gym,beauty,wide,layouts,perf] [--out=screenshots/v6-paper] [--tier=medium]
 *
 * 저장해 둔 상태(pp.session.v2)를 미리 넣어 원하는 장면에서 바로 시작한다.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1];
const OUT = join(ROOT, arg('out', 'screenshots/v6-paper'));
const ONLY = arg('only', 'papers,fold,presets,inspect,reveal,gym,beauty,wide').split(',');
const TIER = arg('tier', 'medium');
const PORT = 4176;
const BASE = `http://127.0.0.1:${PORT}/`;
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = (id) => `[data-testid="${id}"]`;
const PAPERS = ['newsprint', 'copy60', 'copy80', 'copy100', 'craft120', 'kent160'];
const PRESETS = ['dart', 'glider', 'hybrid', 'delta', 'stealth'];
const problems = [];

async function reachable(url) { try { return (await fetch(url)).ok; } catch { return false; } }
async function startPreview() {
  if (await reachable(BASE)) return null;
  const child = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1', '--outDir', 'dist-paper'], { cwd: ROOT, stdio: 'ignore', detached: true });
  for (let i = 0; i < 80; i++) { if (await reachable(BASE)) return child; await sleep(250); }
  throw new Error('preview did not start');
}

const DEFAULT_SHAPING = { keelM: 0.02, dihedralDeg: 12, wingletM: 0, wingletDeg: 0, elevatorDeg: 3 };
function session(over = {}) {
  return {
    screen: 'home', deskStep: 'paper', paperId: 'copy80', foldMode: 'simple', presetId: 'dart', presetParams: {}, presetChosen: false,
    guideFolds: [], freeFolds: [], freeShaping: DEFAULT_SHAPING, clip: null, throwIn: { speedMps: 7, pitchDeg: 5, rollDeg: 0 }, mode: 'distance', ...over,
  };
}

async function newPage(browser, { mobile = true, sess, tier = TIER, extra = {} } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  if (mobile) await page.setViewport({ width: 360, height: 740, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  else await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`[console] ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:')) problems.push(`[external] ${u}`); });
  await page.evaluateOnNewDocument((s, t, x) => {
    try {
      localStorage.setItem('pp-3d-tier', t);
      localStorage.setItem('pp.introSeen.v1', 'true');
      localStorage.setItem('pp.sound.v1', 'false');
      if (s) localStorage.setItem('pp.session.v2', JSON.stringify(s));
      for (const [k, v] of Object.entries(x)) localStorage.setItem(k, v);
    } catch { /* 무시 */ }
  }, sess ?? null, tier, extra);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(T('place'), { timeout: 20000 });
  await sleep(1500);
  return page;
}

async function tap(page, selector) {
  await page.waitForSelector(selector, { timeout: 10000 });
  const box = await page.$eval(selector, (el) => {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (page.viewport()?.hasTouch) await page.touchscreen.tap(box.x, box.y);
  else await page.mouse.click(box.x, box.y);
  await sleep(200);
}
const shot = (page, name, clip) => page.screenshot({ path: join(OUT, `${name}.png`), ...(clip ? { clip } : {}) });
const rect = (page, sel) => page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });

/** 3D 미리보기가 몇 장 더 그릴 때까지 기다린다(느린 소프트웨어 렌더러용). */
async function settle3d(page, ms = 1400) { await sleep(ms); }

async function paperToClient(page, p) {
  return page.evaluate(({ x, y }) => {
    const svg = document.querySelector('[data-testid="fb-svg"]');
    const m = svg.getScreenCTM();
    const mx = x * 1000, my = -y * 1000;
    return { x: m.a * mx + m.c * my + m.e, y: m.b * mx + m.d * my + m.f };
  }, p);
}
function readCue(page) {
  return page.evaluate(() => {
    const dot = document.querySelector('.fb-cue__dot');
    const dest = document.querySelector('.fb-cue__dest');
    if (!dot || !dest) return null;
    const pt = (el) => ({ x: Number(el.getAttribute('cx')) / 1000, y: -Number(el.getAttribute('cy')) / 1000 });
    return { grab: pt(dot), dest: pt(dest) };
  });
}
/** 길잡이를 따라 한 번 접는다. hold 가 있으면 가는 길의 frac 지점에서 멈춰 hold 를 부른다. */
async function guideFold(page, frac = 1, hold) {
  try {
    await page.$eval(T('fb-svg'), (el) => el.scrollIntoView({ block: 'center' }));
  } catch (e) {
    await page.screenshot({ path: join(OUT, 'zz-error.png') });
    throw e;
  }
  await sleep(150);
  const cue = await readCue(page);
  if (!cue) return false;
  const a = await paperToClient(page, cue.grab);
  const b = await paperToClient(page, cue.dest);
  await page.touchscreen.touchStart(a.x, a.y);
  const steps = 10;
  const stopAt = Math.round(steps * frac);
  for (let i = 1; i <= steps; i++) {
    await page.touchscreen.touchMove(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
    await sleep(30);
    if (hold && i === stopAt) { await sleep(250); await hold(); }
  }
  await sleep(80);
  await page.touchscreen.touchEnd();
  await sleep(350);
  return true;
}
const goDesk = async (page) => {
  for (let i = 0; i < 5; i++) {
    await tap(page, T('go-desk')).catch(() => {});
    if (await page.$('.desk')) break;
    await sleep(600);
  }
  await sleep(500);
};

async function run() {
  const preview = await startPreview();
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  try {
    // ---- 종이 고르기: 종류마다 ----
    if (ONLY.includes('papers')) {
      const page = await newPage(browser, { sess: session() });
      await goDesk(page);
      for (const id of PAPERS) {
        await tap(page, T(`paper-${id}`));
        await settle3d(page, 1200);
        await shot(page, `01-paper-${id}`);
      }
      await page.close();
      // 여섯 장을 한눈에: 세로로 긴 화면
      const tall = await browser.newPage();
      await tall.setViewport({ width: 360, height: 1180, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await tall.evaluateOnNewDocument((s, t) => { localStorage.setItem('pp-3d-tier', t); localStorage.setItem('pp.introSeen.v1', 'true'); localStorage.setItem('pp.session.v2', JSON.stringify(s)); }, session({ paperId: 'newsprint' }), TIER);
      await tall.goto(BASE, { waitUntil: 'domcontentloaded' });
      await tall.waitForSelector(T('place'));
      await sleep(1500);
      await goDesk(tall);
      await settle3d(tall, 1500);
      await shot(tall, '01-paper-all');
      await tall.close();
    }

    // ---- 접기 판: 끄는 중 ----
    if (ONLY.includes('fold')) {
      for (const id of ['newsprint', 'copy60', 'craft120', 'kent160']) {
        const page = await newPage(browser, { sess: session({ paperId: id, deskStep: 'fold', presetChosen: true }) });
        await goDesk(page);
        await settle3d(page, 1000);
        await guideFold(page, 0.7, () => shot(page, `02-fold-drag1-${id}`));
        await settle3d(page, 1800);
        await shot(page, `02-fold-after1-${id}`);
        await guideFold(page, 0.6, () => shot(page, `02-fold-drag2-${id}`));
        await page.close();
      }
      // 내 맘대로 접기: 비스듬히 여러 번 접은 신문지(글줄이 여러 방향으로 놓인다)
      const free = await newPage(browser, { sess: session({ paperId: 'newsprint', deskStep: 'fold', foldMode: 'free', freeFolds: [
        { a: { x: -0.105, y: 0.03 }, b: { x: 0.02, y: 0.1485 }, dir: 'valley' },
        { a: { x: 0.105, y: -0.02 }, b: { x: -0.03, y: -0.1485 }, dir: 'valley' },
        { a: { x: 0.105, y: 0.06 }, b: { x: 0.03, y: 0.1485 }, dir: 'valley' },
      ] }) });
      await goDesk(free);
      await settle3d(free, 1800);
      await free.$eval(T('fb-svg'), (el) => el.scrollIntoView({ block: 'center' }));
      await sleep(300);
      await shot(free, '02-fold-free-newsprint');
      await free.close();
    }

    // ---- 다 접은 비행기: 접는 법 다섯 가지 x 종이 세 가지 ----
    if (ONLY.includes('presets')) {
      for (const id of ['newsprint', 'craft120', 'kent160']) {
        for (const preset of PRESETS) {
          const page = await newPage(browser, { sess: session({ paperId: id, deskStep: 'fold', presetId: preset, presetChosen: true, guideFolds: null }) });
          await goDesk(page);
          await settle3d(page, 2200);
          await shot(page, `03-plane-${preset}-${id}`);
          await page.close();
        }
      }
      // 접는 법 카드(종이 무늬가 붙은 작은 그림)
      const cards = await newPage(browser, { sess: session({ paperId: 'newsprint', deskStep: 'fold' }) });
      await goDesk(cards);
      await sleep(800);
      await shot(cards, '03-foldcards-newsprint');
      await cards.close();
    }

    // ---- 살펴보기 ----
    if (ONLY.includes('inspect')) {
      const page = await newPage(browser, { sess: session({ paperId: 'newsprint', deskStep: 'fold', presetId: 'dart', presetChosen: true, guideFolds: null }) });
      await goDesk(page);
      await settle3d(page, 1500);
      await tap(page, T('plane-inspect-open'));
      await settle3d(page, 2200);
      await shot(page, '04-inspect-hero');
      for (const v of ['top', 'side', 'front']) {
        await tap(page, T(`view-${v}`));
        await settle3d(page, 1600);
        await shot(page, `04-inspect-${v}`);
      }
      await page.close();
    }

    // ---- 펴지는 연출 3장 ----
    if (ONLY.includes('reveal')) {
      const page = await newPage(browser, { sess: session({ paperId: 'newsprint', deskStep: 'fold', presetId: 'dart', presetChosen: true }) });
      await goDesk(page);
      await settle3d(page, 800);
      await shot(page, '05-reveal-0-before');
      await tap(page, T('guide-instant'));
      const freeze = (x) => page.$eval(T('preview-canvas'), (el, v) => el.__viewer.debugRevealAt(v), x);
      let n = 1;
      for (const x of [0.08, 0.34, 0.52, 0.74]) {
        await freeze(x);
        await sleep(900);
        await shot(page, `05-reveal-${n++}`);
      }
      await freeze(null);
      await settle3d(page, 1500);
      await shot(page, '05-reveal-5-done');
      await page.close();
    }

    // ---- 체육관: 손에 든 비행기, 날아가는 비행기, 착지와 줄자 ----
    if (ONLY.includes('gym')) {
      const page = await newPage(browser, { sess: session({ paperId: 'newsprint', deskStep: 'shape', presetId: 'dart', presetChosen: true, guideFolds: null }) });
      await sleep(9000);
      await shot(page, '06-home-newsprint');
      await tap(page, T('go-throw'));
      await page.waitForSelector(T('throw-btn'), { timeout: 20000 });
      await sleep(5000);
      await shot(page, '06-aim-newsprint');
      // 가까이에서: 손에 든 비행기
      await page.evaluate(() => { const d = window.__ppStage.debug; d.pause(true); d.cam({ pos: [0.1, 2.5, 0.75], look: [-0.5, 1.42, -0.56], tanH: 0.36, tanV: 0.36 }); d.step(0.05); });
      await sleep(1500);
      await shot(page, '06-aim-closeup-newsprint');
      await page.evaluate(() => { const d = window.__ppStage.debug; d.cam(null); d.pause(false); });
      await sleep(800);
      // 진짜로 던져서 착지와 줄자까지
      await tap(page, T('throw-btn'));
      await page.waitForSelector(T('result-panel'), { timeout: 60000 }).catch(() => problems.push('결과 패널이 뜨지 않았어요'));
      await sleep(2500);
      await shot(page, '06-landed-newsprint');
      // 날아가는 장면: 느린 렌더러에서도 잡히도록 무대의 시간을 직접 넘긴다(지어낸 비행).
      await tap(page, T('throw-again'));
      await page.waitForSelector(T('throw-btn'), { timeout: 20000 });
      await sleep(1500);
      await page.evaluate(() => { const d = window.__ppStage.debug; d.pause(true); d.fakeThrow(11, 3.2); });
      let k = 1;
      for (const dt of [0.9, 0.5, 0.6]) {
        await page.evaluate((s) => { for (let i = 0; i < 20; i++) window.__ppStage.debug.step(s / 20); }, dt);
        await sleep(900);
        await shot(page, `06-flight-${k++}-newsprint`);
      }
      await page.evaluate(() => window.__ppStage.debug.pause(false));
      await page.close();
    }

    // ---- 종이마다 완성된 비행기를 가까이에서 ----
    if (ONLY.includes('beauty')) {
      for (const id of PAPERS) {
        const page = await newPage(browser, { sess: session({ paperId: id, deskStep: 'fold', presetId: 'dart', presetChosen: true, guideFolds: null }) });
        await goDesk(page);
        await settle3d(page, 1200);
        await tap(page, T('plane-inspect-open'));
        await settle3d(page, 2400);
        const r = await rect(page, '.inspect__stage');
        await shot(page, `07-beauty-${id}`, r);
        await page.close();
      }
    }

    // ---- 넓은 화면 ----
    if (ONLY.includes('wide')) {
      const page = await newPage(browser, { mobile: false, sess: session({ paperId: 'newsprint' }) });
      await goDesk(page);
      await settle3d(page, 1500);
      await shot(page, '08-wide-paper');
      await tap(page, T('desk-tab-fold'));
      await tap(page, T('fold-dart'));
      await settle3d(page, 1200);
      for (let i = 0; i < 2; i++) { await tap(page, T('fb-skip')); await sleep(500); }
      await settle3d(page, 1500);
      await shot(page, '08-wide-fold');
      await tap(page, T('guide-instant'));
      await settle3d(page, 3200);
      await shot(page, '08-wide-done');
      await page.close();
    }

    // ---- 배치 비교: 책상 나누기 / 구석에 띄우기 ----
    if (ONLY.includes('layouts')) {
      for (const layout of ['split', 'pip']) {
        const page = await newPage(browser, { sess: session({ paperId: 'newsprint', deskStep: 'fold', presetId: 'dart', presetChosen: true }), extra: { 'pp-fold-layout': layout } });
        await goDesk(page);
        await settle3d(page, 800);
        await guideFold(page, 1);
        await settle3d(page, 2000);
        await shot(page, `09-layout-${layout}`);
        await page.close();
      }
    }
  } finally {
    await browser.close();
    if (preview) { try { process.kill(-preview.pid); } catch { /* 이미 끝남 */ } }
  }
  if (problems.length) { console.log('문제:'); for (const p of [...new Set(problems)].slice(0, 30)) console.log('  -', p); }
  console.log('갈무리 끝:', OUT);
}

run().catch((e) => { console.error(e); process.exit(1); });
