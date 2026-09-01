# DSH Desktop 界面与集成修改（设计文档 + 执行流程）

> **v10 最终架构修订（优先级最高）**：插件集成改为直接使用 `web` profile 与 `127.0.0.1:3080`。程序不再创建 `dsh-desktop` profile，不复制/镜像 `web` 的清单、依赖或插件列表，也不安装/卸载桌面设置插件。若 3080 已有健康 DSH Web 服务则直接复用；未运行时以 `--profile web --no-open` 启动。这样 Web 当前 14 个及以后安装/卸载的插件均直接生效。桌面设置使用 Electron 原生设置窗口，普通浏览器页面不会出现桌面专属插件。所有与“专用 profile、3092、镜像、随启停安装插件、Portable”冲突的旧段落均由本修订取代。发布只生成可选目录、可取消、带桌面和开始菜单快捷方式及卸载入口的完整 Setup 安装包。

> 状态：**已定稿，可交新会话执行**（新会话先读 §8 打包门禁，再按 §9 执行指引 + 本文件 + `desktop-polish-checklist.md` 施工图实施）
> 目标项目：`D:\Work\Project\dsh-desktop`（已完成 P0–P4 基座，本文档在其上追加修改）
> 相关现状：已完成 WCO 标题栏（P1.2）、settings 插件（P2.4，手动 `dsh plugin add` 安装）、
> 图标流水线（P4.3）、64 单测全绿、打包产物 1.0.0 可运行。
> **范围决策（已确认）**：Windows 专用。mac 分支保持现状不动——项目实际为 Windows 专用，
> `build:mac` 引用不存在的 `assets/icon.icns`、从未构建验证过，本次修改不触碰 mac 相关代码。
> **Electron 版本**：35.7.5（支持 `WebContentsView`、`BaseWindow`、`backgroundMaterial: 'mica'|'acrylic'`）。

---

## 0. 当前状态确认（修改前基线）

| 项 | 状态 | 依据 |
|---|---|---|
| 菜单栏 | ✅ **已无** | `main/index.js` `Menu.setApplicationMenu(null)`（Windows/Linux，P2.5） |
| 传统标题栏 | ✅ **已隐藏** | `titleBarStyle:'hidden'`（WCO，P1.2） |
| 右上三键 | ⚠️ **系统原生 WCO 按钮** | 由 `titleBarOverlay` 提供，**非自绘**——修改 1 的目标 |
| 窗口滚动 | ❌ **存在垂直滚动条** | 注入 `body{padding-top:40px}` 使 `body.scrollHeight` 800→840（已 probe 复现）——修改 4 的目标 |
| 实例模型 | ⚠️ **单实例锁** | `app.requestSingleInstanceLock()` + `second-instance` 唤起（P1.4）——修改 5 的目标 |
| 托盘 | ⚠️ 单托盘（随实例） | `main/tray.js` 单个 Tray，随主窗口生命周期——修改 5 的目标 |
| 任务栏 | ⚠️ 单任务栏项（随窗口） | 单 BrowserWindow——修改 5 的目标 |
| UI 风格 | ⚠️ 自绘暗色主题（#1a1a2e 等） | 非 Win11 风格——修改 6 的目标 |

> 结论：当前「无菜单栏 + WCO 三键 + 页面可滚动 + 单实例 + 自定义暗色风格」。
> 本次修改后：「自绘 Win11 风格标题栏三键 + 无滚动 + 多实例页签（托盘/任务栏合并）+ Win11 风格配色」。

---

## 修改 1：自绘标题栏（不再用原生 WCO 三键）

### 现状
- `main/window.js#windowConfigFor`：win32 用 `titleBarStyle:'hidden' + titleBarOverlay`（WCO 原生三键）。
- `main/inject/titlebar.css`：注入 `body{padding-top:env(titlebar-area-height,40px)}` + 全宽拖拽区。

### 目标
- 去掉原生 WCO 三键，改为**程序自绘**三个按钮（最小化 / 最大化-还原 / 关闭）。
- **标题栏配色使用 DeepSeek Harness 品牌色**（与 DSH 页面一体，加强一体感；非 Win11 灰白）。
- **标题栏主题跟随 DSH 页面主题系统实时变换**：用户在 DSH 设置页切换主题（跟随系统/深/浅）时，标题栏同步切换。
- 范围：仅 Windows；mac 分支（`hiddenInset`）与 Linux 回退分支**保持不变**。

### DSH 主题令牌（以 DSH 源码和运行时为准）

> 纠错：`#1c00cf` 与 `#99c8ff` 来自 JSON Tree（JSON 树）语法高亮，**不是 DSH 品牌色**，不得用于标题栏、页签或桌面内嵌窗口。
> DSH 的真实视觉是蓝灰中性色 + DeepSeek 蓝；普通主按钮甚至使用近黑/近白的 `brand-primary`，蓝色仅用于信息、业务状态与强调。

| 桌面别名 | 直接引用的 DSH 令牌 | 深色解析值 | 浅色解析值 |
|---|---|---|---|
| `--dsh-bg` | `--dsw-alias-bg-base` | `#151517` | `#ffffff` |
| `--dsh-surface` | `--dsw-alias-bg-layer-1` | `#232324` | `#ffffff` |
| `--dsh-surface-muted` | `--dsw-alias-bg-module-platform` | `#353638` | `#f5f6f7` |
| `--dsh-border` | `--dsw-alias-border-l2` | `rgba(255,255,255,0.12)` | `rgba(0,0,0,0.10)` |
| `--dsh-text` | `--dsw-alias-label-primary` | `#f9fafb` | `#0f1115` |
| `--dsh-text-muted` | `--dsw-alias-label-tertiary` | `#adb2b8` | `#81858c` |
| `--dsh-accent` | `--dsw-alias-state-business-primary` | `#679efe` | `#4176e6` |
| `--dsh-hover` | `--dsw-alias-interactive-bg-hover` | `rgba(255,255,255,0.08)` | `rgba(38,49,72,0.06)` |
| `--dsh-selected` | `--dsw-alias-interactive-bg-active` | `rgba(255,255,255,0.14)` | `rgba(38,49,72,0.10)` |

