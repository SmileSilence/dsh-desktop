# DSH Desktop 快速开始

DSH Desktop 是 DeepSeek Harness 的桌面客户端。当前源码版本为 1.2.1；桌面安装包本身不内置完整后端。

## 准备后端

使用满足 DeepSeek Harness 仓库 `engines` 要求的 Node.js，并安装 pnpm。选择已有源码仓库时，在该仓库目录打开 PowerShell：

```powershell
pnpm install --frozen-lockfile
pnpm run build
```

在桌面设置中填写仓库路径，或配置用户环境变量（示例路径应替换为实际位置）：

```powershell
[Environment]::SetEnvironmentVariable('DSH_REPO_ROOT', 'D:\Apps\deepseek-harness', 'User')
```

重新打开桌面端以读取环境变量。环境变量优先于设置；无效时需要修正或清除，不能仅修改设置覆盖它。安装目录相邻的 `deepseek-harness` 也会自动被识别。

也可以先全局安装后端：

```powershell
npm install -g @deepseek-ai/dsh
```

首次安装可能超过 90 秒，应等待上述命令结束，再启动桌面端。

## 启动和认证

安装版直接打开 `DeepSeek Harness.exe`。源码开发模式在本项目目录执行：

```powershell
npm ci
npm start
```

桌面端默认尝试复用当前浏览器会话可访问的 3080 服务；无法复用时在 3092 启动后端。配置了其他端口时直接使用该端口。已有服务返回 401 表示当前会话未认证，不代表服务未运行；无法复用的占用端口不会被强制接管。

桌面端自动处理本次后端启动输出的登录链接，使用自己的浏览器 Cookie 保存登录状态，页面地址和诊断信息不包含登录凭据。模型 API Key 与网页登录是两回事，请在应用配置引导中填写模型密钥，或稍后在模型设置中配置。

关闭窗口默认隐藏到托盘；从托盘退出才结束桌面端创建的后端进程树。外部启动、被桌面复用的服务不会被停止。

## 测试和构建

```powershell
npm test
npm run test:startup -- 'D:\Apps\deepseek-harness'
```

第二条命令适用于 Windows，需要已安装本项目开发依赖以及已构建的后端仓库。它在下载目录的 `anget-tmp` 内创建临时安装副本，使用独立端口和独立数据，验证真实 Electron 页面、认证、重启和退出清理，完成后自动删除临时目录。

预览和正式安装包的构建流程见 [用户指南](docs/user-guide.md)。v1.2.1 的源码修改不代表已经发布新的 Setup 安装包。

## 故障提示

| 提示 | 处理方法 |
|---|---|
| 指定仓库不可用 | 修正 `DSH_REPO_ROOT` 或设置路径，选择含 `dsh` 启动脚本的源码仓库 |
| Node.js / pnpm / npm / npx 不可用 | 安装对应工具并检查 PATH，重新启动桌面端 |
| 依赖尚未安装 | 在提示的仓库目录运行 `pnpm install --frozen-lockfile` |
| 构建产物缺失 | 在提示的仓库目录运行 `pnpm run build` |
| 后端提前退出 | 按错误中的退出码和脱敏日志定位问题，无需等满 90 秒 |
| 端口被占用且无法访问 | 完成原服务的登录，或自行关闭占用服务后重试 |
| npx 首次安装超时 | 先在终端完成全局安装，再启动桌面端 |

详细修复总结见 [启动修复说明](docs/startup-repair.md)。
