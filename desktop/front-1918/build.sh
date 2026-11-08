#!/usr/bin/env bash
# Сборка установщика «Фронт 1918» для Windows на Linux:
#   1) Electron для Windows (x64) — окно игры и выбор мощной видеокарты
#   2) иконка и сведения о программе в exe (go-winres)
#   3) установщик NSIS (makensis)
# Использование: build.sh <репозиторий> <папка-сборки> <electron-win.zip>
set -euo pipefail
REPO="$1"; OUT="$2"; EZIP="$3"
SRC="$(cd "$(dirname "$0")" && pwd)"
rm -rf "$OUT/app" && mkdir -p "$OUT/app"
( cd "$OUT/app" && unzip -q "$EZIP" )
cd "$OUT/app"
rm -f resources/default_app.asar
# Оставляем только русский и английский языки интерфейса Chromium
find locales -name '*.pak' ! -name 'ru.pak' ! -name 'en-US.pak' -delete
mv electron.exe Front1918.exe
mkdir -p resources/app
cp "$SRC/main.js" "$SRC/package.json" resources/app/
cp "$REPO/front-1918/icons/icon-512.png" resources/app/icon.png
git -C "$REPO" archive --format=tar HEAD front-1918 | tar -x -C resources/app
mv resources/app/front-1918 resources/app/game
# Иконка и версия exe
( cd "$SRC/res" && go run github.com/tc-hib/go-winres@v0.3.3 patch --in winres.json --no-backup --authenticode remove "$OUT/app/Front1918.exe" )
# Установщик
cp "$SRC/installer.nsi" "$SRC/res/icon.ico" "$OUT/"
( cd "$OUT" && makensis -V2 installer.nsi )
ls -la "$OUT/Front1918-Setup.exe"
