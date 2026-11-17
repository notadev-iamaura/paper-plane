/**
 * 순위표 검사 (headless Chrome). 게시 플랫폼 없이, 페이지 안 흉내(scripts/mock-claude.js)로 본다.
 *
 * 실행: node scripts/e2e-ranking.mjs            dist-rank 를 새로 빌드해 4179 포트로 본다
 *       node scripts/e2e-ranking.mjs --no-http  진짜 랭킹 서버(HTTP) 길 검사는 건너뛴다
 * 화면 갈무리는 screenshots/v8-ranking/ 에 저장한다. 하나라도 실패하면 0 이 아닌 값으로 끝난다.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(ROOT, 'screenshots', 'v8-ranking');
const PORT = 4179;
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT_DIR = 'dist-rank';
const WITH_HTTP = !process.argv.includes('--no-http');
mkdirSync(SHOTS, { recursive: true });
const MOCK = readFileSync(join(ROOT, 'scripts', 'mock-claude.js'), 'utf8');
const FORBIDDEN = ['분석', '시뮬레이션', '파라미터', '프리셋'];

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
const f2 = (v) => v.toFixed(2);

async function reachable(url) {
  try { return (await fetch(url)).ok; } catch { return false; }
}
async function startPreview(port, outDir) {
  const url = `http://127.0.0.1:${port}/`;
  if (await reachable(url)) throw new Error(`${port} 포트를 이미 다른 것이 쓰고 있어요`);
  const child = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1', '--outDir', outDir], { cwd: ROOT, stdio: 'ignore', detached: true });
  for (let i = 0; i < 80; i++) {
    if (await reachable(url)) return child;
    await sleep(250);
  }
  throw new Error(`미리보기 서버가 뜨지 않았어요 (${url})`);
}
function stop(child) {
  if (!child) return;
  try { process.kill(-child.pid); } catch { /* 이미 끝남 */ }
}
function build(outDir, env = {}) {
  const r = spawnSync('npx', ['vite', 'build', '--outDir', outDir, '--logLevel', 'error'], { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${outDir} 빌드 실패: ${r.stderr}`);
}
/** core 로 직접 계산한 값(기존 도우미 scripts/e2e-core.ts 를 그대로 쓴다). */
function coreValues(code) {
  const r = spawnSync('npx', ['tsx', 'scripts/e2e-core.ts', code], { cwd: ROOT, encoding: 'utf8' });
  try { return JSON.parse(r.stdout.trim().split('\n').pop()); } catch { return { ok: false, error: r.stderr }; }
}

function watch(page, allowedOrigins, log) {
  page.on('console', (m) => { if (m.type() === 'error') log.consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => log.consoleErrors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => log.failed.push(`${r.url()} (${r.failure()?.errorText})`));
  page.on('response', (r) => { if (r.status() >= 400) log.failed.push(`${r.url()} -> ${r.status()}`); });
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('data:') || u.startsWith('blob:') || u === 'about:blank') return;
    log.requests.push(u);
    if (!allowedOrigins.some((o) => u.startsWith(o))) log.external.push(u);
  });
}
const newLog = () => ({ consoleErrors: [], failed: [], requests: [], external: [] });

/**
 * 새 방문자(새 브라우저 컨텍스트)를 만든다.
 * mock: 흉내 설정(null 이면 window.claude 를 아예 넣지 않는다 = 내 컴퓨터나 다른 곳에 올린 판)
 */
async function newPage(browser, log, { mobile = true, origins = [BASE], mock = null, storage = null } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  if (mobile) await page.setViewport({ width: 360, height: 740, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  else await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  // Worker 에 일을 맡긴 횟수를 센다(계산을 몇 번 했는지 보는 용도).
  await page.evaluateOnNewDocument(() => {
    window.__workerPosts = 0;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (...args) { window.__workerPosts++; return post.apply(this, args); };
    window.__bootMark = Math.random();
  });
  if (storage) await page.evaluateOnNewDocument((items) => { try { for (const [k, v] of Object.entries(items)) if (window.localStorage.getItem(k) === null) window.localStorage.setItem(k, v); } catch { /* 무시 */ } }, storage);
  if (mock) {
    await page.evaluateOnNewDocument((cfg) => { window.__mockClaudeConfig = cfg; }, mock);
    await page.evaluateOnNewDocument(MOCK);
  }
  watch(page, origins, log);
  return page;
}
async function open(page, url) {
  // 주소의 # 뒤만 바뀌면 새로 읽지 않으므로, 빈 화면을 거쳐 처음부터 다시 연다.
  await page.goto('about:blank');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(T('place'), { timeout: 20000 });
  await sleep(1200);
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
  await sleep(160);
}
const text = (page, selector) => page.$eval(selector, (el) => (el.textContent ?? '').trim());
const exists = async (page, selector) => (await page.$(selector)) !== null;
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${name}.png`) });
const place = (page) => text(page, T('place'));
const hashCode = (page) => page.evaluate(() => window.location.hash.replace(/^#p/, ''));
const mockInfo = (page) => page.evaluate(() => ({ calls: { ...window.__mockClaude.calls }, writes: window.__mockClaude.writes.slice(), docs: window.__mockClaude.dump() }));

async function audit(page, label) {
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
      if (el.tagName === 'BUTTON' && !el.closest('.fb') && el.scrollWidth > el.clientWidth + 1) clipped.push(`${name} (글자 넘침)`);
    }
    // 순위표 안에서 옆으로 삐져나온 것이 있는지도 본다.
    const wide = [];
    for (const box of document.querySelectorAll('.rk, .dialog')) {
      const b = box.getBoundingClientRect();
      for (const el of box.querySelectorAll('*')) {
        const e = el.getBoundingClientRect();
        if (e.width > 0 && (e.right > b.right + 1 || e.left < b.left - 1)) { wide.push(el.className?.toString().slice(0, 30) || el.tagName); break; }
      }
    }
    const emoji = /\p{Extended_Pictographic}/u.test(document.body.innerText);
    return { overflow, small, clipped, wide, emoji, body: document.body.innerText };
  });
  expect(`[${label}] 가로로 넘치지 않는다`, r.overflow <= 0 && r.wide.length === 0, `넘침 ${r.overflow}px ${r.wide.join(', ')}`);
  expect(`[${label}] 누르는 곳이 모두 48px 이상`, r.small.length === 0, r.small.join(', '));
  expect(`[${label}] 화면 밖으로 나가거나 글자가 잘린 단추가 없다`, r.clipped.length === 0, r.clipped.join(', '));
  const hit = FORBIDDEN.filter((w) => r.body.includes(w));
  expect(`[${label}] 딱딱한 말과 이모지가 없다`, hit.length === 0 && !r.emoji, hit.join(', '));
}
function clean(log, label, origins = '사이트') {
  expect(`[${label}] 콘솔 오류가 없다`, log.consoleErrors.length === 0, log.consoleErrors.slice(0, 3).join(' | '));
  expect(`[${label}] ${origins} 밖으로 나간 요청이 없다`, log.external.length === 0, log.external.slice(0, 3).join(', '));
  expect(`[${label}] 실패한 요청이 없다`, log.failed.length === 0, log.failed.slice(0, 3).join(', '));
}

