// 预加载脚本 - 安全地暴露 API 给渲染进程
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dshDesktop', {
  // 窗口控制
  hide: () => ipcRenderer.send('window-hide'),
  show: () => ipcRenderer.send('window-show'),
  minimize: () => ipcRenderer.send('window-minimize'),

  // 平台信息
  platform: process.platform,

  // 版本
  version: '1.0.0'
});
