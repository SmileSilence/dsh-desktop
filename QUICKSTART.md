# 🚀 快速开始 - 3 种方式获得桌面体验

## 方式1：一键安装（推荐）

```bash
cd dsh-desktop
start.bat
```

首次运行会自动安装依赖并启动。

---

## 方式2：手动运行

```bash
cd dsh-desktop
npm install
npm start
```

---

## 方式3：打包成安装包

```bash
cd dsh-desktop
npm install
npm run build:win
```

生成的 `dist/DSH Desktop Setup.exe` 可以分享给其他人安装。

---

## 🎨 添加自定义图标

1. 在 `assets/` 目录放置 `icon.png`（256x256 或 512x512）
2. 重新打包即可

或者运行图标生成脚本：
```bash
npm install canvas --save-dev
node create-icon.js
```

---

## ⚡ 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+Shift+D` | 全局呼出/隐藏窗口 |
| 鼠标点击托盘图标 | 显示/隐藏窗口 |
| 右键托盘图标 | 显示菜单 |

---

## 🔧 自定义配置

编辑 `main.js` 文件：

```javascript
const DSH_URL = 'http://127.0.0.1:3080';  // 修改 DSH 地址
const HOTKEY = 'CommandOrControl+Shift+D'; // 修改快捷键
```

---

## 🎯 功能特性

✅ 独立窗口（不占用浏览器标签）  
✅ 系统托盘（最小化不占任务栏）  
✅ 全局快捷键（随时呼出）  
✅ 关闭窗口隐藏到托盘（不退出）  
✅ 透明标题栏（现代 UI）  
✅ 打包成 .exe 安装包（可分发）  

---

## 📦 依赖说明

- Node.js >= 18
- npm 或 pnpm
- `@deepseek-ai/dsh` 已全局安装（`npm i -g @deepseek-ai/dsh`）或可通过 `npx` 访问

---

## 🐛 常见问题

**Q: 启动后白屏？**  
A: 应用会自动启动 DSH Web 服务，首次启动可能需要等待 10-30 秒。如果仍然白屏，检查端口 3080 是否被其他程序占用。

**Q: 提示"DSH Web 服务启动失败"？**  
A: 确保已安装 Node.js 且 `npx @deepseek-ai/dsh web` 能正常运行。可先在终端测试：`npx @deepseek-ai/dsh web --no-open`。

**Q: 快捷键不生效？**  
A: 可能被其他软件占用，修改 `main.js` 中的 `HOTKEY`。

**Q: 如何开机自启？**  
A: 打包后的应用在设置中开启"开机自启"选项。
