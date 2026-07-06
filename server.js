// Fable MC — Mehrspieler-Server: liefert die Spieldateien UND hält die geteilte
// Welt (Seed, Block-Änderungen, Truhen, Uhrzeit, Spieler, Chat) über WebSocket.
// Start:  node server.js [--port 8123] [--seed 42]
// Welt wird in world-mp.json neben dieser Datei gespeichert.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { Rules } from './config.js'; // Welt-Regeln des Servers → an Gäste verteilen

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- Argumente ----
const args = process.argv.slice(2);
const argVal = (name) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : null;
};
const PORT = Number(argVal('port') || process.env.PORT || 8123);
const WELT_DATEI = path.resolve(argVal('welt') || path.join(__dirname, 'world-mp.json'));
const BANS_DATEI = path.join(__dirname, 'bans.json');
const MODS_DATEI = path.join(__dirname, 'mods.json');
const START_ZEIT = Date.now();
let pvpAn = ['1', 'true', 'on'].includes(String(argVal('pvp') || '').toLowerCase()); // Spieler-vs-Spieler (per /pvp umschaltbar)
// Server-Identität (Name, MotD, Bild) — von der Steuerzentrale in server-info.json geschrieben.
const INFO_DATEI = path.join(__dirname, 'server-info.json');
let serverInfo = { name: '', motd: '', icon: '' };
try {
  if (fs.existsSync(INFO_DATEI)) serverInfo = { ...serverInfo, ...JSON.parse(fs.readFileSync(INFO_DATEI, 'utf8')) };
} catch (e) { console.warn('server-info.json unlesbar:', e.message); }

// Konto-Pflicht / Anti-Spoofing — von der Steuerzentrale in server-auth.json geschrieben.
// Ist eine url gesetzt, muss jeder Beitritt ein gültiges Konto-Token mitbringen; der
// Server lässt es vom Backend (me.php) bestätigen und benutzt DEN dort bestätigten Namen.
// So kann ein Client keinen fremden Namen vortäuschen. Fehlt die Datei → offener Server.
const AUTH_DATEI = path.join(__dirname, 'server-auth.json');
let authCfg = { url: '', required: true };
try {
  if (fs.existsSync(AUTH_DATEI)) {
    const d = JSON.parse(fs.readFileSync(AUTH_DATEI, 'utf8'));
    authCfg.url = String(d.url || '').trim().replace(/\/+$/, '');
    if (d.required === false) authCfg.required = false;
  }
} catch (e) { console.warn('server-auth.json unlesbar:', e.message); }
const AUTH_AN = !!authCfg.url;
if (AUTH_AN) console.log(`🔐 Konto-Pflicht aktiv — Namen werden über ${authCfg.url}/me.php bestätigt`);

// Token beim Konto-Backend prüfen → bestätigter Benutzername oder null (fail-closed).
async function pruefeKonto(token) {
  if (!token || typeof token !== 'string' || token.length > 4096) return null;
  try {
    const r = await fetch(authCfg.url + '/me.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(6000),
    });
    const j = await r.json().catch(() => null);
    if (r.ok && j && j.ok === true && typeof j.username === 'string' && j.username) return j.username;
  } catch { /* Netz-/Timeout-Fehler → als ungültig behandeln (sicher: kein Beitritt) */ }
  return null;
}

const TAG_LAENGE = 2400; // Sekunden pro Zyklus (= DAY_LENGTH): 30 min Tag + 10 min Nacht
// Sonnenphase wie in daynight.js: Tag füllt die ersten 3/4 des Zyklus
function sonnenphase(f) {
  const D = 3 / 4;
  return f < D ? (f / D) * 0.5 : 0.5 + ((f - D) / (1 - D)) * 0.5;
}

// ---- IP-Hilfen & Bann-Liste ----
// IPv6-gemappte IPv4-Adressen normalisieren, damit „::ffff:1.2.3.4" und
// „1.2.3.4" dieselbe Person sind; ::1 ist localhost.
function normIp(addr) {
  let ip = String(addr || 'unbekannt');
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1') ip = '127.0.0.1';
  return ip;
}

let bans = []; // [{ ip, names: [...], seit: ms }]
function bansLaden() {
  try {
    if (fs.existsSync(BANS_DATEI)) {
      const d = JSON.parse(fs.readFileSync(BANS_DATEI, 'utf8'));
      if (Array.isArray(d)) bans = d;
    }
  } catch (e) { console.warn('bans.json unlesbar:', e.message); }
}
function bansSpeichern() {
  try { fs.writeFileSync(BANS_DATEI, JSON.stringify(bans, null, 2)); }
  catch (e) { console.warn('bans.json speichern fehlgeschlagen:', e.message); }
}
function istGebannt(ip) { return bans.some((b) => b.ip === ip); }
bansLaden();

// Alle Spielernamen, die je von einer IP benutzt wurden (RAM + Welt-Daten)
const ipNamen = new Map(); // ip → Set<string>
function merkeName(ip, name) {
  if (!ipNamen.has(ip)) ipNamen.set(ip, new Set());
  ipNamen.get(ip).add(name);
}
function namenVon(ip) {
  const s = new Set(ipNamen.get(ip) || []);
  for (const key of Object.keys(welt.players || {})) {
    const i = key.indexOf('|'); // erstes „|" trennt IP vom Namen (IPs haben nie „|")
    if (i > 0 && key.slice(0, i) === ip) s.add(key.slice(i + 1));
  }
  return [...s];
}

