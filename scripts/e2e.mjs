/**
 * 화면 전체 흐름 검사 (headless Chrome). 새 흐름: 대회장 -> 책상 -> 출발선 -> 비행 -> 결과 -> 기록장.
 *
 * 준비: npm run build (dist 가 있어야 한다)
 * 실행: node scripts/e2e.mjs            기본 빌드 검사
 *       node scripts/e2e.mjs --dev      개발 서버와 React StrictMode 검사
 *       node scripts/e2e.mjs --api      랭킹 서버가 연결된 빌드도 흉내 서버로 검사 (dist-api 를 새로 빌드한다)
 * 하나라도 실패하면 0 이 아닌 값으로 끝난다. 화면 갈무리는 screenshots/v2/ 에 저장한다.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(ROOT, 'screenshots', 'v2');
const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}/`;
const WITH_API = process.argv.includes('--api');
const DEV = process.argv.includes('--dev');
/** --aim : 출발선 조준 검사만 빨리 돌린다 */
const ONLY_AIM = process.argv.includes('--aim');
mkdirSync(SHOTS, { recursive: true });

/** 본 흐름(연구 노트 밖)에 나오면 안 되는 딱딱한 말 */
const FORBIDDEN = ['분석', '시뮬레이션', '파라미터', '프리셋'];

// ---------------------------------------------------------------------------
// 작은 도구들
// ---------------------------------------------------------------------------
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
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

/** vite preview 를 띄운다(이미 떠 있으면 그대로 쓴다). */
async function startPreview(port, outDir, dev = false) {
  const url = `http://127.0.0.1:${port}/`;
  if (await reachable(url)) return null;
  const child = spawn('npx', ['vite', ...(dev ? [] : ['preview', '--outDir', outDir]), '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT, stdio: 'ignore', detached: true,
  });
  for (let i = 0; i < 60; i++) {
    if (await reachable(url)) return child;
    await sleep(250);
  }
  throw new Error(`미리보기 서버가 뜨지 않았어요 (${url})`);
}
function stop(child) {
  if (!child) return;
  try { process.kill(-child.pid); } catch { /* 이미 끝남 */ }
}

/** core 로 직접 계산한 값(Node 에서 실행). */
function coreValues(code) {
  const r = spawnSync('npx', ['tsx', 'scripts/e2e-core.ts', code], { cwd: ROOT, encoding: 'utf8' });
  try {
    return JSON.parse(r.stdout.trim().split('\n').pop());
  } catch {
    return { ok: false, error: r.stderr };
  }
}

/** PNG 를 풀어서 서로 다른 색이 몇 가지인지 센다(3D 화면이 비어 있지 않은지 확인용). */
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
function watch(page, allowedOrigins, log) {
  page.on('console', (m) => { if (m.type() === 'error') log.consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => log.consoleErrors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => log.failed.push(`${r.url()} (${r.failure()?.errorText})`));
  page.on('response', (r) => { if (r.status() >= 400) log.failed.push(`${r.url()} -> ${r.status()}`); });
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('data:') || u.startsWith('blob:')) return;
    log.requests.push(u);
    if (!allowedOrigins.some((o) => u.startsWith(o))) log.external.push(u);
  });
}
const newLog = () => ({ consoleErrors: [], failed: [], requests: [], external: [] });

async function newPage(browser, log, { mobile = true, origins = [BASE], init, clipboard = true, dpr = 2 } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  if (clipboard) {
    // 클립보드 권한을 준다(실제 브라우저에서 사용자가 누른 것과 같은 조건을 만든다).
    const cdp = await browser.target().createCDPSession();
    await cdp.send('Browser.grantPermissions', {
      origin: origins[0].slice(0, -1), browserContextId: ctx.id, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    }).catch((e) => console.log('     (클립보드 권한을 주지 못했어요:', e.message, ')'));
    await cdp.detach().catch(() => {});
  }
  if (mobile) await page.setViewport({ width: 360, height: 740, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });
  else await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  if (init) await page.evaluateOnNewDocument(init);
  watch(page, origins, log);
  return page;
}

async function open(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(T('place'), { timeout: 15000 });
  await sleep(1200); // 체육관 장면과 글꼴이 자리를 잡을 때까지
}

