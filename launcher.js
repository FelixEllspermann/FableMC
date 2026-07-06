// Fable MC — Steuerzentrale (Launcher).
// Ein kleines Fenster VOR dem Serverstart: Welt auswählen oder neue Welt mit
// Seed anlegen, dann startet der eigentliche Spielserver. Danach zeigt die
// Seite Live-Infos (Spieler, Laufzeit, Log) und bietet Stopp/Neustart.
//
// Start:      node launcher.js         (öffnet die Steuerzentrale im Browser)
// Doppelklick: "Fable MC.bat"
// Optionen:   --port 8130   (Port der Steuerzentrale)
//             --gameport 8123  (Port des Spielservers)
//             --no-open     (Browser nicht automatisch öffnen)

import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argVal = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };
const CTRL_PORT = Number(argVal('port') || 8130);
let gamePort = Number(argVal('gameport') || 8123); // Standard 8123, im Panel änderbar
const AUTO_OPEN = !args.includes('--no-open');
const WORLDS_DIR = path.resolve(argVal('worlds') || path.join(__dirname, 'worlds'));
const SERVER_JS = path.join(__dirname, 'server.js');
const BANS_DATEI = path.join(__dirname, 'bans.json');
const MODS_DATEI = path.join(__dirname, 'mods.json');

function portOk(p) { return Number.isInteger(p) && p >= 1024 && p <= 65535 && p !== CTRL_PORT; }

// ---- Welten-Verwaltung ----

function ensureWorldsDir() {
  if (!fs.existsSync(WORLDS_DIR)) fs.mkdirSync(WORLDS_DIR, { recursive: true });
  // Einmalige Migration einer bereits vorhandenen Einzelwelt (world-mp.json)
  const alt = path.join(__dirname, 'world-mp.json');
  const hatWelten = fs.readdirSync(WORLDS_DIR).some((f) => f.endsWith('.json'));
  if (!hatWelten && fs.existsSync(alt)) {
    try {
      const w = JSON.parse(fs.readFileSync(alt, 'utf8'));
      w.name ??= 'Hauptwelt';
      w.created ??= Date.now();
      w.lastPlayed ??= Date.now();
      fs.writeFileSync(path.join(WORLDS_DIR, 'hauptwelt.json'), JSON.stringify(w));
      console.log('Bestehende Welt aus world-mp.json übernommen → worlds/hauptwelt.json');
    } catch (e) { console.warn('Migration fehlgeschlagen:', e.message); }
  }
}

function slugify(name) {
  const map = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss', ' ': '-' };
  const s = String(name).toLowerCase().trim()
    .replace(/[äöüß ]/g, (c) => map[c] || '-')
    .replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return s || 'welt';
}

function uniqueSlug(base) {
  let s = base, i = 2;
  while (fs.existsSync(path.join(WORLDS_DIR, s + '.json'))) { s = base + '-' + i; i++; }
  return s;
}

// Seed-String → Zahl (identisch zu server.js, damit gleicher Seed = gleiche Welt)
function seedToNumber(str) {
  const t = String(str == null ? '' : str).trim();
  if (!t) return Math.floor(Math.random() * 2147483647);
  return /^-?\d+$/.test(t) ? Number(t) | 0 : [...t].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0);
}

function listWorlds() {
  ensureWorldsDir();
  const out = [];
  for (const f of fs.readdirSync(WORLDS_DIR)) {
    if (!f.endsWith('.json')) continue;
    const slug = f.slice(0, -5);
    try {
      const full = path.join(WORLDS_DIR, f);
      const stat = fs.statSync(full);
      const w = JSON.parse(fs.readFileSync(full, 'utf8'));
      out.push({
        slug, name: w.name || slug, seed: w.seed ?? 0,
        created: w.created || stat.birthtimeMs, lastPlayed: w.lastPlayed || stat.mtimeMs,
        edits: w.edits ? Object.keys(w.edits).length : 0,
        chests: w.chests ? Object.keys(w.chests).length : 0,
        sizeKB: Math.max(1, Math.round(stat.size / 1024)),
      });
    } catch { /* defekte Datei überspringen */ }
  }
  out.sort((a, b) => b.lastPlayed - a.lastPlayed);
  return out;
}

function createWorld(name, seedStr) {
  ensureWorldsDir();
  const clean = String(name || '').trim().slice(0, 40) || 'Neue Welt';
  const slug = uniqueSlug(slugify(clean));
  const w = {
    name: clean, seed: seedToNumber(seedStr), created: Date.now(), lastPlayed: Date.now(),
    time: 18, edits: {}, chests: {},
  };
  fs.writeFileSync(path.join(WORLDS_DIR, slug + '.json'), JSON.stringify(w));
  return slug;
}

function deleteWorld(slug) {
  const p = path.join(WORLDS_DIR, path.basename(String(slug)) + '.json');
  if (fs.existsSync(p) && p.startsWith(WORLDS_DIR)) fs.unlinkSync(p);
}

// ---- Server-Prozess ----

let child = null;
let aktuelleWelt = null; // { slug, name, seed, pvp }
let startedAt = 0;
let letzterExit = null;  // { code, at }
let letztesPvp = false;  // zuletzt gewählte PvP-Einstellung (für Neustart)
let letzteInfo = null;   // zuletzt gewählte Server-Identität (Name/MotD/Bild) — bleibt bei Neustart
// Konto-Pflicht (Anti-Spoofing) — bleibt lokal in server-auth.json, wird beim Start hinterlegt.
const AUTH_DATEI = path.join(__dirname, 'server-auth.json');
let letzteAuth = { url: '', required: true };
try {
  if (fs.existsSync(AUTH_DATEI)) {
    const d = JSON.parse(fs.readFileSync(AUTH_DATEI, 'utf8'));
    letzteAuth = { url: String(d.url || ''), required: d.required !== false };
  }
} catch { /* egal — dann eben ohne Konto-Pflicht */ }
const logBuf = [];

function logZeile(s) {
  const zeit = new Date().toLocaleTimeString('de-DE');
  for (const z of String(s).replace(/\r/g, '').split('\n')) {
    if (z.length) logBuf.push('[' + zeit + '] ' + z);
  }
  while (logBuf.length > 300) logBuf.shift();
}