来源：`packages/client/ui-theme/src/styles/design-platform.css`。注入到 DSH 页面的标题栏/页签必须优先直接引用 `--dsw-*`，`--dsh-*` 只作为桌面侧别名和加载失败时的回退值，避免复制色板后与上游主题漂移。

> 标题栏（背景/文字/按钮 hover/关闭键）一律取上表 **DSH 主题令牌**；
> 控件**形态**（圆角 4/8px、hover 动效、关闭键 hover 红 `#c42b1c`）仍遵循 Win11 规范（修改 6）。

### 主题跟随机制（以 DSH 自身主题为单一事实来源）
- **页面内标题栏**：直接引用 `--dsw-*`，DSH 切换“跟随系统/浅色/深色”时 CSS 变量会自动重算，不需要桌面端二次切色；
- **可靠信号**：`body[data-ds-dark-theme]` 是 DSH 主题 CSS 的正式选择器；`<html style="color-scheme:...">` 仅作辅助信号。`--dsh-title-bar-strip` 不存在于 DSH 上游源码，属于旧探针/注入环境变量，禁止依赖；
- **宿主层同步**：页签栏若由独立 `WebContentsView`/宿主页渲染，以及 Electron 原生背景色，需要从 DSH 页面读取 `getComputedStyle(document.body)` 的真实 `--dsw-*` 解析值后通过 IPC 上报，禁止在主进程硬编码另一套色板；
- **跟随链路**：
  ```
  DSH 主题系统更新 body[data-ds-dark-theme] 与 --dsw-* 变量
  ├─ 页面内标题栏：直接使用 var(--dsw-*)，浏览器自动同步
  └─ theme-observer：读取 color-scheme + --dsw-* 计算值 → IPC 上报
     → main 缓存当前 palette → 独立页签栏/原生窗口背景同步
  ```
- **兜底**：DSH 页面未加载/observer 未触发时，用 `nativeTheme.shouldUseDarkColors`（现有 P1.6 逻辑）初始化；
  observer 触发后以 DSH 实际主题为准（用户在 DSH 设置页切主题也会被捕获）。

### 设计
| 面 | 改动 |
|---|---|
| 窗口 | win32：`frame: false` 隐藏整个原生边框；`windowConfigFor` 删除 WCO overlay 分支（win32 分支返回 `{frame:false}`） |
| 按钮 | 标题栏右侧渲染 3 个按钮；图标使用 10×10 inline SVG（线/矩形/重叠矩形/叉），不使用字体方框；最大化状态切换 maximize/restore SVG；配色用 DSH 主题令牌 |
| IPC | 复用现有 `window-hide/show/minimize`；新增 `window-maximize-toggle`、`window-close`；`preload.js` 经 contextBridge 暴露 |
| 拖拽 | 标题栏空白区保留 `-webkit-app-region: drag`；按钮区 `-webkit-app-region: no-drag` |
| 主题 | 页面内标题栏直接跟随 DSH `--dsw-*`；`nativeTheme` 仅在 DSH 尚未加载时作为启动兜底 |
| 平台适配 | 仅 main 进程在 win32 调用注入器；渲染脚本不读取 `process.platform`（sandbox/contextIsolation 下不可依赖 process） |

### 关键代码骨架（新会话可直接使用）

**`main/window.js#windowConfigFor` win32 分支改为：**
```js
if (platform === 'win32') {
  return { frame: false }; // 无原生边框，标题栏与三键全部自绘（修改 1）
}
```

**`main/index.js` 新增 IPC（复用现有 `handleWindowClose`）：**
```js
ipcMain.on('window-maximize-toggle', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close(); // 走 closeToTray 语义（handleWindowClose）
});
// 发送目标抽象化：M1 为 BrowserWindow.webContents，M4 改为 titlebarView.webContents。
const sendMaximizedState = (value) => getTitlebarWebContents()?.send('window-maximized-changed', value);
mainWindow.on('maximize', () => sendMaximizedState(true));
mainWindow.on('unmaximize', () => sendMaximizedState(false));
```

**`preload.js` 新增：**
```js
maximizeToggle: () => ipcRenderer.send('window-maximize-toggle'),
closeWindow: () => ipcRenderer.send('window-close'),
onMaximizedChanged: (cb) => { ipcRenderer.on('window-maximized-changed', (_e, v) => cb(v)); },
```

**`main/inject/titlebar.js`（新增，注入三键 DOM）：**
```js
(() => {
  const bar = document.getElementById('dsh-titlebar');
  if (!bar || document.getElementById('dsh-win-buttons')) return;
  const btns = document.createElement('div');
  btns.id = 'dsh-win-buttons';
  btns.innerHTML = `
    <button class="dsh-win-btn" data-action="minimize" aria-label="最小化"><svg viewBox="0 0 10 10"><path d="M1 5.5h8"/></svg></button>
    <button class="dsh-win-btn" data-action="maximize" aria-label="最大化"><svg viewBox="0 0 10 10"><rect x="1.5" y="1.5" width="7" height="7"/></svg></button>
    <button class="dsh-win-btn dsh-win-btn-close" data-action="close" aria-label="关闭"><svg viewBox="0 0 10 10"><path d="M1.5 1.5l7 7m0-7l-7 7"/></svg></button>`;
  btns.addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.action;
    if (!act) return;
    if (act === 'minimize') window.dshDesktop.minimize();
    else if (act === 'maximize') window.dshDesktop.maximizeToggle();
    else if (act === 'close') window.dshDesktop.closeWindow();
  });
  bar.appendChild(btns);
  window.dshDesktop.onMaximizedChanged?.((maximized) => {
    const btn = btns.querySelector('[data-action="maximize"]');
    if (btn) {
      btn.setAttribute('aria-label', maximized ? '还原' : '最大化');
      btn.innerHTML = maximized
        ? '<svg viewBox="0 0 10 10"><path d="M3 1.5h5.5V7M1.5 3H7v5.5H1.5z"/></svg>'
        : '<svg viewBox="0 0 10 10"><rect x="1.5" y="1.5" width="7" height="7"/></svg>';
    }
  });
})();
```

