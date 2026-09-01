# DSH Desktop 实施路线 v2（修订版 · 新会话执行依据）

> **最终发布修订**：运行时直接连接或启动 `web:3080`，不做插件镜像，Web profile 的插件变化由桌面天然共享；桌面设置保留原生窗口。打包流程仅保留完整 Setup，不再生成 Portable。本文后续出现的独立 profile、插件复制/安装及 Portable 描述均以本修订为准。

> **清理修订**：`dsh-desktop-settings`、项目 `dsh-settings-plugin/` 和旧 `dsh-desktop-probe` profile 已彻底删除；本文后续插件化设置步骤仅是历史记录，禁止执行。

> 状态：**已审查修订**（本会话对 `architecture.md` 与 `implementation-checklist.md` 审查后产出）
> 使用方式：**新会话完全照本文档执行**。`architecture.md` 为设计总览，本文档为执行主文档（含审查结论、修订路线、自包含指引、验证操作）。
> 目标项目：`D:\Work\Project\dsh-desktop`（v1.0.0 轻量 Electron 壳）

---

## 1. 审查结论：原文档缺漏与修订（必须先读）

审查了 `docs/architecture.md`（505 行）与 `docs/implementation-checklist.md`（107 行），发现以下问题，本文档已全部修订：

### A. 里程碑依赖错误（严重）
- 原 M1.4「主题跟随」与 M1.1「WCO 标题栏避让」都依赖 **F1 页面注入机制**（`insertCSS/executeJavaScript`），但 F1 排在原 M3.2 → **M1 无法验证**。
- **修订**：把「注入基础」提前为 **P1 的前置子任务**（`main/inject/index.js` + 基础注入函数），P1 才能完成 WCO 避让与主题注入。

### B. 安全基座过晚（重要）
- 原 M2（内嵌窗口隔离 + 回显转义）排在 M1 之后，导致 M1/M3 新增代码可能不带安全形态、返工。
- **修订**：安全基座提前到 **P0**（D1 内嵌窗口隔离 + D2 escape-html + 桥安全设计一并落地），后续阶段新增代码直接按安全形态写。

### C. client 插件契约细节缺失（关键，影响 M3 成败）
- §6.1 的 `dsh.client.inject` 声明（5 个包）与 `apply` 内 `inject`（3 个服务）不一致；
- 未给出组件 Props 契约（`PropsRuntime` / `PropsLocale` / `InjectFace`）；
- 未说明入口是否需要 `export const name`；
- **未验证「`dsh plugin add` 后 client bundle 如何被 DSH Web 客户端加载」**——这是 M3 最大不确定性，实施时必须先做最小探针验证（见 §4.4）。
- **修订**：§4 给出统一契约与参考实现路径；P2 第一步先做「最小插件探针」。

### D. 注入竞态未处理
- `window.__DSH_DESKTOP__`（bridgeBaseUrl+token）由 Electron `executeJavaScript` 注入，与插件 `apply` 存在**竞态**。
- **修订**：桥客户端必须「等待 `window.__DSH_DESKTOP__` 就绪」（轮询或 `MutationObserver`/自定义事件），未就绪时重试 `GET /api/bridge/info`。

### E. 可测性设计缺失（影响 M5）
- `config`/`dsh-server` 若直接 `require('electron')`，无法在纯 Node 下 `node:test`。
- **修订**：P0 起把 `mergeConfig` / `validateConfig` / `resolveLaunch` / `escapeHtml` / `compareSemver` 写成**纯函数模块**（不 import electron、不碰文件副作用），副作用由调用方注入；测试只测纯函数。

### F. 构建配置缺失
- 插件 `package.json` 的 dependencies / devDependencies 具体版本与构建命令未给。
- **修订**：§4.3 给出插件工程完整依赖与命令（对齐 master 归档的 `dsh-community-market` 做法）。

### G. 验证操作缺失
- 缺 bridge 的 curl 测试示例、WCO/插件界面验证步骤。
- **修订**：§5 给出每阶段可执行的验证操作。

### H. 参考实现未标注
- 新会话无本会话记忆，需读 master 归档的现成实现。
- **修订**：§4.2 给出全部参考文件路径。

### I. 其他小缺漏
- macOS `hiddenInset` 无需 `env()` 避让，只需顶部拖拽区（补于 §4.1）；
- 诊断导出内容未定义（版本/平台/日志尾部/后端状态/脱敏配置，实施时按 §4.5 定）；
- 升级/回滚未给提交点纪律（补于 §6）。

