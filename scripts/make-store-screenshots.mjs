import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'screenshot');
const outDir = path.join(root, 'docs', 'store-screenshots');
fs.mkdirSync(outDir, { recursive: true });

const SIZES = [
  { dir: 'iphone-6.9', W: 1290, H: 2796 },
  { dir: 'iphone-6.5', W: 1284, H: 2778 },
  { dir: 'ipad-13', W: 2064, H: 2752 },
];

const SHOTS = [
  { file: '01-home.png', name: '01-home', caption: 'Know exactly what\'s\nleft to spend', accent: '#22C55E' },
  { file: '02-transactions.png', name: '02-transactions', caption: 'Every transaction,\nsorted and searchable', accent: '#6C4CF5' },
  { file: '03-budget.png', name: '03-budget', caption: 'Stay on budget in\nevery category', accent: '#1FAA59' },
  { file: '04-cards.png', name: '04-cards', caption: 'All your cards,\nnever miss a due date', accent: '#FF9500' },
  { file: '05-insights.png', name: '05-insights', caption: 'Stay ahead with\nsmart forecasts', accent: '#5856D6' },
];

function toDataUri(filePath) {
  const buf = fs.readFileSync(filePath);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

function template({ dataUri, caption, W, H }) {
  const s = W / 1290;
  const px = (n) => `${Math.round(n * s)}px`;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:${W}px; height:${H}px; overflow:hidden; }
  body {
    background:#0b0b0d;
    display:flex; flex-direction:column; align-items:center;
    font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
  }
  .caption {
    color:#fff;
    font-size:${px(86)};
    font-weight:800;
    line-height:1.18;
    text-align:center;
    letter-spacing:-1px;
    white-space:pre-line;
    margin-top:${px(150)};
    padding:0 ${px(70)};
  }
  .phone {
    margin-top:${px(130)};
    width:${px(1120)};
    height:${px(2320)};
    background:#000;
    border-radius:${px(130)};
    overflow:hidden;
    position:relative;
    border: ${px(14)} solid #000;
    box-shadow: 0 0 0 1px rgba(255,255,255,0.06);
  }
  .phone img {
    width:100%; height:100%; object-fit:cover; object-position: top center;
  }
  .notch {
    position:absolute;
    top:${px(26)}; left:50%; transform:translateX(-50%);
    width:${px(260)}; height:${px(52)};
    background:#000;
    border-radius:${px(36)};
    z-index:5;
  }
</style>
</head>
<body>
  <div class="caption">${caption}</div>
  <div class="phone">
    <div class="notch"></div>
    <img src="${dataUri}" />
  </div>
</body>
</html>`;
}

const run = async () => {
  const browser = await chromium.launch();
  for (const size of SIZES) {
    const sizeOutDir = path.join(outDir, size.dir);
    fs.mkdirSync(sizeOutDir, { recursive: true });
    const page = await browser.newPage({ viewport: { width: size.W, height: size.H }, deviceScaleFactor: 1 });
    for (const shot of SHOTS) {
      const srcPath = path.join(srcDir, shot.file);
      const dataUri = toDataUri(srcPath);
      const html = template({ dataUri, caption: shot.caption, W: size.W, H: size.H });
      await page.setContent(html, { waitUntil: 'networkidle' });
      const outPath = path.join(sizeOutDir, `${shot.name}.png`);
      await page.screenshot({ path: outPath });
      console.log('wrote', outPath);
    }
    await page.close();
  }
  await browser.close();
};

run();
