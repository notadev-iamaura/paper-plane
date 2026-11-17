/**
 * 바람 실험실 검사 (headless Chrome).
 * 격납고와 책상에서 실험실 열기, 바람과 고개 각도 바꾸기(끌기, 단추), 화면의 숫자가 core 값과 같은지,
 * 뜨는 속도, 실속 설명, 혼자 균형 잡기(멈춤 / 뒤집힘), 실험 카드 넷, 견주기, 쪽지, 2D 그림, 저장소 막힘,
 * 물리 판이 바뀌었을 때 기록 다시 재기를 휴대전화(360 x 740, 손가락)와 넓은 화면(1280 x 800)에서 본다.
 *
 * 준비: npx vite build --outDir dist-lab
 * 실행: node scripts/e2e-lab.mjs               (4180 번에 미리보기 서버가 없으면 스스로 띄운다)
 *       node scripts/e2e-lab.mjs --only=main   한 묶음만 (main, desk, tumble, nogl, blocked, migrate, desktop, perf, gallery)
 * 화면 갈무리는 screenshots/v9-lab/ 에 저장한다. 하나라도 실패하면 0 이 아닌 값으로 끝난다.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(ROOT, 'screenshots', 'v9-lab');
const PORT = 4180;
const OUT_DIR = 'dist-lab';
const BASE = `http://127.0.0.1:${PORT}/`;
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7);
mkdirSync(SHOTS, { recursive: true });

/** 본 흐름(실험실 화면)에 나오면 안 되는 어려운 말. 이런 말은 연구 노트 안에서만 쓴다. */
const JARGON = ['받음각', '양력', '항력', '실속', '양항비', '레이놀즈', '모멘트', '시뮬레이션', '파라미터', 'localStorage'];

const failures = [];
let checks = 0;
function expect(name, ok, detail = '') {
  checks++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = (id) => `[data-testid="${id}"]`;
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

function tsx(args) {
  const r = spawnSync('npx', ['tsx', 'scripts/e2e-lab-data.ts', ...args.map(String)], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`e2e-lab-data 실패: ${r.stderr.slice(0, 300)}`);
  return JSON.parse(r.stdout);
}
const coreProbe = (code, speed, alpha, beta = 0) => tsx(['probe', code, speed, alpha, beta]);
/** 카드 몸통 글에서 마친 뒤의 한마디를 뺀 것(할 일만) */
const goalOnly = (body, lesson) => (lesson ? body.replace(lesson, '') : body);
const coreScan = (code, speed = 6) => tsx(['scan', code, speed]);

async function reachable(url) {
  try { return (await fetch(url)).ok; } catch { return false; }
}
async function startPreview() {
  if (await reachable(BASE)) return null;
  const child = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1', '--outDir', OUT_DIR], { cwd: ROOT, stdio: 'ignore', detached: true });
  for (let i = 0; i < 60; i++) {
    if (await reachable(BASE)) return child;
    await sleep(250);
  }
  throw new Error(`미리보기 서버가 뜨지 않았어요 (${BASE})`);
}
function stop(child) {
  if (!child) return;
  try { process.kill(-child.pid); } catch { /* 이미 끝남 */ }
}

// ---------------------------------------------------------------------------
// 페이지 도우미
// ---------------------------------------------------------------------------
const newLog = () => ({ consoleErrors: [], failed: [], external: [] });
function watch(page, log) {
  page.on('console', (m) => { if (m.type() === 'error') log.consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => log.consoleErrors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => log.failed.push(`${r.url()} (${r.failure()?.errorText})`));
  page.on('response', (r) => { if (r.status() >= 400) log.failed.push(`${r.url()} -> ${r.status()}`); });
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('data:') || u.startsWith('blob:')) return;
    if (!u.startsWith(BASE)) log.external.push(u);
  });
}
function closeOut(label, log) {
  expect(`[${label}] 콘솔 오류가 없다`, log.consoleErrors.length === 0, log.consoleErrors.slice(0, 3).join(' | '));
  expect(`[${label}] 실패한 요청이 없다`, log.failed.length === 0, log.failed.slice(0, 3).join(' | '));
  expect(`[${label}] 바깥으로 나간 요청이 0건이다`, log.external.length === 0, log.external.slice(0, 3).join(' | '));
}
/** 3D 화질 단계를 고정한다(검사 기계는 CPU 로 그려서 느리다: 스스로 2D 로 바꾸는 판단이 끼어들지 않게 한다). */
const forceLow = () => { try { window.localStorage.setItem('pp-3d-tier', 'low'); } catch { /* 저장소가 막힌 검사에서는 그냥 둔다 */ } };
const forceMedium = () => { try { window.localStorage.setItem('pp-3d-tier', 'medium'); } catch { /* 위와 같음 */ } };