// ---- Moderatoren (per IP, wie Bans; über die Steuerzentrale gesetzt) ----
let mods = []; // [{ ip, names: [...], seit: ms }]
function modsLaden() {
  try {
    if (fs.existsSync(MODS_DATEI)) {
      const d = JSON.parse(fs.readFileSync(MODS_DATEI, 'utf8'));
      if (Array.isArray(d)) mods = d;
    }
  } catch (e) { console.warn('mods.json unlesbar:', e.message); }
}
function modsSpeichern() {
  try { fs.writeFileSync(MODS_DATEI, JSON.stringify(mods, null, 2)); }
  catch (e) { console.warn('mods.json speichern fehlgeschlagen:', e.message); }
}
function istMod(ip) { return ip === '127.0.0.1' || mods.some((m) => m.ip === ip); } // Betreiber (localhost) immer Mod
modsLaden();

// ---- Welt-Zustand ----
let welt = {
  seed: 0,
  time: 18, // 0.03 × Taglänge = Morgen
  edits: {},  // "cx,cz" → { blockIndex: id }
  chests: {}, // "x,y,z" → slots-Array
};
try {
  if (fs.existsSync(WELT_DATEI)) {
    welt = JSON.parse(fs.readFileSync(WELT_DATEI, 'utf8'));
    console.log(`Welt geladen: Seed ${welt.seed}, ${Object.keys(welt.edits).length} Chunks mit Änderungen`);
  }
} catch (e) {
  console.warn('Konnte world-mp.json nicht laden:', e.message);
}
const seedArg = argVal('seed');
if (seedArg != null) {
  const s = /^-?\d+$/.test(seedArg) ? Number(seedArg) | 0 : [...seedArg].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0);
  if (s !== welt.seed && Object.keys(welt.edits).length > 0) {
    console.warn('ACHTUNG: --seed weicht von der gespeicherten Welt ab — Änderungen werden verworfen.');
    welt.edits = {}; welt.chests = {}; welt.time = 18;
  }
  welt.seed = s;
} else if (!welt.seed) {
  welt.seed = Math.floor(Math.random() * 2147483647);
}

let dirty = false;
// Welt-Metadaten für die Steuerzentrale sicherstellen (Name, Erstell-/Spieldatum).
// So trägt jede Weltdatei ihre Identität; die Steuerzentrale liest sie wieder aus.
welt.name ??= path.basename(WELT_DATEI, '.json');
welt.created ??= Date.now();
welt.lastPlayed = Date.now();
// Gespeicherte Spielerstände: "ip|name" → { state: {player,survival,inventory}, lastSeen }
// So bekommt jeder Spieler beim Wiederverbinden Items, Position & Leben zurück.
welt.players ??= {};
dirty = true;

function speichern() {
  if (!dirty) return;
  dirty = false;
  fs.writeFile(WELT_DATEI, JSON.stringify(welt), (e) => {
    if (e) console.warn('Speichern fehlgeschlagen:', e.message);
  });
}
setInterval(speichern, 30000);

// ---- Statische Dateien ----
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8',
};
// ---- Status-Dashboard ----
// Live-Daten des laufenden Servers (Spieler, Welt, Laufzeit) als JSON.
function statusDaten() {
  const liste = [...spieler.values()];
  const t = welt.time;
  const tag = Math.floor(t / TAG_LAENGE) + 1;
  const frac = (((t % TAG_LAENGE) + TAG_LAENGE) % TAG_LAENGE) / TAG_LAENGE;
  const stunden = (sonnenphase(frac) * 24 + 6) % 24; // Sonnenaufgang ≈ 06:00, Mittag 12:00
  const hh = String(Math.floor(stunden)).padStart(2, '0');
  const mm = String(Math.floor((stunden % 1) * 60)).padStart(2, '0');
  return {
    laeuft: true,
    seed: welt.seed,
    port: PORT,
    laufzeitSek: Math.floor((Date.now() - START_ZEIT) / 1000),
    weltName: welt.name || null,
    weltDatei: WELT_DATEI,
    hostId,
    hostName: liste.find((p) => p.id === hostId)?.name || null,
    spielerAnzahl: spieler.size,
    spieler: liste.map((p) => ({
      id: p.id, name: p.name, host: p.id === hostId, mod: !!p.mod, muted: !!p.muted,
      x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z),
    })),
    uhrzeit: `${hh}:${mm}`,
    tag,
    chunksMitAenderungen: Object.keys(welt.edits).length,
    truhen: Object.keys(welt.chests).length,
    ungespeichert: dirty,
  };
}

