'use strict';

/**
 * DSH Desktop 主进程入口（P1 版）。
 * 由 main.js 拆分而来：配置/日志/DSH 服务/窗口/托盘/注入已模块化，
 * 菜单/快捷键/IPC/内嵌窗口暂留本文件，P2–P3 继续拆分。
 *
 * P0 验收：npm start 行为不变；日志落盘；内嵌窗无 nodeIntegration；node --test 可跑。
 */
const { app, BrowserWindow, WebContentsView, Menu, globalShortcut, dialog, ipcMain, nativeTheme, Notification, shell, session, net } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');
const os = require('os');

const { createConfigStore } = require('./config');
const { createLogger } = require('./logging');
const { createDshServer } = require('./dsh-server');
const { createSessionProbe } = require('./dsh-runtime');
const { escapeHtml } = require('./lib/escape-html');
const { compareSemver } = require('./lib/semver');
const { createMainWindow: createMainWindowFactory, applyThemeToChrome, chromeColorsFor } = require('./window');
const { createTray: createTrayModule } = require('./tray');
const { createInjector } = require('./inject');
const { createBridgeServer } = require('./bridge/server');
const { createRoutes, maskSettings } = require('./bridge/routes');
const { createNotifier } = require('./notifications');
const { checkForUpdate } = require('./updater');
const { buildDiagnostics } = require('./diagnostics');
const { createDshUpdate } = require('./dsh-update');
const { createTabManager } = require('./tab-manager');

const PROJECT_ROOT = path.join(__dirname, '..');
const HOTKEY = 'CommandOrControl+Shift+D';
let runtimeBackendPort = 3080;

function getRuntimeConfig() {
  const config = configStore.get();
  if (!config) return { dsh: {} };
  return {
    ...config,
    dsh: {
      ...config.dsh,
      port: runtimeBackendPort,
      profile: 'web',
      dedicated: false
    }
  };
}

// ============ 依赖装配（副作用全部集中在入口） ============
const userDataPath = app.getPath('userData');
// 打包后的 Windows GUI 没有稳定控制台，强制只写文件，避免 stdout EPIPE。
const logger = createLogger({ userDataPath, consoleEnabled: !app.isPackaged });
const configStore = createConfigStore({ userDataPath, fs, logger });
const dshServer = createDshServer({
  projectRoot: PROJECT_ROOT,
  getDshConfig: getRuntimeConfig,
  probeUrl: createSessionProbe(() => session.defaultSession, options => net.request(options)),
  logger
});
// P3 模块实例（B7 通知 / G1 本地 DSH 更新）
const notifier = createNotifier({ Notification, logger });
const dshUpdate = createDshUpdate({
  getLaunch: () => dshServer.resolveLaunch(getRuntimeConfig().dsh || {}, dshServer.detectFacts()),
  getDshConfig: () => configStore.get(),
  logger
});

// ============ 中文语言包 ============
const LANG = {
  appName: 'DeepSeek Harness',
  appTitle: 'DeepSeek Harness',
  trayTooltip: 'DeepSeek Harness - AI 助手',

  // 菜单栏
  menuFile: '文件',
  menuEdit: '编辑',
  menuView: '查看',
  menuWindow: '窗口',
  menuHelp: '帮助',
  menuNewChat: '新建对话',
  menuOpenSettings: '打开设置',
  menuQuit: '退出',
  menuUndo: '撤销',
  menuRedo: '重做',
  menuCut: '剪切',
  menuCopy: '复制',
  menuPaste: '粘贴',
  menuSelectAll: '全选',
  menuReload: '重新加载',
  menuDevTools: '开发者工具',
  menuZoomIn: '放大',
  menuZoomOut: '缩小',
  menuResetZoom: '重置缩放',
  menuFullscreen: '全屏',
  menuAbout: '关于',
  menuLanguage: '语言',

  // 托盘菜单
  trayShow: '显示主窗口',
  traySettings: '设置',
  trayAbout: '关于',
  trayQuit: '退出',

  // 设置
  settingsTitle: '设置',
  settingsGeneral: '常规设置',
  settingsHotkey: '快捷键设置',
  settingsAppearance: '外观设置',
  settingsLanguage: '语言设置',
  settingAutoLaunch: '开机自启动',
  settingCloseToTray: '关闭时最小化到托盘',
  settingShowInTaskbar: '在任务栏显示',
  settingTopMost: '窗口置顶',
  settingDarkMode: '深色模式',
  tabPositionLabel: '页签位置',
  tabPositionTop: '顶部页签',
  tabPositionLeft: '左侧页签',
  tabPositionRight: '右侧页签',

  // 语言选项
  langChinese: '中文',
  langEnglish: 'English',
  langJapanese: '日本語',
  langKorean: '한국어',

  // 按钮
  btnOk: '确定',
  btnCancel: '取消',
  btnApply: '应用',

  // 对话框
  msgQuitConfirm: '确定要退出吗？',
  msgRestartRequired: '语言已更改，需要重启应用生效。立即重启吗？',
  msgRestart: '重启',
  msgLater: '稍后',

  // 关于
  aboutTitle: '关于 DSH Desktop',
  aboutVersion: '版本：1.2.1',
  aboutDescription: '类 ChatGPT 桌面客户端 - AI 助手',
  aboutAuthor: '作者：SmileSilence',
  aboutLicense: '许可证：MIT',
  // 关于 - 使用说明
  aboutUsageTitle: '使用说明',
  aboutUsageLine1: '本客户端直接使用 DeepSeek Harness 的 Web 服务（web profile，http://127.0.0.1:3080），启动后自动连接或拉起后端。',
  aboutUsageLine2: '如果 3080 端口已有 DSH Web 服务在运行，桌面端会直接复用，无需额外操作。',
  aboutUsageLine3: '如需手动启动 DSH 后端：npx @deepseek-ai/dsh web --no-open',
  aboutDshGitHub: 'DSH GitHub 仓库',
  aboutDshDocs: 'DSH 官方文档',

  // 窗口菜单
  menuMinimize: '最小化',
  menuClose: '关闭窗口',

  // 热键设置
  menuHotkey: '全局热键',
  hotkeyToggle: '切换窗口（显示/隐藏）',
  hotkeySettings: '打开设置',
  hotkeyAbout: '打开关于',
  hotkeyRestartBackend: '重启后端',
  hotkeyNewTab: '新建页签',
  hotkeyNotSet: '不设置',
  hotkeyCapture: '按下新快捷键...',
  hotkeyClear: '清除',
  hotkeyDefault: '默认: Ctrl+Shift+D',

  // DSH 路径设置
  settingsDshPath: 'DSH 路径设置',
  dshPathLabel: 'DSH 仓库路径',
  dshPathPlaceholder: '留空自动检测',
  dshPathHelp: '设置 DSH 仓库路径，留空将自动检测',
  refreshStatus: '刷新状态'
};