function serverLaeuft() { return !!child && child.exitCode === null && !child.killed; }

function starteServer(slug, wunschPort, pvp, info) {
  if (serverLaeuft()) return { ok: false, fehler: 'Der Server läuft bereits.' };
  if (wunschPort != null && wunschPort !== '') {
    const p = Number(wunschPort);
    if (!portOk(p)) return { ok: false, fehler: 'Ungültiger Port (1024–65535, nicht ' + CTRL_PORT + ').' };
    gamePort = p;
  }
  const datei = path.join(WORLDS_DIR, path.basename(String(slug)) + '.json');
  if (!fs.existsSync(datei)) return { ok: false, fehler: 'Welt nicht gefunden.' };
  let w;
  try { w = JSON.parse(fs.readFileSync(datei, 'utf8')); } catch { return { ok: false, fehler: 'Weltdatei ist beschädigt.' }; }
  letzterExit = null;
  logBuf.length = 0;
  letztesPvp = !!pvp;
  aktuelleWelt = { slug, name: w.name || slug, seed: w.seed ?? 0, pvp: letztesPvp };
  startedAt = Date.now();
  logZeile('Starte Server für Welt „' + aktuelleWelt.name + '" (Seed ' + aktuelleWelt.seed + ') auf Port ' + gamePort +
    (letztesPvp ? ' · PvP AN' : '') + ' …');
  // Server-Identität (Name, MotD, Bild) für server.js hinterlegen (letzter Stand bleibt für Neustart)
  if (info) {
    letzteInfo = {
      name: String(info.name || '').slice(0, 32),
      motd: String(info.motd || '').slice(0, 120),
      icon: (typeof info.icon === 'string' && info.icon.startsWith('data:image')) ? info.icon.slice(0, 200000) : '',
    };
  }
  try { fs.writeFileSync(path.join(__dirname, 'server-info.json'), JSON.stringify(letzteInfo || {})); }
  catch (e) { logZeile('Server-Info konnte nicht geschrieben werden: ' + e.message); }
  // Konto-Pflicht (Anti-Spoofing) hinterlegen — nur wenn die UI sie mitschickt; ein Neustart
  // (ohne info) behält den letzten Stand, überschreibt also die URL nie versehentlich mit leer.
  if (info && info.authUrl !== undefined) {
    letzteAuth = { url: String(info.authUrl || '').trim().slice(0, 300), required: info.authRequired !== false };
  }
  try { fs.writeFileSync(AUTH_DATEI, JSON.stringify(letzteAuth, null, 2)); }
  catch (e) { logZeile('Konto-Konfig konnte nicht geschrieben werden: ' + e.message); }
  if (letzteAuth.url) logZeile('🔐 Konto-Pflicht aktiv — Namen werden über ' + letzteAuth.url + ' bestätigt.');
  child = spawn(process.execPath, [SERVER_JS, '--welt', datei, '--port', String(gamePort),
    '--parent', String(process.pid), '--pvp', letztesPvp ? '1' : '0'], {
    cwd: __dirname, stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => logZeile(d.toString()));
  child.stderr.on('data', (d) => logZeile(d.toString()));
  child.on('exit', (code) => {
    letzterExit = { code, at: Date.now() };
    logZeile('Server beendet (Code ' + code + ').');
    child = null; aktuelleWelt = null;
  });
  child.on('error', (e) => { logZeile('Fehler beim Start: ' + e.message); });
  return { ok: true };
}

function stoppeServer(cb) {
  if (!serverLaeuft()) { if (cb) cb(); return; }
  const c = child;
  logZeile('Stoppe Server … (Welt wird gespeichert)');
  let fertig = false;
  const done = () => { if (!fertig) { fertig = true; if (cb) cb(); } };
  c.once('exit', done);
  try { c.stdin.write('stop\n'); } catch { /* egal */ }
  setTimeout(() => { if (c.exitCode === null && !c.killed) { try { c.kill(); } catch { /* egal */ } } }, 3000);
  setTimeout(done, 3600); // Notfall-Rückmeldung, falls kein exit kam
}

function neustart(cb) {
  const slug = aktuelleWelt && aktuelleWelt.slug;
  const pvp = letztesPvp; // gleiche PvP-Einstellung beibehalten
  stoppeServer(() => {
    if (slug) starteServer(slug, '', pvp);
    if (cb) cb();
  });
}

// Live-Status vom laufenden Spielserver abfragen (serverseitig, kein CORS)
async function holeStatus() {
  if (!serverLaeuft()) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 900);
    const r = await fetch('http://127.0.0.1:' + gamePort + '/status.json', { signal: ctrl.signal });
    clearTimeout(t);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

// Admin-Befehl (Kick/Bann/Entbannen) an den laufenden Spielserver weiterreichen
async function adminBefehl(pfad, daten) {
  if (!serverLaeuft()) return { ok: false, fehler: 'Der Server läuft nicht.' };
  try {
    const r = await fetch('http://127.0.0.1:' + gamePort + '/admin/' + pfad, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(daten),
    });
    return await r.json();
  } catch (e) { return { ok: false, fehler: 'Server nicht erreichbar: ' + e.message }; }
}

// Bann-Liste: vom laufenden Server (aktuellster Stand) oder direkt aus bans.json
async function holeBans() {
  if (serverLaeuft()) {
    try {
      const r = await fetch('http://127.0.0.1:' + gamePort + '/admin/bans');
      if (r.ok) return (await r.json()).bans || [];
    } catch { /* Fallback auf Datei */ }
  }
  try {
    if (fs.existsSync(BANS_DATEI)) {
      const d = JSON.parse(fs.readFileSync(BANS_DATEI, 'utf8'));
      if (Array.isArray(d)) return d;
    }
  } catch { /* leer */ }
  return [];
}

function entbanneInDatei(ip) {
  try {
    let d = [];
    if (fs.existsSync(BANS_DATEI)) d = JSON.parse(fs.readFileSync(BANS_DATEI, 'utf8'));
    if (!Array.isArray(d)) d = [];
    fs.writeFileSync(BANS_DATEI, JSON.stringify(d.filter((b) => b.ip !== ip), null, 2));
    return { ok: true };
  } catch (e) { return { ok: false, fehler: e.message }; }
}

