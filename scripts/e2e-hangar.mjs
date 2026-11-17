/**
 * 격납고 흐름 검사 (headless Chrome).
 * 저장(책상, 결과 화면), 이름 대화상자, 이미 넣은 상태, 고쳐서 바꾸기, 격납고 0 / 1 / 7 / 24대,
 * 고르기, 이름 바꾸기, 즐겨찾기, 차례, 꺼내서 날리기, 고쳐 접기, 버리기와 되돌리기, 꽉 찼을 때,
 * 저장소가 막혔을 때, 망가진 저장 값, WebGL 이 막혔을 때를 휴대전화(360 x 740, 손가락)와 넓은 화면(1280 x 800)에서 본다.
 *
 * 준비: npx vite build --outDir dist-hangar
 * 실행: node scripts/e2e-hangar.mjs          (4177 번에 미리보기 서버가 없으면 스스로 띄운다)
 *       node scripts/e2e-hangar.mjs --only=seeds   한 묶음만 (main, seeds, blocked, corrupt, nogl, desktop)
 * 화면 갈무리는 screenshots/v6-hangar/ 에 저장한다. 하나라도 실패하면 0 이 아닌 값으로 끝난다.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(ROOT, 'screenshots', 'v6-hangar');
const PORT = 4177;
const OUT_DIR = 'dist-hangar';
const BASE = `http://127.0.0.1:${PORT}/`;
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7);
mkdirSync(SHOTS, { recursive: true });

/** 본 흐름에 나오면 안 되는 딱딱한 말 */
const FORBIDDEN = ['분석', '시뮬레이션', '파라미터', '프리셋', '로컬 스토리지', 'localStorage', '썸네일', '삭제', '오류'];

const failures = [];
let checks = 0;
function expect(name, ok, detail = '') {
  checks++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = (id) => `[data-testid="${id}"]`;

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

/** PNG 에서 서로 다른 색이 몇 가지인지 센다(3D 화면이 비어 있지 않은지 확인용). */
function countColors(png) {
  png = Buffer.from(png);
  let pos = 8;
  let width = 0, height = 0, colorType = 6;
  const idat = [];
  while (pos < png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.toString('ascii', pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]; }
    if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let p = 0;
      if (f === 1) p = a;
      else if (f === 2) p = b;
      else if (f === 3) p = (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[y * stride + x] = (v + p) & 255;
    }
  }
  const colors = new Set();
  for (let i = 0; i < out.length; i += bpp * 7) colors.add((out[i] << 16) | (out[i + 1] << 8) | out[i + 2]);
  return colors.size;
}

// ---------------------------------------------------------------------------
// 페이지 도우미
// ---------------------------------------------------------------------------
const newLog = () => ({ consoleErrors: [], failed: [], requests: [], external: [] });
function watch(page, log) {
  page.on('console', (m) => { if (m.type() === 'error') log.consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => log.consoleErrors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => log.failed.push(`${r.url()} (${r.failure()?.errorText})`));
  page.on('response', (r) => { if (r.status() >= 400) log.failed.push(`${r.url()} -> ${r.status()}`); });
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('data:') || u.startsWith('blob:')) return;
    log.requests.push(u);
    if (!u.startsWith(BASE)) log.external.push(u);
  });
}
function closeOut(label, log) {
  expect(`[${label}] 콘솔 오류가 없다`, log.consoleErrors.length === 0, log.consoleErrors.slice(0, 3).join(' | '));
  expect(`[${label}] 실패한 요청이 없다`, log.failed.length === 0, log.failed.slice(0, 3).join(' | '));
  expect(`[${label}] 바깥으로 나간 요청이 0건이다`, log.external.length === 0, log.external.slice(0, 3).join(' | '));
}

/** 3D 화질 단계를 고정한다(검사 기계는 CPU 로 그려서 느리다: 스스로 2D 로 바꾸는 판단이 끼어들지 않게 한다). */
/** 클립보드에 무엇을 적었는지 적어 둔다(읽기 권한 없이도 확인할 수 있게). 진짜 복사도 그대로 한다. */
const spyClipboard = () => {
  try {
    const orig = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = (t) => { window.__copied = t; return orig(t); };
  } catch { /* 클립보드가 없는 환경 */ }
};
const forceLow = () => { try { window.localStorage.setItem('pp-3d-tier', 'low'); } catch { /* 저장소가 막힌 검사에서는 그냥 둔다 */ } };

