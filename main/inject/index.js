'use strict';

const fs = require('fs');
const path = require('path');

/**
 * 页面注入基础（F1 / P1.1）。
 * insertCSS/executeJavaScript 封装 + 同源白名单（D2：仅对 DSH 同源页面注入）。
 * 注入时机：did-finish-load / did-navigate 后。
 */

const CSS_DIR = __dirname;

const THEME_COLORS = {
  dark: { bg: '#1a1a2e', fg: '#ffffff' },
  light: { bg: '#f5f5f5', fg: '#333333' }
};

/** 同源白名单判断：仅当页面 origin 与 DSH URL origin 一致才注入（D2） */
function isSameOrigin(pageUrl, dshUrl) {
  try {
    const a = new URL(pageUrl);
    const b = new URL(dshUrl);
    return a.origin === b.origin;
  } catch (e) {
    return false;
  }
}

/** 生成侧栏品牌标题注入脚本；MutationObserver 负责处理 React 后续重绘。 */
function brandTitleScriptFor(value) {
  const title = typeof value === 'string' ? value.trim().slice(0, 40) : '';
  const serializedTitle = JSON.stringify(title).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  return `(() => {
    const observerKey = '__DSH_DESKTOP_BRAND_OBSERVER__';
    window[observerKey]?.disconnect?.();
    const title = ${serializedTitle};
    const defaults = new Set(['DSH 本地构建', 'DSH Local Build']);
    const apply = () => {
      for (const node of document.querySelectorAll('span')) {
        const original = node.dataset.dshDesktopBrandOriginal;
        if (original !== undefined) {
          if (node.textContent !== (title || original)) node.textContent = title || original;
          if (!title) delete node.dataset.dshDesktopBrandOriginal;
        } else if (title && defaults.has(node.textContent.trim())) {
          node.dataset.dshDesktopBrandOriginal = node.textContent;
          node.textContent = title;
        }
      }
    };
    apply();
    if (title) {
      const observer = new MutationObserver(apply);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      window[observerKey] = observer;
    } else {
      delete window[observerKey];
    }
  })()`;
}

/**
 * @param {{
 *   getDshUrl:()=>string,
 *   getThemeMode:()=>'dark'|'light',
 *   getBridgeInfo?:()=>{bridgeBaseUrl:string, token:string}|null,
 *   getBrandTitle?:()=>string,
 *   logger?:{log?:Function}
 * }} deps
 */
function createInjector(deps) {
  const { getDshUrl, getThemeMode, getBridgeInfo, getBrandTitle, logger = {} } = deps;
  const cssCache = {};

  function readCss(name) {
    if (!cssCache[name]) {
      cssCache[name] = fs.readFileSync(path.join(CSS_DIR, name), 'utf-8');
    }
    return cssCache[name];
  }

  /** 主题变量 CSS（X6：只作用于窗口 chrome，不覆盖 DSH 自身主题） */
  function themeCssFor() {
    const c = THEME_COLORS[getThemeMode()] || THEME_COLORS.dark;
    return readCss('theme.css')
      .replaceAll('__BG__', c.bg)
      .replaceAll('__FG__', c.fg);
  }

  /** 注入桥 token 到 window.__DSH_DESKTOP__（P2.3，供插件读取；不注入页面全局敏感 API） */
  function bridgeInjectionScript() {
    const info = getBridgeInfo ? getBridgeInfo() : null;
    if (!info) return null;
    return `(() => {
      window.__DSH_DESKTOP__ = { bridgeBaseUrl: ${JSON.stringify(info.bridgeBaseUrl)}, token: ${JSON.stringify(info.token)} };
    })()`;
  }

  /** 对指定窗口执行全部注入（仅同源页面） */
  function applyInjections(win) {
    const url = win.webContents.getURL();
    const dshUrl = getDshUrl();
    if (!isSameOrigin(url, dshUrl)) return;

    const themeCss = themeCssFor();
    if (themeCss) {
      win.webContents.insertCSS(themeCss).catch(() => {});
    }
    const bridgeScript = bridgeInjectionScript();
    if (bridgeScript) {
      win.webContents.executeJavaScript(bridgeScript).catch(() => {});
    }
    win.webContents.executeJavaScript(brandTitleScriptFor(getBrandTitle?.() || '')).catch(() => {});
  }

  /** 挂接到窗口生命周期（did-finish-load / did-navigate） */
  function attach(win) {
    const wc = win.webContents;
    wc.on('did-finish-load', () => applyInjections(win));
    wc.on('did-navigate', () => applyInjections(win));
    if (!wc.isLoading()) applyInjections(win);
  }

  function attachContent(win) {
    const wc = win.webContents;
    wc.on('did-finish-load', () => applyInjections(win));
    wc.on('did-navigate', () => applyInjections(win));
    if (!wc.isLoading()) applyInjections(win);
  }

  return { attach, attachContent, applyInjections, isSameOrigin };
}

module.exports = { createInjector, isSameOrigin, brandTitleScriptFor, THEME_COLORS };
