/**
 * 물리 2판 균형 확인용 놀이 한 판(갈무리 + 숫자). 처음 온 아이처럼 새 저장소, 휴대전화 크기(360 x 740)로 논다.
 *   - 뾰족 화살을 세 가지 종이로 접어 살살 / 보통 / 세게, 몇 가지 각도로 던진다.
 *   - 글라이더를 가장 세게 던져 "위로 솟았다가 힘이 빠졌어요"를 본다.
 *   - 신문지로 날개 넓은 비행기를 가장 세게 던져 "종이가 못 버텼다"는 말을 본다.
 * 숫자는 화면에서 읽은 그대로 적는다(계산을 따로 하지 않는다).
 *
 * 준비: npm run build
 * 실행: node scripts/shots-balance.mjs      갈무리는 screenshots/v10-balance/, 숫자는 그 안의 session.json
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(ROOT, 'screenshots', 'v10-balance');
const PORT = 4186;
const BASE = `http://127.0.0.1:${PORT}/`;
mkdirSync(SHOTS, { recursive: true });
// 지난번 갈무리는 지우고 새로 찍는다(번호가 섞이지 않게).
for (const f of readdirSync(SHOTS)) if (f.endsWith('.png')) rmSync(join(SHOTS, f));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = (id) => `[data-testid="${id}"]`;
const reachable = async (url) => { try { return (await fetch(url)).ok; } catch { return false; } };

async function startPreview() {
  if (await reachable(BASE)) return null;
  const child = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1', '--outDir', 'dist'], { cwd: ROOT, stdio: 'ignore', detached: true });
  for (let i = 0; i < 60; i++) { if (await reachable(BASE)) return child; await sleep(250); }
  throw new Error('미리보기 서버가 뜨지 않았어요');
}

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const preview = await startPreview();
const errors = [];
const rows = [];
let n = 0;

try {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 360, height: 740, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  const exists = async (sel) => (await page.$(sel)) !== null;
  const text = (sel) => page.$eval(sel, (el) => (el.textContent ?? '').trim());
  const shot = async (name) => { n++; const file = `${String(n).padStart(2, '0')}-${name}.png`; await page.screenshot({ path: join(SHOTS, file) }); return file; };
  const tap = async (sel) => {
    await page.waitForSelector(sel, { timeout: 10000 });
    const box = await page.$eval(sel, (el) => { el.scrollIntoView({ block: 'center', inline: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.touchscreen.tap(box.x, box.y);
    await sleep(160);
  };
  const setRange = async (sel, value) => {
    await page.waitForSelector(sel, { timeout: 8000 });
    await page.$eval(sel, (el, v) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
    await sleep(250);
  };
  const place = () => text(T('place'));

  /** 책상에서: 종이를 고르고, 접는 법을 한 번에 접고, (바꿀 것이 있으면) 날개를 다듬은 뒤 출발선으로 간다. */
  const build = async ({ paper, fold, shape }) => {
    if ((await place()) !== '책상') {
      if (await exists(T('edit-fold'))) await tap(T('edit-fold'));
      else { await tap(T('nav-home')); await tap(T('go-desk')); }
    }
    await tap(T('desk-tab-paper'));
    await tap(T(`paper-${paper}`));
    await tap(T('desk-tab-fold'));
    if (await exists(T('guide-other'))) await tap(T('guide-other'));
    await tap(T(`fold-${fold}`));
    await page.waitForSelector(T('guide-instant'), { timeout: 8000 });
    await tap(T('guide-instant'));
    await page.waitForSelector(T('guide-done'), { timeout: 8000 });
    await tap(T('desk-tab-shape'));
    for (const [key, v] of Object.entries(shape ?? {})) await setRange(T(`sh-${key}`), v);
    await sleep(500);
  };
  const goThrow = async () => {
    await tap(T('desk-next'));
    if ((await place()) !== '출발선') await tap(T('desk-next'));
    await page.waitForSelector(T('throw-btn'), { timeout: 10000 });
    await sleep(1500);
  };

  /** 힘 막대를 손가락으로 끌어 눈금 g 에 놓는다. */
  const setPower = async (g) => {
    const tr = await page.$eval(T('power-track'), (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2, w: r.width }; });
    const gx = (k) => tr.x + 16 + (tr.w - 32) * k;
    await page.touchscreen.touchStart(gx(0.5), tr.y);
    for (let i = 1; i <= 8; i++) { await page.touchscreen.touchMove(gx(0.5 + ((g - 0.5) * i) / 8), tr.y); await sleep(20); }
    await page.touchscreen.touchEnd();
    await sleep(200);
  };
  const pitchNow = () => page.$eval(T('angle-readout'), (el) => Number(el.getAttribute('data-pitch')));
  /** 각도: 위로 / 아래로 단추로 한 칸씩 맞춘다. */
  const setPitch = async (deg) => {
    for (let i = 0; i < 90 && (await pitchNow()) !== deg; i++) await page.$eval(T((await pitchNow()) < deg ? 'angle-up' : 'angle-down'), (el) => el.click());
  };

  /** 조준하고 던진 뒤 결과를 읽는다. shots: 'aim' 조준 화면, 'flight' 날아가는 중, 'result' 결과 */
  const fly = async (label, { g, pitch }, shots = []) => {
    if (await exists(T('throw-again'))) { await tap(T('throw-again')); await page.waitForSelector(T('throw-btn'), { timeout: 8000 }); await sleep(500); }
    await setPower(g);
    await setPitch(pitch);
    await sleep(700);
    const aim = { speed: await page.$eval(T('power-gauge'), (el) => Number(el.dataset.speed)), word: await text(T('power-word')), pitch: await pitchNow() };
    const files = [];
    if (shots.includes('aim')) files.push(await shot(`${label}-aim`));
    // 막대에 맞춰 둔 힘 그대로 던진다. 이 검사 기계(소프트웨어 렌더러)에서는 손가락 흉내의 "톡"이 0.18초보다 길게 전달되어
    // "꾹 누르기"(힘 모으기)로 읽히는 일이 있어서, 누른 시간과 상관없는 누름(보조 기기가 쓰는 길: click)으로 던진다.
    // 꾹 눌러 힘을 모으는 손가락 조작은 scripts/e2e.mjs 의 조준 검사가 따로 본다.
    await page.$eval(T('throw-btn'), (el) => el.click());
    await sleep(160);
    if (shots.includes('flight')) {
      await sleep(1250);
      files.push(await shot(`${label}-flight`));
      await page.waitForSelector(T('scorecard') + '.is-in', { timeout: 40000 }).catch(() => {});
      await sleep(350);
      files.push(await shot(`${label}-tape`));
    }
    await page.waitForSelector(T('result-panel'), { timeout: 60000 });
    await sleep(900);
    const r = {
      label, ...aim,
      distance: Number(await text(T('result-distance'))), airtime: Number(await text(T('result-airtime'))),
      verdict: await page.$eval(T('result-line'), (el) => el.getAttribute('data-verdict')), line: await text(T('result-line')),
      grade: await page.$eval(T('stamp'), (el) => el.getAttribute('data-grade')).catch(() => null),
      struct: (await exists(T('result-struct'))) ? await text(T('result-struct')) : null,
      structKind: (await exists(T('result-struct'))) ? await page.$eval(T('result-struct'), (el) => el.getAttribute('data-kind')) : null,
      stickers: (await exists(T('new-stickers'))) ? await page.$$eval('.newsticker__one', (els) => els.map((e) => e.textContent.trim())) : [],
      best: await exists(T('ribbon')),
      code: await page.evaluate(() => window.location.hash.replace(/^#p/, '')),
    };
    if (shots.includes('result')) files.push(await shot(`${label}-result`));
    if (shots.includes('why')) {
      await tap(T('why-open'));
      await sleep(300);
      r.why = await page.$eval('.result .fold__body', (el) => el.innerText.trim());
      files.push(await shot(`${label}-why`));
      await tap(T('why-open'));
    }
    r.files = files;
    rows.push(r);
    console.log(`${label.padEnd(26)} ${String(aim.speed).padStart(4)} m/s ${aim.word} ${String(aim.pitch).padStart(3)}°  ->  ${r.distance.toFixed(2)} m  ${r.airtime.toFixed(2)} 초  ${r.grade}  ${r.line}${r.struct ? `  [${r.struct}]` : ''}${r.stickers.length ? `  +${r.stickers.join(', ')}` : ''}`);
    return r;
  };

  // ---- 처음 온 아이 ----
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(T('place'), { timeout: 15000 });
  await sleep(2500);
  await shot('home-first-visit');
  await tap(T('go-desk'));

  const SOFT = 0.15, MID = 0.5, FULL = 1;
  // 1) 뾰족 화살, 일반 복사지: 처음 던지기는 아무것도 안 바꾸고(처음 값), 그다음 살살 / 보통 / 세게와 각도 몇 가지
  await build({ paper: 'copy80', fold: 'dart' });
  await shot('desk-dart-copy80');
  await goThrow();
  await shot('aim-first-default');
  await fly('dart-copy80-first', { g: MID, pitch: 5 }, ['flight', 'result']);
  await fly('dart-copy80-soft', { g: SOFT, pitch: 5 }, ['aim', 'result']);
  await fly('dart-copy80-mid-15', { g: MID, pitch: 15 });
  await fly('dart-copy80-full-0', { g: FULL, pitch: 0 }, ['aim', 'flight', 'result']);
  await fly('dart-copy80-full-15', { g: FULL, pitch: 15 });
  await fly('dart-copy80-full-30', { g: FULL, pitch: 30 }, ['result']);

  // 2) 뾰족 화살, 신문지
  await build({ paper: 'newsprint', fold: 'dart' });
  await goThrow();
  await fly('dart-news-soft', { g: SOFT, pitch: 5 }, ['result']);
  await fly('dart-news-mid', { g: MID, pitch: 5 });
  await fly('dart-news-full', { g: FULL, pitch: 5 }, ['result', 'why']);
  await fly('dart-news-full-20', { g: FULL, pitch: 20 });

  // 3) 뾰족 화살, 켄트지
  await build({ paper: 'kent160', fold: 'dart' });
  await goThrow();
  await fly('dart-kent-soft', { g: SOFT, pitch: 5 }, ['result']);
  await fly('dart-kent-mid', { g: MID, pitch: 5 });
  await fly('dart-kent-full', { g: FULL, pitch: 5 }, ['result']);
  await fly('dart-kent-full-15', { g: FULL, pitch: 15 });

  // 4) 글라이더(일반 복사지)를 가장 세게: 솟았다가 힘이 빠진다
  await build({ paper: 'copy80', fold: 'glider' });
  await goThrow();
  await fly('glider-copy80-soft', { g: SOFT, pitch: 5 });
  await fly('glider-copy80-full', { g: FULL, pitch: 15 }, ['flight', 'result', 'why']);

  // 5) 신문지로 날개를 넓게(몸통을 가장 얕게, 꼬리를 덜 올려) 다듬은 화살을 가장 세게: 날개가 꺾인다
  await build({ paper: 'newsprint', fold: 'dart', shape: { keelM: 0.008, elevatorDeg: 2.5 } });
  await shot('desk-wide-newsprint');
  await goThrow();
  await fly('wide-news-full', { g: FULL, pitch: 5 }, ['flight', 'result', 'why']);
  // 연구 노트의 "종이가 버텼을까"
  await tap(T('why-open'));
  await tap(T('why-notebook'));
  await page.waitForSelector(T('table-structure'), { timeout: 8000 });
  await page.$eval(T('table-structure'), (el) => el.scrollIntoView({ block: 'center' }));
  await sleep(400);
  await shot('notebook-structure');
  rows.push({ label: 'notebook-structure', table: await page.$eval(T('table-structure'), (el) => el.innerText), note: (await exists(T('nb-structure-note'))) ? await text(T('nb-structure-note')) : null });
  await tap(T('notebook-close'));
  // 6) 신문지 글라이더(기본값)를 가장 세게: 꺾이지는 않고 아슬아슬하게 버틴다
  await build({ paper: 'newsprint', fold: 'glider' });
  await goThrow();
  await fly('glider-news-full', { g: FULL, pitch: 5 }, ['result']);
  await fly('glider-news-soft', { g: SOFT, pitch: 5 }, ['result']);

  // 기록장(스티커판)
  await tap(T('nav-book'));
  await sleep(600);
  await shot('book');
  await page.$eval('.stickerboard', (el) => el.scrollIntoView({ block: 'start' }));
  await sleep(300);
  await shot('book-stickers');
  await ctx.close();
} finally {
  await browser.close();
  if (preview) { try { process.kill(-preview.pid); } catch { /* 이미 끝남 */ } }
}

// 화면의 숫자가 core 로 직접 계산한 값과 같은지, 던진 힘이 막대에 맞춘 힘과 같은지 확인한다.
let mismatches = 0;
for (const r of rows) {
  if (typeof r.distance !== 'number') continue;
  const out = spawnSync('npx', ['tsx', 'scripts/e2e-core.ts', r.code], { cwd: ROOT, encoding: 'utf8' });
  let core = null;
  try { core = JSON.parse(out.stdout.trim().split('\n').pop()); } catch { core = null; }
  r.core = core ? { speedMps: core.throwIn?.speedMps, pitchDeg: core.throwIn?.pitchDeg, distance: core.distance, airtime: core.airtime, verdict: core.verdict } : null;
  const ok = core && core.throwIn && core.throwIn.speedMps === r.speed && core.throwIn.pitchDeg === r.pitch && core.distance === r.distance.toFixed(2) && core.airtime === r.airtime.toFixed(2) && core.verdict === r.verdict;
  if (!ok) { mismatches++; console.log(`다름: ${r.label} 화면 ${r.speed} m/s ${r.pitch}° ${r.distance} m / core ${JSON.stringify(r.core)}`); }
}
console.log(mismatches === 0 ? '모든 비행: 던진 힘과 각도가 맞춘 값과 같고, 화면의 거리 / 시간 / 판정이 core 값과 같다' : `core 와 다른 비행 ${mismatches}번`);
if (mismatches > 0) process.exitCode = 1;

writeFileSync(join(SHOTS, 'session.json'), JSON.stringify({ rows, errors }, null, 2));
console.log(`\n비행 ${rows.filter((r) => typeof r.distance === 'number').length}번, 콘솔 오류 ${errors.length}건`);
if (errors.length > 0) { console.log(errors.join('\n')); process.exitCode = 1; }
