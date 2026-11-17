/**
 * 내 캐릭터(꾸미기) 검사와 갈무리가 함께 쓰는 도구: 미리보기 서버, 브라우저, 무대가 준비될 때까지 기다리기.
 * 소프트웨어 렌더러(swiftshader)라 느리다. 기다리는 시간을 넉넉히 둔다.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const T = (id) => `[data-testid="${id}"]`;
export const CODE = 'P19uWgrXAv9kAn015ONpdOEaSzCL1klCelt5QC0ReLIhfeF338e14N3BxJoblqZBi1F5EVBgkLJ';

async function reachable(url) { try { return (await fetch(url)).ok; } catch { return false; } }

export async function serve(dir, port) {
  const base = `http://127.0.0.1:${port}/`;
  let child = null;
  if (!(await reachable(base))) {
    child = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1', '--outDir', dir], { cwd: ROOT, stdio: 'ignore', detached: true });
    for (let i = 0; i < 80; i++) { if (await reachable(base)) break; await sleep(250); }
  }
  return { base, stop: () => { if (child) { try { process.kill(-child.pid); } catch { /* 이미 끝났다 */ } } } };
}

export function launch() {
  return puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
}

/**
 * 새 탭을 연다. opts: { phone, tier, look(저장해 둘 차림), storage: 'block', before(page) }
 * 돌려주는 값에 errors(콘솔 오류), external(바깥 요청) 목록이 붙는다.
 */
export async function open(browser, base, opts = {}) {
  // 탭마다 저장소를 따로 쓴다(앞 탭이 남긴 값이 섞이지 않게)
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.closeAll = () => ctx.close();
  if (opts.phone !== false) await page.setViewport({ width: 360, height: 740, deviceScaleFactor: opts.dpr ?? 1, isMobile: true, hasTouch: true });
  else await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  const errors = [], external = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(base) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u); });
  await page.evaluateOnNewDocument((o) => {
    if (o.storage === 'block') {
      Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('막힘', 'SecurityError'); } });
      return;
    }
    try {
      if (!sessionStorage.getItem('__seeded')) {
        sessionStorage.setItem('__seeded', '1');
        if (o.tier) localStorage.setItem('pp-3d-tier', o.tier);
        if (o.intro !== false) localStorage.setItem('pp.introSeen.v1', 'true');
        if (o.nudge !== false) localStorage.setItem('pp.characterNudge.v1', 'true');
        if (o.look) localStorage.setItem('pp.character.v1', JSON.stringify(o.look));
        for (const [k, v] of Object.entries(o.extra ?? {})) localStorage.setItem(k, v);
      }
    } catch { /* 무시 */ }
  }, { tier: opts.tier ?? 'high', look: opts.look ?? null, storage: opts.storage ?? '', intro: opts.intro, nudge: opts.nudge, extra: opts.extra ?? {} });
  if (opts.before) await opts.before(page);
  await page.goto(`${base}${opts.hash ?? ''}`, { waitUntil: 'load' });
  page.errors = errors;
  page.external = external;
  return page;
}

/** 체육관의 아이(모델)와 심판, 관중이 다 설 때까지 기다린다. */
export async function ready(page, kind = 'glb', extras = true) {
  await page.waitForFunction(() => window.__ppStage && window.__ppStage.debug, { timeout: 90000 });
  await page.waitForFunction(() => performance.getEntriesByName('pp3d-first-frame').length > 0, { timeout: 180000 });
  if (kind) await page.waitForFunction((k) => window.__ppStage.debug.kidKind() === k && !window.__ppStage.kidHeld, { timeout: 180000 }, kind);
  if (extras) await page.waitForFunction(() => performance.getEntriesByName('pp3d-extras').length > 0, { timeout: 180000 }).catch(() => undefined);
  await sleep(600);
}

/** 멈춘 채로 seconds 만큼 넘긴 뒤 한 장 그린다(갈무리가 흔들리지 않는다). */
export async function settle(page, seconds = 1.2) {
  await page.evaluate((s) => { const st = window.__ppStage; st.debug.pause(true); st.debug.step(s); }, seconds);
  await sleep(150);
}