---

## 2. 修订后的实施路线（阶段重排）

> 里程碑从 M0–M5 重排为 **P0–P4**；每阶段独立可运行、可回滚、有提交点。

| 阶段 | 内容 | 原里程碑 | 依赖 | 验收 |
|---|---|---|---|---|
| **P0 基座** | ① `main/` 目录 + `config.js`(纯函数) + `logging.js` + `dsh-server.js`(纯函数) + main.js 瘦身 ② **安全基座**：内嵌窗口隔离(D1) + escape-html(D2) ③ **可测性**：纯函数化 | M0 + M2 | 无新依赖 | `npm start` 行为不变；日志落盘；内嵌窗无 nodeIntegration；`node --test tests/` 初步可跑 |
| **P1 窗口与注入** | ① **注入基础**：`main/inject/index.js`(insertCSS/executeJavaScript 封装 + 同源白名单) ② WCO 窗口配置 + 标题栏避让/拖拽注入 ③ 窗口状态记忆 ④ 单实例锁 ⑤ 托盘增强 ⑥ 主题跟随（nativeTheme + theme.css 注入） | M1 + F1 提前 | 无新依赖 | 无标题栏+WCO 三键；页面顶部可拖拽；双开防护；位置记忆；主题跟随 |
| **P2 插件化设置** | ① 最小插件探针（先验证 client 插件可被 DSH 加载）② IPC 桥 server/routes ③ `window.__DSH_DESKTOP__` 注入 + 桥客户端（含竞态等待）④ `dsh-settings-plugin/` 完整实现 ⑤ 移除菜单栏 + 快捷键迁移 ⑥ `scripts/install-plugin.ps1` | M3 | 需 npm 安装 `@deepseek-ai/dsh-client-*` | DSH 设置页出现「桌面」分区；开关/PATCH 读写生效；窗口控制生效；无菜单栏 |
| **P3 可靠性 + 本地 DSH 更新** | 通知 / 更新检查 / 诊断导出 / **G1 本地 DSH 更新**（检查 + 按来源更新，architecture §16，任务 P3.4） | M4 + 追加 G1 | P2 的桥 | 各路径手动触发成功；`POST /api/dsh/check-update` 返回版本信息；更新成功**自动重启后端**；`dsh.checkOnStartup` 默认关 |
| **P4 工程收尾** | 单测补全 + CI + 图标流水线统一 + 打包版本注入 | M5 | 全部 | `npm test` 绿；`build-installer.ps1` 出包 |

**为什么这样排**：注入基础（P1）是 WCO/主题的前提；安全基座（P0）让后续代码天然安全；插件探针（P2 首步）先消最大不确定性。

---

## 3. 新会话执行环境指引（务必先读）

1. **工作区**：把 `D:\Work\Project\dsh-desktop` 设为会话工作区，避免跨目录写入（本会话此前写入该目录需 `danger-full-access` 授权，新会话若在工作区内则无此限制）。
2. **Node/npm**：Node ≥ 18（实际 24.18）。npm 安装命令建议在用户终端执行，或经沙箱授权执行（沙箱内 npm 写 npm-cache 曾被 EPERM）。
3. **参考实现（只读）**：master 归档在 `D:\Work\Project\deepseek-harness-desktop-master`，其 `dsh-plugin-desktop` 与 `dsh-community-market` 是现成 DSH 插件参考（路径见 §4.2）。
4. **目标机无需 npm**：`@deepseek-ai` 依赖仅构建期；最终打包产物自带。
5. **git 纪律**：每个阶段结束 `git add` + `commit`（提交点=回滚点）；禁止在一个提交里混合两个阶段。
6. **验证 DSH 后端**：P2 验证需要 DSH 后端可启动（本机可通过 `npx @deepseek-ai/dsh web --no-open` 或已装 dsh 环境）。当前 `D:\Work\Project\deepseek-harness-desktop-master\deepseek-harness` 子模块为空，若走本地仓库路径需先检出上游。

---

## 4. 关键实现要点（按阶段）

