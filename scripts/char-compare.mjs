/**
 * 기본 차림의 아이가 예전과 똑같이 보이는지: 예전 빌드와 지금 빌드를 같은 시각, 같은 카메라로 그려 화소를 견준다.
 * 실행: node scripts/char-compare.mjs --before=dist-char-before --after=dist-char
 *   screenshots/v7-character/default-compare.png (예전 | 지금 | 차이 x8)
 */
import { join } from 'node:path';
import { CODE, launch, open, ready, ROOT, serve, sleep } from './char-lib.mjs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1];
const VIEWS = [
  ['앞', { pos: [2.3, 1.35, 1.2], look: [-0.4, 1.12, -0.56], tanH: 0.3, tanV: 0.3 }],
  ['옆', { pos: [-0.2, 1.4, 2.6], look: [-0.4, 1.1, -0.56], tanH: 0.3, tanV: 0.3 }],
  ['뒤', { pos: [-3.0, 1.6, -1.6], look: [-0.4, 1.1, -0.56], tanH: 0.3, tanV: 0.3 }],
  ['얼굴', { pos: [1.2, 1.5, 0.3], look: [-0.4, 1.36, -0.56], tanH: 0.3, tanV: 0.3 }],
];
const browser = await launch();
const shots = {};
try {
  for (const [which, dir, port] of [['before', arg('before', 'dist-char-before'), 4193], ['after', arg('after', 'dist-char'), 4194]]) {
    const { base, stop } = await serve(dir, port);
    const page = await open(browser, base, { tier: 'high', hash: `#p${CODE}` });
    await ready(page);
    await page.addStyleTag({ content: '.app__main, .bar, .toast { visibility: hidden !important; }' });
    shots[which] = [];
    for (const [, cam] of VIEWS) {
      await page.evaluate((c) => {
        const s = window.__ppStage;
        s.debug.pause(true);
        s.clock = 20; s.phaseT = 5; s.kidT = 5; s.refT = 5;
        s.kid.snap();
        s.debug.cam(c);
        s.debug.step(2);
      }, cam);
      await sleep(200);
      shots[which].push(`data:image/png;base64,${(await page.screenshot({ clip: { x: 0, y: 150, width: 360, height: 440 } })).toString('base64')}`);
    }
    await page.closeAll();
    stop();
  }
  const page = await browser.newPage();
  await page.setViewport({ width: 3 * 366 + 14, height: 400, deviceScaleFactor: 1 });
  await page.setContent('<body style="margin:0;padding:8px;background:#cfe6ee;font:13px system-ui"><div id="g" style="display:grid;grid-template-columns:repeat(3,360px);gap:6px"></div></body>');
  const stats = await page.evaluate(async (b, a, names) => {
    const load = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = src; });
    const out = [];
    for (let k = 0; k < b.length; k++) {
      const ib = await load(b[k]), ia = await load(a[k]);
      const mk = () => { const c = document.createElement('canvas'); c.width = ib.width; c.height = ib.height; return c; };
      const cb = mk(), ca = mk(), cd = mk();
      cb.getContext('2d').drawImage(ib, 0, 0); ca.getContext('2d').drawImage(ia, 0, 0);
      const db = cb.getContext('2d').getImageData(0, 0, cb.width, cb.height), da = ca.getContext('2d').getImageData(0, 0, ca.width, ca.height);
      const dd = cd.getContext('2d').createImageData(cb.width, cb.height);
      let sum = 0, big = 0;
      for (let i = 0; i < db.data.length; i += 4) {
        const d = Math.max(Math.abs(db.data[i] - da.data[i]), Math.abs(db.data[i + 1] - da.data[i + 1]), Math.abs(db.data[i + 2] - da.data[i + 2]));
        sum += d; if (d > 24) big++;
        const v = Math.min(255, d * 8);
        dd.data[i] = v; dd.data[i + 1] = v; dd.data[i + 2] = v; dd.data[i + 3] = 255;
      }
      cd.getContext('2d').putImageData(dd, 0, 0);
      const n = db.data.length / 4;
      out.push({ view: names[k], mean: +(sum / n).toFixed(3), bigPct: +((big / n) * 100).toFixed(3) });
      for (const [c, t] of [[cb, `예전 ${names[k]}`], [ca, `지금 ${names[k]}`], [cd, `차이 x8 (평균 ${(sum / n).toFixed(2)}, 크게 다른 화소 ${((big / n) * 100).toFixed(2)}%)`]]) {
        const w = document.createElement('div'); w.append(c); const l = document.createElement('div'); l.textContent = t; w.append(l); document.getElementById('g').append(w);
      }
    }
    return out;
  }, shots.before, shots.after, VIEWS.map((v) => v[0]));
  await page.screenshot({ path: join(ROOT, 'screenshots', 'v7-character', 'default-compare.png'), fullPage: true });
  console.log(JSON.stringify(stats));
} finally { await browser.close(); }
