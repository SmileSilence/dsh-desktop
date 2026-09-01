'use strict';

const path = require('path');

const TITLEBAR_HEIGHT = 0; // 原生标题栏位于 Web 内容区之外，壳内不再预留
const TABBAR_SIZE = 44;
const SIDE_TABBAR_SIZE = 184;

function contentBounds(size, position, showTabbar = true) {
  if (!showTabbar) return { x: 0, y: TITLEBAR_HEIGHT, width: size.width, height: Math.max(0, size.height - TITLEBAR_HEIGHT) };
  if (position === 'left') return { x: SIDE_TABBAR_SIZE, y: TITLEBAR_HEIGHT, width: Math.max(0, size.width - SIDE_TABBAR_SIZE), height: Math.max(0, size.height - TITLEBAR_HEIGHT) };
  if (position === 'right') return { x: 0, y: TITLEBAR_HEIGHT, width: Math.max(0, size.width - SIDE_TABBAR_SIZE), height: Math.max(0, size.height - TITLEBAR_HEIGHT) };
  return { x: 0, y: TITLEBAR_HEIGHT + TABBAR_SIZE, width: size.width, height: Math.max(0, size.height - TITLEBAR_HEIGHT - TABBAR_SIZE) };
}

function normalizeTabTitle(value) {
  if (typeof value !== 'string') return null;
  const title = value.trim().replace(/\s+/g, ' ').slice(0, 40);
  return title || null;
}

function createTabManager(deps) {
  const { window, WebContentsView, getUrl, getPosition, injector, preload, onChange, logger = {} } = deps;
  const tabs = [];
  let activeId = null;
  let sequence = 0;

  function state() {
    return {
      activeId,
      position: getPosition(),
      canRename: tabs.length > 1,
      showTabbar: tabs.length > 1,
      tabs: tabs.map(({ id, title }) => ({ id, title }))
    };
  }

  function publish() {
    if (!window.isDestroyed()) window.webContents.send('tabs-state', state());
    onChange?.(state());
  }

  function layout() {
    const active = tabs.find((tab) => tab.id === activeId);
    if (!active || window.isDestroyed()) return;
    const cb = window.getContentBounds();
    const wb = typeof window.getBounds === 'function' ? window.getBounds() : null;
    // 诊断：原生标题栏帧尚未应用时，getContentBounds() 会返回外框尺寸（content.width === window.width），
    // 此时视图会被设得过大、底部被裁——正是"打开时底部未适配，拖动后恢复"的成因。
    if (wb && cb.width === wb.width) logger.log?.(`⚠ layout-pre-frame: win=${JSON.stringify(wb)} content=${JSON.stringify(cb)}`);
    active.view.setBounds(contentBounds(cb, getPosition(), tabs.length > 1));
  }

  function activate(id) {
    const next = tabs.find((tab) => tab.id === id);
    if (!next || id === activeId) return;
    const current = tabs.find((tab) => tab.id === activeId);
    if (current) window.contentView.removeChildView(current.view);
    activeId = id;
    window.contentView.addChildView(next.view);
    layout();
    publish();
  }

  function add(options = {}) {
    const id = `tab-${++sequence}`;
    const view = new WebContentsView({
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload }
    });
    const tab = {
      id,
      key: options.key || null,
      title: options.title || `对话 ${sequence}`,
      customTitle: !!options.title,
      view
    };
    tabs.push(tab);
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    view.webContents.on('page-title-updated', (_event, title) => {
      if (tab.customTitle) return;
      tab.title = String(title || `对话 ${sequence}`).slice(0, 40);
      publish();
    });
    view.webContents.on('did-fail-load', (_event, code, description) => logger.log?.(`页签加载失败 (${code}): ${description}`));
    if (!options.internal) injector.attachContent({ webContents: view.webContents });
    view.webContents.loadURL(options.url || getUrl());
    activate(id);
    return id;
  }

  function openInternal(key, title, url, activateTab = true) {
    const existing = tabs.find((tab) => tab.key === key);
    if (existing) {
      existing.title = title;
      existing.view.webContents.loadURL(url);
      if (activateTab) activate(existing.id);
      publish();
      return existing.id;
    }
    return add({ key, title, url, internal: true });
  }

  function close(id) {
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    const [removed] = tabs.splice(index, 1);
    if (activeId === id) {
      window.contentView.removeChildView(removed.view);
      activeId = null;
    }
    removed.view.webContents.close();
    if (tabs.length === 0) add();
    else if (!activeId) activate(tabs[Math.min(index, tabs.length - 1)].id);
    layout(); // 关闭页签后即时重排内容区（页签栏显隐随 tabs.length 变化，关闭非活动页签也需刷新）
    publish();
  }

  function reloadActive() {
    tabs.find((tab) => tab.id === activeId)?.view.webContents.reload();
  }

  function rename(id, value) {
    if (tabs.length <= 1) return false;
    const tab = tabs.find((item) => item.id === id);
    const title = normalizeTabTitle(value);
    if (!tab || !title) return false;
    tab.title = title;
    tab.customTitle = true;
    publish();
    return true;
  }

  function openDevTools() {
    tabs.find((tab) => tab.id === activeId)?.view.webContents.toggleDevTools();
  }

  function destroy() {
    for (const tab of tabs.splice(0)) {
      try { window.contentView.removeChildView(tab.view); } catch {}
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    }
    activeId = null;
  }

  // 窗口出现/原生标题栏帧就绪时重排内容区：避免打开瞬间 getContentBounds() 尚未扣除标题栏
  // 导致视图过大、底部被裁（表现为"拖动窗口大小后恢复正常"）
  window.on('resize', layout);
  window.on('show', layout);
  window.on('ready-to-show', layout);
  return { add, openInternal, has: (key) => tabs.some((tab) => tab.key === key), activate, close, rename, layout, state, publish, reloadActive, openDevTools, destroy };
}

module.exports = { TITLEBAR_HEIGHT, TABBAR_SIZE, SIDE_TABBAR_SIZE, contentBounds, normalizeTabTitle, createTabManager };