// Moderatoren-Liste (vom laufenden Server oder aus mods.json)
async function holeMods() {
  if (serverLaeuft()) {
    try {
      const r = await fetch('http://127.0.0.1:' + gamePort + '/admin/mods');
      if (r.ok) return (await r.json()).mods || [];
    } catch { /* Fallback auf Datei */ }
  }
  try {
    if (fs.existsSync(MODS_DATEI)) {
      const d = JSON.parse(fs.readFileSync(MODS_DATEI, 'utf8'));
      if (Array.isArray(d)) return d;
    }
  } catch { /* leer */ }
  return [];
}

function entmodInDatei(ip) {
  try {
    let d = [];
    if (fs.existsSync(MODS_DATEI)) d = JSON.parse(fs.readFileSync(MODS_DATEI, 'utf8'));
    if (!Array.isArray(d)) d = [];
    fs.writeFileSync(MODS_DATEI, JSON.stringify(d.filter((m) => m.ip !== ip), null, 2));
    return { ok: true };
  } catch (e) { return { ok: false, fehler: e.message }; }
}

async function stateObj() {
  const status = await holeStatus();
  const laeuft = serverLaeuft();
  return {
    running: laeuft,
    booting: laeuft && !status, // Prozess lebt, aber Status noch nicht erreichbar
    gamePort,
    controlPort: CTRL_PORT,
    world: aktuelleWelt,
    pvp: !!(aktuelleWelt && aktuelleWelt.pvp),
    uptimeSec: laeuft ? Math.floor((Date.now() - startedAt) / 1000) : 0,
    letzterExit,
    status,
    auth: { url: letzteAuth.url, required: letzteAuth.required }, // Konto-Pflicht (fürs Vorbelegen)
    log: logBuf.slice(-80),
  };
}

// ---- HTTP: Steuerzentrale + API ----

function body(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

const server = http.createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0];
  const json = (obj, code = 200) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify(obj));
  };
  try {
    if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(PANEL_HTML); return;
    }
    if (req.method === 'GET' && url === '/api/state') { json(await stateObj()); return; }
    if (req.method === 'GET' && url === '/api/worlds') { json({ worlds: listWorlds() }); return; }
    if (req.method === 'POST' && url === '/api/start') {
      const b = await body(req); const r = starteServer(b.slug, b.port, b.pvp, { name: b.sName, motd: b.motd, icon: b.icon, authUrl: b.authUrl, authRequired: b.authRequired }); json(r, r.ok ? 200 : 400); return;
    }
    if (req.method === 'POST' && url === '/api/new') {
      const b = await body(req);
      if (b.port != null && b.port !== '' && !portOk(Number(b.port))) {
        json({ ok: false, fehler: 'Ungültiger Port (1024–65535, nicht ' + CTRL_PORT + ').' }, 400); return;
      }
      const slug = createWorld(b.name, b.seed);
      const r = starteServer(slug, b.port, b.pvp, { name: b.sName, motd: b.motd, icon: b.icon, authUrl: b.authUrl, authRequired: b.authRequired }); json({ ...r, slug }, r.ok ? 200 : 400); return;
    }
    if (req.method === 'POST' && url === '/api/stop') { stoppeServer(() => json({ ok: true })); return; }
    if (req.method === 'POST' && url === '/api/restart') { neustart(() => json({ ok: true })); return; }
    if (req.method === 'POST' && url === '/api/kick') {
      json(await adminBefehl('kick', { id: (await body(req)).id })); return;
    }
    if (req.method === 'POST' && url === '/api/ban') {
      json(await adminBefehl('ban', { id: (await body(req)).id })); return;
    }
    if (req.method === 'GET' && url === '/api/bans') { json({ bans: await holeBans() }); return; }
    if (req.method === 'POST' && url === '/api/unban') {
      const ip = String((await body(req)).ip || '');
      // Läuft der Server, pflegt ER Liste + Datei; sonst editieren wir die Datei direkt
      json(serverLaeuft() ? await adminBefehl('unban', { ip }) : entbanneInDatei(ip)); return;
    }
    if (req.method === 'GET' && url === '/api/mods') { json({ mods: await holeMods() }); return; }
    if (req.method === 'POST' && url === '/api/mod') { json(await adminBefehl('mod', { id: (await body(req)).id })); return; }
    if (req.method === 'POST' && url === '/api/unmodid') { json(await adminBefehl('unmodid', { id: (await body(req)).id })); return; }
    if (req.method === 'POST' && url === '/api/unmod') {
      const ip = String((await body(req)).ip || '');
      json(serverLaeuft() ? await adminBefehl('unmod', { ip }) : entmodInDatei(ip)); return;
    }
    if (req.method === 'POST' && url === '/api/delete') {
      const b = await body(req);
      if (serverLaeuft() && aktuelleWelt && aktuelleWelt.slug === b.slug) {
        json({ ok: false, fehler: 'Diese Welt läuft gerade — erst stoppen.' }, 400); return;
      }
      deleteWorld(b.slug); json({ ok: true }); return;
    }
    res.writeHead(404); res.end('404');
  } catch (e) {
    json({ ok: false, fehler: e.message }, 500);
  }
});

function browserOeffnen(url) {
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch { /* egal */ }
}

// Steuerzentrale in einem EIGENEN Fenster (Electron) statt im Browser öffnen.
// Ist Electron nicht installiert, fällt es sauber auf den Browser zurück.
function panelOeffnen(url) {
  try {
    const require = createRequire(import.meta.url);
    const electronPfad = require('electron'); // Pfad zur Electron-Binärdatei (im Node-Kontext)
    const script = path.join(__dirname, 'electron-panel.cjs');
    if (typeof electronPfad === 'string' && fs.existsSync(electronPfad) && fs.existsSync(script)) {
      // NICHT detached: ohne sichtbare Konsole ist das Steuerzentrale-Fenster der einzige
      // Schalter — wird es geschlossen, beenden wir Server + Launcher sauber.
      const fenster = spawn(electronPfad, [script, url], { stdio: 'ignore' });
      fenster.on('exit', () => beenden());
      fenster.on('error', () => browserOeffnen(url));
      return;
    }
  } catch { /* Electron fehlt → Browser */ }
  browserOeffnen(url);
}

