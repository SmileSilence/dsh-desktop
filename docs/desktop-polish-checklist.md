# DSH Desktop 界面与集成修改·执行施工图

> **执行基线 v10（优先级最高）**：固定使用 `web:3080`，直接支持 Web 已安装及以后新增的插件；禁止插件镜像、禁止创建 `dsh-desktop` profile、禁止向 Web 安装桌面设置插件。3080 健康时复用，否则由桌面启动 `web` profile。删除 Portable 构建，只交付完整 Setup；Setup 必须支持选择目录、取消安装、桌面/开始菜单快捷方式和卸载。下方旧表中与此基线冲突的 M3 专用 profile、3092、插件启停及 Portable 项全部视为已废止。

> 依据：`docs/desktop-polish-design.md`（**设计文档，含可直接照抄的代码骨架；矛盾时以此为准**）+ 本表（逐文件任务清单与验收）
> 状态：**可执行**（新会话按 §8 执行指引 + 本表实施，每阶段独立提交）
> 范围：Windows 专用（mac 分支不动，已确认）；Electron 35.7.5
> 基线：P0–P4 已完成（64 单测全绿、打包产物 1.0.0 可运行）
> **执行前必读**：设计文档 §8 两阶段打包门禁 + §9 新会话执行指引（工作区/环境/3080 后端勿动/probe 工具/git 纪律）

---

## M1 自绘标题栏 + 无滚动（修改 1 + 修改 4 · 共用标题栏注入层 · 一个提交）

| 任务 | 文件 | 改动 | 验收 |
|---|---|---|---|
| M1.1 | `main/window.js` | `windowConfigFor` win32 分支返回 `{frame:false}`，删除 WCO overlay；`applyThemeToChrome` 保留（win32 下改为更新注入 CSS 变量） | `windowConfigFor('win32')` 无 titleBarOverlay；非 win32 分支不变 |
| M1.2 | `preload.js` | 新增 `maximizeToggle()`→`window-maximize-toggle`、`closeWindow()`→`window-close` | contextBridge 暴露两新方法 |
| M1.3 | `main/index.js` | 新增 IPC：`window-maximize-toggle`（isMaximized?unmaximize:maximize）、`window-close`（走 closeToTray 语义）；`maximize`/`unmaximize` 事件 → `webContents.send('window-maximized-changed', bool)` | 三键动作生效；关闭遵守 closeToTray |
| M1.4 | `main/inject/titlebar.css` | 删除 `body{padding-top}`；标题栏 fixed；对 probe 确认的 `#root` 使用 `height:100%;box-sizing:border-box;padding-top:40px` 在容器内部预留空间，禁止遮挡顶部内容或用全局 overflow 掩盖 | body 不增高；顶部内容可见；DSH 内部滚动正常 |
| M1.5 | `main/inject/titlebar.js`（新增） | 三键使用 inline SVG（不使用字体方框）+ 绑定；监听最大化状态切换 maximize/restore SVG；不访问 process，由 main 仅在 win32/同源页注入 | SVG 清晰；三键可点；sandbox 无错误 |
| M1.6 | `main/inject/theme-observer.js`（新增） | 以 `body[data-ds-dark-theme]` 为正式信号，监听 body/html 属性；读取 `--dsw-*` 计算值并 `reportTheme({theme,palette})` 给宿主层；页面内标题栏直接引用 `--dsw-*` | 切主题标题栏与宿主层同步 |
| M1.7 | `main/inject/index.js` | `applyInjections` 注入 `titlebar.js` + `theme-observer.js`（仅 win32 + 同源白名单）；注入顺序 win11.css → titlebar.css → titlebar.js → theme-observer.js | 注入脚本随 did-finish-load 生效 |
| M1.8 | `tests/window.spec.mjs` | `windowConfigFor('win32')` 断言改 `{frame:false}`；新增 titlebar 脚本静态结构断言 | 单测绿 |

**验收**：无原生标题栏；自绘三键（最小化/最大化还原/关闭）可用；最大化符号切换；拖拽移动正常；
注入后无垂直滚动条；DSH 内部滚动容器（会话列表）仍可滚动；**标题栏配色为 DSH 品牌色，且跟随 DSH 设置页主题切换实时变换**；`npm test` 全绿；冒烟正常。