/** 요소를 보이는 곳으로 옮긴 뒤 누른다(휴대전화는 손가락, 넓은 화면은 마우스). */
async function tap(page, selector) {
  await page.waitForSelector(selector, { timeout: 8000 });
  const box = await page.$eval(selector, (el) => {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (page.viewport()?.hasTouch) await page.touchscreen.tap(box.x, box.y);
  else await page.mouse.click(box.x, box.y);
  await sleep(140);
}
const text = (page, selector) => page.$eval(selector, (el) => (el.textContent ?? '').trim());
const exists = async (page, selector) => (await page.$(selector)) !== null;
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${name}.png`) });
const place = (page) => text(page, T('place'));
const hashCode = (page) => page.evaluate(() => window.location.hash.replace(/^#p/, ''));

/** 가로 넘침, 누르는 곳 크기, 금지어를 한꺼번에 본다. */
async function audit(page, label, { words = true } = {}) {
  const r = await page.evaluate(() => {
    const vw = window.innerWidth;
    const overflow = document.documentElement.scrollWidth - vw;
    const small = [];
    const clipped = [];
    for (const el of document.querySelectorAll('button, input, textarea, summary, [role="switch"], [role="radio"], [role="tab"]')) {
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      const name = (el.getAttribute('data-testid') || el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 24);
      if (b.height < 47.5 || b.width < 47.5) small.push(`${name} ${Math.round(b.width)}x${Math.round(b.height)}`);
      if (b.left < -0.5 || b.right > vw + 0.5) clipped.push(name);
      // 접기 판(.fb)의 켬 표시 딱지는 일부러 단추 밖으로 살짝 나와 있어서 넘침으로 세지 않는다(접기 판은 scripts/e2e-fold.mjs 가 따로 본다).
      if (el.tagName === 'BUTTON' && !el.closest('.fb') && el.scrollWidth > el.clientWidth + 1) clipped.push(`${name} (글자 넘침)`);
    }
    return { overflow, small, clipped, body: document.body.innerText };
  });
  expect(`[${label}] 가로로 넘치지 않는다`, r.overflow <= 0, `넘침 ${r.overflow}px`);
  expect(`[${label}] 누르는 곳이 모두 48px 이상`, r.small.length === 0, r.small.join(', '));
  expect(`[${label}] 화면 밖으로 나가거나 글자가 잘린 단추가 없다`, r.clipped.length === 0, r.clipped.join(', '));
  if (words) {
    const hit = FORBIDDEN.filter((w) => r.body.includes(w));
    expect(`[${label}] 딱딱한 말(${FORBIDDEN.join(', ')})이 없다`, hit.length === 0, hit.join(', '));
  }
}

/** 캔버스가 있는 자리를 찍어서 색이 충분히 여러 가지인지 본다(검은 화면, 빈 화면 방지). */
async function canvasAlive(page, selector, label, min = 40) {
  const ready = await page.$eval(selector, (el) => {
    const gl = el.getContext('webgl2');
    return !!gl && !gl.isContextLost() && !el.parentElement.querySelector('.preview3d__fallback');
  });
  expect(`[${label}] WebGL 문맥이 살아 있고 오류 안내가 없다`, ready);
  const box = await page.$eval(selector, (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
  const clip = { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.min(box.width, 360), height: Math.min(box.height, 420) };
  const png = await page.screenshot({ clip });
  const n = countColors(png);
  expect(`[${label}] 3D 화면이 비어 있지 않다`, n >= min, `색 ${n}가지`);
}

/** 접기 판: 종이 좌표(m) -> 화면 좌표 */
async function paperToClient(page, p) {
  return page.evaluate(({ x, y }) => {
    const svg = document.querySelector('[data-testid="fb-svg"]');
    const m = svg.getScreenCTM();
    const mx = x * 1000, my = -y * 1000;
    return { x: m.a * mx + m.c * my + m.e, y: m.b * mx + m.d * my + m.f };
  }, p);
}

async function touchDrag(page, a, b, midway) {
  await page.touchscreen.touchStart(a.x, a.y);
  const steps = 9;
  for (let i = 1; i <= steps; i++) {
    await page.touchscreen.touchMove(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
    await sleep(22);
  }
  await sleep(70);
  if (midway) await midway();
  await page.touchscreen.touchEnd();
  await sleep(160);
}

/** 접기 판에서 종이 위의 한 점을 잡아 다른 점으로 끈다. */
async function foldDrag(page, from, to) {
  await page.$eval(T('fb-svg'), (el) => el.scrollIntoView({ block: 'center' }));
  await sleep(120);
  await touchDrag(page, await paperToClient(page, from), await paperToClient(page, to));
}

/** 길잡이가 가리키는 "잡을 곳"과 "가져갈 곳"(종이 좌표 m) */
function readCue(page) {
  return page.evaluate(() => {
    const dot = document.querySelector('.fb-cue__dot');
    const dest = document.querySelector('.fb-cue__dest');
    if (!dot || !dest) return null;
    const pt = (el) => ({ x: Number(el.getAttribute('cx')) / 1000, y: -Number(el.getAttribute('cy')) / 1000 });
    return { grab: pt(dot), dest: pt(dest) };
  });
}

const guideProgress = async (page) => {
  if (await exists(page, T('guide-done'))) return 'done';
  return text(page, T('guide-progress'));
};

/** 결과 패널이 뜰 때까지 기다렸다가 숫자를 읽는다. */
async function waitResult(page) {
  await page.waitForSelector(T('result-panel'), { timeout: 40000 });
  await sleep(350);
  return {
    distance: await text(page, T('result-distance')),
    airtime: await text(page, T('result-airtime')),
    verdict: await page.$eval(T('result-line'), (el) => el.getAttribute('data-verdict')),
    line: await text(page, T('result-line')),
    grade: await page.$eval(T('stamp'), (el) => el.getAttribute('data-grade')).catch(() => null),
  };
}

// ---------------------------------------------------------------------------
// 1) 기본 흐름 (휴대전화 360 x 740, 손가락)
// ---------------------------------------------------------------------------
async function mainFlow(browser) {
  const log = newLog();
  const page = await newPage(browser, log);
  await open(page, BASE);

  // ---- 대회장 ----
  expect('처음 화면은 대회장이다', (await place(page)) === '대회장');
  expect('큰 단추 "비행기 접으러 가기"가 보인다', /비행기 접으러 가기/.test(await text(page, T('go-desk'))));
  expect('처음 온 사람에게 안내 말풍선이 보인다', await exists(page, T('hint')));
  expect('종목 두 가지를 고를 수 있다', (await exists(page, T('event-distance'))) && (await exists(page, T('event-airtime'))));
  expect('다섯 칸 단계 표시줄이 없다', !(await exists(page, '.stepbar')));
  await canvasAlive(page, T('gym-canvas'), '대회장', 120);
  await shot(page, '01-home');
  await audit(page, '대회장');
  await tap(page, T('event-airtime'));
  expect('종목을 바꿀 수 있다', (await page.$eval(T('event-airtime'), (el) => el.getAttribute('aria-checked'))) === 'true');
  await tap(page, T('event-distance'));

  // 소리 단추: 눌러서 끄고 켠다
  await tap(page, T('sound-toggle'));
  expect('소리를 끌 수 있다', /끔/.test(await text(page, T('sound-toggle'))));
  await tap(page, T('sound-toggle'));
  expect('소리를 다시 켤 수 있다', /켬/.test(await text(page, T('sound-toggle'))));

  // ---- 책상: 종이 (종이 종류가 겉모습을 정한다. 색은 따로 고르지 않는다) ----
  await tap(page, T('go-desk'));
  expect('책상으로 간다', (await place(page)) === '책상');
  expect('색을 고르는 곳이 없다', !(await exists(page, '[data-testid^="color-"]')) && !(await exists(page, '.swatch')) && !/색 고르기/.test(await text(page, '.desk')));
  const swatches = await page.$$eval('.papercard .paperswatch image', (els) => els.map((el) => (el.getAttribute('href') || '').slice(0, 22)));
  expect('종이 카드 여섯 장에 실제 무늬로 그린 종이 그림이 있다', (await page.$$('.papercard')).length === 6 && swatches.length >= 12 && swatches.every((h) => h.startsWith('data:image/')), `${swatches.length}장`);
  await tap(page, T('paper-copy60'));
  expect('종이 종류를 고를 수 있다', (await page.$eval(T('paper-copy60'), (el) => el.getAttribute('aria-checked'))) === 'true');
  await sleep(300);
  await canvasAlive(page, T('preview-canvas'), '책상 미리보기', 12);
  // 신문지를 누르면 미리보기의 비행기가 바로 신문지가 된다(글줄과 사진 때문에 색이 훨씬 다양해진다).
  const colorsOf = async (sel) => { const b = await rectOf(page, sel); return countColors(await page.screenshot({ clip: { x: b.x, y: b.y, width: b.w, height: b.h } })); };
  const plainColors = await colorsOf(T('preview-canvas'));
  await tap(page, T('paper-newsprint'));
  await sleep(900);
  const newsColors = await colorsOf(T('preview-canvas'));
  expect('신문지를 누르면 비행기가 바로 신문지로 바뀐다', (await page.$eval(T('paper-newsprint'), (el) => el.getAttribute('aria-checked'))) === 'true' && newsColors > plainColors * 1.3, `색 ${plainColors} -> ${newsColors}가지`);
  expect('균형 저울이 보인다', (await text(page, T('balance-label'))).length > 0);
  await page.$eval('.desk__body', (el) => { el.scrollTop = 0; });
  await shot(page, '02-desk-paper');
  await audit(page, '책상: 종이');
  // 크게 살펴보기: 보는 방향 단추, 균형 저울, 한 줄 예보
  await tap(page, T('plane-inspect-open'));
  await page.waitForSelector(`.inspect__stage ${T('preview-canvas')}`, { timeout: 8000 });
  await sleep(700);
  await canvasAlive(page, `.inspect__stage ${T('preview-canvas')}`, '살펴보기', 30);
  expect('살펴보기의 비행기는 크다(세로 230px 이상)', (await rectOf(page, `.inspect__stage ${T('preview-canvas')}`)).h >= 230);
  for (const v of ['top', 'side', 'front', 'hero']) await tap(page, T(`view-${v}`));
  expect('살펴보기: 보는 방향을 바꿀 수 있고 균형과 예보가 함께 보인다', (await page.$eval(T('view-hero'), (el) => el.getAttribute('aria-pressed'))) === 'true' && (await exists(page, `${T('plane-inspect')} ${T('balance')}`)) && (await text(page, T('inspect-forecast'))).length > 0);
  expect('살펴보기가 열린 동안 입체 그림은 하나만 그린다', (await page.$$('.preview3d__canvas')).length === 1);
  await shot(page, '02-desk-inspect');
  await audit(page, '살펴보기');
  await tap(page, T('plane-inspect-close'));
  expect('살펴보기를 닫으면 미리보기가 제자리로 돌아온다', await exists(page, `.desk__preview ${T('preview-canvas')}`));
  await tap(page, T('paper-copy80'));

  // ---- 책상: 따라 접기 (끝까지 손으로) ----
  await tap(page, T('desk-next'));
  expect('접는 법 카드 다섯 장이 보인다', (await page.$$('.foldcard')).length === 5);
  await shot(page, '03-fold-pick');
  await audit(page, '책상: 접는 법 고르기');
  await tap(page, T('fold-dart'));
  await page.waitForSelector(T('fb-svg'), { timeout: 8000 });
  expect('접기 판이 길잡이와 함께 열린다', (await guideProgress(page)).startsWith('0 /'));
  await sleep(400);
  // 좁은 화면: 종이는 가로를 모두 쓰고, 접기 도구는 하단에 고정한다. 입체 보기는 따로 연다.
  const foldLayout = await page.evaluate(() => {
    const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { w: b.width, h: b.height, top: b.top, bottom: b.bottom }; };
    return { aside: r('[data-testid="fb-aside"]'), history: r('[data-testid="fb-history"]'), svg: r('[data-testid="fb-svg"]'), cta: r('[data-testid="desk-next"]'), height: window.innerHeight, uses: document.querySelectorAll('.fb-ply use').length, plies: document.querySelectorAll('.fb-ply').length };
  });
  expect('모바일 접기 판이 옆 미리보기 없이 가로를 모두 쓴다', !foldLayout.aside && !!foldLayout.svg && foldLayout.svg.w >= 300 && foldLayout.svg.h >= 210, JSON.stringify(foldLayout.svg));
  expect('접기 판 전체가 되돌리기 도구에 가리지 않는다', !!foldLayout.svg && !!foldLayout.history && foldLayout.svg.bottom <= foldLayout.history.top + 1, `${foldLayout.svg?.bottom} / ${foldLayout.history?.top}`);
  expect('접기 도구와 다음 단추가 화면 안에 함께 보인다', !!foldLayout.history && !!foldLayout.cta && foldLayout.history.bottom <= foldLayout.cta.top && foldLayout.cta.bottom <= foldLayout.height, JSON.stringify(foldLayout.history));
  expect('접기 판의 종이에 무늬가 붙어 있다(겹마다 하나)', foldLayout.plies >= 1 && foldLayout.uses === foldLayout.plies, `${foldLayout.uses} / ${foldLayout.plies}`);
  await tap(page, T('plane-inspect-open'));
  await sleep(700);
  await canvasAlive(page, `.inspect__stage ${T('preview-canvas')}`, '접는 동안 크게 살펴보기', 12);
  await tap(page, T('plane-inspect-close'));
  expect('살펴보기를 닫아도 접기 단계와 하단 도구가 유지된다', (await guideProgress(page)).startsWith('0 /') && await exists(page, `.desk__foldtools ${T('fb-history')}`));
  await shot(page, '04-fold-guide');
  await audit(page, '책상: 따라 접기');
  let byHand = 0, skipped = 0;
  for (let i = 0; i < 12; i++) {
    const before = await guideProgress(page);
    if (before === 'done') break;
    const cue = await readCue(page);
    if (cue) {
      await page.$eval(T('fb-svg'), (el) => el.scrollIntoView({ block: 'center' }));
      await sleep(120);
      const a = await paperToClient(page, cue.grab);
      const b = await paperToClient(page, cue.dest);
      await touchDrag(page, a, b, i === 0 ? () => shot(page, '05-fold-dragging') : undefined);
      await sleep(350);
    }
    const after = await guideProgress(page);
    if (after !== before) { byHand++; continue; }
    // 손으로 못 맞췄으면 접기 판의 "건너뛰기"로 그 단계를 대신 접는다.
    await tap(page, T('fb-skip'));
    await sleep(300);
    skipped++;
  }
  expect('길잡이를 따라 끝까지 접으면 "다 접었어요"가 나온다', (await guideProgress(page)) === 'done', `손으로 ${byHand}번, 건너뛰기 ${skipped}번`);
  expect('길잡이 접기는 손으로 끌어서 된다', byHand >= 1, `손으로 ${byHand}번`);
  const guidedCode = (await sleep(500), await hashCode(page));
  const guidedCore = coreValues(guidedCode);
  expect('끝까지 따라 접은 비행기는 접는 법 그대로다(4번 접기)', guidedCore.ok && guidedCore.folds === 4, JSON.stringify(guidedCore.folds));
  // 다 접으면 납작한 종이가 비행기로 펴지는 연출 뒤에 큰 입체 비행기가 남는다.
  await sleep(2600);
  await canvasAlive(page, `${T('guide-done')} ${T('preview-canvas')}`, '다 접은 비행기', 20);
  expect('다 접은 비행기가 크게 보인다', (await rectOf(page, `${T('guide-done')} ${T('preview-canvas')}`)).h >= 180);
  await shot(page, '06-fold-done');
  await audit(page, '책상: 다 접음');

  // 조금 바꾸기
  await tap(page, T('tweak-open'));
  expect('"조금 바꾸기"에 조절 막대가 있다', await exists(page, T('tweak-noseFolds')));

  // ---- 한 번에 접기 ----
  await tap(page, T('guide-other'));
  await tap(page, T('fold-glider'));
  await page.waitForSelector(T('guide-instant'), { timeout: 8000 });
  await tap(page, T('guide-instant'));
  expect('"한 번에 접기"로 바로 다 접힌다', (await guideProgress(page)) === 'done');
  await sleep(500);
  const gliderCore = coreValues(await hashCode(page));
  expect('한 번에 접은 글라이더는 6번 접은 비행기다', gliderCore.ok && gliderCore.folds === 6, String(gliderCore.folds));
  // 다시 화살로
  await tap(page, T('guide-other'));
  await tap(page, T('fold-dart'));
  await tap(page, T('guide-instant'));

  // ---- 책상: 날개 다듬기 ----
  await tap(page, T('desk-next'));
  expect('날개 다듬기에 앞, 옆 그림이 있다', (await page.$$('.shapeview')).length === 2);
  const before = await hashCode(page);
  await page.$eval(T('sh-dihedralDeg'), (el) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, '14');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // 주소의 코드는 잠잠해진 뒤에 바뀐다. 방금 시작한 "펴지는 연출"이 느린 렌더러에서 도는 중일 수 있으므로 넉넉히 기다린다.
  for (let i = 0; i < 25 && (await hashCode(page)) === before; i++) await sleep(100);
  await sleep(300);
  expect('날개 들기를 바꾸면 비행기가 달라진다', (await hashCode(page)) !== before);
  await page.$eval('.desk__body', (el) => { el.scrollTop = 0; });
  await shot(page, '07-shape');
  await audit(page, '책상: 날개 다듬기');
  const withoutClipCode = await hashCode(page);
  await tap(page, T('clip-toggle'));
  expect('클립을 끼우면 자리 조절 막대가 나온다', await exists(page, T('clip-pos')));
  await tap(page, T('clip-toggle'));
  // 공유 주소는 지연 갱신된다. 고정 시간 대신 클립을 뺀 설계가 주소에도 반영되기를 기다린다.
  await page.waitForFunction((code) => window.location.hash === `#p${code}`, { timeout: 15000 }, withoutClipCode);

  // ---- 연구 노트: 숫자가 core 값과 같다 ----
  const deskCode = await hashCode(page);
  const core = coreValues(deskCode);
  await tap(page, T('open-notebook'));
  await page.waitForSelector(T('notebook'), { timeout: 8000 });
  const nb = async (id) => text(page, `${T(`nb-${id}`)} td b`);
  expect('연구 노트: 무게가 core 값과 같다', (await nb('mass')) === core.mass, `${await nb('mass')} / ${core.mass}`);
  expect('연구 노트: 날개 면적이 core 값과 같다', (await nb('wing-area')) === core.wingArea, `${await nb('wing-area')} / ${core.wingArea}`);
  expect('연구 노트: 날개 폭이 core 값과 같다', (await nb('span')) === core.span, `${await nb('span')} / ${core.span}`);
  expect('연구 노트: 가로세로비가 core 값과 같다', (await nb('aspect')) === core.aspect, `${await nb('aspect')} / ${core.aspect}`);
  expect('연구 노트: 활공 속도가 core 값과 같다', (await nb('trim-speed')) === core.trimSpeed, `${await nb('trim-speed')} / ${core.trimSpeed}`);
  expect('연구 노트: 활공비가 core 값과 같다', (await nb('glide-ratio')) === core.glideRatio, `${await nb('glide-ratio')} / ${core.glideRatio}`);
  expect('연구 노트: 정적 여유가 core 값과 같다', (await nb('static-margin')) === core.staticMargin, `${await nb('static-margin')} / ${core.staticMargin}`);
  expect('연구 노트: 정확한 값과 모형 추정값을 나눠 적는다', (await exists(page, T('table-exact'))) && (await exists(page, T('table-model'))) && /정확한 값/.test(await text(page, T('notebook'))) && /모형 추정값/.test(await text(page, T('notebook'))));
  expect('연구 노트: 그래프 네 장이 있다', (await page.$$('.charts .chart svg')).length === 4);
  await shot(page, '08-notebook');
  await page.$eval('.dialog__body', (el) => { el.scrollTop = 1500; });
  await sleep(200);
  await shot(page, '08-notebook-b');
  await audit(page, '연구 노트', { words: false });
  await tap(page, T('notebook-close'));

  // ---- 출발선: 위아래로 끌어 각도를 맞추고, 던지기 단추를 꾹 눌렀다 놓는다 ----
  // (조준 조작의 자세한 검사는 aimFlow 가 한다)
  await tap(page, T('desk-next'));
  expect('출발선으로 간다', (await place(page)) === '출발선');
  await sleep(1600);
  await canvasAlive(page, T('gym-canvas'), '출발선', 120);
  expect('조준 눈금(각도)과 힘 막대가 보인다', (await exists(page, T('aim-hud'))) && (await exists(page, T('power-gauge'))) && (await exists(page, T('angle-stepper'))));
  await shot(page, '09-aim');
  await audit(page, '출발선');
  expect('세밀 조정(숫자 막대, 좌우 기울이기)이 없다', !(await exists(page, T('fine-open'))) && !(await exists(page, T('throw-speed'))) && !(await exists(page, T('throw-pitch'))) && !(await exists(page, T('throw-roll'))) && !/세밀 조정|기울이/.test(await text(page, '.throw')));

  const scene = await page.$eval(T('throw-scene'), (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const pitchBefore = await page.$eval(T('angle-readout'), (el) => Number(el.getAttribute('data-pitch')));
  const from = { x: scene.x + scene.w * 0.4, y: scene.y + scene.h * 0.6 };
  await touchDrag(page, from, { x: from.x, y: from.y - 30 }, () => shot(page, '10-aim-drag'));
  const pitchAfter = await page.$eval(T('angle-readout'), (el) => Number(el.getAttribute('data-pitch')));
  expect('장면을 위로 끌면 각도가 올라간다(30px 에 9도)', pitchAfter === pitchBefore + 9, `${pitchBefore} -> ${pitchAfter}`);
  const throwBtn = await page.$eval(T('throw-btn'), (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.touchscreen.touchStart(throwBtn.x, throwBtn.y);
  await sleep(750);
  await shot(page, '10-aim-charge');
  await page.touchscreen.touchEnd();
  await sleep(160);
  // 날아가는 동안 몇 장 찍는다
  await sleep(700);
  await shot(page, '11-flight-a');
  await canvasAlive(page, T('gym-canvas'), '비행 중', 120);
  await sleep(700);
  await shot(page, '11-flight-b');
  await page.waitForSelector(`${T('scorecard')}.is-in`, { timeout: 30000 });
  await sleep(250);
  await shot(page, '12-tape');
  await page.waitForSelector(T('stamp'), { timeout: 30000 });
  await sleep(450);
  await shot(page, '13-stamp');
  const first = await waitResult(page);
  await shot(page, '14-result');
  const thrownCode = await hashCode(page);
  const thrownCore = coreValues(thrownCode);
  expect('각도를 맞추고 꾹 눌러 던지면 결과가 나온다', /^\d+\.\d\d$/.test(first.distance) && /^\d+\.\d\d$/.test(first.airtime), JSON.stringify(first));
  expect('결과의 거리와 시간이 core 값과 같다', first.distance === thrownCore.distance && first.airtime === thrownCore.airtime, `${first.distance}/${thrownCore.distance}, ${first.airtime}/${thrownCore.airtime}`);
  expect('도장이 찍힌다', ['great', 'good', 'again'].includes(first.grade), String(first.grade));
  expect('첫 기록에는 신기록 리본이 붙는다', await exists(page, T('ribbon')));
  expect('새 스티커(처음 던지기)를 알려 준다', await exists(page, T('new-sticker-first')));
  expect('한 줄 평은 아이 말투다', /요[.!]$/.test(first.line), first.line);
  await audit(page, '결과');
  await tap(page, T('why-open'));
  const why = await text(page, T('why-diagnosis'));
  expect('"왜 이렇게 날았을까?"가 쉬운 말로 풀어 준다', why.length > 8 && !/받음각|실속|양력|무게중심|기수|상반각|뒷전/.test(why), why);
  await shot(page, '15-why');
  // 연구 노트에는 원래 문장이 그대로 있다
  await tap(page, T('why-notebook'));
  await page.waitForSelector(T('nb-diagnosis'), { timeout: 8000 });
  expect('연구 노트에 원래 진단 문장이 그대로 있다', (await text(page, T('nb-diagnosis'))) === thrownCore.diagnosis, await text(page, T('nb-diagnosis')));
  expect('연구 노트의 비행 거리가 core 값과 같다', (await nb('f-distance')) === thrownCore.distance);
  await tap(page, T('notebook-close'));

  // ---- 다시 던지기: 이번에는 단추를 톡(지난번 힘 그대로) ----
  await tap(page, T('throw-again'));
  await page.waitForSelector(T('throw-btn'), { timeout: 8000 });
  await sleep(900);
  expect('다시 던질 때 맞춰 둔 각도가 그대로다', (await page.$eval(T('angle-readout'), (el) => Number(el.getAttribute('data-pitch')))) === pitchAfter);
  await tapThrow(page);
  await sleep(900);
  await tap(page, T('skip'));
  const second = await waitResult(page);
  expect('단추를 톡 누르면 지난번 힘 그대로 던져서 같은 결과가 나온다', second.distance === first.distance && second.airtime === first.airtime, `${second.distance} / ${first.distance}`);
  expect('건너뛰어도 도장이 보인다', await exists(page, T('stamp')));

  // ---- 자랑하기: 코드 복사 ----
  await tap(page, T('brag'));
  await page.waitForSelector(T('share-dialog'), { timeout: 8000 });
  const shareCode = await page.$eval(T('share-code'), (el) => el.value);
  expect('내 비행기 코드는 영문자와 숫자뿐이다', /^[0-9A-Za-z]+$/.test(shareCode), shareCode.slice(0, 30));
  expect('주소의 코드와 같다', shareCode === thrownCode);
  await tap(page, T('copy-code'));
  await sleep(400);
  // "복사했어요"는 클립보드 쓰기가 성공했을 때만 나온다. 읽을 수 있는 환경이면 내용까지 견준다.
  expect('코드 복사하기가 성공했다고 알려 준다', /복사했어요/.test(await text(page, T('copy-msg'))), await text(page, T('copy-msg')));
  await page.bringToFront();
  const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  if (copied === null) console.log('     (이 환경에서는 클립보드를 읽을 수 없어 내용 비교는 건너뜀)');
  else expect('클립보드에 든 것이 내 비행기 코드다', copied === shareCode, copied.slice(0, 30));
  expect('랭킹이 연결되지 않은 빌드에는 랭킹 올리기가 없다', !(await exists(page, T('rank-form'))));
  await shot(page, '16-share');
  await audit(page, '자랑하기');
  await tap(page, T('share-dialog-close'));

  // ---- 기록장 ----
  await tap(page, T('nav-book'));
  expect('기록장으로 간다', (await place(page)) === '기록장');
  expect('최고 기록이 적혀 있다', (await text(page, T('best-distance'))).includes(first.distance));
  expect('최근 비행이 두 번 적혀 있다', (await page.$$('.recent__item')).length === 2);
  expect('스티커판에 열다섯 칸이 있고 "처음 던지기"를 받았다', (await page.$$('.stickerboard .sticker')).length === 15 && (await page.$eval(T('sticker-first'), (el) => el.getAttribute('data-got'))) === 'true' && Number((await text(page, T('sticker-count'))).split('/')[0]) >= 1, await text(page, T('sticker-count')));
  expect('랭킹은 숨겨져 있다', !(await exists(page, T('ranking'))));
  await shot(page, '17-book');
  await page.$eval('.book', (el) => { el.scrollTop = 520; });
  await sleep(200);
  await shot(page, '17-book-b');
  await audit(page, '기록장');
  // 잘못된 코드
  await page.$eval(T('load-input'), (el) => el.scrollIntoView({ block: 'center' }));
  await page.type(T('load-input'), 'zzzz-not-a-code');
  await tap(page, T('load-code'));
  expect('잘못된 코드는 무엇을 하면 되는지 알려 준다', /맞지 않아요/.test(await text(page, T('load-msg'))));
  // 최근 비행 꺼내기
  await tap(page, T('recent-load-0'));
  expect('기록에서 비행기를 꺼내면 출발선으로 간다', (await place(page)) === '출발선');
  await sleep(500);
  expect('꺼낸 비행기의 코드가 그대로다', (await hashCode(page)) === thrownCode);

  // ---- 대회장으로 돌아가면 최고 기록이 보인다 ----
  await tap(page, T('nav-home'));
  expect('대회장에 최고 기록이 보인다', (await text(page, T('home-best-distance'))).includes(first.distance));
  expect('접어 둔 비행기를 바로 던질 수 있다', await exists(page, T('go-throw')));
  await sleep(800);
  await shot(page, '18-home-return');
  await audit(page, '대회장(다시)');

  // ---- 내 맘대로 접기 ----
  await tap(page, T('go-desk'));
  await tap(page, T('desk-tab-fold'));
  await tap(page, T('mode-free'));
  await page.waitForSelector(T('fb-svg'), { timeout: 8000 });
  if (await exists(page, T('fb-reset'))) {
    const disabled = await page.$eval(T('fb-reset'), (el) => el.disabled);
    if (!disabled) { await tap(page, T('fb-reset')); await tap(page, T('fb-reset-yes')); }
  }
  await sleep(300);
  const count0 = await text(page, T('fb-count'));
  // 왼쪽 위 모서리를 잡아 가운데 선으로
  await foldDrag(page, { x: -0.105 + 0.003, y: 0.1485 - 0.004 }, { x: 0.003, y: 0.1485 - 0.102 });
  await sleep(400);
  const count1 = await text(page, T('fb-count'));
  expect('내 맘대로 접기: 모서리를 끌면 접힌다', count1 !== count0, `${count0} -> ${count1}`);
  await sleep(500);
  const freeCore = coreValues(await hashCode(page));
  expect('내 맘대로 접은 것이 비행기에 반영된다', freeCore.ok && freeCore.folds >= 1, String(freeCore.folds));
  await page.$eval(T('fb-svg'), (el) => el.scrollIntoView({ block: 'center' }));
  await shot(page, '19-free-fold');
  await audit(page, '책상: 내 맘대로 접기');
  // "다 접었어요": 납작한 종이가 비행기로 펴지고, "더 접기"로 돌아올 수 있다.
  await tap(page, T('free-done'));
  await page.waitForSelector(T('free-done-card'), { timeout: 8000 });
  await sleep(2600);
  await canvasAlive(page, `${T('free-done-card')} ${T('preview-canvas')}`, '내 맘대로 접은 비행기', 12);
  await shot(page, '19-free-done');
  await audit(page, '책상: 내 맘대로 다 접음');
  await tap(page, T('free-more'));
  expect('"더 접기"를 누르면 접기 판으로 돌아온다', await exists(page, T('fb-svg')));
  await tap(page, T('fb-undo'));
  await sleep(300);
  expect('되돌리기가 된다', (await text(page, T('fb-count'))) === count0);

  // ---- 숨은 디버그 패널 ----
  await tap(page, T('nav-home'));
  for (let i = 0; i < 5; i++) await tap(page, T('version'));
  expect('버전 글자를 다섯 번 누르면 디버그 패널이 열린다', await exists(page, T('debug-panel')));

  expect('콘솔 오류가 없다', log.consoleErrors.length === 0, log.consoleErrors.slice(0, 3).join(' | '));
  expect('실패한 요청이 없다', log.failed.length === 0, log.failed.slice(0, 3).join(' | '));
  expect('외부 요청이 0건이다', log.external.length === 0, log.external.slice(0, 3).join(', '));
  await page.close();
  return { code: thrownCode, first };
}

// ---------------------------------------------------------------------------
// 1-2) 출발선 조준: 각도(끌기, 단추)와 힘(꾹 눌러 모으기)을 진짜 손가락 입력(CDP 터치)으로 본다
// ---------------------------------------------------------------------------
/**
 * 조준의 규칙은 화면과 같은 상수에서 가져온다(scripts/e2e-aim-data.ts 가 src/app/lib/power.ts, aimMath.ts, core 의 LIMITS 를 찍어 준다).
 * 던지기 한도나 힘 막대의 모양이 바뀌어도 여기 숫자를 고칠 필요가 없다.
 */
const AIM = (() => {
  const r = spawnSync('npx', ['tsx', 'scripts/e2e-aim-data.ts'], { cwd: ROOT, encoding: 'utf8' });
  try {
    return JSON.parse(r.stdout.trim().split('\n').pop());
  } catch {
    throw new Error(`조준 규칙을 읽지 못했어요: ${r.stderr}`);
  }
})();
const gaugeToSpeed = (g) => Math.round((AIM.speedMin + (AIM.speedMax - AIM.speedMin) * Math.pow(Math.min(1, Math.max(0, g)), AIM.ease)) * 10) / 10;
/** 빠르기 -> 아이 말(살살 / 보통 / 세게). 경계는 화면과 같은 값이다. */
const wordOfSpeed = (v) => (Math.round(v * 10) / 10 < AIM.softEndMps ? AIM.words.soft : Math.round(v * 10) / 10 < AIM.hardStartMps ? AIM.words.mid : AIM.words.hard);

/** CDP 로 손가락 하나를 흉내 낸다(스크롤, 몸짓 판정까지 브라우저가 실제로 한다). */
async function finger(page) {
  const cdp = await page.createCDPSession();
  const send = (type, pt) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pt ? [{ x: Math.round(pt.x * 10) / 10, y: Math.round(pt.y * 10) / 10, id: 1, radiusX: 8, radiusY: 8, force: 1 }] : [] });
  let at = null;
  return {
    down: async (pt) => { at = pt; await send('touchStart', pt); },
    /** stepPx 씩 나눠 움직인다 */
    move: async (pt, stepPx = 8, pause = 8) => {
      const n = Math.max(1, Math.ceil(Math.hypot(pt.x - at.x, pt.y - at.y) / stepPx));
      const from = at;
      for (let i = 1; i <= n; i++) {
        at = { x: from.x + ((pt.x - from.x) * i) / n, y: from.y + ((pt.y - from.y) * i) / n };
        await send('touchMove', at);
        if (pause) await sleep(pause);
      }
    },
    up: async () => { await send('touchEnd', null); at = null; },
    cancel: async () => { await send('touchCancel', null); at = null; },
  };
}

const rectOf = (page, selector) => page.$eval(selector, (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; });
const pitchOf = (page) => page.$eval(T('angle-readout'), (el) => Number(el.getAttribute('data-pitch')));
const speedOf = (page) => page.$eval(T('power-gauge'), (el) => Number(el.getAttribute('data-speed')));
const scrollOf = (page) => page.evaluate(() => ({
  doc: document.scrollingElement.scrollTop, win: window.scrollY, body: document.body.scrollTop,
  sheet: document.querySelector('.throw__sheet')?.scrollTop ?? 0,
}));
const AIM_SHOTS = join(ROOT, 'screenshots', 'v3-aim');
const aimShot = (page, name) => page.screenshot({ path: join(AIM_SHOTS, `${name}.png`) });

/**
 * 던지기 단추를 "톡" 누른다(지난번 힘 그대로 던지기).
 * 단추는 0.18초보다 짧게 눌러야 톡으로 본다. 시험 기기는 3D 를 소프트웨어로 그려 한 화면에 0.1~0.4초가 걸리고,
 * 누름과 뗌을 차례로 보내면 그 사이에 화면 한 장이 끼어 "꾹"이 되어 버린다. 그래서 두 신호를 기다리지 않고 잇달아 보낸다
 * (진짜 손가락의 톡은 기기가 시각을 적어 주므로 화면이 느려도 톡으로 읽힌다).
 */
async function tapThrow(page) {
  await page.waitForSelector(T('throw-btn'), { timeout: 8000 });
  const c = await page.$eval(T('throw-btn'), (el) => {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (!page.viewport()?.hasTouch) { await page.mouse.click(c.x, c.y); await sleep(140); return; }
  const cdp = await page.createCDPSession();
  await Promise.all([
    cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y, id: 7 }] }),
    cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
  ]);
  await cdp.detach().catch(() => {});
  await sleep(140);
}

/** 날아가는 중이면 건너뛰고 결과를 읽는다(연출이 이미 끝났으면 그대로 읽는다). */
async function finishFlight(page, wait = 600) {
  await sleep(wait);
  const b = await page.$(T('skip'));
  if (b) await b.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }).then((c) => page.touchscreen.tap(c.x, c.y)).catch(() => {});
  return waitResult(page);
}
/** 던지기가 시작됐는지(조준 판이 사라졌는지) */
const thrown = (page) => page.waitForFunction(() => !document.querySelector('.throw--aim'), { timeout: 4000 }).then(() => true, () => false);