**`main/inject/titlebar.css`（标题栏覆盖层 + 三键，DSH 品牌色）：**
```css
html, body { height: 100%; }
body { padding-top: 0 !important; }
#root {
  height: 100%; box-sizing: border-box; padding-top: 40px;
  /* 仅在根容器内部预留标题栏，不增加 body 总高度；实施 probe 验证。 */
}
#dsh-titlebar {
  position: fixed; top: 0; left: 0; right: 0; height: 40px;
  -webkit-app-region: drag; z-index: 2147483000;
  background: var(--dsw-alias-bg-base, #151517); /* 直接跟随 DSH 主题 */
  display: flex; align-items: center; justify-content: flex-end;
  border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.12));
}
#dsh-win-buttons { display: flex; -webkit-app-region: no-drag; }
.dsh-win-btn {
  width: 46px; height: 40px; border: none; border-radius: 4px; /* Win11 圆角 */
  background: transparent; color: var(--dsw-alias-label-tertiary, #adb2b8);
  font-size: 12px; cursor: default;
}
.dsh-win-btn svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1; }
.dsh-win-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.08)); color: var(--dsw-alias-label-primary, #f9fafb); }
.dsh-win-btn-close:hover { background: #c42b1c; color: #fff; } /* Win11 关闭键规范 */
```

**`main/inject/theme-observer.js`（新增，跟随 DSH 主题系统）：**
```js
(() => {
  if (window.__dshThemeObserver) return;
  window.__dshThemeObserver = true;
  const report = () => {
    const style = getComputedStyle(document.body);
    const theme = document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light';
    const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
    window.dshDesktop?.reportTheme?.({
      theme,
      palette: {
        bg: read('--dsw-alias-bg-base', theme === 'dark' ? '#151517' : '#ffffff'),
        surface: read('--dsw-alias-bg-layer-1', theme === 'dark' ? '#232324' : '#ffffff'),
        border: read('--dsw-alias-border-l2', theme === 'dark' ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.1)'),
        text: read('--dsw-alias-label-primary', theme === 'dark' ? '#f9fafb' : '#0f1115'),
        textMuted: read('--dsw-alias-label-tertiary', theme === 'dark' ? '#adb2b8' : '#81858c'),
        accent: read('--dsw-alias-state-business-primary', theme === 'dark' ? '#679efe' : '#4176e6'),
        hover: read('--dsw-alias-interactive-bg-hover', theme === 'dark' ? 'rgba(255,255,255,.08)' : 'rgba(38,49,72,.06)')
      }
    });
  };
  // 正式信号：body[data-ds-dark-theme]；html style 作为 color-scheme 辅助信号。
  new MutationObserver(report).observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'class', 'style'] });
  new MutationObserver(report).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
  report(); // 初始上报
})();
```

**`main/index.js` 新增 IPC（接收 DSH 主题上报）：**
```js
ipcMain.on('theme-report', (_e, report) => {
  if (!report || !['dark', 'light'].includes(report.theme)) return;
  const palette = sanitizeThemePalette(report.palette); // 仅允许白名单字段与合法 CSS 色值
  logger.log?.(`DSH 主题跟随: ${report.theme}`);
  applyDshThemeToHost({ theme: report.theme, palette }); // 独立页签栏/原生背景
});
```

**`main/index.js` 主题应用辅助：**
```js
function applyDshThemeToHost({ theme, palette }) {
  currentDshTheme = { theme, palette };
  titlebarView?.webContents.send('dsh-theme-changed', currentDshTheme);
  tabbarView?.webContents.send('dsh-theme-changed', currentDshTheme);
  mainWindow?.setBackgroundColor?.(palette.bg);
}
```

**`preload.js` 新增：** `reportTheme: (report) => ipcRenderer.send('theme-report', report)`。主进程必须对白名单字段和 CSS 色值做校验，不直接拼接不可信字符串。

**`main/inject/index.js`：** `applyInjections` 注入顺序：`win11.css`（令牌）→ `titlebar.css` → `titlebar.js` → `theme-observer.js`（全部仅 win32 + 同源白名单）。

### 执行流程
1. `main/window.js`：`windowConfigFor` win32 分支返回 `{ frame:false }`；
2. `preload.js`：新增 `maximizeToggle()` / `closeWindow()` / `onMaximizedChanged` / `reportTheme`；
3. `main/index.js`：新增 IPC（三键两个 + theme-report）+ maximize/unmaximize 事件回传；
4. `main/inject/titlebar.css`：删除 `body{padding-top}`，标题栏改覆盖层 + 三键样式（DSH 品牌色）；
5. `main/inject/titlebar.js`（新增）：渲染三键 + 绑定 + 符号切换；
6. `main/inject/theme-observer.js`（新增）：MutationObserver 跟随 DSH 主题；
7. `main/inject/index.js`：`applyInjections` 注入 titlebar.js + theme-observer.js（仅 win32 + 同源）；
8. 单测：`tests/window.spec.mjs` 更新 `windowConfigFor('win32')` 断言为 `{frame:false}`。

---

## 修改 2：settings 插件随程序安装 / 关闭时卸载或禁用

### 现状
- 插件 `dsh-settings-plugin/` 需手动 `dsh plugin --profile <name> add` 安装，是**持久化**的；
- 壳启动只做「检测 + 提示」（X10），不自动安装；
- 本机 DSH 后端运行在 `web` profile（:3080），壳默认 profile 为空（=default）——**两者当前不一致**。

### 目标
- 插件构建产物随桌面程序一起打包，桌面壳启动时自动挂载到**桌面专用 profile**；
- 壳退出时停止桌面专用 DSH 后端并卸载插件（卸载失败时至少通过停止专用后端完成禁用）；
- 浏览器继续访问原 `web:3080`，桌面壳绝不修改或复用该 profile，因此浏览器始终不出现桌面分区。

### 方案决策（已确认：方案 A）
| 方案 | 做法 | 效果 | 代价 |
|---|---|---|---|
| **A. 桌面专用 profile 随壳启停（选定、修订）** | 壳启动：将随包插件挂载到 `dsh-desktop` profile，再启动专用后端；退出：先停止后端，再 remove | 浏览器 `web:3080` 从未被修改，始终干净 | 多占用一个本地 DSH 端口；启动增加数秒 |
| B. 插件自感知桥 | 插件常驻；无桥时显示占位 | 浏览器仍见「桌面版」导航项 | 不满足「关闭时卸载」，弃用 |

