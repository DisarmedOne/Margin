// Checks GitHub Releases for a newer Margin on launch, downloads it in the background,
// and asks the user to restart once it is ready. Packaged builds only.
const { app, BrowserWindow, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');

let started = false;

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

  autoUpdater.on('update-downloaded', async (info) => {
    progress(-1);
    const options = {
      type: 'info',
      title: 'Update ready',
      message: `Margin ${info.version} is ready`,
      detail: `You have ${app.getVersion()}. Restart now to update, or choose Later and it installs when you close Margin. Your papers and progress stay as they are.`,
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    };
    const win = mainWindow();
    const { response } = await (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options));
    if (response === 0) autoUpdater.quitAndInstall();
  });

  autoUpdater.checkForUpdates().catch((e) => console.error('[updater]', e?.message ?? e));
}

module.exports = { start };
