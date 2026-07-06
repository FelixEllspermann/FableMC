@echo off
title Fable MC - App
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js wurde nicht gefunden.
  echo   Bitte installiere Node.js von https://nodejs.org und starte diese Datei erneut.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\electron" (
  echo.
  echo   Electron ist noch nicht installiert.
  echo   Bitte einmal in diesem Ordner  npm install  ausfuehren.
  echo.
  pause
  exit /b 1
)

echo Starte Fable MC ...
echo (Dieses Fenster offen lassen - Schliessen beendet das Spiel.)
echo.
call npm run app

echo.
echo Fable MC beendet. Fenster kann geschlossen werden.
pause
