# DSH Desktop 架构文档（v2 目标态）

> **现行修订：`dsh-desktop-settings` / `dsh-settings-plugin/` 已彻底删除。禁止执行本文后续任何旧插件安装、构建、注入或 profile 修改步骤；桌面设置及 DSH 更新功能均由 Electron 主窗口内置页签提供。相关段落仅保留为历史设计记录。**

> 版本：v2 设计稿 · 状态：评审中（尚未实现）
> 适用项目：`D:\Work\Project\dsh-desktop`（当前 v1.0.0 轻量 Electron 壳）
> 本文档是"优化全集确定后"的最新架构设计，作为后续实施的唯一依据。

---

## 1. 概述与目标

### 1.1 现状（v1.0.0）
- 单文件 `main.js`（约 1300 行 CommonJS）的轻量 Electron 壳；
- 通过 spawn 外部 DSH 后端（本地仓库 / 全局 CLI / npm 全局包 / `npx`），等 `http://127.0.0.1:3080` 就绪后 `BrowserWindow.loadURL`；
- 自带原生菜单栏、原生标题栏、托盘、全局快捷键、内嵌设置窗口与 API Key 引导窗口；
- 无测试、无 CI、无插件化能力、无更新/通知/诊断/日志体系。

### 1.2 演进目标
在保持"轻量、可分发、可运行"的前提下，演进为**模块化、插件化、安全、可维护**的桌面产品：

1. **插件化设置**：原生菜单栏移除；设置功能以 DSH client 插件形式集成进 DSH Web 设置页（方向 A1）；
2. **现代窗口**：无标题栏，用原生 Window Controls Overlay 保留右上三键（方向 A2）；
3. **桌面体验**：主题跟随、窗口状态记忆、单实例、托盘增强（B1–B4）；
4. **可靠性**：启动失败诊断、更新检查、系统通知、日志与崩溃证据（B5–B7、E5）；
5. **可配置**：DSH 启动参数进设置页（C1）；
6. **安全加固**：所有窗口隔离、回显转义、IPC 桥认证（D1–D3）；
7. **工程化**：模块拆分、参数化、单测、CI、图标与打包流水线（E1–E4、F3）。

### 1.3 范围边界（决策记录）
| 项 | 状态 |
|---|---|
| C2 会话/工作区快捷入口、C3 剪贴板/截图唤起 | **本期不做**，记为远期候选 |
| 手机远程、多窗口 | 远期，不在本文档展开 |
| **G1 本地 DSH 更新（检查 + 按来源更新）** | **本期新增**，设计见 §16；手动触发 + 双重确认，不自动更新；更新成功自动重启后端 |

---

## 2. 总体架构

### 2.1 分层视图

```
┌─────────────────────────────────────────────────────────────┐
│                      用户（显示器 / 键盘 / 托盘）              │
└───────────────────────────────┬─────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────┐
│                     Electron main（原生能力层）                │
│  window / tray / hotkeys / config / dsh-server /             │
│  notifications / updater / diagnostics / logging             │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  bridge/server.js（统一 IPC 桥：loopback + token）        │  │
│  └────────────────────────────────────────────────────────┘  │
└───────────────┬────────────────────────────────┬─────────────┘
                │  spawn/管理                       │ loopback HTTP + token
┌───────────────▼──────────────┐    ┌──────────────▼─────────────┐
│    DSH 后端子进程（外部）       │    │      DSH Web（renderer）     │
│  pnpm dsh web / npx …         │    │  · 官方 Web UI              │
│  （由 dsh-server 模块管理）     │    │  · dsh-settings-plugin      │
│                              │    │    （settings.section 注入）  │
└──────────────────────────────┘    │  · inject/ 注入的 CSS/JS     │
                                    └────────────────────────────┘
```

要点：
- **main 是唯一拥有原生能力的地方**；renderer（含插件）一律通过 bridge 访问；
- 后端仍是"外部进程"模型（不内嵌运行时），由 `dsh-server` 模块统一管理；
- 设置页插件跑在 DSH Web 里，通过 bridge 读写 Electron 配置与窗口。

