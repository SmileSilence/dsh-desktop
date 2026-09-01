Unicode true
SetCompressor /SOLID lzma
!include "MUI2.nsh"
!include "x64.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!include "version.nsh"

Name "DeepSeek Harness"
OutFile "dist\DeepSeek Harness-${VERSION}-Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\DeepSeek Harness"
InstallDirRegKey HKCU "Software\DeepSeek Harness" "InstallDir"
RequestExecutionLevel user

!define APPNAME "DeepSeek Harness"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\DeepSeek Harness"
!define MUI_ABORTWARNING
!define MUI_ICON "assets\app.ico"
!define MUI_UNICON "assets\app.ico"
!define MUI_FINISHPAGE_RUN "$INSTDIR\DeepSeek Harness.exe"
!define MUI_FINISHPAGE_RUN_TEXT "运行 DeepSeek Harness"

Var StartMenuFolder
; DSH 安装方式：0=跳过  1=全局安装  2=源码安装
Var DshChoice
Var DshRadioSkip
Var DshRadioGlobal
Var DshRadioSource
Var HasNode
Var HasGit
Var DshRepoPath
; ---- 卸载器：DSH 组件清理选项 ----
Var DshInstallMode
Var UserProfile
Var UnAppData
Var UnDshData
Var UnDshGlobal
Var UnDshSource
Var UnAppDataCtrl
Var UnDshDataCtrl
Var UnDshGlobalCtrl
Var UnDshSourceCtrl

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!define MUI_STARTMENUPAGE_DEFAULTFOLDER "DeepSeek Harness"
!define MUI_STARTMENUPAGE_REGISTRY_ROOT "HKCU"
!define MUI_STARTMENUPAGE_REGISTRY_KEY "Software\DeepSeek Harness"
!define MUI_STARTMENUPAGE_REGISTRY_VALUENAME "StartMenuFolder"
!insertmacro MUI_PAGE_STARTMENU Application $StartMenuFolder

; ------------------------------------------------------------------
; DSH 后端安装方式选择页（自定义页）
; ------------------------------------------------------------------
Page custom DshPageCreate DshPageLeave

!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
; 卸载器：DSH 组件清理选项页
UninstPage custom un.UnDshPageCreate un.UnDshPageLeave
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Function DshPageCreate
  !insertmacro MUI_HEADER_TEXT "安装 DSH 后端" "选择 DSH 的安装方式（可稍后在应用设置中调整）"
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "DeepSeek Harness 桌面端需要 DSH 后端服务（http://127.0.0.1:3080）。$\r$\n请选择 DSH 的安装方式："
  Pop $0

  ${NSD_CreateRadioButton} 10u 32u 100% 14u "暂不安装（我已安装 DSH，或稍后在应用内处理）"
  Pop $DshRadioSkip

  ${NSD_CreateRadioButton} 10u 52u 100% 14u "全局安装（推荐）：npm install -g @deepseek-ai/dsh"
  Pop $DshRadioGlobal

  ${NSD_CreateRadioButton} 10u 72u 100% 14u "源码安装：克隆 deepseek-harness 源码并构建到用户目录"
  Pop $DshRadioSource

  ${NSD_CreateLabel} 10u 92u 100% 44u "提示：两种安装均需联网，时长视网络而定。$\r$\n全局安装仅需 Node.js；源码安装还需 git 与 Node.js（>= 22）。$\r$\n如未满足条件，安装程序会自动跳过并给出说明。"
  Pop $0

  ${NSD_Check} $DshRadioGlobal
  nsDialogs::Show
FunctionEnd

Function DshPageLeave
  StrCpy $DshChoice 0
  ${NSD_GetState} $DshRadioGlobal $0
  ${If} $0 = 1
    StrCpy $DshChoice 1
  ${EndIf}
  ${NSD_GetState} $DshRadioSource $0
  ${If} $0 = 1
    StrCpy $DshChoice 2
  ${EndIf}
FunctionEnd

Function .onVerifyInstDir
  StrLen $0 $INSTDIR
  IntCmp $0 3 invalid invalid valid
  invalid:
    Abort
  valid:
FunctionEnd

; 检查 node 是否在 PATH（$HasNode = 1/0）
Function CheckNode
  Push $0
  Push $1
  nsExec::ExecToStack 'cmd /c where node >nul 2>&1'
  Pop $0
  Pop $1
  StrCpy $HasNode 0
  ${If} $0 = 0
    StrCpy $HasNode 1
  ${EndIf}
  Pop $1
  Pop $0
FunctionEnd

