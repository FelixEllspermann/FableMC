// Fable MC — Electron-Wrapper: startet das Spiel in einem eigenen Desktop-Fenster.
//
// Warum: Im normalen Browser kollidieren Spiel-Tasten mit Browser-Hotkeys —
// vor allem Strg+W (Sprinten + Vorwärts) schließt sonst den Tab. Dieses Fenster
// hat KEIN Anwendungsmenü, dadurch sind alle Standard-Browser-Kürzel (Strg+W,
// Strg+R, Strg+T, Strg+N, Strg+±/0, Strg+Shift+I …) deaktiviert und das Spiel
// bekommt die Tasten roh. Als Komfort bleiben nur F11 (Vollbild) und F12 (DevTools).
//
// Start:  npm run app   ·   Doppelklick auf „Fable MC App.bat"
//
// Fester Port 8123 (wie die Browser-Version), damit der localStorage-Spielstand
// stabil bleibt und mit der Browser-Version geteilt wird. Läuft dort schon ein
// Spielserver (server.js), wird dieser mitbenutzt (dann geht auch Mehrspieler).

const { app, BrowserWindow, Menu, shell } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = 8123;
const BASE = `http://127.0.0.1:${PORT}`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

// Kleiner statischer Dateiserver (das Spiel braucht http:// für ES-Module + Worker).
function fileHandler(req, res) {
  let rel = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.join(ROOT, path.normalize(rel));
  // Sicherheit: nie aus dem Projektordner ausbrechen
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403); res.end('403'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404 – ' + rel); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

// Eigenen Dateiserver starten — oder, falls der Port schon belegt ist
// (bereits laufender Spielserver), diesen einfach mitbenutzen.
function serveOrReuse() {
  return new Promise((resolve) => {
    const server = http.createServer(fileHandler);
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') console.log(`Port ${PORT} belegt — nutze den laufenden Server.`);
      else console.error('Dateiserver-Fehler:', e.message);
      resolve(); // trotzdem laden — auf dem Port läuft ja etwas
    });
    server.listen(PORT, '127.0.0.1', () => {
      console.log(`Fable MC — Dateiserver läuft auf ${BASE}`);
      resolve();
    });
  });
}

let win = null;

async function createWindow() {
  await serveOrReuse();

  // KEIN Menü → alle Standard-Browser-Hotkeys sind weg; das Spiel bekommt die
  // Tasten roh (Strg = Sprinten, W = Vorwärts → Strg+W schließt nichts mehr).
  Menu.setApplicationMenu(null);

  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 540,
    title: 'Fable MC',
    backgroundColor: '#7ec0ee',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: false,
      backgroundThrottling: false, // Spiel läuft weiter, auch wenn das Fenster inaktiv ist
    },
  });

  win.once('ready-to-show', () => win.show());
  win.loadURL(BASE + '/');
  // Sicherheitsnetz: Fenster auf jeden Fall zeigen, falls „ready-to-show" ausbleibt.
  setTimeout(() => { if (win && !win.isVisible()) win.show(); }, 3000);

  // Lädt der Server beim ersten Versuch noch nicht → einmal kurz erneut probieren.
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    if (url && url.startsWith(BASE)) setTimeout(() => win && win.loadURL(BASE + '/'), 600);
  });

  // Nur zwei bequeme Tasten selbst behandeln; alles andere geht ans Spiel.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { event.preventDefault(); win.setFullScreen(!win.isFullScreen()); }
    else if (input.key === 'F12') { event.preventDefault(); win.webContents.toggleDevTools(); }
  });

  // Externe Links im System-Browser öffnen, nicht im Spielfenster.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // Nicht versehentlich vom Spiel wegnavigieren.
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(BASE)) event.preventDefault();
  });

  win.on('closed', () => { win = null; });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