### 2.2 进程模型
| 进程 | 说明 |
|---|---|
| Electron main（单实例） | 原生能力层 + bridge server；单实例锁保证唯一 |
| DSH 后端子进程 | `dsh-server` spawn 的子进程树，失败可诊断、可重启 |
| DSH Web renderer | 沙箱 Web 页面 + client 插件 + 注入脚本 |

### 2.3 模块划分（对应 F3 拆分目标）

```
main/
├── index.js              # 入口：单实例锁、生命周期、组装各模块
├── window.js             # 窗口管理：WCO、状态记忆、窗口动作 API
├── tray.js               # 系统托盘（含增强菜单）
├── hotkeys.js            # 全局快捷键（无应用菜单栏，before-input-event 兜底）
├── config.js             # 配置读写 + schema + 参数化（E1）
├── dsh-server.js         # 后端探测/启动/停止/重启/诊断（C1、B5）
├── bridge/
│   ├── server.js         # loopback HTTP + token + Origin 校验（F2、D3）
│   └── routes.js         # /api/* 路由实现
├── notifications.js      # 系统通知（B7）
├── updater.js            # 更新检查（B6）
├── diagnostics.js        # 启动失败诊断导出（B5）
├── logging.js            # 滚动日志 + 崩溃证据（E5）
└── inject/               # 页面注入（F1、D2）
    ├── titlebar.css      # 标题栏避让 + 拖拽区
    ├── titlebar.js
    └── theme.css         # 主题变量注入（B1）
```

---

## 3. 目录结构（目标态）

```
dsh-desktop/
├── main/                     # 主进程模块（由 main.js 拆分，F3）
│   ├── index.js
│   ├── window.js
│   ├── tray.js
│   ├── hotkeys.js
│   ├── config.js
│   ├── dsh-server.js
│   ├── bridge/
│   │   ├── server.js
│   │   └── routes.js
│   ├── notifications.js
│   ├── updater.js
│   ├── diagnostics.js
│   ├── logging.js
│   └── inject/
│       ├── titlebar.css
│       ├── titlebar.js
│       └── theme.css
├── preload.js                # contextBridge（D1）
├── dsh-settings-plugin/      # DSH client 设置页插件（A1）
│   ├── package.json          # dsh.client.inject 声明
│   ├── src/
│   │   ├── index.ts          # apply(ctx) → settings.section
│   │   ├── SettingsSection.tsx
│   │   └── bridge-client.ts  # fetch bridge 客户端
│   ├── tsdown.config.ts
│   └── README.md
├── scripts/                  # 构建/安装/图标（E3、E4）
│   ├── build-installer.ps1   # 版本号从 package.json 注入
│   ├── install-plugin.ps1    # 构建 + dsh plugin add
│   ├── render-icon.mjs       # 统一图标流水线
│   └── pack-ico.mjs
├── tests/                    # 单测（E2）
│   ├── config.spec.mjs
│   ├── dsh-server.spec.mjs
│   ├── updater.spec.mjs
│   └── diagnostics.spec.mjs
├── docs/
│   └── architecture.md       # 本文档
├── assets/
├── main.js                   # 保留为薄入口，仅 require('./main/index')
└── package.json
```

---

## 4. 配置模型（E1）

`%APPDATA%/dsh-desktop/config.json`（沿用），schema 如下：

```jsonc
{
  "window":    { "x": null, "y": null, "width": 1200, "height": 800, "maximized": false },
  "theme":     { "mode": "system" },            // system | dark | light（B1）
  "tray":      { "closeToTray": true, "showInTaskbar": true, "autoLaunch": false },
  "hotkey":    "CommandOrControl+Shift+D",
  "dsh":       {
    "path": "",                                  // DSH 仓库路径，空=自动探测
    "port": 3080,                                // C1
    "profile": "",                               // --profile（C1）
    "env": {},                                   // 附加环境变量（C1）
    "proxy": "",                                // 代理（C1）
    "checkOnStartup": false                     // 启动时静默检查本地 DSH 更新（G1，默认关，设置页可开）
  },
  "bridge":    { "port": 0, "token": "" },      // 运行时生成，不入用户编辑面（D3）
  "updater":   { "lastChecked": null, "channel": "stable" },
  "language":  "zh-CN"
}
```