const STATUS_HTML = `<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fable MC — Server-Status</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Segoe UI', system-ui, sans-serif; background: #10162a; color: #e8ecf5; padding: 24px; }
  .wrap { max-width: 840px; margin: 0 auto; }
  h1 { font-size: 26px; margin: 0 0 4px; display: flex; align-items: center; gap: 12px; }
  .dot { width: 14px; height: 14px; border-radius: 50%; background: #46d17a; box-shadow: 0 0 10px #46d17a; animation: pulse 1.6s infinite; }
  .dot.off { background: #e0554e; box-shadow: 0 0 10px #e0554e; animation: none; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
  .sub { color: #8b97b5; margin: 0 0 22px; font-size: 13px; word-break: break-all; }
  .offline { display: none; background: #3a1a1a; border: 1px solid #e0554e; color: #ff9a92; padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 26px; }
  .card { background: #1a2340; border: 1px solid #2a3557; border-radius: 10px; padding: 13px 16px; }
  .card .label { font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: #7e8bb0; margin-bottom: 6px; }
  .card .val { font-size: 21px; font-weight: 600; }
  .card .val small { font-size: 12px; color: #8b97b5; font-weight: 400; }
  h2 { font-size: 15px; color: #b9c4e2; margin: 0 0 10px; }
  table { width: 100%; border-collapse: collapse; background: #1a2340; border-radius: 10px; overflow: hidden; }
  th, td { text-align: left; padding: 10px 14px; font-size: 14px; }
  th { background: #212c4e; color: #9aa6c9; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
  tr:nth-child(even) td { background: #182035; }
  .badge { background: #3a2f10; color: #ffd24a; border: 1px solid #6b551a; border-radius: 4px; padding: 1px 7px; font-size: 11px; margin-left: 8px; }
  .leer { color: #6b769a; font-style: italic; }
  .foot { margin-top: 20px; color: #6b769a; font-size: 12px; }
  code { background: #212c4e; padding: 2px 6px; border-radius: 4px; }
</style></head>
<body><div class="wrap">
  <h1><span class="dot" id="dot"></span>Fable MC — Server</h1>
  <p class="sub" id="sub">Verbinde…</p>
  <div class="offline" id="offline">⚠ Keine Verbindung zum Server — läuft <code>npm run mp</code> noch?</div>
  <div class="grid" id="grid"></div>
  <h2>Spieler online (<span id="pcount">0</span>)</h2>
  <table><thead><tr><th>Name</th><th>ID</th><th>Position (X / Y / Z)</th></tr></thead>
  <tbody id="players"></tbody></table>
  <p class="foot">Aktualisiert automatisch alle 2&nbsp;s · Stand <span id="stamp">—</span></p>
</div>
<script>
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;' }[c]));
  function karten(d) {
    const l = d.laufzeitSek, h = Math.floor(l/3600), m = Math.floor(l%3600/60), s = l%60;
    const lz = (h ? h+'h ' : '') + (m||h ? m+'m ' : '') + s+'s';
    return [
      ['Status', 'Läuft' + (d.ungespeichert ? ' <small>· ungespeichert</small>' : '')],
      ['Seed', d.seed],
      ['Port', d.port],
      ['Laufzeit', lz],
      ['Spielzeit', d.uhrzeit + ' <small>Tag ' + d.tag + '</small>'],
      ['Host', d.hostName ? esc(d.hostName) + ' <small>#' + d.hostId + '</small>' : '—'],
      ['Geänderte Chunks', d.chunksMitAenderungen],
      ['Truhen', d.truhen],
    ];
  }
  async function tick() {
    try {
      const r = await fetch('/status.json', { cache: 'no-store' });
      const d = await r.json();
      $('dot').classList.remove('off');
      $('offline').style.display = 'none';
      $('sub').textContent = 'Welt-Datei: ' + d.weltDatei;
      $('grid').innerHTML = karten(d).map(([lab, v]) =>
        '<div class="card"><div class="label">' + lab + '</div><div class="val">' + v + '</div></div>').join('');
      $('pcount').textContent = d.spielerAnzahl;
      $('players').innerHTML = d.spieler.length
        ? d.spieler.map((p) => '<tr><td>' + esc(p.name) + (p.host ? '<span class="badge">HOST</span>' : '') +
            '</td><td>#' + p.id + '</td><td>' + p.x + ' / ' + p.y + ' / ' + p.z + '</td></tr>').join('')
        : '<tr><td colspan="3" class="leer">Niemand online</td></tr>';
      $('stamp').textContent = new Date().toLocaleTimeString('de-DE');
    } catch (e) {
      $('dot').classList.add('off');
      $('offline').style.display = 'block';
      $('sub').textContent = 'Server nicht erreichbar';
    }
  }
  tick();
  setInterval(tick, 2000);
</script></body></html>`;

// POST-Body als JSON lesen (für Admin-Endpunkte)
function leseBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

const httpServer = http.createServer(async (req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  // ---- Admin (Kick/Bann): NUR vom eigenen Rechner aus (Steuerzentrale) ----
  if (p.startsWith('/admin/')) {
    const vonLoopback = normIp(req.socket.remoteAddress) === '127.0.0.1';
    const json = (obj, code = 200) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(obj));
    };
    if (!vonLoopback) { json({ ok: false, fehler: 'nur localhost' }, 403); return; }
    if (req.method === 'GET' && p === '/admin/bans') { json({ bans }); return; }
    if (req.method === 'POST' && p === '/admin/kick') { json(kickeSpieler((await leseBody(req)).id)); return; }
    if (req.method === 'POST' && p === '/admin/ban') { json(banneSpieler((await leseBody(req)).id)); return; }
    if (req.method === 'POST' && p === '/admin/unban') { json(entbanne(String((await leseBody(req)).ip || ''))); return; }
    if (req.method === 'GET' && p === '/admin/mods') { json({ mods }); return; }
    if (req.method === 'POST' && p === '/admin/mod') { json(machMod((await leseBody(req)).id)); return; }
    if (req.method === 'POST' && p === '/admin/unmod') { json(entmod(String((await leseBody(req)).ip || ''))); return; }
    if (req.method === 'POST' && p === '/admin/unmodid') { json(entmodById((await leseBody(req)).id)); return; }
    json({ ok: false, fehler: 'unbekannter Admin-Pfad' }, 404);
    return;
  }
  if (p === '/status' || p === '/status/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(STATUS_HTML);
    return;
  }
  if (p === '/status.json') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify(statusDaten()));
    return;
  }
  if (p === '/') p = '/index.html';
  const datei = path.join(__dirname, path.normalize(p));
  if (!datei.startsWith(__dirname)) { res.writeHead(403); res.end(); return; }
  fs.readFile(datei, (err, buf) => {
    if (err) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(datei)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
});

// ---- WebSocket / Spieler ----
// noServer + manuelles Upgrade: so hängt ws NICHT am httpServer-Listen und ein
// EADDRINUSE beim Binden landet nur in unserem eigenen Retry-Handler, statt die
// WebSocketServer-Instanz mit einem „unhandled error" abstürzen zu lassen.
const wss = new WebSocketServer({ noServer: true });
wss.on('error', (e) => console.warn('WebSocket-Server-Fehler:', e.message));
httpServer.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});
let nextId = 1;
let hostId = 0; // der Host simuliert Mobs & Events (erster Spieler; rückt nach)
const geklauteItems = new Set(); // netIds bereits aufgehobener Items (Dedup)
const spieler = new Map(); // ws → { id, name, x, y, z, yaw, pitch }

