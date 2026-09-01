'use strict';

/**
 * 窗口管理（P1.2 / A2 / B2）。
 * - windowConfigFor(platform) 纯函数：Windows 原生标题栏，其他平台保持原行为；
 * - createMainWindow(deps)：窗口状态记忆（move/resize/maximize → config.window，启动恢复）。
 */

const { BrowserWindow, screen } = require('electron');
const os = require('os');

function isWin11(platform = process.platform, release = os.release()) {
  if (platform !== 'win32') return false;
  const build = Number(String(release).split('.')[2] || 0);
  return build >= 22000;
}

/**
 * 分平台窗口配置（§15.3）。
 * win32: 原生标题栏（默认边框）；darwin: hiddenInset + trafficLightPosition；其余回退默认标题栏。
 * @param {'win32'|'darwin'|string} platform
 * @returns {object} 可展开进 BrowserWindow 构造参数的字段
 */
function windowConfigFor(platform) {
  if (platform === 'win32') {
    return {}; // 原生标题栏（默认边框；不再无框自绘）
  }
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 15, y: 15 }
    };
  }
  return {}; // 其余平台回退默认标题栏（WCO 不可用）
}

/**
 * 主题 chrome 色（P1.6）。
 * @param {'dark'|'light'} mode
 * @returns {{bg:string, fg:string}}
 */
function chromeColorsFor(mode) {
  return mode === 'dark'
    ? { bg: '#151517', fg: '#f9fafb' }
    : { bg: '#ffffff', fg: '#0f1115' };
}

/**
 * 窗口状态记忆（B2）。
 * 监听 move/resize（debounce 300ms）与 maximize/unmaximize，写回 config.window（副作用由回调注入）。
 * @param {BrowserWindow} win
 * @param {{ save:(patch:object)=>void, logger?:{log?:Function} }} deps
 */
function watchWindowState(win, deps) {
  const { save, logger = {} } = deps;
  let timer = null;

  const persist = () => {
    if (!win || win.isDestroyed()) return;
    const bounds = win.getNormalBounds();
    save({
      window: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        maximized: win.isMaximized()
      }
    });
  };

  const debouncedPersist = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(persist, 300);
  };

  win.on('move', debouncedPersist);
  win.on('resize', debouncedPersist);
  win.on('maximize', persist);
  win.on('unmaximize', persist);
  win.on('closed', () => {
    if (timer) clearTimeout(timer);
  });

  return { persist };
}

/**
 * 启动时恢复窗口状态：跨显示器越界时回退默认（B2）。
 * @param {{x:number|null,y:number|null,width:number,height:number,maximized:boolean}} w config.window
 * @param {{width:number,height:number}} defaultSize
 * @param {()=>Array<{workArea:{x:number,y:number,width:number,height:number}}>} [getDisplays]
 *   显示器提供者（默认 electron screen.getAllDisplays；测试可注入）
 * @returns {{x:number,y:number,width:number,height:number,maximized:boolean}}
 */
function restoreWindowBounds(w, defaultSize, getDisplays) {
  const { width, height } = defaultSize;
  const out = { x: undefined, y: undefined, width, height, maximized: false };
  if (!w) return out;

  out.width = typeof w.width === 'number' ? w.width : width;
  out.height = typeof w.height === 'number' ? w.height : height;
  out.maximized = !!w.maximized;

  if (typeof w.x === 'number' && typeof w.y === 'number') {
    // 检查窗口是否仍在任一显示器可视区域内
    const displays = getDisplays ? getDisplays() : screen.getAllDisplays();
    const visible = displays.some((d) => {
      const a = d.workArea;
      return w.x < a.x + a.width - 40 && w.y < a.y + a.height - 40 &&
             w.x + out.width > a.x + 40 && w.y + out.height > a.y + 40;
    });
    if (visible) {
      out.x = w.x;
      out.y = w.y;
    }
  }
  return out;
}

/**
 * 创建主窗口工厂。
 * @param {{
 *   getDshUrl:()=>string,
 *   getConfig:()=>object,
 *   saveConfig:(patch:object)=>void,
 *   getThemeMode:()=>'dark'|'light',
 *   title?:string,
 *   icon?:string,
 *   onDidFailLoad?:Function,
 *   onClose?:Function,
 *   onReady?:Function,
 *   logger?:{log?:Function}
 * }} deps
 * @returns {BrowserWindow}
 */
function createMainWindow(deps) {
  const { getDshUrl, getConfig, saveConfig, getThemeMode, title, icon, preload, onDidFailLoad, onClose, onReady, logger = {} } = deps;

  const cfg = getConfig();
  const w = cfg.window || {};
  const bounds = restoreWindowBounds(w, { width: 1200, height: 800 });
  const chrome = chromeColorsFor(getThemeMode());

  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 800,
    minHeight: 600,
    title: title || 'DeepSeek Harness',
    icon,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload
    },
    ...windowConfigFor(process.platform),
    backgroundColor: chrome.bg, // chromeColorsFor(getThemeMode())：dark #151517 / light #ffffff
    alwaysOnTop: cfg.tray && cfg.tray.topMost,
    ...(isWin11() ? { backgroundMaterial: 'mica' } : {})
  });

  if (bounds.maximized) win.maximize();

  // 关闭语义（closeToTray / 退出确认）由调用方注入
  if (onClose) {
    win.on('close', (event) => onClose(event, win));
  }

  win.on('closed', () => onReady?.(null));

  // 窗口状态记忆
  watchWindowState(win, {
    save: (patch) => {
      try { saveConfig(patch); } catch (e) { logger.log?.(`窗口状态保存失败: ${e.message}`); }
    },
    logger
  });

  return win;
}

/**
 * 主题变更 → 更新无框窗口背景；页面内标题栏直接使用 DSH 主题变量。
 * @param {BrowserWindow|null} win
 * @param {'dark'|'light'} mode
 */
function applyThemeToChrome(win, mode) {
  if (!win || win.isDestroyed() || process.platform !== 'win32') return;
  const chrome = chromeColorsFor(mode);
  win.setBackgroundColor(chrome.bg);
}

module.exports = {
  windowConfigFor,
  chromeColorsFor,
  restoreWindowBounds,
  watchWindowState,
  createMainWindow,
  applyThemeToChrome,
  isWin11
};