原则：
- 常量（`DSH_URL`、`HOTKEY`、版本号、安装路径）全部参数化；
- 环境变量优先：`DSH_REPO_ROOT`、`DSH_HOME`、`DEEPSEEK_API_KEY` 等仍生效；
- `bridge` 段由程序维护，设置页不可见。

---

## 5. 统一 IPC 桥（F2 / D3）

### 5.1 为什么
renderer（官方 Web + 插件）运行在沙箱里，不能直接访问 Electron。所有"设置页 ↔ 原生能力"的交互走本桥。

### 5.2 传输与安全
- **loopback + 随机端口**：启动时 `net` 监听 `127.0.0.1:0`（随机端口），不对外暴露；
- **Bearer token**：随机 token 写入 `config.bridge`，插件从 bridge 客户端注入处获取；
- **Origin 校验**：仅接受 `Origin` 为 `http://127.0.0.1:<dshPort>` / `http://localhost:<dshPort>` 的请求；
- 同一端口提供 `GET /healthz`（供插件探测）；
- CORS 仅放开页面 origin；请求方法限制为 GET/POST（状态类 GET，动作类 POST）。

### 5.3 API 一览
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/state` | 窗口可见性、主题、后端状态、版本 |
| GET/PATCH | `/api/settings` | 读/写用户配置（白名单字段） |
| POST | `/api/window/:action` | `minimize` `maximize`/`unmaximize` `close` `toggle` `show` |
| POST | `/api/notify` | 触发系统通知（B7） |
| POST | `/api/backend/restart` | 重启 DSH 后端（B4） |
| GET | `/api/diagnostics` | 诊断信息导出（B5） |
| POST | `/api/updater/check` | 触发更新检查（B6） |
| GET | `/api/bridge/info` | 返回桥自身信息（插件初始化用） |
| POST | `/api/dsh/check-update` | 本地 DSH 更新检查（G1，见 §16.4） |
| POST | `/api/dsh/update` | 执行本地 DSH 更新（G1，见 §16.4） |

### 5.4 错误与幂等
- 未知 action 返回 `400` + 错误码；
- 写配置失败返回 `409`；校验失败 `422`；
- 所有动作在 main 侧同步完成，避免跨 generation 缓存。

---

## 6. DSH client 设置插件（A1）

### 6.1 形态
Cordis **client 插件**（npm 包），在 DSH Web 客户端运行时被加载，注入 `settings.section`：

```jsonc
// dsh-settings-plugin/package.json
{
  "name": "dsh-desktop-settings",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "dsh": {
    "client": {
      "inject": [  // 依赖包注入；最终以 P2.1 探针实测为准（与 roadmap §4.3 一致，去 ui-theme，见 X6）
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-settings",
        "@deepseek-ai/dsh-client-ui-slots"
      ],
      "platform": "web"
    }
  }
}
```

```ts
// src/index.ts
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { SettingsSection } from './SettingsSection.js'

export const inject = ['slots', 'locale', 'settingsScope']

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'desktop',
    order: 10,
    label: () => ctx.locale.bind('desktop.settings')('nav'),
    locale: 'desktop.settings',
    inject: () => ({ bridgeBaseUrl, token }),
  }, SettingsSection))
}
```

> **两层注入区分**：`package.json#dsh.client.inject` 是**依赖包注入**（声明插件运行所需的 DSH client 包）；`src/index.ts` 里 `export const inject` 是**运行时服务注入**（声明 `apply(ctx)` 要用的 Cordis 服务，如 slots/locale）。两者不同层，实施以 P2.1 探针实测 + master 归档参考为准。

### 6.2 设置项分组（对应 config schema）
| 分组 | 字段 |
|---|---|
| 常规 | 开机自启、关闭到托盘、任务栏显示、窗口置顶 |
| 外观 | 主题（跟随系统/深色/浅色） |
| 快捷键 | 全局呼出键 |
| DSH | 仓库路径、端口、profile、代理、附加环境变量、后端状态+重启、**本地 DSH 更新**（版本/检查/更新/静默检查开关，见 §16.4） |
| 关于/更新 | 版本、检查更新 |

