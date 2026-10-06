# html-motion-render

Skill para o Claude Code que cria **motion graphics em HTML** (cards, lower thirds, títulos, infográficos, fundos animados) e os **renderiza em vídeo localmente**, em 4K60, com animação suave e determinística.

A ideia central: **o vídeo é uma função do tempo**. Cada cena é um HTML com `window.render(t)`; o renderizador chama `render(0)`, `render(1/60)`, `render(2/60)`… tira um print de cada quadro com o Chrome sem janela e o ffmpeg monta o vídeo. O resultado é exato e não depende do desempenho do navegador.

## O que a skill faz

- Define o **contrato da cena** (`window.DUR`, `window.render(t)`, medidas em `cqw`) e um esqueleto com easing em bézier.
- Dá as **regras de movimento**: um easing por peça, entradas com fade + deslocamento + blur, stagger, câmera com zoom/pan, loops perfeitos, variação de aberturas.
- Confere a cena **por quadros congelados** (`preview.mjs`) antes de renderizar.
- **Renderiza localmente** (`render.mjs`), ajustado ao seu hardware (`--bench`), com captura em PNG sem perdas e saída em H.264 10 bits (evita banding), ProRes 422 HQ ou ProRes 4444 com alpha.
- Orienta a **verificar o arquivo** (`ffprobe`, quadros extraídos, checagem de banding).

## Requisitos

- **Node.js** 18+ (testado no 24)
- **ffmpeg** no PATH
- **Google Chrome** ou **Microsoft Edge** instalado (ou aponte com `--chrome` / variável `CHROME_PATH`)
- **Claude Code** (para usar como skill)

## Instalação

1. Copie esta pasta para `.claude/skills/html-motion-render/` do seu projeto (ou para `~/.claude/skills/html-motion-render/` para valer em qualquer projeto).
2. Instale a dependência dos scripts:

```bash
cd .claude/skills/html-motion-render/scripts
npm install
```

3. Peça ao Claude Code algo como *"anima esse card em HTML e renderiza em 4K60"*: a skill é ativada pela descrição.

## Uso dos scripts

```bash
# conferir a cena sem renderizar (gera PNGs + folha de contato)
node scripts/preview.mjs --html cena.html --times 0.5,2,5 --out prev [--alpha]

# renderizar (H.264 10 bits, 3840x2160, 60 fps, captura em PNG)
node scripts/render.mjs --html cena.html --out saida.mp4

# fundo transparente (ProRes 4444 com alpha)
node scripts/render.mjs --html cena.html --out saida.mov --mode alpha --dedupe

# descobrir o melhor número de instâncias do Chrome na sua máquina
node scripts/render.mjs --html cena.html --bench

# páginas feitas em px para 1920x1080: renderiza com escala 2x
node scripts/render.mjs --html cena.html --out saida.mp4 --dsf 2

# fundo em vídeo capturado junto (zoom/parallax do fundo fazem parte da animação)
node scripts/render.mjs --make-intra fundo.mp4 fundo-intra.mp4
node scripts/render.mjs --html cena.html --out saida.mp4 --video --bg fundo-intra.mp4 --loop 10
```

Veja todas as opções no cabeçalho de `scripts/render.mjs` e o guia completo em [`SKILL.md`](SKILL.md).

## Estrutura

```
html-motion-render/
├── SKILL.md              guia da skill (contrato da cena, animação, render, verificação)
├── README.md
└── scripts/
    ├── render.mjs        renderizador paralelo (Chrome headless + ffmpeg)
    ├── preview.mjs       prints em instantes escolhidos + folha de contato
    └── package.json      dependência: puppeteer-core
```

## Notas

- **Desempenho depende da máquina.** Os números citados no `SKILL.md` (3–4 instâncias, ~5 fps em 4K60) vêm de um Ryzen 5 2600 + GTX 1060 e servem de exemplo; use `--bench` no seu PC.
- **`--jpeg` é só rascunho:** a compressão apaga o grão fino e causa banding em degradês escuros.
- **`--dedupe`** só ajuda em cenas com trechos realmente parados e sem animações CSS (o DOM inline precisa mudar quando a cena muda).
- O H.264 de 10 bits abre no Premiere recente, mas não em todo player; se for um problema, use `--enc prores`.
- A skill é **genérica**: não define identidade visual. Estilo/marca de cada cliente vai no pedido ou numa skill à parte.
