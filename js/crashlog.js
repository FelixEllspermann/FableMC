// Global crash logging (classic script, loaded before the game module so it also
// catches module-load failures). Shows an overlay and stores the last 20 crashes
// in localStorage under "fablemc.crashlog".
(function () {
  const KEY = 'fablemc.crashlog';
  let overlay = null;
  let lastMsg = '';
  let repeats = 1;
  let countEl = null;

  function store(entry) {
    try {
      const arr = JSON.parse(localStorage.getItem(KEY) || '[]');
      arr.push(entry);
      while (arr.length > 20) arr.shift();
      localStorage.setItem(KEY, JSON.stringify(arr));
    } catch { /* storage full/blocked — overlay still shows */ }
  }

  function readLog() {
    try { return localStorage.getItem(KEY) || '[]'; } catch { return '[]'; }
  }

  function btn(text, onClick) {
    const b = document.createElement('button');
    b.textContent = text;
    b.style.cssText = 'font:inherit;font-size:14px;padding:6px 16px;cursor:pointer;' +
      'background:#6d1f1f;color:#fff;border:1px solid #c96b6b;';
    b.addEventListener('click', onClick);
    return b;
  }

  function show(entry) {
    if (overlay && entry.message === lastMsg) {
      repeats++;
      if (countEl) countEl.textContent = '×' + repeats + ' (wiederholt sich)';
      return;
    }
    lastMsg = entry.message;
    repeats = 1;
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);' +
      'z-index:99999;max-width:720px;width:calc(100% - 40px);background:#2a0d0d;color:#ffd9d9;' +
      'border:2px solid #c93b3b;border-radius:6px;padding:14px 16px;' +
      "font-family:'Courier New',monospace;font-size:13px;box-shadow:0 8px 30px rgba(0,0,0,0.6);";

    const title = document.createElement('div');
    title.textContent = '💥 Fehler im Spiel (' + entry.kind + ')';
    title.style.cssText = 'font-size:16px;font-weight:bold;margin-bottom:6px;color:#ff8f8f;';
    const msg = document.createElement('div');
    msg.textContent = entry.message;
    msg.style.cssText = 'margin-bottom:6px;word-break:break-word;';
    countEl = document.createElement('div');
    countEl.style.cssText = 'margin-bottom:6px;color:#c96b6b;';
    const stack = document.createElement('pre');
    stack.textContent = entry.stack || '(kein Stacktrace)';
    stack.style.cssText = 'max-height:160px;overflow:auto;background:#1a0808;padding:8px;' +
      'margin:0 0 10px;white-space:pre-wrap;word-break:break-all;font-size:11px;color:#e8b0b0;';

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
    row.appendChild(btn('Log kopieren', () => {
      const text = readLog();
      const done = () => { title.textContent = '💥 Fehler im Spiel — Log kopiert ✓'; };
      const fallback = () => {
        // prompt() gibt es in Electron nicht: Log anzeigen und markieren
        stack.textContent = text;
        stack.style.userSelect = 'text';
        stack.style.maxHeight = '260px';
        try {
          const range = document.createRange();
          range.selectNodeContents(stack);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          const ok = document.execCommand('copy');
          title.textContent = ok ? '💥 Log kopiert ✓' : '💥 Log unten markiert — Strg+C drücken';
        } catch {
          title.textContent = '💥 Log unten markiert — Strg+C drücken';
        }
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, fallback);
      } else {
        fallback();
      }
    }));
    row.appendChild(btn('Neu laden', () => location.reload()));
    row.appendChild(btn('Ausblenden', () => { overlay.remove(); overlay = null; lastMsg = ''; }));

    overlay.appendChild(title);
    overlay.appendChild(msg);
    overlay.appendChild(countEl);
    overlay.appendChild(stack);
    overlay.appendChild(row);
    (document.body || document.documentElement).appendChild(overlay);
  }

  function handle(kind, message, stack) {
    const entry = {
      when: new Date().toISOString(),
      kind,
      message: String(message || 'Unbekannter Fehler'),
      stack: String(stack || ''),
      ua: navigator.userAgent,
    };
    store(entry);
    show(entry);
  }

  window.addEventListener('error', (e) => {
    handle('error', e.message, (e.error && e.error.stack) || (e.filename + ':' + e.lineno));
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    handle('promise', (r && (r.message || String(r))) || 'Promise-Fehler', (r && r.stack) || '');
  });

  window.__crashlog = { handle, readLog };
})();