### 6.3 安装集成
- `scripts/install-plugin.ps1`：构建插件 bundle → 在目标 profile 执行 `dsh plugin add <本地 file: 引用>`；
- 壳启动时通过 bridge `GET /api/state` 检测插件是否已安装，未安装时在加载窗口提示/引导安装；
- 插件更新 = 重新构建 + `dsh plugin update`。

---

## 7. 窗口与桌面体验

### 7.1 WCO 无标题栏（A2）
- Windows：`titleBarStyle: 'hidden'` + `titleBarOverlay: { color, symbolColor, height: 40 }`，系统原生三键；
- macOS：`titleBarStyle: 'hiddenInset'` + `trafficLightPosition`（保留红黄绿，或按需 overlay）；
- 页面注入避让：`body { padding-top: env(titlebar-area-height, 40px) }` + 顶部拖拽区 `-webkit-app-region: drag`（F1）。

### 7.2 窗口状态记忆（B2）
- `window.js` 在 `move`/`resize`（debounce）与 `maximize`/`unmaximize` 时持久化到 `config.window`；
- 启动时恢复；跨显示器越界时回退默认。

### 7.3 单实例锁（B3）
- `app.requestSingleInstanceLock()`：失败即退出并 `second-instance` 事件唤起已有窗口；
- 可选的"单实例也确保单一后端"：重复启动直接聚焦已有窗口。

### 7.4 托盘增强（B4）
| 菜单 | 动作 |
|---|---|
| 显示/隐藏主窗口 | toggle |
| 新建对话 | 打开新标签（reload 到根路由，或触发插件 action） |
| 重启后端 | bridge `POST /api/backend/restart` |
| 设置 | 打开 DSH 设置页（跳转 `#/settings` 或唤起插件 section） |
| 关于 / 退出 | 现有逻辑 |

### 7.5 主题跟随系统（B1）
- `nativeTheme.on('updated')` → 更新 WCO `color`/`symbolColor` + 注入 `theme.css` 变量到 DSH Web；
- 设置页主题选择（system/dark/light）与系统联动。

### 7.6 快捷键（无应用菜单栏）
- 移除 `Menu.setApplicationMenu` 的自定义菜单（或 `setApplicationMenu(null)`）；
- F12 / Ctrl+R 等开发者快捷键经 `before-input-event` 或 `webContents` 快捷键保留；
- 全局呼出键 `globalShortcut` 不变（可从设置页改）。

---

## 8. 页面注入机制（F1 / D2）

- 注入时机：`did-finish-load` + SPA 路由变化后按需重注入；
- 注入方式：`webContents.insertCSS` + `executeJavaScript`；
- 注入内容白名单（仅与 DSH_URL 同源页面）：
  1. 标题栏拖拽区 + `body` 顶部避让（A2）；
  2. 主题 CSS 变量（B1）；
  3. 桥 token 注入到 `window.__DSH_DESKTOP__`（供插件读取，不注入页面全局敏感 API）。
- **回显转义（D2）**：任何把本地路径/状态字符串写入页面 DOM 的地方（诊断、状态、路径）一律 `escapeHtml`，禁止裸拼 `innerHTML`。

---

## 9. 安全模型（D1–D3）

| 面 | 措施 |
|---|---|
| 主窗口（DSH Web） | `contextIsolation: true` + `sandbox: true` + `nodeIntegration: false` |
| 内嵌窗口（API Key 引导、设置 fallback） | 同上；移除 `nodeIntegration:true` 写法，全部改 preload + contextBridge（D1） |
| IPC 桥 | loopback + 随机端口 + Bearer token + Origin 校验（D3） |
| 注入 | 仅白名单同源页面；内容最小化；回显转义（D2） |
| 凭据 | `~/.dsh/.credentials.yaml` 写入保持 `0600`；路径解析不做符号链接逃逸 |
| 子进程 | DSH 后端 spawn 使用 `windowsHide`，不拼接 shell 字符串，参数走 argv |

---

## 10. 后端管理（C1 / B5）

- `dsh-server.js` 保留现有探测链（本地仓库 / 全局 CLI / npm 全局包 / npx），参数改为从 `config.dsh` 读取（端口、profile、代理、env）；
- 启动失败 / 超时：写日志 + 收集 stdout/stderr 尾部 → `diagnostics.js` 一键导出（B5）；
- `POST /api/backend/restart`：kill → 重启 → 等待就绪 → 返回结果（B4）。