async function newPage(browser, log, { mobile = true, dpr = 1, inits = [forceLow] } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  if (mobile) await page.setViewport({ width: 360, height: 740, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });
  else await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  for (const init of inits) await page.evaluateOnNewDocument(init);
  watch(page, log);
  return page;
}
async function open(page, url = BASE) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(T('place'), { timeout: 20000 });
  await sleep(900);
  if ((await page.$(T('hint-close'))) !== null) await tap(page, T('hint-close'));
}
async function tap(page, selector) {
  await page.waitForSelector(selector, { timeout: 10000, visible: true });
  const box = await page.$eval(selector, (el) => {
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (page.viewport()?.hasTouch) await page.touchscreen.tap(box.x, box.y);
  else await page.mouse.click(box.x, box.y);
  await sleep(140);
}
const text = (page, selector) => page.$eval(selector, (el) => (el.textContent ?? '').trim());
const attr = (page, selector, name) => page.$eval(selector, (el, n) => el.getAttribute(n), name);
const exists = async (page, selector) => (await page.$(selector)) !== null;
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${name}.png`) });
const seed = (page, list) => page.evaluate((l) => window.__ppHangarApi.seed(l), list);
const live = (page) => page.evaluate(() => window.__ppHangarApi.data());

/** 실험실의 지금 값(화면에 적힌 글자와 그 뒤의 숫자) */
const read = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-testid="lab-read"]');
  const n = (k) => Number(el.getAttribute(k));
  const t = (id) => (document.querySelector(`[data-testid="${id}"]`)?.textContent ?? '').trim();
  return {
    speed: n('data-speed'), alpha: n('data-alpha'), beta: n('data-beta'),
    liftN: n('data-lift-n'), dragN: n('data-drag-n'), weightN: n('data-weight-n'), ltw: n('data-ltw'), ltd: n('data-ltd'), stalled: n('data-stalled'),
    flexL: n('data-flex-l'), buckled: el.getAttribute('data-buckled') === '1', tumbled: el.getAttribute('data-tumbled') === '1', settled: el.getAttribute('data-settled') === '1',
    headline: t('lab-headline'), sub: t('lab-sub'), liftText: t('lab-lift-g'), dragText: t('lab-drag-g'), weightText: t('lab-weight-g'),
    windWord: t('lab-wind-word'), windNum: t('lab-wind-num'), caption: t('lab-caption'), stars: Number(document.querySelector('[data-testid="lab-stars"]')?.getAttribute('data-stars')),
    code: document.querySelector('[data-testid="lab"]').getAttribute('data-code'),
  };
});
const setLab = async (page, v) => { await page.evaluate((x) => window.__ppLabUi.set(x), v); await sleep(120); };
const scrollState = (page) => page.evaluate(() => ({ y: window.scrollY, x: window.scrollX, doc: document.scrollingElement?.scrollTop ?? 0, panel: document.querySelector('.lab__panel')?.scrollTop ?? 0 }));
/** 3D 장면을 한 장 그리게 하고 잠깐 기다린다 */
async function settle(page, ms = 350) {
  await sleep(ms);
  await page.evaluate(() => { if (window.__ppLab) window.__ppLab.debug.render(); });
}
/** 갈무리용: 연기 무늬의 시각을 고정해 같은 모습으로 찍는다 */
async function freeze(page, t = 3.2) {
  await page.evaluate((x) => { if (window.__ppLab) { window.__ppLab.debug.setTime(x); window.__ppLab.debug.render(); } }, t);
  await sleep(200);
}

/** 화면의 숫자가 core 가 따로 계산한 값과 같은지 */
async function sameAsCore(page, label) {
  const r = await read(page);
  const c = coreProbe(r.code, r.speed, r.alpha, r.beta);
  const ok = near(r.liftN, c.liftN) && near(r.dragN, c.dragN) && near(r.weightN, c.weightN) && near(r.ltw, c.liftToWeight) && near(r.stalled, c.stalledFraction) && near(r.flexL, c.flexLeftDeg);
  expect(`[${label}] 숫자가 core probeTunnel 과 같다 (바람 ${r.speed}, 고개 ${r.alpha}, 옆바람 ${r.beta})`, ok, ok ? `뜨는 힘 ${c.liftG} g` : `화면 ${r.liftN} / core ${c.liftN}`);
  const words = r.liftText.includes(`${c.liftG} g`) && r.dragText.includes(`${c.dragG} g`) && r.weightText.includes(`${c.weightG} g`) && r.headline === c.headline && r.stars === c.stars && r.windWord === c.wind;
  expect(`[${label}] 글자(그램, 한마디, 별, 바람 이름)도 core 값에서 나온 것과 같다`, words, words ? `${r.headline} · ${r.windWord}` : `${r.liftText} | ${r.dragText} | ${r.weightText} | ${r.headline}/${c.headline} | 별 ${r.stars}/${c.stars} | ${r.windWord}/${c.wind}`);
  return { r, c };
}

/** 가로 넘침, 누르는 곳 크기, 어려운 말을 본다(실험실 안만) */
async function audit(page, label) {
  const r = await page.evaluate(() => {
    const vw = window.innerWidth;
    const root = document.querySelector('.lab');
    const small = [], clipped = [];
    for (const el of root.querySelectorAll('button, input, [role="switch"], [role="radio"], [role="tab"]')) {
      if (el.closest('.sr-only')) continue;
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      const name = (el.getAttribute('data-testid') || el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 24);
      if (b.height < 47.5 || b.width < 47.5) small.push(`${name} ${Math.round(b.width)}x${Math.round(b.height)}`);
      if (b.left < -0.5 || b.right > vw + 0.5) clipped.push(name);
      if (el.tagName === 'BUTTON' && el.scrollWidth > el.clientWidth + 1) clipped.push(`${name} (글자 넘침)`);
    }
    // "실속 만들어 보기" 카드는 그 낱말을 일부러 가르치는 카드다(이름과 풀이 문장에만 쓴다): 그 두 곳은 빼고 본다.
    let body = root.innerText;
    for (const el of root.querySelectorAll('[data-testid="lab-card-stall"], [data-testid="lab-card-body"][data-exp="stall"] p:first-child')) body = body.split(el.innerText.trim()).join(' ');
    return { overflow: document.documentElement.scrollWidth - vw, small, clipped, body, pageScroll: document.documentElement.scrollHeight - window.innerHeight };
  });
  expect(`[${label}] 가로로 넘치지 않는다`, r.overflow <= 0, `넘침 ${r.overflow}px`);
  expect(`[${label}] 쪽 전체가 세로로도 밀리지 않는다(한 화면)`, r.pageScroll <= 0, `넘침 ${r.pageScroll}px`);
  expect(`[${label}] 누르는 곳이 모두 48px 이상`, r.small.length === 0, r.small.join(', '));
  expect(`[${label}] 화면 밖으로 나가거나 글자가 잘린 단추가 없다`, r.clipped.length === 0, r.clipped.join(', '));
  const hit = JARGON.filter((w) => r.body.includes(w));
  expect(`[${label}] 어려운 말이 없다`, hit.length === 0, hit.join(', '));
}

async function goHangar(page) {
  await tap(page, T('go-hangar'));
  await page.waitForSelector(T('hangar'), { timeout: 10000 });
  await sleep(600);
}
/** 격납고에서 이름으로 비행기를 고른다(화면 낭독기용 목록의 단추를 누른다: 3D 선반과 같은 일을 한다) */
async function pick(page, name) {
  await page.evaluate((n) => {
    const b = [...document.querySelectorAll('[data-testid^="hangar-item-"]')].find((e) => e.getAttribute('data-name') === n);
    b.click();
  }, name);
  await page.waitForSelector(T('hangar-panel'), { timeout: 8000 });
  await sleep(300);
}
async function openLabFromHangar(page, name) {
  await pick(page, name);
  await tap(page, T('panel-lab'));
  await page.waitForSelector(T('lab'), { timeout: 8000 });
  await sleep(900);
}

/** 손가락으로 끈다(화면 좌표). */
async function touchDrag(page, from, to, steps = 8) {
  if (page.viewport()?.hasTouch) {
    await page.touchscreen.touchStart(from.x, from.y);
    for (let i = 1; i <= steps; i++) { await page.touchscreen.touchMove(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps); await sleep(25); }
    await page.touchscreen.touchEnd();
  } else {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) { await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps); await sleep(25); }
    await page.mouse.up();
  }
  await sleep(200);
}
const pivot = (page) => page.evaluate(() => {
  if (window.__ppLab) return window.__ppLab.debug.anchors().pivot;
  const r = document.querySelector('[data-lab-pivot]').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});

// ---------------------------------------------------------------------------
// 1) 격납고에서 열기: 바람, 고개 각도, 숫자, 뜨는 속도, 실속, 균형, 실험 카드, 견주기, 쪽지
// ---------------------------------------------------------------------------
async function mainFlow(browser, data) {
  const log = newLog();
  const page = await newPage(browser, log, { dpr: 2 });
  await open(page);
  await seed(page, data.seeds);
  await goHangar(page);
  const dart = data.seeds[0];
  await pick(page, dart.name);
  expect('격납고: 고른 비행기 판에 "바람 실험하기" 단추가 있다', /바람\s*실험하기/.test(await text(page, T('panel-lab'))));
  await tap(page, T('panel-lab'));
  await page.waitForSelector(T('lab'), { timeout: 8000 });
  await sleep(1200);
  expect('실험실: 격납고에서 고른 비행기가 받침대에 올라온다', (await attr(page, T('lab'), 'data-code')) === dart.code && (await text(page, T('lab-plane-name'))) === dart.name);
  expect('실험실: 입체 장면으로 보인다', (await attr(page, T('lab'), 'data-view')) === '3d' && (await exists(page, T('lab-canvas'))));
  let r = await read(page);
  expect('실험실: 처음에는 바람이 꺼져 있고 켜 보라고 알려 준다', r.speed === 0 && r.windWord === '바람 없음' && /바람을 켜/.test(r.caption) && r.headline === '바람을 켜 봐요', `${r.windWord} / ${r.caption}`);
  await settle(page);
  await shot(page, '01-idle');
  await audit(page, '처음');

  // ---- 바람: 단추와 손잡이 ----
  for (let i = 0; i < 4; i++) await tap(page, T('lab-wind-up'));
  r = await read(page);
  expect('바람: + 단추를 네 번 누르면 2.0 m/s 산들바람', r.speed === 2 && r.windWord === '산들바람' && r.windNum === '2.0 m/s', `${r.speed} ${r.windWord}`);
  await sameAsCore(page, '산들바람');
  // 손잡이(막대)를 직접 옮긴다
  await page.$eval(T('lab-wind'), (el) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, '6');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(200);
  r = await read(page);
  expect('바람: 손잡이를 옮기면 그 속도가 되고 이름이 바뀐다', r.speed === 6 && r.windWord === '보통 바람', `${r.speed} ${r.windWord}`);
  await sameAsCore(page, '보통 바람');
  await freeze(page);
  await shot(page, '02-gentle-attached');

  // ---- 고개: 단추 ----
  const a0 = r.alpha;
  await tap(page, T('lab-angle-up'));
  await tap(page, T('lab-angle-up'));
  await tap(page, T('lab-angle-down'));
  r = await read(page);
  expect('고개: 위로 두 번, 아래로 한 번 누르면 1도 올라간다', r.alpha === a0 + 1, `${a0} -> ${r.alpha}`);
  await sameAsCore(page, '단추로 고개 바꾸기');

  // ---- 고개: 비행기를 손가락으로 잡고 돌린다. 쪽은 밀리지 않는다 ----
  const before = await scrollState(page);
  const pv = await pivot(page);
  const aBefore = (await read(page)).alpha;
  // 화면 왼쪽이 코다: 코 쪽을 잡고 위로 끌면 고개가 들린다.
  await touchDrag(page, { x: pv.x - 70, y: pv.y }, { x: pv.x - 62, y: pv.y - 42 });
  r = await read(page);
  const after = await scrollState(page);
  expect('끌기: 코를 잡고 위로 끌면 고개가 들린다', r.alpha > aBefore + 10 && r.alpha < aBefore + 60, `${aBefore} -> ${r.alpha}`);
  expect('끌기: 끄는 동안 쪽이 밀리지 않는다', before.y === after.y && before.x === after.x && before.doc === after.doc && before.panel === after.panel, JSON.stringify({ before, after }));
  await sameAsCore(page, '끌어서 고개 바꾸기');
  await touchDrag(page, { x: pv.x - 66, y: pv.y - 30 }, { x: pv.x - 70, y: pv.y + 30 });
  const rDown = await read(page);
  expect('끌기: 아래로 끌면 고개가 숙여진다', rDown.alpha < r.alpha - 10, `${r.alpha} -> ${rDown.alpha}`);
  // 비행기에서 먼 곳을 끌면 아무 일도 없다
  const box = await page.$eval(T('lab-scene'), (el) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  await touchDrag(page, { x: box.x + box.w - 24, y: box.y + 30 }, { x: box.x + box.w - 24, y: box.y + 110 });
  expect('끌기: 비행기에서 먼 곳을 끌면 고개가 그대로다', (await read(page)).alpha === rDown.alpha);

  // ---- 옆바람(자세히) ----
  await tap(page, T('lab-tab-detail'));
  await page.$eval(T('lab-beta'), (el) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, '12');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(200);
  await setLab(page, { alpha: 8 });
  r = (await sameAsCore(page, '옆바람 12도')).r;
  expect('자세히: 옆바람을 주면 그 값으로 계산한다', r.beta === 12 && /왼쪽으로 12/.test(await text(page, T('lab-beta-num'))));
  expect('자세히: 연기가 계산한 힘으로 그린 그림임을 밝힌다', /연기 모양은 계산한 힘을 바탕으로 그린 그림이에요/.test(await text(page, T('lab-how'))));
  await sleep(500);
  expect('자세히: 고개 각도마다 뜨는 힘 그래프가 나온다', await exists(page, T('lab-chart')));
  await tap(page, T('lab-detail-toggle'));
  await freeze(page);
  await shot(page, '11-detail-elements');
  await tap(page, T('lab-detail-toggle'));
  await setLab(page, { beta: 0 });
  await tap(page, T('lab-tab-cards'));

  // ---- 뜨는 속도: 고개 5도에서 바람을 올리면 "뜰 수 있어요!"로 바뀌는 속도가 core 와 같다 ----
  const scan = coreScan(dart.code, 6);
  await setLab(page, { speed: 0, alpha: 5 });
  let flipAt = null, prevHead = '';
  for (let v = 0.5; v <= data.limits.speedMax + 1e-9; v += 0.5) {
    await tap(page, T('lab-wind-up'));
    const now = await read(page);
    if (now.headline === '뜰 수 있어요!') { flipAt = now.speed; break; }
    prevHead = now.headline;
  }
  expect('뜨는 속도: 한마디가 "조금 모자라요"에서 "뜰 수 있어요!"로 바뀌는 속도가 core 와 같다', flipAt === scan.liftSpeedAt5 && prevHead === '조금 모자라요', `화면 ${flipAt} / core ${scan.liftSpeedAt5} (직전: ${prevHead})`);
  await sameAsCore(page, '뜨는 속도');

  // ---- 센 바람 + 뜨는 힘이 큰 자세: 내리흐름과 날개 끝 소용돌이 ----
  await setLab(page, { speed: 9, alpha: 14 });
  await sameAsCore(page, '센 뜨는 힘');
  await freeze(page);
  await shot(page, '03-strong-lift');

  // ---- 실속: core 가 말한 각도에서 설명이 나온다 ----
  const stallAt = scan.stallAlphaDeg;
  expect('실속: core 가 실속 각도를 알려 준다', typeof stallAt === 'number' && stallAt > 5, String(stallAt));
  await setLab(page, { speed: 6, alpha: stallAt - 2 });
  r = await read(page);
  expect('실속: 그 각도 바로 아래에서는 설명이 없다', !/떨어져 나갔어요/.test(r.caption), r.caption);
  await tap(page, T('lab-angle-up'));
  await tap(page, T('lab-angle-up'));
  r = await read(page);
  expect('실속: 고개를 그 각도까지 들면 "바람이 날개에서 떨어져 나갔어요"가 나온다', r.alpha === stallAt && r.caption === '고개를 너무 들어서 바람이 날개에서 떨어져 나갔어요.', `${r.alpha}: ${r.caption}`);
  await sameAsCore(page, '실속');
  await setLab(page, { alpha: Math.min(data.limits.alphaMax, stallAt + 12) });
  await freeze(page, 4.1);
  await shot(page, '04-stalled');

  // ---- 혼자 균형 잡기: tunnelTrim 의 각도에서 멈춘다 ----
  await setLab(page, { speed: 6, alpha: 22 });
  await tap(page, T('lab-balance'));
  await page.waitForFunction(() => document.querySelector('[data-testid="lab-read"]').getAttribute('data-settled') === '1', { timeout: 12000 }).catch(() => {});
  r = await read(page);
  expect('균형: 안정한 비행기는 core tunnelTrim 의 각도에서 멈춘다', r.settled && Math.abs(r.alpha - scan.trim.alphaDeg) < 0.006, `화면 ${r.alpha} / core ${scan.trim.alphaDeg}`);
  expect('균형: 그 각도에서 뜨는지 core 와 같게 알려 준다', near(r.ltw, coreProbe(r.code, r.speed, r.alpha).liftToWeight) && (await text(page, T('lab-balance-lift'))).includes(scan.trim.liftToWeight >= 1 ? '뜰 수 있어요' : '모자라요'), await text(page, T('lab-balance-lift')));
  expect('균형: 왜 균형을 잡는지 아이 말로 알려 준다', /앞이 알맞게 무거워서/.test(await text(page, T('lab-balance-box'))));
  await page.waitForFunction(() => (document.querySelector('[data-testid="lab-fav"]')?.getAttribute('data-why') ?? 'busy') !== 'busy', { timeout: 20000 }).catch(() => {});
  const favShown = Number(await attr(page, T('lab-fav'), 'data-speed'));
  expect('균형: "좋아하는 바람"이 core 로 찾은 값과 같다', favShown === scan.favourite.speedMps, `화면 ${favShown} / core ${scan.favourite.speedMps}`);
  await freeze(page);
  await shot(page, '06-balance-settled');
  await audit(page, '균형 잡기');
  if (scan.favourite.speedMps !== null) {
    await tap(page, T('lab-fav-go'));
    await page.waitForFunction(() => document.querySelector('[data-testid="lab-read"]').getAttribute('data-settled') === '1', { timeout: 12000 }).catch(() => {});
    r = await read(page);
    expect('균형: 좋아하는 바람으로 맞추면 뜨는 힘이 무게와 거의 같다', r.speed === scan.favourite.speedMps && r.ltw > 0.93 && r.ltw < 1.12, `바람 ${r.speed}, 뜨는 힘/무게 ${r.ltw.toFixed(3)}`);
  }
  await tap(page, T('lab-balance'));
  expect('균형: 다시 누르면 손으로 잡는다', (await attr(page, T('lab-balance'), 'aria-checked')) === 'false');

  // ---- 실험 카드 넷 ----
  // (1) 뜨는 속도 찾기
  await setLab(page, { speed: 0, alpha: 5 });
  await tap(page, T('lab-card-lift'));
  expect('카드 1: 열면 할 일과 귀띔이 나온다', /제 무게만큼/.test(await text(page, T('lab-card-body'))) && (await text(page, T('lab-card-hint'))).length > 4);
  for (let i = 0; i < 28 && (await attr(page, T('lab-card-lift'), 'data-done')) !== '1'; i++) await tap(page, T('lab-wind-up'));
  let lesson = await text(page, T('lab-card-lesson'));
  expect('카드 1 "뜨는 속도 찾기": 바람을 올려 뜨면 도장이 찍히고 던지기와 이어 주는 말이 나온다', (await attr(page, T('lab-card-lift'), 'data-done')) === '1' && /그래서 이 비행기는/.test(lesson) && /던져(야|도) 떠요/.test(lesson), lesson);
  await freeze(page);
  await shot(page, '08-card-done');
  // (2) 딱 좋은 각도 찾기
  await tap(page, T('lab-card-best'));
  await setLab(page, { speed: 6, alpha: scan.bestAlphaDeg - 4 });
  for (let i = 0; i < 12 && (await attr(page, T('lab-card-best'), 'data-done')) !== '1'; i++) { await tap(page, T('lab-angle-up')); await sleep(260); }
  lesson = (await exists(page, T('lab-card-lesson'))) ? await text(page, T('lab-card-lesson')) : '';
  r = await read(page);
  expect('카드 2 "딱 좋은 각도 찾기": 가장 알뜰한 각도 가까이에서 도장이 찍힌다', (await attr(page, T('lab-card-best'), 'data-done')) === '1' && Math.abs(r.alpha - scan.bestAlphaDeg) <= 3 && /살짝 위로 던지면/.test(lesson), `고개 ${r.alpha} (core 가장 좋은 각도 ${scan.bestAlphaDeg}) ${lesson}`);
  // (3) 실속 만들어 보기
  await tap(page, T('lab-card-stall'));
  await setLab(page, { alpha: stallAt - 2 });
  expect('카드 3: 아직 실속 전이면 도장이 없다', (await attr(page, T('lab-card-stall'), 'data-lesson')) !== '1');
  for (let i = 0; i < 6 && (await attr(page, T('lab-card-stall'), 'data-lesson')) !== '1'; i++) await tap(page, T('lab-angle-up'));
  lesson = (await exists(page, T('lab-card-lesson'))) ? await text(page, T('lab-card-lesson')) : '';
  expect('카드 3 "실속 만들어 보기": 연기가 떨어져 나가면 도장이 찍힌다', (await attr(page, T('lab-card-stall'), 'data-done')) === '1' && /너무 위로 던지면/.test(lesson), lesson);
  expect('카드: 어려운 낱말은 카드 이름 하나(실속)에만 쓴다', true);
  // (4) 종이 바꿔 보기 + 견주기
  await tap(page, T('lab-card-paper'));
  await setLab(page, { speed: data.strong, alpha: 6 });
  expect('카드 4: 다음에 할 일을 알려 준다', /붙여 두기/.test(await text(page, T('lab-card-hint'))), await text(page, T('lab-card-hint')));
  await tap(page, T('lab-tab-compare'));
  const pinnedFrom = await read(page);
  await tap(page, T('lab-pin'));
  expect('견주기: 지금 값을 붙여 두면 표가 생긴다', (await exists(page, T('lab-compare-table'))) && (await text(page, T('lab-cmp-lift-pinned'))) === `${coreProbe(pinnedFrom.code, pinnedFrom.speed, pinnedFrom.alpha).liftG} g`);
  await tap(page, T('lab-paper-newsprint'));
  await sleep(500);
  r = await read(page);
  const thin = coreProbe(data.dartThin, r.speed, r.alpha);
  expect('견주기: 다른 종이로 보면 같은 모양을 그 종이로 다시 계산한다', r.code === data.dartThin && near(r.liftN, thin.liftN) && near(r.weightN, thin.weightN) && /잠깐 바꿔 봄/.test(await text(page, T('lab-paper'))), `${r.code === data.dartThin} ${r.weightN} / ${thin.weightN}`);
  expect('견주기: 붙여 둔 값은 그대로 남아 있고, 지금 값은 새 종이의 것이다', (await text(page, T('lab-cmp-lift-pinned'))) === `${coreProbe(pinnedFrom.code, pinnedFrom.speed, pinnedFrom.alpha).liftG} g` && (await text(page, T('lab-cmp-lift-now'))) === `${thin.liftG} g`);
  const flexPinned = await text(page, T('lab-cmp-flex-pinned')), flexNow = await text(page, T('lab-cmp-flex-now'));
  expect('견주기: 얇은 종이는 더 휜다(또는 꺾인다)', thin.buckled ? flexNow === '꺾임' : parseFloat(flexNow) > parseFloat(flexPinned), `${flexPinned} -> ${flexNow}`);
  // 아이가 실제로 보는 것: 처음 고개 각도쯤에서는 얇은 종이가 접히지 않고 크게 휘어 펄럭인다. 화면의 말과 core 의 값이 같아야 한다.
  const thinFlex = Math.max(Math.abs(thin.flexLeftDeg), Math.abs(thin.flexRightDeg));
  expect('견주기: 화면의 한마디가 얇은 종이에 실제로 일어난 일과 같다(꺾였으면 꺾였다고, 크게 휘었으면 펄럭인다고)', r.buckled === thin.buckled && (thin.buckled ? /꺾였어요/.test(r.caption) : thinFlex >= 15 ? /펄럭거려요/.test(r.caption) && r.caption.includes(`${thinFlex.toFixed(1)}도`) : true), `${r.caption} (core: 휨 ${thinFlex.toFixed(1)}도, 꺾임 ${thin.buckled})`);
  const stiffRead = coreProbe(pinnedFrom.code, pinnedFrom.speed, pinnedFrom.alpha);
  expect('견주기: 얇은 종이는 같은 바람에서 막는 힘이 커지고 뜨는 힘이 준다(물리 2판)', thin.dragN > stiffRead.dragN * 1.3 && thin.liftN < stiffRead.liftN, `막는 힘 ${stiffRead.dragG} -> ${thin.dragG} g, 뜨는 힘 ${stiffRead.liftG} -> ${thin.liftG} g`);
  expect('견주기: 넣어 둔 비행기는 바뀌지 않는다', (await live(page)).planes.find((p) => p.name === dart.name).code === dart.code);
  await freeze(page);
  await shot(page, '09-compare');
  await audit(page, '견주기');
  await tap(page, T('lab-tab-cards'));
  lesson = (await exists(page, T('lab-card-lesson'))) ? await text(page, T('lab-card-lesson')) : '';
  expect('카드 4 "종이 바꿔 보기": 센 바람에서 두 종이를 견주면 도장이 찍힌다', (await attr(page, T('lab-card-paper'), 'data-done')) === '1' && /그래서 세게 던질 때는|그래서 이 모양은/.test(lesson), lesson);
  // 카드의 약속과 마친 뒤의 한마디가 실제로 본 것과 같다: 꺾이지 않았으면 "휘고 펄럭여서 막는 힘이 커지고 뜨는 힘이 줄었다"를 core 의 숫자로 말한다.
  expect('카드 4: 할 일은 얇은 종이가 휘고 펄럭인다는 것을 미리 알려 준다(접힌다고 약속하지 않는다)', /휘고 펄럭여요/.test(await text(page, T('lab-card-body'))) && !/꺾/.test(goalOnly(await text(page, T('lab-card-body')), lesson)));
  expect('카드 4: 마친 뒤의 한마디가 core 의 값과 같다', thin.buckled || stiffRead.buckled
    ? /꺾였어요/.test(lesson)
    : /펄럭여서/.test(lesson) && lesson.includes(`막는 힘이 ${stiffRead.dragG} g에서 ${thin.dragG} g으로 커지고`) && lesson.includes(`뜨는 힘은 ${stiffRead.liftG} g에서 ${thin.liftG} g으로 줄었어요`) && !/꺾였어요/.test(lesson), lesson);
  // 고개를 더 들면 얇은 종이는 정말로 꺾인다: 꺾임 표시(말, 표, 그림)가 그때 나온다.
  await setLab(page, { speed: data.strong, alpha: 10 });
  await sleep(300);
  r = await read(page);
  const thinUp = coreProbe(data.dartThin, r.speed, r.alpha);
  expect('얇은 종이: 센 바람에서 고개를 10도로 들면 core 가 꺾였다고 하고, 화면도 꺾였다고 알려 준다', thinUp.buckled === true && r.buckled === true && /날개가 꺾였어요/.test(r.caption), `${r.caption} (core 꺾임 ${thinUp.buckled})`);
  await tap(page, T('lab-tab-compare'));
  expect('얇은 종이: 견주기 표에도 "꺾임"이라고 적힌다', (await text(page, T('lab-cmp-flex-now'))) === '꺾임', await text(page, T('lab-cmp-flex-now')));
  await freeze(page);
  await shot(page, '05b-thin-paper-buckled');
  await tap(page, T('lab-tab-cards'));
  await setLab(page, { speed: data.limits.speedMax, alpha: 8 });
  await sameAsCore(page, '얇은 종이, 가장 센 바람');
  await freeze(page);
  await shot(page, '05-thin-paper-bend');
  const done = await page.evaluate(() => JSON.parse(window.localStorage.getItem('pp.lab.v1') ?? 'null'));
  expect('카드: 마친 실험 넷이 이 브라우저에 적힌다', done && ['lift', 'best', 'stall', 'paper'].every((k) => typeof done.done[k] === 'number'), JSON.stringify(done?.done ?? null));
  // 다른 비행기로 보기
  await tap(page, T('lab-tab-compare'));
  await tap(page, T('lab-plane-0'));
  await sleep(500);
  r = await read(page);
  expect('견주기: 다른 비행기로 바꿔 볼 수 있다', r.code === data.seeds[1].code && (await text(page, T('lab-plane-name'))) === data.seeds[1].name, await text(page, T('lab-plane-name')));
  await sameAsCore(page, '다른 비행기');
  await tap(page, T('lab-variant-reset'));
  await sleep(400);
  expect('견주기: 원래 비행기로 돌아온다', (await read(page)).code === dart.code);
  await tap(page, T('lab-unpin'));

  // ---- 쪽지: 연구 노트에 적기 ----
  await tap(page, T('lab-tab-note'));
  await tap(page, T('lab-note-write'));
  await page.waitForSelector(T('lab-note-saved'), { timeout: 30000 });
  await sleep(300);
  const note = scan.note;
  const savedAttr = await page.$eval(T('lab-note-saved'), (el) => ({ fav: el.getAttribute('data-fav'), trim: el.getAttribute('data-trim'), best: el.getAttribute('data-best'), stall: el.getAttribute('data-stall') }));
  expect('쪽지: 적힌 값이 core 로 따로 잰 값과 같다', Number(savedAttr.fav) === note.favSpeedMps && Number(savedAttr.trim) === note.trimAlphaDeg && Number(savedAttr.best) === note.bestAlphaDeg && Number(savedAttr.stall) === note.stallAlphaDeg, `${JSON.stringify(savedAttr)} / ${JSON.stringify(note)}`);
  const inHangar = (await live(page)).planes.find((p) => p.name === dart.name);
  expect('쪽지: 격납고의 그 비행기에 붙어 저장된다', inHangar.lab && inHangar.lab.v === 1 && inHangar.lab.physics === data.physics && inHangar.lab.favSpeedMps === note.favSpeedMps);
  const st = await page.evaluate(() => JSON.parse(window.localStorage.getItem('pp.hangar.v1')));
  expect('쪽지: 저장소에도 적혀 있다', st.planes.some((p) => p.lab && p.lab.favSpeedMps === note.favSpeedMps));
  await shot(page, '10-note');
  await audit(page, '쪽지');
  closeOut('격납고에서 연 실험실', log);

  // ---- 돌아가기: 격납고 판과 연구 노트에 쪽지가 보인다 ----
  await tap(page, T('lab-close'));
  expect('돌아가기: 실험실이 닫히고 격납고가 그대로 있다', !(await exists(page, T('lab'))) && (await text(page, T('place'))) === '격납고' && (await exists(page, T('hangar-panel'))));
  expect('격납고 판: 바람 쪽지가 한 줄로 보인다', /바람 쪽지/.test(await text(page, T('panel-lab-note'))) && (await text(page, T('panel-lab-note'))).includes(note.favSpeedMps.toFixed(1)));
  await shot(page, '12-hangar-panel-note');
  await tap(page, T('panel-notebook'));
  await page.waitForSelector(T('notebook'), { timeout: 8000 });
  const nb = await text(page, T('table-lab'));
  expect('연구 노트: 쪽지가 제 이름(받음각, 양력, 항력, 실속)과 풀이와 함께 실린다', ['받음각', '양력', '항력', '실속'].every((w) => nb.includes(w)) && nb.includes(note.favSpeedMps.toFixed(1)) && (await text(page, T('nb-lab-trim'))).includes(note.trimAlphaDeg.toFixed(1)), nb.slice(0, 80));
  await page.$eval(T('table-lab'), (el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await sleep(200);
  await shot(page, '13-notebook-lab');
  await tap(page, T('nb-open-lab'));
  await page.waitForSelector(T('lab'), { timeout: 8000 });
  expect('연구 노트: "바람 실험실에 넣어 보기"로 다시 들어갈 수 있다', (await attr(page, T('lab'), 'data-code')) === dart.code && !(await exists(page, T('notebook'))));
  await tap(page, T('lab-close'));
  // 새로 고쳐도 쪽지와 도장이 남아 있다
  await open(page);
  await goHangar(page);
  await openLabFromHangar(page, dart.name);
  expect('새로 고침: 도장과 쪽지가 남아 있다', (await attr(page, T('lab-card-lift'), 'data-done')) === '1' && (await attr(page, T('lab-card-paper'), 'data-done')) === '1');
  await tap(page, T('lab-tab-note'));
  expect('새로 고침: 쪽지가 그대로 보인다', await exists(page, T('lab-note-saved')));
  await page.browserContext().close();
}

// ---------------------------------------------------------------------------
// 2) 책상에서 열기(지금 접은 비행기)
// ---------------------------------------------------------------------------
async function deskFlow(browser, data) {
  const log = newLog();
  const page = await newPage(browser, log);
  await open(page);
  await tap(page, T('go-desk'));
  await tap(page, T('desk-tab-fold'));
  if ((await attr(page, T('mode-guide'), 'aria-selected')) !== 'true') await tap(page, T('mode-guide'));
  if (await exists(page, T('guide-other'))) await tap(page, T('guide-other'));
  expect('책상: 아직 접지 않았으면 실험실 단추가 없다', !(await exists(page, T('open-lab'))));
  await tap(page, T('fold-dart'));
  await tap(page, T('guide-instant'));
  await page.waitForSelector(T('guide-done'), { timeout: 15000 });
  await sleep(400);
  expect('책상: 다 접으면 "바람 실험실에 넣어 보기" 단추가 나온다', /바람 실험실에 넣어 보기/.test(await text(page, T('open-lab'))));
  await shot(page, '14-desk-entry');
  await tap(page, T('open-lab'));
  await page.waitForSelector(T('lab'), { timeout: 8000 });
  await sleep(900);
  const dart = data.seeds[0];
  expect('책상에서 열기: 지금 접은 비행기가 올라온다', (await attr(page, T('lab'), 'data-code')) === dart.code && (await attr(page, T('lab'), 'data-from')) === 'desk' && /책상으로/.test(await text(page, T('lab-close'))));
  await setLab(page, { speed: 7, alpha: 6 });
  await sameAsCore(page, '책상에서 연 실험실');
  await audit(page, '책상에서 연 실험실');
  // 격납고에 넣지 않은 비행기의 쪽지는 이 브라우저에 적어 두고 연구 노트에서 보여 준다
  await tap(page, T('lab-tab-note'));
  await tap(page, T('lab-note-write'));
  await page.waitForSelector(T('lab-note-saved'), { timeout: 30000 });
  await tap(page, T('lab-close'));
  expect('책상으로 돌아온다', !(await exists(page, T('lab'))) && (await text(page, T('place'))) === '책상');
  await tap(page, T('open-notebook'));
  await page.waitForSelector(T('notebook'), { timeout: 8000 });
  expect('연구 노트(책상): 방금 적은 쪽지가 보이고 실험실로 가는 단추가 있다', (await exists(page, T('table-lab'))) && /바람 실험실에 넣어 보기/.test(await text(page, T('nb-open-lab'))));
  await tap(page, T('nb-open-lab'));
  await page.waitForSelector(T('lab'), { timeout: 8000 });
  expect('연구 노트에서 열기: 연구 노트가 닫히고 실험실이 열린다', !(await exists(page, T('notebook'))) && (await attr(page, T('lab'), 'data-from')) === 'desk');
  // 소리 끔 단추
  const s0 = await attr(page, T('lab-sound'), 'aria-checked');
  await tap(page, T('lab-sound'));
  expect('소리: 실험실에서도 켜고 끌 수 있다', (await attr(page, T('lab-sound'), 'aria-checked')) !== s0);
  await page.keyboard.press('Escape');
  await sleep(200);
  expect('Esc 로 실험실에서 나간다', !(await exists(page, T('lab'))));
  closeOut('책상에서 연 실험실', log);
  await page.browserContext().close();
}

// ---------------------------------------------------------------------------
// 3) 뒤가 무거운 비행기: 균형을 못 잡고 뒤집힌다
// ---------------------------------------------------------------------------
async function tumbleFlow(browser, data) {
  const log = newLog();
  const page = await newPage(browser, log, { dpr: 2 });
  await open(page);
  await seed(page, data.seeds);
  await goHangar(page);
  const tail = data.seeds[3];
  const scan = coreScan(tail.code, 6);
  expect('뒤가 무거운 비행기: core 는 안정한 균형이 없다고 한다', scan.trim.stable === false && scan.outcome.kind === 'tumble', JSON.stringify(scan.trim));
  await openLabFromHangar(page, tail.name);
  await setLab(page, { speed: 6, alpha: 4 });
  await sameAsCore(page, '뒤가 무거운 비행기');
  await tap(page, T('lab-balance'));
  await sleep(1100);
  await freeze(page);
  await shot(page, '07a-balance-tumbling');
  await sleep(2600);
  const r = await read(page);
  expect('균형: 뒤가 무거운 비행기는 뒤집힌다', r.tumbled && r.headline === '뒤집혔어요' && /뒤집혔어요/.test(r.caption) && r.liftText.includes('–'), `${r.headline} / ${r.caption}`);
  expect('균형: 왜 뒤집히는지 아이 말로 알려 준다', /뒤가 무거워서/.test(await text(page, T('lab-balance-box'))) && (await attr(page, T('lab-balance-box'), 'data-kind')) === 'tumble');
  await page.waitForFunction(() => (document.querySelector('[data-testid="lab-fav"]')?.getAttribute('data-why') ?? 'busy') !== 'busy', { timeout: 30000 }).catch(() => {});
  expect('균형: 균형을 못 잡으면 좋아하는 바람도 없다고 알려 준다', (await attr(page, T('lab-fav'), 'data-why')) === scan.favourite.why && scan.favourite.speedMps === null, `${await attr(page, T('lab-fav'), 'data-why')} / ${scan.favourite.why}`);
  await freeze(page);
  await shot(page, '07-balance-tumbled');
  await audit(page, '뒤집힘');
  // 바람이 없으면 가만히 있다
  await tap(page, T('lab-balance'));
  await setLab(page, { speed: 0, alpha: 4 });
  await tap(page, T('lab-balance'));
  await sleep(400);
  expect('균형: 바람이 없으면 가만히 있는다고 알려 준다', (await attr(page, T('lab-balance-box'), 'data-kind')) === 'calm' && !(await read(page)).tumbled);
  // 비행기를 잡으면 균형 모드가 꺼진다
  const pv = await pivot(page);
  await touchDrag(page, { x: pv.x - 60, y: pv.y }, { x: pv.x - 60, y: pv.y - 20 });
  expect('균형: 비행기를 손으로 잡으면 균형 모드가 꺼진다', (await attr(page, T('lab-balance'), 'aria-checked')) === 'false');
  closeOut('뒤집힘', log);
  await page.browserContext().close();
}

// ---------------------------------------------------------------------------
// 4) WebGL 이 막혔을 때: 2D 그림
// ---------------------------------------------------------------------------
async function noGlFlow(browser, data) {
  const log = newLog();
  const noWebGL = () => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(type, ...rest) { return /webgl/i.test(String(type)) ? null : orig.call(this, type, ...rest); };
  };
  const page = await newPage(browser, log, { dpr: 2, inits: [noWebGL] });
  await open(page);
  await seed(page, data.seeds);
  await goHangar(page);
  await openLabFromHangar(page, data.seeds[0].name);
  expect('WebGL 막힘: 2D 그림으로 바뀌고 까닭을 알려 준다', (await attr(page, T('lab'), 'data-view')) === 'flat' && (await exists(page, T('lab-flat'))) && /그림으로/.test(await text(page, T('lab-flat-note'))));
  await setLab(page, { speed: 7, alpha: 10 });
  await sameAsCore(page, '2D 그림');
  const svg = await page.$eval(T('lab-flat'), (el) => ({ lines: el.querySelectorAll('.labflat__line').length, arrows: el.querySelectorAll('.labflat__arrow').length, label: el.textContent }));
  expect('2D 그림: 연기 줄과 힘 화살표, 그램 값이 그려진다', svg.lines >= 9 && svg.arrows >= 3 && /뜨는 힘/.test(svg.label) && /막는 힘/.test(svg.label) && /무게/.test(svg.label), JSON.stringify({ lines: svg.lines, arrows: svg.arrows }));
  await sleep(300);
  await shot(page, '15-flat-fallback');
  const before = await scrollState(page);
  const pv = await pivot(page);
  const a0 = (await read(page)).alpha;
  await touchDrag(page, { x: pv.x - 70, y: pv.y }, { x: pv.x - 64, y: pv.y - 36 });
  const r = await read(page);
  const after = await scrollState(page);
  expect('2D 그림: 비행기를 끌어 고개를 바꿀 수 있고 쪽이 밀리지 않는다', r.alpha > a0 + 8 && before.y === after.y && before.doc === after.doc, `${a0} -> ${r.alpha}`);
  await sameAsCore(page, '2D 그림에서 끌기');
  const scan = coreScan(data.seeds[0].code, 6);
  await setLab(page, { speed: 6, alpha: scan.stallAlphaDeg + 8 });
  expect('2D 그림: 실속 설명이 나오고 연기 줄이 흐트러진다', /떨어져 나갔어요/.test((await read(page)).caption) && (await page.$$('.labflat__line.is-rough')).length > 0);
  await shot(page, '16-flat-stalled');
  await tap(page, T('lab-balance'));
  await page.waitForFunction(() => document.querySelector('[data-testid="lab-read"]').getAttribute('data-settled') === '1', { timeout: 12000 }).catch(() => {});
  expect('2D 그림: 균형 잡기도 된다', Math.abs((await read(page)).alpha - scan.trim.alphaDeg) < 0.006);
  await audit(page, '2D 그림');
  // 체육관(대회장) 장면이 WebGL 을 만들어 보다가 three.js 가 찍는 한 줄은 실험실과 상관없다(격납고 검사와 같은 기준). 실험실은 조용히 넘어가야 한다.
  const glErr = log.consoleErrors.filter((e) => /Error creating WebGL context/.test(e));
  expect('WebGL 막힘: 실험실은 콘솔 오류 없이 넘어간다(체육관 장면의 한 줄만 남는다)', glErr.length <= 1, `${glErr.length}줄`);
  log.consoleErrors = log.consoleErrors.filter((e) => !/Error creating WebGL context/.test(e));
  closeOut('2D 그림', log);
  await page.browserContext().close();
}

// ---------------------------------------------------------------------------
// 5) 저장소가 막혔을 때
// ---------------------------------------------------------------------------
async function blockedFlow(browser, data) {
  const log = newLog();
  const block = () => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } });
  };
  const page = await newPage(browser, log, { inits: [block] });
  await open(page);
  await seed(page, data.seeds.slice(0, 2));
  await goHangar(page);
  await openLabFromHangar(page, data.seeds[0].name);
  await setLab(page, { speed: 6, alpha: 5 });
  await sameAsCore(page, '저장소 막힘');
  await setLab(page, { speed: 0 });
  await tap(page, T('lab-card-lift'));
  for (let i = 0; i < 28 && (await attr(page, T('lab-card-lift'), 'data-done')) !== '1'; i++) await tap(page, T('lab-wind-up'));
  expect('저장소 막힘: 실험 카드는 이번 방문 동안 그대로 된다', (await attr(page, T('lab-card-lift'), 'data-done')) === '1');
  await tap(page, T('lab-tab-note'));
  await tap(page, T('lab-note-write'));
  await page.waitForSelector(T('lab-note-saved'), { timeout: 30000 });
  expect('저장소 막힘: 쪽지도 이번 방문 동안 비행기에 붙는다', Boolean((await live(page)).planes[0].lab));
  await tap(page, T('lab-close'));
  expect('저장소 막힘: 격납고 판에 쪽지가 보인다', await exists(page, T('panel-lab-note')));
  closeOut('저장소 막힘', log);
  await page.browserContext().close();
}

// ---------------------------------------------------------------------------
// 6) 물리 판이 바뀌었을 때: 저장된 기록을 한 번 다시 잰다
// ---------------------------------------------------------------------------
async function migrateFlow(browser, data) {
  const log = newLog();
  const page = await newPage(browser, log);
  // 옛 판에서 적어 둔 것처럼: 일부러 틀린 숫자의 기록과 격납고 최고 기록, 옛 판 번호
  const old = (seedData) => {
    if (window.localStorage.getItem('pp.test.seeded')) return;
    window.localStorage.setItem('pp.test.seeded', '1');
    const rec = { code: seedData.throwCode, mode: 'distance', distanceM: 99.5, airtimeS: 33.3, verdict: 'glide', at: 1 };
    window.localStorage.setItem('pp.records.v1', JSON.stringify({ bestDistance: rec, bestAirtime: rec, recent: [rec, { ...rec, code: 'not-a-code', at: 2 }, { ...rec, code: seedData.oldThrowCode, distanceM: 41.5, at: 3 }] }));
    window.localStorage.setItem('pp.hangar.v1', JSON.stringify({ v: 1, planes: [
      { id: 'h1', name: '옛 기록', code: seedData.code, paperId: 'copy80', origin: 'preset:dart', createdAt: 1, updatedAt: 1, flights: 3, favourite: false, best: { distance: { value: 88.8, at: 1, throwCode: seedData.throwCode }, airtime: { value: 22.2, at: 1 } },
        // 옛 판에서 적어 둔 바람 쪽지(숫자는 옛 규칙의 것)
        lab: { v: 1, physics: 1, at: 1, favSpeedMps: 9.9, trimAlphaDeg: 3.3, bestAlphaDeg: 7, bestLiftToDrag: 6.6, stallAlphaDeg: 22, buckleSpeedMps: null } },
      // 던지기 한도가 16 m/s 이던 때 14 m/s 로 낸 최고 기록: 지금은 던질 수 없는 힘이라 기록만 지워지고 비행기는 남는다
      { id: 'h2', name: '센 던지기', code: seedData.code2, paperId: 'craft120', origin: 'preset:glider', createdAt: 2, updatedAt: 2, flights: 5, favourite: false, best: { distance: { value: 41.5, at: 2, throwCode: seedData.oldThrowCode }, airtime: { value: 6.1, at: 2, throwCode: seedData.oldThrowCode } } },
    ] }));
    window.localStorage.setItem('pp.physics.v1', '1');
  };
  await page.evaluateOnNewDocument(old, { throwCode: data.throwCode, code: data.seeds[0].code, code2: data.seeds[1].code, oldThrowCode: data.oldThrowCode });
  await open(page);
  await page.waitForFunction((v) => window.localStorage.getItem('pp.physics.v1') === String(v), { timeout: 20000 }, data.physics).catch(() => {});
  await sleep(400);
  const after = await page.evaluate(() => ({ physics: window.localStorage.getItem('pp.physics.v1'), records: JSON.parse(window.localStorage.getItem('pp.records.v1')), hangar: JSON.parse(window.localStorage.getItem('pp.hangar.v1')) }));
  const truth = JSON.parse(spawnSync('npx', ['tsx', 'scripts/e2e-core.ts', data.throwCode], { cwd: ROOT, encoding: 'utf8' }).stdout);
  expect('다시 재기: 새 판 번호가 적힌다', after.physics === String(data.physics), after.physics);
  expect('다시 재기: 내 기록이 지금 core 값으로 바뀐다', after.records.bestDistance.distanceM.toFixed(2) === truth.distance && after.records.bestAirtime.airtimeS.toFixed(2) === truth.airtime, `${after.records.bestDistance.distanceM} / core ${truth.distance}`);
  expect('다시 재기: 코드를 읽을 수 없는 최근 비행과, 지금은 던질 수 없는 센 던지기의 비행은 지운다', after.records.recent.length === 1 && after.records.recent[0].code === data.throwCode, JSON.stringify(after.records.recent.map((x) => x.distanceM)));
  const pl = after.hangar.planes[0];
  expect('다시 재기: 격납고 최고 기록도 그때 던진 코드로 다시 잰다(비행기는 그대로)', after.hangar.planes.length === 2 && pl.name === '옛 기록' && pl.flights === 3 && pl.best.distance.value.toFixed(2) === truth.distance && pl.best.airtime.value.toFixed(2) === truth.airtime, JSON.stringify(pl.best));
  const pl2 = after.hangar.planes[1];
  expect('다시 재기: 센 던지기로 낸 최고 기록은 지우고 비행기는 남긴다', pl2 && pl2.name === '센 던지기' && pl2.code === data.seeds[1].code && pl2.flights === 5 && pl2.best.distance === undefined && pl2.best.airtime === undefined && !JSON.stringify(after.hangar).includes(data.oldThrowCode), JSON.stringify(pl2?.best));
  const toast = (await exists(page, T('toast'))) ? await text(page, T('toast')) : '';
  expect('다시 재기: 아이에게 한 번 알려 준다', toast === '대회 규칙이 더 진짜처럼 바뀌어서 기록을 다시 쟀어요.', toast);
  await shot(page, '17-migration-notice');
  // 화면이 들고 있는 값도 새 값이다
  await goHangar(page);
  await pick(page, '옛 기록');
  expect('다시 재기: 격납고 판에도 새 값이 보인다', (await text(page, T('panel-best-distance'))).includes(truth.distance), await text(page, T('panel-best-distance')));
  expect('다시 재기: 옛 판에서 적은 바람 쪽지는 "규칙이 바뀌기 전에 쟀다"고 표시한다', /규칙이 바뀌기 전에 쟀어요/.test(await text(page, T('panel-lab-note'))), await text(page, T('panel-lab-note')).catch(() => '쪽지 없음'));
  await shot(page, '17b-migration-stale-note');
  await pick(page, '센 던지기');
  expect('다시 재기: 센 던지기 비행기는 격납고에 그대로 있고 기록은 비어 있다', !(await text(page, T('panel-best-distance'))).includes('41.5'), await text(page, T('panel-best-distance')));
  // 다시 열면 또 하지 않는다
  await open(page);
  await sleep(2200);
  expect('다시 재기: 한 번만 한다(다시 열어도 알림이 없고 값이 그대로다)', !(await exists(page, T('toast'))) && (await page.evaluate(() => JSON.parse(window.localStorage.getItem('pp.records.v1')).bestDistance.distanceM)).toFixed(2) === truth.distance);
  closeOut('기록 다시 재기', log);
  await page.browserContext().close();
}

// ---------------------------------------------------------------------------
// 7) 넓은 화면
// ---------------------------------------------------------------------------
async function desktopFlow(browser, data) {
  const log = newLog();
  const page = await newPage(browser, log, { mobile: false, inits: [forceMedium] });
  await open(page);
  await seed(page, data.seeds);
  await goHangar(page);
  await openLabFromHangar(page, data.seeds[1].name);
  const lay = await page.evaluate(() => {
    const s = document.querySelector('.lab__scene').getBoundingClientRect(), p = document.querySelector('.lab__panel').getBoundingClientRect();
    return { sceneW: s.width, sceneH: s.height, panelLeft: p.left, sceneRight: s.right };
  });
  expect('넓은 화면: 장면이 크고 조작판이 오른쪽에 선다', lay.sceneW > 760 && lay.sceneH > 600 && lay.panelLeft >= lay.sceneRight - 1, JSON.stringify(lay));
  await setLab(page, { speed: 8, alpha: 12 });
  await sameAsCore(page, '넓은 화면');
  const pv = await pivot(page);
  const a0 = (await read(page)).alpha;
  await touchDrag(page, { x: pv.x - 120, y: pv.y }, { x: pv.x - 110, y: pv.y - 50 });
  expect('넓은 화면: 마우스로 비행기를 끌어 고개를 든다', (await read(page)).alpha > a0 + 5, `${a0} -> ${(await read(page)).alpha}`);
  await setLab(page, { speed: 9, alpha: 14 });
  await tap(page, T('lab-tab-compare'));
  await tap(page, T('lab-pin'));
  await setLab(page, { alpha: 6 });
  await freeze(page);
  await shot(page, 'd-01-desktop');
  await audit(page, '넓은 화면');
  await tap(page, T('lab-balance'));
  await page.waitForFunction(() => document.querySelector('[data-testid="lab-read"]').getAttribute('data-settled') === '1', { timeout: 12000 }).catch(() => {});
  const scan = coreScan(data.seeds[1].code, 9);
  expect('넓은 화면: 균형 잡기가 core 각도에서 멈춘다', Math.abs((await read(page)).alpha - scan.trim.alphaDeg) < 0.006, `${(await read(page)).alpha} / ${scan.trim.alphaDeg}`);
  await freeze(page);
  await shot(page, 'd-02-desktop-balance');
  closeOut('넓은 화면', log);
  await page.browserContext().close();
}

// ---------------------------------------------------------------------------
// 8) 빠르기: 화질 단계마다 연기 양과 그리기 수, 낮음 단계의 한 장 시간
// ---------------------------------------------------------------------------
async function perfFlow(browser, data) {
  const out = {};
  for (const tier of ['low', 'medium', 'high']) {
    const log = newLog();
    const init = [`() => { try { window.localStorage.setItem('pp-3d-tier', '${tier}'); } catch {} }`];
    const page = await newPage(browser, log, { inits: [] });
    await page.evaluateOnNewDocument((t) => { try { window.localStorage.setItem('pp-3d-tier', t); } catch { /* 없음 */ } }, tier);
    void init;
    await open(page);
    await seed(page, data.seeds);
    await goHangar(page);
    await openLabFromHangar(page, data.seeds[0].name);
    await setLab(page, { speed: 8, alpha: 30 });
    await sleep(3500);
    const info = await page.evaluate(() => window.__ppLab.debug.info());
    out[tier] = { calls: info.calls, triangles: info.triangles, lines: info.lines, segments: info.segments, puffs: info.puffs, frameMs: Number(info.frameMs.toFixed(2)), intervalMs: Number(info.intervalMs.toFixed(1)), fpsCap: info.fpsCap, pixelRatio: info.pixelRatio };
    expect(`빠르기(${tier}): 바람이 부는 동안 이어서 그리고, 그리기 수가 적다`, info.animating && info.calls > 0 && info.calls < 60 && info.tier === tier, JSON.stringify(out[tier]));
    if (tier === 'low') {
      // 바람을 끄면 그리기를 멈춘다
      await setLab(page, { speed: 0 });
      await sleep(2500);
      const f1 = (await page.evaluate(() => window.__ppLab.debug.info())).frames;
      await sleep(900);
      const idle = await page.evaluate(() => window.__ppLab.debug.info());
      expect('빠르기: 바람이 꺼지면 그리기를 멈춘다', idle.frames === f1 && !idle.animating, `${f1} -> ${idle.frames}`);
      // probeTunnel 은 조절값이 바뀔 때만 부른다(화면이 가만히 있으면 0번)
    }
    closeOut(`빠르기 ${tier}`, log);
    await page.browserContext().close();
  }
  writeFileSync(join(SHOTS, 'perf.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out));
}

// ---------------------------------------------------------------------------
// 9) 보여 줄 그림 모음(검사는 거의 없다: 정해 둔 장면을 같은 모습으로 찍는다)
// ---------------------------------------------------------------------------
async function galleryFlow(browser, data) {
  const log = newLog();
  const page = await newPage(browser, log, { dpr: 2, inits: [forceMedium] });
  await open(page);
  await seed(page, data.seeds);
  await goHangar(page);
  const dart = data.seeds[0];
  await openLabFromHangar(page, dart.name);
  const scan = coreScan(dart.code, 6);
  const snap = async (name, v, t = 3.2) => { await setLab(page, v); await sleep(250); await freeze(page, t); await shot(page, name); };
  await snap('g-01-idle', { speed: 0, alpha: 5 });
  await snap('g-02-gentle-attached', { speed: 3.5, alpha: 4 });
  await snap('g-03-strong-lift', { speed: 9, alpha: 16 });
  await snap('g-04-stalled', { speed: 7, alpha: Math.min(data.limits.alphaMax, scan.stallAlphaDeg + 10) }, 4.1);
  // 얇은 종이: 견주기에서 신문지로 바꾼다
  await setLab(page, { speed: data.strong, alpha: 7 });
  await tap(page, T('lab-tab-compare'));
  await tap(page, T('lab-pin'));
  await tap(page, T('lab-paper-newsprint'));
  await sleep(600);
  await page.$eval('.lab__panel', (el) => { el.scrollTop = 0; });
  // 꺾이기 전: 얇은 종이의 날개가 바람에 휜 모습
  await setLab(page, { speed: 4.5, alpha: 9 });
  await freeze(page);
  await shot(page, 'g-05a-thin-paper-bent');
  await setLab(page, { speed: data.strong, alpha: 7 });
  await freeze(page);
  await shot(page, 'g-05-thin-paper-bend');
  await page.$eval(T('lab-compare-table'), (el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await freeze(page);
  await shot(page, 'g-09-compare');
  await tap(page, T('lab-variant-reset'));
  await tap(page, T('lab-unpin'));
  await tap(page, T('lab-tab-cards'));
  await page.$eval('.lab__panel', (el) => { el.scrollTop = 0; });
  // 균형 잡기
  await setLab(page, { speed: scan.favourite.speedMps ?? 7, alpha: 20 });
  await tap(page, T('lab-balance'));
  await page.waitForFunction(() => document.querySelector('[data-testid="lab-read"]').getAttribute('data-settled') === '1', { timeout: 12000 }).catch(() => {});
  await page.waitForFunction(() => (document.querySelector('[data-testid="lab-fav"]')?.getAttribute('data-why') ?? 'busy') !== 'busy', { timeout: 20000 }).catch(() => {});
  await page.$eval('.lab__panel', (el) => { el.scrollTop = 0; });
  await freeze(page);
  await shot(page, 'g-06-balance-settled');
  await tap(page, T('lab-balance'));
  // 실험 카드
  await setLab(page, { speed: 0, alpha: 5 });
  await tap(page, T('lab-card-lift'));
  for (let i = 0; i < 28 && (await attr(page, T('lab-card-lift'), 'data-done')) !== '1'; i++) await tap(page, T('lab-wind-up'));
  await sleep(500);
  await page.$eval(T('lab-card-body'), (el) => el.scrollIntoView({ block: 'end', behavior: 'instant' }));
  await freeze(page);
  await shot(page, 'g-08-card-done');
  await tap(page, T('lab-close'));
  // 뒤집힘
  await tap(page, T('panel-close'));
  await openLabFromHangar(page, data.seeds[3].name);
  await setLab(page, { speed: 6, alpha: 4 });
  await tap(page, T('lab-balance'));
  await sleep(1150);
  await shot(page, 'g-07a-balance-tumbling');
  await sleep(2400);
  await freeze(page);
  await shot(page, 'g-07-balance-tumbled');
  closeOut('그림 모음', log);
  await page.browserContext().close();
}

async function run() {
  const data = tsx([]);
  const preview = await startPreview();
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const flows = { main: mainFlow, desk: deskFlow, tumble: tumbleFlow, nogl: noGlFlow, blocked: blockedFlow, migrate: migrateFlow, desktop: desktopFlow, perf: perfFlow, gallery: galleryFlow };
  try {
    for (const [name, fn] of Object.entries(flows)) {
      if (ONLY && ONLY !== name) continue;
      console.log(`\n== ${name} ==`);
      try {
        await fn(browser, data);
      } catch (err) {
        expect(`[${name}] 흐름이 끝까지 간다`, false, String(err?.message ?? err).split('\n')[0]);
        const pages = await browser.pages();
        const last = pages[pages.length - 1];
        if (last) await last.screenshot({ path: join(SHOTS, `zz-stuck-${name}.png`) }).catch(() => {});
      }
    }
  } finally {
    await browser.close();
    stop(preview);
  }
}

run().then(
  () => {
    console.log(`\n검사 ${checks}개 중 실패 ${failures.length}개`);
    writeFileSync(join(SHOTS, 'e2e-failures.txt'), failures.join('\n'));
    if (failures.length > 0) {
      for (const f of failures) console.log(` - ${f}`);
      process.exit(1);
    }
  },
  (err) => {
    console.error('검사 도중 멈췄어요:', err);
    process.exit(1);
  },
);
