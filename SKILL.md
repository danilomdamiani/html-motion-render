---
name: html-motion-render
description: Cria motion graphics (cards, lower thirds, títulos, infográficos, fundos animados) como HTML/CSS/JS com animação suave e determinística, confere por quadros congelados e renderiza em vídeo (H.264 10-bit, ProRes, ou ProRes 4444 com alpha) localmente em 4K60, ajustando o render ao hardware do PC. Use quando o pedido for "animar isso em HTML", "fazer um lower third / gráfico / storyboard animado e renderizar", ou "renderizar esse HTML em vídeo".
---

# HTML → vídeo: animações suaves com render local

Fluxo: **escrever a cena → conferir por quadros → renderizar com o hardware da máquina → verificar o arquivo**.
O HTML é só a fonte; o vídeo sai de capturar `render(t)` quadro a quadro, então o resultado é exato e independe do desempenho do navegador.

## 1. Contrato da cena (obrigatório)

A página precisa de:

- **`window.DUR`**: duração em segundos.
- **`window.render(t)`**: coloca a cena no instante `t` (segundos). **Determinística**: o mesmo `t` sempre dá o mesmo quadro, sem ler relógio, `Math.random()` solto nem estado acumulado.
- Um contêiner `#f` (o "frame" 16:9) e, se houver fundo em vídeo, `<video id="bg" muted playsinline>`.
- Um loop de preview que pode ser cancelado: guarde o id do `requestAnimationFrame` numa variável global `raf` (o renderizador faz `cancelAnimationFrame(raf)` e passa a mandar ele mesmo).
- Fontes realmente instaladas (ou embutidas) e `document.fonts.ready` antes de começar.

Tamanhos em **`cqw`** (`container-type:inline-size` no `#f`): a cena escala sozinha de 1280 a 3840 de largura, então o preview pequeno é fiel ao 4K.

Padrão de arquivo (esqueleto):

```js
const DUR = 5;
const clamp = (x) => Math.min(1, Math.max(0, x));
const prog = (t, a, b) => clamp((t - a) / (b - a));
function bezier(x1, y1, x2, y2) {              // igual ao cubic-bezier() do CSS
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (s) => ((ax * s + bx) * s + cx) * s, Y = (s) => ((ay * s + by) * s + cy) * s;
  return (p) => { if (p <= 0) return 0; if (p >= 1) return 1; let lo = 0, hi = 1, s = p; for (let i = 0; i < 40; i++) { s = (lo + hi) / 2; X(s) < p ? lo = s : hi = s; } return Y(s); };
}
const ease = bezier(0.529, -0.008, 0, 1.005);  // arranque lento, pouso longo e macio
const win = (t, a, b) => ease(prog(t, a, b));  // progresso suavizado da janela [a,b]
function enter(node, p, dx = 0, dy = 0, blur = .6, s0 = 1) {   // entrada: fade + deslocamento + escala + blur que se desfaz
  p = Math.max(0, p); const q = Math.min(1, p);
  node.style.opacity = q;
  node.style.transform = `translate(${((1 - p) * dx).toFixed(3)}cqw,${((1 - p) * dy).toFixed(3)}cqw) scale(${(s0 + (1 - s0) * p).toFixed(4)})`;
  node.style.filter = p >= 1 ? 'none' : `blur(${((1 - q) * blur).toFixed(3)}cqw)`;
}
function render(t) { /* tudo aqui é função de t */ }
window.render = render; window.DUR = DUR;
```

Se usar **animações CSS** em vez de `render(t)`, o gancho é `window.render = (t) => document.getAnimations().forEach(a => { a.pause(); a.currentTime = t * 1000 })`. Atenção: nesse caso `--dedupe` não funciona (o DOM inline não muda).

## 2. Como animar (suave e com intenção)