---

## 11. 通知 / 更新 / 日志

- **通知（B7）**：`notifications.js` 封装 `Notification`；来源包括 DSH 任务完成/失败（由插件或桥触发）、后端状态变化、更新可用；
- **更新（B6）**：`updater.js` 请求 GitHub（或 Gitee 镜像）Releases API，`semver` 比较；有新版 → 通知 + 引导下载；`config.updater.lastChecked` 节流；
- **日志（E5）**：`logging.js` 滚动写入 `%APPDATA%/dsh-desktop/logs/`（按大小/日期滚动，最多 N 份）；崩溃证据：监听 `render-process-gone` / `uncaughtException` 落盘最小转储文件。

---

## 12. 工程化（E2–E4 / F3）

- **F3 拆分顺序**：先 `config` → `logging` → `dsh-server`（纯逻辑多）→ `window/tray/hotkeys` → `bridge` → 其余，逐步从 `main.js` 剥离，保持每步可运行；
- **E2 测试**：优先覆盖纯函数——配置合并/校验、后端探测与命令解析、semver 比较、诊断格式化、转义；用 `node:test`（零新依赖）或 vitest；CI：GitHub Actions 单作业 `npm ci && npm test` + 打包冒烟；
- **E3 图标**：统一 `scripts/render-icon.mjs`（favicon→PNG 多尺寸）+ `pack-ico.mjs`（PNG→ICO），删除 `assets/` 下重复脚本；
- **E4 打包**：`build-installer.ps1` / `installer.nsi` / `portable.nsi` 的版本号从 `package.json` 读取注入，产物校验（存在 + 大小 + 可执行）。

---

## 13. 实施路线图（里程碑）

| 里程碑 | 内容 | 涉及方向 | 验证 |
|---|---|---|---|
| **M0 基础重构** | main.js 拆模块；配置参数化；日志文件化 | F3、E1、E5 | `npm start` 行为不变；日志落盘 |
| **M1 桌面体验** | WCO 无标题栏；单实例；托盘增强；窗口记忆；主题跟随 | A2、B1–B4 | 界面效果 + 双开防护 + 状态恢复 |
| **M2 安全加固** | 内嵌窗口隔离；回显转义 | D1、D2 | 设置/引导窗仍可用；无 nodeIntegration |
| **M3 插件化设置** | IPC 桥；client 设置插件；移除菜单栏 | A1、F2、D3 | 设置页出现在 DSH Web 设置；读写 Electron 配置生效 |
| **M4 可靠性** | 诊断导出；更新检查；系统通知 | B5–B7 | 手动触发各路径 |
| **M5 工程收尾** | 单测 + CI；图标/打包流水线 | E2–E4 | `npm test` 绿；`build-installer.ps1` 出包 |

每个里程碑独立可运行、可回滚；M1 无新 npm 依赖，M3 需要 `@deepseek-ai` client 依赖与一次 `dsh plugin add`。

> **修订声明（审查后）**：本里程碑表已经审查修订，正式执行顺序以 `docs/implementation-roadmap.md`（P0–P4）为准；本表保留作设计参考。主要修订：注入基础（F1）提前至 P1、安全基座（D1/D2）提前至 P0、插件契约/可测性/验证操作已在 roadmap 补齐。

---

## 14. 风险与依赖

| 风险 | 影响 | 缓解 |
|---|---|---|
| DSH 版本 `0.1.1-rc.2` 契约漂移（slot/service 变更） | 插件失效 | 插件保持最小注入面；锁定依赖版本；升级前回归 |
| client 插件依赖需联网安装 `@deepseek-ai/*` | 构建阻塞 | 构建在开发机进行，产物进包；目标机无需 npm |
| `settings.section` 契约随上游演进 | 设置页加载失败 | 提供 fallback：菜单栏移除前保留托盘设置入口 |
| 跨平台差异（WCO 在 Win10/11 表现、macOS 三键） | 体验不一致 | platform adapter 分离；低版本回退为普通标题栏 |
| 沙箱内 npm/跨目录写入受限 | 实施被拦 | 开发环境（IDE/终端）执行 npm；跨目录写入按授权进行 |