### 关键约束与兜底体验
- **隔离是硬约束**：桌面专用 profile 固定为 `dsh-desktop`（允许配置别名，但禁止设为 `web`/`default`）；桌面后端使用独立可用端口，禁止复用 3080；
- **启动顺序**：先构建/定位插件 → ensureInstalled → 启动桌面专用 DSH 后端 → 创建页面；否则 Boot 图不会包含新插件；
- **Web profile 初始化**：新 profile 默认只有 `@deepseek-ai/dsh-base`，必须先幂等添加与当前 DSH CLI 同源/同版本的 `@deepseek-ai/dsh-web-app`，再添加 `dsh-desktop-settings`；不得复制用户 `web` profile 的第三方插件列表。首次实现先用独立 probe profile 验证 `/plugins/dsh-desktop-settings/client.js`、`__DSH_BOOT__` 和设置分区，再接入正式生命周期；
- **浏览器无影响**：浏览器继续使用 `web:3080`。即使壳崩溃导致 remove 未执行，残留也只在 `dsh-desktop` profile，浏览器仍不受影响；下次启动先 remove→add 自愈；
- **随包资源**：开发态插件路径为仓库 `dsh-settings-plugin`；打包态必须从 `process.resourcesPath/dsh-settings-plugin` 读取。插件 payload 放在 app.asar 外，至少包含 `package.json`、`cordis.patch.yml`、`lib/**`，不得运行时依赖源码或 `node_modules`；
- **幂等**：`ensureInstalled` = 先 `remove`（忽略不存在）再 `add`。
- **失败降级**：安装失败仅日志 + 通知（不阻断启动）；卸载失败仅日志。
- **多页签联动（修改 5）**：整个单进程只执行一次 ensure/uninstall，新增或关闭页签不触发插件生命周期。

### 关键代码骨架

**`main/plugin-lifecycle.js`（新增）：**
```js
const path = require('path');
const os = require('os');

/** 组装 dsh plugin CLI 命令（argv 数组，不拼 shell，§16.5） */
function buildPluginCommand(facts, args) {
  // facts 来自 dsh-server.detectFacts()：{repoPaths, hasGlobalCli, npmGlobalPath, hasSystemNode}
  const profile = args.profile; // 固定取 integration.desktopProfile，默认 'dsh-desktop'
  const pluginArgs = ['plugin', '--profile', profile, ...args.actionArgs];
  if (facts.repoPaths.length > 0) {
    return { cmd: 'pnpm', args: ['dsh', ...pluginArgs], cwd: facts.repoPaths[0] };
  }
  if (facts.hasGlobalCli) return { cmd: 'dsh', args: pluginArgs, cwd: null };
  return { cmd: 'npx', args: ['@deepseek-ai/dsh', ...pluginArgs], cwd: null }; // npm-global/npx 均走 npx
}

async function ensureInstalled(deps) {
  const { getLaunchFacts, getDshConfig, execFileP, logger } = deps;
  const profile = getConfig().integration.desktopProfile || 'dsh-desktop';
  const pluginDir = resolvePluginPayloadPath({ app, isPackaged: app.isPackaged });
  try {
    // bootstrapWebProfile() 先确保 @deepseek-ai/dsh-web-app 与当前 CLI 同源/同版本；
    // 再 remove（幂等，忽略失败）→ add 桌面插件。
    await runPluginCmd(deps, ['remove', 'dsh-desktop-settings']);
    await runPluginCmd(deps, ['add', pluginDir]);
    logger.log?.(`settings 插件已安装到 profile ${profile}`);
    return true;
  } catch (e) {
    logger.logError?.(`插件安装失败: ${e.message}`);
    return false; // 不阻断启动
  }
}
async function uninstall(deps) {
  try { await runPluginCmd(deps, ['remove', 'dsh-desktop-settings']); } catch (e) { /* 仅日志 */ }
}
```

**`main/config.js` schema 增加：** `integration: { autoInstallPlugin: true, desktopProfile: 'dsh-desktop', dedicatedBackend: true }`。校验器拒绝 `desktopProfile` 为 `web` 或 `default`。

**`main/index.js` 接入：**
- 后端启动前：`if (integration.autoInstallPlugin) await ensureInstalled()`，然后以 `desktopProfile` + 独立端口启动 DSH；禁止走“3080 已运行则复用”的路径；
- 使用 `before-quit` 做可等待清理：首次事件 `preventDefault()` → 关闭所有 WebContentsView → `await dshServer.stop()` → `await uninstall()` → 设置 `cleanupDone=true` → `app.quit()`；后续事件放行；
- `will-quit` 只做同步兜底（快捷键/托盘释放），不承担异步卸载；Windows `session-end`/SIGTERM 只做尽力停止，崩溃残留由隔离 profile + 下次 ensure 自愈。

```js
let cleanupStarted = false;
let cleanupDone = false;
app.on('before-quit', (event) => {
  if (cleanupDone) return;
  event.preventDefault();
  if (cleanupStarted) return;
  cleanupStarted = true;
  void (async () => {
    await destroyAllTabViews();
    await dshServer.stop();
    await uninstall(pluginDeps);
    cleanupDone = true;
    app.quit();
  })();
});
```

### 执行流程
1. 新建 `main/plugin-lifecycle.js`（含 `resolvePluginPayloadPath`/`buildPluginCommand`/`ensureInstalled`/`uninstall`）；
2. `main/config.js` 加 `integration` 配置和 profile 禁用值校验；
3. `main/index.js` 按“安装插件→启动专用后端→创建页面”的顺序接入，并实现可等待退出清理；
4. M5 打包公共逻辑复制已构建插件 payload 到 `resources/dsh-settings-plugin`；
5. `tests/plugin-lifecycle.spec.mjs`：覆盖开发/打包路径、三路 argv、remove→add、禁用 profile、退出清理只执行一次。

---

## 修改 3：图标统一（exe / 任务栏 / 托盘）+ 使用用户图片

### 现状
- 图标来自 `assets/favicon-dsh.svg` 渲染（P4.3 流水线）；`window.js`/`tray.js` 用 `assets/icon-256.png`；
- exe 图标 = `assets/app.ico`（旧流水线产物）；任务栏 = 窗口 icon；托盘 = 16px 缩放。

