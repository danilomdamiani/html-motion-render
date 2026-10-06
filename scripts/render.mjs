#!/usr/bin/env node
// Renderizador de animações HTML -> vídeo, frame a frame, em paralelo (puppeteer-core + Chrome headless + ffmpeg).
// A página precisa expor window.render(t) e window.DUR (veja SKILL.md).
//
// uso:
//   node render.mjs --html cena.html --out saida.mp4 [opções]
//   node render.mjs --html cena.html --bench [opções]        # mede fps por nº de instâncias e sugere o melhor
//   node render.mjs --make-intra entrada.mp4 saida.mp4        # cópia all-intra de um vídeo de fundo (seek rápido)
//
// opções:
//   --enc x264_10hq|x264|prores|prores_lt   codec de saída (padrão x264_10hq: H.264 10-bit, CRF 10, tune grain)
//   --mode opaque|alpha                     alpha = fundo transparente -> ProRes 4444 com canal alpha (.mov)
//   --width 3840 --height 2160 --fps 60
//   --dsf 2                                 escala do dispositivo: layout em (largura/2) CSS px e saída em --width (p/ páginas feitas em px de 1920x1080)
//   --query render                          acrescenta ?render à URL da página (modos de render offline)
//   --workers N                             instâncias do Chrome (padrão: calculado pela CPU; use --bench pra afinar)
//   --video --bg <intra.mp4> --loop <seg>   captura o <video id="bg"> junto, quadro a quadro (bg em loop de <seg> segundos)
//   --jpeg 97                               captura em JPEG (RASCUNHO: mais rápido, mas apaga grão e causa banding)
//   --dedupe                                pula captura de quadros idênticos (só ajuda em cenas com trechos parados)
//   --limit N                               só os N primeiros quadros (testes)
//   --cpu                                   desliga a GPU do Chrome
//   --chrome <caminho>                      executável do Chrome/Edge (ou variável CHROME_PATH)
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import os from 'node:os';
import fs from 'node:fs';

const argv = process.argv;
const has = (k) => argv.includes('--' + k);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : (i + 1 >= argv.length || argv[i + 1].startsWith('--') ? true : argv[i + 1]); };

// ---------- subcomando: cópia all-intra do fundo ----------
if (has('make-intra')) {
  const i = argv.indexOf('--make-intra'); const [inp, outp] = [argv[i + 1], argv[i + 2]];
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', inp, '-an', '-c:v', 'libx264', '-g', '1', '-crf', '14', '-preset', 'fast', '-pix_fmt', 'yuv420p', outp], { stdio: 'inherit' });
  console.log('ok', outp); process.exit(0);
}

const HTML = arg('html'); if (!HTML) { console.error('faltou --html'); process.exit(1); }
const W = +arg('width', 3840), H = +arg('height', 2160), FPS = +arg('fps', 60), DSF = +arg('dsf', 1), QUERY = arg('query', '');   // dsf 2 = layout em 1920x1080 CSS px, saída 3840x2160
const ALPHA = arg('mode', 'opaque') === 'alpha', VIDEO = has('video'), JPEG = has('jpeg') ? +arg('jpeg', 97) : 0, DEDUPE = has('dedupe');
const LIMIT = arg('limit', null), LOOP = +arg('loop', 0), BG = arg('bg', null);
const WORKERS = +arg('workers', Math.max(2, Math.min(6, Math.round(os.cpus().length / 3))));   // 12 threads -> 4 (medido: 3–4 é o ponto ótimo; mais satura a máquina)
const ENC = arg('enc', 'x264_10hq');

