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

if not exist "node_modules\electron" (
  echo.
  echo   Electron ist noch nicht installiert.
  echo   Bitte einmal in diesem Ordner  npm install  ausfuehren.
  echo.
  pause
  exit /b 1
)

REM Ohne Konsolenfenster starten: die versteckte .vbs uebernimmt, dieses
REM Fenster schliesst sich sofort wieder. Die Steuerzentrale laeuft in ihrem
REM eigenen Fenster - schliesst man es, wird der Server sauber gestoppt.
start "" wscript.exe "%~dp0Fable MC.vbs"