### 4.0 P0 可测性设计
- `main/config.js`：导出 `mergeConfig(defaults, loaded, env)` / `validateConfig(cfg)` 纯函数 + `createConfigStore(deps)`（deps 注入 `userDataPath`/`fs`/`logger`）；
- `main/dsh-server.js`：导出 `resolveLaunch(config.dsh)` 纯函数（返回 `{cmd,args,cwd}`）+ `createDshServer(deps)`（deps 注入 `spawn`/`net`/`http`）；
- `main/lib/escape-html.js`：导出 `escapeHtml(s)`；
- 测试放 `tests/*.spec.mjs`，用 `node:test`，**不 import electron**。

### 4.1 P1 注入基础与 WCO
- `main/inject/index.js`：
  ```js
  const ALLOWED = new Set([DSH_ORIGIN_127, DSH_ORIGIN_LOCALHOST]) // 与 dshUrl origin 比对
  function applyInjections(win, deps) { /* did-finish-load/did-navigate 后 insertCSS + executeJavaScript，仅同源 */ }
  ```
- `inject/titlebar.css`：`.dsh-titlebar{position:fixed;top:0;left:0;right:0;height:env(titlebar-area-height,40px);-webkit-app-region:drag;z-index:2147483000}` + `body{padding-top:env(titlebar-area-height,40px)}`（**仅 Windows WCO 注入**；macOS `hiddenInset` 只注入拖拽区、不注 `env()` 避让）；
- WCO：win32 `{titleBarStyle:'hidden', titleBarOverlay:{color,symbolColor,height:40}}`；darwin `{titleBarStyle:'hiddenInset', trafficLightPosition:{x:15,y:15}}`；其余回退默认标题栏；
- 主题：`nativeTheme.on('updated')` → 更新 `titleBarOverlay.color/symbolColor` + 重注入 `theme.css`（`--dsh-desktop-bg/--dsh-desktop-fg`）。

### 4.2 参考实现路径（只读）
- client 插件入口与 slot 注入：`dsh-plugin-desktop\src\client\index.ts`、`desktop-settings.ts`
- settings section 组件与 Props 契约：`dsh-plugin-desktop\src\client\DesktopSettingsSection.tsx`、`desktop-settings-api.ts`、`desktop-settings-locales.ts`
- 另一个 settings tab 参考：`dsh-community-market\src\client\index.ts`、`MarketSettingsTab.tsx`
- 插件 package.json 的 `dsh.client` 声明：`dsh-plugin-desktop\package.json`、`dsh-community-market\package.json`
- 构建配置：`dsh-community-market\tsdown.config.ts`
> 上述均在 `D:\Work\Project\deepseek-harness-desktop-master\` 下。

### 4.3 P2 插件工程依赖（对齐 market 做法）
`dsh-settings-plugin/package.json` 关键：
```jsonc
{
  "name": "dsh-desktop-settings", "version": "0.1.0", "type": "module",
  "main": "lib/index.js",
  "dsh": { "client": { "inject": [
    "@deepseek-ai/dsh-client-runtime",
    "@deepseek-ai/dsh-client-locale",
    "@deepseek-ai/dsh-client-ui-settings",
    "@deepseek-ai/dsh-client-ui-slots"
  ], "platform": "web" } },
  "dependencies": {},
  "peerDependencies": {
    "@deepseek-ai/dsh-client-runtime": "0.1.1-rc.2",
    "@deepseek-ai/dsh-client-ui-slots": "0.1.1-rc.2",
    "react": "18.3.1"
  },
  "devDependencies": {
    "typescript": "6.0.3", "tsdown": "0.22.2",
    "react": "18.3.1", "@types/react": "^18",
    "@deepseek-ai/dsh-client-runtime": "0.1.1-rc.2",
    "@deepseek-ai/dsh-client-locale": "0.1.1-rc.2",
    "@deepseek-ai/dsh-client-ui-settings": "0.1.1-rc.2",
    "@deepseek-ai/dsh-client-ui-slots": "0.1.1-rc.2"
  }
}
```
命令：`npx tsc -p tsconfig.json --emitDeclarationOnly && npx tsdown`（或 `yarn workspace` 若并入根工程）。**以 master 归档 `dsh-community-market` 实际可构建配置为准**（若版本漂移，回退到其 lockfile）。

### 4.4 P2 最小插件探针（先做，消不确定性）
1. 建最小插件（`apply` 只注册一个 `settings.section` 空分区 + 日志 `console.log('[probe] loaded')`）；
2. `dsh plugin add <本地路径>` 到当前 profile（或手动放进 profile 的 direct bundle）；
3. 启动 DSH web，DevTools Console 确认 `[probe] loaded` + 设置页出现分区；
4. **成功才继续完整插件**；失败则排查：bundle 加载路径、`dsh.client.inject` 契约、cordis loader 是否加载 client bundle（对照 master 归档的 `cordis.patch.yml` 与 `dsh.client` 声明），并记录结论回填本文档 §4.4。

### 4.5 桥客户端竞态与诊断
- `bridge-client.ts`：`await waitFor(() => window.__DSH_DESKTOP__)`（500ms 轮询，最多 10s），再 `fetch(baseUrl+'/api/bridge/info', {headers:{Authorization:'Bearer '+token}})`；
- 错误分级：401→提示重启应用；5xx→显示重试；
- 诊断 `/api/diagnostics` 内容：appVersion、platform/arch、electron/chrome/node 版本、日志文件路径与尾部 50 行、后端 running/port、`config`（剔除 `bridge.token` 与凭据）、最近崩溃证据摘要。

---

## 5. 每阶段验证操作（可执行）

| 阶段 | 验证命令/操作 | 通过标准 |
|---|---|---|
| P0 | `node --test tests/`；`npm start` | 测试绿；应用行为与改造前一致；`%APPDATA%/dsh-desktop/logs/` 有日志 |
| P1 | `npm start`；拖动窗口顶部 40px；最小化/最大化/关闭三键；再启动第二实例 | 标题栏消失、右上三键正常；顶部可拖拽移动窗口；双击第二实例唤起旧窗口；重启后恢复位置 |
| P2 | `curl -s -H "Authorization: Bearer <token>" http://127.0.0.1:<port>/api/state`；无 token 应 401；错 Origin 应 403；打开 DSH 设置页 | token 正确返回 JSON；401/403 生效；设置页出现「桌面」分区，开关即时生效；窗口动作生效；应用无菜单栏 |
| P3 | 托盘触发通知 / `POST /api/updater/check` / `GET /api/diagnostics` / `POST /api/dsh/check-update`（+`/api/dsh/update`） | 通知出现；有新版提示；诊断可复制；检查返回 `{source,currentVersion,latestVersion,hasUpdate}`；更新日志落盘；更新后**自动重启后端** |
| P4 | `npm test`；`powershell -File scripts/build-installer.ps1` | 全绿；`dist/` 出包且版本号与 package.json 一致 |

