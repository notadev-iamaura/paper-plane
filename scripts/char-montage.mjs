/** 갈무리 여러 장을 격자로 붙인다: node scripts/char-montage.mjs <나온 파일> <열 수> <칸 폭> <파일...> */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { launch, sleep } from './char-lib.mjs';
const [out, cols, w, ...files] = process.argv.slice(2);
const b = await launch();
const p = await b.newPage();
const imgs = files.map((f) => ({ src: `data:image/png;base64,${readFileSync(f).toString('base64')}`, label: basename(f, '.png') }));
await p.setViewport({ width: Number(cols) * (Number(w) + 6) + 14, height: 400, deviceScaleFactor: 1 });
await p.setContent(`<body style="margin:0;padding:8px;background:#cfe6ee;font:13px system-ui;color:#1d2a4d"><div style="display:grid;grid-template-columns:repeat(${cols},${w}px);gap:6px">${imgs.map((c) => `<div style="background:#f4efe2;border:2px solid #1d2a4d;border-radius:8px;overflow:hidden"><img src="${c.src}" width="${w}" style="display:block"><div style="padding:2px 6px 3px">${c.label}</div></div>`).join('')}</div></body>`, { waitUntil: 'load' });
await sleep(300);
await p.screenshot({ path: out, fullPage: true });
await b.close();
console.log('saved', out);