/** 대회장에서 출발선까지 빠르게 간다(삼각 날개를 한 번에 접는다). */
async function quickToThrow(page) {
  await tap(page, T('go-desk'));
  await tap(page, T('desk-next'));
  await tap(page, T('fold-delta'));
  await page.waitForSelector(T('fb-svg'), { timeout: 8000 });
  await page.waitForSelector(T('guide-instant'), { timeout: 8000 });
  await tap(page, T('guide-instant'));
  await tap(page, T('desk-next'));
  await tap(page, T('desk-next'));
  await page.waitForSelector(T('throw-btn'), { timeout: 8000 });
  await sleep(1500);
}

async function aimFlow(browser) {
  mkdirSync(AIM_SHOTS, { recursive: true });
  const log = newLog();
  const page = await newPage(browser, log);
  await open(page, BASE);
  await quickToThrow(page);
  expect('조준: 출발선이다', (await place(page)) === '출발선');
  const f = await finger(page);

  // ---- 처음 화면 ----
  expect('조준: 각도 부채와 화살표가 보인다', await exists(page, T('aim-hud')));
  expect('조준: 고무줄(당겨 쏘기) 그림이 없다', !(await exists(page, '.aimhud__band')) && !(await exists(page, '.aimhud__grip')) && !(await exists(page, '.aimhud__bar')));
  expect('조준: 위로/아래로 단추와 각도 표시가 늘 보인다(접혀 있지 않다)', await page.evaluate(() => {
    const vis = (id) => { const el = document.querySelector(`[data-testid="${id}"]`); if (!el || el.closest('details')) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    return vis('angle-up') && vis('angle-down') && vis('angle-readout');
  }));
  expect('조준: 힘 막대가 던지기 단추 바로 위에 있다', await page.evaluate(() => {
    const g = document.querySelector('[data-testid="power-gauge"]').getBoundingClientRect();
    const b = document.querySelector('[data-testid="throw-btn"]').getBoundingClientRect();
    return g.bottom <= b.top + 1 && b.top - g.bottom < 24 && !document.querySelector('[data-testid="throw-scene"] [data-testid="power-gauge"]');
  }));
  expect('조준: 세밀 조정 칸이 없다', !(await exists(page, '.throw__fine')));
  const coach = await text(page, T('throw-coach')).catch(() => '');
  expect('조준: 처음에는 한 줄 안내와 손 그림이 보인다', coach === '위아래로 끌어서 각도를 맞추고, 던지기 단추를 꾹 눌렀다 놓아요' && (await exists(page, `${T('throw-coach')} .throw__coach-hand svg`)), coach);
  expect('조준: 기울이지 않았으면 기울임 딱지가 없다', !(await exists(page, T('tilt-flag'))));
  const word0 = await text(page, T('angle-word'));
  const p0 = await pitchOf(page);
  expect('조준: 각도를 쉬운 말과 숫자로 적는다', ['아래로', '똑바로', '살짝 위로', '위로', '하늘 높이'].includes(word0) && /\d+°$/.test(await text(page, T('angle-readout'))), await text(page, T('angle-readout')));
  await aimShot(page, '01-idle');
  await audit(page, '조준');
  const edge = await page.evaluate(() => {
    const vw = window.innerWidth;
    return [...document.querySelectorAll('.anglestep, [data-testid="power-gauge"], [data-testid="throw-btn"]')].map((el) => { const r = el.getBoundingClientRect(); return Math.min(r.left, vw - r.right); });
  });
  expect('조준: 조작하는 곳이 화면 양옆 16px 안쪽에 있다', edge.every((d) => d >= 15.5), edge.map((d) => d.toFixed(0)).join(', '));

  // 손가락이 움직일 때 브라우저 기본 동작(스크롤)을 막았는지 적어 둔다.
  await page.evaluate(() => {
    window.__tm = { n: 0, prevented: 0 };
    window.addEventListener('touchmove', (e) => { window.__tm.n++; if (e.defaultPrevented) window.__tm.prevented++; });
    window.__scrolls = 0;
    window.addEventListener('scroll', () => { window.__scrolls++; }, true);
  });

  // ---- 각도: 위로 120px 끌기 ----
  const scene = await rectOf(page, T('throw-scene'));
  const ax = scene.x + scene.w * 0.42, ay = scene.cy + 70;
  const s0 = await scrollOf(page);
  await f.down({ x: ax, y: ay });
  await f.move({ x: ax, y: ay - 60 });
  const mid = await pitchOf(page);
  await aimShot(page, '02-dragging');
  expect('조준: 끄는 동안 화살표가 바로 따라온다(60px 에 18도)', mid === p0 + 18, `${p0} -> ${mid}`);
  expect('조준: 끄는 동안 장면에 각도를 크게 적는다', (await exists(page, '.aimhud.is-aiming')) && (await text(page, T('aim-tag'))) === `${await text(page, T('angle-word'))} ${mid}°`);
  await f.move({ x: ax, y: ay - 120 });
  await f.up();
  await sleep(120);
  const p1 = await pitchOf(page);
  const s1 = await scrollOf(page);
  expect(`조준: 위로 120px 끌면 ${Math.round(120 * AIM.degPerPx)}도 올라간다`, p1 === Math.min(AIM.pitchMax, p0 + Math.round(120 * AIM.degPerPx)), `${p0}° -> ${p1}°`);
  expect('조준: 장면의 화살표와 옆의 숫자가 같다', (await page.$eval(T('aim-hud'), (el) => Number(el.getAttribute('data-pitch')))) === p1);
  expect('조준: 끄는 동안 화면이 스크롤되지 않는다', JSON.stringify(s0) === JSON.stringify(s1) && (await page.evaluate(() => window.__scrolls)) === 0, JSON.stringify(s1));
  const tm = await page.evaluate(() => window.__tm);
  expect('조준: 손가락 움직임을 브라우저 몸짓으로 넘기지 않는다(touchmove 막음)', tm.n > 5 && tm.prevented === tm.n, JSON.stringify(tm));

  // 옆으로 끄는 것은 각도를 바꾸지 않는다
  await f.down({ x: ax - 60, y: ay });
  await f.move({ x: ax + 60, y: ay + 3 });
  await f.up();
  expect('조준: 옆으로 끌면 각도가 바뀌지 않는다', (await pitchOf(page)) === p1, String(await pitchOf(page)));

  // 아래로 끌면 내려간다(손가락 자리가 아니라 끈 만큼)
  await f.down({ x: ax + 20, y: scene.y + 90 });
  await f.move({ x: ax + 20, y: scene.y + 90 + 50 });
  await f.up();
  expect('조준: 아래로 50px 끌면 15도 내려간다(어디서 시작하든)', (await pitchOf(page)) === p1 - 15, `${p1} -> ${await pitchOf(page)}`);

  // 끝까지: 위 끝, 아래 끝
  for (let i = 0; i < 2; i++) { await f.down({ x: ax, y: scene.y + scene.h - 40 }); await f.move({ x: ax, y: scene.y + 70 }, 12, 4); await f.up(); }
  expect(`조준: 위로 계속 끌면 ${AIM.pitchMax}도에서 멈춘다`, (await pitchOf(page)) === AIM.pitchMax, String(await pitchOf(page)));
  expect('조준: 위 끝에서는 "하늘 높이"라고 적는다', (await text(page, T('angle-word'))) === '하늘 높이');
  // 끝을 지나 더 끌었다가 되돌리면 바로 따라온다
  await f.down({ x: ax, y: scene.cy });
  await f.move({ x: ax, y: scene.cy - 60 });
  await f.move({ x: ax, y: scene.cy - 40 });
  const back = await pitchOf(page);
  await f.up();
  expect('조준: 끝을 지나쳤다가 되돌리면 바로 내려온다(20px 에 6도)', back === AIM.pitchMax - 6, String(back));
  for (let i = 0; i < 2; i++) { await f.down({ x: ax, y: scene.y + 70 }); await f.move({ x: ax, y: scene.y + scene.h - 40 }, 12, 4); await f.up(); }
  expect(`조준: 아래로 계속 끌면 ${AIM.pitchMin}도에서 멈춘다`, (await pitchOf(page)) === AIM.pitchMin, String(await pitchOf(page)));
  expect('조준: 아래 끝에서는 "아래로"라고 적는다', (await text(page, T('angle-word'))) === '아래로');
  expect('조준: 끝까지 끄는 동안에도 스크롤이 없다', JSON.stringify(await scrollOf(page)) === JSON.stringify(s0) && (await page.evaluate(() => window.__scrolls)) === 0);

  // 화면 가장자리(뒤로 가기 몸짓이 시작되는 곳)에서 시작한 끌기는 받지 않는다
  await f.down({ x: 6, y: scene.cy + 40 });
  await f.move({ x: 60, y: scene.cy - 60 });
  await f.up();
  expect('조준: 화면 가장자리 16px 안에서 시작한 끌기는 받지 않는다', (await pitchOf(page)) === AIM.pitchMin, String(await pitchOf(page)));

  // ---- 각도 단추 ----
  const up = await rectOf(page, T('angle-up'));
  const down = await rectOf(page, T('angle-down'));
  await page.touchscreen.tap(up.cx, up.cy);
  await sleep(120);
  expect('조준: "위로"를 한 번 누르면 1도 올라간다', (await pitchOf(page)) === AIM.pitchMin + 1, String(await pitchOf(page)));
  await page.touchscreen.tap(up.cx, up.cy);
  await page.touchscreen.tap(up.cx, up.cy);
  await sleep(120);
  await page.touchscreen.tap(down.cx, down.cy);
  await sleep(120);
  expect('조준: "아래로"를 한 번 누르면 1도 내려간다', (await pitchOf(page)) === AIM.pitchMin + 2, String(await pitchOf(page)));
  // 던질 각도를 정해 둔다: 끌어서 대충, 단추로 딱 맞게
  await f.down({ x: ax, y: scene.y + 80 });
  await f.move({ x: ax, y: scene.y + 80 + 150 });
  await f.up();
  while ((await pitchOf(page)) > 12) await page.touchscreen.tap(down.cx, down.cy);
  while ((await pitchOf(page)) < 12) await page.touchscreen.tap(up.cx, up.cy);
  await sleep(150);
  expect('조준: 끌기와 단추로 12도에 딱 맞출 수 있다', (await pitchOf(page)) === 12 && (await text(page, T('angle-readout'))) === '살짝 위로12°', await text(page, T('angle-readout')));

  // ---- 힘 막대를 직접 끌기 ----
  const track = await rectOf(page, T('power-track'));
  const gx = (g) => track.x + 16 + (track.w - 32) * g;
  const picks = [];
  await f.down({ x: gx(0.1), y: track.cy });
  for (const g of [0.25, 0.5, 0.75, 1]) {
    await f.move({ x: gx(g), y: track.cy });
    await sleep(60);
    picks.push([g, await speedOf(page)]);
  }
  await f.move({ x: gx(0.5), y: track.cy });
  await f.up();
  await sleep(100);
  // 끌어 놓은 자리의 빠르기가 규칙(눈금 -> 빠르기)과 같다. 손가락 자리는 1px 안팎으로 어긋날 수 있어 한 칸(0.1 m/s)을 봐 준다.
  expect('조준: 힘 막대를 끌어서 힘을 정할 수 있다', picks.every(([g, s]) => Math.abs(s - gaugeToSpeed(g)) <= 0.15), picks.map(([g, s]) => `${g}->${s} (규칙 ${gaugeToSpeed(g)})`).join(', '));
  expect('조준: 막대 맨 끝은 던질 수 있는 가장 센 힘이다', picks[picks.length - 1][1] === AIM.speedMax, `${picks[picks.length - 1][1]} / ${AIM.speedMax} m/s`);
  const midSpeed = await speedOf(page);
  // 막대 가운데 = 보통 던지기(power.ts 의 ORDINARY_THROW_MPS). 처음 던질 때의 힘도 이 값이다.
  expect(`조준: 막대 가운데는 알맞은 힘(보통 던지기 ${AIM.ordinary} m/s)이다`, Math.abs(midSpeed - AIM.ordinary) <= 0.15 && AIM.ordinary >= 5.5 && AIM.ordinary <= 6.5 && AIM.defaultSpeed === gaugeToSpeed(0.5), `${midSpeed} m/s (보통 ${AIM.ordinary}, 처음 값 ${AIM.defaultSpeed})`);
  expect('조준: 힘을 쉬운 말로 적는다', (await text(page, T('power-word'))) === wordOfSpeed(midSpeed) && wordOfSpeed(midSpeed) === AIM.words.mid, await text(page, T('power-word')));
  // 막대의 색 띠(살살 / 보통 / 세게)가 말이 바뀌는 눈금과 같은 자리에서 나뉜다.
  const zoneCss = await page.$eval(T('power-gauge'), (el) => [el.style.getPropertyValue('--z1'), el.style.getPropertyValue('--z2')].map(Number));
  expect('조준: 막대의 색 띠가 세 구역의 경계와 같다', zoneCss[0] === AIM.zoneSoftEnd && zoneCss[1] === AIM.zoneHardStart && gaugeToSpeed(AIM.zoneSoftEnd) === AIM.softEndMps && gaugeToSpeed(AIM.zoneHardStart) === AIM.hardStartMps, `${zoneCss.join(' / ')} -> ${AIM.softEndMps} / ${AIM.hardStartMps} m/s`);
  expect('조준: 힘 막대를 끌어도 스크롤이 없다', JSON.stringify(await scrollOf(page)) === JSON.stringify(s0));

  // ---- 꾹 눌러 힘 모으기(3D 장면과 함께). 시간을 재는 검사는 아래 "그림 배경" 화면에서 한다 ----
  // 손을 떼는 바로 그 순간 막대에 보이던 값을 적어 둔다(화면이 처리하기 전에 읽는다).
  await page.evaluate(() => {
    window.__rel = null;
    window.addEventListener('pointerup', () => {
      const g = document.querySelector('[data-testid="power-gauge"]');
      if (g) window.__rel = { speed: Number(g.dataset.speed), gauge: Number(g.dataset.gauge), charging: document.querySelector('.throw')?.getAttribute('data-charging') };
    }, true);
  });
  const btn = await rectOf(page, T('throw-btn'));
  const waitZone = (zone) => page.waitForFunction((z) => { const g = document.querySelector('[data-testid="power-gauge"]'); const hold = document.querySelector('.throw')?.dataset.charging === 'hold'; return g && hold && g.classList.contains('is-charging') && g.dataset.zone === z; }, { timeout: 8000, polling: 'raf' }, zone).then(() => true, () => false);

  // (가) 모으다가 단추 밖으로 빼서 놓으면 취소
  // 갈무리가 한 장 찍히는 동안에도 막대는 움직이므로, 찍을 때만 화면의 시계를 잠깐 세워 원하는 눈금에서 찍는다.
  await page.evaluate(() => {
    const real = performance.now.bind(performance);
    window.__freeze = null;
    performance.now = () => window.__freeze ?? real();
    window.addEventListener('pointerdown', (e) => { window.__downAt = e.timeStamp; }, true);
  });
  const freezeAt = async (g) => {
    await page.evaluate((ms) => { window.__freeze = window.__downAt + ms; }, AIM.tapMs + g * AIM.sweepMs);
    await page.waitForFunction((want) => Math.abs(Number(document.querySelector('[data-testid="power-gauge"]').dataset.gauge) - want) < 0.02, { timeout: 8000, polling: 'raf' }, g);
    await sleep(700); // 아이의 팔이 따라올 시간
  };
  // 세 구역의 한가운데 눈금에서 멈춰 본다(경계는 화면과 같은 상수에서 온다).
  const G_SOFT = Math.round((AIM.zoneSoftEnd / 2) * 100) / 100, G_MID = Math.round(((AIM.zoneSoftEnd + AIM.zoneHardStart) / 2 + 0.05) * 100) / 100, G_HARD = Math.round(((AIM.zoneHardStart + 1) / 2 + 0.08) * 100) / 100;
  await f.down({ x: btn.cx, y: btn.cy });
  await freezeAt(G_SOFT);
  expect('조준: 힘을 모으기 시작하면 막대가 살살에 있다', (await text(page, T('power-word'))) === AIM.words.soft && wordOfSpeed(gaugeToSpeed(G_SOFT)) === AIM.words.soft && (await speedOf(page)) === gaugeToSpeed(G_SOFT), `눈금 ${G_SOFT}: ${await speedOf(page)} m/s (규칙 ${gaugeToSpeed(G_SOFT)})`);
  await aimShot(page, '03-charging-low');
  expect('조준: 꾹 누르면 단추가 "놓으면 슝!"으로 바뀐다', /놓으면 슝!/.test(await text(page, T('throw-btn'))), await text(page, T('throw-btn')));
  expect('조준: 처음 모을 때 그만두는 법을 알려 준다', /단추 밖으로/.test(await text(page, T('cancel-hint')).catch(() => '')));
  await freezeAt(G_MID);
  expect('조준: 막대 가운데쯤에서는 보통이다', (await text(page, T('power-word'))) === AIM.words.mid && wordOfSpeed(gaugeToSpeed(G_MID)) === AIM.words.mid && (await speedOf(page)) === gaugeToSpeed(G_MID), `눈금 ${G_MID}: ${await speedOf(page)} m/s (규칙 ${gaugeToSpeed(G_MID)})`);
  await aimShot(page, '04-charging-mid');
  await freezeAt(G_HARD);
  expect('조준: 막대 끝쯤에서는 세게다', (await text(page, T('power-word'))) === AIM.words.hard && wordOfSpeed(gaugeToSpeed(G_HARD)) === AIM.words.hard && (await speedOf(page)) === gaugeToSpeed(G_HARD), `눈금 ${G_HARD}: ${await speedOf(page)} m/s (규칙 ${gaugeToSpeed(G_HARD)})`);
  await aimShot(page, '05-charging-high');
  await f.move({ x: btn.cx, y: btn.y - 130 }, 14, 6);
  await page.waitForSelector(T('cancel-armed'), { timeout: 4000 }).catch(() => {});
  expect('조준: 단추 밖으로 빼면 "놓으면 안 던진다"고 알려 준다', (await exists(page, T('cancel-armed'))) && /멈출까요/.test(await text(page, T('throw-btn'))), await text(page, T('throw-btn')));
  await aimShot(page, '06-cancel-armed');
  await f.up();
  const said = await page.waitForSelector(T('throw-notice'), { timeout: 2500 }).then(() => true, () => false);
  await aimShot(page, '07-cancelled');
  await page.evaluate(() => { window.__freeze = null; });
  expect('조준: 단추 밖에서 놓으면 던지지 않고, 멈췄다고 알려 준다', said && (await exists(page, '.throw--aim')));
  expect('조준: 취소하면 힘과 각도가 그대로다', (await speedOf(page)) === midSpeed && (await pitchOf(page)) === 12, `${await speedOf(page)} m/s, ${await pitchOf(page)}°`);
  expect('조준: 모으는 동안 손가락을 움직여도 스크롤이 없다', JSON.stringify(await scrollOf(page)) === JSON.stringify(s0));

  // (나) 모았다가 단추 위에서 놓으면 그 힘으로 던진다
  await f.down({ x: btn.cx, y: btn.cy });
  await waitZone('mid');
  await f.up();
  const rel = await page.evaluate(() => window.__rel);
  expect('조준: 놓으면 던진다', await thrown(page));
  expect('조준: 놓는 순간 힘 막대가 움직이고 있었다', rel && rel.charging === 'hold', JSON.stringify(rel));
  const r1 = await finishFlight(page);
  const code1 = await hashCode(page);
  const core1 = coreValues(code1);
  expect('조준: 던진 힘이 놓는 순간 막대에 보이던 힘과 같다(0.1 m/s 한 칸 안)', core1.ok && Math.abs(core1.throwIn.speedMps - rel.speed) <= 0.1001, `막대 ${rel?.speed} / 던진 값 ${core1.throwIn?.speedMps}`);
  expect('조준: 던진 각도가 화면에 보이던 각도와 같다', core1.ok && core1.throwIn.pitchDeg === 12 && core1.throwIn.rollDeg === 0, JSON.stringify(core1.throwIn));
  expect('조준: 결과의 거리와 시간이 그 값으로 core 가 계산한 것과 같다', r1.distance === core1.distance && r1.airtime === core1.airtime, `${r1.distance}/${core1.distance}, ${r1.airtime}/${core1.airtime}`);
  await tap(page, T('throw-again'));
  await page.waitForSelector(T('throw-btn'), { timeout: 8000 });
  await sleep(700);
  expect('조준: 다시 던질 때 각도와 힘이 그대로 남아 있다', (await pitchOf(page)) === 12 && (await speedOf(page)) === core1.throwIn.speedMps, `${await pitchOf(page)}°, ${await speedOf(page)} m/s`);
  expect('조준: 끌기와 모으기를 해 보면 처음 안내는 사라진다', !(await exists(page, T('throw-coach'))));
  await aimShot(page, '08-idle-after');

  // (다) 톡 누르면 지난번 힘 그대로
  await tapThrow(page);
  expect('조준: 톡 누르면 바로 던진다', await thrown(page));
  const r2 = await finishFlight(page);
  const core2 = coreValues(await hashCode(page));
  expect('조준: 톡 누르면 지난번 힘과 각도 그대로 던진다', core2.ok && core2.throwIn.speedMps === core1.throwIn.speedMps && core2.throwIn.pitchDeg === 12 && r2.distance === r1.distance, `${core2.throwIn?.speedMps} / ${core1.throwIn?.speedMps}, ${r2.distance} / ${r1.distance}`);
  await tap(page, T('throw-again'));
  await page.waitForSelector(T('throw-btn'), { timeout: 8000 });
  await sleep(500);

  // ---- 세밀 조정은 없앴다: 각도는 끌기와 단추, 힘은 꾹 누르기와 막대 끌기뿐이다. 좌우 기울이기는 늘 0 ----
  expect('조준: 세밀 조정과 기울이기 막대가 없다', !(await exists(page, T('fine-open'))) && !(await exists(page, T('throw-roll'))) && !(await exists(page, T('tilt-flag'))));
  expect('조준: 던진 비행은 늘 기울이지 않고 던진다', core1.throwIn.rollDeg === 0 && core2.throwIn.rollDeg === 0);

  expect('조준: 콘솔 오류가 없다', log.consoleErrors.length === 0, log.consoleErrors.slice(0, 3).join(' | '));
  expect('조준: 외부 요청이 0건이다', log.external.length === 0);
  await page.close();

  // ---- 시간을 재는 검사 ----
  // 시험 기기는 3D 를 소프트웨어로 그려서 한 화면에 0.1~0.4초가 걸린다. 그러면 단추의 반복 빠르기나 막대의 움직임을
  // 제대로 잴 수 없으므로, 여기서는 WebGL 을 막아 그림 배경(NullStage)으로 연다. 조작 코드는 똑같다.
  const noWebGL = () => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(type, ...rest) { return /webgl/i.test(String(type)) ? null : orig.call(this, type, ...rest); };
  };
  const pageT = await newPage(browser, log, { dpr: 1, init: noWebGL });
  await open(pageT, `${BASE}#p${code1}`);
  await pageT.waitForSelector(T('throw-btn'), { timeout: 8000 });
  await sleep(600);
  expect('조준(그림 배경): 3D 없이도 조준 화면이 뜬다', (await exists(pageT, '.gym--flat')) && (await exists(pageT, T('aim-hud'))) && (await exists(pageT, T('angle-stepper'))));
  const frameMs = await pageT.evaluate(() => new Promise((res) => { const out = []; let last = performance.now(); const t = () => { const n = performance.now(); out.push(n - last); last = n; if (out.length < 30) requestAnimationFrame(t); else res(out.slice(5).sort((x, y) => x - y)[12]); }; requestAnimationFrame(t); }));
  console.log(`     잰 값: 그림 배경 화면의 한 화면 시간 ${frameMs.toFixed(1)} ms`);
  const fT = await finger(pageT);
  const upT = await rectOf(pageT, T('angle-up'));
  const downT = await rectOf(pageT, T('angle-down'));
  // 끌기 감도를 한 번 더 잰다(1px 씩 100걸음)
  const sceneT = await rectOf(pageT, T('throw-scene'));
  const pT0 = await pitchOf(pageT);
  await fT.down({ x: sceneT.x + 120, y: sceneT.cy + 60 });
  const seenPitch = [];
  for (let i = 1; i <= 100; i++) { await fT.move({ x: sceneT.x + 120, y: sceneT.cy + 60 - i }, 1, 0); if (i % 10 === 0) seenPitch.push((await pitchOf(pageT)) - pT0); }
  await fT.up();
  expect('조준: 끌기 감도는 1px 에 0.3도다(10px 마다 3도씩)', seenPitch.every((d, i) => d === Math.min(AIM.pitchMax - pT0, (i + 1) * 3)), seenPitch.join(', '));
  console.log(`     잰 값: 위로 10px 씩 끌 때 각도 변화 ${seenPitch.join(', ')} (1px 에 ${(seenPitch[seenPitch.length - 1] / 100).toFixed(2)}도)`);
  await fT.down({ x: sceneT.x + 120, y: sceneT.cy - 60 });
  await fT.move({ x: sceneT.x + 120, y: sceneT.cy + 40 }, 10, 2);
  await fT.up();
  // 각도가 바뀐 시각을 화면 안에서 적는다
  await pageT.evaluate(() => {
    window.__steps = [];
    const el = document.querySelector('[data-testid="angle-readout"]');
    new MutationObserver(() => window.__steps.push([performance.now(), Number(el.getAttribute('data-pitch'))])).observe(el, { attributes: true, attributeFilter: ['data-pitch'] });
  });
  await fT.down({ x: downT.cx, y: downT.cy });
  await sleep(2300);
  await fT.up();
  await sleep(200);
  const steps = await pageT.evaluate(() => window.__steps);
  const gaps = steps.slice(1).map((s, i) => s[0] - steps[i][0]);
  const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  expect('조준: 단추를 꾹 누르면 한 번 바뀐 뒤 잠깐 쉬었다가 계속 바뀐다', steps.length >= 12 && gaps[0] > 300 && gaps[0] < 600 && steps.every((s, i) => i === 0 || s[1] === steps[i - 1][1] - 1), `${steps.length}걸음, 첫 쉼 ${gaps[0]?.toFixed(0)} ms`);
  expect('조준: 꾹 누르고 있으면 점점 빨라진다', avg(gaps.slice(-5)) < avg(gaps.slice(1, 4)) * 0.7, `처음 ${avg(gaps.slice(1, 4)).toFixed(0)} ms -> 나중 ${avg(gaps.slice(-5)).toFixed(0)} ms 마다 1도`);
  console.log(`     잰 값: 꾹 누르면 ${gaps[0]?.toFixed(0)} ms 뒤부터 ${avg(gaps.slice(1, 4)).toFixed(0)} ms -> ${avg(gaps.slice(-5)).toFixed(0)} ms 마다 1도`);
  const afterHold = await pitchOf(pageT);
  await sleep(300);
  expect('조준: 손을 떼면 멈춘다', (await pitchOf(pageT)) === afterHold);
  await fT.down({ x: downT.cx, y: downT.cy });
  await sleep(3000);
  await fT.up();
  expect('조준: 단추로도 아래 끝에서 멈춘다', (await pitchOf(pageT)) === AIM.pitchMin && (await pageT.$eval(T('angle-down'), (el) => el.classList.contains('is-end'))), String(await pitchOf(pageT)));
  await fT.down({ x: upT.cx, y: upT.cy });
  await sleep(5200);
  await fT.up();
  expect('조준: 단추로도 위 끝에서 멈춘다', (await pitchOf(pageT)) === AIM.pitchMax && (await pageT.$eval(T('angle-up'), (el) => el.classList.contains('is-end'))), String(await pitchOf(pageT)));
  // 글쇠로도 된다
  await pageT.focus(T('angle-down'));
  await pageT.keyboard.press('Enter');
  await pageT.keyboard.press('Space');
  await sleep(100);
  expect('조준: 글쇠(엔터, 스페이스)로도 단추가 눌린다', (await pitchOf(pageT)) === AIM.pitchMax - 2, String(await pitchOf(pageT)));

  // 힘 막대가 오가는 빠르기를 잰다: 꾹 누르고 있는 동안 화면마다 막대 값을 적는다
  await pageT.evaluate(() => {
    window.__rel = null;
    const read = (e) => {
      const g = document.querySelector('[data-testid="power-gauge"]');
      if (g) window.__rel = { speed: Number(g.dataset.speed), charging: document.querySelector('.throw')?.getAttribute('data-charging'), t: e.timeStamp };
    };
    window.addEventListener('pointerup', read, true);
    window.addEventListener('keyup', read, true);
    window.addEventListener('pointerdown', (e) => { window.__downAt = e.timeStamp; }, true);
    window.addEventListener('keydown', (e) => { if (!e.repeat) window.__downAt = e.timeStamp; }, true);
    window.__trace = [];
    const tick = () => {
      const g = document.querySelector('[data-testid="power-gauge"]');
      const st = document.querySelector('.throw')?.getAttribute('data-charging');
      if (g && (st === 'hold' || st === 'off')) window.__trace.push([performance.now(), Number(g.dataset.gauge)]);
      requestAnimationFrame(tick);
    };
    tick();
  });
  const btnT = await rectOf(pageT, T('throw-btn'));
  const keepT = await speedOf(pageT);
  await fT.down({ x: btnT.cx, y: btnT.cy });
  await sleep(5400);
  await fT.move({ x: btnT.cx, y: btnT.y - 120 }, 12, 4);
  await sleep(80);
  expect('조준(그림 배경): 단추 밖으로 빼면 취소할 수 있다고 알려 준다', await exists(pageT, T('cancel-armed')));
  await fT.move({ x: btnT.cx, y: btnT.cy }, 12, 4);
  await sleep(80);
  expect('조준: 단추로 돌아오면 계속 모은다', !(await exists(pageT, T('cancel-armed'))) && /놓으면 슝!/.test(await text(pageT, T('throw-btn'))));
  await fT.move({ x: btnT.cx + 150, y: btnT.y - 90 }, 12, 4);
  await fT.up();
  await sleep(120);
  expect('조준: 단추 밖에서 놓으면 던지지 않는다', (await exists(pageT, '.throw--aim')) && !(await exists(pageT, T('result-panel'))));
  expect('조준: 취소하면 멈췄다고 알려 준다', /멈췄어요/.test(await text(pageT, T('throw-notice')).catch(() => '')));
  expect('조준: 취소하면 힘 막대가 지난번 힘으로 돌아온다', (await speedOf(pageT)) === keepT, `${await speedOf(pageT)} / ${keepT}`);
  const trace = await pageT.evaluate(() => { const t = window.__trace; window.__trace = []; return t; });
  // 꼭대기(세게 끝)와 바닥(살살 끝)에 머문 시각을 묶어서, 그 사이가 한 번 가는 시간이다
  const turns = [];
  for (const [t, g] of trace) {
    const kind = g > 0.97 ? 'top' : g < 0.03 ? 'bottom' : null;
    if (!kind) continue;
    const last = turns[turns.length - 1];
    if (last && last.kind === kind && t - last.to < 300) { last.to = t; continue; }
    turns.push({ kind, from: t, to: t });
  }
  const mids = turns.map((u) => (u.from + u.to) / 2);
  const sweeps = mids.slice(1).map((t, i) => t - mids[i]);
  const sweepAvg = sweeps.reduce((x, y) => x + y, 0) / Math.max(1, sweeps.length);
  expect('조준: 힘 막대가 살살과 세게 사이를 오간다(한 번에 약 1.2초)', sweeps.length >= 3 && sweeps.every((v) => Math.abs(v - AIM.sweepMs) < 90), `한 번에 평균 ${sweepAvg.toFixed(0)} ms (${sweeps.map((v) => v.toFixed(0)).join(', ')})`);
  expect('조준: 막대는 살살 끝에서 시작해 끊기지 않고 움직인다', trace.length > 100 && trace[0][1] < 0.08 && trace.slice(1).every((v, i) => Math.abs(v[1] - trace[i][1]) < 0.12), `${trace.length}장, 처음 ${trace[0]?.[1]}`);
  console.log(`     잰 값: 힘 막대 한 번 가는 시간 평균 ${sweepAvg.toFixed(0)} ms (${sweeps.map((v) => v.toFixed(0)).join(', ')})`);
  await sleep(2700);
  expect('조준: 멈췄다는 알림은 잠깐 뒤에 사라진다', !(await exists(pageT, T('throw-notice'))));

  // 손을 떼는 순간의 막대 값과 던진 값을 여러 번 견준다(놓는 때를 바꿔 가며)
  const rows = [];
  for (const hold of [330, 800, 1280, 1800, 2600]) {
    await fT.down({ x: btnT.cx, y: btnT.cy });
    await sleep(hold);
    await fT.up();
    await thrown(pageT);
    const rel = await pageT.evaluate(() => ({ ...window.__rel, held: window.__rel.t - window.__downAt }));
    const r = await finishFlight(pageT, 100);
    const core = coreValues(await hashCode(pageT));
    // 누른 시간으로 셈한 힘(막대가 살살에서 시작해 1.2초에 한 번 간다).
    // 손을 뗀 신호가 화면에 닿을 때까지 막대는 조금 더 움직이므로, 0~0.1초 늦게 읽은 값까지 맞는 것으로 본다.
    const clock = (ms) => { const x = ((ms - AIM.tapMs) / AIM.sweepMs) % 2; return gaugeToSpeed(x <= 1 ? x : 2 - x); };
    const byClock = clock(rel.held);
    let late = -1;
    for (let dt = 0; dt <= 100 && late < 0; dt += 2) if (Math.abs(clock(rel.held + dt) - rel.speed) <= 0.15) late = dt;
    rows.push({ held: Math.round(rel.held), bar: rel.speed, thrown: core.throwIn?.speedMps, byClock, late, same: r.distance === core.distance && r.airtime === core.airtime });
    await tap(pageT, T('throw-again'));
    await pageT.waitForSelector(T('throw-btn'), { timeout: 8000 });
    await sleep(300);
  }
  const rowText = rows.map((r) => `${r.held}ms: 막대 ${r.bar} / 던진 값 ${r.thrown} / 시계로 셈 ${r.byClock} (늦음 ${r.late}ms)`).join(' | ');
  expect('조준: 놓는 순간 막대에 보이던 힘 그대로 던진다(5번, 0.1 m/s 한 칸 안)', rows.every((r) => Math.abs(r.thrown - r.bar) <= 0.1001 && r.same), rowText);
  expect('조준: 막대의 힘이 누른 시간과 맞는다(신호가 닿는 0.1초 안의 차이)', rows.every((r) => r.late >= 0), rowText);
  expect('조준: 누른 시간에 따라 힘이 다르다(살살부터 세게까지)', new Set(rows.map((r) => r.thrown)).size >= 4 && rows.some((r) => wordOfSpeed(r.thrown) === AIM.words.soft) && rows.some((r) => wordOfSpeed(r.thrown) === AIM.words.mid) && rows.some((r) => wordOfSpeed(r.thrown) === AIM.words.hard) && rows.every((r) => r.thrown >= AIM.speedMin && r.thrown <= AIM.speedMax), rows.map((r) => `${r.thrown}(${wordOfSpeed(r.thrown)})`).join(', '));
  console.log(`     잰 값: ${rowText}`);
  // 톡(180ms 보다 짧게): 지난번 힘 그대로
  const lastThrown = rows[rows.length - 1].thrown;
  for (const hold of [0, 90]) {
    await fT.down({ x: btnT.cx, y: btnT.cy });
    if (hold) await sleep(hold);
    await fT.up();
    const went = await thrown(pageT);
    const held = await pageT.evaluate(() => window.__rel.t - window.__downAt);
    await finishFlight(pageT, 100);
    const core = coreValues(await hashCode(pageT));
    expect(`조준: 톡(${held.toFixed(0)}ms) 누르면 지난번 힘 그대로 던진다`, went && held < AIM.tapMs && core.throwIn?.speedMps === lastThrown, `${core.throwIn?.speedMps} / ${lastThrown}`);
    await tap(pageT, T('throw-again'));
    await pageT.waitForSelector(T('throw-btn'), { timeout: 8000 });
    await sleep(300);
  }

  // 글쇠: 스페이스를 누르고 있다가 떼면 던진다. Esc 는 취소.
  const keep = await speedOf(pageT);
  await pageT.focus(T('throw-btn'));
  await pageT.keyboard.down('Space');
  await sleep(500);
  await pageT.keyboard.press('Escape');
  await pageT.keyboard.up('Space');
  await sleep(200);
  expect('조준: 글쇠로 모으다가 Esc 를 누르면 취소된다', (await exists(pageT, T('throw-btn'))) && (await exists(pageT, '.throw--aim')) && (await speedOf(pageT)) === keep);
  await pageT.keyboard.down('Space');
  await sleep(AIM.tapMs + 420);
  await pageT.keyboard.up('Space');
  expect('조준: 스페이스를 꾹 눌렀다 떼면 던진다', await thrown(pageT));
  const relK = await pageT.evaluate(() => window.__rel);
  await finishFlight(pageT, 100);
  const coreK = coreValues(await hashCode(pageT));
  expect('조준: 글쇠로 모은 힘도 놓는 순간의 막대와 같다', coreK.ok && relK.charging === 'hold' && Math.abs(coreK.throwIn.speedMps - relK.speed) <= 0.1001 && coreK.throwIn.speedMps !== keep, `막대 ${relK.speed} / 던진 값 ${coreK.throwIn?.speedMps}`);
  await tap(pageT, T('throw-again'));
  await pageT.waitForSelector(T('throw-btn'), { timeout: 8000 });
  await pageT.focus(T('throw-btn'));
  await pageT.keyboard.press('Enter');
  expect('조준: 엔터를 톡 치면 지난번 힘으로 던진다', await thrown(pageT));
  await finishFlight(pageT, 100);
  const coreE = coreValues(await hashCode(pageT));
  expect('조준: 엔터로 던진 힘이 지난번과 같다', coreE.ok && coreE.throwIn.speedMps === coreK.throwIn.speedMps, `${coreE.throwIn?.speedMps} / ${coreK.throwIn?.speedMps}`);
  await pageT.close();

  // ---- 움직임 줄이기: 힘 모으기는 그대로 된다 ----
  const page2 = await newPage(browser, log, { dpr: 1, init: noWebGL });
  await page2.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await open(page2, `${BASE}#p${code1}`);
  await page2.waitForSelector(T('throw-btn'), { timeout: 8000 });
  await sleep(500);
  await page2.evaluate(() => {
    window.__seen = [];
    const g = document.querySelector('[data-testid="power-gauge"]');
    new MutationObserver(() => window.__seen.push(Number(g.dataset.speed))).observe(g, { attributes: true, attributeFilter: ['data-speed'] });
  });
  const f2 = await finger(page2);
  const btn2 = await rectOf(page2, T('throw-btn'));
  const before2 = await speedOf(page2);
  await f2.down({ x: btn2.cx, y: btn2.cy });
  await sleep(1050);
  await f2.up();
  const seen = await page2.evaluate(() => window.__seen);
  expect('움직임 줄이기: 꾹 누르면 힘 막대가 그래도 움직인다', new Set(seen).size >= 8, `${new Set(seen).size}가지 값`);
  expect('움직임 줄이기: 놓으면 던진다', await page2.waitForSelector(T('result-panel'), { timeout: 15000 }).then(() => true, () => false));
  const core4 = coreValues(await hashCode(page2));
  expect('움직임 줄이기: 마지막에 보이던 힘으로 던졌다', core4.ok && core4.throwIn.speedMps === seen[seen.length - 1] && core4.throwIn.speedMps !== before2, `${core4.throwIn?.speedMps} / ${seen[seen.length - 1]}`);
  await page2.close();

  // ---- 다른 앱 화면 안에 끼워 넣었을 때: 바깥 화면이 딸려 움직이지 않는다 ----
  const page3 = await newPage(browser, log);
  await page3.goto(`${BASE}#p${code1}`, { waitUntil: 'domcontentloaded' });
  // 같은 출처의 빈 문서에 키 큰 바깥 화면을 만들고 그 안에 놀이를 끼운다
  await page3.setContent(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0}body{height:2400px}#pad{height:120px}iframe{display:block;width:100%;height:620px;border:0}</style><div id="pad">바깥 앱</div><iframe id="game" src="${BASE}#p${code1}"></iframe>`, { waitUntil: 'load' });
  const frame = await (await page3.$('#game')).contentFrame();
  await frame.waitForSelector(T('throw-btn'), { timeout: 15000 });
  await sleep(1500);
  const f3 = await finger(page3);
  const hostScroll = () => page3.evaluate(() => window.scrollY);
  const inner = async (sel) => { const r = await frame.$eval(sel, (el) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; }); return { x: r.x, y: r.y + 120, w: r.w, h: r.h, cx: r.x + r.w / 2, cy: r.y + 120 + r.h / 2 }; };
  // 견줄 것: 놀이 바깥(위쪽 빈 곳)을 끌면 바깥 화면이 움직인다
  await f3.down({ x: 180, y: 100 });
  await f3.move({ x: 180, y: 30 }, 10, 12);
  await f3.up();
  await sleep(300);
  const moved = await hostScroll();
  expect('끼워 넣기(견줄 것): 놀이 바깥을 끌면 바깥 화면은 스크롤된다', moved > 20, `${moved}px`);
  await page3.evaluate(() => window.scrollTo(0, 0));
  await sleep(200);
  const sc3 = await inner(T('throw-scene'));
  const pIn0 = await frame.$eval(T('angle-readout'), (el) => Number(el.getAttribute('data-pitch')));
  await f3.down({ x: sc3.x + sc3.w * 0.4, y: sc3.cy + 60 });
  await f3.move({ x: sc3.x + sc3.w * 0.4, y: sc3.cy - 60 }, 10, 12);
  await f3.up();
  await sleep(300);
  const pIn1 = await frame.$eval(T('angle-readout'), (el) => Number(el.getAttribute('data-pitch')));
  expect('끼워 넣기: 장면을 위로 끌면 각도만 바뀌고 바깥 화면은 그대로다', (await hostScroll()) === 0 && pIn1 === Math.min(AIM.pitchMax, pIn0 + 36), `바깥 스크롤 ${await hostScroll()}px, 각도 ${pIn0} -> ${pIn1}`);
  const b3 = await inner(T('throw-btn'));
  await f3.down({ x: b3.cx, y: b3.cy });
  await sleep(500);
  await f3.move({ x: b3.cx, y: b3.cy - 150 }, 10, 12);
  await f3.up();
  await sleep(300);
  expect('끼워 넣기: 던지기 단추에서 위로 끌어도 바깥 화면은 그대로다(취소만 된다)', (await hostScroll()) === 0 && (await frame.$(T('throw-btn'))) !== null && (await frame.$(T('result-panel'))) === null, `바깥 스크롤 ${await hostScroll()}px`);
  const g3 = await inner(T('power-track'));
  await f3.down({ x: g3.x + 40, y: g3.cy });
  await f3.move({ x: g3.x + g3.w - 40, y: g3.cy - 40 }, 10, 12);
  await f3.up();
  await sleep(300);
  expect('끼워 넣기: 힘 막대를 끌어도 바깥 화면은 그대로다', (await hostScroll()) === 0, `바깥 스크롤 ${await hostScroll()}px`);
  await page3.close();
}