function wsVonId(id) {
  for (const [ws, p] of spieler) if (p.id === id) return ws;
  return null;
}
function neuenHostWählen() {
  const erster = spieler.values().next().value;
  hostId = erster ? erster.id : 0;
  if (hostId) broadcast({ type: 'host', id: hostId });
}

function sende(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}
function broadcast(msg, außer = null) {
  const s = JSON.stringify(msg);
  for (const ws of spieler.keys()) {
    if (ws !== außer && ws.readyState === 1) ws.send(s);
  }
}
// Spielerliste (Name, Ping, Mod) für die Tab-Übersicht an alle schicken
function sendeRoster() {
  broadcast({
    type: 'roster',
    players: [...spieler.values()].map((p) => ({
      id: p.id, name: p.name, ping: p.ping ?? 0, mod: !!p.mod,
    })),
  });
}

wss.on('connection', (ws, req) => {
  const ip = normIp(req?.socket?.remoteAddress);
  if (istGebannt(ip)) { // gebannte IPs kommen gar nicht erst rein
    sende(ws, { type: 'banned' });
    setTimeout(() => ws.close(), 100);
    return;
  }
  // Server-Identität sofort schicken — auch der Status-Ping (ohne „hello") liest sie
  sende(ws, { type: 'serverinfo', name: serverInfo.name, motd: serverInfo.motd, icon: serverInfo.icon });
  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const ich = spieler.get(ws);

    if (msg.type === 'hello') {
      if (spieler.has(ws) || ws._joining) return; // Doppel-„hello" abweisen
      ws._joining = true;
      let name = String(msg.name || 'Spieler').slice(0, 20) || 'Spieler';
      // Anti-Spoofing: bei Konto-Pflicht muss ein gültiges Token dabei sein; der vom
      // Backend bestätigte Name gewinnt — der Client kann keinen fremden Namen wählen.
      if (AUTH_AN) {
        const bestaetigt = await pruefeKonto(msg.token);
        if (ws.readyState !== 1) return; // während der Prüfung getrennt
        if (bestaetigt) {
          name = String(bestaetigt).slice(0, 20);
        } else if (authCfg.required) {
          sende(ws, { type: 'authfail', reason: 'Anmeldung ungültig oder Konto-Server nicht erreichbar. Bitte neu anmelden.' });
          setTimeout(() => { try { ws.close(); } catch { /* egal */ } }, 200);
          return;
        }
        // Konto bereits online? Zweite gleichzeitige Sitzung desselben Kontos abweisen.
        if (bestaetigt && [...spieler.values()].some((p) => p.name === name)) {
          sende(ws, { type: 'authfail', reason: 'Dieses Konto ist bereits auf dem Server aktiv.' });
          setTimeout(() => { try { ws.close(); } catch { /* egal */ } }, 200);
          return;
        }
      }
      const id = nextId++;
      merkeName(ip, name);
      const mod = istMod(ip);
      spieler.set(ws, { id, name, ip, mod, muted: false, x: 0, y: 200, z: 0, yaw: 0, pitch: 0 });
      if (!hostId) hostId = id; // erster Spieler wird Host
      // Gespeicherten Stand (Items, Position, Leben) für diese IP + diesen Namen mitgeben
      const gespeichert = welt.players[ip + '|' + name];
      sende(ws, {
        type: 'welcome', id, hostId, seed: welt.seed, time: welt.time, pvp: pvpAn, mod,
        rules: Rules, // Welt-Regeln des Servers (Gäste übernehmen sie)
        edits: welt.edits, chests: welt.chests,
        playerState: gespeichert ? gespeichert.state : null,
        players: [...spieler.values()].filter((p) => p.id !== id),
      });
      if (mod) sende(ws, { type: 'chat', name: '⚙', text: 'Du bist Moderator — /help zeigt deine Befehle' });
      broadcast({ type: 'join', id, name }, ws);
      broadcast({ type: 'chat', name: '⚙', text: `${name} ist beigetreten` }, ws);
      sendeRoster();
      console.log(`+ ${name} (#${id}, ${ip}) — ${spieler.size} online (Host #${hostId})${gespeichert ? ' [Stand wiederhergestellt]' : ''}`);
      return;
    }
    if (!ich) return;

    switch (msg.type) {
      case 'move':
        ich.x = msg.x; ich.y = msg.y; ich.z = msg.z; ich.yaw = msg.yaw; ich.pitch = msg.pitch;
        ich.held = msg.held ?? 0; // gehaltenes Item (für die Hand des Avatars)
        broadcast({ type: 'move', id: ich.id, x: msg.x, y: msg.y, z: msg.z, yaw: msg.yaw, pitch: msg.pitch, held: ich.held }, ws);
        break;
      case 'edits': {
        // [[x,y,z,id], …] — in den Welt-Zustand übernehmen und weiterreichen
        if (!Array.isArray(msg.list) || msg.list.length > 512) return;
        for (const e of msg.list) {
          const [x, y, z, id] = e;
          if (![x, y, z, id].every(Number.isFinite)) continue;
          const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
          const key = cx + ',' + cz;
          const idx = (x - cx * 16) + (z - cz * 16) * 16 + y * 256;
          (welt.edits[key] ??= {})[idx] = id;
        }
        dirty = true;
        broadcast({ type: 'edits', list: msg.list }, ws);
        break;
      }
      case 'chest':
        if (typeof msg.key !== 'string' || !Array.isArray(msg.slots)) return;
        welt.chests[msg.key] = msg.slots;
        dirty = true;
        broadcast({ type: 'chest', key: msg.key, slots: msg.slots }, ws);
        break;
      case 'brew': // Braustand-Zustand (Slots + Fortschritt) → an alle anderen
        if (typeof msg.key !== 'string') return;
        broadcast({ type: 'brew', key: msg.key, state: msg.state }, ws);
        break;
      case 'wash': // Washer-Zustand → an alle anderen
        if (typeof msg.key !== 'string') return;
        broadcast({ type: 'wash', key: msg.key, state: msg.state }, ws);
        break;
      case 'chat': {
        const text = String(msg.text || '').slice(0, 200).trim();
        if (!text) break;
        if (text[0] === '/') { handleCommand(ws, ich, text); break; }
        if (ich.muted) { sende(ws, { type: 'chat', name: '⚙', text: '🔇 Du bist stummgeschaltet.' }); break; }
        broadcast({ type: 'chat', name: ich.name, text, mod: ich.mod });
        break;
      }
      case 'pong': // Antwort auf unseren Ping → Round-Trip-Zeit merken
        if (Number.isFinite(msg.t)) ich.ping = Math.min(9999, Math.max(0, Date.now() - msg.t));
        break;
      case 'time': // z. B. Bett-Schlaf: Zeit-Sprung für alle
        if (Number.isFinite(msg.time)) {
          welt.time = msg.time;
          dirty = true;
          broadcast({ type: 'time', time: welt.time }, ws);
        }
        break;
      case 'pstate': { // Spielerstand (Inventar, Position, Leben) pro IP+Name sichern
        if (!msg.state || typeof msg.state !== 'object') return;
        if (JSON.stringify(msg.state).length > 200000) return; // Schutz vor Müll-Daten
        welt.players[ich.ip + '|' + ich.name] = { state: msg.state, lastSeen: Date.now() };
        dirty = true;
        break;
      }
      // ---- Stufe 2: Host-Autorität für Mobs & Events ----
      case 'ents': // Entity-Snapshot vom Host → an alle anderen
        if (ich.id === hostId) broadcast({ type: 'ents', list: msg.list }, ws);
        break;
      case 'bossring': // Boss-Telegraf (nur Host) → an alle anderen zeigen
        if (ich.id === hostId) broadcast({ type: 'bossring', x: msg.x, y: msg.y, z: msg.z, r: msg.r, dur: msg.dur }, ws);
        break;
      case 'idrop': // gedropptes Item → an alle anderen weiterreichen
        broadcast({ type: 'idrop', netId: msg.netId, x: msg.x, y: msg.y, z: msg.z, id: msg.id, count: msg.count }, ws);
        break;
      case 'ipick': { // Item aufgehoben → einmalig an alle (Dedup gegen Doppel-Klau)
        if (geklauteItems.has(msg.netId)) break;
        geklauteItems.add(msg.netId);
        if (geklauteItems.size > 4000) geklauteItems.clear(); // Speicher zügeln
        broadcast({ type: 'ipick', netId: msg.netId }, ws);
        break;
      }
      case 'hit': case 'use': case 'evtrig': case 'igniteTnt': { // Mitspieler-Aktion → an den Host
        const hostWs = wsVonId(hostId);
        if (hostWs && hostWs !== ws) sende(hostWs, { ...msg, von: ich.id });
        break;
      }
      case 'phit': { // Mob/Explosion trifft Spieler X → nur an den Betroffenen
        // (nicht Host-exklusiv: auch Gast-TNT darf Mitspieler verletzen)
        const ziel = wsVonId(msg.target);
        if (ziel) sende(ziel, { type: 'phit', dmg: msg.dmg, kx: msg.kx, kz: msg.kz });
        break;
      }
      case 'pslow': { // Boss-Brüllen (nur Host) verlangsamt Spieler X
        if (ich.id !== hostId) break;
        const ziel = wsVonId(msg.target);
        if (ziel) sende(ziel, { type: 'pslow', dur: msg.dur });
        break;
      }
      case 'xp': { // Host belohnt Spieler X mit XP für einen Kill → nur an das Ziel
        if (ich.id !== hostId) break;
        const ziel = wsVonId(msg.target);
        if (ziel) sende(ziel, { type: 'xp', amount: msg.amount });
        break;
      }
      // ---- Sichtbare Aktionen & Kampf zwischen Spielern ----
      case 'swing': // Arm-Schwung (Schlagen/Abbauen) → alle anderen zeigen ihn
        broadcast({ type: 'swing', id: ich.id }, ws);
        break;
      case 'phurt': // ich habe Schaden bekommen → Avatar bei allen rot aufblitzen
        broadcast({ type: 'phurt', id: ich.id }, ws);
        break;
      case 'pdead': // ich bin gestorben → Avatar umfallen + poof
        broadcast({ type: 'pdead', id: ich.id }, ws);
        break;
      case 'palive': // ich bin respawnt → Avatar wieder aufrichten
        broadcast({ type: 'palive', id: ich.id }, ws);
        break;
      case 'pvp': { // Spieler schlägt Spieler — nur wenn PvP an ist
        if (!pvpAn) break;
        const ziel = wsVonId(msg.target);
        if (ziel && ziel !== ws) sende(ziel, { type: 'phit', dmg: msg.dmg, kx: msg.kx, kz: msg.kz, von: ich.id });
        break;
      }
    }
  });

  ws.on('close', () => {
    const ich = spieler.get(ws);
    if (!ich) return;
    spieler.delete(ws);
    broadcast({ type: 'leave', id: ich.id });
    broadcast({ type: 'chat', name: '⚙', text: `${ich.name} hat verlassen` });
    sendeRoster();
    if (ich.id === hostId) neuenHostWählen(); // Host-Migration
    console.log(`- ${ich.name} (#${ich.id}) — ${spieler.size} online (Host #${hostId})`);
  });
});

