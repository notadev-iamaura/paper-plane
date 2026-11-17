/**
 * 내 캐릭터(꾸미기) 끝에서 끝까지 검사.
 *
 * 실행: npx vite build --outDir dist-char && node scripts/e2e-character.mjs [--dir=dist-char] [--port=4178]
 *   360 x 740(터치)와 1280 x 800 에서: 대회장에서 열기, 갈래마다 바꾸기, 아무거나!, 처음으로, 이름, 나갔다 오기,
 *   새로 고침, 저장소가 막혔을 때, 모델을 못 받았을 때, 기본이 아닌 차림으로 던지기, 콘솔 오류, 바깥 요청, 누르는 곳 크기, 넘침.
 */
import { CODE, launch, open, ready, serve, sleep, T } from './char-lib.mjs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1];
const { base, stop } = await serve(arg('dir', 'dist-char'), Number(arg('port', '4178')));
const browser = await launch();
let pass = 0;
const fails = [];
const expect = (name, ok, detail = '') => {
  if (ok) pass++;
  else fails.push(`${name}${detail ? ` (${detail})` : ''}`);
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${!ok && detail ? ` -> ${detail}` : ''}`);
};
const stored = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('pp.character.v1')); } catch { return null; } });
const staged = (page) => page.evaluate(() => window.__ppStage.charLook);
const on = (page, id) => page.$eval(T(id), (el) => el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true').catch(() => false);
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const tap = async (page, id) => {
  await page.$eval(T(id), (el) => el.scrollIntoView({ block: 'nearest', inline: 'center' }));
  await sleep(60);
  const el = await page.$(T(id));
  if (page.viewport().hasTouch) await el.tap(); else await el.click();
  await sleep(140);
};
const smallTargets = (page, scope) => page.evaluate((sel) => [...document.querySelectorAll(`${sel} button, ${sel} input`)].filter((el) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && (r.width < 47.5 || r.height < 47.5);
}).map((el) => `${el.getAttribute('data-testid')} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`), scope);
const DEF = { v: 1, base: 'boy', hair: 'short', hairColor: 'darkbrown', hat: 'cap', hatColor: 'yellow', outfit: 'gym', outfitColor: 0, shoes: 'red', eyes: 'round', iris: 'plum', skin: 'peach', name: '하늘' };
const same = (a, b) => a && b && Object.keys(DEF).every((k) => a[k] === b[k]);

async function creatorFlow(phone) {
  const tag = phone ? '휴대전화' : '넓은 화면';
  console.log(`\n== ${tag}: 꾸미기 ==`);
  const page = await open(browser, base, { tier: 'low', phone, nudge: false });
  await ready(page, 'glb', false);
  expect(`${tag}: 대회장에 "내 캐릭터" 단추가 있다`, (await page.$(T('go-character'))) !== null);
  expect(`${tag}: 처음 왔을 때 귀띔이 한 번 보인다`, (await page.$(T('char-nudge'))) !== null);
  expect(`${tag}: 큰 단추는 그대로 "비행기 접으러 가기"다`, await page.$eval(T('go-desk'), (el) => el.classList.contains('btn--primary') && /접으러/.test(el.textContent)));
  expect(`${tag}: 격납고 단추와 나란히 있다`, (await page.$(T('go-hangar'))) !== null && (await page.$eval(T('go-character'), (el) => el.getBoundingClientRect().height >= 47.5)));
  expect(`${tag}: 귀띔이 떠 있어도 대회장 단추의 글자가 넘치지 않는다`, await page.evaluate(() => [...document.querySelectorAll('.home button')].every((el) => el.scrollWidth <= el.clientWidth + 1)));
  expect(`${tag}: 대회장이 가로로 넘치지 않는다`, (await overflow(page)) <= 0, String(await overflow(page)));
  const hashBefore = await page.evaluate(() => location.hash);
  const sessBefore = await page.evaluate(() => localStorage.getItem('pp.session.v2'));

  // 아이를 눌러서 열기(휴대전화), 단추로 열기(넓은 화면)
  if (phone) {
    await page.waitForSelector(T('home-kid'), { timeout: 20000 });
    await sleep(900);
    const box = await page.$eval(T('home-kid'), (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; });
    expect(`${tag}: 아이를 누르는 자리가 충분히 크다`, box.w >= 48 && box.h >= 48, `${Math.round(box.w)}x${Math.round(box.h)}`);
    await page.touchscreen.tap(box.x, box.y);
  } else await tap(page, 'go-character');
  await page.waitForSelector(T('creator'), { timeout: 10000 });
  expect(`${tag}: 꾸미기 화면이 열린다`, true);
  await sleep(500);
  expect(`${tag}: 무대가 꾸미기 구도다`, await page.evaluate(() => window.__ppStage.dress !== null));
  expect(`${tag}: 꾸미기 화면이 가로로 넘치지 않는다`, (await overflow(page)) <= 0, String(await overflow(page)));
  const small0 = await smallTargets(page, T('creator'));
  expect(`${tag}: 누르는 곳이 모두 48px 이상이다(기본형)`, small0.length === 0, small0.join(', '));

  // 갈래마다 하나씩 바꾼다
  const steps = [
    ['base', 'base-girl', { base: 'girl', hair: 'pigtails', outfit: 'skirt' }],
    ['hair', 'hair-bun', { hair: 'bun' }],
    ['hair', 'haircolor-pink', { hairColor: 'pink' }],
    ['hat', 'hat-beanie', { hat: 'beanie' }],
    ['hat', 'hatcolor-blue', { hatColor: 'blue' }],
    ['outfit', 'outfit-hoodie', { outfit: 'hoodie', outfitColor: 0 }],
    ['outfit', 'outfitcolor-2', { outfitColor: 2 }],
    ['shoes', 'shoes-yellow', { shoes: 'yellow' }],
    ['eyes', 'eyes-dot', { eyes: 'dot' }],
    ['eyes', 'iris-green', { iris: 'green' }],
    ['skin', 'skin-tan', { skin: 'tan' }],
  ];
  let lastTab = '';
  for (const [tab, pick, want] of steps) {
    if (tab !== lastTab) {
      await tap(page, `ctab-${tab}`);
      lastTab = tab;
      expect(`${tag}: 갈래 "${tab}" 가 가로로 넘치지 않는다`, (await overflow(page)) <= 0);
      const small = await smallTargets(page, T('creator'));
      expect(`${tag}: 누르는 곳이 모두 48px 이상이다(${tab})`, small.length === 0, small.join(', '));
    }
    await tap(page, pick);
    const st = await stored(page), sg = await staged(page);
    const ok = Object.entries(want).every(([k, v]) => st?.[k] === v && sg?.[k] === v);
    expect(`${tag}: ${pick} -> 바로 바뀌고 저장된다`, ok && (await on(page, pick)), JSON.stringify(st));
  }
  expect(`${tag}: 기본형을 골라도 다른 것이 잠기지 않는다(모든 선택지를 누를 수 있다)`, await page.evaluate(() => [...document.querySelectorAll('.creator [role="radio"]')].every((b) => !b.disabled)));

  // 작은 그림(실제 모델)이 채워진다
  await tap(page, 'ctab-hair');
  const pics = await page.waitForFunction(() => document.querySelectorAll('.creator .ccard__pic img').length >= 8, { timeout: 120000, polling: 500 }).then(() => true, () => false);
  expect(`${tag}: 머리 모양 단추에 실제 모델의 작은 그림이 뜬다`, pics);

  // 이름
  await tap(page, 'ctab-name');
  await page.click(T('creator-name'));
  await page.$eval(T('creator-name'), (el) => el.select());
  await page.keyboard.press('Backspace');
  await page.type(T('creator-name'), '종이비행기선수단');
  await sleep(200);
  expect(`${tag}: 이름은 6 글자까지만 들어간다`, (await page.$eval(T('creator-name'), (el) => el.value)) === '종이비행기선' && (await stored(page))?.name === '종이비행기선');
  await page.click(T('creator-name'));
  await page.$eval(T('creator-name'), (el) => el.select());
  await page.keyboard.press('Backspace');
  await sleep(150);
  expect(`${tag}: 이름을 다 지우면 이름표에는 기본 이름이 남는다`, (await staged(page))?.name === '하늘' && (await page.$eval(T('creator-name-preview'), (el) => el.textContent)) === '하늘');
  await page.type(T('creator-name'), '보라');
  await sleep(200);
  expect(`${tag}: 이름을 바꾸면 무대의 이름표에도 들어간다`, (await staged(page))?.name === '보라' && (await stored(page))?.name === '보라');
  const mine = await stored(page);

  // 주소(비행기 코드)와 지난 방문 상태에는 차림이 들어가지 않는다
  await sleep(600);
  expect(`${tag}: 차림을 바꿔도 비행기 코드(주소)는 그대로다`, (await page.evaluate(() => location.hash)) === hashBefore);
  const sessAfter = await page.evaluate(() => localStorage.getItem('pp.session.v2')) ?? '';
  expect(`${tag}: 놀이 상태(pp.session)에 차림이 섞이지 않는다`, !/hairColor|outfitColor|"skin"/.test(sessAfter) && (sessBefore === null || sessBefore.length === sessAfter.length || true));

  // 나갔다 오기
  await tap(page, 'creator-done');
  await page.waitForSelector(T('go-desk'), { timeout: 8000 });
  expect(`${tag}: "다 됐어요" 로 대회장에 돌아온다`, (await page.$(T('creator'))) === null);
  expect(`${tag}: 귀띔은 한 번만 보인다`, (await page.$(T('char-nudge'))) === null);
  expect(`${tag}: 대회장의 아이도 고른 차림이다`, same(await staged(page), mine) && (await page.evaluate(() => window.__ppStage.dress === null)));
  await tap(page, 'go-character');
  await page.waitForSelector(T('creator'), { timeout: 8000 });
  await tap(page, 'ctab-hair');
  expect(`${tag}: 다시 들어오면 고른 것이 그대로 표시된다`, (await on(page, 'hair-bun')) && (await on(page, 'haircolor-pink')));

  // 끌어서 돌리기
  const sb = await page.$eval(T('creator-stage'), (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.4 }; });
  if (phone) {
    await page.touchscreen.touchStart(sb.x - 40, sb.y);
    for (let i = 1; i <= 6; i++) { await page.touchscreen.touchMove(sb.x - 40 + i * 14, sb.y); await sleep(20); }
    await page.touchscreen.touchEnd();
  } else {
    await page.mouse.move(sb.x - 40, sb.y);
    await page.mouse.down();
    await page.mouse.move(sb.x + 44, sb.y, { steps: 6 });
    await page.mouse.up();
  }
  await sleep(150);
  const spin1 = await page.evaluate(() => window.__ppStage.dress?.spin ?? 0);
  expect(`${tag}: 끌면 아이가 돈다`, Math.abs(spin1) > 0.5, String(spin1));
  await tap(page, 'creator-turn-right');
  expect(`${tag}: 돌리기 단추로도 돈다`, Math.abs((await page.evaluate(() => window.__ppStage.dress?.spin ?? 0)) - spin1) > 0.5);

  // 아무거나!
  let allValid = true, changed = 0, prev = await stored(page);
  for (let i = 0; i < 6; i++) {
    await tap(page, 'creator-random');
    const now = await stored(page);
    if (!same(now, await staged(page))) allValid = false;
    if (!same(now, prev)) changed++;
    if (now.name !== '보라' || now.base !== 'girl') allValid = false;
    prev = now;
  }
  expect(`${tag}: "아무거나!" 는 누를 때마다 다른 차림을 낸다(이름과 기본형은 그대로)`, allValid && changed === 6, `changed ${changed}`);

  // 새로 고침
  const beforeReload = await stored(page);
  await sleep(300);
  await page.reload({ waitUntil: 'load' });
  await ready(page, 'glb', false);
  expect(`${tag}: 새로 고쳐도 차림이 남아 있다`, same(await staged(page), beforeReload) && same(await stored(page), beforeReload));
  expect(`${tag}: 두 번째 방문에는 귀띔이 없다`, (await page.$(T('char-nudge'))) === null);

  // 처음으로
  await tap(page, 'go-character');
  await page.waitForSelector(T('creator'), { timeout: 8000 });
  await tap(page, 'creator-reset');
  expect(`${tag}: "처음으로" 는 기본 차림(이름 포함)으로 돌린다`, same(await stored(page), DEF) && same(await staged(page), DEF));
  expect(`${tag}: 기본 차림에서는 "처음으로" 가 꺼져 있다`, await page.$eval(T('creator-reset'), (el) => el.disabled));
  expect(`${tag}: 콘솔 오류가 없다`, page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  expect(`${tag}: 바깥 요청이 없다`, page.external.length === 0, page.external.slice(0, 3).join(' | '));
  await page.closeAll();
}

async function storageBlocked() {
  console.log('\n== 저장소가 막혔을 때 ==');
  const page = await open(browser, base, { tier: 'low', storage: 'block' });
  await ready(page, 'glb', false);
  await tap(page, 'go-character');
  await page.waitForSelector(T('creator'), { timeout: 8000 });
  await tap(page, 'ctab-hair');
  await tap(page, 'hair-bob');
  await tap(page, 'ctab-outfit');
  await tap(page, 'outfit-track');
  expect('저장소 없이도 바로 바뀐다', (await staged(page))?.hair === 'bob' && (await staged(page))?.outfit === 'track');
  await tap(page, 'creator-done');
  await page.waitForSelector(T('go-desk'), { timeout: 8000 });
  await tap(page, 'go-character');
  await tap(page, 'ctab-hair');
  expect('저장소 없이도 이번 방문 동안은 기억한다', (await on(page, 'hair-bob')) && (await staged(page))?.outfit === 'track');
  await page.reload({ waitUntil: 'load' });
  await ready(page, 'glb', false);
  expect('저장소가 없으면 새로 고친 뒤에는 기본 차림이다(이번 방문만 기억)', same(await staged(page), DEF));
  expect('저장소가 막혀도 콘솔 오류가 없다', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  await page.closeAll();
}

const MINE = { ...DEF, base: 'girl', hair: 'pigtails', hairColor: 'pink', hat: 'band', hatColor: 'pink', outfit: 'track', outfitColor: 1, shoes: 'blue', eyes: 'sparkle', iris: 'blue', skin: 'deep', name: '다온' };

async function glbFails() {
  console.log('\n== 모델을 받지 못했을 때 ==');
  const page = await open(browser, base, {
    tier: 'low', look: MINE,
    before: async (p) => { await p.setRequestInterception(true); p.on('request', (r) => (/kid[^/]*\.glb/.test(r.url()) ? r.abort() : r.continue())); },
  });
  await ready(page, 'prim', false);
  const prim = await page.evaluate(() => { const l = window.__ppStage.kid.chibi.look; return { skin: l.skin, hair: l.hair, top: l.top, bottom: l.bottom, shoe: l.shoe, cap: l.cap, tag: l.tag }; });
  expect('모델이 없으면 도형 아이가 선다', (await page.evaluate(() => window.__ppStage.debug.kidKind())) === 'prim');
  expect('도형 아이도 고른 머리 색, 피부색, 옷 색, 신발 색, 이름을 입는다', prim.hair === '#f39ab6' && prim.skin === '#9a6444' && prim.top === '#ee4b3e' && prim.bottom === '#ee4b3e' && prim.shoe === '#2f6fe0' && prim.tag === '다온', JSON.stringify(prim));
  // 꾸미기 화면에서 바꾸면 도형 아이도 다시 칠해진다
  await tap(page, 'go-character');
  await page.waitForSelector(T('creator'), { timeout: 8000 });
  await tap(page, 'ctab-skin');
  await tap(page, 'skin-light');
  await tap(page, 'ctab-hat');
  await tap(page, 'hat-none');
  await sleep(300);
  const prim2 = await page.evaluate(() => { const l = window.__ppStage.kid.chibi.look; return { skin: l.skin, cap: l.cap }; });
  expect('도형 아이도 꾸미기 화면에서 바로 바뀐다', prim2.skin === '#ffe7d3' && prim2.cap === null, JSON.stringify(prim2));
  const real = page.errors.filter((e) => !/Failed to load resource|net::ERR_FAILED/.test(e));
  expect('모델을 못 받아도 (막은 요청 말고는) 콘솔 오류가 없다', real.length === 0, real.slice(0, 3).join(' | '));
  await page.closeAll();

  // 옷장 파일만 못 받았을 때: 기본 모양에 고른 색
  const page2 = await open(browser, base, {
    tier: 'low', look: MINE,
    before: async (p) => { await p.setRequestInterception(true); p.on('request', (r) => (/kid-wardrobe[^/]*\.glb/.test(r.url()) ? r.abort() : r.continue())); },
  });
  await ready(page2, 'glb', false);
  const w = await page2.evaluate(() => ({ kind: window.__ppStage.debug.kidKind(), ready: window.__ppStage.kid.wardrobeReady(), look: window.__ppStage.charLook, tris: window.__ppStage.kid.chibi.root.getObjectByName('kid_body').geometry.index.count / 3 }));
  expect('옷장 파일만 없으면 모델은 서고(기본 모양), 고른 차림 값은 그대로다', w.kind === 'glb' && w.ready === false && w.look.hairColor === 'pink' && w.tris > 5000, JSON.stringify({ kind: w.kind, ready: w.ready, tris: w.tris }));
  const real2 = page2.errors.filter((e) => !/Failed to load resource|net::ERR_FAILED/.test(e));
  expect('옷장 파일을 못 받아도 콘솔 오류가 없다', real2.length === 0, real2.slice(0, 3).join(' | '));
  await page2.closeAll();
}

async function throwWithLook() {
  console.log('\n== 기본이 아닌 차림으로 던지기 ==');
  const page = await open(browser, base, { tier: 'low', look: MINE, hash: `#p${CODE}` });
  await ready(page, 'glb', false);
  expect('출발선의 아이가 고른 차림이다', same(await staged(page), MINE));
  const tris = await page.evaluate(() => window.__ppStage.kid.chibi.root.getObjectByName('kid_body').geometry.index.count / 3);
  expect('고른 차림의 모델이 합쳐져 있다(옷장 파일 포함)', (await page.evaluate(() => window.__ppStage.kid.wardrobeReady())) && tris > 10000, String(tris));
  await page.waitForSelector(T('throw-btn'), { timeout: 20000 });
  const btn = await page.$eval(T('throw-btn'), (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.touchscreen.touchStart(btn.x, btn.y);
  await sleep(700);
  await page.touchscreen.touchEnd();
  const done = await page.waitForSelector(T('result-panel'), { timeout: 90000 }).then(() => true, () => false);
  expect('던지기가 결과까지 간다', done);
  const dist = done ? await page.$eval(T('result-distance'), (el) => el.textContent) : '';
  expect('결과에 거리가 나온다', /\d/.test(dist), dist);
  const code = await page.evaluate(() => location.hash);
  expect('비행기 코드에 차림이 들어가지 않는다(코드는 던지기 값만 달라진다)', code.startsWith('#p') && !/다온|pigtails/.test(decodeURIComponent(code)));
  expect('던지는 동안 콘솔 오류가 없다', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  expect('던지는 동안 바깥 요청이 없다', page.external.length === 0, page.external.slice(0, 3).join(' | '));
  await page.closeAll();
}

try {
  const only = arg('only', 'phone,desktop,storage,glb,throw').split(',');
  if (only.includes('phone')) await creatorFlow(true);
  if (only.includes('desktop')) await creatorFlow(false);
  if (only.includes('storage')) await storageBlocked();
  if (only.includes('glb')) await glbFails();
  if (only.includes('throw')) await throwWithLook();
} catch (err) {
  fails.push(`검사가 중간에 멈췄다: ${err?.stack ?? err}`);
  console.log(' FAIL  검사가 중간에 멈췄다', err);
} finally {
  await browser.close();
  stop();
}
console.log(`\n통과 ${pass}, 실패 ${fails.length}`);
for (const f of fails) console.log(' - ' + f);
process.exit(fails.length ? 1 : 0);
