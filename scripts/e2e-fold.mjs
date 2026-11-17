/**
 * 접기 판(FoldBoard) 화면 시험. 실험실 화면(fold-lab.html)을 실제 크롬으로 열어 손가락/마우스로 접어 본다.
 *
 * 실행: node scripts/e2e-fold.mjs
 * - 개발 서버(npx vite --port 5199)를 스스로 띄우고, 끝나면 끈다.
 * - 화면 크기는 휴대폰(360 x 740, 터치).
 * - 단계마다 screenshots/fold/ 에 그림을 남긴다.
 * - 하나라도 어긋나면 종료 코드 1.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5199;
const URL = `http://localhost:${PORT}/fold-lab.html`;
const SHOTS = resolve(ROOT, 'screenshots/fold');
mkdirSync(SHOTS, { recursive: true });

const A4 = { w: 0.21, h: 0.297 };
const TOP = A4.h / 2;
const LEFT = -A4.w / 2;

let failures = 0;
const check = (ok, name, detail = '') => {
  if (ok) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name} ${detail}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 개발 서버
// ---------------------------------------------------------------------------
async function startServer() {
  const child = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(URL);
      if (res.ok) return child;
    } catch { /* 아직 안 떴음 */ }
    await sleep(250);
  }
  stopServer(child);
  throw new Error('개발 서버가 뜨지 않았어요');
}
function stopServer(child) {
  try { process.kill(-child.pid); } catch { /* 이미 끝남 */ }
}

// ---------------------------------------------------------------------------
// 화면 도우미
// ---------------------------------------------------------------------------
/** 종이 좌표(m) -> 화면 좌표(px). 판이 쓰는 것과 같은 변환 행렬을 쓴다. */
async function toClient(page, p) {
  return page.evaluate(({ x, y }) => {
    const svg = document.querySelector('[data-testid="fb-svg"]');
    const m = svg.getScreenCTM();
    const mx = x * 1000;
    const my = -y * 1000;
    return { x: m.a * mx + m.c * my + m.e, y: m.b * mx + m.d * my + m.f };
  }, p);
}
const lab = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__foldLab)));
const foldCount = async (page) => (await lab(page)).folds.length;
const text = (page, testId) => page.$eval(`[data-testid="${testId}"]`, (el) => el.textContent ?? '');
const shot = (page, name) => page.screenshot({ path: resolve(SHOTS, `${name}.png`) });

