// Renders build/icon.png (512x512) from HTML so the icon uses the app's own typeface.
// Run with: npm run icon
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const font = path.join(__dirname, '../node_modules/@fontsource/source-serif-4/files/source-serif-4-latin-700-normal.woff2').replace(/\\/g, '/');
const html = `<!doctype html><style>
@font-face { font-family: S; src: url('file:///${font}'); font-weight: 700; }
html,body { margin:0; width:512px; height:512px; background:transparent; }
.tile { position:absolute; inset:24px; background:#f2efe7; border:6px solid #1a1917; }
.m { position:absolute; left:44px; bottom:38px; font: 700 300px/1 S; color:#1a1917; }
.dot { position:absolute; right:44px; bottom:90px; width:44px; height:44px; background:#b5462b; }
.rule { position:absolute; left:52px; right:52px; top:58px; height:5px; background:#1a1917; }
</style><div class="tile"><div class="rule"></div><div class="m">M</div><div class="dot"></div></div>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 600));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, 'icon.png'), img.resize({ width: 512, height: 512 }).toPNG());

  // icon.ico for the installer exe: PNG-compressed entries, which Windows Vista and later read.
  const sizes = [256, 64, 48, 32, 16];
  const pngs = sizes.map((s) => img.resize({ width: s, height: s, quality: 'best' }).toPNG());
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(sizes.length, 4);
  let offset = head.length;
  sizes.forEach((s, i) => {
    const e = 6 + i * 16;
    head.writeUInt8(s === 256 ? 0 : s, e);
    head.writeUInt8(s === 256 ? 0 : s, e + 1);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(pngs[i].length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += pngs[i].length;
  });
  fs.writeFileSync(path.join(__dirname, 'icon.ico'), Buffer.concat([head, ...pngs]));
  app.quit();
});