---

## M2 图标统一（修改 3 · 独立提交）

| 任务 | 文件 | 改动 | 验收 |
|---|---|---|---|
| M2.1 | `assets/icon-source.png`（新增） | 复制 `C:\Users\19163\Downloads\Q2_docs_抱书.png` → 本文件（git 跟踪） | 源图入库 |
| M2.2 | `scripts/make-icons.mjs`（新增） | Electron offscreen 读源图 → capturePage 缩放 512/256/128/64/48/32/16 → 写 `assets/icon-{size}.png` → 复用 pack-ico 逻辑合成 `app.ico`+`icon.ico` | 一套命令出全部图标 |
| M2.3 | `main/window.js` / `main/tray.js` | 窗口 icon / 托盘 icon 引用改为新生成图标（icon-256.png / 16px 同源） | 窗口/托盘图标一致 |
| M2.4 | `package.json` | `build.win.icon` → `assets/app.ico` | 出包 exe 图标正确 |
| M2.5 | `installer.nsi` / `portable.nsi` | `MUI_ICON` / `Icon` → `assets/app.ico` | Preview 阶段验证 Portable 图标；Setup 图标在用户确认后验证 |
| M2.6 | `scripts/render-icon.mjs` | 换源为 `icon-source.png`（删 favicon 渲染路径）；`favicon-dsh.svg` 保留不删 | 无旧源残留 |

**验收**：`npm run icons` 产出 7 尺寸 PNG + ICO；Preview 解压目录/Portable 的 exe、任务栏、托盘均为「抱书」图（人工截图确认）；Setup 图标留到用户确认后的阶段 B 验证。

---

## M3 插件生命周期（修改 2 · 方案 A · 独立提交）

| 任务 | 文件 | 改动 | 验收 |
|---|---|---|---|
| M3.1 | `main/plugin-lifecycle.js`（新增） | `resolvePluginPayloadPath` + `bootstrapWebProfile`（幂等添加与当前 CLI 同源/同版本的 `dsh-web-app`）+ 插件 remove→add + uninstall；固定桌面专用 profile | 新 profile 可启动 Web；路径与三路 CLI 可测；argv 不拼 shell |
| M3.2 | `main/config.js` | `integration:{autoInstallPlugin:true,desktopProfile:'dsh-desktop',dedicatedBackend:true}`；校验拒绝 `web/default` | 浏览器 profile 不会被修改 |
| M3.3 | `main/index.js` / `main/dsh-server.js` | 严格按“ensure 插件→启动桌面专用后端/独立端口→创建页面”；禁止复用 3080；`before-quit` preventDefault 后 await 销毁 views/停止后端/uninstall，再二次 quit | 壳内插件生效；浏览器 3080 始终干净；退出清理可等待 |
| M3.4 | M5 打包公共逻辑 | 把插件 `package.json`、`cordis.patch.yml`、`lib/**` 复制到 `resources/dsh-settings-plugin`（app.asar 外） | 离线打包态可安装插件 |
| M3.5 | 独立 probe + `tests/plugin-lifecycle.spec.mjs` | probe 验证 client.js/Boot 图/设置分区；单测覆盖开发/打包路径、web-app bootstrap、三路 argv、remove→add、禁用 profile、退出清理只执行一次 | 新 profile 真能加载 Web 与插件；单测绿 |

**验收**：桌面专用 profile/后端包含插件；浏览器 `web:3080` 在壳运行期间和退出后均无桌面分区；退出先停专用后端再卸载；崩溃残留不影响浏览器；打包态离线可定位插件 payload。

---

## M4 多实例页签 + Win11 风格（修改 5 + 修改 6 · 最后独立提交 · 风险最高）

### M4a 多实例页签（修改 5）