async function newPage(browser, log, { mobile = true, dpr = 1, inits = [forceLow] } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const cdp = await browser.target().createCDPSession();
  await cdp.send('Browser.grantPermissions', { origin: BASE.slice(0, -1), browserContextId: ctx.id, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(() => {});
  await cdp.detach().catch(() => {});
  if (mobile) await page.setViewport({ width: 360, height: 740, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });
  else await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  for (const init of inits) await page.evaluateOnNewDocument(init);
  watch(page, log);
  return page;
}

async function open(page, url = BASE) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(T('place'), { timeout: 20000 });
  await sleep(1000);
}

async function tap(page, selector) {
  await page.waitForSelector(selector, { timeout: 10000, visible: true });
  const box = await page.$eval(selector, (el) => {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (page.viewport()?.hasTouch) await page.touchscreen.tap(box.x, box.y);
  else await page.mouse.click(box.x, box.y);
  await sleep(160);
}
async function tapAt(page, p) {
  if (page.viewport()?.hasTouch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
  await sleep(160);
}
const text = (page, selector) => page.$eval(selector, (el) => (el.textContent ?? '').trim());
const attr = (page, selector, name) => page.$eval(selector, (el, n) => el.getAttribute(n), name);
const exists = async (page, selector) => (await page.$(selector)) !== null;
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${name}.png`) });
const place = (page) => text(page, T('place'));
const waitGone = (page, selector) => page.waitForSelector(selector, { hidden: true, timeout: 8000 }).then(() => true, () => false);

/**
 * 다른 사람이 지금 고치고 있는 화면 조각(책상의 살펴보기 단추, 대회장의 내 캐릭터 단추).
 * 격납고 검사는 이것들 때문에 실패하지 않게 따로 적어만 둔다(끝에 한꺼번에 알려 준다).
 */
const NOT_MINE = /^(plane-inspect|go-character|char-|view-)/;
const notMine = new Set();

/** 가로 넘침, 누르는 곳 크기, 금지어를 한꺼번에 본다(화면 낭독기용으로 숨겨 둔 목록은 재지 않는다). */
async function audit(page, label, { words = true } = {}) {
  const r = await page.evaluate(() => {
    const vw = window.innerWidth;
    const overflow = document.documentElement.scrollWidth - vw;
    const small = [], clipped = [];
    for (const el of document.querySelectorAll('button, input, textarea, summary, [role="switch"], [role="radio"], [role="tab"]')) {
      if (el.closest('.sr-only') || el.closest('.fb')) continue;
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      const name = (el.getAttribute('data-testid') || el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 24);
      if (b.height < 47.5 || b.width < 47.5) small.push(`${name} ${Math.round(b.width)}x${Math.round(b.height)}`);
      if (b.left < -0.5 || b.right > vw + 0.5) clipped.push(name);
      if (el.tagName === 'BUTTON' && el.scrollWidth > el.clientWidth + 1) clipped.push(`${name} (글자 넘침)`);
    }
    return { overflow, small, clipped, body: document.body.innerText };
  });
  for (const key of ['small', 'clipped']) {
    for (const item of r[key].filter((x) => NOT_MINE.test(x))) notMine.add(`${key === 'small' ? '작은 단추' : '잘림'}: ${item}`);
    r[key] = r[key].filter((x) => !NOT_MINE.test(x));
  }
  expect(`[${label}] 가로로 넘치지 않는다`, r.overflow <= 0, `넘침 ${r.overflow}px`);
  expect(`[${label}] 누르는 곳이 모두 48px 이상`, r.small.length === 0, r.small.join(', '));
  expect(`[${label}] 화면 밖으로 나가거나 글자가 잘린 단추가 없다`, r.clipped.length === 0, r.clipped.join(', '));
  if (words) {
    const hit = FORBIDDEN.filter((w) => r.body.includes(w));
    expect(`[${label}] 딱딱한 말이 없다`, hit.length === 0, hit.join(', '));
  }
}

async function canvasAlive(page, selector, label, min = 60) {
  const box = await page.$eval(selector, (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
  const clip = { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.min(box.width, 360), height: Math.min(box.height, 420) };
  const n = countColors(await page.screenshot({ clip }));
  expect(`[${label}] 3D 화면이 비어 있지 않다`, n >= min, `색 ${n}가지`);
}

/** 저장소에 적힌 격납고 */
const stored = (page) => page.evaluate(() => { try { return JSON.parse(window.localStorage.getItem('pp.hangar.v1') ?? 'null'); } catch { return 'unreadable'; } });
/** 앱이 지금 들고 있는 격납고 */
const live = (page) => page.evaluate(() => window.__ppHangarApi.data());
/** 앱이 쓰는 바로 그 길로 비행기를 넣는다 */
const seed = (page, list) => page.evaluate((l) => window.__ppHangarApi.seed(l), list);
const stageInfo = (page) => page.evaluate(() => (window.__ppHangar ? window.__ppHangar.debug.info() : null));
async function settle(page) {
  await page.evaluate(() => (window.__ppHangar ? window.__ppHangar.debug.settle() : null));
  await sleep(250);
}
const names = (page) => page.$$eval('[data-testid^="hangar-item-"]', (els) => els.map((e) => e.getAttribute('data-name')));
const toastText = async (page) => ((await exists(page, T('hangar-toast-text'))) ? text(page, T('hangar-toast-text')) : '');

async function goHangarFromHome(page) {
  await tap(page, T('go-hangar'));
  await page.waitForSelector(T('hangar'), { timeout: 8000 });
  await sleep(500);
  await settle(page);
}

/** 3D 선반의 i 번째 칸을 진짜로 누른다(없으면 숨겨 둔 목록의 단추를 누른다). */
async function pickSlot(page, i) {
  if (await page.evaluate(() => window.__ppHangar !== undefined)) {
    await page.evaluate((n) => window.__ppHangar.debug.reveal(n), i);
    await settle(page);
  }
  const p = await page.evaluate((n) => (window.__ppHangar ? window.__ppHangar.debug.slotScreen(n) : null), i);
  if (p) await tapAt(page, p);
  else await tap(page, T(`hangar-item-${i}`));
  await page.waitForSelector(T('hangar-panel'), { timeout: 8000 });
  await sleep(400);
}

/** 책상에서 뾰족 화살을 한 번에 접는다. */
async function foldDart(page, presetId = 'dart') {
  if ((await place(page)) !== '책상') { await tap(page, T('go-desk')); }
  await tap(page, T('desk-tab-fold'));
  if ((await attr(page, T('mode-guide'), 'aria-selected')) !== 'true') await tap(page, T('mode-guide'));
  if (await exists(page, T('guide-other'))) await tap(page, T('guide-other'));
  await tap(page, T(`fold-${presetId}`));
  await tap(page, T('guide-instant'));
  await page.waitForSelector(T('guide-done'), { timeout: 15000 });
  await sleep(300);
}

/** 출발선에서 톡 눌러 던지고 결과가 나올 때까지 기다린다. */
async function throwOnce(page) {
  await page.waitForSelector(T('throw-btn'), { timeout: 10000 });
  await sleep(900);
  await tap(page, T('throw-btn'));
  await sleep(500);
  if (await exists(page, T('skip'))) await tap(page, T('skip')).catch(() => {});
  await page.waitForSelector(T('result-panel'), { timeout: 60000 });
  await sleep(400);
  return { distance: Number(await text(page, T('result-distance'))), airtime: Number(await text(page, T('result-airtime'))) };
}

function loadData() {
  const r = spawnSync('npx', ['tsx', 'scripts/e2e-hangar-data.ts'], { cwd: ROOT, encoding: 'utf8' });
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

// ---------------------------------------------------------------------------
// 1) 휴대전화: 넣기 -> 이름 -> 이미 넣음 -> 고쳐서 바꾸기 -> 날리기 -> 격납고에서 고르고 만지기
// ---------------------------------------------------------------------------
async function mainFlow(browser, data) {
  const log = newLog();
  const page = await newPage(browser, log, { dpr: 2, inits: [forceLow, spyClipboard] });
  await open(page);

  // ---- 대회장: 격납고 입구 ----
  expect('대회장: 큰 단추는 그대로 "비행기 접으러 가기"다', /비행기 접으러 가기/.test(await text(page, T('go-desk'))) && (await page.$$('.home .btn--primary')).length === 1);
  expect('대회장: 격납고 입구가 있다', /격납고/.test(await text(page, T('go-hangar'))) && /모으기/.test(await text(page, T('home-hangar-count'))));
  if (await exists(page, T('hint-close'))) await tap(page, T('hint-close'));
  await sleep(300);
  await shot(page, '01-home-entrance');
  await audit(page, '대회장');

  // ---- 빈 격납고 ----
  await goHangarFromHome(page);
  expect('격납고로 간다', (await place(page)) === '격납고');
  expect('격납고: 이름과 한 줄 풀이가 있다', (await text(page, '#hangar-title')) === '격납고' && /내 비행기를 모아 두는 곳/.test(await text(page, '.hg-sign')));
  expect('빈 격납고: 3D 선반으로 보인다', (await attr(page, T('hangar'), 'data-view')) === '3d' && (await stageInfo(page))?.planes === 0);
  expect('빈 격납고: 첫 비행기를 권한다', /첫 비행기/.test(await text(page, T('hangar-empty'))) && (await text(page, T('hangar-count'))).replace(/\s/g, '') === '0/24');
  await canvasAlive(page, T('hangar-canvas'), '빈 격납고');
  await shot(page, '02-hangar-empty');
  await audit(page, '빈 격납고');
  await tap(page, T('hangar-go-desk'));
  expect('빈 격납고에서 책상으로 갈 수 있다', (await place(page)) === '책상');

  // ---- 책상: 접기 전에는 넣기 단추가 없다 ----
  await tap(page, T('desk-tab-fold'));
  expect('책상: 빈 종이일 때는 넣기 단추가 없다', !(await exists(page, T('hangar-save'))));
  await foldDart(page);
  expect('책상: 접으면 "격납고에 넣기"가 나온다', (await attr(page, T('hangar-save'), 'data-state')) === 'new' && /격납고에 넣기/.test(await text(page, T('hangar-save-btn'))));
  await shot(page, '03-desk-save');
  await audit(page, '책상: 넣기 단추');

  // ---- 이름 대화상자 ----
  await tap(page, T('hangar-save-btn'));
  await page.waitForSelector(T('name-dialog'));
  const suggested = await page.$eval(T('name-input'), (el) => el.value);
  expect('이름: 종이와 접는 법으로 추천해 준다', suggested === '복사지 화살 1호', suggested);
  await sleep(250);
  await shot(page, '04-name-dialog');
  await audit(page, '이름 대화상자');
  const setName = async (v) => {
    await page.$eval(T('name-input'), (el) => { el.focus(); el.select(); });
    await page.keyboard.press('Backspace');
    if (v) await page.keyboard.type(v);
    await sleep(120);
  };
  await setName('');
  expect('이름: 비우면 넣을 수 없고 까닭을 알려 준다', (await page.$eval(T('name-ok'), (el) => el.disabled)) && /한 글자 이상/.test(await text(page, T('name-help'))));
  await setName('가나다라마바사아자차카타파');
  expect('이름: 13글자면 넣을 수 없고 얼마나 줄일지 알려 준다', (await page.$eval(T('name-ok'), (el) => el.disabled)) && /12글자까지/.test(await text(page, T('name-help'))), await text(page, T('name-help')));
  await setName('  번개 1호  ');
  expect('이름: 앞뒤 빈칸은 세지 않는다', !(await page.$eval(T('name-ok'), (el) => el.disabled)) && /5\s*\/\s*12/.test(await text(page, T('name-help'))), await text(page, T('name-help')));
  await tap(page, T('name-ok'));
  await waitGone(page, T('name-dialog'));
  await page.waitForSelector(T('hangar-toast'));
  expect('넣기: 스티커 알림이 이름과 함께 뜬다', /'번개 1호'를 격납고에 넣었어요/.test(await toastText(page)), await toastText(page));
  expect('넣기: 새 스티커 "첫 비행기 넣기"를 받는다', await exists(page, T('hangar-new-sticker-hangar1')));
  await shot(page, '05-saved-toast');
  let st = await stored(page);
  expect('넣기: 저장소에 한 대가 들어 있다(이름, 종이, 만든 법, 그림)', st?.v === 1 && st.planes.length === 1 && st.planes[0].name === '번개 1호' && st.planes[0].paperId === 'copy80' && st.planes[0].origin === 'preset:dart' && typeof st.planes[0].thumb === 'string' && st.planes[0].flights === 0, JSON.stringify(st?.planes?.[0] ?? null).slice(0, 160));
  const hashDesign = await page.evaluate(() => window.location.hash);
  expect('넣기: 저장된 코드는 지금 비행기의 모양 코드다', typeof st?.planes?.[0]?.code === 'string' && st.planes[0].code.length > 20 && hashDesign.startsWith('#p'), st?.planes?.[0]?.code);
  expect('이미 넣음: "격납고에 있어요"와 이름이 보인다', (await attr(page, T('hangar-save'), 'data-state')) === 'saved' && /격납고에 있어요/.test(await text(page, T('hangar-save'))) && /번개 1호/.test(await text(page, T('hangar-saved-name'))));
  await audit(page, '책상: 이미 넣음');

  // ---- 이름 바꾸기(책상에서) ----
  await tap(page, T('hangar-rename'));
  await page.waitForSelector(T('name-dialog'));
  expect('이름 바꾸기: 지금 이름이 적혀 있다', (await page.$eval(T('name-input'), (el) => el.value)) === '번개 1호');
  await setName('쌩쌩이');
  await tap(page, T('name-ok'));
  await waitGone(page, T('name-dialog'));
  expect('이름 바꾸기: 바로 바뀐다', /쌩쌩이/.test(await text(page, T('hangar-saved-name'))) && (await stored(page)).planes[0].name === '쌩쌩이' && /'쌩쌩이'로 바꿨어요/.test(await toastText(page)), await toastText(page));

  // ---- 고쳐서 바꾸기 ----
  const codeBefore = (await stored(page)).planes[0].code;
  await tap(page, T('desk-tab-shape'));
  await tap(page, 'button[aria-label="꼬리 올리기 늘리기"]');
  await sleep(500);
  expect('고침: 넣어 둔 비행기를 고치면 두 가지를 권한다', (await attr(page, T('hangar-save'), 'data-state')) === 'modified' && /쌩쌩이/.test(await text(page, T('hangar-modified-name'))) && /고친 걸로 바꾸기/.test(await text(page, T('hangar-replace'))) && /새 비행기로 넣기/.test(await text(page, T('hangar-save-new'))));
  await shot(page, '06-desk-modified');
  await audit(page, '책상: 고친 상태');
  await tap(page, T('hangar-replace'));
  await sleep(400);
  st = await stored(page);
  expect('고친 걸로 바꾸기: 같은 비행기의 모양만 바뀐다', st.planes.length === 1 && st.planes[0].name === '쌩쌩이' && st.planes[0].code !== codeBefore && (await attr(page, T('hangar-save'), 'data-state')) === 'saved', await toastText(page));
  await tap(page, 'button[aria-label="꼬리 올리기 늘리기"]');
  await sleep(500);
  await tap(page, T('hangar-save-new'));
  await page.waitForSelector(T('name-dialog'));
  expect('새 비행기로 넣기: 겹치지 않는 이름을 추천한다', (await page.$eval(T('name-input'), (el) => el.value)) === '복사지 화살 1호');
  await tap(page, T('name-ok'));
  await waitGone(page, T('name-dialog'));
  st = await stored(page);
  expect('새 비행기로 넣기: 두 대가 된다', st.planes.length === 2 && st.planes[1].name === '복사지 화살 1호' && st.planes[1].code !== st.planes[0].code && (await attr(page, T('hangar-save'), 'data-state')) === 'saved');

  // ---- 날리기: 넣어 둔 비행기의 기록이 저절로 적힌다 ----
  await tap(page, T('desk-next'));
  expect('출발선으로 간다', (await place(page)) === '출발선');
  const r1 = await throwOnce(page);
  st = await stored(page);
  const flown = st.planes[1];
  expect('날리기: 넣어 둔 비행기의 날린 횟수와 최고 기록이 적힌다', flown.flights === 1 && Math.abs(flown.best.distance.value - r1.distance) < 0.006 && Math.abs(flown.best.airtime.value - r1.airtime) < 0.006 && typeof flown.best.distance.throwCode === 'string' && st.planes[0].flights === 0, `${flown.flights}번, ${flown.best?.distance?.value} / ${r1.distance}`);
  expect('결과 화면: 이미 넣은 비행기라고 알려 준다', (await attr(page, T('hangar-save'), 'data-state')) === 'saved' && /복사지 화살 1호/.test(await text(page, T('hangar-saved-name'))));
  await page.$eval(T('result-panel'), (el) => { el.scrollTop = el.scrollHeight; });
  await sleep(200);
  await shot(page, '07-result-saved');
  await audit(page, '결과 화면');

  // ---- 기록장: 격납고 문, 최근 비행의 비행기 이름 ----
  await tap(page, T('nav-book'));
  expect('기록장: 격납고로 가는 문이 있다', /격납고/.test(await text(page, T('book-hangar'))) && /2대/.test(await text(page, T('book-hangar'))));
  expect('기록장: 최근 비행에 격납고 비행기 이름이 보인다', /복사지 화살 1호/.test(await text(page, T('recent-plane-0'))));
  expect('기록장: 스티커판이 열다섯 칸이고 격납고 스티커가 붙어 있다', (await page.$$('.stickerboard .sticker')).length === 15 && (await attr(page, T('sticker-hangar1'), 'data-got')) === 'true' && (await attr(page, T('sticker-hangar5'), 'data-got')) === 'false');
  await shot(page, '08-book-door');
  await audit(page, '기록장');
  await tap(page, T('book-hangar'));
  await page.waitForSelector(T('hangar'));
  await sleep(500);
  await settle(page);

  // ---- 격납고: 두 대 ----
  expect('격납고: 두 대가 선반에 놓인다', (await stageInfo(page)).planes === 2 && (await text(page, T('hangar-count'))).replace(/\s/g, '') === '2/24');
  expect('격납고: 방금 날린 비행기가 "최근" 맨 앞이다', (await names(page)).join(',') === '복사지 화살 1호,쌩쌩이', (await names(page)).join(','));
  await canvasAlive(page, T('hangar-canvas'), '격납고 두 대');
  await audit(page, '격납고 두 대');

  // 옆으로 밀기: 선반이 움직이고, 민 것은 고르기로 치지 않는다
  const panBefore = (await stageInfo(page)).pan;
  await page.touchscreen.touchStart(300, 420);
  for (let i = 1; i <= 8; i++) { await page.touchscreen.touchMove(300 - i * 22, 420); await sleep(20); }
  await page.touchscreen.touchEnd();
  await settle(page);
  const panAfter = (await stageInfo(page)).pan;
  expect('격납고: 옆으로 밀면 선반이 움직인다', panAfter > panBefore + 0.2 && !(await exists(page, T('hangar-panel'))), `${panBefore.toFixed(2)} -> ${panAfter.toFixed(2)}`);

  // 고르기: 선반 위 비행기를 진짜로 누른다
  await pickSlot(page, 0);
  expect('고르기: 누른 비행기의 판이 올라온다', (await text(page, T('panel-name'))) === '복사지 화살 1호' && (await stageInfo(page)).selected !== null);
  expect('판: 종이, 만든 법, 균형, 한마디가 있다', (await text(page, T('panel-paper'))) === '일반 복사지' && (await text(page, T('panel-origin'))) === '뾰족 화살' && (await text(page, T('panel-balance'))).length > 0 && /비행기/.test(await text(page, T('panel-forecast'))));
  const bestText = await text(page, T('panel-best-distance'));
  expect('판: 최고 기록과 날짜, 날린 횟수가 있다', bestText.includes(r1.distance.toFixed(2)) && /오늘/.test(bestText) && /1번 날렸어요/.test(await text(page, T('panel-flights'))), bestText);
  await sleep(1400);
  await shot(page, '09-selected-pedestal');
  await audit(page, '격납고: 고른 비행기');

  // 즐겨찾기
  await tap(page, T('panel-fav'));
  expect('즐겨찾기: 별이 켜지고 저장된다', (await attr(page, T('panel-fav'), 'aria-checked')) === 'true' && (await stored(page)).planes[1].favourite === true);
  // 이름 바꾸기(판에서)
  await tap(page, T('panel-rename'));
  await page.waitForSelector(T('name-dialog'));
  await setName('우리 반 대표');
  await tap(page, T('name-ok'));
  await waitGone(page, T('name-dialog'));
  expect('판에서 이름 바꾸기: 판과 선반 목록이 함께 바뀐다', (await text(page, T('panel-name'))) === '우리 반 대표' && (await names(page))[0] === '우리 반 대표');
  // 코드 복사
  await tap(page, T('panel-copy'));
  await sleep(400);
  const clip = await page.evaluate(() => window.__copied ?? '');
  expect('코드 복사: 클립보드에 코드가 들어가고 알려 준다', /^[0-9A-Za-z]{30,}$/.test(clip) && /복사했어요/.test(await toastText(page)), `${clip.slice(0, 20)}… / ${await toastText(page)}`);
  // 연구 노트
  await tap(page, T('panel-notebook'));
  await page.waitForSelector(T('notebook'), { timeout: 8000 });
  expect('연구 노트 보기: 고른 비행기의 공책이 열린다', await exists(page, T('table-exact')));
  await tap(page, T('notebook-close'));
  await waitGone(page, T('notebook'));

  // 차례
  await tap(page, T('panel-close'));
  await waitGone(page, T('hangar-panel'));
  await tap(page, T('hangar-sort-fav'));
  expect('차례: 즐겨찾기만 보기', (await names(page)).join(',') === '우리 반 대표', (await names(page)).join(','));
  await tap(page, T('hangar-sort-far'));
  expect('차례: 멀리(기록 있는 비행기가 앞)', (await names(page)).join(',') === '우리 반 대표,쌩쌩이', (await names(page)).join(','));
  await tap(page, T('hangar-sort-recent'));
  await settle(page);

  // 버리기 + 되돌리기
  await pickSlot(page, 1);
  expect('두 번째 비행기를 고른다', (await text(page, T('panel-name'))) === '쌩쌩이');
  await tap(page, T('panel-delete'));
  await page.waitForSelector(T('hangar-confirm'));
  expect('버리기: 화면 안 대화상자로 한 번 더 묻는다', /쌩쌩이/.test(await text(page, T('hangar-confirm'))) && /되돌리기/.test(await text(page, T('hangar-confirm'))));
  await shot(page, '10-delete-confirm');
  await audit(page, '버리기 물음');
  await tap(page, T('hangar-confirm-no'));
  expect('버리기: 그만두면 그대로다', (await stored(page)).planes.length === 2 && (await exists(page, T('hangar-panel'))));
  await tap(page, T('panel-delete'));
  await tap(page, T('hangar-confirm-yes'));
  await sleep(300);
  expect('버리기: 한 대가 줄고 되돌리기 알림이 뜬다', (await stored(page)).planes.length === 1 && /버렸어요/.test(await toastText(page)) && (await text(page, T('hangar-toast-action'))) === '되돌리기');
  await shot(page, '11-delete-undo');
  await audit(page, '되돌리기 알림');
  await tap(page, T('hangar-toast-action'));
  await sleep(300);
  st = await stored(page);
  expect('되돌리기: 있던 자리로 돌아온다(이름, 기록 그대로)', st.planes.length === 2 && st.planes[0].name === '쌩쌩이' && st.planes[1].name === '우리 반 대표' && st.planes[1].flights === 1);
  await settle(page);

  // 고쳐 접기: 고친 비행기는 내 맘대로 접기로 열린다
  await pickSlot(page, 0);
  await tap(page, T('panel-edit'));
  expect('고쳐 접기: 책상으로 간다', (await place(page)) === '책상');
  await sleep(500);
  expect('고쳐 접기: 넣어 둔 비행기로 알아본다', (await attr(page, T('hangar-save'), 'data-state')) === 'saved' && /우리 반 대표/.test(await text(page, T('hangar-saved-name'))) && (await attr(page, T('mode-free'), 'aria-selected')) === 'true');

  // 격납고에서 나가면 들어오기 전 화면으로 돌아간다
  await tap(page, T('nav-book'));
  await tap(page, T('book-hangar'));
  await page.waitForSelector(T('hangar'));
  await tap(page, T('nav-back'));
  expect('돌아가기: 들어오기 전 화면(기록장)으로 간다', (await place(page)) === '기록장');
  expect('격납고를 떠나면 3D 무대를 정리한다', (await page.evaluate(() => window.__ppHangar === undefined)));

  // 새로 고쳐도 남아 있다
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector(T('place'));
  await sleep(800);
  expect('새로 고쳐도 격납고가 남아 있다', (await live(page)).planes.length === 2 && /2대/.test(await text(page, T('home-hangar-count'))));
  closeOut('휴대전화 흐름', log);
  await page.browserContext().close();
}

// ---------------------------------------------------------------------------
// 2) 1대, 7대, 24대: 갈무리, 꺼내 날리기, 꽉 참, 화질 단계별 그리기 수
// ---------------------------------------------------------------------------
async function seedsFlow(browser, data) {
  const log = newLog();
  const page = await newPage(browser, log, { dpr: 2 });
  await open(page);
  if (await exists(page, T('hint-close'))) await tap(page, T('hint-close'));

  // ---- 1대 ----
  let r = await seed(page, [data.untouched]);
  expect('넣기(앱의 길로): 한 대', r.added === 1 && r.planes === 1 && r.persisted === true, JSON.stringify(r));
  expect('대회장: 입구에 대수가 보인다', /내 비행기 1대/.test(await text(page, T('home-hangar-count'))));
  await goHangarFromHome(page);
  expect('1대: 선반에 한 대가 놓인다', (await stageInfo(page)).planes === 1 && !(await exists(page, T('hangar-empty'))));
  await shot(page, '12-hangar-one');
  await audit(page, '격납고 1대');
  // 손대지 않은 따라 접기 비행기는 그 접는 법 그대로 책상에 열린다
  await pickSlot(page, 0);
  await tap(page, T('panel-edit'));
  await sleep(500);
  expect('고쳐 접기: 손대지 않은 따라 접기 비행기는 따라 접기로 열린다', (await place(page)) === '책상' && (await attr(page, T('mode-guide'), 'aria-selected')) === 'true' && (await exists(page, T('guide-done'))) && (await attr(page, T('hangar-save'), 'data-state')) === 'saved');
  await tap(page, T('nav-home'));

  // ---- 7대 ----
  r = await seed(page, data.seeds.slice(0, 6));
  expect('넣기: 일곱 대', r.planes === 7, JSON.stringify(r));
  await goHangarFromHome(page);
  let info = await stageInfo(page);
  expect('7대: 모두 선반에 놓인다', info.planes === 7 && info.pending === 0, JSON.stringify(info));
  await canvasAlive(page, T('hangar-canvas'), '격납고 7대', 200);
  await shot(page, '13-hangar-few');
  await audit(page, '격납고 7대');
  await tap(page, T('hangar-sort-far'));
  await settle(page);
  const far = await names(page);
  const liveNow = await live(page);
  const farExpect = [...liveNow.planes].sort((a, b) => (b.best.distance?.value ?? -1) - (a.best.distance?.value ?? -1) || b.updatedAt - a.updatedAt).map((p) => p.name);
  expect('7대: "멀리" 차례가 최고 거리 차례와 같다', far.join(',') === farExpect.join(','), far.join(','));
  await shot(page, '14-hangar-sort-far');
  await tap(page, T('hangar-sort-long'));
  await settle(page);
  const longTop = (await names(page))[0];
  const longExpect = [...liveNow.planes].sort((a, b) => (b.best.airtime?.value ?? -1) - (a.best.airtime?.value ?? -1))[0].name;
  expect('7대: "오래" 차례의 맨 앞은 가장 오래 뜬 비행기다', longTop === longExpect, `${longTop} / ${longExpect}`);
  await tap(page, T('hangar-sort-fav'));
  expect('7대: 즐겨찾기만 보인다', (await names(page)).length === liveNow.planes.filter((p) => p.favourite).length && (await names(page)).length > 0);
  await tap(page, T('hangar-sort-recent'));
  await settle(page);

  // 꺼내서 날리기 -> 돌아오면 최고 기록이 올라 있다
  const target = (await names(page))[1];
  const before = (await live(page)).planes.find((p) => p.name === target);
  await pickSlot(page, 1);
  expect('꺼내서 날리기: 고른 비행기의 판', (await text(page, T('panel-name'))) === target);
  await sleep(1500);
  await shot(page, '15-selected-panel');
  await tap(page, T('panel-throw'));
  expect('꺼내서 날리기: 출발선으로 간다', (await place(page)) === '출발선');
  const flown = await throwOnce(page);
  expect('꺼내서 날리기: 결과 화면이 그 비행기를 알아본다', (await attr(page, T('hangar-save'), 'data-state')) === 'saved' && (await text(page, T('hangar-saved-name'))).includes(target));
  const after = (await live(page)).planes.find((p) => p.name === target);
  const wasBest = before.best.distance?.value ?? 0;
  expect('꺼내서 날리기: 날린 횟수가 늘고, 더 멀리 갔으면 최고 기록이 바뀐다', after.flights === before.flights + 1 && Math.abs(after.best.distance.value - Math.max(wasBest, flown.distance)) < 0.006 && flown.distance > wasBest, `${wasBest} -> ${after.best.distance.value} (이번 ${flown.distance})`);
  // 격납고로 돌아가서(위쪽 막대가 좁아 기록장을 거친다) 판에서 확인
  await tap(page, T('nav-book'));
  await tap(page, T('book-hangar'));
  await page.waitForSelector(T('hangar'));
  await sleep(500);
  await settle(page);
  expect('돌아오면: 방금 날린 비행기가 "최근" 맨 앞이다', (await names(page))[0] === target, (await names(page))[0]);
  await pickSlot(page, 0);
  expect('돌아오면: 판의 최고 기록이 새 기록이다', (await text(page, T('panel-best-distance'))).includes(flown.distance.toFixed(2)) && new RegExp(`${after.flights}번 날렸어요`).test(await text(page, T('panel-flights'))), await text(page, T('panel-best-distance')));
  await tap(page, T('panel-close'));
  await tap(page, T('nav-back'));
  await tap(page, T('nav-home'));

  // ---- 24대 ----
  r = await seed(page, data.seeds.slice(6));
  expect('넣기: 스물네 대까지만 들어간다', r.planes === 24 && r.added === 17, JSON.stringify(r));
  const sizes = await page.evaluate(() => {
    const raw = window.localStorage.getItem('pp.hangar.v1') ?? '';
    const planes = JSON.parse(raw).planes;
    const bytes = (s) => new Blob([s]).size;
    const per = planes.map((p) => bytes(JSON.stringify(p)));
    const bare = planes.map((p) => { const { thumb, ...rest } = p; void thumb; return bytes(JSON.stringify(rest)); });
    const thumbs = planes.map((p) => (p.thumb ? bytes(p.thumb) : 0));
    const st = (a) => ({ min: Math.min(...a), max: Math.max(...a), avg: Math.round(a.reduce((x, y) => x + y, 0) / a.length) });
    return { totalBytes: bytes(raw), planes: planes.length, perPlane: st(per), withoutThumb: st(bare), thumb: st(thumbs), thumbType: (planes[0].thumb ?? '').slice(5, 15) };
  });
  expect('크기: 한 대가 12 kB 를 넘지 않고, 그림 없이도 1 kB 를 넘지 않는다', sizes.perPlane.max <= 12000 && sizes.withoutThumb.max <= 1000, JSON.stringify(sizes));
  await goHangarFromHome(page);
  info = await stageInfo(page);
  expect('24대: 모두 선반에 놓인다', info.planes === 24 && info.pending === 0 && (await text(page, T('hangar-count'))).replace(/\s/g, '') === '24/24', JSON.stringify(info));
  await shot(page, '16-hangar-full');
  await audit(page, '격납고 24대');
  await page.evaluate(() => { const d = window.__ppHangar.debug; d.pan(d.info().panMax); });
  await settle(page);
  await shot(page, '17-hangar-full-end');

  // 화질 단계별 그리기 수(24대)
  const perf = {};
  for (const tier of ['low', 'medium', 'high']) {
    await page.evaluate((t) => window.__ppHangar.debug.tier(t), tier);
    await settle(page);
    await page.evaluate(() => { const d = window.__ppHangar.debug; d.pan(0); });
    await settle(page);
    await page.evaluate(() => window.__ppHangar.debug.render());
    const i = await stageInfo(page);
    perf[tier] = { calls: i.full.calls, triangles: i.full.triangles, shadowMap: i.shadow, pixelRatio: i.pixelRatio, geometries: i.geometries, textures: i.textures };
    if (tier === 'high') await shot(page, '18-hangar-full-high');
  }
  expect('24대: 그리기 호출이 단계마다 250번을 넘지 않는다', Object.values(perf).every((p) => p.calls > 0 && p.calls <= 250), JSON.stringify(perf));
  // 가만히 있으면 그리지 않는다
  const f0 = (await stageInfo(page)).frames;
  await sleep(1200);
  const f1 = (await stageInfo(page)).frames;
  expect('24대: 가만히 있으면 한 장도 다시 그리지 않는다', f1 === f0, `${f0} -> ${f1}`);
  writeFileSync(join(SHOTS, 'perf.json'), JSON.stringify({ viewport: '360x740@2 (SwiftShader)', planes: 24, drawCallsByTier: perf, storage: sizes }, null, 2));
  await page.evaluate(() => window.__ppHangar.debug.tier('low'));
  await settle(page);

  // 꽉 찼을 때: 넣으려 하면 알려 준다
  await tap(page, T('nav-back'));
  await tap(page, T('go-desk'));
  await foldDart(page, 'stealth');
  await tap(page, T('desk-tab-shape'));
  await tap(page, 'button[aria-label="날개 들기 늘리기"]');
  await sleep(500);
  const state = await attr(page, T('hangar-save'), 'data-state');
  await tap(page, state === 'modified' ? T('hangar-save-new') : T('hangar-save-btn'));
  await page.waitForSelector(T('hangar-full'), { timeout: 8000 });
  expect('꽉 참: 몇 대까지인지와 어떻게 하면 되는지 알려 준다', /24대까지/.test(await text(page, T('hangar-full'))) && /버리면/.test(await text(page, T('hangar-full'))) && (await live(page)).planes.length === 24, `(상태 ${state})`);
  await shot(page, '19-hangar-full-message');
  await audit(page, '꽉 찼어요');
  await tap(page, T('hangar-full-go'));
  expect('꽉 참: 격납고로 바로 가 볼 수 있다', (await place(page)) === '격납고');
  closeOut('1 / 7 / 24대', log);
  await page.browserContext().close();
  return { perf, sizes };
}

// ---------------------------------------------------------------------------
// 3) 저장소가 막혔을 때: 이번 방문 동안만 기억한다
// ---------------------------------------------------------------------------
async function blockedFlow(browser) {
  const log = newLog();
  const block = () => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } });
  };
  const page = await newPage(browser, log, { inits: [block] });
  await open(page);
  if (await exists(page, T('hint-close'))) await tap(page, T('hint-close'));
  await tap(page, T('go-desk'));
  await foldDart(page);
  await tap(page, T('hangar-save-btn'));
  await page.waitForSelector(T('name-dialog'));
  expect('저장소 막힘: 넣기 전에 창을 닫으면 사라진다고 알려 준다', /창을 닫으면/.test(await text(page, T('name-session-note'))));
  await shot(page, '20-blocked-dialog');
  await tap(page, T('name-ok'));
  await waitGone(page, T('name-dialog'));
  expect('저장소 막힘: 그래도 넣어지고, 알림이 까닭을 말해 준다', (await live(page)).planes.length === 1 && /넣었어요/.test(await toastText(page)) && /창을 닫으면/.test(await toastText(page)), await toastText(page));
  expect('저장소 막힘: 책상은 넣은 것으로 알아본다', (await attr(page, T('hangar-save'), 'data-state')) === 'saved');
  await audit(page, '저장소 막힘: 알림');
  await tap(page, T('nav-home'));
  await goHangarFromHome(page);
  expect('저장소 막힘: 격납고에 한 대가 있고 안내가 붙어 있다', (await text(page, T('hangar-count'))).replace(/\s/g, '') === '1/24' && /창을 닫으면/.test(await text(page, T('hangar-session-note'))));
  await shot(page, '21-blocked-hangar');
  await audit(page, '저장소 막힘: 격납고');
  await pickSlot(page, 0);
  await tap(page, T('panel-fav'));
  expect('저장소 막힘: 즐겨찾기도 이번 방문 동안 동작한다', (await live(page)).planes[0].favourite === true);
  closeOut('저장소 막힘', log);
  await page.browserContext().close();

  // 자리가 모자랄 때: 그림을 빼고 넣는다
  const log2 = newLog();
  const quota = () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(k, v) {
      if (k === 'pp.hangar.v1' && String(v).length > 1500) throw new DOMException('quota', 'QuotaExceededError');
      return orig.call(this, k, v);
    };
  };
  const page2 = await newPage(browser, log2, { inits: [forceLow, quota] });
  await open(page2);
  if (await exists(page2, T('hint-close'))) await tap(page2, T('hint-close'));
  await tap(page2, T('go-desk'));
  await foldDart(page2);
  await tap(page2, T('hangar-save-btn'));
  await page2.waitForSelector(T('name-dialog'));
  await tap(page2, T('name-ok'));
  await waitGone(page2, T('name-dialog'));
  const st = await stored(page2);
  expect('자리 모자람: 그림만 빼고 저장하고, 그렇게 했다고 알려 준다', st?.planes?.length === 1 && st.planes[0].thumb === undefined && /그림은 빼고/.test(await toastText(page2)), await toastText(page2));
  closeOut('자리 모자람', log2);
  await page2.browserContext().close();
}

// ---------------------------------------------------------------------------
// 4) 망가진 저장 값: 건너뛰고 나머지는 살린다
// ---------------------------------------------------------------------------
async function corruptFlow(browser, data) {
  for (const [label, value, want] of [['망가진 칸', data.corrupt, 2], ['깨진 글자', data.garbage, 0]]) {
    const log = newLog();
    const page = await newPage(browser, log);
    // 지금 판의 앱이 적어 둔 저장소처럼: 격납고 값 옆에 물리 판 표시(pp.physics.v1)도 같이 적는다.
    // 표시가 없으면 앱은 "옛 판의 저장소"로 보고 기록을 다시 잰다(그 길은 e2e-lab 의 "다시 재기"가 따로 검사한다).
    await page.evaluateOnNewDocument((k, v, pk, pv) => { try { if (window.localStorage.getItem('pp-e2e-once') === null) { window.localStorage.setItem(k, v); window.localStorage.setItem(pk, pv); window.localStorage.setItem('pp-e2e-once', '1'); } } catch { /* 무시 */ } }, data.key, value, data.physicsKey, JSON.stringify(data.physics));
    await open(page);
    if (await exists(page, T('hint-close'))) await tap(page, T('hint-close'));
    expect(`${label}: 앱이 멈추지 않고 열린다`, (await place(page)) === '대회장' && (await live(page)).planes.length === want, `${(await live(page)).planes.length}대`);
    await goHangarFromHome(page);
    expect(`${label}: 꺼내지 못한 것이 있다고 알려 준다`, /꺼내지 못했어요/.test(await text(page, T('hangar-load-note'))), await text(page, T('hangar-load-note')));
    if (want > 0) {
      expect(`${label}: 멀쩡한 비행기는 기록과 함께 그대로다`, (await names(page)).length === 2 && (await live(page)).planes[0].best.distance.value === data.goodBest.distanceM && (await live(page)).planes[0].best.airtime.value === data.goodBest.airtimeS && (await stageInfo(page)).planes === 2, `${(await live(page)).planes[0]?.best?.distance?.value} / ${data.goodBest.distanceM}`);
      await shot(page, '22-corrupt-skipped');
    } else {
      expect(`${label}: 빈 격납고로 시작한다`, await exists(page, T('hangar-empty')));
    }
    await audit(page, label);
    closeOut(label, log);
    await page.browserContext().close();
  }
}

// ---------------------------------------------------------------------------
// 5) WebGL 이 막혔을 때: 그림 딱지 목록으로 보여 준다
// ---------------------------------------------------------------------------
async function noGlFlow(browser, data) {
  const log = newLog();
  const noWebGL = () => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(type, ...rest) { return /webgl/i.test(String(type)) ? null : orig.call(this, type, ...rest); };
  };
  const page = await newPage(browser, log, { dpr: 2, inits: [noWebGL] });
  await open(page);
  if (await exists(page, T('hint-close'))) await tap(page, T('hint-close'));
  const r = await seed(page, data.seeds.slice(0, 7));
  expect('WebGL 막힘: 넣기는 그대로 된다', r.planes === 7, JSON.stringify(r));
  await goHangarFromHome(page);
  expect('WebGL 막힘: 그림 딱지 목록으로 바뀌고 까닭을 알려 준다', (await attr(page, T('hangar'), 'data-view')) === 'flat' && (await page.$$('.hg-grid .hg-card:not(.hg-card--empty)')).length === 7 && /그림으로/.test(await text(page, T('hangar-flat-note'))));
  expect('WebGL 막힘: 딱지마다 비행기 그림이 있다', (await page.$$eval('.hg-grid .hg-card:not(.hg-card--empty) .hg-card__pic', (els) => els.every((e) => e.querySelector('img, svg') !== null))));
  await shot(page, '23-flat-fallback');
  await audit(page, '그림 목록');
  await tap(page, T('hangar-item-2'));
  await page.waitForSelector(T('hangar-panel'));
  const name = await text(page, T('panel-name'));
  expect('WebGL 막힘: 딱지를 누르면 같은 판이 뜬다', name === (await names(page))[2] && (await text(page, T('panel-paper'))).length > 0);
  await shot(page, '24-flat-panel');
  await audit(page, '그림 목록: 판');
  await tap(page, T('panel-throw'));
  expect('WebGL 막힘: 꺼내서 출발선으로 갈 수 있다', (await place(page)) === '출발선');
  // 체육관(대회장) 장면이 WebGL 을 만들어 보다가 three.js 가 찍는 한 줄은 격납고와 상관없다. 격납고와 작은 그림은 조용히 넘어가야 한다.
  const glErr = log.consoleErrors.filter((e) => /Error creating WebGL context/.test(e));
  expect('WebGL 막힘: 격납고와 작은 그림은 콘솔 오류 없이 넘어간다(체육관 장면의 한 줄만 남는다)', glErr.length <= 1, `${glErr.length}줄`);
  log.consoleErrors = log.consoleErrors.filter((e) => !/Error creating WebGL context/.test(e));
  closeOut('WebGL 막힘', log);
  await page.browserContext().close();
}

// ---------------------------------------------------------------------------
// 6) 넓은 화면(1280 x 800, 마우스): 결과 화면에서 넣기, 위쪽 막대의 격납고, 코드로 꺼낸 비행기
// ---------------------------------------------------------------------------
async function desktopFlow(browser, data) {
  const log = newLog();
  const page = await newPage(browser, log, { mobile: false });
  await open(page);
  if (await exists(page, T('hint-close'))) await tap(page, T('hint-close'));
  await sleep(300);
  expect('넓은 화면: 대회장에 격납고 입구가 있고, 위쪽 막대에도 있다', (await exists(page, T('go-hangar'))) && (await page.$eval(T('nav-hangar'), (el) => el.getBoundingClientRect().width > 40)));
  await shot(page, 'd-01-home');
  await audit(page, '넓은 화면: 대회장');

  // 접고 던진 뒤 결과 화면에서 넣는다
  await tap(page, T('go-desk'));
  await foldDart(page, 'glider');
  expect('넓은 화면: 책상에 넣기 단추가 있다', (await attr(page, T('hangar-save'), 'data-state')) === 'new');
  await shot(page, 'd-02-desk-save');
  await audit(page, '넓은 화면: 책상');
  await tap(page, T('desk-tab-shape'));
  await tap(page, T('desk-next'));
  const r1 = await throwOnce(page);
  expect('결과 화면: "이 비행기 넣어 두기"가 있다', (await attr(page, T('hangar-save'), 'data-state')) === 'new' && /이 비행기 넣어 두기/.test(await text(page, T('hangar-save-btn'))));
  await shot(page, 'd-03-result-save');
  await audit(page, '넓은 화면: 결과');
  await tap(page, T('hangar-save-btn'));
  await page.waitForSelector(T('name-dialog'));
  expect('결과 화면에서 넣기: 이름을 추천한다', (await page.$eval(T('name-input'), (el) => el.value)) === '복사지 글라이더 1호');
  await shot(page, 'd-04-name-dialog');
  await page.keyboard.press('Enter');
  await waitGone(page, T('name-dialog'));
  let st = await stored(page);
  expect('결과 화면에서 넣기: 글자판 Enter 로 넣어진다(방금 비행은 넣기 전이라 기록은 다음 비행부터)', st.planes.length === 1 && st.planes[0].name === '복사지 글라이더 1호' && st.planes[0].origin === 'preset:glider' && (await attr(page, T('hangar-save'), 'data-state')) === 'saved');
  await tap(page, T('throw-again'));
  const r2 = await throwOnce(page);
  st = await stored(page);
  expect('넣은 뒤 다시 던지면 기록이 적힌다', st.planes[0].flights === 1 && Math.abs(st.planes[0].best.distance.value - r2.distance) < 0.006, `${st.planes[0].best?.distance?.value} / ${r2.distance} (첫 비행 ${r1.distance})`);

  // 위쪽 막대로 격납고에 간다
  await seed(page, data.seeds.slice(0, 5));
  await tap(page, T('nav-hangar'));
  await page.waitForSelector(T('hangar'));
  await sleep(600);
  await settle(page);
  expect('넓은 화면: 여섯 대가 3D 선반에 놓인다', (await attr(page, T('hangar'), 'data-view')) === '3d' && (await stageInfo(page)).planes === 6);
  await canvasAlive(page, T('hangar-canvas'), '넓은 화면 격납고', 200);
  await shot(page, 'd-05-hangar');
  await audit(page, '넓은 화면: 격납고');
  // 마우스로 끌어 옮기고, 눌러 고른다
  const pan0 = (await stageInfo(page)).pan;
  await page.mouse.move(800, 420);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(800 - i * 30, 420); await sleep(20); }
  await page.mouse.up();
  await settle(page);
  const moved = (await stageInfo(page)).pan;
  expect('넓은 화면: 마우스로 끌어도 선반이 움직인다(움직일 수 있을 때)', moved >= pan0 && !(await exists(page, T('hangar-panel'))), `${pan0.toFixed(2)} -> ${moved.toFixed(2)}`);
  await pickSlot(page, 0);
  await sleep(1600);
  expect('넓은 화면: 고르면 판이 오른쪽에 뜬다', (await page.$eval(T('hangar-panel'), (el) => { const b = el.getBoundingClientRect(); return b.left > window.innerWidth / 2 && b.width < 460; })));
  await shot(page, 'd-06-selected');
  await audit(page, '넓은 화면: 고른 비행기');
  // 빈 곳을 누르면 제자리로
  await page.mouse.click(120, 700);
  expect('넓은 화면: 받침대 밖을 누르면 선반에 도로 놓는다', await waitGone(page, T('hangar-panel')));
  await tap(page, T('nav-back'));
  expect('넓은 화면: 돌아가기는 들어오기 전 화면(출발선)으로 간다', (await place(page)) === '출발선');

  // 코드로 꺼낸 비행기: 격납고에 넣기를 권한다
  await tap(page, T('nav-book'));
  await page.$eval(T('load-input'), (el) => el.scrollIntoView({ block: 'center' }));
  await page.click(T('load-input'));
  await page.keyboard.type(data.friendCode);
  await tap(page, T('load-code'));
  expect('코드로 꺼내기: 출발선으로 가고 "격납고에 넣기"를 권한다', (await place(page)) === '출발선' && /격납고에 넣어 둘까요/.test(await toastText(page)) && (await text(page, T('hangar-toast-action'))) === '격납고에 넣기', await toastText(page));
  // (이 검사 기계는 넓은 화면 갈무리가 느려서, 알림이 떠 있는 12초 안에 먼저 누르고 그다음에 찍는다)
  await tap(page, T('hangar-toast-action'));
  await page.waitForSelector(T('name-dialog'));
  await shot(page, 'd-07-code-offer');
  await audit(page, '넓은 화면: 코드로 꺼낸 뒤');
  expect('코드로 꺼낸 비행기: 이름을 추천한다(내 맘대로)', /켄트지 내 맘대로 1호/.test(await page.$eval(T('name-input'), (el) => el.value)), await page.$eval(T('name-input'), (el) => el.value));
  await tap(page, T('name-ok'));
  await waitGone(page, T('name-dialog'));
  st = await stored(page);
  expect('코드로 꺼낸 비행기: 격납고에 들어간다', st.planes.length === 7 && st.planes[6].paperId === 'kent160' && st.planes[6].origin === 'free');
  expect('스티커: 다섯 대 모으기를 받는다', await page.evaluate(() => { try { return JSON.parse(window.localStorage.getItem('pp.stickers.v1')).got.hangar5 > 0; } catch { return false; } }));
  closeOut('넓은 화면', log);
  await page.browserContext().close();
}

// ---------------------------------------------------------------------------
async function run() {
  const data = loadData();
  const preview = await startPreview();
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const flows = { main: mainFlow, seeds: seedsFlow, blocked: blockedFlow, corrupt: corruptFlow, nogl: noGlFlow, desktop: desktopFlow };
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
    if (notMine.size > 0) console.log(`\n(격납고 밖, 다른 작업 중인 조각에서 본 것 — 실패로 세지 않음)\n${[...notMine].map((x) => ` · ${x}`).join('\n')}`);
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
