/**
 * 내 캐릭터(꾸미기)의 갈무리: screenshots/v7-character/ 에 모아 보기 그림을 만든다.
 *
 * 실행: npx vite build --outDir dist-char && node scripts/shots-character.mjs [--only=hair,hats,outfits,eyes,skin,random,game,creator]
 *
 *  hair-hats.png   머리 모양 8 x (모자 없음, 학교 모자) x (앞, 뒤)
 *  hats-all.png    머리 모양 8 x 모자 6 (모든 짝)
 *  outfits.png     옷 5 x 색 조합 둘 x (앞, 뒤)
 *  eyes.png        눈 모양 5 x 표정 8 (+ 깜빡임)
 *  skin.png        피부색 5
 *  random.png      "아무거나!" 12 번
 *  game-*.png      기본이 아닌 차림으로 실제 놀이(조준, 던지기, 만세, 풀죽음)
 *  creator-*.png   꾸미기 화면(휴대전화, 넓은 화면)
 * 모아 보기 그림의 칸은 꾸미기 화면의 선택지 단추와 같은 방법(실제 모델을 작은 판에 그리기)으로 그린다.
 */
import { join } from 'node:path';
import { CODE, launch, open, ready, ROOT, serve, settle, sleep, T } from './char-lib.mjs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1];
const ONLY = arg('only', 'hair,hats,outfits,eyes,skin,random,game,creator').split(',');
const OUT = join(ROOT, 'screenshots', 'v7-character');
const DEF = { v: 1, base: 'boy', hair: 'short', hairColor: 'darkbrown', hat: 'cap', hatColor: 'yellow', outfit: 'gym', outfitColor: 0, shoes: 'red', eyes: 'round', iris: 'plum', skin: 'peach', name: '하늘' };
const HAIRS = ['short', 'bowl', 'spiky', 'bob', 'pigtails', 'ponytail', 'bun', 'long'];
const HATS = ['none', 'cap', 'visor', 'band', 'beanie', 'bucket'];
const OUTFITS = ['gym', 'track', 'skirt', 'hoodie', 'overalls'];
const EYES = ['round', 'sparkle', 'sleepy', 'upturned', 'dot'];
const EXPRS = ['neutral', 'smile', 'focus', 'effort', 'joy', 'oops', 'wow', 'grit'];
const SKINS = ['light', 'peach', 'tan', 'brown', 'deep'];

const { base, stop } = await serve('dist-char', 4178);
const browser = await launch();