// ---------------------------------------------------------------------------
// 2) 주소(#p코드)로 새 화면에서 열기: 숫자가 한 자리도 다르지 않아야 한다
// ---------------------------------------------------------------------------
async function hashFlow(browser, code, first) {
  const log = newLog();
  const page = await newPage(browser, log);
  await open(page, `${BASE}#p${code}`);
  expect('주소의 코드로 열면 출발선에서 시작한다', (await place(page)) === '출발선');
  expect('비행기를 꺼냈다고 알려 준다', /꺼냈어요/.test(await text(page, T('toast')).catch(() => '')));
  await sleep(600);
  await tapThrow(page);
  const r = await waitResult(page);
  expect('주소로 연 화면의 결과가 처음 결과와 똑같다', r.distance === first.distance && r.airtime === first.airtime && r.verdict === first.verdict, `${r.distance}/${first.distance} ${r.airtime}/${first.airtime}`);
  expect('주소의 코드가 그대로 유지된다', (await hashCode(page)) === code);
  // 따라 접은 화살을 공유한 코드(10.18m). 불러오기는 직접 접은 이력이 아니다.
  const sharedPage = await newPage(browser, log);
  const guided10m = 'P19uWgrXAv9kAn015ONpdOEaSzCL1klCelt5QC0ReLIhfeF338e14N3BxJoblqZInTbY3OMwWJU';
  await open(sharedPage, `${BASE}#p${guided10m}`);
  await tapThrow(sharedPage);
  const sharedResult = await waitResult(sharedPage);
  expect('공유한 따라 접기 비행기로 10m 이상 난다', Number.parseFloat(sharedResult.distance) >= 10, sharedResult.distance);
  expect('공유 코드를 불러와 던지면 직접 접기 스티커를 주지 않는다', !(await exists(sharedPage, T('new-sticker-free10'))));
  await tap(sharedPage, T('nav-book'));
  expect('기록장에도 직접 접기 스티커가 저장되지 않는다', (await sharedPage.$eval(T('sticker-free10'), (el) => el.getAttribute('data-got'))) === 'false');
  await sharedPage.close();
  // 잘못된 주소
  const page2 = await newPage(browser, log);
  await open(page2, `${BASE}#pNOTAREALCODE`);
  expect('잘못된 주소 코드는 알려 주고 대회장에서 시작한다', (await place(page2)) === '대회장' && /꺼내지 못했어요/.test(await text(page2, T('toast')).catch(() => '')));
  expect('주소로 열기: 콘솔 오류가 없다', log.consoleErrors.length === 0, log.consoleErrors.slice(0, 3).join(' | '));
  expect('주소로 열기: 외부 요청이 0건이다', log.external.length === 0);
  await page.close();
  await page2.close();
}