### 目标
- 统一使用 `C:\Users\19163\Downloads\Q2_docs_抱书.png`（1024×1024）作为唯一源图；
- 复制到 `assets/` 并改名，生成 exe（.ico）、任务栏（窗口 icon）、托盘（16/32px）全部一致。

### 设计
| 面 | 改动 |
|---|---|
| 源图 | 复制 `Q2_docs_抱书.png` → `assets/icon-source.png`（git 跟踪） |
| 流水线 | 新增 `scripts/make-icons.mjs`：Electron `nativeImage.resize()` 缩放 7 尺寸 → `pack-ico.mjs` 合成 `app.ico`；无需创建窗口/capturePage |
| 引用 | `window.js`/`tray.js` → 新生成图标；`package.json#build.win.icon` → `assets/app.ico`；NSI `MUI_ICON` → `assets/app.ico` |
| 清理 | `render-icon.mjs` 换源为 `icon-source.png`；`favicon-dsh.svg` 保留不删 |

### 关键代码骨架

**`scripts/make-icons.mjs`（新增，使用 nativeImage）：**
```js
import { app, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'assets/icon-source.png';
const SIZES = [512, 256, 128, 64, 48, 32, 16];
// 用 nativeImage 读源图 → resize → toPNG（无需 capturePage，nativeImage 即可缩放）
app.whenReady().then(async () => {
  const img = nativeImage.createFromPath(path.join(process.cwd(), SRC));
  if (img.isEmpty()) { console.error('源图读取失败'); app.exit(1); return; }
  for (const s of SIZES) {
    const resized = img.resize({ width: s, height: s, quality: 'best' });
    fs.writeFileSync(path.join(process.cwd(), `assets/icon-${s}.png`), resized.toPNG());
  }
  app.exit(0);
});
```
> 注：`nativeImage.resize` 即可缩放 PNG，**无需 BrowserWindow/capturePage**——比 render-icon 更简单。ICO 合成沿用 `scripts/pack-ico.mjs`。

### 执行流程
1. 复制源图 → `assets/icon-source.png`；
2. 写 `scripts/make-icons.mjs`（nativeImage 缩放，如上）；
3. 更新 `window.js`/`tray.js`/`package.json`/NSI 图标引用；`render-icon.mjs` 换源或弃用；
4. `npm run icons`（package.json 增加 `"icons": "electron scripts/make-icons.mjs && node scripts/pack-ico.mjs"`）；
5. 在 §8 阶段 A 的 Preview 中人工核对 exe/任务栏/托盘三处图标；用户确认后才在阶段 B 验证 Setup 图标。

---

## 修改 4：修复窗口大小与滚动

### 现状（已 probe 复现）
- 注入 `body{padding-top:env(titlebar-area-height,40px)}` 后：`body.scrollHeight` 800→**840**，`scrollableY:true`。

### 目标
- 窗口内容高度 = 窗口高度，**无垂直滚动条**；窗口大小记忆/最小尺寸正常。

### 设计
| 方案 | 做法 | 说明 |
|---|---|---|
| **A. 根容器内缩（主方案）** | 自绘标题栏 `position:fixed`；移除 `body{padding-top}`；对实测的 `#root` 使用 `height:100%; box-sizing:border-box; padding-top:40px` | body 不增高，DSH 内容也不会被标题栏遮住；实施时 probe 验证 |
| B. 兜底 | 若 `#root` 结构变化，probe 定位真实根容器并对该容器应用同样的 `box-sizing/height/padding` 适配 | 禁止用全局 `overflow:hidden` 掩盖布局错误 |

### 执行流程
1. `titlebar.css` 删除 `body{padding-top}`，禁止只覆盖不预留内容空间；
2. 标题栏改 fixed 覆盖层 + 三键；对 `#root` 做 40px 内部预留（`box-sizing:border-box`），若上游 DOM 变化则 probe 查找实际根容器后再改，不使用全局 `overflow:hidden` 掩盖问题；
3. probe 复测：`bodyScrollHeight == innerHeight`、`scrollableY:false`，并截图确认顶部导航/按钮没有被遮挡；
4. 冒烟：最大化/还原/拖动无滚动；DSH 内部滚动容器仍可滚。

---

## 修改 5：单进程多页签实例（顶部 / 左右两侧可配）+ 托盘/任务栏合并

### 现状
- 单实例锁（P1.4）；单 BrowserWindow；单托盘随窗口；任务栏单窗口项。

### 目标
- **允许多个 DSH 页面实例**，但保持**一个 Electron 主进程 + 一个主窗口**；页面实例以页签组织，位置可配置：**顶部 / 左侧 / 右侧**；
- **托盘合并**：单一托盘图标，菜单管理所有实例（列表/切换/新建/关闭）；
- **任务栏合并**：多实例共用一个任务栏项。

### 技术方案（Electron 35 API 已确认）
| 架构面 | 方案 |
|---|---|
| 承载窗口 | **`BaseWindow`（无边框）+ 多个 `WebContentsView`**：每实例一个 view（loadURL DSH）；`baseWin.contentView.addChildView(view)` |
| 宿主 Chrome | 新增两个本地 `WebContentsView`：固定顶部 `titlebarView`（三键/拖拽）+ 可布局的 `tabbarView`（页签）。View 是矩形，必须拆开，不能用一个大 View 覆盖内容区 |
| 页签栏 | 两个宿主 View 加载 `main/chrome/` 下的本地 HTML/CSS/JS；`tabbarView` 位置由 `window.tabPosition` 驱动；内容 view 的 bounds 同时避开标题栏和页签栏 |
| 实例管理 | 新增 `main/tabs.js`：`createTab/closeTab/activateTab/getTabs` + 事件 |
| 配置 | 新增 `window.tabPosition: 'top'\|'left'\|'right'`（默认 top）；设置页「外观」可配 |
| 单实例锁 | **保留** `requestSingleInstanceLock`；第二次启动由主进程收到 `second-instance` 并新建页签。移除锁后不会触发该事件，严禁移除 |
| 托盘 | 常驻单托盘；菜单 = 实例列表（勾选当前）+ 新建实例 + 全部退出 |
| 任务栏 | BaseWindow 单窗口多视图 → 任务栏天然单一项 |
| 关闭语义 | 页签关闭钮只关闭目标页签；右上窗口关闭钮遵循 `closeToTray` 隐藏整个主窗口，不等同于关当前页签；托盘“全部退出”才触发插件/后端清理 |