| 任务 | 文件 | 改动 | 验收 |
|---|---|---|---|
| M4a.1 | `main/window.js` | 主窗口改 `BaseWindow`（无边框）+ 固定顶部 `titlebarView` + 可布局 `tabbarView` + 多个内容 view；保留状态记忆/越界回退；加 Mica 回退 | 两个矩形宿主 View 不遮内容；状态记忆保留 |
| M4a.2 | `main/tabs.js`（新增） | `createTab()/closeTab(id)/activateTab(id)/getTabs()` + 事件；实例=WebContentsView | 页签增删/激活/遍历可测 |
| M4a.3 | `main/config.js` | 新增 `window.tabPosition: 'top'\|'left'\|'right'`（默认 top） | 配置校验通过 |
| M4a.4 | `main/chrome/index.html` + `titlebar.*` + `tabbar.*`（新增） | 本地 titlebarView/tabbarView 分别渲染三键和页签；`data-position` 驱动 top/left/right；M1 页面内标题栏迁移后删除 | 两个矩形 View 不遮内容；无双标题栏；三种布局正确 |
| M4a.5 | `main/tray.js` | 常驻单托盘；菜单动态重建实例列表（勾选当前）+ 新建实例 + 全部退出 | 单托盘含实例列表 |
| M4a.6 | `main/index.js` | **保留单实例锁**；主进程 second-instance → 新建页签并聚焦；IPC `tab-*`；页签关闭与窗口 closeToTray 分离 | 第二次启动进入同窗口新页签；任务栏单一项 |
| M4a.7 | `main/chrome/preload.js` / 内容页 `preload.js` | Chrome preload 暴露三键/页签 API；内容 preload 仅保留桥与主题上报 | 两个 contextBridge 均最小权限 |
| M4a.8 | `tests/tabs.spec.mjs`（新增）+ `tests/window.spec.mjs` | 页签增删/激活/位置配置单测；window 断言改 BaseWindow | 单测绿 |
| M4a.9 | `main/index.js` 全量审计 | 替换 `mainWindow.webContents/loadURL`、`BrowserWindow.fromWebContents`、DevTools/Reload 等假设；IPC sender 必须属于登记的 titlebarView/tabbarView/内容 view | BaseWindow 下无旧 API 崩溃；伪造 sender 被拒绝 |

**验收**：可开多实例；页签切换/新建/关闭；位置 top/left/right 可配生效；托盘单图标含实例列表；任务栏单一项。

### M4b Win11 控件形态 + DSH 品牌配色（修改 6）

| 任务 | 文件 | 改动 | 验收 |
|---|---|---|---|
| M4b.1 | `main/inject/win11.css`（新增） | `--dsh-*` 仅作为 `--dsw-*` 的别名与回退；禁止硬编码紫色；增加圆角类（`.dsh-radius-btn` 4px / `.dsh-radius-card` 8px） | DSH 切主题后令牌自动重算 |
| M4b.2 | `main/chrome/titlebar.css`/`tabbar.css` | 两个宿主 View 接收经主进程校验的 `dsh-theme-changed` 色板；关闭键 hover `#c42b1c`；激活强调使用 `state-business-primary` | 标题栏/页签栏与 DSH 实际主题一致 |
| M4b.3 | `main/window.js` | `chromeColorsFor` 改 DSH 品牌色；主窗口 `backgroundMaterial:'mica'`（`isWin11()` 判断） | 亮暗两套色正确；Mica 生效/回退 |
| M4b.4 | `main/index.js` | 内嵌窗（API Key/设置/加载）HTML style 换 `--dsh-*` 令牌 + Win11 圆角；`isDarkMode` 驱动 `data-theme` | 内嵌窗 DSH 品牌 + Win11 形态 |
| M4b.5 | probe/冒烟 | 亮/暗截图核对标题栏/页签栏/内嵌窗（人工确认） | 配色与 DSH 页面一体；形态贴近 Win11 |

**验收**：标题栏/页签栏/内嵌窗使用 DSH `--dsw-*` 主题令牌（深色背景 #151517、浅色背景 #ffffff；强调色为 DeepSeek 蓝，**不得出现 #1c00cf 紫色**），与 DSH 页面一体；
控件圆角/hover/关闭键红符合 Win11 规范；Mica 在 Win11 生效、Win10 回退纯色。

---

## M5 两阶段打包与用户确认门禁（强制）