; 检查 git 是否在 PATH（$HasGit = 1/0）
Function CheckGit
  Push $0
  Push $1
  nsExec::ExecToStack 'cmd /c where git >nul 2>&1'
  Pop $0
  Pop $1
  StrCpy $HasGit 0
  ${If} $0 = 0
    StrCpy $HasGit 1
  ${EndIf}
  Pop $1
  Pop $0
FunctionEnd

; 全局安装 DSH：npm install -g @deepseek-ai/dsh
Function InstallDshGlobal
  Call CheckNode
  ${If} $HasNode = 0
    MessageBox MB_ICONEXCLAMATION|MB_OK "未检测到 Node.js，无法自动全局安装 DSH。$\r$\n请先安装 Node.js（>= 22）：https://nodejs.org$\r$\n或稍后在应用内手动处理。"
    Return
  ${EndIf}
  MessageBox MB_ICONQUESTION|MB_YESNO "即将全局安装 DSH 后端：$\r$\n  npm install -g @deepseek-ai/dsh@latest$\r$\n$\r$\n此过程需要联网并可能耗时数分钟，是否继续？" IDYES dsh_global_go
    Return
  dsh_global_go:
  ExecWait 'cmd /c npm install -g @deepseek-ai/dsh@latest' $1
  ${If} $1 != 0
    MessageBox MB_ICONEXCLAMATION|MB_OK "全局安装 DSH 失败（退出码 $1）。$\r$\n可能原因：网络异常或权限不足。$\r$\n请以管理员身份重新运行安装包，或手动执行：$\r$\nnpm install -g @deepseek-ai/dsh"
  ${Else}
    MessageBox MB_ICONINFORMATION|MB_OK "DSH 已全局安装完成。应用启动后会自动使用它。"
  ${EndIf}
FunctionEnd

; 源码安装 DSH：git clone + corepack pnpm install（到 %USERPROFILE%\deepseek-harness）
Function InstallDshSource
  Call CheckNode
  ${If} $HasNode = 0
    MessageBox MB_ICONEXCLAMATION|MB_OK "未检测到 Node.js，无法源码安装 DSH。$\r$\n请先安装 Node.js（>= 22）：https://nodejs.org"
    Return
  ${EndIf}
  Call CheckGit
  ${If} $HasGit = 0
    MessageBox MB_ICONEXCLAMATION|MB_OK "未检测到 git，无法源码安装 DSH。$\r$\n请安装 Git：https://git-scm.com，或改用全局安装。"
    Return
  ${EndIf}
  ReadEnvStr $DshRepoPath "USERPROFILE"
  StrCpy $DshRepoPath "$DshRepoPath\deepseek-harness"
  MessageBox MB_ICONQUESTION|MB_YESNO "即将克隆 deepseek-harness 源码并构建到：$\r$\n  $DshRepoPath$\r$\n$\r$\n此过程需要联网（git 克隆 + 依赖安装），耗时较长，是否继续？" IDYES dsh_source_go
    Return
  dsh_source_go:
  FileOpen $0 "$TEMP\dsh-install-source.cmd" w
  FileWrite $0 '@echo off$\r$\n'
  FileWrite $0 'echo ============================================$\r$\n'
  FileWrite $0 'echo  正在源码安装 DSH 后端 (clone + pnpm)...$\r$\n'
  FileWrite $0 'echo ============================================$\r$\n'
  FileWrite $0 'if exist "%USERPROFILE%\deepseek-harness" ($\r$\n'
  FileWrite $0 '  echo [1/3] 目标目录已存在，跳过克隆（非本次安装创建，卸载时不会删除）。$\r$\n'
  FileWrite $0 ') else ($\r$\n'
  FileWrite $0 '  echo [1/3] 正在克隆 deepseek-harness 源码 ...$\r$\n'
  FileWrite $0 '  git clone --depth 1 https://github.com/deepseek-ai/deepseek-harness.git "%USERPROFILE%\deepseek-harness"$\r$\n'
  FileWrite $0 '  if errorlevel 1 exit /b 1$\r$\n'
  FileWrite $0 '  echo installed-by-dsh-desktop > "%USERPROFILE%\deepseek-harness\.dsh-desktop-install"$\r$\n'
  FileWrite $0 ')$\r$\n'
  FileWrite $0 'cd /d "%USERPROFILE%\deepseek-harness"$\r$\n'
  FileWrite $0 'echo [2/3] 正在安装依赖 (corepack pnpm install) ...$\r$\n'
  FileWrite $0 'corepack pnpm install$\r$\n'
  FileWrite $0 'if errorlevel 1 ($\r$\n'
  FileWrite $0 '  echo corepack 不可用，改用 npm 安装 pnpm 后重试 ...$\r$\n'
  FileWrite $0 '  npm install -g pnpm$\r$\n'
  FileWrite $0 '  if errorlevel 1 exit /b 1$\r$\n'
  FileWrite $0 '  pnpm install$\r$\n'
  FileWrite $0 '  if errorlevel 1 exit /b 1$\r$\n'
  FileWrite $0 ')$\r$\n'
  FileWrite $0 'echo [3/3] 源码安装完成。$\r$\n'
  FileClose $0
  ExecWait 'cmd /c "$TEMP\dsh-install-source.cmd"' $1
  ${If} $1 != 0
    MessageBox MB_ICONEXCLAMATION|MB_OK "DSH 源码安装失败（退出码 $1）。$\r$\n请检查网络后重试，或改用全局安装。"
  ${Else}
    MessageBox MB_ICONINFORMATION|MB_OK "DSH 源码安装完成。$\r$\n应用启动后会自动使用该源码（$DshRepoPath）。"
  ${EndIf}