// ---- Kick & Bann (nur über die Steuerzentrale / localhost erreichbar) ----

function kickeSpieler(id, grund) {
  const ws = wsVonId(Number(id));
  if (!ws) return { ok: false, fehler: 'Spieler nicht gefunden.' };
  const p = spieler.get(ws);
  sende(ws, { type: 'kicked', grund: grund || '' });
  setTimeout(() => { try { ws.close(); } catch { /* egal */ } }, 200);
  broadcast({ type: 'chat', name: '⚙', text: `${p.name} wurde vom Server geworfen` }, ws);
  console.log(`⚠ Kick: ${p.name} (#${p.id}, ${p.ip})`);
  return { ok: true };
}

function banneSpieler(id) {
  const ws = wsVonId(Number(id));
  if (!ws) return { ok: false, fehler: 'Spieler nicht gefunden.' };
  const p = spieler.get(ws);
  if (p.ip === '127.0.0.1') return { ok: false, fehler: 'localhost kann nicht gebannt werden (das wärst du selbst).' };
  if (!istGebannt(p.ip)) {
    bans.push({ ip: p.ip, names: namenVon(p.ip), seit: Date.now() });
    bansSpeichern();
  }
  // ALLE Verbindungen dieser IP trennen (auch Zweit-Clients)
  for (const [w, sp] of [...spieler]) {
    if (sp.ip === p.ip) {
      sende(w, { type: 'banned' });
      setTimeout(() => { try { w.close(); } catch { /* egal */ } }, 200);
    }
  }
  broadcast({ type: 'chat', name: '⚙', text: `${p.name} wurde gebannt` });
  console.log(`⛔ Bann: ${p.name} (${p.ip})`);
  return { ok: true };
}