### 关键代码骨架（Electron 35 已验证 API）

**`main/window.js` 多视图承载（核心结构）：**
```js
const { BaseWindow, WebContentsView } = require('electron');
// 主窗口：无边框 BaseWindow
const base = new BaseWindow({
  width: 1200, height: 800, minWidth: 800, minHeight: 600,
  frame: false, show: false,
  ...(isWin11() ? { backgroundMaterial: 'mica' } : {}), // 修改 6
});
// 两个矩形宿主 View：标题栏固定顶部，页签栏可放 top/left/right。
const titlebarView = new WebContentsView({
  webPreferences: { preload: chromePreload, nodeIntegration: false, contextIsolation: true, sandbox: true },
});
const tabbarView = new WebContentsView({
  webPreferences: { preload: chromePreload, nodeIntegration: false, contextIsolation: true, sandbox: true },
});
base.contentView.addChildView(titlebarView);
base.contentView.addChildView(tabbarView);
const view = new WebContentsView({
  webPreferences: { preload: contentPreload, nodeIntegration: false, contextIsolation: true, sandbox: true },
});
base.contentView.addChildView(view);
// 布局：顶部页签时内容区在标题栏之下；左/右页签时侧边留白
function layoutViews(base, titlebarView, tabbarView, contentViews, tabPosition) {
  const { width: w, height: h } = base.getContentBounds();
  const titleH = 40, topTabH = 36, sideTabW = 220;
  titlebarView.setBounds({ x: 0, y: 0, width: w, height: titleH });
  let tabBounds, contentBounds;
  if (tabPosition === 'left') {
    tabBounds = { x: 0, y: titleH, width: sideTabW, height: Math.max(0, h - titleH) };
    contentBounds = { x: sideTabW, y: titleH, width: Math.max(0, w - sideTabW), height: Math.max(0, h - titleH) };
  } else if (tabPosition === 'right') {
    tabBounds = { x: Math.max(0, w - sideTabW), y: titleH, width: sideTabW, height: Math.max(0, h - titleH) };
    contentBounds = { x: 0, y: titleH, width: Math.max(0, w - sideTabW), height: Math.max(0, h - titleH) };
  } else {
    tabBounds = { x: 0, y: titleH, width: w, height: topTabH };
    contentBounds = { x: 0, y: titleH + topTabH, width: w, height: Math.max(0, h - titleH - topTabH) };
  }
  tabbarView.setBounds(tabBounds);
  for (const item of contentViews) item.view.setBounds(contentBounds);
}
view.webContents.loadURL(dshUrl);
```

**`main/tabs.js`（新增，页签状态机）：**
```js
// tabs: [{id, view, title, favicon}]；activeTabId
function createTab({ loadUrl }) { /* new WebContentsView + addChildView + 布局 */ }
function closeTab(id) { /* removeChildView + destroy */ }
function activateTab(id) { /* setVisible(true/false) + 布局重算 + 通知页签栏 */ }
```

**`main/chrome/tabbar.js`（新增，宿主 Chrome 渲染页签栏）：**
```js
// data-position="top|left|right" 控制布局；点击页签 → window.dshDesktop.tabActivate(id)
// "+" 按钮 → tabCreate；每页签关闭钮 → tabClose(id)
// 标题取 view.webContents.getTitle()；favicon 用统一图标
```

**`main/config.js`：** `window: { ..., tabPosition: 'top' }`

**`main/chrome/preload.js` 新增：** `tabCreate/tabClose/tabActivate/tabSetPosition` 和窗口三键 API → IPC。现有内容页 `preload.js` 只保留桥、主题上报和必要内容能力，遵循最小权限。

**`main/index.js`：**
- 保留 `app.requestSingleInstanceLock()`；未获锁的第二进程立即退出；
- 主进程 `app.on('second-instance')` → `tabs.createTab()` + 显示/聚焦主窗口；
- IPC：`tab-create`/`tab-close`/`tab-activate`/`tab-set-position`；
- 托盘改为常驻：菜单重建 = 实例列表（radio 勾选当前）+ 新建实例 + 全部退出。
- 全量审计并替换 BrowserWindow 专属调用：`mainWindow.webContents`、`mainWindow.loadURL`、`BrowserWindow.fromWebContents`、DevTools/Reload 路由都必须改为 `titlebarView`/`tabbarView` 或 `tabs.getActiveView()`；主题上报 IPC 必须验证 `event.sender` 属于已登记内容 view。

### 执行流程
1. `main/window.js`：主窗口改 BaseWindow + WebContentsView 数组；保留状态记忆/越界回退；
2. 新建 `main/tabs.js`；`main/index.js` 装配；
3. `main/config.js` 加 `window.tabPosition`；
4. 新建 `main/chrome/index.html` + `preload.js` + `titlebar.js/css` + `tabbar.js/css`，宿主 Chrome 独立渲染三键和三种页签布局；M1 的 DSH 页面内标题栏迁移到此处后移除，避免双标题栏；
5. `main/tray.js` 改常驻单托盘 + 实例列表；
6. `main/index.js` 保留单实例锁、second-instance→新建页签、IPC 装配；
7. `preload.js` 暴露页签操作；
8. `tests/tabs.spec.mjs` + `tests/window.spec.mjs` 更新；
9. 冒烟：开 2–3 实例，切/新/关页签，托盘列表，任务栏单一项。

---

## 修改 6：UI 风格贴近 Win11（控件形态 + 材质）+ DSH 品牌配色（一体感）

### 现状
- 自绘标题栏/内嵌窗口用自定义暗色（#1a1a2e/#16213e/#667eea 等），非 Win11 风格、也非 DSH 品牌色。

### 目标
- **控件形态**（圆角、hover 动效、关闭键 hover 红、Mica/Acrylic 材质）贴近 Windows 11；
- **配色**优先使用 **DSH 品牌色板**（修改 1 已定义 `--dsh-*` 令牌）——标题栏、页签栏、内嵌窗口与 DSH 页面一体；
- 亮/暗两套由 `theme.mode` + `nativeTheme` 驱动（复用 P1.6）。

