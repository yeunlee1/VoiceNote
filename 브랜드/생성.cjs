// VoiceNote.svg(원본)와 작은크기 SVG를 헤드리스 Chrome 캔버스로 래스터화해 투명 PNG·ICO·미리보기를 만든다.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const HERE = __dirname;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const main = fs.readFileSync(path.join(HERE, 'VoiceNote.svg'), 'utf8');
const small = fs.readFileSync(path.join(HERE, 'VoiceNote-작은크기.svg'), 'utf8');
// 32px 이하는 막대 셋 단순형, 그보다 크면 원본을 그 크기로 직접 래스터화한다.
const variant = size => (size <= 32 ? small : main);
const PNG_SIZES = [512, 256, 48, 32, 16];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

async function withChrome(work) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'voicenote-icon-'));
  const port = 9300 + Math.floor(Math.random() * 500);
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
  try {
    let pages;
    for (let i = 0; i < 50 && !pages; i++) {
      try { pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { await new Promise(r => setTimeout(r, 200)); }
    }
    const ws = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let id = 0;
    const waiting = new Map();
    ws.onmessage = event => { const msg = JSON.parse(event.data); if (waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); } };
    const evaluate = expression => new Promise((resolve, reject) => {
      const n = ++id;
      waiting.set(n, msg => (msg.result?.exceptionDetails || msg.error ? reject(new Error(JSON.stringify(msg.result?.exceptionDetails || msg.error))) : resolve(msg.result.result.value)));
      ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    });
    const result = await work(evaluate);
    ws.close();
    return result;
  } finally {
    chrome.kill();
    await new Promise(r => setTimeout(r, 500));
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

// 브라우저 안에서 실행할 함수들
const pageCode = `
  const load = svg => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg))); });
  async function render(svg, size) {
    const img = await load(svg.replace(/width="64" height="64"/, 'width="' + size + '" height="' + size + '"'));
    const c = document.createElement('canvas'); c.width = c.height = size;
    c.getContext('2d').drawImage(img, 0, 0, size, size);
    return c;
  }
  async function preview(variants) {
    const backgrounds = [['흰 배경', '#FFFFFF', '#333'], ['어두운 배경', '#1F2327', '#DDD'], ['체커보드(투명)', null, '#333']];
    const panelW = 420, panelH = 470, c = document.createElement('canvas'); c.width = panelW * 3; c.height = panelH;
    const g = c.getContext('2d');
    for (let i = 0; i < 3; i++) {
      const [label, fill, ink] = backgrounds[i], x0 = i * panelW;
      if (fill) { g.fillStyle = fill; g.fillRect(x0, 0, panelW, panelH); }
      else for (let y = 0; y < panelH; y += 12) for (let x = 0; x < panelW; x += 12) { g.fillStyle = ((x + y) / 12) % 2 ? '#CCCCCC' : '#FFFFFF'; g.fillRect(x0 + x, y, 12, 12); }
      g.fillStyle = ink; g.font = '16px "Malgun Gothic", sans-serif'; g.fillText(label, x0 + 16, 26);
      g.drawImage(await render(variants[256], 256), x0 + 82, 40);
      let x = x0 + 24; const y = 330;
      for (const size of [48, 32, 16]) { g.drawImage(await render(variants[size], size), x, y + 48 - size); g.fillText(size + 'px', x, y + 72); x += size + 36; }
      g.imageSmoothingEnabled = false;
      for (const size of [32, 16]) { const scale = size === 16 ? 4 : 2; g.drawImage(await render(variants[size], size), x, y - 16, size * scale, size * scale); g.fillText(size + '×' + scale, x, y + 72); x += size * scale + 24; }
      g.imageSmoothingEnabled = true;
    }
    return c.toDataURL('image/png');
  }
`;

// 128px 이하는 Windows·.NET 호환을 위해 32비트 BMP(DIB), 256px만 PNG로 담는다.
function dib(size, rgbaBase64) {
  const rgba = Buffer.from(rgbaBase64, 'base64');
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); header.writeInt32LE(size, 4); header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12); header.writeUInt16LE(32, 14); header.writeUInt32LE(size * size * 4, 20);
  const pixels = Buffer.alloc(size * size * 4);
  const maskRow = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskRow * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const from = (y * size + x) * 4, to = ((size - 1 - y) * size + x) * 4;
    pixels[to] = rgba[from + 2]; pixels[to + 1] = rgba[from + 1]; pixels[to + 2] = rgba[from]; pixels[to + 3] = rgba[from + 3];
    if (rgba[from + 3] === 0) mask[(size - 1 - y) * maskRow + (x >> 3)] |= 0x80 >> (x & 7);
  }
  return Buffer.concat([header, pixels, mask]);
}

function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, bytes }, i) => {
    const at = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, at); header.writeUInt8(size >= 256 ? 0 : size, at + 1);
    header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(bytes.length, at + 8); header.writeUInt32LE(offset, at + 12);
    offset += bytes.length;
  });
  return Buffer.concat([header, ...pngs.map(p => p.bytes)]);
}

(async () => {
  const sizes = [...new Set([...PNG_SIZES, ...ICO_SIZES])];
  const variants = Object.fromEntries([...sizes, 256].map(s => [s, variant(s)]));
  const out = await withChrome(async evaluate => {
    await evaluate(pageCode + '; window.render = render; window.preview = preview; true');
    const files = {};
    for (const size of sizes) files[size] = await evaluate(`render(${JSON.stringify(variants[size])}, ${size}).then(c => c.toDataURL('image/png'))`);
    for (const size of ICO_SIZES.filter(s => s < 256))
      files['rgba' + size] = await evaluate(`render(${JSON.stringify(variants[size])}, ${size}).then(c => { const d = c.getContext('2d').getImageData(0, 0, ${size}, ${size}).data; let t = ''; for (let i = 0; i < d.length; i += 8192) t += String.fromCharCode.apply(null, d.subarray(i, i + 8192)); return btoa(t); })`);
    files.preview = await evaluate(`preview(${JSON.stringify(variants)})`);
    return files;
  });
  const bytes = url => Buffer.from(url.split(',')[1], 'base64');
  fs.mkdirSync(path.join(HERE, 'png'), { recursive: true });
  fs.mkdirSync(path.join(HERE, '미리보기'), { recursive: true });
  for (const size of PNG_SIZES) fs.writeFileSync(path.join(HERE, 'png', `VoiceNote-${size}.png`), bytes(out[size]));
  fs.writeFileSync(path.join(HERE, 'VoiceNote.ico'), ico(ICO_SIZES.map(size => ({ size, bytes: size < 256 ? dib(size, out['rgba' + size]) : bytes(out[size]) }))));
  fs.writeFileSync(path.join(HERE, '미리보기', 'VoiceNote-배경별-미리보기.png'), bytes(out.preview));
  console.log('완료', PNG_SIZES.join('/'), 'ICO', ICO_SIZES.join('/'));
})().catch(error => { console.error(error); process.exit(1); });