function findChrome() {
  const c = [arg('chrome', null), process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'];
  return c.find((p) => typeof p === 'string' && fs.existsSync(p));
}

// ---------- subcomando: benchmark de nº de instâncias ----------
if (has('bench')) {
  const self = fileURLToPath(import.meta.url), res = [];
  const base = argv.slice(2).filter((a, i, arr) => !['--bench'].includes(a) && !['--workers', '--limit', '--out'].includes(arr[i - 1]) && !['--workers', '--limit', '--out'].includes(a));
  for (const w of [2, 3, 4, 5, 6]) {
    const tmp = `${os.tmpdir()}/bench_${w}.mp4`;
    try {
      const out = execFileSync('node', [self, ...base, '--workers', String(w), '--limit', '90', '--out', tmp], { encoding: 'utf8' });
      const m = [...out.matchAll(/([\d.]+) fps/g)].pop(); res.push([w, m ? +m[1] : 0]);
    } catch { res.push([w, 0]); }
    console.log(`workers ${w}: ${res.at(-1)[1]} fps`);
  }
  const best = res.sort((a, b) => b[1] - a[1])[0];
  console.log(`melhor: --workers ${best[0]} (${best[1]} fps)`); process.exit(0);
}

const OUT = arg('out'); if (!OUT) { console.error('faltou --out'); process.exit(1); }
const chrome = findChrome(); if (!chrome) { console.error('Chrome/Edge não encontrado: use --chrome ou CHROME_PATH'); process.exit(1); }
const MAX_AHEAD = WORKERS * 4;

async function openWorker() {
  const browser = await puppeteer.launch({
    executablePath: chrome, headless: 'new',
    args: ['--hide-scrollbars', `--force-device-scale-factor=${DSF}`, `--window-size=${W / DSF},${H / DSF}`,
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--autoplay-policy=no-user-gesture-required',
      ...(has('cpu') ? [] : process.platform === 'win32' ? ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'] : ['--enable-gpu-rasterization', '--ignore-gpu-blocklist'])],
    defaultViewport: { width: W / DSF, height: H / DSF, deviceScaleFactor: DSF },
  });
  const page = await browser.newPage();
  await page.goto(pathToFileURL(HTML).href + (QUERY ? '?' + QUERY : ''), { waitUntil: 'load' });
  if (ALPHA) await page.addStyleTag({ content: 'html,body,.frame{background:transparent!important;background-image:none!important}.bg{display:none!important}' });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 400));
  // para o loop de preview da própria página: a partir daqui só o render(t) manda
  await page.evaluate(() => { if (typeof raf !== 'undefined') cancelAnimationFrame(raf); const b = document.getElementById('bg'); if (b && b.pause) b.pause(); });
  if (VIDEO) {
    await page.evaluate(async (src) => {
      const v = document.getElementById('bg');
      v.removeAttribute('autoplay'); v.removeAttribute('loop'); v.pause(); v.preload = 'auto'; v.src = src;
      await new Promise((res, rej) => { v.addEventListener('loadeddata', res, { once: true }); v.addEventListener('error', () => rej(new Error('erro no vídeo ' + (v.error && v.error.code))), { once: true }); v.load(); });
    }, pathToFileURL(BG).href);
  }
  return { browser, page, dur: await page.evaluate(() => window.DUR) };
}

async function grab(page, t) {
  await page.evaluate(async (t, useVideo, loopS) => {
    render(t);
    if (useVideo) {
      const v = document.getElementById('bg'), vt = (loopS ? t % loopS : t) + 1 / 240;   // folga de 1/4 de quadro pra cair no quadro certo
      if (Math.abs(v.currentTime - vt) > 1e-4) {
        await new Promise((res) => { const d = () => { v.removeEventListener('seeked', d); res(); }; v.addEventListener('seeked', d); v.currentTime = vt; setTimeout(d, 4000); });
      }
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));   // deixa o layout/pintura assentar
  }, t, VIDEO, LOOP);
  return JPEG ? page.screenshot({ type: 'jpeg', quality: JPEG, optimizeForSpeed: true }) : page.screenshot({ type: 'png', omitBackground: ALPHA, optimizeForSpeed: true });
}