- **Um easing só por peça** (ou por série), aplicado a tudo: entradas, câmera, barras, contadores. Curva de arranque lento e pouso longo (a do esqueleto) lê como "premium". Evite `linear` e `ease-in-out` genérico.
- **Entradas com 3 camadas juntas**: fade + deslocamento curto (2–6 cqw) + blur que se desfaz (0,5–1,2 cqw). Fica macio sem exagero.
- **Stagger**: itens um por um, 0,3–0,5 s de diferença; cada item ~0,8–1 s. Sincronize com a fala/timestamps dados caso sejam dados (o tempo relativo ao início do trecho vira `t`).
- **Câmera**: aplique zoom/pan num contêiner `world` (`transform-origin` no ponto de interesse). Blur leve proporcional à **velocidade** do movimento (derivada do easing) dá sensação de movimento sem borrar o repouso. Pans longos e lentos; empurrões curtos acompanhando a fala.
- **Variar a abertura** de cada peça num lote (zoom a partir do centro, subida com blur, deslize lateral, zoom no canto…). Não abra tudo igual.
- **Cenas longas** (10–30 s): nada de ficar parado, mas sem loops chamativos. Use deriva lenta de câmera (`sin` com período longo) e no máximo um pulso/brilho por elemento.
- Valores que contam (números, %): `Math.round(final * win(t, a, b))`, formatados com `Intl.NumberFormat`.
- **Fundos animados em loop perfeito**: toda função do tempo com período inteiro (`sin(2π·k·t/P)`, k inteiro), assim o último quadro emenda no primeiro.
- Fundo em vídeo: aplique zoom leve + deslocamento menor que o dos elementos (parallax) acompanhando a câmera.
- Textos: confira quebras de linha e estouro de caixa em vários instantes. Palavras longas em alemão quebram feio: `text-wrap:balance`, tamanhos menores, ou `&shy;`.
- Para fundo transparente (lower thirds): `background:transparent` no `html,body,.frame`. No preview use um xadrez; o renderizador o remove.

## 3. Conferir antes de renderizar

```
node scripts/preview.mjs --html cena.html --times 0.4,1.5,3,5 --out prev [--alpha] [--video bg.mp4 --loop 10]
```

Gera um PNG por instante + `sheet.png` (folha de contato). **Olhe a folha**: início (cortes e blur), meio das transições, estado final, e o último instante. Procure texto cortado, itens sobrepostos, câmera cortando conteúdo, espaços vazios. Corrija e repita; só depois renderize. Para ver o vídeo de fundo em movimento no navegador, sirva a pasta por HTTP (`python -m http.server`): arquivos locais abertos como snapshot não carregam `<video>`.

## 4. Renderizar (adaptado ao PC)

Uma vez: `cd scripts && npm install` (precisa de Node, ffmpeg no PATH e Chrome ou Edge).

```
node scripts/render.mjs --html cena.html --out saida.mp4                  # H.264 10-bit, 4K60, PNG sem perdas
node scripts/render.mjs --html cena.html --out saida.mov --mode alpha     # ProRes 4444 com transparência
node scripts/render.mjs --html cena.html --bench                          # mede fps por nº de instâncias
```

Páginas feitas em **px** (não cqw) para 1920×1080: use `--dsf 2` (layout em 1920×1080 CSS px, saída 3840×2160 nítida) e, se a página tem modo de render offline por query, `--query render`.

**Afine ao hardware com `--bench`** (roda 90 quadros com 2–6 instâncias do Chrome e diz a melhor). Não suponha que mais instâncias seja melhor: numa máquina de 6 núcleos/12 threads + GTX 1060, 3–4 instâncias deram ~5 fps e 6 instâncias caíram para ~3 (a máquina satura). O padrão do script é `threads/3`.

**Qualidade (importante):**
- Capture **PNG** (padrão). `--jpeg` é só rascunho: a compressão apaga o grão fino e **causa banding** em degradês escuros e suaves.
- Para fundos escuros com degradê, use **10-bit**. O padrão `x264_10hq` é H.264 High10, CRF 10, `tune grain`, 4:2:0 (Premiere recente costuma abrir; se não abrir, use `--enc prores` = ProRes 422 HQ, que abre em qualquer lugar). `--enc x264` é 8-bit (só para rascunho/entrega leve).
- Alpha sempre sai em **ProRes 4444** (10/12-bit, com canal alpha); H.264 não guarda transparência.
- Tudo sai com tags bt709/tv; não troque a matriz de cor no meio do caminho.