FunctionEnd

Section "DeepSeek Harness" SEC_MAIN
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File /r "dist\DeepSeek Harness-win32-x64\*.*"
  FileOpen $0 "$INSTDIR\.dsh-desktop-install" w
  FileWrite $0 "${VERSION}"
  FileClose $0
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "DSH Community"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\DeepSeek Harness.exe,0"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKCU "${UNINSTKEY}" "QuietUninstallString" '$\"$INSTDIR\Uninstall.exe$\" /S'
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
  WriteRegStr HKCU "Software\DeepSeek Harness" "InstallDir" "$INSTDIR"
  ; 记录本次选择的 DSH 安装方式（0=跳过 1=全局 2=源码），供卸载器完整清理
  WriteRegDWORD HKCU "Software\DeepSeek Harness" "DshInstallMode" $DshChoice

  CreateShortCut "$DESKTOP\DeepSeek Harness.lnk" "$INSTDIR\DeepSeek Harness.exe" "" "$INSTDIR\DeepSeek Harness.exe" 0
  !insertmacro MUI_STARTMENU_WRITE_BEGIN Application
    CreateDirectory "$SMPROGRAMS\$StartMenuFolder"
    CreateShortCut "$SMPROGRAMS\$StartMenuFolder\DeepSeek Harness.lnk" "$INSTDIR\DeepSeek Harness.exe" "" "$INSTDIR\DeepSeek Harness.exe" 0
    CreateShortCut "$SMPROGRAMS\$StartMenuFolder\Uninstall DeepSeek Harness.lnk" "$INSTDIR\Uninstall.exe"
  !insertmacro MUI_STARTMENU_WRITE_END

  ; ---- 按用户选择安装 DSH 后端 ----
  ${If} $DshChoice = 1
    Call InstallDshGlobal
  ${ElseIf} $DshChoice = 2
    Call InstallDshSource
  ${EndIf}
SectionEnd

; ------------------------------------------------------------------
; 卸载器：DSH 组件清理选项页
; ------------------------------------------------------------------
Function un.UnDshPageCreate
  !insertmacro MUI_HEADER_TEXT "卸载选项" "选择要一并删除的 DSH 相关组件（默认全部勾选）"
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "卸载 DeepSeek Harness 桌面端，并选择要一并清理的组件："
  Pop $0

  ${NSD_CreateCheckBox} 10u 30u 100% 12u "删除应用数据与日志（%APPDATA%\dsh-desktop：配置、日志）"
  Pop $UnAppDataCtrl

  ${NSD_CreateCheckBox} 10u 46u 100% 12u "删除 DSH 数据与会话（%USERPROFILE%\.dsh：会话、凭据）"
  Pop $UnDshDataCtrl

  ${NSD_CreateCheckBox} 10u 62u 100% 12u "卸载 DSH 全局安装（npm uninstall -g @deepseek-ai/dsh）"
  Pop $UnDshGlobalCtrl

  ${NSD_CreateCheckBox} 10u 78u 100% 12u "删除 DSH 源码目录（%USERPROFILE%\deepseek-harness，仅限安装包创建）"
  Pop $UnDshSourceCtrl

  ${NSD_CreateLabel} 10u 96u 100% 40u "提示：DSH 数据（会话与 API 凭据）删除后不可恢复。$\r$\n如需保留 DSH 后端，请取消勾选相应选项。$\r$\n仅勾选全局/源码项时，若未检测到对应安装会自动跳过。"
  Pop $0

  ${NSD_Check} $UnAppDataCtrl
  ${NSD_Check} $UnDshDataCtrl
  ${NSD_Check} $UnDshGlobalCtrl
  ${NSD_Check} $UnDshSourceCtrl
  nsDialogs::Show
FunctionEnd

