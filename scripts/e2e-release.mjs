/**
 * 던지는 순간이 끊기지 않는지 본다("한 번 딱! 멈췄다가 던진다"는 문제의 검사).
 * 휴대전화 크기로 뾰족 화살을 꾹 눌러 힘을 모았다가 놓고, 그 뒤 0.8초 동안 화면마다 비행기 자리와 아이 오른손 자리를 잰다.
 * 둘 다 거의 움직이지 않은 프레임이 연달아 3장 이상이면 실패다. 계산(작업 스레드)을 일부러 늦춘 경우도 본다.
 * 그리고 같은 장면을 시간을 멈춰 가며 몇 장 찍는다(screenshots/v10-balance/release-*.png).
 *
 * 준비: npm run build      실행: node scripts/e2e-release.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(ROOT, 'screenshots', 'v10-balance');
const PORT = 4187;
const BASE = `http://127.0.0.1:${PORT}/`;
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = (id) => `[data-testid="${id}"]`;
const reachable = async (u) => { try { return (await fetch(u)).ok; } catch { return false; } };
const failures = [];
let checks = 0;
const expect = (name, ok, detail = '') => { checks++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failures.push(name); };

let preview = null;
if (!(await reachable(BASE))) {
  preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1', '--outDir', 'dist'], { cwd: ROOT, stdio: 'ignore', detached: true });
  for (let i = 0; i < 60 && !(await reachable(BASE)); i++) await sleep(250);
}
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

/** 다 접은 뾰족 화살을 든 지난 방문 상태 */
const session = { screen: 'home', deskStep: 'shape', paperId: 'copy80', foldMode: 'simple', presetId: 'dart', presetParams: {}, presetChosen: true, guideFolds: null, freeFolds: [], freeShaping: { keelM: 0.02, dihedralDeg: 8, wingletM: 0, wingletDeg: 0, elevatorDeg: 3 }, clip: null, throwIn: { speedMps: 6, pitchDeg: 5, rollDeg: 0 }, mode: 'distance' };

async function openThrow({ slowWorkerMs = 0 } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 360, height: 740, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument((s, slow) => {
    localStorage.setItem('pp.session.v2', JSON.stringify(s));
    localStorage.setItem('pp.introSeen.v1', 'true');
    localStorage.setItem('pp.aimCoach.v1', JSON.stringify({ angle: true, charge: true, throws: 9, cancelHint: 9 }));
    if (slow > 0) {
      // 계산 결과가 늦게 오는 기기 흉내: 작업 스레드의 답을 slow ms 늦게 건넨다.
      const W = window.Worker;
      window.Worker = class extends W {
        constructor(...a) {
          super(...a);
          const add = this.addEventListener.bind(this);
          this.addEventListener = (type, fn, o) => add(type, type === 'message' ? (e) => setTimeout(() => fn(e), slow) : fn, o);
          let on = null;
          Object.defineProperty(this, 'onmessage', { get: () => on, set: (fn) => { on = fn; add('message', (e) => setTimeout(() => fn && fn(e), slow)); } });
        }
      };
    }
  }, session, slowWorkerMs);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(T('go-throw'), { timeout: 15000 });
  await sleep(1500);
  await page.$eval(T('go-throw'), (el) => el.click());
  await page.waitForSelector(T('throw-btn'), { timeout: 10000 });
  await sleep(2500);
  return page;
}