---

## 6. 风险、回滚与提交点纪律

- **提交点**：P0→P1→P2→P3→P4 各阶段结束各一个 commit；P2 的探针成功/失败结论也要提交（避免重复踩坑）。
- **回滚**：任何阶段失败，`git reset --hard <上一阶段提交>` 即回滚；P1 前 WCO 改动独立于后端逻辑，互不影响。
- **高风险点**：
  - P2 插件加载路径（§4.4 探针先行）；
  - `@deepseek-ai/dsh-client-*` 版本漂移（以 master 归档 lockfile 为准，必要时降级/升级对齐）；
  - WCO 在 Windows 10/11 表现（低版本回退默认标题栏）；
  - 沙箱内 npm（npm 命令在用户终端执行）。
- **不做**：C2/C3（远期），不新增其他范围。

---

## 7. 最终验收清单（对应用户目标）

- [ ] 应用可启动（`npm start` 与打包产物）
- [ ] **无标题栏**：WCO 原生右上三键（最小化/最大化/关闭）
- [ ] 页面顶部标题栏避让 + 拖拽区正常（Windows）
- [ ] **无菜单栏**：应用菜单已移除，设置/查看能力保留（快捷键/托盘/设置页）
- [ ] **设置集成进 DSH 设置页**：出现「桌面」分区，开关/PATCH 读写 Electron 配置生效，窗口控制生效
- [ ] 单实例锁、托盘增强、窗口状态记忆、主题跟随（B 组）
- [ ] 内嵌窗口无 nodeIntegration、回显转义（D 组）
- [ ] `npm test` 绿、打包产物版本正确（工程化）

---

*本文档由本会话审查产出，是实施阶段的唯一执行主文档；与 `architecture.md`（设计总览）配套使用，矛盾时以本文档为准。*

---

## 8. 第二轮审查修订（最新，覆盖前述冲突处）

对三份文档做第二轮审查（技术正确性 / 可执行性 / 一致性），追加以下修正。**本节为最新版本，与前述章节冲突时以本节为准。**

