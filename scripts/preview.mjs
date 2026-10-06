#!/usr/bin/env node
// Confere uma cena sem renderizar: tira prints do render(t) em instantes escolhidos e monta uma folha de contato.
// uso: node preview.mjs --html cena.html --times 0.5,2,5 [--out pasta] [--width 1280 --height 720] [--alpha] [--video bg.mp4 --loop 10] [--cols 3]
//   --alpha  mostra a transparência sobre um fundo escuro (o PNG de cada instante continua transparente)
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv;
const has = (k) => argv.includes('--' + k);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : (i + 1 >= argv.length || argv[i + 1].startsWith('--') ? true : argv[i + 1]); };
const HTML = arg('html'), TIMES = String(arg('times', '0,1,2')).split(',').map(Number);
const OUT = arg('out', path.join(process.cwd(), 'preview')), W = +arg('width', 1280), H = +arg('height', 720), COLS = +arg('cols', 3);
const ALPHA = has('alpha'), BG = arg('video', null), LOOP = +arg('loop', 0);
const chrome = [arg('chrome', null), process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => typeof p === 'string' && fs.existsSync(p));
if (!HTML || !chrome) { console.error('uso: --html <arquivo> [--times a,b,c]; Chrome não encontrado? use --chrome'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--hide-scrollbars', '--force-device-scale-factor=1', '--autoplay-policy=no-user-gesture-required'], defaultViewport: { width: W, height: H, deviceScaleFactor: 1 } });
const page = await browser.newPage();
await page.goto(pathToFileURL(HTML).href, { waitUntil: 'load' });
if (ALPHA) await page.addStyleTag({ content: 'html,body,.frame{background:transparent!important;background-image:none!important}.bg{display:none!important}' });
await page.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 200));
await page.evaluate(() => { if (typeof raf !== 'undefined') cancelAnimationFrame(raf); const b = document.getElementById('bg'); if (b && b.pause) b.pause(); });
if (BG) await page.evaluate(async (src) => { const v = document.getElementById('bg'); v.removeAttribute('loop'); v.src = src; await new Promise((r) => { v.addEventListener('loadeddata', r, { once: true }); v.load(); }); }, pathToFileURL(path.resolve(BG)).href);

const files = [];
for (const t of TIMES) {
  await page.evaluate(async (t, useVideo, loopS) => {
    render(t);
    if (useVideo) { const v = document.getElementById('bg'); await new Promise((r) => { const d = () => { v.removeEventListener('seeked', d); r(); }; v.addEventListener('seeked', d); v.currentTime = (loopS ? t % loopS : t) + 1 / 240; setTimeout(d, 3000); }); }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, t, !!BG, LOOP);
  const f = path.join(OUT, `t_${String(t).replace('.', '_')}.png`);
  await page.screenshot({ path: f, omitBackground: ALPHA }); files.push(f);
}
await browser.close();

// folha de contato (ffmpeg); com --alpha compõe sobre fundo escuro
const rows = Math.ceil(files.length / COLS), cell = `${W}x${H}`;
const inputs = files.flatMap((f) => ['-i', f]);
const prep = files.map((_, i) => ALPHA ? `[${i}:v]format=rgba,pad=iw:ih:0:0:color=0x0b1c4a@1[p${i}]` : `[${i}:v]null[p${i}]`);
const ovl = ALPHA ? files.map((_, i) => `color=c=0x0b1c4a:s=${cell}[bg${i}];[bg${i}][${i}:v]overlay[p${i}]`).join(';') : prep.join(';');
const rowsF = []; for (let r = 0; r < rows; r++) { const ids = files.map((_, i) => i).slice(r * COLS, (r + 1) * COLS); rowsF.push(`${ids.map((i) => `[p${i}]`).join('')}hstack=inputs=${ids.length}${ids.length < COLS ? `,pad=${W * COLS}:${H}` : ''}[r${r}]`); }
const graph = rows === 1 ? `${ovl};${rowsF.join(';')};[r0]scale=2000:-1` : `${ovl};${rowsF.join(';')};${rowsF.map((_, r) => `[r${r}]`).join('')}vstack=inputs=${rows},scale=2000:-1`;
try { execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...inputs, '-filter_complex', graph, '-frames:v', '1', path.join(OUT, 'sheet.png')]); console.log('folha:', path.join(OUT, 'sheet.png')); }
catch { console.log('(não consegui montar a folha; os prints individuais estão em', OUT, ')'); }