/** 꾹 눌러 holdMs 뒤에 놓고, 놓은 뒤 0.8초 동안 화면마다 움직임을 잰다. */
async function measure(page, holdMs, stepped) {
  const b = await page.$eval(T('throw-btn'), (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.evaluate(() => {
    window.__rec = [];
    // 무대가 실제로 새로 그린 프레임만 적는다(느린 기기에서 무대가 프레임 사이에 쉬는 동안의 브라우저 프레임은 화면이 바뀌지 않으므로 세지 않는다).
    let last = -1;
    const tick = () => { const d = window.__ppStage?.debug; const f = d?.frames?.(); if (d && f !== last) { last = f; window.__rec.push({ t: performance.now(), ...d.motion() }); } if (window.__rec.length < 4000) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await page.touchscreen.touchStart(b.x, b.y);
  await sleep(holdMs);
  const upAt = await page.evaluate(() => performance.now());
  await page.touchscreen.touchEnd();
  if (stepped) {
  // 정밀하게: 놓자마자 시간을 멈추고 1/60초씩 넘기며 잰다(느린 소프트웨어 렌더러의 프레임 간격과 상관없이 60장/초 기준).
    const steps = await page.evaluate(async () => {
      const d = window.__ppStage.debug;
      d.pause(true);
      const out = [];
      for (let i = 0; i < 60; i++) {
        out.push(d.motion());
        d.step(1 / 60);
        // 계산(작업 스레드)의 답이 올 틈을 실제 시간으로도 준다
        await new Promise((r) => setTimeout(r, 16));
      }
      d.pause(false);
      return out;
    });
    let srun = 0, sworst = 0, sAt = null;
    const mv0 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    for (let i = 1; i < steps.length; i++) {
      const dd = Math.max(mv0(steps[i].plane, steps[i - 1].plane), mv0(steps[i].hand, steps[i - 1].hand));
      if (dd < 0.001) { srun++; if (srun > sworst) { sworst = srun; sAt = steps[i]; } } else srun = 0;
    }
    return { sworst, sAt, sphases: [...new Set(steps.map((r) => r.phase))].join('>') };
  }
  await sleep(1400);
  const rec = await page.evaluate(() => window.__rec);
  const win = rec.filter((r) => r.t >= upAt - 30 && r.t <= upAt + 800);
  const mv = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  let run = 0, worst = 0, worstAt = null;
  for (let i = 1; i < win.length; i++) {
    const d = Math.max(mv(win[i].plane, win[i - 1].plane), mv(win[i].hand, win[i - 1].hand));
    if (d < 0.001) { run++; if (run > worst) { worst = run; worstAt = win[i]; } } else run = 0;
  }
  const phases = [...new Set(win.map((r) => r.phase))].join('>');
  const gaps = win.slice(1).map((r, i) => r.t - win[i].t);
  return { frames: win.length, worst, worstAt, phases, maxGap: Math.max(...gaps) };
}

try {
  for (const [label, hold, slow] of [['보통으로 모아 던지기', 700, 0], ['끝까지 모아 던지기(팔을 다 당긴 채)', 1380, 0], ['톡 던지기', 60, 0], ['계산이 0.6초 늦을 때', 1380, 600]]) {
    const pageS = await openThrow({ slowWorkerMs: slow });
    const sm = await measure(pageS, hold, true);
    await pageS.browserContext().close();
    const page = await openThrow({ slowWorkerMs: slow });
    const m = { ...(await measure(page, hold, false)), ...sm };
    expect(`1/60초씩 넘겨 보아도 놓은 뒤 1초 동안 멈춘 장면이 2장을 넘지 않는다: ${label}`, m.sworst <= 2, `가장 긴 멈춤 ${m.sworst}장${m.sAt ? ` (${m.sAt.phase}, throwT ${m.sAt.throwT.toFixed(2)})` : ''}, 단계 ${m.sphases}`);
    expect(`놓은 뒤 그려진 프레임 가운데 멈춰 보이는 것이 2장을 넘지 않는다: ${label}`, m.frames >= 2 && m.worst <= 2, `프레임 ${m.frames}장, 가장 긴 멈춤 ${m.worst}장${m.worstAt ? ` (${m.worstAt.phase}, throwT ${m.worstAt.throwT.toFixed(2)})` : ''}, 단계 ${m.phases}, 가장 긴 프레임 간격 ${m.maxGap.toFixed(0)} ms`);
    await page.browserContext().close();
  }

  // 갈무리: 시간을 멈추고 0.06초씩 넘기며 찍는다(끝까지 모은 뒤 놓은 순간부터).
  const page = await openThrow({ slowWorkerMs: 400 });
  const b = await page.$eval(T('throw-btn'), (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.touchscreen.touchStart(b.x, b.y);
  await sleep(1380);
  await page.touchscreen.touchEnd();
  await page.evaluate(() => window.__ppStage.debug.pause(true));
  const seq = [];
  for (let i = 0; i < 8; i++) {
    const m = await page.evaluate(() => window.__ppStage.debug.motion());
    seq.push(`${i}: ${m.phase} 손 (${m.hand.map((v) => v.toFixed(2)).join(', ')}) 비행기 (${m.plane.map((v) => v.toFixed(2)).join(', ')})`);
    await page.screenshot({ path: join(SHOTS, `release-${String(i).padStart(2, '0')}.png`) });
    await page.evaluate(() => window.__ppStage.debug.step(0.06));
  }
  console.log(seq.join('\n'));
  await page.browserContext().close();
} finally {
  await browser.close();
  if (preview) { try { process.kill(-preview.pid); } catch { /* 끝남 */ } }
}
console.log(`\n검사 ${checks}개 중 실패 ${failures.length}개`);
if (failures.length) process.exitCode = 1;