---

## 15. 附录：关键模块详细设计规格

> 本节把第 2–12 章的要点落成"可直接落地"的规格（接口、数据、流程），供实施时逐条对照。**规格 ≠ 实现代码**。

### 15.1 统一 IPC 桥 API 契约（F2 / D3）

**传输层**
- 监听 `127.0.0.1:0`（随机端口），仅回环；启动后把 `{ port, token }` 写入 `config.bridge`。
- 认证：所有 `/api/*` 请求必须携带 `Authorization: Bearer <token>`；缺失或错误 → `401 { code: 'UNAUTHORIZED' }`。
- 来源校验：`Origin` 头必须匹配 `<dshUrl origin>`（`http://127.0.0.1:<port>` 或 `http://localhost:<port>`）；否则 `403 { code: 'BAD_ORIGIN' }`。无 `Origin` 的请求拒绝（防非浏览器客户端）。
- CORS：`Access-Control-Allow-Origin` 回显页面 origin；`Access-Control-Allow-Headers: Authorization, Content-Type`；方法白名单 `GET, POST, OPTIONS`。

**统一响应**
```
2xx: { ok: true, data?: any }
4xx/5xx: { ok: false, code: string, message: string, detail?: any }
```

**端点明细**
| 方法 | 路径 | 请求体 | 成功响应 data | 主要错误 |
|---|---|---|---|---|
| GET | `/api/state` | — | `{ appVersion, windowVisible, theme, backendRunning, backendPort, pluginInstalled }` | — |
| GET | `/api/settings` | — | `config`（剔除 `bridge` 段） | — |
| PATCH | `/api/settings` | 部分字段（白名单：window/theme/tray/hotkey/dsh/language） | `{ ok, config }`（合并后） | `422` 未知字段 / 类型错；`409` 写失败 |
| POST | `/api/window/:action` | — | `{ action, result }` | `400` 未知 action |
| POST | `/api/notify` | `{ title, body, urgency? }` | `{ delivered }` | `503` 无通知权限 |
| POST | `/api/backend/restart` | — | `{ started, port }` | `500` 启动失败 |
| GET | `/api/diagnostics` | — | `{ text }`（可复制的诊断文本） | — |
| POST | `/api/updater/check` | — | `{ hasUpdate, current, latest, url? }` | `502` 检查失败 |
| GET | `/api/bridge/info` | — | `{ appVersion, capabilities: string[] }` | — |
| POST | `/api/dsh/check-update` | — | `{ source, currentVersion, latestVersion, hasUpdate }` | `502` 检查失败（G1，见 §16.4） |
| POST | `/api/dsh/update` | `{ confirm: true }` | `{ ok, log: string[] }` | `400` 缺 confirm / `500` 更新失败（G1） |

**窗口 action 白名单**：`minimize` / `maximize` / `unmaximize` / `close`（→ 按 `closeToTray` 语义隐藏）/ `toggle` / `show`。

**幂等与安全**：写操作在 main 侧同步完成；请求体大小限制（如 64KB）；非动作端点不接受 query 参数篡改；token 每次启动重新生成。

### 15.2 client 设置插件组件规格（A1）

**加载契约**
- 插件被 DSH 客户端 Cordis loader 加载，入口导出 `inject` 与 `apply(ctx)`；
- 通过 `ctx.slots.inject('settings.section', ...)` 注册，`id: 'desktop'`，`order: 10`；
- locale 命名空间 `desktop.settings`（zh/en 两份字典）。

**SettingsSection 状态模型**
```
状态：
  config   ← GET /api/settings
  busy     ← 正在 PATCH
  dirty    ← 表单有未提交改动
  dshState ← GET /api/state（backendRunning 等）

交互：
  toggle(field)   → PATCH /api/settings { [field]: next }
  save()          → 批量 PATCH + 校验
  restartBackend()→ POST /api/backend/restart
  checkUpdate()   → POST /api/updater/check
```