### 配色与形态原则（重要）
1. **颜色**：一律用修改 1 的 `--dsh-*` 品牌色板（深/浅两套），**不引入 Win11 灰白令牌作为主色**；
2. **形态**：圆角 4px（按钮）/8px（卡片/页签/对话框）、hover 半透明背景、关闭键 hover `#c42b1c`——遵循 Win11 规范；
3. **材质**：主窗口 `backgroundMaterial:'mica'`（Win11 专属，`isWin11()` 检测，Win10 回退纯色 `--dsh-bg`）；
4. 内嵌窗口（API Key 引导/设置 fallback/加载窗）同样用 `--dsh-*` 令牌 + Win11 圆角。

### 关键代码骨架

**`main/inject/win11.css`（新增，DSH 原生令牌映射 + 圆角工具类）：**
```css
body {
  --dsh-bg:var(--dsw-alias-bg-base, #fff);
  --dsh-surface:var(--dsw-alias-bg-layer-1, #fff);
  --dsh-border:var(--dsw-alias-border-l2, rgba(0,0,0,.1));
  --dsh-text:var(--dsw-alias-label-primary, #0f1115);
  --dsh-text-muted:var(--dsw-alias-label-tertiary, #81858c);
  --dsh-accent:var(--dsw-alias-state-business-primary, #4176e6);
  --dsh-hover:var(--dsw-alias-interactive-bg-hover, rgba(38,49,72,.06));
  --dsh-selected:var(--dsw-alias-interactive-bg-active, rgba(38,49,72,.1));
}
/* Win11 圆角规范 */
.dsh-radius-btn { border-radius: 4px; }
.dsh-radius-card { border-radius: 8px; }
```

**`main/window.js` Win11 检测 + 材质：**
```js
function isWin11() {
  const v = (process.getSystemVersion && process.getSystemVersion()) || '';
  const match = /^10\.0\.(\d+)/.exec(v);
  return !!match && Number(match[1]) >= 22000;
}
// BaseWindow 加 backgroundMaterial:'mica'（仅 isWin11()）；材质不可见/不支持时回退 DSH 实色，不作为失败。
```

**`main/index.js` 内嵌窗口：** API Key/设置/加载 HTML 的 `<style>` 换 `--dsh-*` 令牌 + `data-theme` 驱动。

### 执行流程
1. 新建 `main/inject/win11.css`（把 `--dsh-*` 映射到 DSH 原生 `--dsw-*` + 回退值 + 圆角类）；
2. `titlebar.css`/`tabbar.css` 引用令牌；
3. `main/window.js`：`chromeColorsFor` 改 DSH 品牌色；`backgroundMaterial`（isWin11 判断）；
4. `main/index.js`：内嵌窗 HTML 换令牌 + 圆角；`data-theme` 驱动；
5. probe/冒烟：亮/暗截图核对（人工）。

---

## §7 验收标准

| 修改 | 验收 |
|---|---|
| 1 | 无原生标题栏；自绘三键可用（最小化/最大化还原/关闭）；最大化符号切换；拖拽正常；**标题栏配色为 DSH 品牌色（深 #151517/浅 #ffffff），且跟随 DSH 设置页主题切换实时变换（theme-observer）** |
| 2 | 桌面专用 profile/独立端口的 Boot 图含插件；壳退出先停后端再卸载；浏览器 `web:3080` 在壳运行前、运行中、退出后均无桌面分区 |
| 3 | exe/任务栏/托盘图标均为「抱书」图；`assets/icon-source.png` 入库；打包产物图标一致 |
| 4 | 注入后无垂直滚动条；DSH 内部滚动不受影响；窗口尺寸记忆/最小尺寸正常 |
| 5 | 单进程可开多个页面实例；第二次启动进入已有窗口新页签；top/left/right 生效；始终只有一个托盘图标、一个任务栏项和一个主窗口 |
| 6 | 配色直接使用 DSH `--dsw-*` 主题令牌（无紫色硬编码，亮/暗随 DSH 自动变化）；控件形态（SVG 三键、圆角 4/8px、hover、关闭键红）符合 Win11；Mica 支持时启用，不可见/不支持时回退 DSH 实色 |
| 全量 | `npm test` 全绿；先生成 Preview 验证版并由用户确认；确认后才生成 Setup 安装包；最终产物可启动且哈希清单一致 |

---

## §8 两阶段打包与用户确认门禁（强制）

### 目标

实施完成后不得直接生成最终安装包。必须先删除旧输出、生成可运行的 Preview（预览验证版），由用户确认功能和外观；只有收到用户明确的“确认，可以生成安装包”后，才允许生成 Setup。

### 阶段 A：清理旧输出并生成 Preview

1. 运行测试和语法检查，全部通过后彻底结束所有**可执行路径位于本项目 `dist` 内**的旧版验证进程树（主进程及其 Electron 子进程），并复查确认数量为 0；不得结束 `D:\Tools\dsh-v1`、3080 DSH 后端或其他安装位置的进程；
2. 解析并验证目标：只允许删除绝对路径 `D:\Work\Project\dsh-desktop\dist`，递归删除前必须确认解析结果仍位于项目根内；
3. **彻底删除整个旧 `dist` 目录**，包括旧 Setup、Portable、解压目录、manifest 和临时文件；删除后必须验证 `Test-Path <dist>` 为 false，再重新创建空 `dist` 供 Preview 构建。若文件锁定、删除失败或发现任何残留，立即停止打包，不允许覆盖式继续；
4. 这些功能属于向后兼容的新功能，执行前将 `package.json` 从 `1.0.0` 升到 `1.1.0`（SemVer minor）；若执行时基线已变化，则在实际版本上递增 minor，不得回退；
5. 新增/使用 `scripts/build-preview.ps1`，只生成：
   - `dist/DeepSeek Harness-win32-x64/`（解压运行目录）；
   - `dist/DeepSeek Harness-Portable-<version>.exe`（便携验证版）；
   - `dist/preview-manifest.json`（版本、构建时间、主文件及 `resources/dsh-settings-plugin/**` 全部文件的相对路径、大小和 SHA-256）；