// ---------------------------------------------------------------------------
// 3) 넓은 화면 (1280 x 800, 마우스)
// ---------------------------------------------------------------------------
async function desktopFlow(browser) {
  const log = newLog();
  const page = await newPage(browser, log, { mobile: false });
  await open(page, BASE);
  await canvasAlive(page, T('gym-canvas'), '넓은 화면 대회장', 120);
  await shot(page, 'd-01-home');
  await audit(page, '넓은 화면 대회장');
  await tap(page, T('go-desk'));
  await shot(page, 'd-02-desk-paper');
  await tap(page, T('desk-next'));
  await shot(page, 'd-03-fold-pick');
  await tap(page, T('fold-delta'));
  await page.waitForSelector(T('fb-svg'));
  await sleep(300);
  await shot(page, 'd-04-fold-guide');
  await tap(page, T('guide-instant'));
  await tap(page, T('desk-next'));
  await sleep(300);
  await shot(page, 'd-05-shape');
  await audit(page, '넓은 화면 책상');
  await tap(page, T('desk-next'));
  await sleep(1600);
  await shot(page, 'd-06-aim');
  // 마우스로: 장면을 위로 끌어 각도를 올리고, 던지기 단추를 꾹 눌렀다 놓는다
  const scene = await page.$eval(T('throw-scene'), (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const fx = scene.x + scene.w * 0.3, fy = scene.y + scene.h * 0.5;
  const dp0 = await page.$eval(T('angle-readout'), (el) => Number(el.getAttribute('data-pitch')));
  await page.mouse.move(fx, fy);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(fx + i * 3, fy - i * 5); await sleep(20); }
  await shot(page, 'd-07-aim-drag');
  await page.mouse.up();
  await sleep(120);
  expect('넓은 화면: 마우스로 위로 40px 끌면 12도 올라간다', (await page.$eval(T('angle-readout'), (el) => Number(el.getAttribute('data-pitch')))) === dp0 + 12);
  await audit(page, '넓은 화면 출발선');
  const dbtn = await page.$eval(T('throw-btn'), (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.move(dbtn.x, dbtn.y);
  await page.mouse.down();
  await sleep(800);
  await shot(page, 'd-07-aim-charge');
  await aimShot(page, '11-desktop-charging');
  await page.mouse.up();
  await sleep(1300);
  await shot(page, 'd-08-flight');
  const r = await waitResult(page);
  expect('넓은 화면: 마우스로 꾹 눌러 던지면 결과가 나온다', /^\d+\.\d\d$/.test(r.distance), JSON.stringify(r));
  await sleep(600);
  await shot(page, 'd-09-result');
  await audit(page, '넓은 화면 결과');
  await tap(page, T('nav-book'));
  await shot(page, 'd-10-book');
  expect('넓은 화면: 콘솔 오류가 없다', log.consoleErrors.length === 0, log.consoleErrors.slice(0, 3).join(' | '));
  expect('넓은 화면: 외부 요청이 0건이다', log.external.length === 0);
  await page.close();
}

// ---------------------------------------------------------------------------
// 4) 막힌 환경: 저장소, 클립보드, Worker 를 쓸 수 없고 "움직임 줄이기"가 켜져 있다
// ---------------------------------------------------------------------------
async function hostileFlow(browser, code, first) {
  const log = newLog();
  const page = await newPage(browser, log, {
    clipboard: false,
    init: () => {
      Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('막힘', 'SecurityError'); } });
      Object.defineProperty(navigator, 'clipboard', { get() { return undefined; } });
      window.Worker = function BlockedWorker() { throw new Error('Worker 막힘'); };
    },
  });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await open(page, `${BASE}#p${code}`);
  expect('막힌 환경: 화면이 뜬다', (await place(page)) === '출발선');
  await tapThrow(page);
  const t0 = Date.now();
  const r = await waitResult(page);
  expect('막힌 환경: Worker 없이도 같은 결과가 나온다', r.distance === first.distance && r.airtime === first.airtime, `${r.distance}/${first.distance}`);
  expect('움직임 줄이기: 긴 연출 없이 바로 결과가 나온다(느린 시험 기기 기준 6초 안)', Date.now() - t0 < 6000, `${Date.now() - t0} ms`);
  expect('움직임 줄이기: 도장은 그대로 보인다', await exists(page, T('stamp')));
  expect('움직임 줄이기: 색종이 조각은 날리지 않는다', !(await exists(page, T('confetti'))));
  await shot(page, '20-reduced-result');
  await tap(page, T('brag'));
  await tap(page, T('copy-code'));
  await sleep(300);
  expect('막힌 환경: 복사가 안 되면 직접 복사하는 법을 알려 준다', /길게 눌러서/.test(await text(page, T('copy-msg'))));
  const selected = await page.evaluate(() => { const el = document.activeElement; return el && el.tagName === 'TEXTAREA' ? el.value.slice(el.selectionStart, el.selectionEnd) : ''; });
  expect('막힌 환경: 코드를 골라 둔다', selected === code);
  await shot(page, '21-copy-fallback');
  await tap(page, T('share-dialog-close'));
  await tap(page, T('nav-book'));
  expect('막힌 환경: 이번 방문의 기록은 보인다', (await page.$$('.recent__item')).length === 1);
  await tap(page, T('nav-home'));
  await tap(page, T('go-desk'));
  await tap(page, T('desk-tab-fold'));
  expect('막힌 환경: 책상도 열린다', await exists(page, T('fb-svg')));
  expect('막힌 환경: 콘솔 오류가 없다', log.consoleErrors.length === 0, log.consoleErrors.slice(0, 3).join(' | '));
  expect('막힌 환경: 외부 요청이 0건이다', log.external.length === 0);
  await page.close();
}