/** 출발선에서 던지기 단추를 톡 눌러(지난번 힘 그대로) 던지고 결과 패널을 기다린다. */
async function throwOnce(page) {
  await page.waitForSelector(T('throw-btn'), { timeout: 10000 });
  const c = await page.$eval(T('throw-btn'), (el) => {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (!page.viewport()?.hasTouch) await page.mouse.click(c.x, c.y);
  else {
    const cdp = await page.createCDPSession();
    await Promise.all([
      cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y, id: 7 }] }),
      cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
    ]);
    await cdp.detach().catch(() => {});
  }
  await sleep(900);
  if (await exists(page, T('skip'))) await tap(page, T('skip')).catch(() => {});
  await page.waitForSelector(T('result-panel'), { timeout: 40000 });
  await sleep(400);
  return { distance: await text(page, T('result-distance')), airtime: await text(page, T('result-airtime')) };
}

/** 순위표(큰 판 또는 기록장 안)의 줄을 읽는다. */
const readRows = (page, scope) => page.$$eval(`${scope} .rk-row`, (els) => els.map((el) => ({
  rank: Number(el.getAttribute('data-rank')),
  id: el.getAttribute('data-id'),
  mine: el.getAttribute('data-mine') === 'true',
  nick: el.querySelector('[data-testid="rank-nick"]')?.textContent ?? '',
  score: el.querySelector('[data-testid="rank-score"]')?.textContent ?? '',
  medal: el.querySelector('.rk-medal') !== null,
  me: el.querySelector('[data-testid="rank-me"]') !== null,
})));
/** 순위표가 다 세어질 때까지 기다린다. */
async function boardSettled(page, scope, timeout = 240000) {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(`${sel} [data-testid="ranking"], ${sel}[data-testid="ranking"]`);
    return el && el.getAttribute('data-status') === 'ready' && !el.querySelector('[data-testid="rank-pending"]');
  }, { timeout, polling: 200 }, scope);
  await sleep(300);
}
/** 독립 기준: 올바른 기록을 0.001 반올림 값 높은 순 -> 먼저 올린 순 -> id 순으로 줄 세운다. */
function expectedOrder(valid, key) {
  return valid.slice().sort((a, b) => {
    const ka = Math.round(a[key] * 1000), kb = Math.round(b[key] * 1000);
    if (ka !== kb) return kb - ka;
    if (a.at !== b.at) return a.at - b.at;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// ---------------------------------------------------------------------------
// A) window.claude 가 아예 없다 / 능력이 null 로 온다
// ---------------------------------------------------------------------------
async function absentFlow(browser, data) {
  const log = newLog();
  const page = await newPage(browser, log);
  await open(page, `${BASE}#p${data.mine.low.code}`);
  await throwOnce(page);
  expect('[없음] 결과 패널에 랭킹 단추가 없다(망가진 단추 없음)', !(await exists(page, T('rank-entry'))));
  await tap(page, T('nav-book'));
  expect('[없음] 기록장으로 간다', (await place(page)) === '기록장');
  expect('[없음] 순위표 자리에 차분한 한 줄만 있다', /이 기기에 저장돼요/.test(await text(page, T('ranking-off'))) && !(await exists(page, T('ranking'))), await text(page, T('ranking-off')));
  expect('[없음] 내 최고 기록은 그대로 보인다', (await text(page, T('best-distance'))).includes(f2(data.mine.low.distance)));
  await page.$eval(T('ranking-off'), (el) => el.scrollIntoView({ block: 'center' }));
  await shot(page, '06-unavailable');
  await audit(page, '없음');
  clean(log, '없음');
  await page.close();

  // 능력이 한참 뒤에 null 로 온다: 그동안은 "준비하고 있어요", 그다음은 같은 한 줄
  const log2 = newLog();
  const page2 = await newPage(browser, log2, { mock: { db: false, resolveDelayMs: 2500 } });
  await open(page2, BASE);
  await tap(page2, T('nav-book'));
  expect('[null] 답을 기다리는 동안 준비 중이라고 알려 준다', await exists(page2, T('ranking-checking')));
  await page2.waitForSelector(T('ranking-off'), { timeout: 8000 });
  expect('[null] 능력이 null 이면 순위표 없이 논다', !(await exists(page2, T('ranking'))) && (await page2.evaluate(() => window.__mockClaude.calls.use)) === 2);
  expect('[null] 저장소를 건드리지 않았다', await page2.evaluate(() => window.__mockClaude.calls.get + window.__mockClaude.calls.subscribe) === 0);
  clean(log2, 'null');
  await page2.close();

  // db 는 있는데 user 가 null: 구경만
  const log3 = newLog();
  const page3 = await newPage(browser, log3, { mock: { user: false } });
  await open(page3, BASE);
  await tap(page3, T('nav-book'));
  await page3.waitForSelector(T('rank-empty'), { timeout: 15000 });
  expect('[user null] 구경만 할 수 있다고 알려 주고 올리기 단추가 없다', /구경만/.test(await text(page3, T('rank-readonly'))) && !(await exists(page3, T('rank-submit-best'))));
  clean(log3, 'user null');
  await page3.close();
}

// ---------------------------------------------------------------------------
// B) 빈 순위표 -> 첫 기록 -> 친구 기록이 저절로 -> 더 좋은 기록 -> 더 나쁜 기록 -> 다른 종목 -> 지우기
// ---------------------------------------------------------------------------
async function playFlow(browser, data) {
  const log = newLog();
  const page = await newPage(browser, log, { mock: { uid: 'player-me', level: 'contributor' } });
  const { low, mid, high } = data.mine;

  await open(page, `${BASE}#p${low.code}`);
  const r1 = await throwOnce(page);
  expect('[놀이] 던진 값이 코드의 공식 값과 같다', r1.distance === f2(low.distance), `${r1.distance} / ${f2(low.distance)}`);
  await page.waitForSelector(T('rank-entry'), { timeout: 8000 });
  expect('[놀이] 결과 패널에 "랭킹에 올리기"와 "순위표"가 있다', /랭킹에 올리기/.test(await text(page, T('rank-open-submit'))) && /순위표/.test(await text(page, T('rank-open-board'))));
  expect('[놀이] 결과 패널만 봐서는 저장소를 읽지 않는다', await page.evaluate(() => window.__mockClaude.calls.subscribe + window.__mockClaude.calls.get) === 0);
  await shot(page, '08-result-entry');
  await audit(page, '결과 패널');

  // 빈 순위표
  await tap(page, T('rank-open-board'));
  await page.waitForSelector(`${T('rank-screen')} ${T('rank-empty')}`, { timeout: 15000 });
  expect('[놀이] 빈 순위표: 첫 번째로 올려 보자고 한다', /아직 아무도 없어요. 첫 번째로 올려 볼까요\?/.test(await text(page, T('rank-empty'))));
  await shot(page, '03-empty');
  await audit(page, '빈 순위표');
  await tap(page, T('rank-screen-close'));

  // 첫 기록
  await tap(page, T('rank-open-submit'));
  await page.waitForSelector(T('rank-submit-form'), { timeout: 8000 });
  expect('[놀이] 올리기 대화상자에 이번 기록이 적혀 있다', (await text(page, T('rank-submit-score'))).includes(f2(low.distance)));
  expect('[놀이] 별명을 적기 전에는 올리기 단추가 꺼져 있다', await page.$eval(T('rank-submit-send'), (el) => el.disabled));
  await page.type(T('rank-nickname'), '  종이왕 ');
  await shot(page, '07-submit-dialog');
  await audit(page, '올리기 대화상자');
  await tap(page, T('rank-submit-send'));
  await page.waitForSelector(T('rank-done'), { timeout: 15000 });
  let m = await mockInfo(page);
  expect('[놀이] 첫 기록: 내 문서 scores/player-me 에 한 번만 쓴다', m.writes.length === 1 && m.writes[0].path === 'scores/player-me' && m.writes[0].kind === 'set', JSON.stringify(m.writes.map((w) => w.path)));
  const doc1 = m.docs['player-me'];
  expect('[놀이] 쓴 문서에는 v 와 종목 기록(code, nickname, at)만 있다(점수 없음)',
    doc1 && Object.keys(doc1).sort().join(',') === 'distance,v' && Object.keys(doc1.distance).sort().join(',') === 'at,code,nickname' && doc1.v === 1, JSON.stringify(doc1));
  expect('[놀이] 쓴 코드는 던진 비행의 코드, 별명은 다듬은 것', doc1?.distance.code === low.code && doc1?.distance.nickname === '종이왕');
  expect('[놀이] 올린 뒤 내 등수를 알려 준다(1등)', (await text(page, T('rank-result-rank'))) === '1등' && (await text(page, T('official-score'))).includes(f2(low.distance)), await text(page, T('rank-done')));
  await shot(page, '09-submitted');
  await audit(page, '올린 뒤');
  await tap(page, T('rank-done-board'));
  await boardSettled(page, T('rank-screen'));
  let rows = await readRows(page, T('rank-screen'));
  expect('[놀이] 순위표에 내 줄이 "나" 딱지와 함께 보인다', rows.length === 1 && rows[0].mine && rows[0].me && rows[0].nick === '종이왕' && rows[0].score === f2(low.distance) && rows[0].medal, JSON.stringify(rows));

  // 친구의 기록이 저절로 나타난다
  const subsBefore = (await mockInfo(page)).calls.subscribe;
  await page.evaluate((f) => window.__mockClaude.remoteSet(f.id, { v: 1, distance: { code: f.code, nickname: f.nickname, at: Date.now() } }), data.friend);
  await page.waitForFunction((nick) => [...document.querySelectorAll('[data-testid="rank-screen"] [data-testid="rank-nick"]')].some((el) => el.textContent === nick), { timeout: 30000 }, data.friend.nickname);
  await boardSettled(page, T('rank-screen'));
  rows = await readRows(page, T('rank-screen'));
  expect('[놀이] 친구 기록이 새로 고침 없이 나타나고 내가 2등으로 내려간다', rows.length === 2 && rows[0].nick === data.friend.nickname && rows[0].score === f2(data.friend.distance) && rows[1].mine && rows[1].rank === 2, JSON.stringify(rows));
  expect('[놀이] 지켜보기는 한 번만 걸었다', (await mockInfo(page)).calls.subscribe === subsBefore && subsBefore === 1, `subscribe ${subsBefore}`);
  await shot(page, '04-own-row');
  await audit(page, '순위표 큰 판');
  await tap(page, T('rank-screen-close'));

  // 더 좋은 기록
  await open(page, `${BASE}#p${high.code}`);
  await throwOnce(page);
  await tap(page, T('rank-open-submit'));
  await page.waitForSelector(T('rank-submit-form'), { timeout: 8000 });
  expect('[놀이] 별명을 기억해 두었다', (await page.$eval(T('rank-nickname'), (el) => el.value)) === '종이왕');
  await tap(page, T('rank-submit-send'));
  await page.waitForSelector(T('rank-done'), { timeout: 15000 });
  m = await mockInfo(page);
  expect('[놀이] 더 좋은 기록은 바꿔 쓴다', m.writes.length === 1 && m.docs['player-me'].distance.code === high.code, `writes ${m.writes.length}`);
  await page.waitForFunction(() => document.querySelector('[data-testid="rank-result-rank"]')?.textContent === '2등', { timeout: 30000 }).catch(() => {});
  expect('[놀이] 친구(더 멀리) 다음이라 2등이라고 알려 준다', (await text(page, T('rank-result-rank'))) === '2등', await text(page, T('rank-done')));
  await tap(page, T('rank-done-close'));

  // 더 나쁜 기록: 쓰지 않고, 올려 둔 기록을 보여 준다
  await open(page, `${BASE}#p${mid.code}`);
  await throwOnce(page);
  await tap(page, T('rank-open-submit'));
  await tap(page, T('rank-submit-send'));
  await page.waitForSelector(T('rank-kept'), { timeout: 15000 });
  m = await mockInfo(page);
  expect('[놀이] 더 나쁜 기록은 쓰지 않는다(쓰기 0번)', m.calls.set === 0 && m.docs['player-me'].distance.code === high.code, `set ${m.calls.set}`);
  expect('[놀이] 올려 둔 기록이 더 좋다고 다정하게 알려 주고 그 기록을 보여 준다', /올려 둔 기록이 더 좋아요/.test(await text(page, T('rank-kept'))) && (await text(page, T('rank-kept-score'))).includes(f2(high.distance)), await text(page, T('rank-kept')));
  await shot(page, '10-kept');
  await audit(page, '그대로 두기');
  await tap(page, T('rank-done-close'));

  // 기록장에서 다른 종목(오래 날리기) 올리기: 멀리 날리기 기록을 지키며 쓴다
  await tap(page, T('nav-book'));
  await boardSettled(page, '.book');
  rows = await readRows(page, '.book');
  expect('[놀이] 기록장의 순위표에도 같은 줄이 보인다', rows.length === 2 && rows[1].mine && rows[1].score === f2(high.distance), JSON.stringify(rows));
  expect('[놀이] 내 최고 기록이 이미 올라가 있으면 올리기 단추 대신 알려 준다', (await exists(page, T('rank-already'))) && !(await exists(page, T('rank-submit-best'))));
  await tap(page, T('rank-mode-airtime'));
  await page.waitForSelector(T('rank-empty'), { timeout: 8000 });
  await tap(page, T('rank-submit-best'));
  await page.waitForSelector(T('rank-submit-form'), { timeout: 8000 });
  await tap(page, T('rank-submit-send'));
  await page.waitForSelector(T('rank-done'), { timeout: 15000 });
  m = await mockInfo(page);
  const doc2 = m.docs['player-me'];
  expect('[놀이] 오래 날리기를 올려도 멀리 날리기 기록이 남아 있다(읽고 합쳐 쓰기)', doc2.distance?.code === high.code && typeof doc2.airtime?.code === 'string' && Object.keys(doc2).sort().join(',') === 'airtime,distance,v', JSON.stringify(Object.keys(doc2)));
  expect('[놀이] 쓰기 전에 지금 문서를 읽었다', m.calls.get >= 1);
  await tap(page, T('rank-done-close'));

  // 내 기록 지우기
  await tap(page, T('rank-mode-distance'));
  await tap(page, `.book .rk-row[data-mine="true"] .rk-row__main`);
  await page.waitForSelector(T('rank-remove'), { timeout: 5000 });
  await tap(page, T('rank-remove'));
  await page.waitForSelector(T('rank-remove-confirm'), { timeout: 5000 });
  await shot(page, '11-remove-confirm');
  await audit(page, '지우기 확인');
  await tap(page, T('rank-remove-no'));
  expect('[놀이] "그대로 두기"를 누르면 지우지 않는다', (await mockInfo(page)).docs['player-me'].distance !== undefined);
  await tap(page, T('rank-remove'));
  await tap(page, T('rank-remove-yes'));
  await page.waitForFunction(() => !document.querySelector('.book .rk-row[data-mine="true"]'), { timeout: 15000 });
  m = await mockInfo(page);
  expect('[놀이] 멀리 날리기 기록만 지워지고 오래 날리기는 남는다', m.docs['player-me'] && m.docs['player-me'].distance === undefined && m.docs['player-me'].airtime !== undefined, JSON.stringify(Object.keys(m.docs['player-me'] ?? {})));
  await tap(page, T('rank-mode-airtime'));
  await tap(page, `.book .rk-row[data-mine="true"] .rk-row__main`);
  await tap(page, T('rank-remove'));
  await tap(page, T('rank-remove-yes'));
  await page.waitForFunction(() => !document.querySelector('.book .rk-row[data-mine="true"]'), { timeout: 15000 });
  m = await mockInfo(page);
  expect('[놀이] 남은 기록까지 지우면 문서가 없어진다', m.docs['player-me'] === undefined && m.calls.delete === 1, JSON.stringify(m.calls));
  expect('[놀이] 거절당한 쓰기가 없다', m.calls.rejected === 0);
  clean(log, '놀이');
  await page.close();
}

// ---------------------------------------------------------------------------
// C) 60개가 깔린 순위표(꾸민 것 10개 포함): 보이는 순서 = Node 에서 따로 계산한 순서
// ---------------------------------------------------------------------------
async function seededFlow(browser, data) {
  const seed = { ...data.docs, ...data.forged };
  const expD = expectedOrder(data.valid, 'distance');
  const expA = expectedOrder(data.valid, 'airtime');
  const log = newLog();
  const page = await newPage(browser, log, { mock: { uid: 'player-me', level: 'contributor', seed } });
  await open(page, BASE);
  await tap(page, T('nav-book'));
  await page.waitForSelector(T('ranking'), { timeout: 15000 });
  // 줄이 차례차례 채워지는지: "계산 중" 표시와 함께 줄 수가 늘어난다.
  const growth = [];
  let sawPending = false;
  const t0 = Date.now();
  for (;;) {
    const s = await page.evaluate(() => ({ pending: document.querySelector('[data-testid="rank-pending"]')?.textContent ?? null, total: Number((document.querySelector('[data-testid="rank-total"]')?.textContent ?? '0').replace(/\D/g, '')), status: document.querySelector('[data-testid="ranking"]')?.getAttribute('data-status') }));
    if (s.pending) sawPending = true;
    if (growth[growth.length - 1] !== s.total) growth.push(s.total);
    if (s.status === 'ready' && !s.pending && s.total > 0) break;
    if (Date.now() - t0 > 240000) break;
    await sleep(250);
  }
  const evalMs = Date.now() - t0;
  expect('[60개] 계산하는 동안 "계산 중"이 보이고 줄이 차례차례 채워진다', sawPending && growth.length >= 3, `줄 수 변화 ${growth.join('>')} (${Math.round(evalMs / 1000)}초)`);
  const posts1 = await page.evaluate(() => window.__workerPosts);
  const distinct = new Set(data.valid.map((v) => v.code)).size;
  expect('[60개] 계산은 Worker 에서 했고, 풀리지 않는 코드는 계산하지 않았다', posts1 >= distinct && posts1 <= distinct + 1, `Worker 에 맡긴 횟수 ${posts1} (서로 다른 올바른 코드 ${distinct}개 + 시험 코드 1)`);
  expect('[60개] 읽은 것은 지켜보기 한 번과 내 문서 한 번', await page.evaluate(() => window.__mockClaude.calls.subscribe === 1 && window.__mockClaude.calls.get === 1));

  // 기록장 안: 위에서 다섯 줄 + 메달
  const top5 = await readRows(page, `.book ${T('ranking-table')}`);
  expect('[60개] 기록장에는 위에서 다섯 줄만, 1~3등은 메달', top5.length === 5 && top5.slice(0, 3).every((r) => r.medal) && !top5[3].medal, JSON.stringify(top5.map((r) => r.rank)));
  expect('[60개] 올바른 기록 수가 맞다(꾸민 것 10개는 세지 않는다)', (await text(page, T('rank-total'))) === `${data.valid.length}명`, await text(page, T('rank-total')));
  await page.$eval(T('ranking'), (el) => el.scrollIntoView({ block: 'start' }));
  await sleep(200);
  await shot(page, '01-board-phone');
  await audit(page, '기록장 순위표');

  // 큰 판: 50줄
  await tap(page, T('rank-see-all'));
  await page.waitForSelector(T('rank-screen'), { timeout: 8000 });
  await boardSettled(page, T('rank-screen'));
  const rowsD = await readRows(page, `${T('rank-screen')} ${T('ranking-table')}`);
  const wantD = expD.slice(0, 50);
  expect('[60개] 멀리 날리기: 보이는 순서가 Node 에서 따로 계산한 순서와 같다(50줄)',
    rowsD.length === 50 && rowsD.every((r, i) => r.id === wantD[i].id && r.rank === i + 1),
    rowsD.length !== 50 ? `줄 수 ${rowsD.length}` : rowsD.map((r, i) => (r.id === wantD[i].id ? '' : `${i + 1}:${r.id}!=${wantD[i].id}`)).filter(Boolean).slice(0, 4).join(' '));
  expect('[60개] 멀리 날리기: 보이는 값이 따로 계산한 값과 같다', rowsD.every((r, i) => r.score === f2(wantD[i].distance) && r.nick === wantD[i].nickname), rowsD.map((r, i) => (r.score === f2(wantD[i].distance) ? '' : `${r.id}:${r.score}!=${f2(wantD[i].distance)}`)).filter(Boolean).slice(0, 4).join(' '));
  const shownNames = new Set(rowsD.map((r) => r.nick));
  const bodyText = await page.evaluate(() => document.body.innerText);
  expect('[60개] 꾸민 문서는 하나도 나오지 않는다', data.forgedNames.every((n) => !shownNames.has(n) && !bodyText.includes(n)) && rowsD.every((r) => !r.id.startsWith('forged')), data.forgedNames.filter((n) => bodyText.includes(n)).join(', '));
  expect('[60개] 가짜 점수(99999, 500 …)는 어디에도 보이지 않는다', !/99999|500\.00|400\.00|300\.00|200\.00/.test(bodyText));
  for (const id of data.liars) {
    const row = rowsD.find((r) => r.id === id);
    const v = data.valid.find((x) => x.id === id);
    expect(`[60개] 가짜 점수 칸을 붙인 ${id} 는 진짜 값(${f2(v.distance)} m)으로만 오른다`, row !== undefined && row.score === f2(v.distance), row?.score ?? '줄 없음');
  }
  const copy = rowsD.findIndex((r) => r.id === 'player-copycat');
  expect('[60개] 같은 점수면 먼저 올린 쪽이 위다', copy > 0 && rowsD[copy - 1].id === data.valid[3].id && rowsD[copy - 1].score === rowsD[copy].score, `따라쟁이 ${copy + 1}등`);
  // 맨 위 세 줄은 기존 도우미(e2e-core.ts)로 한 번 더 따로 계산해 본다.
  for (const r of rowsD.slice(0, 3)) {
    const core = coreValues(wantD[r.rank - 1].code);
    expect(`[60개] ${r.rank}등의 값이 e2e-core.ts 의 계산과 같다`, core.ok && core.distance === r.score, `${r.score} / ${core.distance}`);
  }
  expect('[60개] 별명은 글자로만 보인다(<b> 가 태그가 되지 않는다)', (await page.$$eval(`${T('rank-screen')} ${T('rank-nick')} b`, (els) => els.length)) === 0 && bodyText.includes('<b>굵게</b>'));
  await shot(page, '02-board-full-phone');
  await audit(page, '큰 판 50줄');

  await tap(page, `${T('rank-screen')} ${T('rank-mode-airtime')}`);
  await sleep(400);
  const rowsA = await readRows(page, `${T('rank-screen')} ${T('ranking-table')}`);
  const wantA = expA.slice(0, 50);
  expect('[60개] 오래 날리기: 보이는 순서와 값이 따로 계산한 것과 같다(50줄)',
    rowsA.length === 50 && rowsA.every((r, i) => r.id === wantA[i].id && r.score === f2(wantA[i].airtime)),
    rowsA.map((r, i) => (r.id === wantA[i]?.id ? '' : `${i + 1}:${r.id}!=${wantA[i]?.id}`)).filter(Boolean).slice(0, 4).join(' '));

  // 이 비행기 구경하기
  await tap(page, `${T('rank-screen')} ${T('rank-mode-distance')}`);
  await sleep(300);
  await tap(page, `${T('rank-screen')} ${T('rank-row-btn-2')}`);
  await page.waitForSelector(T('rank-row-more'), { timeout: 5000 });
  expect('[60개] 줄을 누르면 종이와 비행 이야기를 아이 말로 들려준다', /비행기예요\./.test(await text(page, T('rank-row-more'))) && !(await exists(page, T('rank-remove'))), await text(page, T('rank-row-more')));
  await shot(page, '12-row-open');
  await audit(page, '줄 펼침');
  await tap(page, T('rank-view'));
  await sleep(900);
  expect('[60개] "이 비행기 구경하기": 출발선으로 가고 그 비행기가 들어온다', (await place(page)) === '출발선' && (await hashCode(page)) === wantD[1].code && !(await exists(page, T('rank-screen'))), `${await place(page)} ${(await hashCode(page)).slice(0, 12)}`);
  expect('[60개] 꺼낸 비행기를 격납고에 넣어 둘지 묻는다', /격납고/.test(await text(page, T('hangar-toast-text')).catch(() => '')));
  const seen = await throwOnce(page);
  expect('[60개] 구경한 비행기를 던지면 순위표의 값이 그대로 나온다', seen.distance === f2(wantD[1].distance), `${seen.distance} / ${f2(wantD[1].distance)}`);
  // 결과 패널이 떠 있을 때 순위표에서 다른 비행기를 꺼내면 조준으로 돌아간다.
  await tap(page, T('rank-open-board'));
  await page.waitForSelector(`${T('rank-screen')} ${T('rank-row-btn-3')}`, { timeout: 15000 });
  await tap(page, `${T('rank-screen')} ${T('rank-row-btn-3')}`);
  await tap(page, T('rank-view'));
  await sleep(900);
  expect('[60개] 결과 패널에서 구경하면 조준으로 돌아가 새 비행기를 던질 수 있다', (await hashCode(page)) === wantD[2].code && (await exists(page, T('throw-btn'))) && !(await exists(page, T('result-panel'))));

  // 새로 고침 뒤: 기억해 둔 값으로 바로 채운다(시험 코드 한 번 말고는 다시 계산하지 않는다)
  await open(page, BASE);
  const mark = await page.evaluate(() => window.__workerPosts);
  await tap(page, T('nav-book'));
  const t1 = Date.now();
  await boardSettled(page, '.book');
  const quick = Date.now() - t1;
  await tap(page, T('rank-see-all'));
  await boardSettled(page, T('rank-screen'));
  const again = await readRows(page, `${T('rank-screen')} ${T('ranking-table')}`);
  const posts2 = (await page.evaluate(() => window.__workerPosts)) - mark;
  expect('[60개] 새로 고침 뒤에는 기억해 둔 코드를 다시 계산하지 않는다(시험 코드 1번만)', posts2 <= 1, `Worker 에 맡긴 횟수 ${posts2}, ${quick} ms (처음에는 ${posts1}번, ${Math.round(evalMs / 1000)}초)`);
  expect('[60개] 새로 고침 뒤에도 순서와 값이 같다', JSON.stringify(again.map((r) => [r.id, r.score])) === JSON.stringify(rowsD.map((r) => [r.id, r.score])));
  const cacheRaw = await page.evaluate(() => window.localStorage.getItem('pp.rank.cache.v1') ?? '');
  expect('[60개] 기억해 둔 값은 300개를 넘지 않고, 코드는 들어 있지 않다', JSON.parse(cacheRaw).items.length <= 300 && !cacheRaw.includes(data.valid[0].code), `${JSON.parse(cacheRaw).items.length}개`);
  clean(log, '60개');
  await page.close();

  // 넓은 화면 + 내 기록이 50등 밖
  const log2 = newLog();
  const mineDoc = { v: 1, distance: { code: data.last.code, nickname: '꼴찌여도좋아', at: Date.UTC(2026, 10, 10) }, airtime: { code: data.last.code, nickname: '꼴찌여도좋아', at: Date.UTC(2026, 10, 10) } };
  const best = { code: data.last.code, mode: 'distance', distanceM: data.last.distance, airtimeS: data.last.airtime, verdict: data.last.verdict, at: Date.now() };
  const page2 = await newPage(browser, log2, { mobile: false, mock: { uid: 'player-me', level: 'contributor', seed: { ...seed, 'player-me': mineDoc } }, storage: { 'pp.records.v1': JSON.stringify({ bestDistance: best, bestAirtime: best, recent: [best] }) } });
  await open(page2, BASE);
  await tap(page2, T('nav-book'));
  await boardSettled(page2, '.book');
  await page2.$eval(T('ranking'), (el) => el.scrollIntoView({ block: 'start' }));
  await sleep(200);
  await shot(page2, 'd-01-book-board');
  await audit(page2, '넓은 화면 기록장');
  const outside = await readRows(page2, `.book ${T('rank-mine-outside')}`);
  expect('[넓은 화면] 내 기록이 순위 밖이면 내 줄과 등수를 따로 보여 준다(51등)', outside.length === 0
    ? false : outside[0].mine && outside[0].rank === data.valid.length + 1 && outside[0].score === f2(data.last.distance), JSON.stringify(await page2.$$eval(`${T('rank-mine-outside')} .rk-row`, (els) => els.map((el) => [el.getAttribute('data-rank'), el.textContent]))));
  await tap(page2, T('rank-see-all'));
  await boardSettled(page2, T('rank-screen'));
  const wideRows = await readRows(page2, `${T('rank-screen')} ${T('ranking-table')}`);
  const wideMine = await readRows(page2, `${T('rank-screen')} ${T('rank-mine-outside')}`);
  expect('[넓은 화면] 큰 판에서도 50줄 아래에 내 줄(51등)이 "나"와 함께 보인다', wideMine.length === 1 && wideMine[0].me && wideMine[0].rank === 51);
  expect('[넓은 화면] 큰 판의 50줄도 따로 계산한 순서와 같다', wideRows.length === 50 && wideRows.every((r, i) => r.id === wantD[i].id && r.score === f2(wantD[i].distance)));
  await shot(page2, 'd-02-board-full');
  await page2.$eval(`${T('rank-screen')} .dialog__body`, (el) => { el.scrollTop = el.scrollHeight; });
  await sleep(250);
  await shot(page2, 'd-03-board-own-outside');
  await audit(page2, '넓은 화면 큰 판');
  clean(log2, '넓은 화면');
  await page2.close();
}

// ---------------------------------------------------------------------------
// D) 구경만 하는 사람 / 10초 멈춤 / 한 번만 다시 하기 / 오류 뒤 다시 해 보기
// ---------------------------------------------------------------------------
async function edgeFlow(browser, data) {
  const few = Object.fromEntries(Object.entries(data.docs).slice(0, 4));
  const best = { code: data.mine.high.code, mode: 'distance', distanceM: data.mine.high.distance, airtimeS: data.mine.high.airtime, verdict: data.mine.high.verdict, at: Date.now() };
  const storage = { 'pp.records.v1': JSON.stringify({ bestDistance: best, bestAirtime: best, recent: [best] }) };

  // 구경만(미리 안다: can = false)
  {
    const log = newLog();
    const page = await newPage(browser, log, { mock: { uid: 'viewer-1', level: 'viewer', seed: few }, storage });
    await open(page, `${BASE}#p${data.mine.low.code}`);
    await throwOnce(page);
    await page.waitForSelector(T('rank-entry'), { timeout: 8000 });
    expect('[구경만] 결과 패널에는 "순위표 구경하기"만 있고 올리기 단추는 없다', !(await exists(page, T('rank-open-submit'))) && /순위표 구경하기/.test(await text(page, T('rank-open-board'))));
    await audit(page, '구경만 결과 패널');
    await tap(page, T('nav-book'));
    await boardSettled(page, '.book');
    const rows = await readRows(page, '.book');
    expect('[구경만] 순위표는 읽을 수 있다', rows.length === 4);
    expect('[구경만] 구경만 할 수 있다고, 어떻게 하면 올릴 수 있는지 알려 준다', /구경만 할 수 있어요/.test(await text(page, T('rank-readonly'))) && /기여자/.test(await text(page, T('rank-readonly'))) && !(await exists(page, T('rank-submit-best'))), await text(page, T('rank-readonly')));
    expect('[구경만] 쓰려고 하지 않았다', await page.evaluate(() => window.__mockClaude.calls.set + window.__mockClaude.calls.delete) === 0);
    await page.$eval(T('ranking'), (el) => el.scrollIntoView({ block: 'start' }));
    await sleep(200);
    await shot(page, '05-read-only');
    await audit(page, '구경만');
    clean(log, '구경만');
    await page.close();
  }
  // 구경만(미리 모른다: can = null) -> 올려 보다가 거절당하면 그때부터 구경만
  {
    const log = newLog();
    const page = await newPage(browser, log, { mock: { uid: 'viewer-2', level: 'viewer', can: null, seed: few }, storage });
    await open(page, BASE);
    await tap(page, T('nav-book'));
    await boardSettled(page, '.book');
    await tap(page, T('rank-submit-best'));
    await page.waitForSelector(T('rank-submit-form'), { timeout: 8000 });
    await page.type(T('rank-nickname'), '구경꾼');
    await tap(page, T('rank-submit-send'));
    await page.waitForSelector(T('rank-readonly-dialog'), { timeout: 15000 });
    const m = await mockInfo(page);
    expect('[거절] 쓰기가 거절되면(invalid_argument) 다정하게 알려 준다', /구경만 할 수 있어요/.test(await text(page, T('rank-readonly-dialog'))) && m.calls.rejected === 1 && m.calls.set === 1 && m.docs['viewer-2'] === undefined, JSON.stringify(m.calls));
    await shot(page, '13-rejected');
    await audit(page, '거절');
    await tap(page, T('rank-done-close'));
    expect('[거절] 이번 방문 동안 구경만 하는 화면으로 바뀐다(올리기 단추 없음)', (await exists(page, T('rank-readonly'))) && !(await exists(page, T('rank-submit-best'))));
    expect('[거절] 다시 쓰려고 하지 않는다', (await mockInfo(page)).calls.set === 1);
    clean(log, '거절');
    await page.close();
  }
  // 10초 멈춤
  {
    const log = newLog();
    const page = await newPage(browser, log, { mock: { uid: 'player-me', stallSnapshots: true } });
    await open(page, BASE);
    const boot = await page.evaluate(() => window.__bootMark);
    await tap(page, T('nav-book'));
    await page.waitForSelector(T('rank-loading'), { timeout: 8000 });
    const t0 = Date.now();
    await sleep(8000);
    expect('[멈춤] 8초까지는 가져오는 중이라고 한다', (await exists(page, T('rank-loading'))) && !(await exists(page, T('rank-stalled'))));
    await page.waitForSelector(T('rank-stalled'), { timeout: 6000 });
    const took = Date.now() - t0;
    expect('[멈춤] 10초쯤 지나면 "지금은 순위를 불러올 수 없어요"', /지금은 순위를 불러올 수 없어요/.test(await text(page, T('rank-stalled'))) && took >= 9000 && took <= 12500, `${took} ms`);
    expect('[멈춤] 페이지를 새로 읽지 않았다', (await page.evaluate(() => window.__bootMark)) === boot);
    await shot(page, '14-stalled');
    await audit(page, '멈춤');
    await tap(page, T('rank-retry'));
    const c = (await mockInfo(page)).calls;
    expect('[멈춤] "다시 해 보기"는 옛 지켜보기를 끊고 새로 하나만 건다', c.subscribe === 2 && c.unsubscribe === 1 && (await exists(page, T('rank-loading'))), JSON.stringify(c));
    clean(log, '멈춤');
    await page.close();
  }
  // 읽기 오류 -> 다시 해 보기
  {
    const log = newLog();
    const page = await newPage(browser, log, { mock: { uid: 'player-me', snapshotError: 'unavailable', seed: few } });
    await open(page, BASE);
    await tap(page, T('nav-book'));
    await page.waitForSelector(T('rank-error'), { timeout: 8000 });
    expect('[오류] 가져오지 못하면 알려 주고 "다시 해 보기"를 준다', /가져오지 못했어요/.test(await text(page, T('rank-error'))));
    await audit(page, '오류');
    await tap(page, T('rank-retry'));
    await boardSettled(page, '.book');
    expect('[오류] 다시 해 보면 순위표가 나온다', (await readRows(page, '.book')).length === 4);
    clean(log, '오류');
    await page.close();
  }
  // 쓰기: unavailable 한 번 -> 쉬었다가 한 번 더
  {
    const log = newLog();
    const page = await newPage(browser, log, { mock: { uid: 'player-me', level: 'contributor', failSet: ['unavailable'] }, storage });
    await open(page, BASE);
    await tap(page, T('nav-book'));
    await page.waitForSelector(T('rank-empty'), { timeout: 15000 });
    await tap(page, T('rank-submit-best'));
    await page.type(T('rank-nickname'), '끈기');
    await tap(page, T('rank-submit-send'));
    await page.waitForSelector(T('rank-done'), { timeout: 15000 });
    const m = await mockInfo(page);
    expect("[다시] 'unavailable' 한 번은 쉬었다가 한 번 더 해서 올린다(set 2번, 문서 1개)", m.calls.set === 2 && m.writes.length === 1 && m.docs['player-me']?.distance.code === data.mine.high.code, JSON.stringify(m.calls));
    clean(log, '다시');
    await page.close();
  }
  // 쓰기: unavailable 두 번 -> 그만두고 알려 준다. 구경만으로 바뀌지는 않는다.
  {
    const log = newLog();
    const page = await newPage(browser, log, { mock: { uid: 'player-me', level: 'contributor', failSet: ['unavailable', 'unavailable'] }, storage });
    await open(page, BASE);
    await tap(page, T('nav-book'));
    await page.waitForSelector(T('rank-empty'), { timeout: 15000 });
    await tap(page, T('rank-submit-best'));
    await page.type(T('rank-nickname'), '끈기');
    await tap(page, T('rank-submit-send'));
    await page.waitForSelector(T('rank-submit-errors'), { timeout: 15000 });
    const m = await mockInfo(page);
    expect('[다시] 두 번 다 안 되면 더 하지 않고 알려 준다(set 2번, 문서 없음)', m.calls.set === 2 && m.docs['player-me'] === undefined && /조금 있다가 다시/.test(await text(page, T('rank-submit-errors'))), await text(page, T('rank-submit-errors')));
    await tap(page, T('rank-submit-send'));
    await page.waitForSelector(T('rank-done'), { timeout: 15000 });
    expect('[다시] 사람이 다시 누르면 올라간다', (await mockInfo(page)).docs['player-me']?.distance.code === data.mine.high.code);
    clean(log, '다시 2');
    await page.close();
  }
}

// ---------------------------------------------------------------------------
// E) 진짜 랭킹 서버(HTTP) 길: 예전 그대로 움직이는지
// ---------------------------------------------------------------------------
async function httpFlow(browser, data) {
  const API_PORT = 4181, SITE_PORT = 4180;
  const API = `http://127.0.0.1:${API_PORT}`;
  const SITE = `http://127.0.0.1:${SITE_PORT}/`;
  build('dist-rank-api', { VITE_API_URL: API });
  const server = spawn('npx', ['tsx', 'server/index.ts'], { cwd: ROOT, env: { ...process.env, PORT: String(API_PORT), HOST: '127.0.0.1', DATA_FILE: '' }, stdio: 'ignore', detached: true });
  let preview = null;
  try {
    for (let i = 0; i < 80 && !(await reachable(`${API}/api/health`)); i++) await sleep(250);
    expect('[서버] 진짜 랭킹 서버가 떴다', await reachable(`${API}/api/health`));
    preview = await startPreview(SITE_PORT, 'dist-rank-api');
    // 다른 선수 한 명을 서버에 먼저 올려 둔다(서버가 직접 다시 계산한다).
    const pre = await (await fetch(`${API}/api/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: data.friend.code, mode: 'distance', nickname: data.friend.nickname }) })).json();
    expect('[서버] 서버의 계산이 따로 계산한 값과 같다', pre.ok && Math.abs(pre.entry.score - data.friend.distance) < 1e-9, `${pre.entry?.score} / ${data.friend.distance}`);

    const log = newLog();
    const posts = [];
    // window.claude 흉내가 있어도 서버 주소가 정해진 판은 서버를 쓴다.
    const page = await newPage(browser, log, { origins: [SITE, API], mock: { uid: 'player-me', level: 'contributor' } });
    page.on('request', (r) => { if (r.method() === 'POST') posts.push({ url: r.url(), body: r.postData() }); });
    await open(page, `${SITE}#p${data.mine.high.code}`);
    await throwOnce(page);
    await tap(page, T('rank-open-submit'));
    await page.waitForSelector(T('rank-submit-form'), { timeout: 8000 });
    await page.type(T('rank-nickname'), '서버선수');
    await tap(page, T('rank-submit-send'));
    await page.waitForSelector(T('rank-done'), { timeout: 15000 });
    expect('[서버] 올리면 서버가 돌려준 공식 기록과 등수를 보여 준다', (await text(page, T('official-score'))).includes(f2(data.mine.high.distance)) && (await text(page, T('rank-result-rank'))) === '2등', await text(page, T('rank-done')));
    expect('[서버] 보내는 값은 code, mode, nickname 뿐이다(점수는 보내지 않는다)', posts.length === 1 && Object.keys(JSON.parse(posts[0].body)).sort().join(',') === 'code,mode,nickname' && JSON.parse(posts[0].body).code === data.mine.high.code, posts[0]?.body);
    expect('[서버] 서버 판에서는 페이지 저장소를 건드리지 않는다', await page.evaluate(() => window.__mockClaude.calls.use + window.__mockClaude.calls.subscribe + window.__mockClaude.calls.set) === 0);
    await shot(page, '20-http-submitted');
    await audit(page, '서버 올린 뒤');
    await tap(page, T('rank-done-close'));
    await tap(page, T('nav-book'));
    await page.waitForSelector(T('ranking-table'), { timeout: 10000 });
    const rows = await readRows(page, '.book');
    expect('[서버] 기록장의 순위표를 서버에서 읽어 온다(친구 1등, 나 2등)', rows.length === 2 && rows[0].nick === data.friend.nickname && rows[0].score === f2(data.friend.distance) && rows[1].nick === '서버선수' && rows[1].mine, JSON.stringify(rows));
    expect('[서버] 예전 검사가 쓰는 표식이 그대로 있다(.rank__item, ranking, rank-mode-airtime)', (await page.$$('.rank__item')).length === 2 && (await exists(page, T('ranking'))) && (await exists(page, T('rank-mode-airtime'))));
    const board = await (await fetch(`${API}/api/leaderboard?mode=distance&limit=50`)).json();
    expect('[서버] 서버에 실제로 두 건이 있다', board.ok && board.entries.length === 2 && board.entries[1].nickname === '서버선수');
    await page.$eval(T('ranking'), (el) => el.scrollIntoView({ block: 'start' }));
    await sleep(200);
    await shot(page, '21-http-board');
    await audit(page, '서버 순위표');
    // 예전 길(자랑하기 대화상자의 랭킹 올리기)도 그대로 있다.
    clean(log, '서버', '사이트와 랭킹 서버');
    // 서버가 꺼지면
    try { process.kill(-server.pid); } catch { /* 이미 끝남 */ }
    await sleep(600);
    log.failed.length = 0; log.consoleErrors.length = 0;
    await tap(page, T('rank-mode-airtime'));
    await page.waitForSelector(T('ranking-errors'), { timeout: 15000 });
    expect('[서버] 서버가 꺼지면 연결 실패를 알려 준다', /연결하지 못했어요/.test(await text(page, T('ranking-errors'))));
    await audit(page, '서버 꺼짐');
    await page.close();
  } finally {
    stop(preview);
    try { process.kill(-server.pid); } catch { /* 이미 끝남 */ }
    rmSync(join(ROOT, 'dist-rank-api'), { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
async function run() {
  const gen = spawnSync('npx', ['tsx', 'scripts/e2e-ranking-data.ts'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (gen.status !== 0) throw new Error(`검사 자료를 만들지 못했어요: ${gen.stderr}`);
  const data = JSON.parse(gen.stdout.trim().split('\n').pop());
  expect('검사 자료: 올바른 기록 50개 + 꾸민 문서 10개', data.valid.length === 50 && Object.keys(data.forged).length === 10 && Object.keys(data.docs).length === 50);

  build(OUT_DIR);
  const preview = await startPreview(PORT, OUT_DIR);
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
  try {
    if (!only || only === 'absent') await absentFlow(browser, data);
    if (!only || only === 'play') await playFlow(browser, data);
    if (!only || only === 'seeded') await seededFlow(browser, data);
    if (!only || only === 'edge') await edgeFlow(browser, data);
    if ((!only && WITH_HTTP) || only === 'http') await httpFlow(browser, data);
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
    console.log(`지금까지 실패 ${failures.length}개`);
    for (const f of failures) console.log(` - ${f}`);
    process.exit(1);
  },
);