// ============ 语言管理 ============
let currentLang = LANG;

function loadLanguage(lang) {
  if (lang === 'en-US') {
    return {
      ...LANG,
      appName: 'DeepSeek Harness',
      appTitle: 'DeepSeek Harness',
      trayTooltip: 'DeepSeek Harness - AI Assistant',
      menuFile: 'File',
      menuEdit: 'Edit',
      menuView: 'View',
      menuWindow: 'Window',
      menuHelp: 'Help',
      menuNewChat: 'New Chat',
      menuOpenSettings: 'Open Settings',
      menuQuit: 'Quit',
      menuUndo: 'Undo',
      menuRedo: 'Redo',
      menuCut: 'Cut',
      menuCopy: 'Copy',
      menuPaste: 'Paste',
      menuSelectAll: 'Select All',
      menuReload: 'Reload',
      menuDevTools: 'Developer Tools',
      menuZoomIn: 'Zoom In',
      menuZoomOut: 'Zoom Out',
      menuResetZoom: 'Reset Zoom',
      menuFullscreen: 'Fullscreen',
      menuAbout: 'About',
      menuLanguage: 'Language',
      trayShow: 'Show Main Window',
      traySettings: 'Settings',
      trayAbout: 'About',
      trayQuit: 'Quit',
      settingsTitle: 'Settings',
      settingsGeneral: 'General Settings',
      settingsHotkey: 'Hotkey Settings',
      settingsAppearance: 'Appearance Settings',
      settingsLanguage: 'Language Settings',
      settingAutoLaunch: 'Auto Launch',
      settingCloseToTray: 'Close to Tray',
      settingShowInTaskbar: 'Show in Taskbar',
      settingTopMost: 'Window Top Most',
      settingDarkMode: 'Dark Mode',
      tabPositionLabel: 'Tab Position',
      tabPositionTop: 'Top',
      tabPositionLeft: 'Left',
      tabPositionRight: 'Right',
      langChinese: '中文',
      langEnglish: 'English',
      langJapanese: '日本語',
      langKorean: '한국어',
      btnOk: 'OK',
      btnCancel: 'Cancel',
      btnApply: 'Apply',
      msgQuitConfirm: 'Are you sure you want to quit?',
      msgRestartRequired: 'Language has been changed, restart required. Restart now?',
      msgRestart: 'Restart',
      msgLater: 'Later',
      aboutTitle: 'About DSH Desktop',
      aboutVersion: 'Version: 1.2.1',
      aboutDescription: 'ChatGPT-like Desktop Client - AI Assistant',
      aboutAuthor: 'Author: SmileSilence',
      aboutLicense: 'License: MIT',
      aboutUsageTitle: 'Usage Guide',
      aboutUsageLine1: 'This client directly uses the DSH Web service (web profile, http://127.0.0.1:3080). It automatically connects or starts the backend on launch.',
      aboutUsageLine2: 'If a DSH Web service is already running on port 3080, the desktop client will reuse it directly.',
      aboutUsageLine3: 'To manually start the DSH backend: npx @deepseek-ai/dsh web --no-open',
      aboutDshGitHub: 'DSH GitHub Repository',
      aboutDshDocs: 'DSH Documentation',
      menuMinimize: 'Minimize',
      menuClose: 'Close Window',
      menuHotkey: 'Global Hotkey',
      hotkeyToggle: 'Toggle Window (Show/Hide)',
      hotkeySettings: 'Open Settings',
      hotkeyAbout: 'Open About',
      hotkeyRestartBackend: 'Restart Backend',
      hotkeyNewTab: 'New Tab',
      hotkeyNotSet: 'Not Set',
      hotkeyCapture: 'Press new shortcut...',
      hotkeyClear: 'Clear',
      hotkeyDefault: 'Default: Ctrl+Shift+D',
      settingsDshPath: 'DSH Path Settings',
      dshPathLabel: 'DSH Repository Path',
      dshPathPlaceholder: 'Leave empty for auto-detection',
      dshPathHelp: 'Set DSH repository path, leave empty for auto-detection',
      refreshStatus: 'Refresh Status'
    };
  }
  return LANG;
}

