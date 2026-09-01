# DSH Desktop 实施施工图（P0–P4 · 修订版）

> **现行修订：旧 `dsh-desktop-settings` 插件及 probe profile 已删除。下方所有插件探针、安装和构建任务均已废止，禁止重新执行。设置和关于功能由 Electron 内置页签实现。**

> 依据：`docs/implementation-roadmap.md`（**执行主文档，矛盾时以此为准**）+ `docs/architecture.md`（设计总览）
> 本表为逐文件任务清单与验收；执行顺序与依赖见 roadmap §2。
> **第二轮审查修正（X1–X10）见 roadmap §8，已并入下列任务格（P0.1/P1.3/P2.1/P2.2 等）。**
> 状态：**尚未实施**（本会话只做审查与路线设计，实施由新会话按 roadmap 执行）

---

## P0 基座（重构 + 安全 + 可测性 · 零新依赖）

| 任务 | 文件 | 改动 | 验收 |
|---|---|---|---|
| P0.1 | `main/config.js` | `mergeConfig`/`validateConfig` 纯函数 + `createConfigStore(deps)`（注入 userDataPath/fs/logger）；schema §15.5；**写盘原子写**（tmp+rename，X2） | 纯函数可 `node:test`；配置不因中断损坏 |
| P0.2 | `main/logging.js` | 滚动日志 `%APPDATA%/dsh-desktop/logs/`；`log/logError` | 日志落盘滚动 |
| P0.3 | `main/dsh-server.js` | `resolveLaunch(config.dsh)` 纯函数 + `createDshServer(deps)`（注入 spawn/net/http）；参数化 §15.4 | 探测链与现状一致 |
| P0.4 | `main/lib/escape-html.js` + `semver.js` | `escapeHtml(s)`；`compareSemver(a,b)`（X4 提前）；回显点统一使用 | grep 无裸 innerHTML 拼接；semver 比较可测 |
| P0.5 | `preload.js` + 内嵌窗口 | API Key 引导/设置 fallback 改 `contextIsolation:true`+`sandbox`+preload，移除 `nodeIntegration:true`（D1） | 内嵌窗正常；无 nodeIntegration |
| P0.6 | `main.js` → `main/index.js` | 瘦身为薄入口 `require('./main/index')` | `npm start` 行为不变 |

**验收**：`node --test tests/` 初步可跑；`npm start` 与现状一致；`logs/` 有日志；内嵌窗无 nodeIntegration。

---

## P1 窗口与注入（WCO + 注入基础 + 桌面体验 · 零新依赖）

| 任务 | 文件 | 改动 | 验收 |
|---|---|---|---|
| P1.1 | `main/inject/index.js` | `applyInjections(win)`：insertCSS/executeJavaScript 封装 + 同源白名单（did-finish-load/did-navigate 后） | 注入仅在 DSH 同源页面生效 |
| P1.2 | `main/window.js` | WCO 分平台窗口（win hidden+titleBarOverlay；mac hiddenInset+trafficLightPosition；其余回退）+ 窗口状态记忆（move/resize/maximize→config.window，启动恢复） | 无标题栏+WCO 三键；位置/最大化恢复 |
| P1.3 | `main/inject/titlebar.css` + `titlebar.js` | 先 DevTools 观察 DSH header 结构（X1）；Windows：`.dsh-titlebar` 拖拽区（最小覆盖，`pointer-events:none` 空白带）+ `body` env() 避让（fixed header 用 margin/top）；macOS：仅拖拽区（不 env() 避让） | 顶部可拖拽；**不挡 DSH 任何交互** |
| P1.4 | `main/index.js` | 单实例锁：`requestSingleInstanceLock` + `second-instance` 唤起 | 双开被拦截并聚焦旧窗口 |
| P1.5 | `main/tray.js` | 托盘增强：显示/隐藏、新建对话、重启后端、设置、关于、退出 | 菜单新项可用 |
| P1.6 | `main/inject/theme.css` + `nativeTheme` | `shouldUseDarkColors`→WCO color/symbolColor + 主题变量注入；`nativeTheme.on('updated')` 重注入 | 系统主题切换跟随 |

**验收**：WCO 三键正常；顶部 40px 可拖拽移动窗口；双开防护；位置记忆；主题跟随。

---

## P2 插件化设置（IPC 桥 + client 插件 + 移除菜单栏 · 需 npm）

