Unicode true
!include "MUI2.nsh"
!include "x64.nsh"
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
!define MUI_FINISHPAGE_RUN_TEXT "Run DeepSeek Harness"

Var StartMenuFolder

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!define MUI_STARTMENUPAGE_DEFAULTFOLDER "DeepSeek Harness"
!define MUI_STARTMENUPAGE_REGISTRY_ROOT "HKCU"
!define MUI_STARTMENUPAGE_REGISTRY_KEY "Software\DeepSeek Harness"
!define MUI_STARTMENUPAGE_REGISTRY_VALUENAME "StartMenuFolder"
!insertmacro MUI_PAGE_STARTMENU Application $StartMenuFolder
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Function .onVerifyInstDir
  StrLen $0 $INSTDIR
  IntCmp $0 3 invalid invalid valid
  invalid:
    Abort
  valid:
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

  CreateShortCut "$DESKTOP\DeepSeek Harness.lnk" "$INSTDIR\DeepSeek Harness.exe" "" "$INSTDIR\DeepSeek Harness.exe" 0
  !insertmacro MUI_STARTMENU_WRITE_BEGIN Application
    CreateDirectory "$SMPROGRAMS\$StartMenuFolder"
    CreateShortCut "$SMPROGRAMS\$StartMenuFolder\DeepSeek Harness.lnk" "$INSTDIR\DeepSeek Harness.exe" "" "$INSTDIR\DeepSeek Harness.exe" 0
    CreateShortCut "$SMPROGRAMS\$StartMenuFolder\Uninstall DeepSeek Harness.lnk" "$INSTDIR\Uninstall.exe"
  !insertmacro MUI_STARTMENU_WRITE_END
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  IfFileExists "$INSTDIR\.dsh-desktop-install" uninstall_ok
    MessageBox MB_ICONSTOP "The selected directory is not a DeepSeek Harness installation."
    Abort
  uninstall_ok:
  ReadRegStr $StartMenuFolder HKCU "Software\DeepSeek Harness" "StartMenuFolder"
  nsExec::ExecToLog 'taskkill /F /IM "DeepSeek Harness.exe"'
  Delete "$DESKTOP\DeepSeek Harness.lnk"
  RMDir /r "$SMPROGRAMS\$StartMenuFolder"
  DeleteRegKey HKCU "${UNINSTKEY}"
  DeleteRegKey HKCU "Software\DeepSeek Harness"
  Delete "$INSTDIR\.dsh-desktop-install"
  RMDir /r "$INSTDIR"
SectionEnd
