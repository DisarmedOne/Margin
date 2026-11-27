// Checks GitHub Releases for a newer Margin on launch, downloads it in the background,
// and tells the window once it is ready so it can ask to restart. Packaged builds only.
const { app, BrowserWindow } = require('electron');
const { autoUpdater } = require('electron-updater');
const { MarginError } = require('./ai');

let started = false;
let ready = null; // {version, current} once an update is downloaded

const mainWindow = () => BrowserWindow.getAllWindows()[0];
// Taskbar progress while downloading; -1 removes the bar.
const progress = (value) => mainWindow()?.setProgressBar(value);

function start() {
  if (!app.isPackaged || started) return;
  started = true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.disableDifferentialDownload = true; // releases carry no blockmap
  autoUpdater.logger = console;

  autoUpdater.on('download-progress', (p) => progress(p.percent / 100));

  autoUpdater.on('error', (e) => {
    progress(-1);
    console.error('[updater]', e?.message ?? e);
  });

  autoUpdater.on('update-downloaded', (info) => {
    progress(-1);
    ready = { version: info.version, current: app.getVersion() };
    mainWindow()?.webContents.send('update-ready', ready);
  });

  autoUpdater.checkForUpdates().catch((e) => console.error('[updater]', e?.message ?? e));
}

// "Check for updates" in Settings.
async function check() {
  if (!app.isPackaged) return { status: 'dev' };
  if (ready) {
    mainWindow()?.webContents.send('update-ready', ready); // shows the prompt again after Later
    return { status: 'ready', version: ready.version };
  }
  try {
    const r = await autoUpdater.checkForUpdates();
    if (!r?.isUpdateAvailable) return { status: 'current' };
    r.downloadPromise?.catch(() => {}); // already reported by the error event
    return { status: 'downloading', version: r.updateInfo.version };
  } catch {
    throw new MarginError('UPDATE', 'Could not check for updates. Try again later.');
  }
}

// The window asks for this when it loads, in case the download finished before it was listening.
const pending = () => ready;
const install = () => {
  if (ready) autoUpdater.quitAndInstall();
};

module.exports = { start, check, pending, install };