Function un.UnDshPageLeave
  ${NSD_GetState} $UnAppDataCtrl $UnAppData
  ${NSD_GetState} $UnDshDataCtrl $UnDshData
  ${NSD_GetState} $UnDshGlobalCtrl $UnDshGlobal
  ${NSD_GetState} $UnDshSourceCtrl $UnDshSource
FunctionEnd

; 卸载器：检查 node 是否在 PATH（$HasNode = 1/0）
Function un.CheckNode
  Push $0
  Push $1
  nsExec::ExecToStack 'cmd /c where node >nul 2>&1'
  Pop $0
  Pop $1
  StrCpy $HasNode 0
  ${If} $0 = 0
    StrCpy $HasNode 1
  ${EndIf}
  Pop $1
  Pop $0
FunctionEnd

; 卸载 DSH 全局安装
Function un.UnInstallDshGlobal
  Call un.CheckNode
  ${If} $HasNode = 0
    MessageBox MB_ICONEXCLAMATION|MB_OK "未检测到 Node.js/npm，无法自动卸载全局安装的 DSH。$\r$\n可手动执行：npm uninstall -g @deepseek-ai/dsh"
    Return
  ${EndIf}
  ExecWait 'cmd /c npm uninstall -g @deepseek-ai/dsh' $1
  ${If} $1 != 0
    MessageBox MB_ICONEXCLAMATION|MB_OK "DSH 全局卸载失败（退出码 $1）。$\r$\n请手动执行：npm uninstall -g @deepseek-ai/dsh"
  ${EndIf}
FunctionEnd

; 删除 DSH 源码目录（仅当目录带安装标记，避免误删用户自己的仓库）
Function un.UnInstallDshSource
  ReadEnvStr $DshRepoPath "USERPROFILE"
  StrCpy $DshRepoPath "$DshRepoPath\deepseek-harness"
  IfFileExists "$DshRepoPath\.dsh-desktop-install" un_rm_repo
    MessageBox MB_ICONINFORMATION|MB_OK "$DshRepoPath 不是由安装包创建的（无安装标记），已跳过删除。"
    Return
  un_rm_repo:
  RMDir /r "$DshRepoPath"
  ${If} ${FileExists} "$DshRepoPath"
    MessageBox MB_ICONEXCLAMATION|MB_OK "DSH 源码目录部分文件被占用，未能完全删除：$\r\n$DshRepoPath$\r$\n请先关闭 DeepSeek Harness 与 DSH 后端进程，再手动删除。"
  ${EndIf}
FunctionEnd

Section "Uninstall"
  SetShellVarContext current
  IfFileExists "$INSTDIR\.dsh-desktop-install" uninstall_ok
    MessageBox MB_ICONSTOP "所选目录不是 DeepSeek Harness 安装目录。"
    Abort
  uninstall_ok:
  ReadRegStr $StartMenuFolder HKCU "Software\DeepSeek Harness" "StartMenuFolder"
  ; 读取安装时记录的 DSH 安装方式（0=跳过 1=全局 2=源码）
  StrCpy $DshInstallMode 0
  ReadRegDWORD $DshInstallMode HKCU "Software\DeepSeek Harness" "DshInstallMode"
  ReadEnvStr $UserProfile "USERPROFILE"
  nsExec::ExecToLog 'taskkill /F /IM "DeepSeek Harness.exe"'
  Delete "$DESKTOP\DeepSeek Harness.lnk"
  RMDir /r "$SMPROGRAMS\$StartMenuFolder"
  DeleteRegKey HKCU "${UNINSTKEY}"
  DeleteRegKey HKCU "Software\DeepSeek Harness"
  Delete "$INSTDIR\.dsh-desktop-install"

  ; ---- 完整卸载：按勾选清理 DSH 相关组件 ----
  ; 1) DSH 全局安装（仅当安装时选择了全局安装）
  ${If} $UnDshGlobal = 1
  ${AndIf} $DshInstallMode = 1
    Call un.UnInstallDshGlobal
  ${EndIf}
  ; 2) DSH 源码目录（仅当安装时选择了源码安装）
  ${If} $UnDshSource = 1
  ${AndIf} $DshInstallMode = 2
    Call un.UnInstallDshSource
  ${EndIf}
  ; 3) DSH 数据与会话（~/.dsh：会话、凭据）
  ${If} $UnDshData = 1
    RMDir /r "$UserProfile\.dsh"
  ${EndIf}
  ; 4) 应用数据与日志（%APPDATA%\dsh-desktop）
  ${If} $UnAppData = 1
    RMDir /r "$APPDATA\dsh-desktop"
  ${EndIf}

  RMDir /r "$INSTDIR"
SectionEnd
