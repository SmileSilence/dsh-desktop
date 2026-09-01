'use strict';

const path = require('path');
const { Tray, Menu, nativeImage } = require('electron');

/**
 * 系统托盘（P1.5 / B4 增强）。
 * 菜单：显示/隐藏、新建对话、重启后端、设置、关于、退出。
 */

/**
 * @param {{
 *   getIcon:()=>string,
 *   getLang:()=>object,
 *   onShowWindow:Function,
 *   onNewChat:Function,
 *   onRestartBackend:Function,
 *   onSettings:Function,
 *   onAbout:Function,
 *   onQuit:Function,
 *   logger?:{log?:Function}
 * }} deps
 * @returns {{ setMenu:Function, update:Function, destroy:Function, getTray:()=>Tray|null }}
 */
function createTray(deps) {
  const {
    getIcon, getLang, onShowWindow, onNewChat, onRestartBackend,
    onSettings, onAbout, onQuit, getTabs, onActivateTab, logger = {}
  } = deps;

  let tray = null;

  function buildMenu(lang) {
    return Menu.buildFromTemplate([
      { label: lang.trayShow, click: () => onShowWindow() },
      { type: 'separator' },
      { label: lang.menuNewChat, click: () => onNewChat?.() },
      ...((getTabs?.().tabs || []).length ? [{
        label: '页签',
        submenu: getTabs().tabs.map((tab) => ({ label: tab.title, type: 'checkbox', checked: tab.id === getTabs().activeId, click: () => onActivateTab?.(tab.id) }))
      }] : []),
      { type: 'separator' },
      { label: lang.trayRestartBackend || '重启后端', click: () => onRestartBackend?.() },
      { type: 'separator' },
      { label: lang.traySettings, click: () => onSettings() },
      { type: 'separator' },
      { label: lang.trayAbout, click: () => onAbout() },
      { type: 'separator' },
      {
        label: lang.trayQuit,
        click: () => onQuit()
      }
    ]);
  }

  function create() {
    const iconPath = getIcon();
    let icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) icon = icon.resize({ width: 16, height: 16 });
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
    tray.on('click', () => onShowWindow());
    update();
    return tray;
  }

  /** 语言/状态变更后刷新菜单 */
  function update() {
    if (!tray) return;
    const lang = getLang();
    tray.setToolTip(lang.trayTooltip);
    tray.setContextMenu(buildMenu(lang));
  }

  return {
    create,
    update,
    destroy: () => { if (tray) { tray.destroy(); tray = null; } },
    getTray: () => tray
  };
}

module.exports = { createTray };
