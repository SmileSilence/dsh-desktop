const { app, BrowserWindow, Tray, Menu, globalShortcut, nativeImage, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const http = require('http');
const net = require('net');

// ============ 配置 ============
const DSH_URL = 'http://127.0.0.1:3080';
const DSH_PORT = 3080;
const HOTKEY = 'CommandOrControl+Shift+D';
const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');

// DSH 源码仓库路径（与本项目同级或在配置中指定）
const DSH_REPO_ROOT = process.env.DSH_REPO_ROOT || 
  path.join(__dirname, '..', 'deepseek-harness') ||
  path.join(__dirname, 'deepseek-harness') ||
  path.join(app.getPath('home'), 'deepseek-harness');

// ============ 日志 ============
function log(msg) { console.log(`[DSH Desktop] ${msg}`); }
function logError(msg) { console.error(`[DSH Desktop] ${msg}`); }

// ============ DSH 服务管理 ============
let dshServerProcess = null;
let serverReady = false;

/**
 * 通过 TCP 端口检测 DSH Web 服务是否已在运行
 */
function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => { resolve(false); });
    socket.connect(port, '127.0.0.1');
  });
}

/**
 * HTTP 健康检查（端口通了之后再确认 HTTP 响应）
 */
function isServerReady() {
  return new Promise((resolve) => {
    const req = http.get(DSH_URL, { timeout: 3000 }, (res) => {
      res.resume();
      resolve(res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/**
 * 轮询等待 DSH Web 服务就绪
 */
function waitForServer(timeoutMs = 90000, intervalMs = 2000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = async () => {
      if (await isServerReady()) {
        serverReady = true;
        return resolve();
      }
      if (Date.now() - start > timeoutMs) {
        return reject(new Error('DSH Web 服务启动超时（90秒）'));
      }
      setTimeout(check, intervalMs);
    };
    check();
  });
}

/**
 * 查找 node.exe 的绝对路径
 */
function findNodePath() {
  // Electron 自带的 node
  const electronNode = process.execPath.replace(/electron\.exe$/i, 'node.exe');
  if (fs.existsSync(electronNode)) return electronNode;

  // 系统 node
  try {
    return execSync('where node', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim().split(/\r?\n/)[0];
  } catch {}

  return 'node';
}

/**
 * 检测 DSH 安装状态
 */
function detectDshInstallation() {
  const status = {
    hasLocalRepo: false,
    hasGlobalCli: false,
    hasNpmPackage: false,
    localRepoPath: null,
    globalCliPath: null,
    npmPackagePath: null
  };

  // 检查本地仓库
  const possiblePaths = [
    DSH_REPO_ROOT,
    path.join(__dirname, '..', 'deepseek-harness'),
    path.join(__dirname, 'deepseek-harness'),
    path.join(app.getPath('home'), 'deepseek-harness'),
    path.join(app.getPath('desktop'), 'deepseek-harness'),
    path.join(app.getPath('documents'), 'deepseek-harness')
  ];

  for (const repoPath of possiblePaths) {
    if (fs.existsSync(path.join(repoPath, 'package.json'))) {
      status.hasLocalRepo = true;
      status.localRepoPath = repoPath;
      break;
    }
  }

  // 检查全局 CLI
  try {
    const { execSync } = require('child_process');
    execSync('dsh --version', { stdio: 'ignore' });
    status.hasGlobalCli = true;
  } catch (e) {
    // DSH CLI 未全局安装
  }

  // 检查 npm 全局包
  try {
    const { execSync } = require('child_process');
    const npmGlobalPath = execSync('npm root -g', { encoding: 'utf-8' }).trim();
    const dshGlobalPath = path.join(npmGlobalPath, '@deepseek-ai', 'dsh');
    if (fs.existsSync(dshGlobalPath)) {
      status.hasNpmPackage = true;
      status.npmPackagePath = dshGlobalPath;
    }
  } catch (e) {
    // npm 全局路径获取失败
  }

  return status;
}

/**
 * 查找 DSH 仓库中可用的启动方式
 */
function resolveDshLaunchCommand() {
  // 优先使用配置中的 DSH 路径
  if (config.dshPath && fs.existsSync(path.join(config.dshPath, 'package.json'))) {
    log(`使用配置的 DSH 路径: ${config.dshPath}`);
    return { cmd: 'pnpm', args: ['dsh', 'web', '--no-open'], cwd: config.dshPath };
  }

  // 尝试多个可能的 DSH 仓库路径
  const possiblePaths = [
    DSH_REPO_ROOT,
    path.join(__dirname, '..', 'deepseek-harness'),
    path.join(__dirname, 'deepseek-harness'),
    path.join(app.getPath('home'), 'deepseek-harness'),
    path.join(app.getPath('desktop'), 'deepseek-harness'),
    path.join(app.getPath('documents'), 'deepseek-harness')
  ];

  // 方式1：从源码仓库启动
  for (const repoPath of possiblePaths) {
    if (fs.existsSync(path.join(repoPath, 'package.json'))) {
      log(`找到 DSH 仓库: ${repoPath}`);
      return { cmd: 'pnpm', args: ['dsh', 'web', '--no-open'], cwd: repoPath };
    }
  }

  // 方式2：检查全局安装的 DSH CLI
  try {
    const { execSync } = require('child_process');
    execSync('dsh --version', { stdio: 'ignore' });
    log('找到全局安装的 DSH CLI');
    return { cmd: 'dsh', args: ['web', '--no-open'], cwd: undefined };
  } catch (e) {
    // DSH CLI 未全局安装
  }

  // 方式3：检查 npm 全局安装的 DSH
  try {
    const { execSync } = require('child_process');
    const npmGlobalPath = execSync('npm root -g', { encoding: 'utf-8' }).trim();
    const dshGlobalPath = path.join(npmGlobalPath, '@deepseek-ai', 'dsh');
    if (fs.existsSync(dshGlobalPath)) {
      log(`找到 npm 全局安装的 DSH: ${dshGlobalPath}`);
      return { cmd: 'npx', args: ['@deepseek-ai/dsh', 'web', '--no-open'], cwd: undefined };
    }
  } catch (e) {
    // npm 全局路径获取失败
  }

  // 方式4：使用 npx 从 npm 安装
  log('未找到本地 DSH 仓库，将使用 npx 从 npm 安装');
  return { cmd: 'npx', args: ['@deepseek-ai/dsh', 'web', '--no-open'], cwd: undefined };
}

/**
 * 启动 DSH Web 服务（无终端窗口）
 */
async function startDshServer() {
  // 先检查端口是否被占用
  if (await isPortInUse(DSH_PORT)) {
    log('端口 3080 已被占用，检查服务是否正常...');
    if (await isServerReady()) {
      log('DSH Web 服务已在运行');
      serverReady = true;
      return;
    } else {
      log('端口被占用但服务响应异常，尝试启动新服务...');
    }
  }

  log('正在启动 DSH Web 服务...');
  log(`DSH 仓库路径: ${DSH_REPO_ROOT}`);

  const launch = resolveDshLaunchCommand();
  log(`启动命令: ${launch.cmd} ${launch.args.join(' ')}`);

  // 捕获 stdout/stderr 用于调试
  let stdoutBuf = '';
  let stderrBuf = '';

  const options = {
    cwd: launch.cwd,
    // 关键：不打开终端窗口
    detached: false,
    // pipe 捕获输出用于调试，但不阻塞
    stdio: ['ignore', 'pipe', 'pipe'],
    // Windows 下隐藏子进程窗口
    windowsHide: true,
    // 继承环境变量
    env: { ...process.env },
    // 使用 shell 模式，确保 Windows 上 .cmd/.bat 能执行
    shell: true,
  };

  try {
    dshServerProcess = spawn(launch.cmd, launch.args, options);

    // 收集输出用于错误诊断
    if (dshServerProcess.stdout) {
      dshServerProcess.stdout.on('data', (data) => {
        const text = data.toString();
        stdoutBuf += text;
        // 只保留最后 2KB
        if (stdoutBuf.length > 2048) stdoutBuf = stdoutBuf.slice(-2048);
      });
    }
    if (dshServerProcess.stderr) {
      dshServerProcess.stderr.on('data', (data) => {
        const text = data.toString();
        stderrBuf += text;
        if (stderrBuf.length > 2048) stderrBuf = stderrBuf.slice(-2048);
        log(`[stderr] ${text.trim()}`);
      });
    }

    dshServerProcess.on('error', (err) => {
      logError(`启动失败: ${err.message}`);
      dshServerProcess = null;
    });

    dshServerProcess.on('exit', (code, signal) => {
      log(`服务已退出 (code=${code}, signal=${signal})`);
      if (stdoutBuf.trim()) log(`[stdout] ${stdoutBuf.trim().slice(-500)}`);
      if (stderrBuf.trim()) log(`[stderr] ${stderrBuf.trim().slice(-500)}`);
      dshServerProcess = null;
      serverReady = false;
    });

    log(`服务进程已启动 (PID: ${dshServerProcess.pid})`);

    // 等待服务就绪
    await waitForServer();
    log('DSH Web 服务已就绪 ✓');
  } catch (err) {
    logError(`启动异常: ${err.message}`);
    throw err;
  }
}

/**
 * 停止 DSH Web 服务
 */
function stopDshServer() {
  if (dshServerProcess) {
    log('正在停止 DSH Web 服务...');
    try { dshServerProcess.kill(); } catch {}
    dshServerProcess = null;
  }
}

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
  settingCloseToTray: '关闭时隐藏到托盘',
  settingShowInTaskbar: '在任务栏显示',
  settingTopMost: '窗口置顶',
  settingDarkMode: '深色模式',

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
  aboutVersion: '版本：1.0.0',
  aboutDescription: '类 ChatGPT 桌面客户端 - AI 助手',
  aboutAuthor: '作者：DSH Community',
  aboutLicense: '许可证：MIT',

  // 窗口菜单
  menuMinimize: '最小化',
  menuClose: '关闭窗口',

  // 热键设置
  menuHotkey: '全局热键',
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

// ============ 应用状态 ============
let mainWindow;
let tray;
let isQuitting = false;
let config = {
  autoLaunch: false,
  closeToTray: true,
  showInTaskbar: true,
  topMost: false,
  darkMode: true,
  hotkey: HOTKEY,
  language: 'zh-CN',
  dshPath: ''
};

// ============ 语言管理 ============
let currentLang = LANG;

function loadLanguage(lang) {
  // 目前只有中文，预留扩展
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
      aboutVersion: 'Version: 1.0.0',
      aboutDescription: 'ChatGPT-like Desktop Client - AI Assistant',
      aboutAuthor: 'Author: DSH Community',
      aboutLicense: 'License: MIT',
      menuMinimize: 'Minimize',
      menuClose: 'Close Window',
      menuHotkey: 'Global Hotkey',
      hotkeyCapture: 'Press new shortcut...',
      hotkeyClear: 'Clear',
      hotkeyDefault: 'Default: Ctrl+Shift+D',

      // DSH Path Settings
      settingsDshPath: 'DSH Path Settings',
      dshPathLabel: 'DSH Repository Path',
      dshPathPlaceholder: 'Leave empty for auto-detection',
      dshPathHelp: 'Set DSH repository path, leave empty for auto-detection',
      refreshStatus: 'Refresh Status'
    };
  }
  return LANG;
}

// ============ 配置管理 ============
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
      config = { ...config, ...JSON.parse(data) };
      currentLang = loadLanguage(config.language);
    }
  } catch (e) {
    console.error('加载配置失败:', e);
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  } catch (e) {
    console.error('保存配置失败:', e);
  }
}