| 任务 | 文件 | 改动 | 验收 |
|---|---|---|---|
| P2.1 | `dsh-settings-plugin/`（最小探针） | **第一步**：`npm view @deepseek-ai/dsh-client-runtime versions` 验证可用版本（X3）→ 最小插件仅注册空 `settings.section` + `console.log('[probe] loaded')`；`dsh plugin add` 装进 profile | DevTools 见 `[probe] loaded` + 设置页出现分区（roadmap §4.4） |
| P2.2 | `main/bridge/server.js` + `routes.js` | loopback 随机端口 + Bearer token + Origin 校验 + CORS；9 个 `/api/*` 端点（§15.1；G1 的 `/api/dsh/*` 2 个在 P3.4 追加）；`GET /api/settings` 对 `dsh.env`/`dsh.proxy` 密码段脱敏、`bridge.token` 不返回；配置写盘原子写（X2） | curl 带 token 成功；无 token 401；错 Origin 403；脱敏字段不泄露 |
| P2.3 | `main/inject/titlebar.js` + 桥客户端 | `window.__DSH_DESKTOP__ = { bridgeBaseUrl, token }` 注入；`bridge-client.ts` 等待就绪（§4.5 竞态处理） | 插件可读到桥信息 |
| P2.4 | `dsh-settings-plugin/`（完整） | `src/index.ts`(apply→settings.section) + `SettingsSection.tsx`（5 组设置 + Props 契约）+ locales + tsdown（§4.3 依赖） | 构建产物可加载 |
| P2.5 | `main/index.js` | `setApplicationMenu(null)` 移除菜单栏；F12/Ctrl+R 经 `before-input-event`/`globalShortcut` 保留 | 无菜单栏；开发者快捷键可用 |
| P2.6 | `scripts/install-plugin.ps1` | 构建 bundle + `dsh plugin add`；启动时检测未装则引导 | 一键安装插件 |

**验收**：DSH 设置页出现「桌面」分区；开关/PATCH 读写 Electron 配置生效；窗口动作生效；无菜单栏。

---

## P3 可靠性（B5–B7）

| 任务 | 文件 | 改动 | 验收 |
|---|---|---|---|
| P3.1 | `main/notifications.js` | `Notification` 封装；接 `POST /api/notify` | 通知触发 |
| P3.2 | `main/updater.js` | GitHub Releases + `compareSemver` + `lastChecked` 节流；接 `POST /api/updater/check` | 有新版提示 |
| P3.3 | `main/diagnostics.js` | 一键导出诊断文本（§4.5 内容）；接 `GET /api/diagnostics` | 诊断可复制 |
| P3.4 | `main/dsh-update.js` + 桥端点 | **G1 本地 DSH 更新**：`POST /api/dsh/check-update` + `POST /api/dsh/update`（按来源适配 + 双重确认 + 更新日志；**成功自动重启后端**）；设置页「DSH」组（含 `dsh.checkOnStartup` 启动静默检查开关，默认关）+ 托盘入口（architecture §16） | 检查返回版本信息；更新日志落盘；失败保留旧版；成功自动重启 |

**验收**：各路径手动触发成功。

---

## P4 工程收尾（E2–E4）

| 任务 | 文件 | 改动 | 验收 |
|---|---|---|---|
| P4.1 | `tests/*.spec.mjs` | `node:test` 覆盖 mergeConfig/validateConfig/resolveLaunch/escapeHtml/compareSemver | `npm test` 绿 |
| P4.2 | `.github/workflows/ci.yml` | `npm ci && npm test` + 打包冒烟 | CI 绿 |
| P4.3 | `scripts/render-icon.mjs` + `pack-ico.mjs` | 统一图标流水线；删 `assets/` 冗余脚本（create-icon/create-real-icon/generate-icon） | 一套命令出全部图标 |
| P4.4 | `build-installer.ps1`/`installer.nsi`/`portable.nsi` | 版本号从 `package.json` 注入；产物校验 | 出包且版本一致 |

**验收**：`npm test` 绿；CI 绿；`build-installer.ps1` 出包。

---

## 最终验收清单（对应目标）

- [ ] 应用可启动（`npm start` 与打包产物）
- [ ] **无标题栏**：WCO 原生右上三键
- [ ] 页面顶部标题栏避让 + 拖拽区正常（Windows）
- [ ] **无菜单栏**；设置/查看能力保留（快捷键/托盘/设置页）
- [ ] **设置集成进 DSH 设置页**：出现「桌面」分区，开关/PATCH 读写生效，窗口控制生效
- [ ] 单实例锁、托盘增强、窗口状态记忆、主题跟随
- [ ] 内嵌窗口无 nodeIntegration、回显转义
- [ ] `npm test` 绿、打包产物版本正确

---

## 依赖与风险提示

- P2 依赖 `@deepseek-ai/dsh-client-*`（rc.2），版本漂移时以 master 归档 lockfile 为准（roadmap §4.3）；
- P2.1 探针先行，失败先排查 bundle 加载路径/`dsh.client.inject` 契约/loader（roadmap §4.4）；
- WCO 低版本/非 Win 平台回退默认标题栏；
- 跨目录写入需授权；npm 安装建议在开发终端执行。
