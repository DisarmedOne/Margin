// Checks GitHub Releases for a newer Margin on launch, downloads it in the background,
// and asks the user to restart once it is ready. Packaged builds only.
const { app, BrowserWindow, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');

let started = false;

function start() {
  if (!app.isPackaged || started) return;
  started = true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = console;

  autoUpdater.on('error', (e) => console.error('[updater]', e?.message ?? e));

  autoUpdater.on('update-downloaded', async (info) => {
    const win = BrowserWindow.getFocusedWindow() ?? undefined;
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      title: 'Update ready',
      message: `Margin ${info.version} is ready to install.`,
      detail: 'Restart Margin to finish updating. Your papers and progress stay as they are.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });

  autoUpdater.checkForUpdates().catch((e) => console.error('[updater]', e?.message ?? e));
}

module.exports = { start };
