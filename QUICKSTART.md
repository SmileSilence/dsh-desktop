# 🚀 快速开始

DSH Desktop 是 DeepSeek Harness 的桌面客户端（Electron 壳），连接 `http://127.0.0.1:3080` 的 DSH Web 服务。

---

## 方式1：开发模式运行

```bash
cd dsh-desktop
npm install
npm start
```

---

## 方式2：一键构建两个分发版本（推荐）

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-installer.ps1
```

完全离线构建（不依赖网络），产出两个文件到 `dist/`：

| 产物 | 说明 |
|------|------|
| `DeepSeek Harness-1.0.0-Setup.exe` | **安装程序**：中文向导、免管理员、桌面/开始菜单快捷方式、卸载程序 |
| `DeepSeek Harness-1.1.1-Setup.exe` | **完整安装包**：支持选择目录、取消、快捷方式与卸载 |

### 手动重新打包

改过 `main.js` / `package.json` / 图标后，重新运行上面的脚本即可。
图标：把 `assets/icon-512.png` 替换为你自己的 512x512 PNG，重新构建即可生效
（窗口、托盘、快捷方式、安装器图标都会自动使用）。

---

## ⚠️ 目标电脑使用前提（重要）

本客户端**不内置 DSH 后端**，只是前端壳。目标电脑需满足以下任一条件：

1. **已安装 DeepSeek Harness（dsh）环境** —— 应用会自动拉起本地后端；或
2. **已安装 Node.js（>= 22）且可联网** —— 应用自动通过 `npx @deepseek-ai/dsh` 拉取后端；或
3. **已有 DSH Web 服务运行在 3080 端口** —— 应用直接连接。

不满足时，应用会弹出明确的中文错误提示（不会白屏卡死）。

---

## 🔑 首次启动：配置 API Key

应用启动后会自动检测模型密钥：

- 已配置（`~/.dsh/.credentials.yaml` 或环境变量 `DEEPSEEK_API_KEY`）→ 跳过引导；
- 未配置 → 弹出引导窗口，可填写 DeepSeek API Key 写入本机凭据文件，或选择"稍后配置"（在 DSH 界面「模型设置」中配置）。

---

## ⌨️ 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+Shift+D` | 全局呼出/隐藏窗口 |
| `Ctrl+N` | 新建对话 |
| `Ctrl+,` | 打开设置 |
| `Ctrl+Q` | 退出应用 |
| `F11` | 全屏切换 |
| 鼠标点击托盘图标 | 显示/隐藏窗口 |

---

## 🔧 自定义配置

编辑 `main.js` 文件：

```javascript
const DSH_URL = 'http://127.0.0.1:3080';  // 修改 DSH 地址
const HOTKEY = 'CommandOrControl+Shift+D'; // 修改快捷键
```

---

## 📦 依赖说明（仅构建/开发机需要）

- Node.js >= 22
- npm / pnpm（项目依赖 electron 等）

> 目标电脑不需要 Node 也可运行——只要满足上方"使用前提"之一。

---

## 🐛 常见问题

**Q: 启动后白屏？**
A: 检查 `127.0.0.1:3080` 是否可访问；首次启动 DSH 服务可能需要 10-30 秒。

**Q: 提示"未检测到 Node.js 环境"？**
A: 目标电脑没有 Node.js 也没有 DSH 环境。安装 Node.js（>= 22）或到已装 DSH 的电脑上运行。

**Q: 便携版解压到哪里了？**
A: 在 Windows「已安装的应用」中卸载，或从开始菜单运行卸载程序。

**Q: 如何卸载安装版？**
A: 开始菜单 → "Uninstall DeepSeek Harness"，或 设置 → 应用 → DeepSeek Harness → 卸载。
