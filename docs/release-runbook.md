# 版本发布规范（Release Runbook）

> **本文件是强制执行标准：本项目每次发布新版本，都必须严格按本流程执行，不得跳步、不得凭记忆操作。**
> 发现流程有误或需改进时，先改本文件，再按新流程执行。

## 前置条件（每次发布前逐项核对）

1. `package.json`、`version.nsh`、`main/index.js`（zh/en 两处 `aboutVersion`）三处版本号已一致升级。
2. `node --test "tests/*.spec.mjs"` 全绿。
3. 工作区干净，所有提交已推送到 `origin/main`（git 推送问题见《排障备忘》）。
4. `dist/` 内无旧版本 Setup.exe 残留。

## 发布流程（按顺序执行，不可跳步）

### 1. 构建 Preview
```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-preview.ps1
```
验收：输出 `Preview verified: v<版本>, 73 files`（文件数以脚本实际输出为准）。

### 2. 编译 Setup 安装包
```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-installer.ps1 -FromValidatedPreview
```
验收：输出 Setup 路径与 SHA256；产物名 `dist/DeepSeek Harness-<版本>-Setup.exe`。
NSIS 编译耗时数分钟，前台超时则用后台运行等完成。

### 3. 独立复核 SHA-256
```powershell
certutil -hashfile "dist/DeepSeek Harness-<版本>-Setup.exe" SHA256
```
与第 2 步输出比对一致。

### 4. 创建 Tag 并推送
```bash
git tag -a v<版本> -m "v<版本>"
git push origin v<版本>
```

### 5. 创建 GitHub Release 并上传安装包
```bash
gh release create v<版本> "dist/DeepSeek Harness-<版本>-Setup.exe" \
  --title "v<版本>" \
  --notes "<Release Notes 内容>"
```
Release Notes 须包含：主要新特性列表、SHA-256、升级说明、下载资产名。

### 6. 发布后验证（必做，缺一不可）
```bash
# 6a. Release 资产存在且 digest 正确
gh release view v<版本> --json tagName,assets

# 6b. 更新链路端到端验证：API 返回的 latest 即新版本，且 assets 带 digest
curl -s https://api.github.com/repos/SmileSilence/dsh-desktop/releases/latest \
  -H "User-Agent: dsh-desktop-updater" \
  | python -c "import sys,json; d=json.load(sys.stdin); print(d['tag_name'], [ (a['name'], a.get('digest')) for a in d['assets'] ])"
```
验收：6b 输出的 tag = 本次版本，digest 与第 3 步 SHA-256 一致（`sha256:<hex>` 前缀）。

### 7. 真机验证（能做则做）
运行旧版桌面端 →「关于 → 检查桌面版更新」→ 应显示"发现可用更新"且「下载并安装」按钮可用。

## 已知约定

- 安装目录 `DSH_Desktop`；exe 名 / DisplayName / 注册表键保持 `DeepSeek Harness`。
- 覆盖自动安装依赖 Release 资产的 `digest` 字段（`sha256:<hex>`），GitHub 上传资产后自动生成，无需手工计算后上传。
- Release 资产命名必须含版本号且以 `Setup.exe` 结尾（`pickInstallerAsset` 按此匹配，仅接受 github.com/gitee.com 主机）。

## 排障备忘

- **git push 失败**：用户全局 git 配了 `127.0.0.1:7890` 代理（Clash 类）。先查代理是否在线；不在线时 `github.com` 会被 DNS 污染到坏节点，官方节点 `140.82.112.4` 等直连可达。解决：开启代理，或临时 `-c http.proxy=http://127.0.0.1:7891` 走本地隧道。
- **CI（ci.yml）**：push 后自动跑测试，若红需修复后重发（tag 可删：`git push origin :refs/tags/v<版本>` + `gh release delete v<版本> --yes`）。