function entbanne(ip) {
  const vorher = bans.length;
  bans = bans.filter((b) => b.ip !== ip);
  if (bans.length !== vorher) bansSpeichern();
  return { ok: true };
}

// ---- Moderatoren ----

function machMod(id) {
  const ws = wsVonId(Number(id));
  if (!ws) return { ok: false, fehler: 'Spieler nicht gefunden.' };
  const p = spieler.get(ws);
  if (!mods.some((m) => m.ip === p.ip)) {
    mods.push({ ip: p.ip, names: namenVon(p.ip), seit: Date.now() });
    modsSpeichern();
  }
  p.mod = true;
  sende(ws, { type: 'modset', on: true });
  sende(ws, { type: 'chat', name: '⚙', text: '⭐ Du bist jetzt Moderator — /help zeigt deine Befehle' });
  console.log(`⭐ Mod: ${p.name} (${p.ip})`);
  return { ok: true };
}

function entmod(ip) {
  const vorher = mods.length;
  mods = mods.filter((m) => m.ip !== ip);
  if (mods.length !== vorher) modsSpeichern();
  for (const [w, sp] of spieler) { // laufende Spieler dieser IP herabstufen
    if (sp.ip === ip && ip !== '127.0.0.1') {
      sp.mod = false;
      sende(w, { type: 'modset', on: false });
      sende(w, { type: 'chat', name: '⚙', text: 'Dein Moderator-Status wurde entfernt.' });
    }
  }
  return { ok: true };
}
function entmodById(id) { // Online-Spieler herabstufen (Panel kennt nur die id, nicht die IP)
  const ws = wsVonId(Number(id));
  if (!ws) return { ok: false, fehler: 'Spieler nicht gefunden.' };
  const ip = spieler.get(ws).ip;
  if (ip === '127.0.0.1') return { ok: false, fehler: 'localhost ist immer Mod.' };
  return entmod(ip);
}

