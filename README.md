# DSH Desktop - DeepSeek Harness 桌面客户端

<div align="center">

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)

**类 ChatGPT 桌面客户端 - AI 助手**

</div>

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
| 📦 **多平台打包** | 支持 Windows/macOS/Linux |

---

## 📋 系统要求

- **Windows**：Windows 10 或更高版本
- **Node.js**：>= 18.0.0
- **npm**：>= 9.0.0
- **DSH Web**：需要运行中（默认端口 3080）

---

## 🚀 快速开始

### 方式1：开发模式运行

```bash
# 1. 克隆项目
git clone <repository-url>
cd dsh-desktop

# 2. 安装依赖
npm install

# 3. 启动应用
npm start

# 或者以开发者模式启动（带 DevTools）
npm run dev
```

### 方式2：打包成安装包

```bash
# Windows 安装包
npm run build:win

# Windows 便携版
npm run build:win:portable

# macOS
npm run build:mac

# Linux
npm run build:linux
```

打包后的文件位于 `dist/` 目录。

---

## ⌨️ 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+Shift+D` | 全局呼出/隐藏窗口 |
| `Ctrl+N` | 新建对话 |
| `Ctrl+,` | 打开设置 |
| `Ctrl+Q` | 退出应用 |
| `F11` | 全屏切换 |
| `F12` | 打开开发者工具 |
| `Ctrl+R` | 重新加载页面 |
| `Ctrl+=` | 放大 |
| `Ctrl+-` | 缩小 |
| `Ctrl+0` | 重置缩放 |

---

## ⚙️ 配置说明

### 应用配置

配置文件位置：`%APPDATA%/dsh-desktop/config.json`

```json
{
  "autoLaunch": false,
  "closeToTray": true,
  "showInTaskbar": true,
  "topMost": false,
  "darkMode": true,
  "hotkey": "CommandOrControl+Shift+D",
  "language": "zh-CN"
}
```

### 配置项说明

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `autoLaunch` | boolean | `false` | 开机自启动 |
| `closeToTray` | boolean | `true` | 关闭窗口时隐藏到托盘 |
| `showInTaskbar` | boolean | `true` | 在任务栏显示图标 |
| `topMost` | boolean | `false` | 窗口置顶 |
| `darkMode` | boolean | `true` | 深色模式 |
| `hotkey` | string | `CommandOrControl+Shift+D` | 全局快捷键 |
| `language` | string | `zh-CN` | 语言设置 |

### 修改 DSH 服务地址

编辑 `main.js`：

```javascript
const DSH_URL = 'http://127.0.0.1:3080';
```

---

## 📁 项目结构

```
dsh-desktop/
├── main.js              # Electron 主进程
├── preload.js           # 预加载脚本
├── package.json         # 项目配置
├── README.md            # 项目文档
├── LICENSE              # 开源协议
├── assets/              # 资源文件
│   ├── icon.ico         # Windows 图标
│   ├── icon.icns        # macOS 图标
│   └── icon.png         # 通用图标
└── dist/                # 打包输出
    ├── DeepSeek Harness-1.0.0-Setup.exe
    └── DeepSeek Harness-1.0.0-Portable.exe
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

Made with ❤️ by DSH Community

</div>
