# DSH Desktop - DeepSeek Harness 桌面客户端

<div align="center">

![Version](https://img.shields.io/badge/version-1.1.1-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-lightgrey)

**类 ChatGPT 桌面客户端 - AI 助手**

</div>

---

## 📥 下载安装包

前往 [Releases](https://github.com/SmileSilence/dsh-desktop/releases) 下载最新版 Windows 安装包：

- `DeepSeek Harness-<版本>-Setup.exe`（NSIS 安装包，双击安装，可自定义安装目录）

> 安装包内**不内置 DSH 后端**，目标电脑需已安装 DeepSeek Harness（dsh）环境，或已安装 Node.js（>= 22）可联网（应用会自动拉起后端）。

---

## ✨ 功能特性

| 功能 | 说明 |
|------|------|
| 🖥️ **独立窗口** | 原生桌面体验，不占用浏览器标签 |
| ⌨️ **全局快捷键** | `Ctrl+Shift+D` 随时呼出/隐藏窗口 |
| 🎯 **系统托盘** | 最小化到托盘，不占用任务栏 |
| 🚀 **开机自启** | 可选开机自动启动 |
| 🎨 **深色主题** | 优雅的深色界面设计 |
| 🌐 **中文支持** | 完整的中文菜单和设置 |
| ⚙️ **丰富设置** | 窗口、托盘、快捷键等可配置 |
| 🗂️ **单窗口多页签** | 顶部、左侧、右侧三种页签布局，单任务栏与单托盘 |
| 🔌 **插件直通** | 直接使用 `web:3080`，Web 安装的插件无需复制即可使用 |
| ⚙️ **内置页签** | 设置、关于集成到主窗口页签，语言通过下拉菜单选择 |

---

## 📋 系统要求

- **Windows**：Windows 10 或 Windows 11（不再支持 macOS/Linux）
- **Node.js**：>= 22.0.0
- **npm**：>= 9.0.0
- **DSH CLI**：使用 `web` profile；若 3080 已运行则直接复用

---

## 🚀 快速开始

### 方式1：开发模式运行

```bash
# 1. 克隆项目
git clone https://github.com/SmileSilence/dsh-desktop.git
cd dsh-desktop

# 2. 安装依赖
npm install

# 3. 启动应用
npm start

# 或者以开发者模式启动（带 DevTools）
npm run dev
```

### 方式2：生成待确认 Preview

```bash
npm run build
```

打包后的文件位于 `dist/` 目录。

### 方式3：确认后生成安装包

先按 [用户指南](docs/user-guide.md) 验证 Preview；明确确认后才可执行带 `-FromValidatedPreview` 的安装包脚本。

> ⚠️ **重要**：本客户端直接使用 `web` profile（`http://127.0.0.1:3080`），Web 插件会直接共享，
> **不内置 DSH 后端**。目标电脑需要满足以下任一条件才能正常使用：
>
> 1. **已安装 DeepSeek Harness（dsh）环境** —— 直接使用，应用会自动拉起本地后端；或
> 2. **已安装 Node.js（>= 22）且可联网** —— 应用会通过 `npx @deepseek-ai/dsh` 自动拉取后端；或
> 浏览器使用的 `web:3080` 不会被桌面端复用、修改或停止。
>
> 不满足以上条件时，应用会给出明确的错误提示（不会白屏卡死）。

**首次启动引导**：应用会检测模型 API Key。若 `~/.dsh/.credentials.yaml` 或环境变量
`DEEPSEEK_API_KEY` 中未配置密钥，会弹出引导窗口，可填写 DeepSeek API Key 或选择稍后
在 DSH 界面「模型设置」中配置。

---

## ⌨️ 快捷键

> 全局快捷键均可在 设置 → 快捷键设置 中修改，或**双击左侧标题**设为「不设置」。

| 快捷键（默认） | 功能 |
|--------|------|
| `Ctrl+Shift+D` | 全局呼出/隐藏窗口 |
| `Ctrl+,` | 打开设置 |
| `F1` | 打开关于 |
| `Ctrl+Shift+R` | 重启后端 |
| `Ctrl+T` | 新建页签 |
| `F12` / `Ctrl+Shift+I` | 打开开发者工具 |
| `Ctrl+R` | 重新加载当前页签 |

---

## ⚙️ 配置说明

### 应用配置

配置文件位置：`%APPDATA%/dsh-desktop/config.json`

```json
{
  "window": { "width": 1200, "height": 800, "tabPosition": "top" },
  "theme": { "mode": "system" },
  "tray": { "autoLaunch": false, "closeToTray": true, "showInTaskbar": true, "topMost": false },
  "hotkey": "CommandOrControl+Shift+D",
  "hotkeySettings": "CommandOrControl+,",
  "hotkeyAbout": "F1",
  "hotkeyRestartBackend": "CommandOrControl+Shift+R",
  "hotkeyNewTab": "CommandOrControl+T",
  "language": "zh-CN",
  "dsh": { "path": "", "port": 3080 }
}
```

> 热键留空字符串 = 禁用该快捷键；`dsh.path` 指向 DSH 仓库路径，留空自动探测。

### 修改 DSH 服务地址

在 设置 → DSH 路径设置 中填写 `dsh.path`，或编辑配置文件中的 `dsh.path` 字段。

---

## 📁 项目结构

```
dsh-desktop/
├── main.js              # Electron 主进程入口
├── main/                # 主进程模块（窗口/页签/托盘/桥接/热键等）
├── preload.js           # 预加载脚本
├── package.json         # 项目配置
├── README.md            # 项目文档
├── LICENSE              # 开源协议
├── assets/              # 资源文件（图标等）
└── dist/                # 打包输出
    └── DeepSeek Harness-1.1.1-Setup.exe
```

---

## 🎨 界面预览

### 主窗口

```
┌─────────────────────────────────────────────────────────┐
│  ● ● ●                              DeepSeek Harness   │
├─────────────────────────────────────────────────────────┤
│  文件  编辑  查看  窗口  帮助                            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│         🤖 DeepSeek Harness                            │
│                                                         │
│    ┌─────────────────────────────────────────────┐     │
│    │  在这里输入消息...                           │     │
│    └─────────────────────────────────────────────┘     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 托盘菜单

```
┌─────────────────────┐
│ 显示主窗口          │
│─────────────────────│
│ 设置                │
│─────────────────────│
│ 关于                │
│─────────────────────│
│ 退出                │
└─────────────────────┘
```

### 设置界面

```
┌─────────────────────────────────────┐
│           设置                       │
├─────────────────────────────────────┤
│  常规设置                            │
│  ├─ 开机自启动          [开关]       │
│  ├─ 关闭时隐藏到托盘    [开关]       │
│  └─ 窗口置顶            [开关]       │
├─────────────────────────────────────┤
│  语言设置                            │
│  └─ 中文                [选中]       │
├─────────────────────────────────────┤
│  快捷键设置                          │
│  └─ 呼出/隐藏      [Ctrl+Shift+D]   │
├─────────────────────────────────────┤
│              [应用]                  │
└─────────────────────────────────────┘
```

---

## 🛠️ 开发指南

### 环境准备

```bash
# 安装 Node.js (推荐使用 nvm)
nvm install 20
nvm use 20

# 安装项目依赖
npm install

# 启动开发模式
npm run dev
```

### 打包配置

打包使用 `electron-builder`，配置在 `package.json` 的 `build` 字段。

**自定义图标：**

1. 准备图标文件（推荐 256x256 以上）
2. Windows：转换为 `.ico` 格式
3. macOS：转换为 `.icns` 格式
4. 放置到 `assets/` 目录

**图标转换工具：**
- [icoConvert](https://icoconvert.com/) - 在线 ICO 转换
- [icnsConvert](https://icnsconvert.com/) - 在线 ICNS 转换

---

## 🔧 故障排除

### 问题：启动后白屏

**原因**：DSH Web 服务未运行

**解决**：
1. 确保 DSH 服务已启动：`http://127.0.0.1:3080`
2. 或修改 `main.js` 中的 `DSH_URL` 地址

### 问题：快捷键不生效

**原因**：快捷键被其他软件占用

**解决**：
1. 打开设置，修改快捷键
2. 或编辑 `main.js` 中的 `HOTKEY` 常量

### 问题：托盘图标不显示

**原因**：图标文件缺失或格式错误

**解决**：
1. 确保 `assets/icon.png` 存在
2. 图标建议尺寸：64x64 或 128x128
3. 重新启动应用

### 问题：打包失败

**原因**：依赖未安装完整

**解决**：
```bash
# 清除缓存
rm -rf node_modules
rm package-lock.json

# 重新安装
npm install

# 重新打包
npm run build:win
```

---

## 📝 更新日志

### v1.0.0 (2026-08-21)

- ✨ 初始版本发布
- ✨ 独立窗口支持
- ✨ 系统托盘功能
- ✨ 全局快捷键
- ✨ 中文界面支持
- ✨ 设置页面
- ✨ Windows 安装包打包

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 项目
2. 创建特性分支：`git checkout -b feature/amazing-feature`
3. 提交更改：`git commit -m 'Add amazing feature'`
4. 推送分支：`git push origin feature/amazing-feature`
5. 提交 Pull Request

---

## 📄 许可证

本项目基于 [MIT License](LICENSE) 开源。

---

## 🙏 致谢

- [Electron](https://www.electronjs.org/) - 跨平台桌面框架
- [DeepSeek](https://www.deepseek.com/) - AI 模型服务
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) - Agent 框架

---

<div align="center">

**享受类 ChatGPT 的桌面体验！** 🚀

Made with ❤️ by SmileSilence

</div>
