/**
 * 아이 모델 비교 갈무리: 기존 아이(도형 조립)와 새 아이(kid.glb)를 같은 카메라, 같은 조명, 같은 자세로 찍어 나란히 붙인다.
 *
 * 준비: npx vite build --outDir dist-kid     (다른 빌드와 겹치지 않게 따로 빌드한다)
 * 실행: node scripts/shots-kid.mjs [--only=a,b,c,d,e,f,g,h,i,j,k,x] [--out=screenshots/v4-kid] [--size=800] [--compose]
 *       --check 를 주면 그림은 찍지 않고 "새 아이로 한 번 던지기까지 끝나는지"만 확인한다.
 *
 * 무대의 개발용 손잡이(window.__ppStage.debug)로 시간을 직접 넘기므로 두 모델이 정확히 같은 순간에 찍힌다.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1];
const OUT = join(ROOT, arg('out', 'screenshots/v4-kid'));
const RAW = join(OUT, 'raw');
const ONLY = arg('only', 'a,b,c,d,e,f,g,h,i,j,k,x').split(',');
const SIZE = Number(arg('size', '800'));
const CHECK = process.argv.includes('--check');
/** --compose: 새로 찍지 않고, 찍어 둔 그림(raw/)을 다시 붙이기만 한다 */
const COMPOSE_ONLY = process.argv.includes('--compose');
const PORT = 4175;
const BASE = `http://127.0.0.1:${PORT}/`;
mkdirSync(RAW, { recursive: true });

const CODE = 'P19uWgrXAv9kAn015ONpdOEaSzCL1klCelt5QC0ReLIhfeF338e14N3BxJoblqZBi1F5EVBgkLJ';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = (id) => `[data-testid="${id}"]`;
const problems = [];
/** 아이가 서 있는 자리(세계 좌표)와 크기: gym.ts 의 KID_SPOT, STEP_H, kid.ts 의 scale */
const KID = { x: -0.4, y: 0.14, z: -0.56, s: 1.64 };

async function reachable(url) { try { return (await fetch(url)).ok; } catch { return false; } }
async function startPreview() {
  if (await reachable(BASE)) return null;
  const child = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1', '--outDir', 'dist-kid'], { cwd: ROOT, stdio: 'ignore', detached: true });
  for (let i = 0; i < 80; i++) { if (await reachable(BASE)) return child; await sleep(250); }
  throw new Error('preview did not start');
}

async function newPage(browser, kind, vp = { width: SIZE, height: SIZE, deviceScaleFactor: 1 }) {
  const page = await browser.newPage();
  await page.setViewport(vp);
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`[${kind}][${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`[${kind}][pageerror] ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`[${kind}][requestfailed] ${r.url().slice(0, 120)}`));
  await page.evaluateOnNewDocument((k) => {
    try {
      localStorage.setItem('pp-3d-tier', 'high');
      localStorage.setItem('pp.introSeen.v1', 'true');
      localStorage.setItem('pp-kid', k === 'glb' ? 'glb' : 'prim');
    } catch { /* 무시 */ }
  }, kind);
  return page;
}
const step = (page, s) => page.evaluate((x) => window.__ppStage.debug.step(x), s);
const stage = (page, fn, ...args) => page.evaluate(new Function('a', `const s = window.__ppStage; return (${fn})(s, ...a);`), args);
const cam = (page, pos, look, tan = 0.3) => page.evaluate((c) => window.__ppStage.debug.cam(c), pos ? { pos, look, tanH: tan, tanV: tan } : null);

