// Fable MC — Electron-Fenster für die Steuerzentrale (Server-Verwaltung).
//
// Wird von launcher.js gestartet (statt den Browser zu öffnen): zeigt das
// Kontrollpanel in einem eigenen Fenster ohne Browser-Drumherum. Untergeordnete
// Links („Spiel öffnen", „Status-Seite") gehen ebenfalls in eigene Fenster —
// nichts landet mehr im Standardbrowser.
//
// Aufruf:  electron electron-panel.cjs <url>

const { app, BrowserWindow, Menu, shell } = require('electron');

const startUrl = process.argv[2] || 'http://localhost:8130';

// Ein Fenster ohne Menü (→ keine Browser-Hotkeys) für Panel / Spiel / Status.
function makeWindow(url, opts = {}) {
  const { title = 'Fable MC', width = 960, height = 840, bg = '#0e1426' } = opts;
  const win = new BrowserWindow({
    width, height, minWidth: 640, minHeight: 480,
    title, backgroundColor: bg, autoHideMenuBar: true, show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  win.once('ready-to-show', () => win.show());
  setTimeout(() => { if (!win.isDestroyed() && !win.isVisible()) win.show(); }, 3000);
  win.loadURL(url);

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { event.preventDefault(); win.setFullScreen(!win.isFullScreen()); }
    else if (input.key === 'F12') { event.preventDefault(); win.webContents.toggleDevTools(); }
  });

  // Panel-Links (Spiel öffnen / Status) in EIGENEN Fenstern öffnen, nicht im Browser.
  win.webContents.setWindowOpenHandler(({ url: ziel }) => {
    if (/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(ziel)) {
      const status = /\/status\/?($|\?)/i.test(ziel);
      makeWindow(ziel, status
        ? { title: 'Fable MC — Status', width: 900, height: 720, bg: '#0e1426' }
        : { title: 'Fable MC', width: 1280, height: 800, bg: '#7ec0ee' }); // Spiel
    } else {
      shell.openExternal(ziel); // echte externe Links doch im System-Browser
    }
    return { action: 'deny' };
  });
  return win;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null); // gilt für alle Fenster dieses Prozesses
  makeWindow(startUrl, { title: 'Fable MC — Steuerzentrale', width: 960, height: 860, bg: '#0e1426' });
});

app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) makeWindow(startUrl); });
