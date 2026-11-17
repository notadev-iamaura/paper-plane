import puppeteer from 'puppeteer-core';
import { preview } from 'vite';
const srv = await preview({ root: '/home/claude/paper-plane', build: { outDir: 'dist-preview' }, preview: { port: 4188 } });
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const p = await b.newPage(); const errs = [];
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
p.on('request', r => { if (!r.url().startsWith('http://localhost') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) errs.push('EXT ' + r.url()); });
await p.setViewport({ width: 360, height: 740 });
await p.goto('http://localhost:4188/');
let kind = null;
for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 1000)); kind = await p.evaluate(() => window.__ppStage?.debug?.kidKind?.()); if (kind === 'glb') break; }
console.log('KID', kind, 'ERRS', JSON.stringify(errs));
await p.screenshot({ path: '/home/claude/paper-plane/screenshots/v4-kid/preview-home.png' });
await b.close(); await new Promise(r => srv.httpServer.close(r)); process.exit(0);