async function open(page, kind) {
  await page.goto(`${BASE}#p${CODE}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ppStage && window.__ppStage.debug, { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await sleep(400);
  if (await page.$(T('throw-btn'))) {
    await page.click(T('nav-home'));
    await page.waitForSelector(T('go-desk'), { timeout: 10000 });
    await sleep(300);
  }
  await page.evaluate(() => window.__ppStage.debug.pause(true));
  await step(page, 0.05);
  if (kind === 'glb') {
    // 깃발(localStorage)로 켠 새 아이가 실제로 들어왔는지 기다린다
    await page.waitForFunction(() => window.__ppStage.debug.kidKind() === 'glb', { timeout: 60000 });
  }
  const got = await page.evaluate(() => window.__ppStage.debug.kidKind());
  if (got !== kind) throw new Error(`kid kind: wanted ${kind}, got ${got}`);
  await page.evaluate(() => {
    const el = document.createElement('style');
    el.textContent = '.app > *:not(.app__gym) { visibility: hidden !important; }';
    document.head.appendChild(el);
  });
}
async function shot(page, kind, name) {
  await sleep(150);
  const p = join(RAW, `${name}-${kind}.png`);
  await page.screenshot({ path: p });
  console.log('shot', name, kind);
  return p;
}

/** 아이 둘레를 도는 카메라: az = 아이의 앞(+X)에서 오른쪽(+Z)으로 잰 각도(도), h = 보는 높이, d = 거리 */
function orbit(azDeg, d, eyeY, lookY, facing = 0) {
  const a = (azDeg * Math.PI) / 180 - facing;
  return { pos: [KID.x + Math.cos(a) * d, eyeY, KID.z + Math.sin(a) * d], look: [KID.x, lookY, KID.z] };
}
const kidFacing = (page) => stage(page, '(s) => Math.atan2(-(s.camPos.z - (-0.56)), s.camPos.x - (-0.4))');

/** 한 모델(kind)로 모든 장면을 찍는다. 두 모델이 같은 순서, 같은 시간으로 지나가므로 자세가 같다. */
async function capture(browser, kind) {
  const has = (k) => ONLY.includes(k) && (kind === 'glb' || !['i', 'j'].includes(k));
  const size = SIZE;
  const midY = KID.y + 0.52 * KID.s, headY = KID.y + 0.74 * KID.s;
  // ---- 대회장 자세(a 전신, b 얼굴, h 뒤/옆)
  if (has('a') || has('b') || has('h')) {
    const page = await newPage(browser, kind);
    await open(page, kind);
    await step(page, 1.0);
    const f = await kidFacing(page);
    if (has('a')) {
      const o = orbit(-32, 4.3, 1.55, midY + 0.02, f);
      await cam(page, o.pos, o.look, 0.27);
      await step(page, 0.3);
      await shot(page, kind, 'a-hero');
    } else await step(page, 0.3);
    if (has('b')) {
      const o = orbit(-12, 2.6, headY + 0.1, headY - 0.02, f);
      await cam(page, o.pos, o.look, 0.19);
      await step(page, 0.1);
      await shot(page, kind, 'b-face');
      // 손을 흔들지 않을 때의 얼굴(웃는 표정)
      await step(page, 2.4);
      await cam(page, o.pos, o.look, 0.19);
      await shot(page, kind, 'b2-face-smile');
    }
    if (has('h')) {
      const o1 = orbit(148, 4.3, 1.75, midY + 0.05, f);
      await cam(page, o1.pos, o1.look, 0.27);
      await step(page, 0.05);
      await shot(page, kind, 'h-back');
      const o2 = orbit(88, 4.3, 1.2, midY - 0.05, f);
      await cam(page, o2.pos, o2.look, 0.27);
      await step(page, 0.05);
      await shot(page, kind, 'h2-side');
    }
    await page.close();
  }
  // ---- 조준(c), 당기기(d), 던지는 순간(e)
  if (has('c') || has('d') || has('e')) {
    const page = await newPage(browser, kind);
    await open(page, kind);
    await stage(page, '(s) => { s.showAim(); s.setAim(20, 0, 0.0); }');
    await step(page, 1.6);
    // 게임의 조준 카메라와 같은 방향에서, 아이가 화면에 차도록 당겨 찍는다
    const aimCam = { pos: [1.95, 1.5, 5.3], look: [-0.25, 1.12, -0.5] };
    if (has('c')) {
      await cam(page, aimCam.pos, aimCam.look, 0.185);
      await step(page, 0.1);
      await shot(page, kind, 'c-aim');
      await stage(page, '(s) => s.setAim(55, 0, 0.0)');
      await step(page, 0.8);
      await shot(page, kind, 'c2-aim-high');
      await stage(page, '(s) => s.setAim(-15, 0, 0.0)');
      await step(page, 0.8);
      await shot(page, kind, 'c3-aim-low');
    }
    await stage(page, '(s) => s.setAim(20, 0, 1.0)');
    await step(page, 0.9);
    await cam(page, aimCam.pos, aimCam.look, 0.185);
    if (has('d')) {
      await step(page, 0.05);
      await shot(page, kind, 'd-windup');
      const o = orbit(-60, 4.4, 1.5, midY, 0);
      await cam(page, o.pos, o.look, 0.26);
      await step(page, 0.05);
      await shot(page, kind, 'd2-windup-front');
    }
    if (has('e')) {
      await cam(page, aimCam.pos, [0.0, 1.15, -0.5], 0.2);
      await stage(page, '(s) => s.debug.fakeThrow(14.2, 3.1)');
      await step(page, 0.26);
      await shot(page, kind, 'e0-back');
      await step(page, 0.08);
      await shot(page, kind, 'e-throw');
      await step(page, 0.07);
      await shot(page, kind, 'e2-release');
      await step(page, 0.22);
      await shot(page, kind, 'e3-follow');
      await step(page, 1.0);
      await shot(page, kind, 'e4-watch');
    }
    await page.close();
  }
  // ---- 결과 반응: 만세(f), 아쉬움(g)
  for (const [key, dist, time, marks] of [['f', 14.2, 3.1, [['f-cheer', 0.33], ['f2-cheer-crouch', 0.3], ['f3-cheer-hold', 2.4]]], ['g', 3.1, 1.1, [['g-slump', 0.7], ['g2-fist', 1.0]]]]) {
    if (!has(key)) continue;
    const page = await newPage(browser, kind);
    await open(page, kind);
    await stage(page, '(s) => { s.showAim(); s.setAim(12, 0, 0); }');
    await step(page, 1.2);
    await stage(page, '(s, d, t) => s.debug.fakeThrow(d, t)', dist, time);
    for (let i = 0; i < 200; i++) {
      if ((await stage(page, '(s) => s.debug.info().phase')) === 'done') break;
      await step(page, 0.1);
    }
    const o = orbit(key === 'f' ? 38 : 52, 4.6, 1.6, midY + 0.12, 0);
    await cam(page, o.pos, o.look, 0.3);
    for (const [name, wait] of marks) {
      await step(page, wait);
      await shot(page, kind, name);
    }
    await page.close();
  }
  // ---- 실제 놀이 화면(세로 화면, 단추와 글자 포함)에서의 모습(k)
  if (has('k')) {
    const page = await newPage(browser, kind, { width: 360, height: 740, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(`${BASE}#p${CODE}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ppStage && window.__ppStage.debug, { timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    await sleep(600);
    if (!(await page.$(T('throw-btn')))) {
      await page.waitForSelector(T('go-throw'), { timeout: 20000 });
      await page.tap(T('go-throw'));
    }
    await page.waitForSelector(T('throw-btn'), { timeout: 20000 });
    if (kind === 'glb') await page.waitForFunction(() => window.__ppStage.debug.kidKind() === 'glb', { timeout: 60000 });
    await sleep(500);
    await page.evaluate(() => window.__ppStage.debug.pause(true));
    await step(page, 2.5);
    await shot(page, kind, 'k-ingame-aim');
    await page.close();
  }
  // ---- 새 모델만: 돌려 보기(i), 철망 보기(j)
  if (has('i') || has('j') || has('x')) {
    const page = await newPage(browser, kind, has('i') || has('j') ? { width: 500, height: 620, deviceScaleFactor: 1 } : { width: size, height: size, deviceScaleFactor: 1 });
    await open(page, kind);
    // '잘했어요' 반응이 끝나면 차렷 자세(Idle)가 된다
    await stage(page, '(s) => { s.showAim(); s.setAim(12, 0, 0); }');
    await step(page, 1.0);
    await stage(page, '(s) => s.debug.fakeThrow(8.4, 2.1)');
    for (let i = 0; i < 200; i++) {
      if ((await stage(page, '(s) => s.debug.info().phase')) === 'done') break;
      await step(page, 0.1);
    }
    await step(page, 3.0);
    if (has('x')) {
      // 가까이 보기: 손, 신발, 옷 끝단(차렷 자세)
      await cam(page, [1.2, 0.9, 0.9], [-0.36, 0.52, -0.3], 0.1);
      await page.evaluate((x) => window.__ppStage.debug.step(x), 0.001);
      await shot(page, kind, 'x-hand');
      await cam(page, [0.9, 0.55, 0.6], [-0.36, 0.25, -0.56], 0.14);
      await page.evaluate((x) => window.__ppStage.debug.step(x), 0.001);
      await shot(page, kind, 'x-shoes');
      await cam(page, [1.3, 1.0, 0.9], [-0.4, 0.78, -0.56], 0.16);
      await page.evaluate((x) => window.__ppStage.debug.step(x), 0.001);
      await shot(page, kind, 'x-torso');
    }
    if (has('i')) {
      for (let k = 0; k < 8; k++) {
        const o = orbit(-k * 45, 4.6, 1.35, midY + 0.02, 0);
        await cam(page, o.pos, o.look, 0.27);
        await step(page, 0.0);
        await page.evaluate((x) => window.__ppStage.debug.step(x), 0.001);
        await shot(page, kind, `i-turn-${k}`);
      }
    }
    if (has('j')) {
      await page.evaluate(() => {
        const sc = window.__ppStage.debug.scene();
        let kidRoot = null;
        sc.traverse((o) => { if (o.isSkinnedMesh && o.name.startsWith('kid_body')) { let p = o; while (p.parent && p.parent !== sc) p = p.parent; kidRoot = p; } });
        for (const c of sc.children) if (c !== kidRoot && !c.isLight) c.visible = false;
        kidRoot.traverse((o) => {
          if (!o.isSkinnedMesh) return;
          if (o.name.startsWith('kid_body') && o.material.side !== 1) { sc.background = o.material.color.clone().set(0xeef2fa); o.material = o.material.clone(); o.material.wireframe = true; o.material.color.set(0x1d2a4d); o.material.vertexColors = false; o.material.needsUpdate = true; }
          else if (o.material.side === 1) o.visible = false;
        });
      });
      for (const [k, az] of [[0, -30], [1, 150]]) {
        const o = orbit(az, 4.6, 1.35, midY + 0.02, 0);
        await cam(page, o.pos, o.look, 0.27);
        await page.evaluate((x) => window.__ppStage.debug.step(x), 0.001);
        await shot(page, kind, `j-wire-${k}`);
      }
    }
    await page.close();
  }
}

