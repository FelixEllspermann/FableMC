// Konto-System (Client): Registrierung, Login und lokale Sitzung. Spricht das
// PHP-Backend an (siehe authconfig.js) und merkt sich Token + Name in localStorage.

import { AUTH_URL } from './authconfig.js';

const KEY = 'fablemc.account.v1';
const DAUER = 60 * 24 * 3600; // Sitzungsdauer in Sekunden (60 Tage — passt zum Token)

export function getSession() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
function saveSession(username, token) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ username, token, exp: Math.floor(Date.now() / 1000) + DAUER }));
  } catch { /* Speicher voll — egal */ }
}
export function logout() { try { localStorage.removeItem(KEY); } catch { /* egal */ } }

// Gültige (nicht abgelaufene) lokale Sitzung vorhanden?
export function hasValidSession() {
  const s = getSession();
  return !!(s && s.token && s.username && (!s.exp || s.exp * 1000 > Date.now()));
}
export function currentUser() { return getSession()?.username || null; }
export function isConfigured() { return !!AUTH_URL; }

async function post(endpoint, data) {
  if (!AUTH_URL) throw new Error('Kein Account-Server eingetragen (js/authconfig.js)');
  let r;
  try {
    r = await fetch(AUTH_URL.replace(/\/$/, '') + '/' + endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
  } catch {
    throw new Error('Account-Server nicht erreichbar');
  }
  let j;
  try { j = await r.json(); } catch { throw new Error('Ungültige Antwort vom Server'); }
  if (!r.ok || !j.ok) throw new Error(j.error || ('Fehler ' + r.status));
  return j;
}

export async function register(username, password) {
  const j = await post('register.php', { username, password });
  saveSession(j.username, j.token);
  return j;
}

export async function login(username, password) {
  const j = await post('login.php', { username, password });
  saveSession(j.username, j.token);
  return j;
}
