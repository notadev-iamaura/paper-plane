// 빠른 확인용: 여러 그림을 한 장에 붙인다.  node /tmp/montage.mjs out.png cols cellW a.png b.png ...
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
const [out, cols, cellW, ...files] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
const imgs = files.map((f) => `<div style="position:relative"><img style="width:100%;display:block" src="data:image/png;base64,${readFileSync(f).toString('base64')}"><span style="position:absolute;left:4px;top:4px;background:#ffc533;font:12px sans-serif;padding:2px 4px">${f.split('/').pop().replace('.png','')}</span></div>`).join('');
await page.setViewport({ width: Number(cols) * Number(cellW), height: 100 });
await page.setContent(`<body style="margin:0"><div style="display:grid;grid-template-columns:repeat(${cols},${cellW}px)">${imgs}</div></body>`);
await page.evaluate(() => Promise.all([...document.images].map((im) => im.decode())));
await page.screenshot({ path: out, fullPage: true });
await browser.close();