6. **阶段 A 严禁生成** `DeepSeek Harness-<version>-Setup.exe`；若发现旧 Setup 残留，视为清理失败并停止交付；
7. 更新 `README.md` 并新增 `docs/user-guide.md`，说明页签、托盘、主题、专用 profile、插件启停、Preview 验证和安装；设置插件桌面分区提供“使用帮助”入口；
8. 启动解压运行目录或 Portable，完成自动冒烟后保持产物供用户人工确认。

建议命令：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-preview.ps1
```

### 用户确认内容

- 自绘标题栏三键、拖拽、最大化/还原和窗口尺寸；
- DSH 深色/浅色/跟随系统时标题栏和页签同步，无紫色误配；
- top/left/right 页签、多实例切换、托盘单图标、任务栏单项；
- 抱书图在主 exe、任务栏和托盘中一致；
- 插件随壳启停，退出后浏览器访问 DSH 不受影响；
- 无额外页面滚动条，DSH 内部滚动正常。

### 阶段 B：用户确认后生成 Setup

1. 必须收到用户本轮明确确认，不能用“测试通过”替代用户确认；
2. 执行 `scripts/build-installer.ps1 -FromValidatedPreview`；
3. 脚本读取 `preview-manifest.json`，重新计算已确认 Preview 的全部受管文件（包括插件 payload）哈希；任一文件新增、缺失或变化立即失败，禁止自动重打 Preview；
4. 只编译 `installer.nsi`，新增 `dist/DeepSeek Harness-<version>-Setup.exe`，不得删除或替换已确认的 Preview/Portable；
5. 验证 Setup 存在、大小大于 1 MB、版本与 manifest 一致，并将 Setup SHA-256 追加到 manifest；
6. 安装冒烟使用临时安装目录；验证完成后报告最终路径、大小、版本和 SHA-256。

> 现有 `scripts/build-installer.ps1` 会清理 `dist` 并同时生成 Setup/Portable，实施时必须拆分公共组装逻辑（建议 `scripts/build-common.ps1`），改造成上述 Preview → 用户确认 → Setup 门禁流程。

---

## §9 新会话执行指引（必须读）

1. **工作区**：目标项目 `D:\Work\Project\dsh-desktop`（**非**当前会话工作区 `deepseek-harness-desktop-master`——后者只是只读参考）。
   所有修改写入 `D:\Work\Project\dsh-desktop`。
2. **环境**：Node ≥ 22（本机 24.18）；`npm test` = `node --test "tests/*.spec.mjs"`；应用入口 `electron .`。
3. **参考实现（只读）**：`D:\Work\Project\deepseek-harness-desktop-master\dsh-plugin-desktop`（settings 插件参考）、
   `dsh-community-market`（client 插件参考）。仅读，不写。
4. **本机 DSH 后端**：跑在 `127.0.0.1:3080`（`web` profile，由 `C:\Users\19163\deepseek-harness` 启动）。
   该后端只用于设计对照/probe；**不要重启、杀掉或安装桌面插件**。最终应用必须启动独立的 `dsh-desktop` profile/端口，不得复用 3080。
5. **probe 验证工具**：本仓库有 `node_modules\electron`；写临时脚本放 `scripts/`（跑完即删）：
   - 滚动检查：`BrowserWindow{offscreen:true}` 加载 `http://127.0.0.1:3080` → `injector.applyInjections` →
     `executeJavaScript` 读 `body.scrollHeight/innerHeight`；
   - 多实例检查：`BaseWindow` + 2 个 `WebContentsView` 加载同一 URL，确认 `contentView.addChildView` 布局。
6. **git 纪律**：每阶段独立提交（M1→M2→M3→M4→M5 脚本改造）；`git reset --hard <上一阶段>` 即回滚。M5 Preview 是生成物阶段，不提交 `dist`。
7. **图标源**：`C:\Users\19163\Downloads\Q2_docs_抱书.png`（1024×1024）——复制到项目 `assets/`，不改原文件。
8. **依赖**：M1/M2/M4 零新 npm 依赖（Electron 内置 API）；M3 无新依赖（child_process）。若需 `npm install`，
   在项目目录执行（首次会写 node_modules）。

---

## §10 修订记录

| 版本 | 时间 | 内容 |
|---|---|---|
| v1 | 2026-08-28 | 初稿：四项修改设计 + 执行流程 |
| v2 | 2026-08-28 | 范围决策 Windows 专用；修改 2 方案 A + profile 兜底；修改 3 技术栈明确；修改 4 方案 A 主/B 兜底；§0 基线 |
| v3 | 2026-08-28 | 新增修改 5（多实例页签）+ 修改 6（Win11 风格）；执行顺序重排 |
| v4 | 2026-08-28 | **定稿**：补齐各修改关键代码骨架 + §8 新会话执行指引 + §9 修订记录 |
| v5 | 2026-08-28 | 修改 1 标题栏配色改为 **DSH 品牌色板**（`--dsh-*`，实测 3080 页面/CSS）；修改 6 明确「控件形态 Win11 + 配色 DSH 品牌色」一体感原则 |
| v6 | 2026-08-28 | 初步加入主题跟随 observer/IPC；当时对 `--dsh-title-bar-strip` 来源判断有误，已在 v9 删除依赖并更正 |
| v7 | 2026-08-28 | **配色纠错**：删除误判的紫色 `#1c00cf`/JSON Tree 色；以 `design-platform.css` 为准，页面内直接引用 `--dsw-*`；正式主题信号改为 `body[data-ds-dark-theme]`，IPC 仅同步计算后色板到宿主层 |
| v8 | 2026-08-28 | 新增强制两阶段交付：先删除旧 `dist` 并生成 Preview/Portable + SHA-256 清单；用户确认后才从已验证内容生成 Setup 安装包 |
| v9 | 2026-08-28 | 最终可执行性审查：保留单实例锁并将二次启动路由为页签；宿主 Chrome 拆成 titlebarView+tabbarView；插件改为独立 profile/端口且随包外置；退出改可等待清理；根容器内缩避免遮挡；删除错误声明；补 SemVer 1.1.0、帮助文档和插件 payload 哈希门禁 |

*本文档为设计依据；逐文件任务与验收以 `desktop-polish-checklist.md` 为准。*