| 任务 | 文件 | 改动 | 验收 |
|---|---|---|---|
| M5.1 | `scripts/build-common.ps1`（新增） | 抽出版本注入、Electron 文件复制、app.asar 组装、插件构建/外部 payload 复制和产物校验；不自行删除目录 | Preview/Setup 共用逻辑；`resources/dsh-settings-plugin` 完整 |
| M5.2 | `package.json` / `scripts/build-preview.ps1` | SemVer minor 升级；彻底结束本项目 dist 内全部进程树并确认归零；安全彻底删除整个 dist，验证目录不存在后重建；组装解压目录/Portable；manifest 覆盖插件 payload | 无进程/文件残留；版本不回退；无 Setup；插件文件全入清单 |
| M5.3 | `scripts/build-installer.ps1` | 改为必须传 `-FromValidatedPreview`；禁止清理/重组 `dist`；验证 manifest 哈希后只编译 `installer.nsi` | 未确认或哈希变化时拒绝；成功时只新增 Setup |
| M5.4 | `scripts/verify-preview.ps1`（新增） | 验证文件新增/缺失/变化、版本、大小、SHA-256；确认不存在 Setup；可选启动解压版 | 自动门禁全绿 |
| M5.5 | `README.md` / `docs/user-guide.md` / 设置插件帮助入口 | 写安装、配置、页签、托盘、主题、插件隔离、Preview 验证和故障排查 | 用户无需读源码即可使用 |
| M5.6 | 人工确认 | 提供 Preview/Portable 路径、版本、大小、SHA-256 和验收清单；等待明确确认 | 用户未确认前不得执行 M5.7 |
| M5.7 | 最终 Setup | 仅在用户明确确认后执行 `build-installer.ps1 -FromValidatedPreview`；临时目录安装冒烟；追加 Setup SHA-256 | Setup 与已确认 Preview 内容一致 |

**彻底清理与删除安全规则**：先递归结束可执行路径位于本项目 `dist` 下的所有进程树并复查为 0；再用 `[IO.Path]::GetFullPath()` 解析删除目标，必须严格等于 `D:\Work\Project\dsh-desktop\dist` 且父目录严格等于项目根；彻底递归删除后验证目录不存在。不得使用未解析变量、通配符、`$HOME` 或工作区根作为删除目标，不得触碰其他安装位置和 3080 后端。

---

## §5 验证操作（每阶段）

| 阶段 | 验证命令/操作 | 通过标准 |
|---|---|---|
| M1 | `npm test`；`npm start` 冒烟；probe 复测滚动 | 单测绿；无滚动条；三键可用；拖拽正常 |
| M2 | `npm run icons`；开发态启动；M5 Preview 阶段人工看 exe/任务栏/托盘图标 | 三处图标一致为「抱书」图 |
| M3 | `npm test`；启动/退出壳观察专用 profile/端口；同时用浏览器访问 3080；打包态路径 probe | 桌面 bundles 生效；浏览器运行前后都干净；退出清理完成 |
| M4a | `npm test`；开 2–3 实例：切页签/新建/关闭；托盘列表；任务栏项数 | 多实例页签正常；托盘单图标；任务栏单一项 |
| M4b | 亮/暗切换截图；Win11/Win10 材质表现 | 配色圆角贴近 Win11；材质回退正确 |
| M5 Preview | `build-preview.ps1`；`verify-preview.ps1`；启动解压版/Portable | 旧 dist 进程树归零且旧目录彻底删除后重建；版本 1.1.0 或更高；无 Setup；插件 payload 在 manifest；用户可验证 |
| M5 Setup | **用户确认后** `build-installer.ps1 -FromValidatedPreview` | manifest 未变化；只新增 Setup；安装冒烟通过 |

---

## §6 执行顺序与提交点