/** 단추를 화면 가운데로 옮긴 뒤 손가락으로 누른다. */
async function tap(page, testId) {
  const sel = `[data-testid="${testId}"]`;
  await page.waitForSelector(sel, { timeout: 5000 });
  const box = await page.$eval(sel, (el) => {
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.touchscreen.tap(box.x, box.y);
  await sleep(80);
}
const toTop = async (page) => { await page.evaluate(() => window.scrollTo(0, 0)); await sleep(60); };

/**
 * 손가락으로 끈다. from, to 는 종이 좌표(m). midway 가 있으면 놓기 직전에 불러 준다(그림 찍기, 확인용).
 * 실제 손가락처럼 여러 번에 나눠 움직인다.
 */
async function touchDrag(page, from, to, midway) {
  await toTop(page);
  const a = await toClient(page, from);
  const b = await toClient(page, to);
  await page.touchscreen.touchStart(a.x, a.y);
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await page.touchscreen.touchMove(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
    await sleep(22);
  }
  await sleep(60);
  if (midway) await midway(b);
  await page.touchscreen.touchEnd();
  await sleep(120);
}

async function mouseDrag(page, from, to) {
  await toTop(page);
  const a = await toClient(page, from);
  const b = await toClient(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8);
    await sleep(20);
  }
  await sleep(60);
  await page.mouse.up();
  await sleep(120);
}

/** 길잡이가 가리키는 "잡을 곳"과 "가져갈 곳"을 화면에서 읽는다(종이 좌표 m). */
async function readCue(page) {
  return page.evaluate(() => {
    const dot = document.querySelector('.fb-cue__dot');
    const dest = document.querySelector('.fb-cue__dest');
    if (!dot || !dest) return null;
    const pt = (el) => ({ x: Number(el.getAttribute('cx')) / 1000, y: -Number(el.getAttribute('cy')) / 1000 });
    return { grab: pt(dot), dest: pt(dest) };
  });
}

const sameFolds = (a, b, tol = 1e-9) => a.length === b.length && a.every((f, i) => f.dir === b[i].dir
  && Math.abs(f.a.x - b[i].a.x) < tol && Math.abs(f.a.y - b[i].a.y) < tol
  && Math.abs(f.b.x - b[i].b.x) < tol && Math.abs(f.b.y - b[i].b.y) < tol);

// ---------------------------------------------------------------------------
// 시험
// ---------------------------------------------------------------------------
async function run(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 360, height: 740, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const errors = [];
  const external = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', async (d) => { errors.push(`대화상자가 떴어요: ${d.message()}`); await d.dismiss(); });
  page.on('request', (r) => { if (!r.url().startsWith(`http://localhost:${PORT}/`) && !r.url().startsWith('data:')) external.push(r.url()); });

  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid="fb-svg"]');
  await sleep(1300); // 손 모양이 움직이는 중간쯤

  console.log('1. 처음 화면');
  await shot(page, '01-start');
  check((await text(page, 'fb-title')).includes('모서리를 잡고 끌어'), '처음 안내 문구');
  check(await page.$('.fb-cue__hand') !== null, '손 모양 길잡이가 보인다');
  check((await text(page, 'fb-count')).replace(/\s+/g, ' ').includes('접은 횟수 0 / 24'), '접은 횟수 0 / 24');
  const layout = await page.evaluate(() => {
    const desk = document.querySelector('.fb-desk').getBoundingClientRect();
    const svg = document.querySelector('[data-testid="fb-svg"]');
    const small = [...document.querySelectorAll('.fb button')].filter((b) => {
      const r = b.getBoundingClientRect();
      return r.height < 48 || r.width < 48;
    }).map((b) => b.getAttribute('data-testid'));
    const unlabeled = [...document.querySelectorAll('.fb button')].filter((b) => !(b.getAttribute('aria-label') || b.textContent.trim())).length;
    return {
      scrollW: document.documentElement.scrollWidth,
      deskH: desk.height,
      deskBottom: desk.bottom,
      touchSvg: getComputedStyle(svg).touchAction,
      touchBody: getComputedStyle(document.body).touchAction,
      touchHint: getComputedStyle(document.querySelector('[data-testid="fb-hint"]')).touchAction,
      small,
      unlabeled,
      canScroll: document.documentElement.scrollHeight > window.innerHeight,
      sticky: [...document.querySelectorAll('.fb *')].filter((el) => ['sticky', 'fixed'].includes(getComputedStyle(el).position)).length,
    };
  });
  check(layout.scrollW <= 360, '가로로 넘치지 않는다(360px)', String(layout.scrollW));
  check(layout.deskH <= 740 * 0.6 + 1, '책상이 화면 높이의 60% 안', String(layout.deskH));
  check(layout.touchSvg === 'none' && layout.touchBody !== 'none' && layout.touchHint !== 'none', '종이 위에서만 스크롤을 막는다', JSON.stringify(layout));
  check(layout.small.length === 0, '모든 단추가 48px 이상', layout.small.join(','));
  check(layout.unlabeled === 0, '모든 단추에 이름이 있다');
  check(layout.sticky === 0, '판 안에 화면에 달라붙는 요소가 없다');

  // 판 바깥에서 손가락으로 밀면 화면이 스크롤된다.
  if (layout.canScroll) {
    const hint = await page.$eval('[data-testid="fb-hint"]', (el) => { const r = el.getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 }; });
    await page.touchscreen.touchStart(hint.x, hint.y);
    for (let i = 1; i <= 6; i++) { await page.touchscreen.touchMove(hint.x, hint.y - i * 25); await sleep(16); }
    await page.touchscreen.touchEnd();
    await sleep(250);
    const y = await page.evaluate(() => window.scrollY);
    check(y > 20, '판 바깥을 밀면 화면이 스크롤된다', String(y));
    // 종이 위에서 밀면 스크롤되지 않는다.
    await toTop(page);
  }

  console.log('2. 모서리를 잡아 가운데 선으로 (양쪽 같이 접기 켬)');
  let seenBubble = null;
  await touchDrag(page, { x: LEFT + 0.003, y: TOP - 0.004 }, { x: 0.004, y: TOP - 0.102 }, async (finger) => {
    await shot(page, '02-dragging-snap');
    seenBubble = await page.evaluate((f) => {
      const b = document.querySelector('[data-testid="fb-bubble"]');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      const inside = f.x >= r.left && f.x <= r.right && f.y >= r.top && f.y <= r.bottom;
      const gap = f.y - r.bottom;
      return { text: b.textContent, inside, gap, left: r.left, right: r.right, top: r.top };
    }, finger);
  });
  check(seenBubble?.text === '가운데 선에 딱!', '끄는 동안 "가운데 선에 딱!" 말풍선', JSON.stringify(seenBubble));
  check(!!seenBubble && !seenBubble.inside && seenBubble.gap >= 20, '말풍선이 손가락에 가려지지 않는다', JSON.stringify(seenBubble));
  check(!!seenBubble && seenBubble.left >= 0 && seenBubble.right <= 360 && seenBubble.top >= 0, '말풍선이 화면 안에 있다');
  check(await page.evaluate(() => window.scrollY) === 0, '종이를 끄는 동안 화면이 스크롤되지 않는다');
  let st = await lab(page);
  check(st.folds.length === 2, '접기 2개가 더해졌다(왼쪽 + 오른쪽)', String(st.folds.length));
  const dartFirst = [
    { a: { x: -0.105, y: 0.0435 }, b: { x: 0, y: 0.1485 }, dir: 'valley' },
    { a: { x: 0, y: 0.1485 }, b: { x: 0.105, y: 0.0435 }, dir: 'valley' },
  ];
  check(sameFolds(st.folds, dartFirst), '맞춤 도우미 덕분에 정확히 45도로 접혔다', JSON.stringify(st.folds));
  check(st.sounds.includes('snap') && st.sounds[st.sounds.length - 1] === 'fold', "소리: 붙을 때 'snap', 접힐 때 'fold'", st.sounds.join(','));
  check(await page.$('.fb-cue__hand') === null, '첫 손길 뒤에는 안내 손이 사라진다');
  await sleep(300);
  await shot(page, '03-folded');

  console.log('3. 되돌리기 / 다시 하기');
  await tap(page, 'fb-undo');
  check(await foldCount(page) === 0, '되돌리기 -> 0개');
  await tap(page, 'fb-redo');
  check(await foldCount(page) === 2, '다시 하기 -> 2개');

  console.log('4. 뒤로 접기');
  await tap(page, 'fb-toggle-dir');
  check(await page.$eval('[data-testid="fb-toggle-dir"]', (el) => el.getAttribute('data-dir')) === 'mountain', '방향 단추가 "뒤로 접기"가 됐다');
  await touchDrag(page, { x: LEFT + 0.002, y: -TOP + 0.003 }, { x: -0.05, y: -TOP + 0.06 }, async () => { await shot(page, '04-dragging-back'); });
  st = await lab(page);
  check(st.folds.length === 4 && st.folds[2].dir === 'mountain' && st.folds[3].dir === 'mountain', '뒤로 접기 2개가 더해졌다', JSON.stringify(st.folds.slice(2)));
  await tap(page, 'fb-toggle-dir');
  await sleep(250);
  await shot(page, '05-after-back-fold');

  console.log('5. 딱 붙이기 끔 + 양쪽 같이 접기 끔');
  await tap(page, 'fb-toggle-snap');
  await tap(page, 'fb-toggle-both');
  let bubbleOff = 'unset';
  await touchDrag(page, { x: 0.104, y: -0.03 }, { x: 0.006, y: -0.05 }, async () => {
    bubbleOff = await page.evaluate(() => document.querySelector('[data-testid="fb-bubble"]')?.textContent ?? null);
  });
  st = await lab(page);
  check(bubbleOff === null, '붙이기를 끄면 말풍선이 없다', String(bubbleOff));
  check(st.folds.length === 5, '한 번만 접혔다(양쪽 같이 접기 끔)', String(st.folds.length));
  {
    // 잡은 점(오른쪽 가장자리)이 접힌 뒤 놓이는 자리의 x 가 0 이 아니어야 한다(가운데 선에 붙지 않았다).
    const f = st.folds[4];
    const dx = f.b.x - f.a.x; const dy = f.b.y - f.a.y; const l2 = dx * dx + dy * dy;
    const g = { x: 0.105, y: -0.03 };
    const t = ((g.x - f.a.x) * dx + (g.y - f.a.y) * dy) / l2;
    const landedX = 2 * (f.a.x + dx * t) - g.x;
    check(Math.abs(landedX) > 0.002, '가운데 선에 붙지 않고 손가락 자리 그대로 접혔다', String(landedX));
  }
  await tap(page, 'fb-toggle-snap');
  await tap(page, 'fb-toggle-both');

  console.log('6. 접을 수 없는 끌기는 취소된다');
  let before = await foldCount(page);
  let soundsBefore = (await lab(page)).sounds.length;
  // 뾰족한 꼭대기를 종이 바깥쪽으로 끌면 접는 선이 종이를 지나지 않는다.
  await touchDrag(page, { x: 0.001, y: TOP - 0.002 }, { x: 0.006, y: TOP + 0.011 }, async () => { await shot(page, '06-dragging-invalid'); });
  st = await lab(page);
  check(st.folds.length === before, '종이 밖으로 끌면 접히지 않는다', String(st.folds.length));
  check(st.sounds.slice(soundsBefore).includes('nope'), "소리 'nope'", st.sounds.slice(soundsBefore).join(','));
  check(await page.$eval('[data-testid="fb-hint"]', (el) => el.classList.contains('is-warn') && el.textContent.length > 4), '쉬운 말로 이유를 알려 준다', await text(page, 'fb-hint'));
  check(await page.$('.fb-paper--nope') !== null, '종이가 살짝 흔들린다');
  await shot(page, '07-nope');
  // 끌었다가 제자리로 돌아오면 취소
  {
    await toTop(page);
    const a = await toClient(page, { x: 0.001, y: TOP - 0.002 });
    await page.touchscreen.touchStart(a.x, a.y);
    for (const d of [20, 45, 70, 40, 12, 2]) { await page.touchscreen.touchMove(a.x - d * 0.3, a.y + d); await sleep(20); }
    await page.touchscreen.touchEnd();
    await sleep(120);
    check(await foldCount(page) === before, '끌었다가 제자리로 돌아오면 접히지 않는다');
  }
  // 종이가 없는 곳(접혀서 비어 있는 책상 자리)을 눌러 끌어도 아무 일 없다
  {
    const a = await toClient(page, { x: LEFT + 0.01, y: TOP - 0.01 });
    await page.touchscreen.touchStart(a.x, a.y);
    await page.touchscreen.touchMove(a.x + 60, a.y + 60);
    await page.touchscreen.touchEnd();
    await sleep(80);
    check(await foldCount(page) === before, '책상을 끌어도 아무 일 없다', String(await foldCount(page)));
  }

  console.log('7. 처음부터 (판 안에서 되묻기)');
  await tap(page, 'fb-reset');
  check(await page.$('[data-testid="fb-reset-ask"]') !== null, '되묻는 줄이 판 안에 나온다');
  await shot(page, '08-reset-ask');
  await tap(page, 'fb-reset-no');
  check(await foldCount(page) > 0, '"아니요"면 그대로');
  await tap(page, 'fb-reset');
  await tap(page, 'fb-reset-yes');
  check(await foldCount(page) === 0, '"응"이면 빈 종이');

  console.log('8. 두 번째 손가락은 무시한다');
  {
    await toTop(page);
    const a = await toClient(page, { x: LEFT + 0.002, y: -0.02 });
    const b = await toClient(page, { x: -0.06, y: -0.02 });
    const c = await toClient(page, { x: 0.06, y: 0.0 });
    const t1 = await page.touchscreen.touchStart(a.x, a.y);
    await t1.move(a.x + 10, a.y);
    const t2 = await page.touchscreen.touchStart(c.x, c.y);
    await t2.move(c.x + 30, c.y + 30);
    for (let i = 1; i <= 5; i++) { await t1.move(a.x + ((b.x - a.x) * i) / 5, a.y); await sleep(20); }
    await t2.end();
    await sleep(40);
    const mid = await foldCount(page);
    await t1.end();
    await sleep(120);
    st = await lab(page);
    check(mid === 0 && st.folds.length === 2, '첫 손가락의 끌기만 접기가 된다', `${mid} -> ${st.folds.length}`);
    await tap(page, 'fb-undo');
  }

  console.log('9. 마우스로도 접힌다');
  await mouseDrag(page, { x: 0.104, y: TOP - 0.002 }, { x: -0.003, y: TOP - 0.104 });
  st = await lab(page);
  check(st.folds.length === 2 && sameFolds(st.folds, [dartFirst[1], dartFirst[0]]), '마우스 끌기로 접기 2개(오른쪽 먼저)', JSON.stringify(st.folds));

  console.log('10. 선 그어 접기(고급), 펼친 그림');
  check(await page.$('#fb-adv-panel') === null, '고급 칸은 처음에 접혀 있다');
  await tap(page, 'fb-adv-toggle');
  await tap(page, 'fb-toggle-crease');
  await toTop(page);
  check((await page.$$('.fb-crease')).length === 2, '펼친 그림에 접은 선 2개');
  check(await page.$eval('[data-testid="fb-svg"]', (el) => getComputedStyle(el).touchAction) !== 'none', '펼친 그림에서는 스크롤을 막지 않는다');
  await shot(page, '09-crease-pattern');
  await tap(page, 'fb-crease-back');
  await tap(page, 'fb-toggle-line');
  before = await foldCount(page);
  {
    await toTop(page);
    const a = await toClient(page, { x: LEFT, y: -0.05 });
    const b = await toClient(page, { x: 0.105, y: -0.05 });
    await page.touchscreen.touchStart(a.x + 2, a.y + 2);
    for (let i = 1; i <= 6; i++) { await page.touchscreen.touchMove(a.x + ((b.x - a.x) * i) / 6, a.y + 1); await sleep(20); }
    await page.touchscreen.touchEnd();
    await sleep(120);
  }
  check(await page.$('[data-testid="fb-line-bar"]') !== null, '선을 그으면 "이 선으로 접기" 줄이 나온다');
  check(await foldCount(page) === before, '선만 그어서는 아직 접히지 않는다');
  await shot(page, '10-line-mode');
  await tap(page, 'fb-line-ok');
  check(await foldCount(page) === before + 1, '"이 선으로 접기"를 누르면 접힌다(가로선은 한 번)');
  await tap(page, 'fb-toggle-line');
  await tap(page, 'fb-adv-toggle');

  console.log('11. 따라 접기(다트)');
  await tap(page, 'lab-guide-dart');
  await toTop(page);
  await sleep(1500);
  st = await lab(page);
  const guide = st.guide;
  check(Array.isArray(guide) && guide.length === 4 && st.folds.length === 0, '길잡이 4단계, 빈 종이에서 시작');
  check((await text(page, 'fb-title')) === '1번째 접기 (전체 4번)', '단계 이름', await text(page, 'fb-title'));
  check(await page.$('[data-testid="fb-skip"]') !== null && await page.$('[data-testid="fb-adv-toggle"]') === null, '건너뛰기가 보이고 고급 칸은 숨는다');
  await shot(page, '11-guide-start');

  // 엉뚱한 곳을 접으면 받아 주지 않는다.
  await touchDrag(page, { x: 0.104, y: -TOP + 0.002 }, { x: 0.03, y: -0.06 });
  check(await foldCount(page) === 0, '안내와 다른 접기는 접히지 않는다');
  check((await text(page, 'fb-hint')) === '조금만 더 맞춰 볼까요?', '"조금만 더 맞춰 볼까요?"', await text(page, 'fb-hint'));

  // 한 단계씩(양쪽 같이 접기 끔): 안내한 점을 잡아 안내한 곳으로. 손가락은 일부러 조금 어긋나게.
  await tap(page, 'fb-toggle-both');
  for (let step = 0; step < 2; step++) {
    await toTop(page);
    const cue = await readCue(page);
    check(!!cue, `${step + 1}단계 길잡이 표시가 있다`);
    await touchDrag(page, { x: cue.grab.x + 0.002, y: cue.grab.y - 0.002 }, { x: cue.dest.x + 0.004, y: cue.dest.y + 0.005 }, step === 0 ? async () => { await shot(page, '12-guide-dragging'); } : undefined);
    check(await foldCount(page) === step + 1, `${step + 1}단계를 따라 접었다`, String(await foldCount(page)));
  }
  check((await text(page, 'fb-title')) === '3번째 접기 (전체 4번)', '3번째 단계로 넘어갔다', await text(page, 'fb-title'));
  check((await lab(page)).guideDone === 0, '아직 끝나지 않았다');
  await sleep(1400);
  await shot(page, '13-guide-step3');
  // 나머지 두 단계는 양쪽 같이 접기로 한 번에
  await tap(page, 'fb-toggle-both');
  {
    await toTop(page);
    const cue = await readCue(page);
    await touchDrag(page, { x: cue.grab.x + 0.002, y: cue.grab.y + 0.002 }, { x: cue.dest.x - 0.003, y: cue.dest.y + 0.004 });
  }
  st = await lab(page);
  check(st.folds.length === 4, '4단계까지 접었다', String(st.folds.length));
  check(sameFolds(st.folds, guide), '접기 목록이 프리셋(다트)과 똑같다', JSON.stringify(st.folds));
  check(st.guideDone === 1, 'onGuideDone 이 한 번 불렸다', String(st.guideDone));
  check(st.sounds[st.sounds.length - 1] === 'snap', "맞았을 때 소리 'snap'");
  check((await text(page, 'fb-title')) === '다 접었어요!', '"다 접었어요!"');
  await sleep(300);
  await shot(page, '14-guide-done');
  // 다 접은 뒤에는 실수로 더 접히지 않는다.
  await touchDrag(page, { x: LEFT + 0.03, y: -TOP + 0.002 }, { x: -0.03, y: -0.06 });
  check(await foldCount(page) === 4, '다 접은 뒤에는 더 접히지 않는다');

  console.log('12. 건너뛰기');
  await tap(page, 'lab-guide-dart');
  for (let i = 0; i < 4; i++) await tap(page, 'fb-skip');
  st = await lab(page);
  check(sameFolds(st.folds, guide) && st.guideDone === 1, '건너뛰기 4번이면 프리셋과 같고 완료 알림 1번', `${st.folds.length}/${st.guideDone}`);
  await tap(page, 'fb-undo');
  check(await foldCount(page) === 3 && (await text(page, 'fb-title')) === '4번째 접기 (전체 4번)', '되돌리면 그 단계의 길잡이가 다시 나온다');

  console.log('13. 다른 색, 큰 화면');
  await tap(page, 'lab-guide-off');
  await tap(page, 'lab-color-노랑');
  await toTop(page);
  await touchDrag(page, { x: LEFT + 0.002, y: -TOP + 0.002 }, { x: -0.04, y: -0.07 }, async () => { await shot(page, '15-yellow-dragging'); });
  await sleep(300);
  await shot(page, '16-yellow');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(100);
  await shot(page, '17-controls');
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await toTop(page);
  await sleep(300);
  await shot(page, '18-desktop');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '큰 화면에서도 가로로 넘치지 않는다');
  await page.setViewport({ width: 320, height: 568, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await sleep(300);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '아주 좁은 화면(320px)에서도 넘치지 않는다');
  await shot(page, '19-narrow-320');

  console.log('14. 종이 무늬: 그림이 종이에 붙은 채로 접힌다');
  await page.setViewport({ width: 360, height: 740, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await tap(page, 'fb-reset');
  if (await page.$('[data-testid="fb-reset-yes"]')) await tap(page, 'fb-reset-yes');
  await tap(page, 'lab-paper-newsprint');
  await toTop(page);
  await sleep(300);
  const tex0 = await page.evaluate(() => ({
    plies: document.querySelectorAll('.fb-ply').length,
    uses: [...document.querySelectorAll('.fb-ply use')].map((u) => `${u.getAttribute('href').slice(-2)} ${u.getAttribute('transform')}`),
    images: [...document.querySelectorAll('.fb-sheet defs image')].map((im) => (im.getAttribute('href') || '').slice(0, 16)),
  }));
  check(tex0.plies === 1 && tex0.uses.length === 1 && /-f matrix\(1\.0+ -?0\.0+ -?0\.0+ 1\.0+ -?0\.0+ -?0\.0+\)/.test(tex0.uses[0]), '접기 전: 앞면 그림 한 장이 제자리에 놓인다', tex0.uses.join(' | '));
  check(tex0.images.length === 2 && tex0.images.every((h) => h.startsWith('data:image/')), '앞뒤 그림은 data URL 이다(외부 요청 없음)', tex0.images.join(', '));
  let midway = null;
  await touchDrag(page, { x: LEFT + 0.002, y: -TOP + 0.002 }, { x: 0, y: -TOP + 0.105 }, async () => {
    midway = await page.evaluate(() => ({ uses: document.querySelectorAll('.fb-ply use').length, plies: document.querySelectorAll('.fb-ply').length, back: document.querySelectorAll('.fb-ply use[href$="-b"]').length }));
    await shot(page, '20-newsprint-dragging');
  });
  check(midway && midway.plies >= 2 && midway.uses === midway.plies && midway.back >= 1, '끄는 동안: 겹마다 그림이 붙고, 넘어오는 조각은 뒷면 그림이다', JSON.stringify(midway));
  await sleep(300);
  const tex1 = await page.evaluate(() => [...document.querySelectorAll('.fb-ply use')].map((u) => ({ back: u.getAttribute('href').endsWith('-b'), m: u.getAttribute('transform').replace('matrix(', '').replace(')', '').split(' ').map(Number) })));
  const dets = tex1.map((t) => t.m[0] * t.m[3] - t.m[1] * t.m[2]);
  check(tex1.length >= 3 && dets.every((d) => Math.abs(Math.abs(d) - 1) < 1e-4), '접은 뒤: 모든 겹의 그림이 늘어나지 않고(길이 보존) 붙어 있다', dets.map((d) => d.toFixed(3)).join(', '));
  check(tex1.every((t, i) => t.back === dets[i] < 0), '뒤집힌 겹(거울 변환)에는 뒷면 그림이 붙는다', tex1.map((t, i) => `${t.back}:${dets[i].toFixed(1)}`).join(', '));
  check(tex1.some((t) => Math.abs(t.m[1]) > 0.5), '접힌 조각의 글줄은 다른 방향으로 놓인다(그림이 돌아가 있다)');
  await shot(page, '21-newsprint-folded');
  await tap(page, 'lab-aside-toggle');
  await sleep(300);
  const split = await page.evaluate(() => {
    const r = (sel) => { const b = document.querySelector(sel)?.getBoundingClientRect(); return b ? { l: b.left, r: b.right, w: b.width } : null; };
    return { pane: r('.fb-pane'), aside: r('[data-testid="fb-aside"]'), divider: r('[data-testid="fb-divider"]') };
  });
  check(split.pane && split.aside && split.divider && split.pane.r <= split.aside.l + 1 && split.aside.w >= 90 && split.pane.w >= 170, '옆 칸을 주면 책상이 좌우로 나뉜다(종이 170px 이상, 옆 칸 90px 이상)', JSON.stringify(split));
  await page.focus('[data-testid="fb-divider"]');
  await page.keyboard.press('ArrowRight');
  await sleep(150);
  const paneAfter = await page.evaluate(() => document.querySelector('.fb-pane').getBoundingClientRect().width);
  check(paneAfter > split.pane.w + 4, '나눔 막대를 자판으로 옮길 수 있다', `${split.pane.w.toFixed(0)} -> ${paneAfter.toFixed(0)}`);
  await shot(page, '22-newsprint-split');
  await tap(page, 'lab-aside-toggle');
  await tap(page, 'lab-paper-off');

  console.log('15. 오류와 외부 요청');
  check(errors.length === 0, '콘솔 오류 없음', errors.join(' | '));
  check(external.length === 0, '외부 요청 없음', external.join(' | '));
  await page.close();
}

const server = await startServer();
let browser;
try {
  browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
  });
  await run(browser);
} catch (e) {
  failures++;
  console.error('시험 도중 오류:', e);
} finally {
  if (browser) await browser.close();
  stopServer(server);
}
console.log(failures === 0 ? '\n모두 통과' : `\n실패 ${failures}건`);
process.exit(failures === 0 ? 0 : 1);
