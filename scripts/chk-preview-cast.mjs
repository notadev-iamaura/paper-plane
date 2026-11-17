/**
 * 모델을 JS 안에 넣은 빌드(PP_INLINE_FONTS=1)에서 아이, 심판, 관중 모델이 네트워크 요청 없이 들어오는지 확인한다.
 * 준비: PP_INLINE_FONTS=1 npx vite build --outDir dist-preview-cast
 * 실행: node scripts/chk-preview-cast.mjs [--tier=high|medium|low]
 */
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
const tier = (process.argv.find((a) => a.startsWith('--tier=')) ?? '--tier=high').split('=')[1];
const PORT = 4194, BASE = `http://127.0.0.1:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const child = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1', '--outDir', 'dist-preview-cast'], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore', detached: true });
for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE)).ok) break; } catch { /* 아직 */ } await sleep(250); }
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
const errs = [], reqs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errs.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
page.on('request', (r) => { const u = r.url(); if (!u.startsWith('data:') && !u.startsWith('blob:')) reqs.push(u.replace(BASE, '/')); });
await page.setViewport({ width: 360, height: 740, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument((t) => { localStorage.setItem('pp.introSeen.v1', 'true'); localStorage.setItem('pp-3d-tier', t); }, tier);
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ppStage && window.__ppStage.debug, { timeout: 60000 });
await page.waitForFunction(() => window.__ppStage.debug.kidKind() === 'glb' && window.__ppStage.debug.castReady(), { timeout: 120000 }).catch(() => errs.push('모델을 기다리다 시간이 넘었어요'));
await sleep(1500);
const st = await page.evaluate(() => {
  const s = window.__ppStage;
  let ref = false, crowd = 0;
  s.debug.scene().traverse((o) => { if (o.isSkinnedMesh && o.name.startsWith('referee_body')) ref = true; if (o.isInstancedMesh && o.geometry.getAttribute('_jw') && o.visible) crowd += o.count; });
  return { kid: s.debug.kidKind(), ref, crowd, info: s.debug.info() };
});
const glbReqs = reqs.filter((u) => u.includes('.glb'));
const ext = reqs.filter((u) => /^https?:/.test(u));
console.log(`단계 ${tier}: 아이 ${st.kid}, 심판 모델 ${st.ref}, 새 관중 ${st.crowd}명(외곽선 포함 인스턴스 수), 그리기 호출 ${st.info.calls}, 삼각형 ${st.info.triangles}`);
console.log(`요청 ${reqs.length}건: ${reqs.join(' ')}`);
console.log(`.glb 요청 ${glbReqs.length}건, 바깥 요청 ${ext.length}건, 콘솔 문제 ${errs.length}건 ${errs.slice(0, 5).join(' | ')}`);
await page.screenshot({ path: new URL('../screenshots/v5-cast/preview-inline-home.png', import.meta.url).pathname });
await browser.close();
try { process.kill(-child.pid); } catch { /* 이미 끝남 */ }
process.exit(st.kid === 'glb' && st.ref && st.crowd > 0 && glbReqs.length === 0 && ext.length === 0 && errs.length === 0 ? 0 : 1);