**分组渲染**
| 分组 | 控件 | PATCH 目标 |
|---|---|---|
| 常规 | 开关×4（自启/托盘/任务栏/置顶） | `tray.autoLaunch` `tray.closeToTray` `tray.showInTaskbar` `tray.topMost` |
| 外观 | 单选（system/dark/light） | `theme.mode` |
| 快捷键 | 输入框（录制或手填） | `hotkey` |
| DSH | 路径输入 / 端口数字 / profile / 代理 / 后端状态+重启 / **本地 DSH 更新**（版本/检查/更新/静默检查开关，见 §16.4） | `dsh.*` |
| 关于/更新 | 版本展示 + 检查更新按钮 | — |

**桥客户端**：`bridge-client.ts` 封装 `fetch(baseUrl, token)`，失败按 `401`（token 过期 → 提示重启应用）与 `5xx`（桥未就绪 → 显示重试）分级。

### 15.3 WCO 与主题注入规格（A2 / B1 / F1）

**窗口配置（分平台）**
```
win32:  { titleBarStyle: 'hidden', titleBarOverlay: { color, symbolColor, height: 40 } }
darwin: { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 15, y: 15 } }
其他:   默认标题栏（WCO 不可用回退）
```

**注入脚本规格（`inject/`）**
- `titlebar.css`：
  - `body { padding-top: env(titlebar-area-height, 40px) }`（SPA 根容器需配合）；
  - 顶部 40px 拖拽区：`.dsh-titlebar { position: fixed; top:0; left:0; right:0; height: env(titlebar-area-height, 40px); -webkit-app-region: drag; z-index: 2147483000 }`；
  - 内部可交互元素需 `-webkit-app-region: no-drag`（若放按钮）。
- `theme.css`：注入 CSS 变量 `--dsh-desktop-bg/--dsh-desktop-fg`，由 `nativeTheme.shouldUseDarkColors` 驱动；`nativeTheme.on('updated')` 时重注入并同步 `titleBarOverlay.color/symbolColor`。
- 注入时机：`did-finish-load` 与 `did-navigate` 后；对 `webContents.getURL()` 非 DSH 同源页面跳过（D2）。

**token 注入**：`executeJavaScript` 把 `window.__DSH_DESKTOP__ = { bridgeBaseUrl, token }` 写入页面（仅同源页面），插件/注入脚本据此调用桥；页面其余代码不可见其他敏感信息。

> **注**：注入前先用 DevTools 观察 DSH header 结构，拖拽区最小覆盖、避免遮挡交互（roadmap §8 X1）。

### 15.4 dsh-server 探测与启动规格（C1 / B5）

```
resolveLaunch(config.dsh):
  1) config.dsh.path 且存在 package.json  → { cmd:'pnpm', args:['dsh','web','--no-open', '--port', port], cwd }
  2) DSH_REPO_ROOT / 同级 / 家目录 / 桌面 / 文档 下 deepseek-harness/package.json
  3) 全局 CLI 可用（dsh --version）          → { cmd:'dsh', args:[...], cwd:null }
  4) npm root -g 含 @deepseek-ai/dsh       → { cmd:'npx', args:['@deepseek-ai/dsh', ...] }
  5) npx 兜底
参数追加：--profile（config.dsh.profile）、--proxy、env 合并 config.dsh.env。
前置检查：依赖系统 Node 的路径（2–5）且系统无 node → 提前报错（沿用现错误文案）。
启动：spawn(windowsHide:true, shell:true, stdio:['ignore','pipe','pipe'])，尾部 2KB 缓冲。
就绪：TCP 探测端口 → HTTP /healthz（status<500）→ 超时 90s。
失败：写日志 + 收尾 stderr → diagnostics.export()。
```

### 15.5 配置 schema 与校验规格（E1）

```
window: { x:number|null, y:number|null, width:int(800..3840), height:int(600..2160), maximized:boolean }
theme:  { mode: 'system'|'dark'|'light' }
tray:   { autoLaunch:boolean, closeToTray:boolean, showInTaskbar:boolean, topMost:boolean }
hotkey: 字符串，Electron accelerator 合法格式（非法 → 回退默认并记日志）
dsh:    { path:string, port:int(1..65535), profile:string, env:record<string,string>, proxy:string, checkOnStartup:boolean }  // checkOnStartup 默认 false（G1，与 §4 一致）
bridge: { port:int, token:string }            // 程序维护
updater:{ lastChecked:number|null, channel:'stable' }
language:'zh-CN'|'en-US'|'ja-JP'|'ko-KR'
```
- 合并策略：`{ ...defaults, ...loaded, ...envOverrides }`；未知字段丢弃并告警；
- 校验失败时保留原值 + 返回 `422`，不静默覆盖用户数据。