**Fundo em vídeo capturado junto** (quando zoom/parallax do fundo fazem parte da animação):
1. Gere uma cópia all-intra: `node scripts/render.mjs --make-intra fundo.mp4 fundo-intra.mp4` (todos os quadros-chave = seek rápido e exato; é só para render, pode apagar depois).
2. `--video --bg fundo-intra.mp4 --loop <duração do fundo em s>`. O script faz seek do quadro certo por quadro (`t mod loop`).
3. Fundo curto numa cena longa: se o fundo **já** faz loop, use `--loop`; se não, crie uma versão vai-e-volta (ida + reverso) para emendar sem corte.

**Velocidade:** `--dedupe` pula a captura de quadros com DOM idêntico (ótimo em lower thirds e cards que ficam parados; inútil quando há fundo em vídeo ou qualquer coisa girando/pulsando). Medido: de 5–70% dos quadros pulados conforme a peça. Sem isso, espere ~3–5 fps em 4K60 numa GPU modesta (1 min de tela ≈ 12–20 min).

Rode renders longos em segundo plano e acompanhe o log; vários arquivos em sequência num único script `.ps1`/`.sh` que escreve um log.

## 5. Verificar o arquivo (não pule)

- `ffprobe -select_streams v:0 -count_frames -show_entries stream=codec_name,profile,pix_fmt,width,height,r_frame_rate,nb_read_frames,duration -of csv=p=0 arquivo`: confira resolução, fps, nº de quadros (= `DUR × fps`) e pix_fmt (10-bit: `yuv420p10le`; alpha: `yuva444p*`).
- Extraia 3–4 quadros (`ffmpeg -ss T -i arq -frames:v 1 ...`) e olhe: início, meio, fim. Para alpha, componha sobre uma cor (`overlay`) e confira que só o elemento aparece.
- Banding: recorte um degradê escuro e exagere o contraste (`eq=contrast=3:brightness=-0.4`) comparando com o original.
- Diga ao usuário o que foi e o que **não** foi verificado (ex.: abertura no Premiere, animação em tempo real).

## 6. Armadilhas conhecidas

- **PowerShell:** não nomeie funções `R`, `T`, `E` etc. (`r` é alias de `Invoke-History`). `Get-Content -Raw` + `.Replace()` para editar arquivos; cuidado com crases em strings entre aspas duplas.
- Caminhos com acento/espaço: sempre entre aspas; `pathToFileURL` no Node.
- `browser.close()` demora muito com várias instâncias; o script mata os processos.
- O painel de preview de apps só mostra `file://` como snapshot (sem `<video>`): teste por `http://localhost`.
- ProRes não toca em navegador: para pré-visualizar, gere um H.264 à parte; não use o ProRes como `src` do `<video>`.
- Expressões de câmera/zoom em `transform-origin` no centro do `world` mantêm o assunto centralizado; se o assunto "foge" do centro durante o zoom, o origin está errado.
- Um 3D com `perspective` forte distorce texto (parece itálico); use só se o usuário pedir e com moderação. Se o usuário rejeitou uma variação, não a reaplique.
- Cantos arredondados + `overflow:hidden` + conteúdo que desliza de fora: o conteúdo "emerge" da borda do card (bom para lower thirds).

## 7. Entrega

Nomes: `<número> <timestamp> <Tema>` (ex.: `13 04-12 Vergleich`), HTML e vídeo com o mesmo prefixo, vídeos numa pasta de saída combinada (se o usuário não disse, pergunte uma vez). Não sobrescreva arquivos que o usuário já usa: use um sufixo (`_10bit`, `_v2`). Resuma cada peça: duração, o que acontece em cada tempo, o que foi inventado/assumido (textos extras, placeholders) e o que foi verificado.