const t0 = Date.now();
if (VIDEO && !BG) { console.error('--video exige --bg <video all-intra> (use --make-intra)'); process.exit(1); }
const workers = await Promise.all(Array.from({ length: WORKERS }, openWorker));
const dur = workers[0].dur; if (!dur) { console.error('a página não definiu window.DUR / window.render'); process.exit(1); }
const N = LIMIT ? Math.min(+LIMIT, Math.round(dur * FPS)) : Math.round(dur * FPS);
console.log(`${N} quadros (${dur}s @${FPS}) • ${W}x${H} • workers ${WORKERS} • ${ALPHA ? 'alpha' : ENC} • captura ${JPEG ? 'jpeg ' + JPEG : 'png'}${VIDEO ? ' • com vídeo' : ''} • abertura ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// ---- pré-passe opcional: quadros com DOM idêntico reaproveitam a captura ----
let src = Array.from({ length: N }, (_, i) => i), todo = src.slice();
if (DEDUPE) {
  const sigs = await workers[0].page.evaluate((N, FPS, useVideo, loopS) => {
    const f = document.getElementById('f') || document.body, out = [];
    for (let i = 0; i < N; i++) { const t = i / FPS; render(t); out.push(f.outerHTML + '|' + (useVideo ? ((loopS ? t % loopS : t)).toFixed(4) : '')); }
    const h = (s) => { let x = 5381; for (let k = 0; k < s.length; k++) x = ((x * 33) ^ s.charCodeAt(k)) >>> 0; return x + ':' + s.length; };
    return out.map(h);
  }, N, FPS, VIDEO, LOOP);
  const seen = new Map(); todo = [];
  sigs.forEach((s, i) => { if (seen.has(s)) src[i] = seen.get(s); else { seen.set(s, i); src[i] = i; todo.push(i); } });
  console.log(`dedupe: ${todo.length} quadros únicos de ${N}`);
}
let cursor = 0;

// ---- encoders ----
const cs = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
const vf = 'scale=out_color_matrix=bt709:out_range=tv';
const ENCS = {
  // H.264 10-bit 4:2:0, qualidade alta, preserva grão: evita banding em degradês escuros
  x264_10hq: ['-vf', 'scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int+error_diffusion,format=yuv420p10le', '-sws_dither', 'ed',
    '-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high10', '-level', '5.2', '-crf', '10', '-tune', 'grain', '-aq-mode', '3', '-pix_fmt', 'yuv420p10le', '-movflags', '+faststart'],
  x264: ['-vf', `${vf},format=yuv420p`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'],
  prores: ['-vf', `${vf},format=yuv422p10le`, '-c:v', 'prores_ks', '-profile:v', '3', '-vendor', 'apl0', '-pix_fmt', 'yuv422p10le'],      // 422 HQ
  prores_lt: ['-vf', `${vf},format=yuv422p10le`, '-c:v', 'prores_ks', '-profile:v', '1', '-vendor', 'apl0', '-pix_fmt', 'yuv422p10le'],
};
const encArgs = ALPHA
  ? ['-vf', `${vf},format=yuva444p10le`, '-c:v', 'prores_ks', '-profile:v', '4444', '-vendor', 'apl0', '-alpha_bits', '16', '-pix_fmt', 'yuva444p10le']
  : (ENCS[ENC] || (() => { console.error('--enc inválido: ' + Object.keys(ENCS).join(', ')); process.exit(1); })());
const ff = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', JPEG ? 'mjpeg' : 'png', '-framerate', String(FPS), '-i', 'pipe:0', ...encArgs, ...cs, '-an', OUT], { stdio: ['pipe', 'inherit', 'inherit'] });
ff.stdin.on('error', () => {});

let written = 0; const done = new Map(); let wake = null;
const notify = () => { if (wake) { const w = wake; wake = null; w(); } };
const tStart = Date.now();
async function runWorker({ page }) {
  while (true) {
    const k = cursor++; if (k >= todo.length) return;
    const i = todo[k];
    while (i - written > MAX_AHEAD) await new Promise((r) => setTimeout(r, 25));     // não deixa a fila na memória crescer
    done.set(i, await grab(page, i / FPS)); notify();
  }
}
const pool = workers.map(runWorker);
for (let i = 0; i < N; i++) {
  while (!done.has(src[i])) await new Promise((r) => { wake = r; setTimeout(r, 200); });
  const s = src[i], buf = done.get(s);
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  written = i + 1;
  if (!src.slice(i + 1).includes(s)) done.delete(s);
  if (written % 30 === 0 || written === N) { const el = (Date.now() - tStart) / 1000; console.log(`  ${written}/${N}  ${el.toFixed(0)}s  ${(written / el).toFixed(2)} fps`); }
}
await Promise.all(pool);
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
// matar os processos é bem mais rápido que browser.close() (que levava ~2 min com 6 instâncias)
workers.forEach((w) => { try { w.browser.process()?.kill('SIGKILL'); } catch {} });
console.log(`PRONTO ${OUT}  total ${((Date.now() - t0) / 1000).toFixed(0)}s`);
process.exit(0);