// ============ 应用状态 ============
let mainWindow;
let tabManager;
let shellReadyPromise = Promise.resolve();
let appContentReady = false;
let isQuitting = false;

function getConfig() {
  return configStore.get();
}

// 托盘模块实例（P1.5）
const trayModule = createTrayModule({
  getIcon: () => path.join(PROJECT_ROOT, 'assets/icon-256.png'),
  getLang: () => currentLang,
  onShowWindow: () => showWindow(),
  onNewChat: () => {
    if (appContentReady && mainWindow) tabManager?.add();
  },
  getTabs: () => tabManager?.state() || { tabs: [], activeId: null },
  onActivateTab: (id) => { tabManager?.activate(id); showWindow(); },
  onRestartBackend: () => {
    logger.log('托盘触发重启后端...');
    dshServer.restart().catch((e) => logger.logError(`重启后端失败: ${e.message}`));
  },
  onSettings: () => showSettings(),
  onAbout: () => showAbout(),
  onQuit: () => {
    isQuitting = true;
    app.quit();
  },
  logger
});

// 注入器实例（P1.1/1.3/1.6 + P2.3 桥注入）
const injector = createInjector({
  getDshUrl: () => dshServer.dshUrl(),
  getThemeMode: () => themeMode(),
  getBridgeInfo: () => (bridgeServer.getPort() ? {
    bridgeBaseUrl: `http://127.0.0.1:${bridgeServer.getPort()}`,
    token: getConfig().bridge.token
  } : null),
  logger
});

// ============ IPC 桥（P2.2 / F2 / D3） ============
const bridgeServer = createBridgeServer({
  getDshPort: () => getRuntimeConfig().dsh.port || 3080,
  getToken: () => getConfig().bridge.token,
  routes: createRoutes({
    state: () => ({
      appVersion: app.getVersion(),
      windowVisible: !!(mainWindow && mainWindow.isVisible()),
      theme: themeMode(),
      backendRunning: dshServer.status().running || dshServer.status().ready,
      backendPort: dshServer.status().port,
      pluginInstalled: false,
      sharedWebProfile: true
    }),
    getSettings: () => maskSettings(getConfig()),
    patchSettings: (patch) => {
      const next = configStore.set(patch);
      applyConfigToRuntime(next);
      return maskSettings(next);
    },
    windowAction: (action) => {
      const result = applyWindowAction(action);
      return { action, result };
    },
    notify: (body) => notifier.notify(body),
    restartBackend: async () => {
      const result = await dshServer.restart();
      return { started: true, port: result.port || dshServer.status().port };
    },
    getDiagnostics: () => ({ text: buildDiagnosticsText() }),
    checkUpdater: () => checkAppUpdate(),
    bridgeInfo: () => ({
      appVersion: app.getVersion(),
      capabilities: ['settings', 'window', 'notify', 'backend', 'diagnostics', 'updater', 'dsh-update']
    }),
    // G1 本地 DSH 更新（P3.4）
    checkDshUpdate: () => dshUpdate.checkUpdate(false),
    updateDsh: async (body) => {
      const confirm = !!(body && body.confirm === true);
      const result = await dshUpdate.update(confirm);
      if (result.ok && result.restartRequired) {
        // 更新成功：自动重启后端使新版本生效（§16.5；桥端口/token 不变）
        logger.log('本地 DSH 已更新，自动重启后端...');
        setTimeout(() => { dshServer.restart().catch((e) => logger.logError(`重启后端失败: ${e.message}`)); }, 500);
      }
      return result;
    }
  }),
  logger
});

/** 开机自启应用到系统登录项（修改项 4） */
function applyLoginItem(autoLaunch) {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!autoLaunch,
      openAsHidden: !!autoLaunch && !!getConfig().tray.closeToTray,
      path: process.execPath
    });
  } catch (e) {
    logger.log(`设置开机自启失败: ${e.message}`);
  }
}

/** 配置变更即时应用到运行时（置顶/任务栏/菜单/托盘/登录项） */
function applyConfigToRuntime(next) {
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(!!next.tray.topMost, next.tray.topMost ? 'screen-saver' : 'normal');
    mainWindow.setSkipTaskbar(!next.tray.showInTaskbar);
  }
  tabManager?.layout();
  tabManager?.publish();
  createMenu();
  updateTrayMenu();
  registerHotkeys(); // 快捷键变更即时生效
  applyLoginItem(next.tray.autoLaunch);
}

/** 窗口动作（§15.1 白名单） */
function applyWindowAction(action) {
  if (!mainWindow) throw new Error('主窗口尚未创建');
  switch (action) {
    case 'minimize': mainWindow.minimize(); return 'minimized';
    case 'maximize': mainWindow.maximize(); return 'maximized';
    case 'unmaximize': mainWindow.unmaximize(); return 'unmaximized';
    case 'close':
      mainWindow.close(); // 遵守 closeToTray 语义
      return 'closed';
    case 'toggle':
      mainWindow.isVisible() ? mainWindow.hide() : showWindow();
      return mainWindow.isVisible() ? 'visible' : 'hidden';
    case 'show': showWindow(); return 'shown';
    default: throw new Error(`未知窗口动作: ${action}`);
  }
}