---

## 16. 本地 DSH 更新（G1 · 用户追加）

> 新增方向：**检查本地 dsh 是否有新版 + 一键更新**。与 §11 B6（检查 DSH Desktop 应用自身新版本）不同：**G1 更新的是 DSH 后端运行时本体**（CLI / 仓库 / npx 目标）。

### 16.1 目标与范围
- 探测当前实际使用的 dsh 来源与版本 → 对比 npm registry / git 远程最新版 → 提示并执行更新；
- **手动触发、更新前确认**；不自动更新；**更新成功后自动重启后端**使新版本生效（用户已确认）；
- 环境实测（本机）：无全局 CLI / 无 npm 全局包 / 无真实本地仓库，实际来源为 `npx @deepseek-ai/dsh`（npm registry 最新 `0.1.1-rc.2`）。功能需覆盖全部四种来源。

### 16.2 来源探测与版本比较
- 复用 `dsh-server.resolveLaunch` 的探测结论，标记来源类型：`local-repo` / `global-cli` / `npm-global` / `npx`；
- **当前版本**：`local-repo` 读其 `package.json#version`（或在该目录 `dsh --version`）；`global-cli`/`npm-global` 执行 `dsh --version`；`npx` 执行 `npx --no-install @deepseek-ai/dsh --version`（超时回退 unknown）；
- **最新版本**：`npm registry` 为准（`npm view @deepseek-ai/dsh version`）；`local-repo` 兼看 git 远程最新 tag（`git ls-remote --tags origin` 或 GitHub Releases API）；
- 比较用 `compareSemver`（X4 已提前到 P0.4）；版本异常标记 `unknown`，提示人工确认而非硬判。

### 16.3 更新流程（按来源）
| 来源 | 更新动作 | 失败处理 |
|---|---|---|
| `npm-global` / `global-cli` | `npm install -g @deepseek-ai/dsh@latest`（Windows 可能需管理员权限） | 失败提示以管理员重跑；保留旧版 |
| `local-repo` | 先 `git status --porcelain` 校验工作区干净 → `git pull --ff-only` → `corepack pnpm install`（经 root upstream:* 脚本） | 工作区脏则中止并提示先提交/清理 |
| `npx` | 无需更新（npx 每次拉最新）；提示「如需固定版本请 `npm i -g @deepseek-ai/dsh`」 | 建议安装全局后走 npm-global 路径 |

### 16.4 入口与 IPC
| 方法 | 路径 | 请求体 | 响应 data | 说明 |
|---|---|---|---|---|
| POST | `/api/dsh/check-update` | — | `{ source, currentVersion, latestVersion, hasUpdate }` | 幂等；60s 节流 |
| POST | `/api/dsh/update` | `{ confirm: true }` | `{ ok, log: string[] }` | 需 `confirm:true`；成功提示重启后端 |

- **设置页「DSH」分组**新增：当前版本 + 最新版本 + [检查更新] + [更新]（更新中禁用按钮 + 进度）+ 「启动时静默检查更新」开关（`dsh.checkOnStartup`，默认关）；托盘菜单加「检查 DSH 更新」；
- 启动时按 `dsh.checkOnStartup` **静默检查**（默认关）：发现新版仅发通知，不自动更新；

### 16.5 安全与日志
- main 侧 `dialog.showMessageBox` 确认 + 插件侧确认，双重防线；
- 更新命令一律 `execFile`/argv 数组，**不拼 shell 字符串**；
- 更新输出写 `logs/dsh-update-<ts>.log`（滚动保留）；
- 失败：保留旧版本，返回错误 + 日志尾部；
- **成功：自动重启后端**（复用 `POST /api/backend/restart`）使新版本生效；桥端口/token 不变，页面自动重连。

---

*本文档随优化全集确定而更新；任何新方向须先在"范围边界"登记并在此补全设计。*
