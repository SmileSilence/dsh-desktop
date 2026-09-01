// 预加载脚本 - 安全地暴露 API 给渲染进程（D1）
// contextIsolation:true + sandbox:true 下运行；渲染进程通过 window.dshDesktop 访问。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dshDesktop', {
  // 窗口控制
  hide: () => ipcRenderer.send('window-hide'),
  show: () => ipcRenderer.send('window-show'),
  minimize: () => ipcRenderer.send('window-minimize'),
  maximizeToggle: () => ipcRenderer.send('window-maximize-toggle'),
  closeWindow: () => ipcRenderer.send('window-close'),
  onMaximizedChanged: (cb) => ipcRenderer.on('window-maximized-changed', (_event, value) => cb(!!value)),
  reportTheme: (report) => ipcRenderer.send('theme-report', report),
  newTab: () => ipcRenderer.send('tab-new'),
  activateTab: (id) => ipcRenderer.send('tab-activate', id),
  closeTab: (id) => ipcRenderer.send('tab-close', id),
  renameTab: (id, title) => ipcRenderer.send('tab-rename', id, title),
  requestTabsState: () => ipcRenderer.send('tabs-state-request'),
  onTabsState: (cb) => ipcRenderer.on('tabs-state', (_event, state) => cb(state)),
  onAppReady: (cb) => ipcRenderer.on('app-ready', () => cb()),
  onAppLoadError: (cb) => ipcRenderer.on('app-load-error', (_event, detail) => cb(detail)),

  // 平台信息
  platform: process.platform,

  // API Key 引导窗
  saveApiKey: (key) => ipcRenderer.send('save-api-key', key),
  skipApiKey: () => ipcRenderer.send('skip-api-key'),
  onApiKeySaved: (cb) => { ipcRenderer.on('api-key-saved', () => cb()); },
  onApiKeyError: (cb) => { ipcRenderer.on('api-key-error', (e, msg) => cb(msg)); },

  // 设置窗（fallback）
  saveSettings: (cfg) => ipcRenderer.send('save-settings', cfg),
  refreshDshStatus: () => ipcRenderer.send('refresh-dsh-status'),
  onDshStatusUpdated: (cb) => { ipcRenderer.on('dsh-status-updated', (e, status) => cb(status)); },
  getInternalPageData: () => ipcRenderer.invoke('internal-page-data'),
  checkDshUpdate: () => ipcRenderer.invoke('internal-dsh-check-update'),
  updateDsh: (confirm) => ipcRenderer.invoke('internal-dsh-update', confirm === true),
  confirm: (message) => ipcRenderer.invoke('internal-confirm', message),
  hotkeyCaptureStart: () => ipcRenderer.send('hotkey-capture-start'),
  hotkeyCaptureEnd: () => ipcRenderer.send('hotkey-capture-end')
});
