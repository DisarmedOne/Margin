const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('margin', {
  boot: () => call('boot'),
  setKey: (provider, key) => call('key:set', provider, key),
  useProvider: (provider) => call('provider:use', provider),
  setSettings: (patch) => call('settings:set', patch),
  sendCode: (email) => call('account:send', email),
  verifyCode: (email, code) => call('account:verify', email, code),
  signInWithGoogle: () => call('account:google'),
  cancelGoogle: () => call('account:google-cancel'),
  onGoogleReturn: (cb) => {
    ipcRenderer.removeAllListeners('google-return');
    ipcRenderer.once('google-return', () => cb());
  },
  signOut: () => call('account:signout'),
  deleteAccount: () => call('account:delete'),
  pickFiles: () => call('papers:pick'),
  addPaper: (path) => call('papers:add', path),
  getPaper: (id) => call('papers:get', id),
  retryPaper: (id) => call('papers:retry', id),
  removePaper: (id) => call('papers:remove', id),
  getLevel: (id, index) => call('level:get', id, index),
  prefetchLevel: (id, index) => call('level:prefetch', id, index),
  completeLevel: (id, index, result) => call('level:complete', id, index, result),
  gradeTeachBack: (id, index, prompt, answer) => call('teach:grade', id, index, prompt, answer),
  dueCards: () => call('review:due'),
  rateCard: (cardId, rating) => call('review:rate', cardId, rating),
  cardPool: () => call('review:pool'),
  finishLightning: (score) => call('review:lightning', score),
  profile: () => call('profile:get'),
  openConsole: (provider) => call('open:console', provider),
  openData: () => call('open:data'),
  openPrivacy: () => call('open:privacy'),
  onUpdate: (cb) => {
    ipcRenderer.on('update-ready', (_e, update) => cb(update));
    call('update:pending').then((r) => r.ok && r.data && cb(r.data));
  },
  checkUpdate: () => call('update:check'),
  exportCards: () => call('cards:export'),
  openSupport: () => call('open:support'),
  openWebsite: () => call('open:website'),
  installUpdate: () => call('update:install'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  onPaper: (cb) => {
    const listener = (_e, paper) => cb(paper);
    ipcRenderer.on('paper', listener);
    return () => ipcRenderer.removeListener('paper', listener);
  },
});