ensureWorldsDir();
// Port evtl. noch von einer eben geschlossenen Steuerzentrale belegt → kurz
// erneut versuchen, bevor wir aufgeben (behebt „schnell wieder öffnen geht nicht").
let ctrlBindVersuche = 0;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && ctrlBindVersuche < 8) {
    ctrlBindVersuche++;
    console.warn('Steuerzentrale-Port ' + CTRL_PORT + ' noch belegt — Versuch ' + ctrlBindVersuche + '/8 …');
    setTimeout(() => server.listen(CTRL_PORT, '127.0.0.1'), 500);
    return;
  }
  if (e.code === 'EADDRINUSE') {
    console.error('Port ' + CTRL_PORT + ' ist belegt. Läuft die Steuerzentrale schon? ' +
      'Öffne http://localhost:' + CTRL_PORT + ' oder starte mit --port <anderer Port>.');
    process.exit(1);
  }
  throw e;
});
server.on('listening', () => {
  const url = 'http://localhost:' + CTRL_PORT;
  console.log('Fable MC — Steuerzentrale läuft:');
  console.log('  Öffne im Browser:  ' + url);
  console.log('  Spielserver-Port:  ' + gamePort + ' (im Panel änderbar)');
  console.log('  Welten-Ordner:     ' + WORLDS_DIR);
  if (AUTO_OPEN) panelOeffnen(url); // eigenes Fenster (Electron), sonst Browser
});
// Nur an localhost binden: Die Steuerzentrale (Stopp, Löschen, Kick/Bann)
// gehört dem Server-Betreiber — niemand aus dem Netz soll sie erreichen.
server.listen(CTRL_PORT, '127.0.0.1');

// Steuerzentrale beenden → auch den Spielserver sauber stoppen
function beenden() { stoppeServer(() => process.exit(0)); setTimeout(() => process.exit(0), 4000); }
process.on('SIGINT', beenden);
process.on('SIGTERM', beenden);

// ---- Oberfläche (Kontrollpanel) ----