// ---------------------------------------------------------------------------
// 5) 랭킹이 연결된 빌드 (흉내 서버)
// ---------------------------------------------------------------------------
async function apiFlow(browser, code) {
  const API_PORT = 4175, SITE_PORT = 4174;
  const API = `http://127.0.0.1:${API_PORT}`;
  const SITE = `http://127.0.0.1:${SITE_PORT}/`;
  const build = spawnSync('npx', ['vite', 'build', '--outDir', 'dist-api', '--logLevel', 'error'], { cwd: ROOT, env: { ...process.env, VITE_API_URL: API }, encoding: 'utf8' });
  if (build.status !== 0) throw new Error(`dist-api 빌드 실패: ${build.stderr}`);

  const posts = [];
  const entry = (i, mode) => ({ id: `e${i}`, nickname: `선수${i}`, mode, score: 30 - i, distanceM: 30 - i, airtimeS: 5, verdict: 'glide', code, createdAt: '2026-01-01T00:00:00Z' });
  const server = createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Content-Type': 'application/json' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    if (req.url.startsWith('/api/leaderboard')) {
      const mode = new URL(req.url, API).searchParams.get('mode');
      res.writeHead(200, cors);
      res.end(JSON.stringify({ ok: true, mode, total: 3, entries: [1, 2, 3].map((i) => entry(i, mode)) }));
      return;
    }
    if (req.url === '/api/submit' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const data = JSON.parse(body);
        posts.push(data);
        res.writeHead(200, cors);
        // 화면이 계산한 값이 아니라 서버 값이 표시되는지 보려고 일부러 엉뚱한 점수를 돌려준다.
        res.end(JSON.stringify({ ok: true, rank: 2, total: 7, entry: { ...entry(9, data.mode), nickname: data.nickname, score: 77.77, distanceM: 77.77, code: data.code } }));
      });
      return;
    }
    res.writeHead(404, cors);
    res.end(JSON.stringify({ ok: false, errors: ['없는 주소예요.'] }));
  });
  await new Promise((r) => server.listen(API_PORT, '127.0.0.1', r));
  const preview = await startPreview(SITE_PORT, 'dist-api');
  try {
    const log = newLog();
    const page = await newPage(browser, log, { origins: [SITE, API] });
    await open(page, `${SITE}#p${code}`);
    await tapThrow(page);
    await sleep(900);
    await tap(page, T('skip'));
    await waitResult(page);
    await tap(page, T('brag'));
    await page.waitForSelector(T('rank-form'), { timeout: 8000 });
    await page.type(T('nickname'), '종이왕');
    await shot(page, '30-rank-form');
    await tap(page, T('submit-send'));
    await page.waitForSelector(T('official-score'), { timeout: 8000 });
    expect('랭킹: 서버가 돌려준 공식 기록을 보여 준다', /77\.77/.test(await text(page, T('official-score'))));
    expect('랭킹: 보내는 값은 code, mode, nickname 뿐이다(점수는 보내지 않는다)', posts.length === 1 && Object.keys(posts[0]).sort().join(',') === 'code,mode,nickname', JSON.stringify(posts[0]));
    expect('랭킹: 보낸 코드는 던진 비행의 코드다', posts[0]?.code === code);
    await shot(page, '31-rank-official');
    await audit(page, '랭킹 올리기');
    await tap(page, T('share-dialog-close'));
    await tap(page, T('nav-book'));
    await page.waitForSelector(T('ranking-table'), { timeout: 8000 });
    expect('랭킹: 순위표 세 줄이 보인다', (await page.$$('.rank__item')).length === 3);
    await page.$eval(T('ranking'), (el) => el.scrollIntoView({ block: 'center' }));
    await shot(page, '32-ranking');
    await audit(page, '랭킹 순위표');
    expect('랭킹 빌드: 콘솔 오류가 없다', log.consoleErrors.length === 0, log.consoleErrors.join(' | '));
    expect('랭킹 빌드: 사이트와 설정한 API 외의 요청이 없다', log.external.length === 0, log.external.join(', '));
    // 서버가 꺼졌을 때
    await new Promise((r) => { server.close(r); server.closeAllConnections?.(); });
    await tap(page, T('rank-mode-airtime'));
    await page.waitForSelector(T('ranking-errors'), { timeout: 12000 });
    expect('랭킹: 연결 실패를 알려 준다', /연결하지 못했어요/.test(await text(page, T('ranking-errors'))));
    await page.close();
  } finally {
    stop(preview);
    if (server.listening) server.close();
  }
}