/** 칸들을 격자로 붙여 한 장으로 갈무리한다. cells: [{ src, label }] */
async function sheet(cells, cols, file, cell = 220, title = '') {
  const page = await browser.newPage();
  const rows = Math.ceil(cells.length / cols);
  await page.setViewport({ width: cols * (cell + 6) + 14, height: rows * (cell + 30) + (title ? 44 : 14), deviceScaleFactor: 1 });
  const html = `<body style="margin:0;padding:8px;background:#cfe6ee;font:14px system-ui,sans-serif;color:#1d2a4d">
    ${title ? `<div style="font-size:18px;font-weight:700;padding:2px 2px 8px">${title}</div>` : ''}
    <div style="display:grid;grid-template-columns:repeat(${cols},${cell}px);gap:6px">
    ${cells.map((c) => `<div style="background:#f4efe2;border:2px solid #1d2a4d;border-radius:8px;overflow:hidden"><img src="${c.src}" width="${cell}" height="${cell}" style="display:block;object-fit:contain"><div style="padding:2px 6px 4px;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.label}</div></div>`).join('')}
    </div></body>`;
  await page.setContent(html, { waitUntil: 'load' });
  await sleep(200);
  await page.screenshot({ path: join(OUT, file), fullPage: true });
  await page.close();
  console.log('saved', file);
}

try {
  const need3d = ONLY.some((o) => ['hair', 'hats', 'outfits', 'eyes', 'skin', 'random'].includes(o));
  if (need3d) {
    const page = await open(browser, base, { tier: 'high' });
    await ready(page);
    await page.click(T('go-character'));
    await sleep(1500);
    // 옷장 파일까지 올 때까지
    await page.waitForFunction(() => { const s = window.__ppStage; return s.kidThumb({ v: 1, base: 'boy', hair: 'bun', hairColor: 'darkbrown', hat: 'bucket', hatColor: 'yellow', outfit: 'track', outfitColor: 0, shoes: 'red', eyes: 'round', iris: 'plum', skin: 'peach', name: '하늘' }, 'head', 32) !== null; }, { timeout: 120000, polling: 500 });
    await settle(page, 1.5);
    const thumb = (look, view, yaw, size = 300, face = null) => page.evaluate((l, v, y, sz, f) => {
      const s = window.__ppStage;
      if (f) { s.setCharacter(l); s.kid.chibi.setFace(f[0], f[1]); }
      const c = s.kidThumb(l, v, sz, y);
      return c ? c.toDataURL('image/png') : '';
    }, look, view, yaw, size, face);

    if (ONLY.includes('hair')) {
      const cells = [];
      for (const hair of HAIRS) for (const hat of ['none', 'cap']) for (const [yaw, nm] of [[0.35, '앞'], [Math.PI + 0.55, '뒤']]) {
        cells.push({ src: await thumb({ ...DEF, hair, hat }, 'head', yaw), label: `${hair} / ${hat} / ${nm}` });
      }
      await sheet(cells, 8, 'hair-hats.png', 200, '머리 모양 8 x (모자 없음, 학교 모자) x (앞, 뒤)');
    }
    if (ONLY.includes('hats')) {
      const cells = [];
      for (const hair of HAIRS) for (const hat of HATS) cells.push({ src: await thumb({ ...DEF, hair, hat, hatColor: hat === 'band' ? 'red' : hat === 'beanie' ? 'blue' : hat === 'bucket' ? 'green' : 'yellow' }, 'head', hat === 'none' ? 0.3 : 0.75), label: `${hair} + ${hat}` });
      await sheet(cells, 6, 'hats-all.png', 200, '머리 모양 8 x 모자 6: 모든 짝');
      const back = [];
      for (const hair of HAIRS) for (const hat of HATS) back.push({ src: await thumb({ ...DEF, hair, hat, hatColor: hat === 'band' ? 'red' : hat === 'beanie' ? 'blue' : hat === 'bucket' ? 'green' : 'yellow' }, 'head', Math.PI + 0.5), label: `${hair} + ${hat} 뒤` });
      await sheet(back, 6, 'hats-all-back.png', 200, '머리 모양 8 x 모자 6: 뒤에서');
    }
    if (ONLY.includes('outfits')) {
      const cells = [];
      for (const outfit of OUTFITS) for (const oc of [0, 1, 2, 3]) for (const [yaw, nm] of [[0.3, '앞'], [Math.PI + 0.45, '뒤']]) {
        if (oc >= 2 && nm === '뒤') continue;
        cells.push({ src: await thumb({ ...DEF, outfit, outfitColor: oc, hat: 'none' }, 'body', yaw), label: `${outfit} 색${oc} ${nm}` });
      }
      await sheet(cells, 6, 'outfits.png', 230, '옷 5 가지: 색 조합 0, 1 은 앞과 뒤, 2, 3 은 앞');
    }
    if (ONLY.includes('eyes')) {
      const cells = [];
      const iris = ['plum', 'brown', 'blue', 'green', 'black'];
      for (const [i, eyes] of EYES.entries()) {
        const look = { ...DEF, eyes, iris: iris[i], hat: 'none' };
        for (const e of EXPRS) cells.push({ src: await thumb(look, 'head', 0.05, 240, [e, false]), label: `${eyes} / ${e}` });
        cells.push({ src: await thumb(look, 'head', 0.05, 240, ['neutral', true]), label: `${eyes} / 깜빡` });
      }
      await sheet(cells, 9, 'eyes.png', 170, '눈 모양 5 x 표정 8 + 깜빡임 (눈동자 색도 줄마다 다르게)');
    }
    if (ONLY.includes('skin')) {
      const cells = [];
      for (const skin of SKINS) cells.push({ src: await thumb({ ...DEF, skin, hat: 'none' }, 'head', 0.25, 300, ['smile', false]), label: `피부 ${skin}` });
      for (const skin of SKINS) cells.push({ src: await thumb({ ...DEF, skin, outfit: 'skirt', hair: 'pigtails', hat: 'band', hatColor: 'pink' }, 'body', 0.3, 300, ['joy', false]), label: `피부 ${skin}` });
      await sheet(cells, 5, 'skin.png', 240, '피부색 5');
    }
    if (ONLY.includes('random')) {
      const looks = await page.evaluate(async () => {
        const m = await import(document.querySelector('script[type=module]').src);
        void m;
        return null;
      }).catch(() => null);
      void looks;
      const cells = [];
      for (let i = 0; i < 12; i++) {
        await page.click(T('creator-random'));
        await sleep(250);
        const look = await page.evaluate(() => JSON.parse(localStorage.getItem('pp.character.v1')));
        cells.push({ src: await thumb(look, 'body', 0.3, 300, ['smile', false]), label: `${look.hair} ${look.hat} ${look.outfit}${look.outfitColor} ${look.eyes}` });
      }
      await sheet(cells, 6, 'random.png', 230, '"아무거나!" 12 번');
    }
    console.log('errors', page.errors, 'external', page.external);
    await page.closeAll();
  }

  if (ONLY.includes('game')) {
    const looks = [
      ['skirt', { ...DEF, base: 'girl', hair: 'pigtails', hat: 'band', hatColor: 'pink', outfit: 'skirt', outfitColor: 0, eyes: 'sparkle', iris: 'brown', name: '보라' }],
      ['track', { ...DEF, hair: 'spiky', hairColor: 'black', hat: 'beanie', hatColor: 'blue', outfit: 'track', outfitColor: 1, eyes: 'upturned', skin: 'tan', shoes: 'white', name: '준서' }],
      ['hoodie', { ...DEF, hair: 'long', hairColor: 'brown', hat: 'bucket', hatColor: 'white', outfit: 'hoodie', outfitColor: 0, eyes: 'sleepy', iris: 'green', skin: 'brown', name: '마루' }],
      ['overalls', { ...DEF, hair: 'bun', hairColor: 'redbrown', hat: 'visor', hatColor: 'red', outfit: 'overalls', outfitColor: 0, eyes: 'dot', iris: 'black', skin: 'deep', shoes: 'yellow', name: '다온' }],
    ].filter(([n]) => arg('looks', 'skirt,track,hoodie,overalls').split(',').includes(n));
    for (const [nm, look] of looks) {
      const page = await open(browser, base, { tier: 'high', look, hash: `#p${CODE}` });
      await ready(page);
      await settle(page, 1.5);
      const shot = async (tag) => { await page.screenshot({ path: join(OUT, `game-${nm}-${tag}.png`) }); console.log('saved', `game-${nm}-${tag}.png`); };
      await shot('aim');
      // 만세와 풀죽음: 출발선 구도 그대로 아이의 반응만 틀어 본다(실제 놀이에서는 착지 지점 쪽 카메라라 아이가 멀리 보인다)
      await page.evaluate(() => { const s = window.__ppStage; s.kidMode = 'react'; s.mood = 'great'; s.moodGiven = 'great'; s.kidT = 0; s.debug.step(0.42); });
      await shot('cheer');
      await page.evaluate(() => { const s = window.__ppStage; s.mood = 'again'; s.moodGiven = 'again'; s.kidT = 0; s.debug.step(1.7); });
      await shot('slump');
      // 끝까지 당긴 자세와, 던지는 동작의 한가운데(휘두르는 중)
      await page.evaluate(() => { const s = window.__ppStage; s.kidMode = 'aim'; s.kidT = 0; s.setAim(24, 0, 1); s.debug.step(0.5); });
      await shot('pull');
      await page.evaluate(() => { const s = window.__ppStage; s.setMood('great'); s.debug.fakeThrow(21, 3.2, 0.2); s.debug.step(0.33); });
      await shot('throw');
      console.log(nm, 'errors', page.errors, 'external', page.external);
      await page.closeAll();
    }
  }

  if (ONLY.includes('creator')) {
    for (const phone of [true, false]) {
      const page = await open(browser, base, { tier: 'high', phone, nudge: false });
      await ready(page);
      await settle(page, 1.2);
      await page.screenshot({ path: join(OUT, `home-${phone ? 'phone' : 'desktop'}.png`) });
      await page.evaluate(() => window.__ppStage.debug.pause(false));
      await page.click(T('go-character'));
      await sleep(2500);
      for (const [tab, pick] of [['base', null], ['hair', 'hair-pigtails'], ['hat', 'hat-band'], ['outfit', 'outfit-overalls'], ['eyes', 'eyes-sparkle'], ['skin', null], ['name', null]]) {
        await page.click(T(`ctab-${tab}`));
        if (pick) await page.click(T(pick));
        await page.waitForFunction(() => !document.querySelector('.ccard__wait'), { timeout: 90000, polling: 400 }).catch(() => undefined);
        await sleep(1600);
        await settle(page, 0.3);
        await page.screenshot({ path: join(OUT, `creator-${phone ? 'phone' : 'desktop'}-${tab}.png`) });
        console.log('saved', `creator-${phone ? 'phone' : 'desktop'}-${tab}.png`);
        await page.evaluate(() => window.__ppStage.debug.pause(false));
      }
      console.log('creator errors', page.errors, 'external', page.external);
      await page.closeAll();
    }
  }
} finally {
  await browser.close();
  stop();
}
