@echo off
title Fable MC - Steuerzentrale
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

echo Starte Fable MC Steuerzentrale ...
echo (Dieses Fenster offen lassen - Schliessen beendet den Server.)
echo.
node launcher.js

echo.
echo Steuerzentrale beendet. Fenster kann geschlossen werden.
pause