// ---------------------------------------------------------------------------
// 붙이기: 캔버스 한 장에 그림을 나란히 놓고 한글 딱지를 단다(게임과 같은 둥근 글꼴)
// ---------------------------------------------------------------------------
async function compose(browser, name, files, labels, cols = files.length, cellW = 800) {
  const page = await browser.newPage();
  const font = readFileSync(join(ROOT, 'node_modules/@fontsource/jua/files/jua-korean-400-normal.woff2')).toString('base64');
  const imgs = files.map((f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`);
  const rows = Math.ceil(files.length / cols);
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face { font-family: 'JuaK'; src: url(data:font/woff2;base64,${font}) format('woff2'); }
    body { margin: 0; background: #fffdf6; }
    .grid { display: grid; grid-template-columns: repeat(${cols}, ${cellW}px); gap: 0; }
    .cell { position: relative; line-height: 0; border: 2px solid #1d2a4d; box-sizing: border-box; }
    .cell img { width: 100%; display: block; }
    .tag { position: absolute; left: 14px; top: 14px; font: ${cellW >= 600 ? 30 : 20}px/1 'JuaK', sans-serif; color: #1d2a4d; background: #ffc533; border: 2.5px solid #1d2a4d;
      border-radius: 12px; padding: 8px 14px 6px; box-shadow: 0 4px 0 #1d2a4d; transform: rotate(-2deg); }
    .tag.new { background: #2f6fe0; color: #fffdf6; }
  </style></head><body><div class="grid">${imgs.map((src, i) => `<div class="cell"><img src="${src}"><div class="tag ${labels[i]?.startsWith('새') ? 'new' : ''}" ${labels[i] ? '' : 'style="display:none"'}>${labels[i] ?? ''}</div></div>`).join('')}</div></body></html>`;
  await page.setViewport({ width: cols * cellW, height: 100, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => Promise.all([...document.images].map((im) => im.decode())));
  const out = join(OUT, `${name}.png`);
  await page.screenshot({ path: out, fullPage: true });
  await page.close();
  console.log('composed', name);
  return rows;
}

/** 새 아이를 켠 채로 놀이가 한 번 던지기까지 끝나는지(결과 화면이 뜨는지) 확인한다. */
async function checkThrow(browser) {
  const page = await newPage(browser, 'glb', { width: 360, height: 740, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.goto(`${BASE}#p${CODE}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ppStage && window.__ppStage.debug, { timeout: 60000 });
  await sleep(600);
  // 코드가 든 주소는 출발선에서 열리기도 하고 대회장에서 열리기도 한다
  if (!(await page.$(T('throw-btn')))) {
    await page.waitForSelector(T('go-throw'), { timeout: 20000 });
    await page.tap(T('go-throw'));
  }
  await page.waitForSelector(T('throw-btn'), { timeout: 20000 });
  await page.waitForFunction(() => window.__ppStage.debug.kidKind() === 'glb', { timeout: 60000 });
  const before = await page.evaluate(() => window.__ppStage.debug.frames());
  await sleep(1500);
  await page.screenshot({ path: join(OUT, 'check-glb-aim.png') });
  // 꾹 눌렀다 떼면 던진다(e2e 와 같은 방법)
  const c = await page.$eval(T('throw-btn'), (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.touchscreen.touchStart(c.x, c.y);
  await sleep(750);
  await page.touchscreen.touchEnd();
  await page.waitForFunction((sel) => /^\d+\.\d\d$/.test(document.querySelector(sel)?.textContent ?? ''), { timeout: 120000 }, T('result-distance'));
  await sleep(1200);
  const dist = await page.$eval(T('result-distance'), (el) => el.textContent);
  const info = await page.evaluate(() => ({ ...window.__ppStage.debug.info(), kid: window.__ppStage.debug.kidKind(), frames: window.__ppStage.debug.frames() }));
  const ext = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((n) => !n.startsWith(location.origin) && !n.startsWith('data:') && !n.startsWith('blob:')));
  await page.screenshot({ path: join(OUT, 'check-glb-throw.png') });
  await page.close();
  const ok = /^\d+\.\d\d$/.test(dist ?? '') && info.kid === 'glb' && info.frames > before && ext.length === 0;
  console.log(`check: 새 아이로 던지기 ${ok ? '통과' : '실패'} (거리 ${dist} m, 단계 ${info.phase}, 아이 ${info.kid}, 프레임 ${info.frames - before}, 외부 요청 ${ext.length}건, 그리기 호출 ${info.calls}, 삼각형 ${info.triangles})`);
  return ok;
}

const preview = await startPreview();
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
let failed = false;
try {
  if (CHECK) failed = !(await checkThrow(browser));
  else {
    if (!COMPOSE_ONLY) {
      await capture(browser, 'prim');
      await capture(browser, 'glb');
    }
    const pair = (n) => [join(RAW, `${n}-prim.png`), join(RAW, `${n}-glb.png`)];
    const L = ['지금', '새 모델'];
    const pairs = { a: ['a-hero'], b: ['b-face', 'b2-face-smile'], c: ['c-aim', 'c2-aim-high', 'c3-aim-low'], d: ['d-windup', 'd2-windup-front'], e: ['e0-back', 'e-throw', 'e2-release', 'e3-follow', 'e4-watch'], f: ['f-cheer', 'f2-cheer-crouch', 'f3-cheer-hold'], g: ['g-slump', 'g2-fist'], h: ['h-back', 'h2-side'], x: ['x-hand', 'x-shoes', 'x-torso'] };
    for (const [k, names] of Object.entries(pairs)) if (ONLY.includes(k)) for (const n of names) await compose(browser, n, pair(n), L);
    if (ONLY.includes('k')) await compose(browser, 'k-ingame-aim', pair('k-ingame-aim'), L, 2, 720);
    if (ONLY.includes('i')) await compose(browser, 'i-turntable', [...Array(8).keys()].map((k) => join(RAW, `i-turn-${k}-glb.png`)), ['새 모델: 돌려 보기'], 4, 400);
    if (ONLY.includes('j')) {
      await compose(browser, 'j2-wireframe-stage', [0, 1].map((k) => join(RAW, `j-wire-${k}-glb.png`)), ['새 모델: 게임 화면의 철망(삼각형)'], 2, 800);
      // 사각형 면 흐름: build_kid.py 가 남긴 SVG 를 그림으로 바꾼다
      const svg = join(RAW, 'topology.svg');
      if (existsSync(svg)) {
        const page = await browser.newPage();
        await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
        const font = readFileSync(join(ROOT, 'node_modules/@fontsource/jua/files/jua-korean-400-normal.woff2')).toString('base64');
        await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>@font-face { font-family: 'JuaK'; src: url(data:font/woff2;base64,${font}) format('woff2'); }
          body { margin: 0; position: relative; width: 1600px; height: 1000px; }
          .tag { position: absolute; left: 14px; top: 14px; font: 30px/1 'JuaK', sans-serif; color: #fffdf6; background: #2f6fe0; border: 2.5px solid #1d2a4d; border-radius: 12px; padding: 8px 14px 6px; box-shadow: 0 4px 0 #1d2a4d; transform: rotate(-2deg); }
          </style></head><body>${readFileSync(svg, 'utf8')}<div class="tag">새 모델: 면 흐름(전부 사각형)</div></body></html>`, { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: join(OUT, 'j-wireframe.png') });
        await page.close();
        console.log('composed j-wireframe (topology)');
      }
    }
  }
} finally {
  await browser.close();
  if (preview) { try { process.kill(-preview.pid); } catch { /* 이미 끝남 */ } }
  if (problems.length) {
    console.log(`problems (${problems.length}):`);
    for (const p of [...new Set(problems)].slice(0, 30)) console.log('  ', p);
  }
}
writeFileSync(join(OUT, 'shots-kid-log.txt'), problems.join('\n'));
if (failed) process.exit(1);