// ---- Chat-Befehle ----
// Öffentlich: /help, /list. Alles andere nur für Moderatoren. Aktionen, die einen
// bestimmten Client betreffen (Teleport, Töten, Heilen, Geben …), schickt der
// Server als { type:'cmd' } an dessen Client, der sie ausführt.
function handleCommand(ws, ich, text) {
  const teile = text.slice(1).trim().split(/\s+/);
  const cmd = (teile[0] || '').toLowerCase();
  const args = teile.slice(1);
  const antwort = (t) => sende(ws, { type: 'chat', name: '⚙', text: t });
  const finde = (nm) => {
    for (const [w, p] of spieler) if (p.name.toLowerCase() === String(nm).toLowerCase()) return { w, p };
    return null;
  };
  const zielOderSelbst = (nm) => (nm ? finde(nm) : { w: ws, p: ich });
  const setzeZeit = (t) => { welt.time = t; broadcast({ type: 'time', time: welt.time }); dirty = true; };
  const tagBasis = () => Math.floor(welt.time / TAG_LAENGE) * TAG_LAENGE;

  // ---- öffentlich ----
  if (cmd === 'help' || cmd === 'hilfe' || cmd === '?') {
    antwort('Befehle: /list, /help');
    if (ich.mod) {
      antwort('Mod: /day /night /time /tp /tphere /kick /ban /unban /kill /heal /feed /give /god /fly /gm /clear /say /pvp /mute /unmute /mods');
      antwort('Bsp.: /tp Name · /tphere Name · /give Name diamant 10 · /gm creative [Name] · /time day|night|noon|midnight|Sekunden');
    }
    return;
  }
  if (cmd === 'list' || cmd === 'players' || cmd === 'spieler') {
    antwort('Online (' + spieler.size + '): ' + [...spieler.values()].map((p) => p.name + (p.mod ? '⭐' : '')).join(', '));
    return;
  }

  // ---- ab hier nur Moderatoren ----
  if (!ich.mod) { antwort('⛔ „/' + cmd + '" ist nur für Moderatoren.'); return; }

  switch (cmd) {
    case 'day': case 'tag':
      setzeZeit(tagBasis() + 60);
      broadcast({ type: 'chat', name: '⚙', text: '☀ ' + ich.name + ' hat es Tag gemacht' });
      break;
    case 'night': case 'nacht':
      setzeZeit(tagBasis() + 2100);
      broadcast({ type: 'chat', name: '⚙', text: '🌙 ' + ich.name + ' hat es Nacht gemacht' });
      break;
    case 'noon': case 'mittag': setzeZeit(tagBasis() + 900); antwort('🕛 Mittag'); break;
    case 'midnight': case 'mitternacht': setzeZeit(tagBasis() + 2100); antwort('🌑 Mitternacht'); break;
    case 'time': case 'zeit': {
      const a = (args[0] || '').toLowerCase();
      if (a === 'day' || a === 'tag') setzeZeit(tagBasis() + 60);
      else if (a === 'night' || a === 'nacht' || a === 'midnight' || a === 'mitternacht') setzeZeit(tagBasis() + 2100);
      else if (a === 'noon' || a === 'mittag') setzeZeit(tagBasis() + 900);
      else if (/^\d+$/.test(a)) setzeZeit(Number(a));
      else { antwort('Nutzung: /time day|night|noon|midnight|<Sekunden>'); break; }
      antwort('Uhrzeit gesetzt.');
      break;
    }
    case 'tp': case 'teleport': {
      if (args.length === 1) {
        const z = finde(args[0]);
        if (!z) { antwort('Spieler „' + args[0] + '" nicht gefunden.'); break; }
        sende(ws, { type: 'cmd', action: 'tp', x: z.p.x, y: z.p.y, z: z.p.z });
        antwort('➤ Zu ' + z.p.name + ' teleportiert.');
      } else if (args.length >= 2) {
        const a = finde(args[0]), b = finde(args[1]);
        if (!a || !b) { antwort('Spieler nicht gefunden.'); break; }
        sende(a.w, { type: 'cmd', action: 'tp', x: b.p.x, y: b.p.y, z: b.p.z });
        broadcast({ type: 'chat', name: '⚙', text: '➤ ' + a.p.name + ' → ' + b.p.name });
      } else antwort('Nutzung: /tp Spieler  oder  /tp SpielerA SpielerB');
      break;
    }
    case 'tphere': case 'bring': {
      const z = finde(args[0]);
      if (!z) { antwort('Spieler nicht gefunden.'); break; }
      sende(z.w, { type: 'cmd', action: 'tp', x: ich.x, y: ich.y, z: ich.z });
      antwort('➤ ' + z.p.name + ' zu dir geholt.');
      break;
    }
    case 'kick': {
      const z = finde(args[0]);
      if (!z) { antwort('Spieler nicht gefunden.'); break; }
      kickeSpieler(z.p.id, args.slice(1).join(' '));
      break;
    }
    case 'ban': {
      const z = finde(args[0]);
      if (!z) { antwort('Spieler nicht gefunden.'); break; }
      const r = banneSpieler(z.p.id); if (!r.ok) antwort(r.fehler);
      break;
    }
    case 'unban': case 'entbannen':
      if (!args[0]) { antwort('Nutzung: /unban <IP>'); break; }
      entbanne(args[0]); antwort('Entbannt: ' + args[0]);
      break;
    case 'kill': case 'töten': {
      const z = zielOderSelbst(args[0]);
      if (!z) { antwort('Spieler nicht gefunden.'); break; }
      sende(z.w, { type: 'cmd', action: 'kill' });
      broadcast({ type: 'chat', name: '⚙', text: '💀 ' + z.p.name + ' wurde getötet' });
      break;
    }
    case 'heal': case 'heilen': {
      const z = zielOderSelbst(args[0]);
      if (!z) { antwort('Spieler nicht gefunden.'); break; }
      sende(z.w, { type: 'cmd', action: 'heal' }); antwort('❤ ' + z.p.name + ' geheilt.');
      break;
    }
    case 'feed': case 'füttern': {
      const z = zielOderSelbst(args[0]);
      if (!z) { antwort('Spieler nicht gefunden.'); break; }
      sende(z.w, { type: 'cmd', action: 'feed' }); antwort('🍖 ' + z.p.name + ' gesättigt.');
      break;
    }
    case 'give': case 'geben': {
      if (args.length < 2) { antwort('Nutzung: /give Spieler Item [Anzahl]'); break; }
      const z = finde(args[0]);
      if (!z) { antwort('Spieler nicht gefunden.'); break; }
      const count = Math.min(999, Math.max(1, parseInt(args[2] || '1', 10) || 1));
      sende(z.w, { type: 'cmd', action: 'give', item: args[1], count });
      antwort('Gebe ' + count + '× „' + args[1] + '" an ' + z.p.name + ' …');
      break;
    }
    case 'god': case 'gott': {
      const z = zielOderSelbst(args[0]);
      if (!z) { antwort('Spieler nicht gefunden.'); break; }
      sende(z.w, { type: 'cmd', action: 'god' }); antwort('🛡 Unverwundbarkeit für ' + z.p.name + ' umgeschaltet.');
      break;
    }
    case 'fly': case 'fliegen': {
      const z = zielOderSelbst(args[0]);
      if (!z) { antwort('Spieler nicht gefunden.'); break; }
      sende(z.w, { type: 'cmd', action: 'fly' }); antwort('🕊 Flugmodus für ' + z.p.name + ' umgeschaltet.');
      break;
    }
    case 'gm': case 'gamemode': case 'spielmodus': {
      const a = (args[0] || '').toLowerCase();
      let mode = null;
      if (['c', 'creative', 'kreativ', '1'].includes(a)) mode = 'creative';
      else if (['s', 'survival', 'überleben', '0'].includes(a)) mode = 'survival';
      if (!mode) { antwort('Nutzung: /gm creative|survival [Spieler]'); break; }
      const z = zielOderSelbst(args[1]);
      if (!z) { antwort('Spieler nicht gefunden.'); break; }
      sende(z.w, { type: 'cmd', action: 'gm', mode }); antwort('Modus „' + mode + '" für ' + z.p.name + '.');
      break;
    }
    case 'clear': case 'leeren': {
      const z = zielOderSelbst(args[0]);
      if (!z) { antwort('Spieler nicht gefunden.'); break; }
      sende(z.w, { type: 'cmd', action: 'clear' }); antwort('🗑 Inventar von ' + z.p.name + ' geleert.');
      break;
    }
    case 'say': case 'broadcast': case 'sag': {
      const nachricht = args.join(' ').trim();
      if (!nachricht) { antwort('Nutzung: /say <Nachricht>'); break; }
      broadcast({ type: 'chat', name: '📢 ' + ich.name, text: nachricht, mod: true });
      break;
    }
    case 'pvp': {
      const a = (args[0] || '').toLowerCase();
      if (a === 'on' || a === 'an') pvpAn = true;
      else if (a === 'off' || a === 'aus') pvpAn = false;
      else { antwort('PvP ist ' + (pvpAn ? 'AN' : 'AUS') + '. Nutzung: /pvp on|off'); break; }
      broadcast({ type: 'pvpset', on: pvpAn });
      broadcast({ type: 'chat', name: '⚙', text: '⚔ PvP ist jetzt ' + (pvpAn ? 'AN' : 'AUS') });
      break;
    }
    case 'mute': case 'stumm': {
      const z = finde(args[0]);
      if (!z) { antwort('Spieler nicht gefunden.'); break; }
      z.p.muted = true;
      sende(z.w, { type: 'chat', name: '⚙', text: '🔇 Du wurdest stummgeschaltet.' });
      antwort(z.p.name + ' stummgeschaltet.');
      break;
    }
    case 'unmute': case 'entstummen': {
      const z = finde(args[0]);
      if (!z) { antwort('Spieler nicht gefunden.'); break; }
      z.p.muted = false;
      sende(z.w, { type: 'chat', name: '⚙', text: '🔊 Stummschaltung aufgehoben.' });
      antwort(z.p.name + ' entstummt.');
      break;
    }
    case 'mods':
      antwort('Moderatoren: ' + (mods.map((m) => m.names[0] || m.ip).join(', ') || '—') + ' (localhost ist immer Mod)');
      break;
    default:
      antwort('Unbekannter Befehl „/' + cmd + '". /help zeigt alle.');
  }
}