// ============ 创建主窗口 ============
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: currentLang.appTitle,
    icon: path.join(__dirname, 'assets/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    alwaysOnTop: config.topMost
  });

  mainWindow.loadURL(DSH_URL);

  // 处理页面加载失败（服务可能还在启动）
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.log(`[DSH Desktop] 页面加载失败 (${errorCode}): ${errorDescription}，正在重试...`);
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(DSH_URL);
      }
    }, 3000);
  });

  // 关闭时隐藏到托盘
  mainWindow.on('close', (event) => {
    if (!isQuitting && config.closeToTray) {
      event.preventDefault();
      mainWindow.hide();
      return;
    }

    if (!isQuitting) {
      const choice = dialog.showMessageBoxSync(mainWindow, {
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
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 创建菜单栏
  createMenu();
}

// ============ 创建菜单栏 ============
function createMenu() {
  const template = [
    {
      label: currentLang.menuFile,
      submenu: [
        {
          label: currentLang.menuNewChat,
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            if (mainWindow) {
              mainWindow.loadURL(DSH_URL);
            }
          }
        },
        { type: 'separator' },
        {
          label: currentLang.menuOpenSettings,
          accelerator: 'CmdOrCtrl+,',
          click: () => showSettings()
        },
        { type: 'separator' },
        {
          label: currentLang.menuQuit,
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            isQuitting = true;
            app.quit();
          }
        }
      ]
    },
    {
      label: currentLang.menuEdit,
      submenu: [
        { label: currentLang.menuUndo, accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: currentLang.menuRedo, accelerator: 'CmdOrCtrl+Shift+Z', role: 'redo' },
        { type: 'separator' },
        { label: currentLang.menuCut, accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: currentLang.menuCopy, accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: currentLang.menuPaste, accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: currentLang.menuSelectAll, accelerator: 'CmdOrCtrl+A', role: 'selectAll' }
      ]
    },
    {
      label: currentLang.menuView,
      submenu: [
        {
          label: currentLang.menuReload,
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            if (mainWindow) mainWindow.reload();
          }
        },
        {
          label: currentLang.menuDevTools,
          accelerator: 'F12',
          click: () => {
            if (mainWindow) mainWindow.webContents.toggleDevTools();
          }
        },
        { type: 'separator' },
        {
          label: currentLang.menuZoomIn,
          accelerator: 'CmdOrCtrl+=',
          click: () => {
            if (mainWindow) {
              const zoom = mainWindow.webContents.getZoomFactor();
              mainWindow.webContents.setZoomFactor(Math.min(zoom + 0.1, 2));
            }
          }
        },
        {
          label: currentLang.menuZoomOut,
          accelerator: 'CmdOrCtrl+-',
          click: () => {
            if (mainWindow) {
              const zoom = mainWindow.webContents.getZoomFactor();
              mainWindow.webContents.setZoomFactor(Math.max(zoom - 0.1, 0.5));
            }
          }
        },
        {
          label: currentLang.menuResetZoom,
          accelerator: 'CmdOrCtrl+0',
          click: () => {
            if (mainWindow) mainWindow.webContents.setZoomFactor(1);
          }
        },
        { type: 'separator' },
        {
          label: currentLang.menuFullscreen,
          accelerator: 'F11',
          click: () => {
            if (mainWindow) {
              mainWindow.setFullScreen(!mainWindow.isFullScreen());
            }
          }
        }
      ]
    },
    {
      label: currentLang.menuWindow,
      submenu: [
        {
          label: currentLang.menuMinimize,
          accelerator: 'CmdOrCtrl+M',
          click: () => {
            if (mainWindow) mainWindow.minimize();
          }
        },
        {
          label: currentLang.menuClose,
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            if (mainWindow) mainWindow.hide();
          }
        }
      ]
    },
    {
      label: currentLang.menuHelp,
      submenu: [
        {
          label: currentLang.menuAbout,
          click: () => showAbout()
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ============ 创建系统托盘 ============
function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets/icon.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);

  updateTrayMenu();

  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : showWindow();
    }
  });
}

