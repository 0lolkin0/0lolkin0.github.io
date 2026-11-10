; Установщик «Фронт 1918» для Windows 10/11 (x64)
; Ставит игру в профиль пользователя (права администратора не нужны), создаёт ярлыки,
; закрепляет за игрой мощную видеокарту (Параметры Windows → Графика → «Высокая производительность»)
; и регистрирует удаление в «Приложения и возможности».
Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 64

!define APPNAME "Фронт 1918"
!define APPID "Front1918"
!define VERSION "1.4.0"
!define EXE "Front1918.exe"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPID}"
!define GPU_KEY "Software\Microsoft\DirectX\UserGpuPreferences"

Name "${APPNAME}"
OutFile "Front1918-Setup.exe"
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
!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Установка «${APPNAME}»"
!define MUI_WELCOMEPAGE_TEXT "Шутер о Первой мировой войне: окопы, танки, цеппелины и бой с ботами.$\r$\n$\r$\nИгра будет работать на мощной видеокарте (NVIDIA / AMD), а не на встроенной графике процессора.$\r$\n$\r$\nНажмите «Далее», чтобы продолжить."
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
  ; Если игра запущена — закрываем, чтобы обновить файлы
  nsExec::Exec 'taskkill /IM ${EXE} /F'
  SetOutPath "$INSTDIR"
  RMDir /r "$INSTDIR\resources\app"
  File /r "app\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; Ярлыки: рабочий стол и меню «Пуск»
  CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Удалить ${APPNAME}.lnk" "$INSTDIR\Uninstall.exe"

  ; Мощная видеокарта для игры (то же, что «Параметры → Дисплей → Графика → Высокая производительность»)
  WriteRegStr HKCU "${GPU_KEY}" "$INSTDIR\${EXE}" "GpuPreference=2;"

  ; Регистрация в «Приложения и возможности»
  WriteRegStr HKCU "Software\${APPID}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "0lolkin0"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${EXE}"
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
  ; Сохранения (опыт, настройки) остаются в %APPDATA%\Front 1918 — на случай переустановки
SectionEnd