1. **M1**（修改 4 + 修改 1）一个提交 → `git commit -m "feat: 自绘标题栏 + 无滚动（替换 WCO 三键）"`；
2. **M2**（图标）一个提交 → `git commit -m "feat: 图标统一（抱书源图，exe/任务栏/托盘一致）"`；
3. **M3**（插件生命周期）一个提交 → `git commit -m "feat: settings 插件随壳装/卸（方案 A）"`；
4. **M4**（多实例页签 + Win11 形态/DSH 配色）一个提交 → `git commit -m "feat: 多实例页签（top/left/right）+ DSH 品牌配色（Mica/Win11 形态）"`；
5. **M5 脚本改造**一个提交 → `git commit -m "build: 增加 Preview 确认门禁并拆分 Setup 打包"`；
6. 每步 `npm test` + 冒烟；M4 后全量回归；
7. 执行 M5 Preview：安全删除旧 `dist`，生成解压版/Portable/manifest，明确停止并等待用户确认；
8. 用户确认后才执行 M5 Setup；
9. 全部完成后更新 `docs/implementation-roadmap.md` §7 验收清单并提交。

---

## §7 风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| 自绘三键/页签样式与 DSH 页面主题冲突 | 按钮/页签不可见 | 最高 z-index + DSH `--dsw-*` 主题令牌；注入前 probe 确认 |
| `frame:false`/BaseWindow 后拖拽缩放异常 | 无法拖动窗口 | `-webkit-app-region:drag` 覆盖层；保留 min 尺寸；WebContentsView 布局实测 |
| 多实例内存/后端争用 | 多页面同后端 | 实例共享一个 DSH 后端（端口复用）；WebContentsView 懒加载（激活才 load） |
| 单实例路由错误 | 第二次启动变成第二进程/第二托盘 | 保留 `requestSingleInstanceLock`；仅在主进程的 `second-instance` 新建页签 |
| 插件 CLI 失败（网络/权限） | 装不上/卸不掉 | 失败仅日志+通知；幂等 ensure 兜底；多实例只装/卸一次 |
| 桌面误用 web/default profile | 浏览器出现桌面插件 | 配置校验硬拒绝；桌面固定专用 profile + 独立端口；不复用 3080 |
| 图标缩放失真（1024→16px） | 小尺寸模糊 | 保留源图 1024；16px 高质量缩放；托盘实测 |
| Mica 检测或材质不可见 | 无材质/观感不一致 | 解析 `10.0.<build>` 且 build≥22000；非 Win11或不可见时回退 DSH 实色，不阻断验收 |
| 误删非本项目输出 | 数据损失 | M5 严格校验 dist 绝对路径和父目录；不使用通配符；仅清理本项目 dist |
| 用户确认后内容又变化 | Setup 与确认版不一致 | manifest SHA-256 门禁；变化即失败，必须重新生成 Preview 并重新确认 |

**回滚**：每阶段独立提交，`git reset --hard <上一阶段提交>` 即回滚；M4 涉及窗口/托盘重构，M1–M3 均在其之前提交，可单独回滚。`dist` 是生成物，不通过 Git 恢复；如 Preview 需重建，必须重新走用户确认。

---

## §8 新会话执行指引（与设计文档 §9 一致，此处为速查）

1. **工作区**：目标项目 `D:\Work\Project\dsh-desktop`（当前会话工作区 `deepseek-harness-desktop-master` 只是只读参考，勿写）；
2. **测试**：`npm test`（`node --test "tests/*.spec.mjs"`）；入口 `electron .`；
3. **后端**：`127.0.0.1:3080` 是浏览器 `web` profile，仅用于对照/probe，**勿杀、勿重启、勿安装桌面插件**；最终桌面壳必须启动自己的 `dsh-desktop` profile 和独立端口，不得复用 3080；
4. **代码骨架**：每个 M 阶段涉及的新文件/改动，设计文档对应章节已给出可照抄的 JS/CSS 骨架，直接使用；
5. **probe 工具**：临时脚本放 `scripts/`，跑完即删；Electron offscreen 方式见设计文档 §9；
6. **git**：每阶段一个提交；`git reset --hard <上一阶段>` 回滚；提交信息模板见 §6；
7. **图标源**：`C:\Users\19163\Downloads\Q2_docs_抱书.png` → 复制到 `assets/icon-source.png`；
8. **依赖**：M1/M2/M4 零新 npm 依赖；M3 用 child_process。

---

*本文档与 `desktop-polish-design.md` 配套使用；实施顺序与任务格以本表为准。*