function updateTrayMenu() {
  const contextMenu = Menu.buildFromTemplate([
    {
      label: currentLang.trayShow,
      click: () => showWindow()
    },
    { type: 'separator' },
    {
      label: currentLang.traySettings,
      click: () => showSettings()
    },
    { type: 'separator' },
    {
      label: currentLang.trayAbout,
      click: () => showAbout()
    },
    { type: 'separator' },
    {
      label: currentLang.trayQuit,
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip(currentLang.trayTooltip);
  tray.setContextMenu(contextMenu);
}

// ============ 显示窗口 ============
function showWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
}

// ============ 显示设置窗口 ============
function showSettings() {
  const settingsWindow = new BrowserWindow({
    width: 500,
    height: 650,
    title: currentLang.settingsTitle,
    parent: mainWindow,
    modal: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  const settingsHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif;
          background: ${config.darkMode ? '#1a1a2e' : '#f5f5f5'};
          color: ${config.darkMode ? '#fff' : '#333'};
          padding: 20px;
          overflow-y: auto;
        }
        .section {
          background: ${config.darkMode ? '#16213e' : '#fff'};
          border-radius: 10px;
          padding: 15px;
          margin-bottom: 15px;
        }
        .section-title {
          font-size: 14px;
          color: ${config.darkMode ? '#8892b0' : '#666'};
          margin-bottom: 10px;
        }
        .setting-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 0;
          border-bottom: 1px solid ${config.darkMode ? '#233554' : '#eee'};
        }
        .setting-item:last-child { border-bottom: none; }
        .setting-label { font-size: 14px; }
        .switch {
          position: relative;
          width: 44px;
          height: 22px;
        }
        .switch input { opacity: 0; width: 0; height: 0; }
        .slider {
          position: absolute;
          cursor: pointer;
          top: 0; left: 0; right: 0; bottom: 0;
          background-color: #ccc;
          transition: .3s;
          border-radius: 22px;
        }
        .slider:before {
          position: absolute;
          content: "";
          height: 18px;
          width: 18px;
          left: 2px;
          bottom: 2px;
          background-color: white;
          transition: .3s;
          border-radius: 50%;
        }
        input:checked + .slider { background-color: #667eea; }
        input:checked + .slider:before { transform: translateX(22px); }
        .hotkey-input, .select-input {
          background: ${config.darkMode ? '#0a192f' : '#fff'};
          border: 1px solid ${config.darkMode ? '#233554' : '#ddd'};
          color: ${config.darkMode ? '#fff' : '#333'};
          padding: 6px 10px;
          border-radius: 5px;
          font-size: 13px;
          width: 150px;
          text-align: center;
          cursor: pointer;
        }
        .select-input {
          appearance: none;
          -webkit-appearance: none;
          padding-right: 25px;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%238892b0' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 8px center;
        }
        .btn {
          background: #667eea;
          color: white;
          border: none;
          padding: 8px 20px;
          border-radius: 5px;
          cursor: pointer;
          font-size: 14px;
          margin-top: 15px;
          transition: background 0.2s;
        }
        .btn:hover { background: #5a6fd6; }
        .btn-group { text-align: center; }
      </style>
    </head>
    <body>
      <div class="section">
        <div class="section-title">${currentLang.settingsGeneral}</div>
        <div class="setting-item">
          <span class="setting-label">${currentLang.settingAutoLaunch}</span>
          <label class="switch">
            <input type="checkbox" id="autoLaunch" ${config.autoLaunch ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>
        <div class="setting-item">
          <span class="setting-label">${currentLang.settingCloseToTray}</span>
          <label class="switch">
            <input type="checkbox" id="closeToTray" ${config.closeToTray ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>
        <div class="setting-item">
          <span class="setting-label">${currentLang.settingTopMost}</span>
          <label class="switch">
            <input type="checkbox" id="topMost" ${config.topMost ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>
      </div>

      <div class="section">
        <div class="section-title">${currentLang.settingsLanguage}</div>
        <div class="setting-item">
          <span class="setting-label">${currentLang.langChinese}</span>
          <label class="switch">
            <input type="radio" name="language" value="zh-CN" ${config.language === 'zh-CN' ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>
        <div class="setting-item">
          <span class="setting-label">${currentLang.langEnglish}</span>
          <label class="switch">
            <input type="radio" name="language" value="en-US" ${config.language === 'en-US' ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>
        <div class="setting-item">
          <span class="setting-label">${currentLang.langJapanese}</span>
          <label class="switch">
            <input type="radio" name="language" value="ja-JP" ${config.language === 'ja-JP' ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>
        <div class="setting-item">
          <span class="setting-label">${currentLang.langKorean}</span>
          <label class="switch">
            <input type="radio" name="language" value="ko-KR" ${config.language === 'ko-KR' ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>
      </div>

      <div class="section">
        <div class="section-title">${currentLang.settingsHotkey}</div>
        <div class="setting-item">
          <span class="setting-label">${currentLang.menuHotkey}</span>
          <input type="text" class="hotkey-input" id="hotkey" value="${config.hotkey}" readonly>
        </div>
      </div>

      <div class="section">
        <div class="section-title">${currentLang.settingsDshPath}</div>
        <div class="setting-item">
          <span class="setting-label">${currentLang.dshPathLabel}</span>
          <input type="text" class="hotkey-input" id="dshPath" value="${config.dshPath || ''}" placeholder="${currentLang.dshPathPlaceholder}">
        </div>
        <div class="setting-item">
          <span class="setting-label">DSH 安装状态</span>
          <div id="dshStatus" style="font-size: 12px; color: ${config.darkMode ? '#8892b0' : '#666'}; max-width: 200px; word-wrap: break-word;">
            ${showDshInstallationStatus().replace(/\n/g, '<br>')}
          </div>
        </div>
      </div>

      <div class="btn-group">
        <button class="btn" onclick="refreshDshStatus()">${currentLang.refreshStatus || '刷新状态'}</button>
        <button class="btn" onclick="saveSettings()">${currentLang.btnApply}</button>
      </div>

      <script>
        function saveSettings() {
          const newConfig = {
            autoLaunch: document.getElementById('autoLaunch').checked,
            closeToTray: document.getElementById('closeToTray').checked,
            topMost: document.getElementById('topMost').checked,
            darkMode: ${config.darkMode},
            hotkey: document.getElementById('hotkey').value,
            language: document.querySelector('input[name="language"]:checked')?.value || 'zh-CN',
            dshPath: document.getElementById('dshPath').value
          };
          
          const { ipcRenderer } = require('electron');
          ipcRenderer.send('save-settings', newConfig);
          window.close();
        }

        function refreshDshStatus() {
          const { ipcRenderer } = require('electron');
          ipcRenderer.send('refresh-dsh-status');
        }

        // 监听状态更新
        const { ipcRenderer } = require('electron');
        ipcRenderer.on('dsh-status-updated', (event, status) => {
          document.getElementById('dshStatus').innerHTML = status.replace(/\n/g, '<br>');
        });
      </script>
    </body>
    </html>
  `;

  settingsWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(settingsHtml));
}

// ============ 显示关于对话框 ============
function showAbout() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: currentLang.aboutTitle,
    message: currentLang.appName,
    detail: [
      currentLang.aboutVersion,
      currentLang.aboutDescription,
      '',
      currentLang.aboutAuthor,
      currentLang.aboutLicense
    ].join('\n')
  });
}

// ============ 注册全局快捷键 ============
function registerHotkeys() {
  globalShortcut.register(config.hotkey, () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : showWindow();
    }
  });
}

// ============ 处理 IPC 消息 ============
ipcMain.on('refresh-dsh-status', (event) => {
  const status = showDshInstallationStatus();
  event.reply('dsh-status-updated', status);
});

ipcMain.on('save-settings', (event, newConfig) => {
  const oldLanguage = config.language;
  config = { ...config, ...newConfig };
  saveConfig();

  // 应用置顶
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(config.topMost);
  }

  // 应用任务栏
  if (mainWindow) {
    mainWindow.setSkipTaskbar(!config.showInTaskbar);
  }

  // 更新菜单和托盘
  createMenu();
  updateTrayMenu();

  // 语言变更提示重启
  if (oldLanguage !== newConfig.language) {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'info',
      buttons: [currentLang.msgRestart, currentLang.msgLater],
      title: currentLang.settingsLanguage,
      message: currentLang.msgRestartRequired
    });

    if (choice === 0) {
      app.relaunch();
      app.exit(0);
    }
  }
});

// ============ 创建加载中窗口 ============
function createLoadingWindow() {
  const loadingWin = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  loadingWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"></head>
    <body style="margin:0;padding:0;display:flex;justify-content:center;align-items:center;height:100vh;background:transparent;">
      <div style="background:${config.darkMode ? '#1a1a2e' : '#fff'};border-radius:16px;padding:40px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.3);min-width:280px;">
        <div style="font-size:48px;margin-bottom:16px;">🤖</div>
        <div style="color:${config.darkMode ? '#fff' : '#333'};font-size:18px;font-weight:600;margin-bottom:8px;">DeepSeek Harness</div>
        <div style="color:${config.darkMode ? '#8892b0' : '#666'};font-size:13px;">正在启动服务，请稍候...</div>
        <div style="margin-top:20px;">
          <div style="width:40px;height:4px;background:${config.darkMode ? '#233554' : '#eee'};border-radius:2px;margin:0 auto;overflow:hidden;">
            <div style="width:100%;height:100%;background:#667eea;border-radius:2px;animation:load 1.2s ease-in-out infinite;"></div>
          </div>
        </div>
      </div>
      <style>@keyframes load{0%{transform:translateX(-100%)}50%{transform:translateX(0)}100%{transform:translateX(100%)}}</style>
    </body>
    </html>
  `)}`);

  return loadingWin;
}

// ============ DSH 安装状态检查 ============
function showDshInstallationStatus() {
  const status = detectDshInstallation();
  
  let message = 'DSH 安装状态检查：\n\n';
  
  if (status.hasLocalRepo) {
    message += `✅ 本地仓库：${status.localRepoPath}\n`;
  } else {
    message += '❌ 未找到本地仓库\n';
  }
  
  if (status.hasGlobalCli) {
    message += '✅ 全局 CLI 已安装\n';
  } else {
    message += '❌ 全局 CLI 未安装\n';
  }
  
  if (status.hasNpmPackage) {
    message += `✅ npm 全局包：${status.npmPackagePath}\n`;
  } else {
    message += '❌ npm 全局包未安装\n';
  }
  
  message += '\n可用启动方式：';
  
  if (status.hasLocalRepo) {
    message += '\n1. 从本地仓库启动（推荐）';
  }
  if (status.hasGlobalCli) {
    message += '\n2. 使用全局 DSH CLI';
  }
  if (status.hasNpmPackage) {
    message += '\n3. 使用 npm 全局包';
  }
  message += '\n4. 使用 npx 从 npm 安装';
  
  return message;
}

// ============ 应用就绪 ============
app.whenReady().then(async () => {
  loadConfig();
  app.setName(currentLang.appName);

  // 显示加载窗口
  const loadingWindow = createLoadingWindow();

  try {
    // 启动 DSH Web 服务（如果未运行）
    await startDshServer();
  } catch (err) {
    console.error('[DSH Desktop] 服务启动失败:', err.message);
    
    // 提供更详细的错误信息和解决方案
    const errorDetail = [
      'DSH Web 服务启动失败：',
      err.message,
      '',
      '可能的原因：',
      '1. DSH 仓库未找到 - 请设置环境变量 DSH_REPO_ROOT',
      '2. 未安装 Node.js 或 pnpm',
      '3. 网络问题（如果使用 npx 安装）',
      '',
      '解决方案：',
      '1. 设置环境变量 DSH_REPO_ROOT 指向 DSH 仓库路径',
      '2. 或将 DSH 仓库克隆到项目同级目录',
      '3. 或全局安装 DSH: npm install -g @deepseek-ai/dsh',
      '',
      '示例：',
      'set DSH_REPO_ROOT=C:\\path\\to\\deepseek-harness',
      '或',
      'npm install -g @deepseek-ai/dsh'
    ].join('\n');
    
    dialog.showErrorBox('启动失败', errorDetail);
    loadingWindow.close();
    app.quit();
    return;
  }

  // 服务就绪，关闭加载窗口，创建主窗口
  loadingWindow.close();
  createMainWindow();
  createTray();
  registerHotkeys();

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
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopDshServer();
});

// ============ 开发模式 ============
if (process.argv.includes('--dev')) {
  app.whenReady().then(() => {
    if (mainWindow) mainWindow.webContents.openDevTools();
  });
}