/** 更新检查（B6 / P3.2）：GitHub Releases + compareSemver + 节流 */
function checkAppUpdate() {
  return checkForUpdate({
    getCurrentVersion: () => app.getVersion(),
    getRepository: () => {
      const repo = (require('../package.json').repository) || { type: 'git', url: 'https://github.com/SmileSilence/AI-Development.git' };
      const m = /(?:github\.com|gitee\.com)[/:]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(repo.url || '');
      return m ? { owner: m[1], repo: m[2].replace(/\.git$/, '') } : { owner: 'dsh-community', repo: 'dsh-desktop' };
    },
    getLastChecked: () => getConfig().updater.lastChecked,
    setLastChecked: (ts) => {
      try { configStore.set({ updater: { lastChecked: ts } }); } catch (e) { /* 忽略 */ }
    },
    compare: compareSemver,
    logger
  });
}

/** 诊断文本（B5 / P3.3 / §4.5） */
function buildDiagnosticsText() {
  return buildDiagnostics({
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    logDir: logger.getLogDir(),
    logTail: (n) => logger.tail(n),
    backend: { running: dshServer.status().running || dshServer.status().ready, port: dshServer.status().port },
    config: getConfig()
  });
}

/** 当前主题模式（theme.mode：system → nativeTheme） */
function themeMode() {
  const mode = getConfig().theme.mode;
  if (mode === 'dark' || mode === 'light') return mode;
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

/** 应用原生标题栏配色（修改项 2）：theme.mode → nativeTheme.themeSource */
function applyNativeTheme() {
  const mode = getConfig().theme.mode || 'system';
  nativeTheme.themeSource = mode; // 'system' | 'dark' | 'light'，与 theme.mode 取值一致
}

// ============ 安全内嵌窗口基座（D1） ============
const EMBEDDED_WINDOW_PREFS = {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  preload: path.join(__dirname, '..', 'preload.js')
};

// ============ DSH 数据根 / API Key 引导 ============

/**
 * 解析 DSH 用户数据根目录（默认 ~/.dsh，可用 DSH_HOME 环境变量覆盖）
 * 与后端 @deepseek-ai/dsh-home-paths 的 resolveDshHome 语义保持一致。
 */
function resolveDshHomePath() {
  const env = process.env.DSH_HOME;
  if (env && env.trim().length > 0) {
    const expanded = env.trim().replace(/^~[\\/]/, os.homedir() + path.sep).replace(/^~$/, os.homedir());
    return path.resolve(expanded);
  }
  return path.join(os.homedir(), '.dsh');
}

/**
 * DSH 凭据文件路径（~/.dsh/.credentials.yaml）
 */
function credentialsFilePath() {
  return path.join(resolveDshHomePath(), '.credentials.yaml');
}

/**
 * 检测是否已配置 DeepSeek API Key。
 * 来源优先级：环境变量 DEEPSEEK_API_KEY → ~/.dsh/.credentials.yaml。
 */
function hasApiKeyConfigured() {
  if (process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY.trim().length > 0) return true;
  try {
    const credPath = credentialsFilePath();
    if (!fs.existsSync(credPath)) return false;
    const content = fs.readFileSync(credPath, 'utf-8');
    const match = content.match(/^\s*DEEPSEEK_API_KEY\s*:\s*(.+?)\s*$/m);
    if (!match) return false;
    const value = match[1].replace(/^["']|["']$/g, '').trim();
    return value.length > 0;
  } catch (e) {
    return false;
  }
}

/**
 * 把 DeepSeek API Key 写入 ~/.dsh/.credentials.yaml
 * （保留文件中其它凭据，仅更新/追加 DEEPSEEK_API_KEY）
 */
function writeApiKey(key) {
  const cleaned = key.trim();
  if (!cleaned) throw new Error('API Key 不能为空');
  const credPath = credentialsFilePath();
  fs.mkdirSync(path.dirname(credPath), { recursive: true });
  const keyLine = `DEEPSEEK_API_KEY: "${cleaned.replace(/"/g, '\\"')}"`;
  let content = '';
  if (fs.existsSync(credPath)) {
    content = fs.readFileSync(credPath, 'utf-8');
  }
  if (/^\s*DEEPSEEK_API_KEY\s*:/m.test(content)) {
    content = content.replace(/^\s*DEEPSEEK_API_KEY\s*:.*$/m, keyLine);
  } else {
    content = (content.trimEnd() + (content.trimEnd() ? '\n' : '') + keyLine + '\n');
  }
  fs.writeFileSync(credPath, content, { encoding: 'utf-8', mode: 0o600 });
  logger.log(`API Key 已写入 ${credPath}`);
}

/**
 * 首次启动引导：未配置模型 API Key 时弹出引导窗口。
 * D1：contextIsolation + sandbox + preload，无 nodeIntegration；回显经 escapeHtml。
 */
function showApiKeySetupGuide() {
  const setupWin = new BrowserWindow({
    width: 560,
    height: 460,
    title: '配置 DeepSeek API Key',
    parent: mainWindow,
    modal: true,
    resizable: false,
    webPreferences: EMBEDDED_WINDOW_PREFS
  });

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif;
          background: #1a1a2e; color: #fff; padding: 24px;
        }
        h1 { font-size: 20px; margin-bottom: 6px; }
        .sub { color: #8892b0; font-size: 13px; margin-bottom: 18px; line-height: 1.6; }
        label { display: block; font-size: 13px; color: #8892b0; margin-bottom: 6px; }
        input {
          width: 100%; padding: 10px 12px; font-size: 14px; border-radius: 6px;
          border: 1px solid #233554; background: #0a192f; color: #fff;
          font-family: Consolas, monospace; margin-bottom: 10px; outline: none;
        }
        input:focus { border-color: #667eea; }
        .hint { color: #8892b0; font-size: 12px; margin-bottom: 20px; line-height: 1.6; }
        .btn-group { display: flex; gap: 10px; }
        .btn {
          flex: 1; padding: 10px 0; border: none; border-radius: 6px; cursor: pointer;
          font-size: 14px; font-weight: 600;
        }
        .btn-primary { background: #667eea; color: #fff; }
        .btn-primary:hover { background: #5a6fd6; }
        .btn-secondary { background: transparent; color: #8892b0; border: 1px solid #233554; }
        .btn-secondary:hover { background: #16213e; }
        #status { margin-top: 14px; font-size: 13px; min-height: 18px; }
        .ok { color: #4ade80; }
        .err { color: #f87171; }
      </style>
    </head>
    <body>
      <h1>🤖 配置 DeepSeek API Key</h1>
      <div class="sub">首次使用需要配置模型密钥才能开始对话。密钥仅写入本机 DSH 凭据文件（~/.dsh/.credentials.yaml），不会随程序分发。</div>
      <label for="key">DeepSeek API Key（sk-...）</label>
      <input type="password" id="key" placeholder="sk-" autocomplete="off" spellcheck="false">
      <div class="hint">在 <a href="https://platform.deepseek.com/api_keys" style="color:#667eea" target="_blank">platform.deepseek.com/api_keys</a> 获取。也可以跳过，稍后在 DSH 界面「模型设置」中配置。</div>
      <div class="btn-group">
        <button class="btn btn-secondary" onclick="skip()">跳过，稍后配置</button>
        <button class="btn btn-primary" onclick="save()">保存并开始使用</button>
      </div>
      <div id="status"></div>
      <script>
        const api = window.dshDesktop;
        function save() {
          const key = document.getElementById('key').value.trim();
          if (!key) {
            document.getElementById('status').innerHTML = '<span class="err">请输入 API Key，或点击「跳过」。</span>';
            return;
          }
          api.saveApiKey(key);
        }
        function skip() {
          api.skipApiKey();
        }
        api.onApiKeySaved(() => {
          document.getElementById('status').innerHTML = '<span class="ok">✔ 已保存。如果对话时未识别到密钥，请重启应用。</span>';
          setTimeout(() => window.close(), 1200);
        });
        api.onApiKeyError((msg) => {
          // msg 已在主进程经 escapeHtml 转义（D2），此处直接插入
          document.getElementById('status').innerHTML = '<span class="err">保存失败：' + msg + '</span>';
        });
      </script>
    </body>
    </html>
  `;

  setupWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

/**
 * 服务就绪后的 API Key 引导入口：仅在未配置时弹一次。
 */
function ensureApiKeyGuide() {
  if (hasApiKeyConfigured()) {
    logger.log('已检测到 DEEPSEEK_API_KEY，跳过配置引导');
    return;
  }
  logger.log('未检测到模型 API Key，弹出配置引导');
  showApiKeySetupGuide();
}

// ============ 创建主窗口（P1.2：window.js 接管 WCO + 状态记忆） ============
function createMainWindow({ deferInitialTab = false } = {}) {
  const cfg = getConfig();
  mainWindow = createMainWindowFactory({
    getDshUrl: () => dshServer.dshUrl(),
    getConfig,
    saveConfig: (patch) => {
      try { configStore.set(patch); } catch (e) { logger.log(`窗口状态保存失败: ${e.message}`); }
    },
    getThemeMode: () => themeMode(),
    icon: path.join(PROJECT_ROOT, 'assets', 'icon-256.png'),
    preload: path.join(PROJECT_ROOT, 'preload.js'),
    onClose: (event, win) => handleWindowClose(event, win),
    logger
  });

  tabManager = createTabManager({
    window: mainWindow,
    WebContentsView,
    getUrl: () => dshServer.dshUrl(),
    getPosition: () => getConfig().window.tabPosition,
    injector,
    preload: path.join(PROJECT_ROOT, 'preload.js'),
    onChange: () => updateTrayMenu(),
    logger
  });
  shellReadyPromise = mainWindow.loadFile(path.join(__dirname, 'shell.html')).then(() => {
    if (!deferInitialTab) tabManager.add();
    tabManager.publish();
  });

  const sendMaximizedState = (value) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window-maximized-changed', value);
    }
  };
  mainWindow.on('maximize', () => sendMaximizedState(true));
  mainWindow.on('unmaximize', () => sendMaximizedState(false));
  // 窗口置顶可靠性（修改项 4）：show/restore 后重断言，避免系统复位
  const assertTopMost = () => {
    if (mainWindow && !mainWindow.isDestroyed() && getConfig().tray.topMost) {
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
    }
  };
  mainWindow.on('show', assertTopMost);
  mainWindow.on('restore', assertTopMost);
  // P2.5：菜单移除后的开发者快捷键
  installDevShortcuts(mainWindow);
  mainWindow.on('closed', () => {
    tabManager?.destroy();
    tabManager = null;
    mainWindow = null;
  });

  // 创建应用菜单（P2.5 移除菜单栏）
  createMenu();
}

/** 关闭语义（隐藏到托盘 / 退出确认） */
function handleWindowClose(event, win) {
  const cfgNow = getConfig();
  if (!isQuitting && cfgNow.tray.closeToTray) {
    event.preventDefault();
    win.hide(); // 关闭 = 隐藏到托盘（托盘可恢复；退出走托盘菜单）
    return;
  }

  if (!isQuitting) {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: [currentLang.btnOk, currentLang.btnCancel],
      title: currentLang.appName,
      message: currentLang.msgQuitConfirm
    });

    if (choice === 1) {
      event.preventDefault();
      return;
    }
    isQuitting = true;
  }
}

// ============ 应用菜单栏（P2.5 移除；开发者快捷键迁移到 before-input-event） ============
function createMenu() {
  if (process.platform === 'darwin') {
    // macOS 需要最小菜单保证 Cmd+C/V/X 与系统剪贴板行为；不含 File/设置/帮助
    const minimal = Menu.buildFromTemplate([
      { label: currentLang.appName, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] },
      { label: currentLang.menuEdit, submenu: [role('undo'), role('redo'), { type: 'separator' }, role('cut'), role('copy'), role('paste'), role('selectAll')] },
      { label: currentLang.menuView, submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] }
    ]);
    Menu.setApplicationMenu(minimal);
    return;
  }
  // Windows/Linux：无菜单栏
  Menu.setApplicationMenu(null);
}

/** 生成 role 菜单项（macOS 最小菜单） */
function role(name) {
  return { role: name };
}

/** 开发者快捷键（菜单移除后经 before-input-event 保留；设置/关于/新页签已改为可配置全局热键） */
function installDevShortcuts(win) {
  win.webContents.on('before-input-event', (event, input) => {
    const mod = input.control || input.meta;
    const key = input.key.toLowerCase();
    // F12 → DevTools；Ctrl+R → 重新加载；Ctrl+Shift+I → DevTools
    if (input.key === 'F12' || (mod && input.shift && key === 'i')) {
      event.preventDefault();
      tabManager?.openDevTools();
    } else if (mod && key === 'r') {
      event.preventDefault();
      tabManager?.reloadActive();
    }
  });
}

// ============ 创建系统托盘（P1.5：tray.js 接管增强菜单） ============
function createTray() {
  trayModule.create();
}

function updateTrayMenu() {
  trayModule.update();
}

// ============ 显示窗口 ============
function showWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
}

// ============ 主窗口内置设置页签 ============
function showSettings(activate = true) {
  if (activate) showWindow();
  const settingsUrl = `${pathToFileURL(path.join(__dirname, 'internal.html')).href}?view=settings`;
  tabManager?.openInternal('settings', currentLang.settingsTitle, settingsUrl, activate);
}

// ============ DSH 安装状态检查（回显经 escapeHtml，D2） ============
function showDshInstallationStatusHtml() {
  let status;
  try { status = dshServer.detectFacts(); } catch (error) {
    return escapeHtml(error.message).replace(/\n/g, '<br>');
  }

  const lines = [];
  lines.push('DSH 安装状态检查：');
  lines.push('');
  lines.push(status.repoPaths.length > 0
    ? `✅ 本地仓库：${status.repoPaths[0]}`
    : '❌ 未找到本地仓库');
  if (status.repoPaths.length === 0) {
    lines.push(status.hasGlobalCli ? '✅ 全局 CLI 已安装' : '❌ 全局 CLI 未安装');
    lines.push(status.npmGlobalPath ? `✅ npm 全局包：${status.npmGlobalPath}` : '❌ npm 全局包未安装');
  }
  lines.push('');
  lines.push('可用启动方式：');
  if (status.repoPaths.length > 0) lines.push('1. 从本地仓库启动（推荐）');
  if (status.hasGlobalCli) lines.push('2. 使用全局 DSH CLI');
  if (status.npmGlobalPath) lines.push('3. 使用 npm 全局包');
  lines.push('4. 使用 npx 从 npm 安装');

  return escapeHtml(lines.join('\n')).replace(/\n/g, '<br>');
}

// ============ 主窗口内置关于页签 ============
function showAbout(activate = true) {
  if (activate) showWindow();
  const aboutUrl = `${pathToFileURL(path.join(__dirname, 'internal.html')).href}?view=about`;
  tabManager?.openInternal('about', currentLang.aboutTitle, aboutUrl, activate);
}

// ============ 注册全局快捷键 ============
const hotkeyActions = {
  hotkey: () => { if (mainWindow) mainWindow.isVisible() ? mainWindow.hide() : showWindow(); },
  hotkeySettings: () => showSettings(),
  hotkeyAbout: () => showAbout(),
  hotkeyRestartBackend: () => {
    logger.log('快捷键触发重启后端...');
    dshServer.restart().catch((e) => logger.logError(`重启后端失败: ${e.message}`));
  },
  hotkeyNewTab: () => { if (appContentReady && mainWindow) { showWindow(); tabManager?.add(); } }
};

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const cfg = getConfig();
  for (const [key, fn] of Object.entries(hotkeyActions)) {
    const accel = cfg[key];
    if (!accel || !String(accel).trim()) continue;
    try {
      const ok = globalShortcut.register(String(accel), fn);
      if (!ok) logger.log(`快捷键注册失败（被占用或格式无效）: ${accel}`);
    } catch (e) {
      logger.log(`注册快捷键失败 ${accel}: ${e.message}`);
    }
  }
}

// ============ 处理 IPC 消息 ============
ipcMain.on('save-api-key', (event, key) => {
  try {
    writeApiKey(key);
    event.reply('api-key-saved');
  } catch (err) {
    event.reply('api-key-error', escapeHtml(err.message));
  }
});

ipcMain.on('skip-api-key', (event) => {
  if (event.sender) {
    BrowserWindow.fromWebContents(event.sender)?.close();
  }
});

function isInternalPageSender(event) {
  const expected = pathToFileURL(path.join(__dirname, 'internal.html')).href;
  return typeof event.sender?.getURL === 'function' && event.sender.getURL().startsWith(expected);
}

ipcMain.on('refresh-dsh-status', (event) => {
  if (!isInternalPageSender(event)) return;
  event.reply('dsh-status-updated', showDshInstallationStatusHtml());
});

ipcMain.handle('internal-page-data', (event) => {
  if (!isInternalPageSender(event)) throw new Error('仅允许内置页面读取配置');
  return {
    config: getConfig(),
    language: currentLang,
    theme: themeMode(),
    dshStatusHtml: showDshInstallationStatusHtml(),
    appVersion: app.getVersion()
  };
});

ipcMain.handle('internal-confirm', (event, message) => {
  if (!isInternalPageSender(event)) return false;
  const win = BrowserWindow.fromWebContents(event.sender);
  const choice = dialog.showMessageBoxSync(win, {
    type: 'question',
    buttons: [currentLang.btnOk, currentLang.btnCancel],
    title: currentLang.appName,
    message: String(message || '')
  });
  return choice === 0;
});

// 热键捕获期间临时禁用/恢复全局快捷键，避免按下当前已注册的组合时触发对应动作
ipcMain.on('hotkey-capture-start', (event) => {
  if (!isInternalPageSender(event)) return;
  globalShortcut.unregisterAll();
});
ipcMain.on('hotkey-capture-end', (event) => {
  if (!isInternalPageSender(event)) return;
  registerHotkeys();
});

// 关于页外部链接（DSH 文档 / GitHub）
ipcMain.on('open-external', (event, url) => {
  if (!isInternalPageSender(event)) return;
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
  shell.openExternal(url);
});

ipcMain.handle('internal-dsh-check-update', async (event) => {
  if (!isInternalPageSender(event)) throw new Error('仅允许内置页面检查 DSH 更新');
  return dshUpdate.checkUpdate(true);
});

ipcMain.handle('internal-dsh-update', async (event, confirm) => {
  if (!isInternalPageSender(event)) throw new Error('仅允许内置页面更新 DSH');
  const result = await dshUpdate.update(confirm === true);
  if (result.ok && result.restartRequired) {
    logger.log('关于页完成 DSH 更新，自动重启后端...');
    setTimeout(() => { dshServer.restart().catch((e) => logger.logError(`重启后端失败: ${e.message}`)); }, 500);
  }
  return result;
});

ipcMain.on('window-maximize-toggle', (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});

ipcMain.on('window-close', (event) => {
  if (mainWindow && event.sender === mainWindow.webContents) mainWindow.close();
});

ipcMain.on('theme-report', (event, report) => {
  if (!mainWindow) return;
  if (!report || !['dark', 'light'].includes(report.theme)) return;
  const bg = report.palette && report.palette.bg;
  if (typeof bg === 'string' && bg.length <= 64 && /^(#[0-9a-f]{6}|rgba?\([0-9., %]+\))$/i.test(bg)) {
    mainWindow.setBackgroundColor(bg);
  }
});

ipcMain.on('tab-new', (event) => {
  if (appContentReady && mainWindow && event.sender === mainWindow.webContents) tabManager?.add();
});
ipcMain.on('tab-activate', (event, id) => {
  if (mainWindow && event.sender === mainWindow.webContents && typeof id === 'string') tabManager?.activate(id);
});
ipcMain.on('tab-close', (event, id) => {
  if (mainWindow && event.sender === mainWindow.webContents && typeof id === 'string') tabManager?.close(id);
});
ipcMain.on('tab-rename', (event, id, title) => {
  if (mainWindow && event.sender === mainWindow.webContents && typeof id === 'string' && typeof title === 'string') {
    tabManager?.rename(id, title);
  }
});
ipcMain.on('tabs-state-request', (event) => {
  if (mainWindow && event.sender === mainWindow.webContents) tabManager?.publish();
});

ipcMain.on('save-settings', (event, newConfig) => {
  if (!isInternalPageSender(event)) return;
  const oldLanguage = getConfig().language;
  let next;
  try {
    next = configStore.set(newConfig || {});
  } catch (err) {
    dialog.showErrorBox('保存配置失败', err.message);
    return;
  }

  // 应用置顶/任务栏/菜单/托盘（P2.2 与桥 PATCH 共用同一路径）
  applyConfigToRuntime(next);

  // 语言即时应用到托盘及后续生成的内置页签，不再弹出独立重启窗口。
  if (oldLanguage !== next.language) {
    currentLang = loadLanguage(next.language);
    app.setName(currentLang.appName);
    updateTrayMenu();
    if (tabManager?.has('settings')) showSettings(false);
    if (tabManager?.has('about')) showAbout(false);
  }
});

// ============ 单实例锁（P1.4 / B3） ============
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  logger.log('已有实例在运行，退出当前实例');
  app.quit();
} else {
  // 二次启动 → 唤起已有窗口
  app.on('second-instance', () => {
    logger.log('检测到二次启动，唤起主窗口');
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      showWindow();
      if (appContentReady) tabManager?.add();
    }
  });

// ============ 应用就绪 ============
app.whenReady().then(async () => {
  configStore.load();
  runtimeBackendPort = getConfig().dsh.port || 3080;
  applyNativeTheme();
  applyLoginItem(getConfig().tray.autoLaunch); // 同步外部修改的开机自启
  currentLang = loadLanguage(getConfig().language);
  app.setName(currentLang.appName);

  // 启动 IPC 桥（P2.2）：随机 token 写入 config.bridge（不入用户编辑面）
  try {
    const token = bridgeServer.generateToken();
    configStore.set({ bridge: { port: 0, token } });
    await bridgeServer.start();
    const bridgePort = bridgeServer.getPort();
    configStore.set({ bridge: { port: bridgePort, token } });
    logger.log(`IPC 桥已启动: 127.0.0.1:${bridgePort}`);
  } catch (e) {
    logger.logError(`IPC 桥启动失败: ${e.message}`);
  }

  // 主题跟随（P1.6 / B1）：nativeTheme 变更 → WCO chrome + 重注入
  nativeTheme.on('updated', () => {
    applyNativeTheme(); // system 时保持跟随；dark/light 时幂等
    const mode = themeMode();
    logger.log(`系统主题变更: ${mode}`);
    applyThemeToChrome(mainWindow, mode);
    if (mainWindow) injector.applyInjections(mainWindow);
    if (tabManager?.has('settings')) showSettings(false);
    if (tabManager?.has('about')) showAbout(false);
  });

  // 立即显示主窗口；服务启动状态由主窗口内的 startup-view 承载。
  createMainWindow({ deferInitialTab: true });
  createTray();
  registerHotkeys();

  try {
    // 直接复用 web profile：浏览器端已安装及以后安装的插件无需复制即可使用。
    // 仅复用当前浏览器会话可访问的服务，否则使用回退端口启动同一 profile。
    if (runtimeBackendPort === 3080 && !(await dshServer.isServerReady())) {
      runtimeBackendPort = 3092;
      logger.log('web:3080 未运行或不可用，桌面端改用 web:3092');
    }
    await dshServer.start();
  } catch (err) {
    logger.logError(`服务启动失败: ${err.message}`);

    const errorDetail = `DSH Web 服务启动失败（${err.code || 'START_FAILED'}）：\n${err.message}`;

    await shellReadyPromise;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app-load-error', errorDetail);
    return;
  }

  // 服务就绪，在同一主窗口内从加载状态切换到首个内容页签。
  await shellReadyPromise;
  if (mainWindow && !mainWindow.isDestroyed()) {
    appContentReady = true;
    tabManager?.add();
    // 打开瞬间重排 + 延迟补排：原生标题栏帧就绪后再校正一次，避免底部未适配（与"拖动窗口大小"等效）
    tabManager?.layout();
    setTimeout(() => tabManager?.layout(), 300);
    mainWindow.webContents.send('app-ready');
  }

  // 首次启动引导：未配置模型 API Key 时弹出引导窗口
  ensureApiKeyGuide();

  // G1：启动时按 dsh.checkOnStartup 静默检查本地 DSH 更新（默认关，发现新版仅发通知，不自动更新）
  if (getConfig().dsh.checkOnStartup) {
    setTimeout(() => {
      dshUpdate.checkUpdate(false).then((r) => {
        if (r.hasUpdate && !r.throttled) {
          logger.log(`启动静默检查：发现 DSH 新版 ${r.latestVersion}（当前 ${r.currentVersion ?? 'unknown'}）`);
          notifier.notify({ title: 'DSH 更新可用', body: `当前 ${r.currentVersion ?? 'unknown'} → 最新 ${r.latestVersion ?? 'unknown'}（请到设置页确认更新）` });
        }
      }).catch((e) => logger.logError(`启动静默检查失败: ${e.message}`));
    }, 5000);
  }

  app.on('activate', () => {
    if (mainWindow) showWindow();
  });
});

// ============ 所有窗口关闭 ============
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ============ 退出前清理 ============
let cleanupDone = false;
let cleanupStarted = false;
app.on('before-quit', (event) => {
  isQuitting = true;
  if (cleanupDone) return;
  event.preventDefault();
  if (cleanupStarted) return;
  cleanupStarted = true;
  Promise.resolve()
    .then(() => dshServer.stop())
    .catch((e) => logger.logError(`退出清理失败: ${e.message}`))
    .finally(() => {
      cleanupDone = true;
      app.quit();
    });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// ============ 开发模式 ============
if (process.argv.includes('--dev')) {
  app.whenReady().then(() => {
    if (mainWindow) mainWindow.webContents.openDevTools();
  });
}

} // end single-instance else