### X1 注入与 DSH 页面自身的 UI 冲突（重要 · P1.3）
- **问题**：全宽 `position:fixed` 拖拽区可能盖住 DSH Web 自带的顶栏按钮（导航/会话切换/设置入口），导致不可点击。
- **修正**：P1.3 注入前**先用 DevTools 观察 DSH Web 实际 header 结构**；拖拽区只覆盖空白区（或 `pointer-events:none` + 仅空白带可拖拽）；`body{ padding-top:env() }` 对 `position:fixed` 的 DSH header 无效时，改为给其 header 选择器加 `margin-top/top` 偏移。验收标准＝**最小覆盖、不挡任何交互**。

### X2 桥设置接口：敏感字段脱敏 + 原子写（重要 · P2.2）
- **问题**：`GET /api/settings` 返回 `dsh.env`/`dsh.proxy` 可能含凭据；直接 `writeFileSync` 写配置可能在中断时损坏。
- **修正**：① `GET /api/settings` 对 `dsh.env` 的**值**、`dsh.proxy` 的**密码段**脱敏（如 `***`），`bridge.token` 永不返回；② PATCH 仅接受白名单字段；③ 配置写盘用**原子写**（写 `config.json.tmp` → `rename`）；④ 设置页「DSH」组仅展示脱敏值。

### X3 插件依赖版本未经实测（重要 · P2.1）
- **问题**：`@deepseek-ai/dsh-client-*@0.1.1-rc.2` 是否在 npm 可用未验证（本会话沙箱内 npm 被 EPERM 拒绝，无法实测）。
- **修正**：P2.1 探针**第一步**执行 `npm view @deepseek-ai/dsh-client-runtime versions` 与 `npm view @deepseek-ai/dsh version`，**以实际可用版本为准**；若无 rc.2，则降级/对齐 `dsh-community-market`（master 归档）的 lockfile 版本，并把最终锁定版本回填本节。

### X4 compareSemver 提前（中 · P0）
- **问题**：原 P4.1 测试 `compareSemver`，但该函数计划在 P3.2（updater）才实现，存在顺序倒挂。
- **修正**：`compareSemver` 并入 **P0.4** `main/lib/`（纯函数、零依赖），P3.2 与 P4.1 直接引用。

### X5 置顶实现点与 close/quit 语义（中 · P1/P2）
- **问题**：`tray.topMost` 未明确实现模块；「关闭=隐藏」与「退出」需严格区分。
- **修正**：置顶在 `main/window.js` 实现（`win.setAlwaysOnTop(config.tray.topMost)`，配置变更即时应用）；`close` 动作仅隐藏（遵守 `closeToTray`），真正退出只经托盘「退出」/`app.quit()`；§15.1 补注释。

### X6 主题注入边界（中 · P1.6）
- **问题**：注入主题变量可能干扰 DSH 自身主题（`dsh-client-ui-theme`）。
- **修正**：主题注入**只作用于窗口 chrome（WCO `color/symbolColor`）与标题栏占位区**；页面内部主题交给 DSH 自身，不覆盖其 CSS 变量。

### X7 拆分回归清单（中 · P0.6）
- **问题**：1271 行 `main.js` 拆分有回归风险。
- **修正**：P0.6 后按功能清单回归——探测链/启动/等待就绪/托盘/全局快捷键/设置窗/API Key 引导/语言切换/退出清理，逐项验证与现状一致。

### X8 headless 冒烟脚本（轻 · P2 后）
- **问题**：`npm start` 需 GUI，自动验证不便。
- **修正**：新增 `npm run smoke`（headless）——加载 `config` 模块 + 启动 bridge server（仅 `/healthz`）+ `resolveLaunch` 探测，输出 JSON 断言；供无 GUI 环境验证 P2 的桥。

### X9 updater 仓库可配（轻 · P3.2）
- **问题**：updater 若写死 GitHub 仓库，可能不是用户实际仓库。
- **修正**：repo 从 `package.json#repository` 读取（缺省 `dsh-community/dsh-desktop`），Gitee 镜像可配。

### X10 `dsh plugin add` 前提检查（轻 · P2.6）
- **问题**：安装插件依赖 profile 可用 / CLI 可用 / 网络，失败时可能静默。
- **修正**：`install-plugin.ps1` 前置检查（`dsh --version`、profile 可写、网络可达），失败给出中文引导；壳启动检测未安装时**引导安装**而非静默失败。
