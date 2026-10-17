// Renders assets/icon.svg into every PNG/ICO the app and installer use.
// Run with Electron (Chromium rasterizes the SVG):  npx electron scripts/render_icons.js
// Output (assets/):
//   icon.png (256) and icon.ico (16, 24, 32, 48, 64, 128, 256) - app, taskbar, installer
//   icon-<state>.png (16) + @1.5x (24) + @2x (32)              - tray, picked by DPI
//   icons/<variant>-<size>.png for 16, 24, 32, 48, 256           - every variant, every size
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'assets');
const MASTER_FILL = '#2F7DF6';
const VARIANTS = { app:MASTER_FILL, green:'#1FA45B', red:'#E0443A', gray:'#8A939C', amber:'#F0A01E' };
const SIZES = [16, 24, 32, 48, 256];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

function buildIco(pngs){ // PNG-compressed ICO entries (Windows Vista and later)
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o); dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2); dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(data.length, o + 8); dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(ASSETS, 'icon.svg'), 'utf8');
  if(!svg.includes(MASTER_FILL)) throw new Error('master fill colour not found in icon.svg');
  const win = new BrowserWindow({ show:false, webPreferences:{ offscreen:true } });
  await win.loadURL('data:text/html,<canvas></canvas>');
  const render = (markup, size) => win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = ${size};
      const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, ${size}, ${size});
      resolve(c.toDataURL('image/png').split(',')[1]);
    };
    img.onerror = reject;
    img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(markup).toString('base64'))};
  })`).then((b64) => Buffer.from(b64, 'base64'));

  fs.mkdirSync(path.join(ASSETS, 'icons'), { recursive:true });
  for(const [name, fill] of Object.entries(VARIANTS)){
    const markup = svg.split(MASTER_FILL).join(fill);
    for(const size of SIZES) fs.writeFileSync(path.join(ASSETS, 'icons', `${name}-${size}.png`), await render(markup, size));
    if(name === 'app'){
      fs.writeFileSync(path.join(ASSETS, 'icon.png'), await render(markup, 256));
      const pngs = [];
      for(const size of ICO_SIZES) pngs.push({ size, data:await render(markup, size) });
      fs.writeFileSync(path.join(ASSETS, 'icon.ico'), buildIco(pngs));
    }else{
      fs.writeFileSync(path.join(ASSETS, `icon-${name}.png`), await render(markup, 16));
      fs.writeFileSync(path.join(ASSETS, `icon-${name}@1.5x.png`), await render(markup, 24));
      fs.writeFileSync(path.join(ASSETS, `icon-${name}@2x.png`), await render(markup, 32));
    }
  }
  console.log('icons written');
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