// Uhrzeit läuft auf dem Server weiter; alle 5 s Sync an alle
setInterval(() => { welt.time += 1; }, 1000);
setInterval(() => { broadcast({ type: 'time', time: welt.time }); dirty = true; }, 5000);
// Ping messen (Server → Client → Server) und die Tab-Spielerliste aktuell halten
setInterval(() => {
  const jetzt = Date.now();
  for (const ws of spieler.keys()) sende(ws, { type: 'ping', t: jetzt });
  sendeRoster();
}, 2000);

function geordnetBeenden() {
  dirty = true;
  speichern();
  setTimeout(() => process.exit(0), 300); // fs.writeFile Zeit zum Flushen geben
}
process.on('SIGINT', geordnetBeenden);
process.on('SIGTERM', geordnetBeenden);
// Die Steuerzentrale (launcher.js) startet uns als Kindprozess und kann über
// stdin „stop" schicken — dann speichern wir und beenden sauber (auch unter
// Windows, wo kill()-Signale unzuverlässig sind). Direkt im Terminal geht das ebenso.
try {
  process.stdin.on('data', (d) => { if (String(d).trim() === 'stop') geordnetBeenden(); });
  process.stdin.resume();
  // Hinweis: KEIN stdin-'end'-Handler. Wird der Server ohne Terminal gestartet
  // (Hintergrund/kein TTY), kommt sofort ein stdin-EOF — das dürfte ihn nicht
  // beenden. Der Waisen-Schutz läuft zuverlässig über die --parent-PID-Prüfung.
} catch { /* kein stdin verfügbar — egal */ }
// Zusätzlicher Waisen-Schutz: Hat uns die Steuerzentrale gestartet (--parent),
// überwachen wir aktiv ihre PID. Windows schließt Pipes bei hartem Kill nicht
// zuverlässig, daher prüfen wir alle 2 s, ob der Elternprozess noch existiert.
const parentArg = argVal('parent');
if (parentArg && /^\d+$/.test(parentArg)) {
  const ppid = Number(parentArg);
  setInterval(() => {
    try { process.kill(ppid, 0); } // Signal 0 = nur Existenz prüfen
    catch (e) { if (e.code === 'ESRCH') geordnetBeenden(); } // Eltern weg → mitgehen
  }, 1000);
}

httpServer.on('listening', () => {
  console.log(`Fable MC Mehrspieler-Server läuft:`);
  console.log(`  Spiel:  http://localhost:${PORT}`);
  console.log(`  Status: http://localhost:${PORT}/status`);
  console.log(`  Seed:   ${welt.seed}`);
  console.log(`  Welt:   ${WELT_DATEI}`);
});
// Port beim (Neu-)Start evtl. noch vom eben beendeten Server belegt → kurz
// erneut versuchen, statt sofort abzustürzen. Behebt „Neustart geht nicht".
let bindVersuche = 0;
httpServer.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && bindVersuche < 15) {
    bindVersuche++;
    console.warn(`Port ${PORT} noch belegt — neuer Bindeversuch ${bindVersuche}/15 in 400 ms …`);
    setTimeout(() => httpServer.listen(PORT), 400);
    return;
  }
  console.error('Server-Fehler beim Binden von Port ' + PORT + ':', e.message);
  process.exit(1);
});
httpServer.listen(PORT);
