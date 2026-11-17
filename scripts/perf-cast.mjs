/**
 * 성능 재기: 단계(high / medium / low)마다 대회장, 조준, 비행 장면의 그리기 호출 수, 삼각형 수, 프레임 시간을 잰다.
 *
 * 실행: node scripts/perf-cast.mjs --dir=dist-cast [--port=4181] [--tiers=low,medium,high] [--label=after]
 *   소프트웨어 렌더러(swiftshader), 360 x 740, 화소 비율 1.
 *   stepMs = 멈춘 채로 한 프레임씩 넘기며(update + render + gl.finish) 잰 평균 시간. 다른 일에 덜 흔들린다.
 *   liveMs = 스스로 도는 동안 무대가 잰 프레임 비용(debug.info().frameMs).
 *   firstFrameMs = 페이지를 연 뒤 3D 첫 그림이 나올 때까지(performance mark 'pp3d-first-frame').
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1];
const DIR = arg('dir', 'dist-cast');
const PORT = Number(arg('port', '4181'));
const TIERS = arg('tiers', 'low,medium,high').split(',');
const LABEL = arg('label', DIR);
const CAST = arg('cast', '');
const SCENES = arg('scenes', 'home,aim,flight').split(',');
const BASE = `http://127.0.0.1:${PORT}/`;
const CODE = 'P19uWgrXAv9kAn015ONpdOEaSzCL1klCelt5QC0ReLIhfeF338e14N3BxJoblqZBi1F5EVBgkLJ';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = (id) => `[data-testid="${id}"]`;

async function reachable(url) { try { return (await fetch(url)).ok; } catch { return false; } }
const child = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1', '--outDir', DIR], { cwd: ROOT, stdio: 'ignore', detached: true });
for (let i = 0; i < 80; i++) { if (await reachable(BASE)) break; await sleep(250); }

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const rows = [];
try {
  for (const tier of TIERS) {
    const page = await browser.newPage();
    await page.setViewport({ width: 360, height: 740, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await page.evaluateOnNewDocument((t, cast) => { try { localStorage.setItem('pp-3d-tier', t); localStorage.setItem('pp.introSeen.v1', 'true'); if (cast) localStorage.setItem('pp-cast', cast); } catch { /* 무시 */ } }, tier, CAST);
    await page.goto(`${BASE}#p${CODE}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ppStage && window.__ppStage.debug, { timeout: 60000 });
    await page.waitForFunction(() => performance.getEntriesByName('pp3d-first-frame').length > 0, { timeout: 120000 });
    const firstFrameMs = await page.evaluate(() => Math.round(performance.getEntriesByName('pp3d-first-frame')[0].startTime));
    // 심판, 관중, 모델이 모두 들어올 때까지 기다린다
    await page.waitForFunction(() => performance.getEntriesByName('pp3d-extras').length > 0, { timeout: 120000 });
    await sleep(6000);
    const measure = async (scene) => {
      await sleep(3500);
      const live = await page.evaluate(() => window.__ppStage.debug.info());
      const stepMs = await page.evaluate(() => {
        const s = window.__ppStage;
        s.debug.pause(true);
        const gl = s.renderer.getContext();
        const px = new Uint8Array(4);
        const once = () => { s.debug.step(1 / 30); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
        for (let i = 0; i < 3; i++) once();
        const t0 = performance.now();
        const n = 12;
        for (let i = 0; i < n; i++) once();
        const ms = (performance.now() - t0) / n;
        return ms;
      });
      const info = await page.evaluate(() => window.__ppStage.debug.info());
      await page.evaluate(() => window.__ppStage.debug.pause(false));
      rows.push({ label: LABEL, tier, now: info.tier, scene, calls: info.calls, triangles: info.triangles, stepMs: +stepMs.toFixed(1), liveMs: +live.frameMs.toFixed(1), updateMs: +info.updateMs.toFixed(2), firstFrameMs });
      console.log(JSON.stringify(rows[rows.length - 1]));
    };
    // 대회장
    if (await page.$(T('throw-btn'))) { await page.tap(T('nav-home')); await page.waitForSelector(T('go-desk'), { timeout: 10000 }); }
    if (SCENES.includes('home')) await measure('home');
    // 조준
    await page.evaluate(() => { const s = window.__ppStage; s.showAim(); s.setAim(20, 0, 0.3); });
    if (SCENES.includes('aim')) await measure('aim');
    // 비행(길게 날려 둔다)
    if (SCENES.includes('flight')) {
      await page.evaluate(() => window.__ppStage.debug.fakeThrow(24, 60));
      await sleep(1500);
      await measure('flight');
    }
    await page.close();
  }
} finally {
  await browser.close();
  try { process.kill(-child.pid); } catch { /* 이미 끝남 */ }
}
writeFileSync(join(ROOT, 'screenshots', 'v5-cast', `perf-${LABEL}.json`), JSON.stringify(rows, null, 1));
