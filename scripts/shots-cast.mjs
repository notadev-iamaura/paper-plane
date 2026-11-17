/**
 * 등장인물 비교 갈무리(v5): 이전 빌드와 이후 빌드를 같은 카메라, 같은 순간으로 찍어 "이전 / 이후" 로 나란히 붙인다.
 *
 * 준비: 이전 빌드 = dist-v4 (작업 전의 빌드), 이후 빌드 = npx vite build --outDir dist-cast
 * 실행: node scripts/shots-cast.mjs [--only=face,aim,pose,ref,crowd,home,tape,props] [--which=both|after|before] [--compose]
 *       [--out=screenshots/v5-cast] [--tier=high]
 *
 * 무대의 개발용 손잡이(window.__ppStage.debug)로 시간을 직접 넘기므로 두 빌드가 정확히 같은 순간에 찍힌다.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1];
const OUT = join(ROOT, arg('out', 'screenshots/v5-cast'));
const RAW = join(OUT, 'raw');
const ONLY = arg('only', 'face,aim,pose,ref,crowd,home,tape').split(',');
const WHICH = arg('which', 'both');
const TIER = arg('tier', 'high');
const COMPOSE_ONLY = process.argv.includes('--compose');
const BUILDS = { before: { dir: arg('before', 'dist-v4'), port: 4191 }, after: { dir: arg('after', 'dist-cast'), port: 4192 } };
mkdirSync(RAW, { recursive: true });

const CODE = 'P19uWgrXAv9kAn015ONpdOEaSzCL1klCelt5QC0ReLIhfeF338e14N3BxJoblqZBi1F5EVBgkLJ';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = (id) => `[data-testid="${id}"]`;
const problems = [];
const KID = { x: -0.4, y: 0.14, z: -0.56, s: 1.64 };
const REF = { x: -2.8, y: 0, z: -3.6 };
const EXPRS = ['neutral', 'smile', 'focus', 'effort', 'joy', 'oops', 'wow', 'grit'];
const EXPR_KO = { neutral: '보통', smile: '미소', focus: '집중', effort: '힘껏', joy: '기쁨', oops: '앗', wow: '우와', grit: '다짐' };

async function reachable(url) { try { return (await fetch(url)).ok; } catch { return false; } }
const children = [];
async function startPreview(b) {
  const base = `http://127.0.0.1:${b.port}/`;
  if (await reachable(base)) return base;
  const child = spawn('npx', ['vite', 'preview', '--port', String(b.port), '--strictPort', '--host', '127.0.0.1', '--outDir', b.dir], { cwd: ROOT, stdio: 'ignore', detached: true });
  children.push(child);
  for (let i = 0; i < 80; i++) { if (await reachable(base)) return base; await sleep(250); }
  throw new Error(`preview did not start: ${b.dir}`);
}

async function newPage(browser, kind, vp) {
  const page = await browser.newPage();
  await page.setViewport(vp);
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`[${kind}][${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`[${kind}][pageerror] ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`[${kind}][requestfailed] ${r.url().slice(0, 120)}`));
  await page.evaluateOnNewDocument((tier) => {
    try {
      localStorage.setItem('pp-3d-tier', tier);
      localStorage.setItem('pp.introSeen.v1', 'true');
    } catch { /* 무시 */ }
  }, TIER);
  return page;
}
const step = (page, s) => page.evaluate((x) => window.__ppStage.debug.step(x), s);
const stage = (page, fn, ...args) => page.evaluate(new Function('a', `const s = window.__ppStage; return (${fn})(s, ...a);`), args);
const cam = (page, pos, look, tan = 0.3, tanV = tan) => page.evaluate((c) => window.__ppStage.debug.cam(c), pos ? { pos, look, tanH: tan, tanV } : null);
/** 모델(아이, 심판, 관중)이 모두 들어올 때까지 기다린다 */
async function settle(page) {
  await page.waitForFunction(() => performance.getEntriesByName('pp3d-extras').length > 0, { timeout: 120000 });
  await page.waitForFunction(() => {
    const d = window.__ppStage.debug;
    if (d.kidKind && d.kidKind() !== 'glb') return false;
    return d.castReady ? d.castReady() : true;
  }, { timeout: 120000 }).catch(() => problems.push('settle: 모델을 기다리다 시간이 넘었어요'));
  await sleep(1200);
}
const SQUARE = { width: 720, height: 720, deviceScaleFactor: 1 };
const PHONE = { width: 360, height: 740, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

/** 놀이 화면의 글자와 단추를 숨기고(3D 만 보이게) 대회장에서 멈춘 상태로 연다 */
async function openBare(page, base) {
  await page.goto(`${base}#p${CODE}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ppStage && window.__ppStage.debug, { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await sleep(400);
  if (await page.$(T('throw-btn'))) {
    await page.click(T('nav-home'));
    await page.waitForSelector(T('go-desk'), { timeout: 10000 });
    await sleep(300);
  }
  await settle(page);
  await page.evaluate(() => window.__ppStage.debug.pause(true));
  await step(page, 0.05);
  await page.evaluate(() => {
    const el = document.createElement('style');
    el.textContent = '.app > *:not(.app__gym) { visibility: hidden !important; }';
    document.head.appendChild(el);
  });
}
/** 실제 놀이 화면(세로, 글자와 단추 포함)을 출발선에서 연다 */
async function openGame(page, base, where = 'aim') {
  await page.goto(`${base}#p${CODE}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ppStage && window.__ppStage.debug, { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await sleep(600);
  if (where === 'aim') {
    if (!(await page.$(T('throw-btn')))) {
      await page.waitForSelector(T('go-throw'), { timeout: 20000 });
      await page.tap(T('go-throw'));
    }
    await page.waitForSelector(T('throw-btn'), { timeout: 20000 });
  } else if (await page.$(T('throw-btn'))) {
    await page.tap(T('nav-home'));
    await page.waitForSelector(T('go-desk'), { timeout: 10000 });
  }
  await settle(page);
  await page.evaluate(() => window.__ppStage.debug.pause(true));
}
async function shot(page, kind, name, clip) {
  await sleep(120);
  const p = join(RAW, `${name}-${kind}.png`);
  await page.screenshot(clip ? { path: p, clip } : { path: p });
  console.log('shot', name, kind);
  return p;
}
function orbit(c, azDeg, d, eyeY, lookY, facing = 0) {
  const a = (azDeg * Math.PI) / 180 - facing;
  return { pos: [c.x + Math.cos(a) * d, eyeY, c.z + Math.sin(a) * d], look: [c.x, lookY, c.z] };
}
const kidFacing = (page) => stage(page, '(s) => Math.atan2(-(s.camPos.z - (-0.56)), s.camPos.x - (-0.4))');
/** 아이의 표정을 고정한다(두 빌드 모두에서 통하도록 무대 안의 함수를 바꿔 끼운다) */
const lockFace = (page, expr, blink) => stage(page, `(s, e, b) => { const c = s.kid.chibi; if (!c.__sf) c.__sf = c.setFace; c.setFace = () => c.__sf(e, b); c.__sf(e, b); }`, expr, blink);
const fakeDone = async (page, dist, time) => {
  await stage(page, '(s, d, t) => s.debug.fakeThrow(d, t)', dist, time);
  for (let i = 0; i < 300; i++) {
    if ((await stage(page, '(s) => s.debug.info().phase')) === 'done') break;
    await step(page, 0.1);
  }
};

async function capture(browser, kind, base) {
  const has = (k) => ONLY.includes(k);
  const headY = KID.y + 0.75 * KID.s;
  // ---------------------------------------------------------------- 얼굴: 표정마다 가까이
  if (has('face')) {
    const page = await newPage(browser, kind, SQUARE);
    await openBare(page, base);
    await step(page, 3.2);   // 손을 흔들지 않는 구간
    const f = await kidFacing(page);
    const o = orbit(KID, -8, 2.6, headY + 0.06, headY - 0.03, f);
    await cam(page, o.pos, o.look, 0.15);
    for (const e of EXPRS) {
      await lockFace(page, e, false);
      await step(page, 0.001);
      await shot(page, kind, `face-${e}`);
    }
    await lockFace(page, 'neutral', true);
    await step(page, 0.001);
    await shot(page, kind, 'face-blink');
    // 옆에서 본 얼굴(코, 볼의 굴곡과 그림이 맞는지)
    const o2 = orbit(KID, -52, 2.6, headY + 0.02, headY - 0.03, f);
    await cam(page, o2.pos, o2.look, 0.15);
    for (const e of ['smile', 'joy']) {
      await lockFace(page, e, false);
      await step(page, 0.001);
      await shot(page, kind, `face34-${e}`);
    }
    await page.close();
  }
  // ---------------------------------------------------------------- 조준: 실제 세로 화면에서 낮게 / 가운데 / 높게
  if (has('aim')) {
    const page = await newPage(browser, kind, PHONE);
    await openGame(page, base, 'aim');
    // 실제 화면의 조작으로 각도를 맞춘다(장면을 위아래로 끈다: 1px 에 0.3도). 화면의 숫자와 아이의 자세가 함께 바뀐다.
    const pitchNow = () => page.$eval(T('angle-readout'), (el) => Number(el.getAttribute('data-pitch')));
    const dragTo = async (target) => {
      for (let n = 0; n < 8; n++) {
        const cur = await pitchNow();
        if (cur === target) break;
        const dy = Math.max(-140, Math.min(140, Math.round((target - cur) / 0.3)));
        await page.touchscreen.touchStart(250, 420);
        for (let i = 1; i <= 7; i++) { await page.touchscreen.touchMove(250, 420 - (dy * i) / 7); await sleep(16); }
        await page.touchscreen.touchEnd();
        await sleep(120);
      }
    };
    for (const [name, pitch] of [['aim-low', -18], ['aim-mid', 20], ['aim-high', 58]]) {
      await dragTo(pitch);
      await step(page, 1.4);
      await shot(page, kind, name);
      // 같은 화면에서 아이만 크게 오려 낸 그림
      await shot(page, kind, `${name}-crop`, { x: 30, y: 200, width: 210, height: 250 });
    }
    // 끝까지 당김: 던지기 단추를 꾹 누른 채로 찍고, 손가락을 단추 밖으로 빼서 놓는다(던지지 않는다)
    await dragTo(20);
    const c = await page.$eval(T('throw-btn'), (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.touchscreen.touchStart(c.x, c.y);
    await sleep(1500);
    await step(page, 1.2);
    await shot(page, kind, 'aim-pull');
    await shot(page, kind, 'aim-pull-crop', { x: 30, y: 200, width: 210, height: 250 });
    await page.touchscreen.touchMove(c.x, c.y - 260);
    await sleep(80);
    await page.touchscreen.touchEnd();
    await page.close();
  }
  // ---------------------------------------------------------------- 자세: 조준 범위 전체(-20 ~ 60도) x 당기기, 가까이
  if (has('pose')) {
    const page = await newPage(browser, kind, { width: 480, height: 480, deviceScaleFactor: 1 });
    await openBare(page, base);
    await stage(page, '(s) => { s.showAim(); s.setAim(20, 0, 0.0); }');
    await step(page, 1.6);
    const aimCam = { pos: [1.95, 1.5, 5.3], look: [-0.3, 1.2, -0.5] };
    await cam(page, aimCam.pos, aimCam.look, 0.15);
    for (const pull of [0, 0.5, 1]) {
      for (const pitch of [-20, 0, 20, 40, 60]) {
        await stage(page, '(s, p, k) => s.setAim(p, 0, k)', pitch, pull);
        await step(page, 1.0);
        await shot(page, kind, `pose-${pull * 10}-${pitch + 20}`);
      }
    }
    // 소매 끝과 엄지(차렷 자세) 가까이
    await fakeDone(page, 8.4, 2.1);
    await step(page, 3.0);
    await cam(page, [1.2, 0.9, 0.9], [-0.36, 0.52, -0.3], 0.1);
    await step(page, 0.001);
    await shot(page, kind, 'close-hand');
    await cam(page, [1.3, 1.0, 0.9], [-0.4, 0.82, -0.56], 0.13);
    await step(page, 0.001);
    await shot(page, kind, 'close-sleeve');
    await page.close();
  }
  // ---------------------------------------------------------------- 심판: 장면 안에서 + 돌려 보기
  if (has('ref')) {
    const page = await newPage(browser, kind, { width: 560, height: 640, deviceScaleFactor: 1 });
    await openBare(page, base);
    await step(page, 1.0);
    const mid = 1.0;
    const o = orbit(REF, 35, 4.6, 1.5, mid, 0);
    await cam(page, o.pos, o.look, 0.27, 0.31);
    await step(page, 0.3);
    await shot(page, kind, 'ref-idle');
    for (let k = 0; k < 8; k++) {
      const t = orbit(REF, 20 - k * 45, 5.2, 1.45, mid, 0);
      await cam(page, t.pos, t.look, 0.25, 0.286);
      await step(page, 0.001);
      await shot(page, kind, `ref-turn-${k}`);
    }
    // 얼굴 가까이
    const fo = orbit(REF, 25, 2.6, 1.75, 1.66, 0);
    await cam(page, fo.pos, fo.look, 0.2, 0.229);
    await step(page, 0.001);
    await shot(page, kind, 'ref-face');
    // 던진 뒤: 지켜보기 -> 깃발 -> 가리키기 -> 박수
    await stage(page, '(s) => { s.showAim(); s.setAim(12, 0, 0); }');
    await step(page, 1.0);
    await cam(page, o.pos, o.look, 0.27, 0.31);
    await stage(page, '(s) => s.debug.fakeThrow(14.2, 3.1)');
    await step(page, 1.6);
    await shot(page, kind, 'ref-watch');
    for (let i = 0; i < 300; i++) {
      if ((await stage(page, '(s) => s.debug.info().phase')) !== 'flight' && (await stage(page, '(s) => s.debug.info().phase')) !== 'windup') break;
      await step(page, 0.1);
    }
    await step(page, 0.35);
    await shot(page, kind, 'ref-flag');
    await step(page, 0.9);
    await shot(page, kind, 'ref-point');
    for (let i = 0; i < 300; i++) {
      if ((await stage(page, '(s) => s.debug.info().phase')) === 'done') break;
      await step(page, 0.1);
    }
    await step(page, 0.8);
    await shot(page, kind, 'ref-clap');
    await page.close();
  }
  // ---------------------------------------------------------------- 관중: 가까이 + 관람석 전체, 평소와 환호
  if (has('crowd')) {
    const page = await newPage(browser, kind, { width: 900, height: 600, deviceScaleFactor: 1 });
    await openBare(page, base);
    await step(page, 1.5);
    const near = { pos: [4.6, 2.3, -1.2], look: [4.2, 1.55, -7.0] };
    const wide = { pos: [8.5, 3.4, 5.5], look: [8.5, 1.6, -7.0] };
    await cam(page, near.pos, near.look, 0.36, 0.24);
    await step(page, 0.4);
    await shot(page, kind, 'crowd-near-idle');
    await cam(page, wide.pos, wide.look, 0.75, 0.5);
    await step(page, 0.001);
    await shot(page, kind, 'crowd-wide-idle');
    await stage(page, '(s) => { s.showAim(); s.setAim(12, 0, 0); }');
    await step(page, 0.6);
    await stage(page, '(s) => s.debug.fakeThrow(6.0, 1.6)');
    for (let i = 0; i < 300; i++) {
      const ph = await stage(page, '(s) => s.debug.info().phase');
      if (ph === 'landed' || ph === 'tape' || ph === 'done') break;
      await step(page, 0.05);
    }
    await stage(page, '(s) => s.crowd && s.crowd.cheer(1, 6, 6)');
    await step(page, 1.25);
    await cam(page, near.pos, near.look, 0.36, 0.24);
    await step(page, 0.001);
    await shot(page, kind, 'crowd-near-cheer');
    await cam(page, wide.pos, wide.look, 0.75, 0.5);
    await step(page, 0.001);
    await shot(page, kind, 'crowd-wide-cheer');
    await page.close();
  }
  // ---------------------------------------------------------------- 대회장(세로 화면)
  if (has('home')) {
    const page = await newPage(browser, kind, PHONE);
    await openGame(page, base, 'home');
    await step(page, 3.4);
    await shot(page, kind, 'home');
    await page.close();
  }
  // ---------------------------------------------------------------- 착지와 줄자(세로 화면). 실제 단추로 던진다(화면의 글자와 장면이 함께 간다).
  if (has('tape')) {
    const page = await newPage(browser, kind, PHONE);
    await openGame(page, base, 'aim');
    await step(page, 0.8);
    await page.evaluate(() => window.__ppStage.debug.pause(false));
    const c = await page.$eval(T('throw-btn'), (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.touchscreen.touchStart(c.x, c.y);
    await sleep(750);
    await page.touchscreen.touchEnd();
    await sleep(60);
    await page.evaluate(() => window.__ppStage.debug.pause(true));
    const until = async (names, dt = 0.05) => {
      for (let i = 0; i < 600; i++) {
        const ph = await stage(page, '(s) => s.debug.info().phase');
        if (names.includes(ph)) return ph;
        await step(page, dt);
        await sleep(15);
      }
      return null;
    };
    await until(['flight', 'landed', 'tape', 'done']);
    await step(page, 1.1);
    await sleep(200);
    await shot(page, kind, 'flight');
    await until(['landed', 'tape', 'done']);
    await step(page, 0.3);
    await sleep(200);
    await shot(page, kind, 'landed');
    await until(['tape', 'done']);
    await step(page, 0.8);
    await sleep(250);
    await shot(page, kind, 'tape');
    await until(['done']);
    await page.evaluate(() => window.__ppStage.debug.pause(false));
    await page.waitForFunction((sel) => /^\d+\.\d\d$/.test(document.querySelector(sel)?.textContent ?? ''), { timeout: 120000 }, T('result-distance')).catch(() => problems.push('tape: 결과 화면을 기다리다 시간이 넘었어요'));
    await sleep(2500);
    await shot(page, kind, 'done');
    await page.close();
  }
  // ---------------------------------------------------------------- 던지는 동작(뒤로 젖힘 -> 휘두름 -> 놓음 -> 마무리)
  if (has('throw')) {
    const page = await newPage(browser, kind, { width: 480, height: 480, deviceScaleFactor: 1 });
    await openBare(page, base);
    await stage(page, '(s) => { s.showAim(); s.setAim(20, 0, 0.6); }');
    await step(page, 1.6);
    await cam(page, [1.95, 1.5, 5.3], [-0.2, 1.15, -0.5], 0.19);
    await stage(page, '(s) => s.debug.fakeThrow(14.2, 3.1)');
    let k = 0;
    for (const dt of [0.12, 0.12, 0.06, 0.05, 0.05, 0.08, 0.15, 0.3]) {
      await step(page, dt);
      await shot(page, kind, `throw-${k++}`);
    }
    await page.close();
  }
  // ---------------------------------------------------------------- 소품
  if (has('props')) {
    const page = await newPage(browser, kind, { width: 720, height: 540, deviceScaleFactor: 1 });
    await openBare(page, base);
    await step(page, 0.5);
    await cam(page, [-0.6, 1.7, -0.6], [-3.1, 0.75, -4.4], 0.36, 0.27);
    await step(page, 0.001);
    await shot(page, kind, 'prop-desk');
    await page.close();
  }
}

// ---------------------------------------------------------------------------
// 붙이기
// ---------------------------------------------------------------------------
async function compose(browser, name, files, labels, cols = files.length, cellW = 720) {
  const have = files.filter((f) => existsSync(f));
  if (have.length !== files.length) { console.log('skip compose', name, '(그림 없음)'); return; }
  const page = await browser.newPage();
  const font = readFileSync(join(ROOT, 'node_modules/@fontsource/jua/files/jua-korean-400-normal.woff2')).toString('base64');
  const imgs = files.map((f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`);
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face { font-family: 'JuaK'; src: url(data:font/woff2;base64,${font}) format('woff2'); }
    body { margin: 0; background: #fffdf6; }
    .grid { display: grid; grid-template-columns: repeat(${cols}, ${cellW}px); gap: 0; }
    .cell { position: relative; line-height: 0; border: 2px solid #1d2a4d; box-sizing: border-box; }
    .cell img { width: 100%; display: block; }
    .tag { position: absolute; left: 10px; top: 10px; font: ${cellW >= 500 ? 28 : cellW >= 300 ? 20 : 15}px/1 'JuaK', sans-serif; color: #1d2a4d; background: #ffc533; border: 2.5px solid #1d2a4d;
      border-radius: 12px; padding: 7px 12px 5px; box-shadow: 0 4px 0 #1d2a4d; transform: rotate(-2deg); white-space: nowrap; }
    .tag.new { background: #2f6fe0; color: #fffdf6; }
  </style></head><body><div class="grid">${imgs.map((src, i) => `<div class="cell"><img src="${src}"><div class="tag ${labels[i]?.startsWith('이후') ? 'new' : ''}" ${labels[i] ? '' : 'style="display:none"'}>${labels[i] ?? ''}</div></div>`).join('')}</div></body></html>`;
  await page.setViewport({ width: cols * cellW, height: 100, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => Promise.all([...document.images].map((im) => im.decode())));
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
  await page.close();
  console.log('composed', name);
}

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
try {
  if (!COMPOSE_ONLY) {
    for (const kind of ['before', 'after']) {
      if (WHICH !== 'both' && WHICH !== kind) continue;
      const base = await startPreview(BUILDS[kind]);
      await capture(browser, kind, base);
    }
  }
  const r = (n, k) => join(RAW, `${n}-${k}.png`);
  const pair = (n) => [r(n, 'before'), r(n, 'after')];
  const L = ['이전', '이후'];
  const has = (k) => ONLY.includes(k);
  if (has('face')) {
    for (const e of EXPRS) await compose(browser, `face-${e}`, pair(`face-${e}`), [`이전: ${EXPR_KO[e]}`, `이후: ${EXPR_KO[e]}`]);
    await compose(browser, 'face-blink', pair('face-blink'), ['이전: 깜빡', '이후: 깜빡']);
    for (const e of ['smile', 'joy']) await compose(browser, `face34-${e}`, pair(`face34-${e}`), [`이전: ${EXPR_KO[e]}(옆)`, `이후: ${EXPR_KO[e]}(옆)`]);
    // 한 장에 모아 보기: 윗줄 이전, 아랫줄 이후
    await compose(browser, 'face-sheet', [...EXPRS.map((e) => r(`face-${e}`, 'before')), ...EXPRS.map((e) => r(`face-${e}`, 'after'))],
      [...EXPRS.map((e) => `이전: ${EXPR_KO[e]}`), ...EXPRS.map((e) => `이후: ${EXPR_KO[e]}`)], 8, 300);
    await compose(browser, 'face-sheet-after', [...EXPRS, 'blink'].map((e) => r(`face-${e}`, 'after')).concat([r('face34-smile', 'after')]), [...EXPRS.map((e) => `이후: ${EXPR_KO[e]}`), '이후: 깜빡', '이후: 옆얼굴'], 5, 360);
  }
  if (has('aim')) {
    for (const n of ['aim-low', 'aim-mid', 'aim-high', 'aim-pull']) await compose(browser, n, pair(n), L, 2, 720);
    const names = ['aim-low-crop', 'aim-mid-crop', 'aim-high-crop', 'aim-pull-crop'];
    await compose(browser, 'aim-game-distance', [...names.map((n) => r(n, 'before')), ...names.map((n) => r(n, 'after'))],
      ['이전: 낮게 -18도', '이전: 가운데 20도', '이전: 높게 58도', '이전: 끝까지 당김', '이후: 낮게 -18도', '이후: 가운데 20도', '이후: 높게 58도', '이후: 끝까지 당김'], 4, 420);
  }
  if (has('pose')) {
    for (const k of ['before', 'after']) {
      const files = [];
      const labels = [];
      for (const pull of [0, 5, 10]) for (const pitch of [0, 20, 40, 60, 80]) { files.push(r(`pose-${pull}-${pitch}`, k)); labels.push(`${k === 'before' ? '이전' : '이후'}: ${pitch - 20}도, 당김 ${pull / 10}`); }
      await compose(browser, `pose-range-${k}`, files, labels, 5, 320);
    }
    await compose(browser, 'close-hand', pair('close-hand'), L);
    await compose(browser, 'close-sleeve', pair('close-sleeve'), L);
  }
  if (has('ref')) {
    for (const n of ['ref-idle', 'ref-face', 'ref-watch', 'ref-flag', 'ref-point', 'ref-clap']) await compose(browser, n, pair(n), L, 2, 560);
    await compose(browser, 'ref-turntable', [...Array(8).keys()].map((k) => r(`ref-turn-${k}`, 'after')), ['이후: 심판 선생님 돌려 보기'], 4, 400);
    await compose(browser, 'ref-actions', ['ref-idle', 'ref-watch', 'ref-flag', 'ref-point', 'ref-clap'].flatMap((n) => [r(n, 'before')]).concat(['ref-idle', 'ref-watch', 'ref-flag', 'ref-point', 'ref-clap'].map((n) => r(n, 'after'))),
      ['이전: 평소', '이전: 지켜보기', '이전: 깃발 번쩍', '이전: 가리키기', '이전: 환호', '이후: 평소', '이후: 지켜보기', '이후: 깃발 번쩍', '이후: 가리키기', '이후: 박수'], 5, 360);
  }
  if (has('crowd')) for (const n of ['crowd-near-idle', 'crowd-near-cheer', 'crowd-wide-idle', 'crowd-wide-cheer']) await compose(browser, n, pair(n), L, 2, 900);
  if (has('home')) await compose(browser, 'home', pair('home'), L, 2, 720);
  if (has('tape')) for (const n of ['flight', 'landed', 'tape', 'done']) await compose(browser, n, pair(n), L, 2, 720);
  if (has('throw')) {
    for (const k of ['before', 'after']) await compose(browser, `throw-sequence-${k}`, [...Array(8).keys()].map((i) => r(`throw-${i}`, k)), [`${k === 'before' ? '이전' : '이후'}: 던지는 동작`], 4, 400);
  }
  if (has('props')) await compose(browser, 'prop-desk', pair('prop-desk'), L, 2, 720);
} finally {
  await browser.close();
  for (const c of children) { try { process.kill(-c.pid); } catch { /* 이미 끝남 */ } }
  if (problems.length) {
    console.log(`problems (${problems.length}):`);
    for (const p of [...new Set(problems)].slice(0, 30)) console.log('  ', p);
  }
}
writeFileSync(join(OUT, 'shots-cast-log.txt'), [...new Set(problems)].join('\n'));