const PANEL_HTML = `<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fable MC — Steuerzentrale</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Segoe UI', system-ui, sans-serif; background: #0e1426; color: #e8ecf5; padding: 22px; }
  .wrap { max-width: 860px; margin: 0 auto; }
  h1 { font-size: 25px; margin: 0 0 3px; display: flex; align-items: center; gap: 12px; }
  .pill { font-size: 12px; font-weight: 600; padding: 3px 11px; border-radius: 20px; text-transform: uppercase; letter-spacing: .5px; }
  .pill.on { background: #14432a; color: #6ee79c; border: 1px solid #2a7d4e; }
  .pill.off { background: #3a2020; color: #ff9a92; border: 1px solid #7d3a3a; }
  .pill.boot { background: #3a3410; color: #ffd24a; border: 1px solid #7d6a1a; }
  .sub { color: #8b97b5; margin: 0 0 20px; font-size: 13px; }
  .card { background: #18203a; border: 1px solid #2a3557; border-radius: 12px; padding: 18px 20px; margin-bottom: 16px; }
  .card h2 { font-size: 16px; margin: 0 0 14px; color: #cdd6ef; }
  label { display: block; font-size: 12px; color: #8b97b5; margin: 0 0 5px; text-transform: uppercase; letter-spacing: .4px; }
  input[type=text] { width: 100%; font-size: 15px; padding: 9px 12px; background: #0b1120; color: #e8ecf5; border: 1px solid #2f3d63; border-radius: 7px; margin-bottom: 14px; }
  input[type=text]:focus { outline: none; border-color: #4a72c8; }
  .row { display: flex; gap: 12px; flex-wrap: wrap; }
  .row > div { flex: 1; min-width: 140px; }
  button { font-size: 14px; font-weight: 600; padding: 9px 16px; border-radius: 7px; border: none; cursor: pointer; color: #fff; }
  .btn-go { background: #2f7d4e; } .btn-go:hover { background: #379059; }
  .btn-stop { background: #a3413b; } .btn-stop:hover { background: #b94b44; }
  .btn-neu { background: #3a5bb0; } .btn-neu:hover { background: #4468c6; }
  .btn-mini { background: #2a3557; padding: 6px 12px; font-size: 13px; } .btn-mini:hover { background: #35426a; }
  .btn-del { background: #4a2530; } .btn-del:hover { background: #6a3040; }
  button:disabled { opacity: .5; cursor: default; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 9px 10px; font-size: 14px; border-bottom: 1px solid #232d4b; }
  th { color: #8b97b5; font-size: 11px; text-transform: uppercase; letter-spacing: .4px; }
  tr:last-child td { border-bottom: none; }
  .wname { font-weight: 600; font-size: 15px; }
  .wmeta { color: #7e8bb0; font-size: 12px; }
  .leer { color: #6b769a; font-style: italic; padding: 10px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .stat { background: #0f1730; border: 1px solid #26324f; border-radius: 9px; padding: 11px 14px; }
  .stat .l { font-size: 11px; text-transform: uppercase; letter-spacing: .4px; color: #7e8bb0; margin-bottom: 5px; }
  .stat .v { font-size: 20px; font-weight: 600; }
  .stat .v small { font-size: 12px; color: #8b97b5; font-weight: 400; }
  .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
  .links a { color: #8ec8ff; text-decoration: none; margin-right: 16px; font-size: 14px; }
  .links a:hover { text-decoration: underline; }
  .log { background: #060a15; border: 1px solid #232d4b; border-radius: 8px; padding: 10px 12px; font-family: 'Consolas', monospace; font-size: 12px; line-height: 1.5; color: #b7c2e0; height: 220px; overflow-y: auto; white-space: pre-wrap; word-break: break-word; }
  .hint { background: #3a2020; border: 1px solid #7d3a3a; color: #ffb4ad; padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; font-size: 14px; display: none; }
  .badge { background: #3a2f10; color: #ffd24a; border: 1px solid #6b551a; border-radius: 4px; padding: 1px 7px; font-size: 11px; margin-left: 8px; }
  .tabs { display: flex; gap: 8px; margin-bottom: 18px; }
  .tab { background: #18203a; border: 1px solid #2a3557; color: #9aa6c9; padding: 8px 18px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600; }
  .tab.aktiv { background: #24304f; color: #fff; border-color: #4a72c8; }
  .ipmono { font-family: 'Consolas', monospace; font-size: 13px; }
  .portfeld { width: 110px !important; margin-bottom: 0 !important; }
  .pvpzeile { display: flex; align-items: center; gap: 8px; margin-top: 14px; font-size: 14px; color: #cdd6ef; text-transform: none; letter-spacing: 0; cursor: pointer; }
  .pvpzeile input { width: 17px; height: 17px; cursor: pointer; }
  .pvpzeile b { color: #ff9a92; }
</style></head>
<body><div class="wrap">
  <h1>Fable MC — Steuerzentrale <span class="pill off" id="pill">gestoppt</span></h1>
  <p class="sub" id="sub">Wähle eine Welt oder erstelle eine neue, um den Server zu starten.</p>

  <div class="tabs">
    <div class="tab aktiv" id="tabServer">Server</div>
    <div class="tab" id="tabMods">Mods</div>
    <div class="tab" id="tabBans">Bans</div>
  </div>

  <div class="hint" id="hint"></div>

  <div id="serverTab">
  <!-- Ansicht: Server gestoppt -->
  <div id="stoppedView">
    <div class="card">
      <h2>Server-Einstellungen</h2>
      <div class="row" style="align-items:center">
        <div style="flex:0"><label>Port</label><input type="text" id="portFeld" class="portfeld" maxlength="5" inputmode="numeric"></div>
        <div style="flex:1"><span class="wmeta">Auf diesem Port läuft der Spielserver — Mitspieler verbinden sich über ihn (Standard 8123, auch fürs Port-Forwarding).</span></div>
      </div>
      <label class="pvpzeile"><input type="checkbox" id="pvpFeld"> <b>PvP</b> — Spieler können einander Schaden zufügen</label>
      <div style="margin-top:16px">
        <label>Server-Name (in der Serverliste)</label>
        <input type="text" id="nameFeld" maxlength="32" placeholder="z. B. Mein Server">
        <label>MotD — kurze Beschreibung</label>
        <input type="text" id="motdFeld" maxlength="80" placeholder="Willkommen auf dem Server!">
        <label>Server-Bild</label>
        <div class="row" style="align-items:center;gap:12px;margin-bottom:0">
          <img id="iconVorschau" alt="" style="display:none;width:52px;height:52px;border-radius:9px;object-fit:cover;border:1px solid #2f3d63">
          <input type="file" id="iconFeld" accept="image/*" style="flex:1;color:#8b97b5">
          <button type="button" class="btn-mini" id="iconWeg" style="display:none">✕</button>
        </div>
        <label class="pvpzeile" style="margin-top:16px"><input type="checkbox" id="authFeld"> <b>🔐 Konto-Pflicht</b> — nur angemeldete Spieler; der Server bestätigt jeden Namen (Anti-Spoofing)</label>
        <div id="authUrlWrap" style="display:none">
          <label>Konto-Server-URL (dein Backend — bleibt lokal in server-auth.json)</label>
          <input type="text" id="authUrlFeld" maxlength="200" placeholder="http://deinhost.de">
        </div>
      </div>
    </div>
    <div class="card">
      <h2>Neue Welt erstellen</h2>
      <div class="row">
        <div><label>Name</label><input type="text" id="neuName" maxlength="40" placeholder="z. B. Abenteuer"></div>
        <div><label>Seed (leer = zufällig)</label><input type="text" id="neuSeed" maxlength="40" placeholder="Zahl oder Wort"></div>
      </div>
      <button class="btn-neu" id="btnNeu">Erstellen &amp; Starten ▶</button>
    </div>
    <div class="card">
      <h2>Gespeicherte Welten</h2>
      <table><tbody id="weltRows"></tbody></table>
    </div>
  </div>

  <!-- Ansicht: Server läuft -->
  <div id="runningView" style="display:none">
    <div class="card">
      <h2 id="runTitle">Welt läuft</h2>
      <div class="grid" id="runStats"></div>
      <div class="actions">
        <button class="btn-stop" id="btnStop">■ Stoppen</button>
        <button class="btn-mini" id="btnRestart">⟳ Neustart</button>
      </div>
      <div class="links" id="runLinks"></div>
    </div>
    <div class="card">
      <h2>Spieler online (<span id="pcount">0</span>)</h2>
      <table><thead><tr><th>Name</th><th>Position (X / Y / Z)</th><th></th></tr></thead><tbody id="playerRows"></tbody></table>
    </div>
    <div class="card">
      <h2>Server-Protokoll</h2>
      <div class="log" id="log"></div>
    </div>
  </div>
  </div><!-- /serverTab -->

  <!-- Tab: Moderatoren verwalten -->
  <div id="modsTab" style="display:none">
    <div class="card">
      <h2>Moderatoren</h2>
      <p class="wmeta" style="margin-top:-6px">Moderatoren dürfen im Chat Befehle nutzen (/help). Mach unten einen Online-Spieler zum Mod (gilt per IP). Der Betreiber (localhost) ist immer Mod.</p>
      <h2 style="font-size:14px;margin-top:6px">Online-Spieler</h2>
      <table><tbody id="modOnlineRows"></tbody></table>
      <h2 style="font-size:14px;margin-top:18px">Gespeicherte Moderatoren</h2>
      <table><thead><tr><th>IP-Adresse</th><th>Namen</th><th>Seit</th><th></th></tr></thead>
      <tbody id="modRows"></tbody></table>
    </div>
  </div>

  <!-- Tab: Bans verwalten -->
  <div id="bansTab" style="display:none">
    <div class="card">
      <h2>Gebannte Spieler</h2>
      <p class="wmeta" style="margin-top:-6px">Bans gelten pro IP-Adresse. Hier stehen alle Namen, die von dieser IP aus benutzt wurden.</p>
      <table><thead><tr><th>IP-Adresse</th><th>Benutzte Namen</th><th>Gebannt seit</th><th></th></tr></thead>
      <tbody id="banRows"></tbody></table>
    </div>
  </div>
</div>
<script>
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/[<>&"]/g, function (c) { return ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;' })[c]; }); }
  function relZeit(ms) {
    var d = Date.now() - ms;
    if (d < 60000) return 'gerade eben';
    if (d < 3600000) return 'vor ' + Math.floor(d / 60000) + ' Min';
    if (d < 86400000) return 'vor ' + Math.floor(d / 3600000) + ' Std';
    return new Date(ms).toLocaleDateString('de-DE');
  }
  function dauer(sek) {
    var h = Math.floor(sek / 3600), m = Math.floor(sek % 3600 / 60), s = sek % 60;
    return (h ? h + 'h ' : '') + (m || h ? m + 'm ' : '') + s + 's';
  }
  function api(pfad, daten) {
    return fetch(pfad, daten ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(daten) } : {})
      .then(function (r) { return r.json().catch(function () { return {}; }); });
  }

  var busy = false;
  function zeigeHint(text) {
    var h = $('hint');
    if (text) { h.textContent = '⚠ ' + text; h.style.display = 'block'; }
    else { h.style.display = 'none'; }
  }

  // Gewählter Spielserver-Port + PvP (merkt sich die letzte Wahl im Browser)
  function gewaehlterPort() { return $('portFeld').value.trim(); }
  function gewaehltesPvp() { return $('pvpFeld').checked; }
  try { $('portFeld').value = localStorage.getItem('fablemc.gameport') || '8123'; } catch (e) { $('portFeld').value = '8123'; }
  try { $('pvpFeld').checked = localStorage.getItem('fablemc.pvp') === '1'; } catch (e) {}
  $('portFeld').addEventListener('change', function () {
    try { localStorage.setItem('fablemc.gameport', $('portFeld').value.trim()); } catch (e) {}
  });
  $('pvpFeld').addEventListener('change', function () {
    try { localStorage.setItem('fablemc.pvp', $('pvpFeld').checked ? '1' : '0'); } catch (e) {}
  });

  // Server-Identität: Name, MotD, Bild (merkt sich die letzte Wahl im Browser)
  var serverIcon = '';
  function gewaehlterName() { return $('nameFeld').value.trim(); }
  function gewaehlteMotd() { return $('motdFeld').value.trim(); }
  try {
    $('nameFeld').value = localStorage.getItem('fablemc.srvname') || '';
    $('motdFeld').value = localStorage.getItem('fablemc.srvmotd') || '';
    serverIcon = localStorage.getItem('fablemc.srvicon') || '';
  } catch (e) {}
  function zeigeIcon() {
    var img = $('iconVorschau'), weg = $('iconWeg');
    if (serverIcon) { img.src = serverIcon; img.style.display = 'block'; weg.style.display = 'inline-block'; }
    else { img.style.display = 'none'; weg.style.display = 'none'; }
  }
  zeigeIcon();
  $('nameFeld').addEventListener('change', function () { try { localStorage.setItem('fablemc.srvname', gewaehlterName()); } catch (e) {} });
  $('motdFeld').addEventListener('change', function () { try { localStorage.setItem('fablemc.srvmotd', gewaehlteMotd()); } catch (e) {} });
  $('iconFeld').addEventListener('change', function () {
    var f = this.files && this.files[0]; if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      var im = new Image();
      im.onload = function () { // auf 64×64 herunterrechnen → klein für Speicher & Netzwerk
        var c = document.createElement('canvas'); c.width = 64; c.height = 64;
        c.getContext('2d').drawImage(im, 0, 0, 64, 64);
        serverIcon = c.toDataURL('image/png');
        try { localStorage.setItem('fablemc.srvicon', serverIcon); } catch (e) { zeigeHint('Bild zu groß zum Speichern.'); }
        zeigeIcon();
      };
      im.src = reader.result;
    };
    reader.readAsDataURL(f);
  });
  $('iconWeg').addEventListener('click', function () {
    serverIcon = ''; $('iconFeld').value = '';
    try { localStorage.removeItem('fablemc.srvicon'); } catch (e) {}
    zeigeIcon();
  });
  // Konto-Pflicht (Anti-Spoofing): Checkbox + URL, vorbelegt aus server-auth.json (über /api/state)
  var authPrefilled = false;
  function zeigeAuthUrl() { $('authUrlWrap').style.display = $('authFeld').checked ? 'block' : 'none'; }
  $('authFeld').addEventListener('change', zeigeAuthUrl);
  function prefillAuth(a) {
    if (authPrefilled) return; authPrefilled = true;
    if (a && a.url) { $('authFeld').checked = true; $('authUrlFeld').value = a.url; }
    zeigeAuthUrl();
  }
  function authOk() {
    if ($('authFeld').checked && !$('authUrlFeld').value.trim()) {
      zeigeHint('Bitte die Konto-Server-URL eintragen (oder Konto-Pflicht abwählen).'); return false;
    }
    return true;
  }
  function serverIdentitaet() {
    return {
      sName: gewaehlterName(), motd: gewaehlteMotd(), icon: serverIcon,
      authUrl: $('authFeld').checked ? $('authUrlFeld').value.trim() : '', authRequired: true,
    };
  }

  function starteWelt(slug) {
    if (busy) return;
    if (!authOk()) return;
    busy = true;
    api('/api/start', Object.assign({ slug: slug, port: gewaehlterPort(), pvp: gewaehltesPvp() }, serverIdentitaet())).then(function (r) {
      busy = false;
      if (!r.ok) zeigeHint(r.fehler || 'Start fehlgeschlagen');
      else { zeigeHint(''); tick(); }
    });
  }
  function neueWelt() {
    if (busy) return;
    var name = $('neuName').value.trim();
    if (!name) { zeigeHint('Bitte einen Namen für die Welt eingeben.'); return; }
    if (!authOk()) return;
    busy = true;
    api('/api/new', Object.assign({ name: name, seed: $('neuSeed').value, port: gewaehlterPort(), pvp: gewaehltesPvp() }, serverIdentitaet())).then(function (r) {
      busy = false;
      if (!r.ok) zeigeHint(r.fehler || 'Konnte Welt nicht erstellen');
      else { $('neuName').value = ''; $('neuSeed').value = ''; zeigeHint(''); tick(); }
    });
  }

  // ---- Kick / Bann ----
  var SPIELER = {}; // id → Name (für Bestätigungs-Dialoge)
  function kicke(id) {
    if (busy) return;
    if (!confirm('Spieler „' + (SPIELER[id] || '#' + id) + '" vom Server werfen?')) return;
    api('/api/kick', { id: id }).then(function (r) { if (!r.ok) zeigeHint(r.fehler || 'Kick fehlgeschlagen'); else tick(); });
  }
  function banne(id) {
    if (busy) return;
    if (!confirm('Spieler „' + (SPIELER[id] || '#' + id) + '" dauerhaft BANNEN (per IP)?\\nEntbannen geht über den Bans-Tab.')) return;
    api('/api/ban', { id: id }).then(function (r) { if (!r.ok) zeigeHint(r.fehler || 'Bann fehlgeschlagen'); else tick(); });
  }
  function entbanne(ip) {
    api('/api/unban', { ip: ip }).then(function (r) {
      if (!r.ok) zeigeHint(r.fehler || 'Entbannen fehlgeschlagen');
      else ladeBans();
    });
  }

  // ---- Bans-Tab ----
  function ladeBans() {
    api('/api/bans').then(function (d) {
      var liste = d.bans || [];
      $('banRows').innerHTML = liste.length
        ? liste.map(function (b) {
            return '<tr><td class="ipmono">' + esc(b.ip) + '</td>' +
              '<td>' + esc((b.names || []).join(', ') || '—') + '</td>' +
              '<td>' + new Date(b.seit).toLocaleString('de-DE') + '</td>' +
              '<td style="text-align:right"><button class="btn-mini" onclick="entbanne(\\'' + esc(b.ip) + '\\')">Entbannen</button></td></tr>';
          }).join('')
        : '<tr><td colspan="4" class="leer">Niemand ist gebannt.</td></tr>';
    });
  }
  // ---- Mods-Tab ----
  function ladeMods() {
    // Online-Spieler mit Mod-Buttons
    api('/api/state').then(function (st) {
      var sp = (st.status && st.status.spieler) || [];
      $('modOnlineRows').innerHTML = sp.length
        ? sp.map(function (p) {
            return '<tr><td>' + esc(p.name) + (p.mod ? '<span class="badge">MOD</span>' : '') + '</td>' +
              '<td style="text-align:right">' + (p.mod
                ? '<button class="btn-del" onclick="entmodSpieler(' + p.id + ')">Mod entfernen</button>'
                : '<button class="btn-go" onclick="macheMod(' + p.id + ')">★ Zum Mod</button>') + '</td></tr>';
          }).join('')
        : '<tr><td colspan="2" class="leer">Niemand online</td></tr>';
    });
    // Gespeicherte Moderatoren (per IP)
    api('/api/mods').then(function (d) {
      var liste = d.mods || [];
      $('modRows').innerHTML = liste.length
        ? liste.map(function (m) {
            return '<tr><td class="ipmono">' + esc(m.ip) + '</td>' +
              '<td>' + esc((m.names || []).join(', ') || '—') + '</td>' +
              '<td>' + new Date(m.seit).toLocaleDateString('de-DE') + '</td>' +
              '<td style="text-align:right"><button class="btn-mini" onclick="entmodIp(\\'' + esc(m.ip) + '\\')">Entfernen</button></td></tr>';
          }).join('')
        : '<tr><td colspan="4" class="leer">Keine gespeicherten Moderatoren (localhost ist immer Mod).</td></tr>';
    });
  }
  function macheMod(id) {
    api('/api/mod', { id: id }).then(function (r) { if (!r.ok) zeigeHint(r.fehler || 'Fehlgeschlagen'); else ladeMods(); });
  }
  function entmodSpieler(id) {
    api('/api/unmodid', { id: id }).then(function (r) { if (!r.ok) zeigeHint(r.fehler || 'Fehlgeschlagen'); else ladeMods(); });
  }
  function entmodIp(ip) {
    api('/api/unmod', { ip: ip }).then(function (r) { if (!r.ok) zeigeHint(r.fehler || 'Fehlgeschlagen'); else ladeMods(); });
  }

  var aktiverTab = 'server';
  function zeigeTab(name) {
    aktiverTab = name;
    $('serverTab').style.display = name === 'server' ? 'block' : 'none';
    $('modsTab').style.display = name === 'mods' ? 'block' : 'none';
    $('bansTab').style.display = name === 'bans' ? 'block' : 'none';
    $('tabServer').className = 'tab' + (name === 'server' ? ' aktiv' : '');
    $('tabMods').className = 'tab' + (name === 'mods' ? ' aktiv' : '');
    $('tabBans').className = 'tab' + (name === 'bans' ? ' aktiv' : '');
    if (name === 'bans') ladeBans();
    if (name === 'mods') ladeMods();
  }
  $('tabServer').addEventListener('click', function () { zeigeTab('server'); });
  $('tabMods').addEventListener('click', function () { zeigeTab('mods'); });
  $('tabBans').addEventListener('click', function () { zeigeTab('bans'); });
  function stoppeWelt() {
    if (busy) return; busy = true;
    $('btnStop').disabled = true; $('btnStop').textContent = '■ Stoppe …';
    api('/api/stop', {}).then(function () { busy = false; tick(); });
  }
  function neustartWelt() {
    if (busy) return; busy = true;
    $('btnRestart').disabled = true; $('btnRestart').textContent = '⟳ Neustart …';
    api('/api/restart', {}).then(function () { busy = false; tick(); });
  }
  var WELTEN = {}; // slug → Name (für Löschbestätigung ohne Escaping-Ärger)
  function loescheWelt(slug) {
    if (busy) return;
    var name = WELTEN[slug] || slug;
    if (!confirm('Welt „' + name + '" wirklich unwiderruflich löschen?')) return;
    busy = true;
    api('/api/delete', { slug: slug }).then(function (r) {
      busy = false;
      if (!r.ok) zeigeHint(r.fehler || 'Löschen fehlgeschlagen');
      else tick();
    });
  }

  function renderWelten(worlds) {
    var tb = $('weltRows');
    WELTEN = {};
    worlds.forEach(function (w) { WELTEN[w.slug] = w.name; });
    if (!worlds.length) { tb.innerHTML = '<tr><td class="leer">Noch keine Welten — erstelle oben eine neue.</td></tr>'; return; }
    // Slugs bestehen nur aus [a-z0-9-] und sind daher sicher in onclick einbettbar
    tb.innerHTML = worlds.map(function (w) {
      return '<tr><td>' +
        '<div class="wname">' + esc(w.name) + '</div>' +
        '<div class="wmeta">Seed ' + w.seed + ' · zuletzt ' + relZeit(w.lastPlayed) + ' · ' + w.edits + ' Chunks · ' + w.sizeKB + ' KB</div>' +
        '</td><td style="text-align:right;white-space:nowrap">' +
        '<button class="btn-go" onclick="starteWelt(\\'' + w.slug + '\\')">▶ Starten</button> ' +
        '<button class="btn-del" onclick="loescheWelt(\\'' + w.slug + '\\')">🗑</button>' +
        '</td></tr>';
    }).join('');
  }

  function renderRunning(st) {
    var s = st.status || {};
    $('runTitle').textContent = 'Welt: ' + ((st.world && st.world.name) || s.weltName || '—');
    var karten = [
      ['Status', st.booting ? 'Startet …' : 'Läuft'],
      ['Seed', (st.world && st.world.seed) != null ? st.world.seed : (s.seed != null ? s.seed : '—')],
      ['Port', st.gamePort],
      ['Laufzeit', dauer(st.uptimeSec)],
      ['Spielzeit', s.uhrzeit ? (s.uhrzeit + ' <small>Tag ' + s.tag + '</small>') : '—'],
      ['Spieler', (s.spielerAnzahl != null ? s.spielerAnzahl : 0)],
      ['PvP', st.pvp ? '<span style="color:#ff9a92">AN</span>' : 'aus'],
    ];
    $('runStats').innerHTML = karten.map(function (k) {
      return '<div class="stat"><div class="l">' + k[0] + '</div><div class="v">' + k[1] + '</div></div>';
    }).join('');
    $('runLinks').innerHTML =
      '<a href="http://localhost:' + st.gamePort + '" target="_blank">🎮 Spiel öffnen</a>' +
      '<a href="http://localhost:' + st.gamePort + '/status" target="_blank">📊 Status-Seite</a>';
    var sp = (s.spieler || []);
    SPIELER = {};
    sp.forEach(function (p) { SPIELER[p.id] = p.name; });
    $('pcount').textContent = s.spielerAnzahl != null ? s.spielerAnzahl : 0;
    $('playerRows').innerHTML = sp.length
      ? sp.map(function (p) {
          return '<tr><td>' + esc(p.name) + (p.host ? '<span class="badge">HOST</span>' : '') +
            '</td><td>' + p.x + ' / ' + p.y + ' / ' + p.z + '</td>' +
            '<td style="text-align:right;white-space:nowrap">' +
            '<button class="btn-mini" onclick="kicke(' + p.id + ')">Kick</button> ' +
            '<button class="btn-del" onclick="banne(' + p.id + ')">Bann</button></td></tr>';
        }).join('')
      : '<tr><td colspan="3" class="leer">Noch niemand verbunden</td></tr>';
    var log = $('log');
    var untenGewesen = log.scrollTop + log.clientHeight >= log.scrollHeight - 12;
    log.textContent = (st.log || []).join('\\n');
    if (untenGewesen) log.scrollTop = log.scrollHeight;
    $('btnStop').disabled = false; $('btnStop').textContent = '■ Stoppen';
    $('btnRestart').disabled = false; $('btnRestart').textContent = '⟳ Neustart';
  }

  function tick() {
    api('/api/state').then(function (st) {
      prefillAuth(st.auth); // Konto-Pflicht einmalig aus server-auth.json vorbelegen
      var pill = $('pill');
      if (st.running) {
        pill.className = 'pill ' + (st.booting ? 'boot' : 'on');
        pill.textContent = st.booting ? 'startet' : 'läuft';
        $('sub').textContent = 'Der Server läuft. Mitspieler verbinden sich unter http://localhost:' + st.gamePort;
        $('stoppedView').style.display = 'none';
        $('runningView').style.display = 'block';
        renderRunning(st);
      } else {
        pill.className = 'pill off'; pill.textContent = 'gestoppt';
        $('sub').textContent = 'Wähle eine Welt oder erstelle eine neue, um den Server zu starten.';
        $('runningView').style.display = 'none';
        $('stoppedView').style.display = 'block';
        if (st.letzterExit && st.letzterExit.code) {
          zeigeHint('Der Server wurde beendet (Code ' + st.letzterExit.code + '). Ist der Port ' + st.gamePort + ' evtl. belegt? Details im Protokoll nach dem nächsten Start.');
        }
        api('/api/worlds').then(function (w) { renderWelten(w.worlds || []); });
      }
      if (aktiverTab === 'bans') ladeBans(); // Liste im aktiven Tab live halten
      else if (aktiverTab === 'mods') ladeMods();
    }).catch(function () {
      $('pill').className = 'pill off'; $('pill').textContent = 'keine Verbindung';
      $('sub').textContent = 'Steuerzentrale nicht erreichbar — läuft launcher.js noch?';
    });
  }

  $('btnNeu').addEventListener('click', neueWelt);
  $('btnStop').addEventListener('click', stoppeWelt);
  $('btnRestart').addEventListener('click', neustartWelt);
  $('neuName').addEventListener('keydown', function (e) { if (e.key === 'Enter') neueWelt(); });
  $('neuSeed').addEventListener('keydown', function (e) { if (e.key === 'Enter') neueWelt(); });
  tick();
  setInterval(tick, 1500);
</script></body></html>`;