// ---------------------------------------------------------------------------
async function run() {
  const coords = spawnSync('npx', ['tsx', 'scripts/check-coords.ts'], { cwd: ROOT, encoding: 'utf8' });
  process.stdout.write(coords.stdout);
  expect('좌표 변환 검사(코 방향, 좌우)', coords.status === 0, coords.stderr.trim().split('\n').pop() ?? '');

  const distFiles = readdirSync(join(ROOT, 'dist'), { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).length;
  expect('dist 의 파일이 200개보다 적다', distFiles < 200, `${distFiles}개`);

  const preview = await startPreview(PORT, 'dist', DEV);
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  try {
    if (ONLY_AIM) { await aimFlow(browser); return; }
    const { code, first } = await mainFlow(browser);
    await aimFlow(browser);
    await hashFlow(browser, code, first);
    await desktopFlow(browser);
    await hostileFlow(browser, code, first);
    if (WITH_API) await apiFlow(browser, code);
  } finally {
    await browser.close();
    stop(preview);
  }
}

run().then(
  () => {
    console.log(`\n검사 ${checks}개 중 실패 ${failures.length}개`);
    if (failures.length > 0) {
      for (const f of failures) console.log(` - ${f}`);
      writeFileSync(join(SHOTS, 'e2e-failures.txt'), failures.join('\n'));
      process.exit(1);
    }
  },
  (err) => {
    console.error('검사 도중 멈췄어요:', err);
    console.log(`지금까지 실패 ${failures.length}개`);
    for (const f of failures) console.log(` - ${f}`);
    process.exit(1);
  },
);
