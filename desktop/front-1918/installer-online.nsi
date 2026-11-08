; Онлайн-установщик «Фронт 1918»: маленький файл, движок игры (Electron, 115 МБ)
; скачивается во время установки с официальной страницы выпусков на GitHub и проверяется по SHA-256.
Unicode true
SetCompressor /SOLID lzma

!define APPNAME "Фронт 1918"
!define APPID "Front1918"
!define VERSION "1.4.0"
!define EXE "Front1918.exe"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPID}"
!define GPU_KEY "Software\Microsoft\DirectX\UserGpuPreferences"

Name "${APPNAME}"
OutFile "Front1918-Setup-Online.exe"
InstallDir "$LOCALAPPDATA\Programs\${APPID}"
InstallDirRegKey HKCU "Software\${APPID}" "InstallDir"
RequestExecutionLevel user
BrandingText "${APPNAME} ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1049 "ProductName" "${APPNAME}"
VIAddVersionKey /LANG=1049 "FileDescription" "Установка ${APPNAME}"
VIAddVersionKey /LANG=1049 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1049 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1049 "LegalCopyright" "0lolkin0"

!include "MUI2.nsh"
!define MUI_ICON "app\icon.ico"
!define MUI_UNICON "app\icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Установка «${APPNAME}»"
!define MUI_WELCOMEPAGE_TEXT "Шутер о Первой мировой войне: окопы, танки, цеппелины и бой с ботами.$\r$\n$\r$\nВо время установки из интернета скачается движок игры (около 115 МБ) — это займёт несколько минут.$\r$\n$\r$\nИгра будет работать на мощной видеокарте (NVIDIA / AMD), а не на встроенной графике процессора."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Запустить «${APPNAME}»"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Russian"

Section "Игра" SecMain
  SectionIn RO
  nsExec::Exec 'taskkill /IM ${EXE} /F'
  SetOutPath "$INSTDIR"
  InitPluginsDir
  File "/oname=$PLUGINSDIR\get-runtime.ps1" "get-runtime.ps1"
  DetailPrint "Скачиваю движок игры (около 115 МБ), подождите несколько минут..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\get-runtime.ps1" -Dest "$INSTDIR"'
  Pop $0
  StrCmp $0 "0" runtime_ok
    MessageBox MB_ICONSTOP "Не удалось скачать движок игры (код $0).$\r$\nПроверьте интернет и запустите установку ещё раз."
    Abort
  runtime_ok:
  DetailPrint "Движок игры скачан и проверен"
  ; Электрон → наша игра
  Delete "$INSTDIR\${EXE}"
  Rename "$INSTDIR\electron.exe" "$INSTDIR\${EXE}"
  Delete "$INSTDIR\resources\default_app.asar"
  RMDir /r "$INSTDIR\resources\app"
  File /r "app\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\icon.ico" 0
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\icon.ico" 0
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Удалить ${APPNAME}.lnk" "$INSTDIR\Uninstall.exe"

  ; Мощная видеокарта для игры (Параметры → Дисплей → Графика → Высокая производительность)
  WriteRegStr HKCU "${GPU_KEY}" "$INSTDIR\${EXE}" "GpuPreference=2;"

  WriteRegStr HKCU "Software\${APPID}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "0lolkin0"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\icon.ico"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" 300000
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /IM ${EXE} /F'
  Delete "$DESKTOP\${APPNAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APPNAME}"
  DeleteRegValue HKCU "${GPU_KEY}" "$INSTDIR\${EXE}"
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\${APPID}"
  RMDir /r "$INSTDIR"
SectionEnd
