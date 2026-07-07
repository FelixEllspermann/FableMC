// UI: title screen, pause menu, crosshair, mining progress, debug overlay, toasts.

import { SaveManager } from './save.js';
import { biomeAt, columnInfo } from './worldgen.js';
import { Settings } from './settings.js';
import { t, getLang, setLang, onLangChange, randomSplash, LANG_NAMES } from './lang.js';
import { Keybinds, KEYBIND_ACTIONS, keyLabel } from './keybinds.js';
import { register, login, currentUser, logout, isConfigured } from './auth.js';
import { Rules } from '../config.js';
import {
  VOXEL_DETAIL_CAP, CHUNK_SIZE, BLOCKS, ITEMS, isBlockId, nameOf,
  yawToCardinal,
} from './constants.js';
import { isEquipment, maxDurability, durabilityLeft } from './equip.js';
import { BIOME_NAMES_EN } from './names_en.js';
import { getIconDataURL } from './textures.js';

// Anzeigenamen der Mobs fürs Fadenkreuz-Fenster
const MOB_NAMES = {
  pig: 'Schwein', cow: 'Kuh', sheep: 'Schaf', chicken: 'Huhn', fish: 'Fisch',
  zombie: 'Zombie', skeleton: 'Skelett', creeper: 'Creeper',
  crimson_zombie: 'Blutroter Zombie', slime: 'Schleim', villager: 'Dorfbewohner',
};

export const BIOME_NAMES = {
  ozean: 'Ozean', see: 'See', strand: 'Strand', ebene: 'Ebene', wald: 'Wald',
  birkenwald: 'Birkenwald', old_birch: 'Alter Birkenwald', tannenwald: 'Tannenwald',
  spruce_valley: 'Fichtental', blumenwiese: 'Blumenwiese',
  sumpf: 'Sumpf', wueste: 'Wüste', savanne: 'Savanne', badlands: 'Badlands',
  dschungel: 'Dschungel',
  schneelandschaft: 'Schneelandschaft', schneewald: 'Schneewald', pilzinsel: 'Pilzinsel',
  gebirgsfuss: 'Gebirgsfuß', haenge: 'Mittlere Hänge', hochgebirge: 'Hochgebirge', gipfel: 'Gipfel',
};

// Biom-Name in der aktiven Sprache (Englisch aus names_en.js, sonst Deutsch).
export function biomeName(key) {
  if (getLang() === 'en' && BIOME_NAMES_EN[key]) return BIOME_NAMES_EN[key];
  return BIOME_NAMES[key] ?? key;
}

const STYLE = `
.ui-crosshair {
  position: fixed; left: 50%; top: 50%; width: 20px; height: 20px;
  transform: translate(-50%, -50%); z-index: 15; pointer-events: none;
  mix-blend-mode: difference;
}
.ui-crosshair::before, .ui-crosshair::after {
  content: ''; position: absolute; background: #fff;
}
.ui-crosshair::before { left: 9px; top: 0; width: 2px; height: 20px; }
.ui-crosshair::after { left: 0; top: 9px; width: 20px; height: 2px; }
.ui-ring {
  position: fixed; left: 50%; top: 50%; width: 40px; height: 40px;
  transform: translate(-50%, -50%); z-index: 15; pointer-events: none;
  border-radius: 50%; display: none; opacity: 0.85;
}
.ui-debug {
  position: fixed; left: 8px; top: 8px; right: 8px; z-index: 25; display: none;
  justify-content: space-between; align-items: flex-start; gap: 12px;
  pointer-events: none; font-size: 12.5px; line-height: 1.4;
}
.ui-debug > div {
  background: rgba(0,0,0,0.55); color: #fff;
  padding: 8px 10px; white-space: pre; max-width: 48vw; overflow: hidden;
}
.ui-debug .dbg-r { text-align: left; }
.ui-debug b { color: #ffd24a; font-weight: bold; }
.ui-toast {
  position: fixed; top: 18%; left: 50%; transform: translateX(-50%);
  z-index: 70; background: rgba(0,0,0,0.7); color: #fff; padding: 8px 18px;
  font-size: 16px; border-radius: 4px; opacity: 0; transition: opacity 0.3s;
  pointer-events: none;
}
.ui-toast.show { opacity: 1; }
.ui-lookat {
  position: fixed; top: 10px; left: 50%; transform: translateX(-50%);
  z-index: 59; display: none; align-items: center; gap: 8px; pointer-events: none;
  background: rgba(0,0,0,0.55); padding: 4px 12px 4px 5px; border: 1px solid rgba(255,255,255,0.15); border-radius: 4px;
}
.ui-lookat.show { display: flex; }
.ui-lookat img { width: 30px; height: 30px; image-rendering: pixelated; }
.ui-lookat span { color: #fff; font-size: 15px; text-shadow: 1px 1px 0 #000; white-space: nowrap; }
.ui-bossbar {
  position: fixed; top: 50px; left: 50%; transform: translateX(-50%);
  z-index: 60; width: min(560px, 74vw); display: none; pointer-events: none; text-align: center;
}
.ui-bossbar.show { display: block; }
.ui-bossbar-name {
  color: #ff6a5a; font-size: 17px; letter-spacing: 1px; margin-bottom: 3px;
  text-shadow: 2px 2px 0 #000, 0 0 8px #b01010;
}
.ui-bossbar-track {
  height: 13px; background: rgba(20,4,6,0.85); border: 2px solid #3a0d0e; box-shadow: 0 0 6px rgba(0,0,0,0.6);
}
.ui-bossbar-fill { height: 100%; width: 100%; background: linear-gradient(#ff4d3a, #b01010); transition: width 0.18s linear; }
.ui-overlay {
  position: fixed; inset: 0; z-index: 55; display: none;
  align-items: center; justify-content: center; flex-direction: column;
}
.ui-overlay.open { display: flex; }
.ui-pause { background: rgba(0, 0, 0, 0.6); }
.ui-title {
  /* halbtransparent, damit die langsam rotierende Welt dahinter durchscheint */
  background: linear-gradient(rgba(28, 40, 78, 0.5), rgba(12, 16, 30, 0.78));
}
.ui-panel { display: flex; flex-direction: column; gap: 12px; align-items: center; }
.ui-screen { display: flex; flex-direction: column; gap: 12px; align-items: center; }
.ui-h1 {
  font-size: 62px; color: #fff; letter-spacing: 4px; margin-bottom: 6px;
  text-shadow: 4px 4px 0 #26418c, 6px 6px 0 rgba(0,0,0,0.5);
}
.ui-sub { color: #ffe25e; font-size: 15px; margin-bottom: 20px; text-shadow: 2px 2px 0 #3f3f00; }
.ui-splash {
  display: inline-block; font-weight: bold; font-size: 17px;
  transform: rotate(-6deg); transform-origin: center;
  animation: ui-splash-pulse 0.95s ease-in-out infinite;
}
@keyframes ui-splash-pulse {
  0%, 100% { transform: rotate(-6deg) scale(1); }
  50% { transform: rotate(-6deg) scale(1.07); }
}
.ui-account-tabs { display: flex; gap: 6px; margin-bottom: 4px; }
.ui-account-tabs .ui-btn { width: 155px; font-size: 16px; }
.ui-account-tabs .ui-btn.sel { background: #5a7a4a; border-color: #8fd070 #2f3f22 #2f3f22 #8fd070; }
.ui-account-err { color: #ff8a7a; font-size: 13px; min-height: 18px; max-width: 320px; text-align: center; }
.ui-account-hint { color: #9aa4c4; font-size: 12.5px; max-width: 330px; text-align: center; line-height: 1.5; }
.ui-user-bar { color: #cfe0ff; font-size: 13px; margin-top: 8px; text-shadow: 1px 1px 0 #1a2036; }
.ui-user-bar b { color: #fff; }
.ui-user-logout { margin-left: 6px; color: #ffb3a8; cursor: pointer; text-decoration: underline; }
.ui-mp-asuser { color: #cfe0ff; font-size: 13px; margin: 2px 0 6px; text-shadow: 1px 1px 0 #1a2036; }
.ui-mp-asuser b { color: #fff; }
.ui-btn {
  font-size: 19px; padding: 10px 0; width: 320px; text-align: center;
  background: #6d6d6d; color: #fff; text-shadow: 2px 2px 0 #3f3f3f;
  border: 2px solid; border-color: #a8a8a8 #2f2f2f #2f2f2f #a8a8a8;
}
.ui-btn:hover:not(:disabled) { background: #7f7f9d; }
.ui-btn:disabled { opacity: 0.45; cursor: default; }
.ui-btn.danger:hover { background: #9d5f5f; }
.ui-btn.ui-btn-quit { margin-top: 14px; background: #5f5f5f; }
.ui-btn.ui-btn-quit:hover:not(:disabled) { background: #9d5f5f; }
.ui-seed {
  font-size: 17px; padding: 9px 12px; width: 296px; background: #000; color: #e0e0e0;
  border: 2px solid #a8a8a8; outline: none;
}
.ui-pause h1 { font-size: 40px; color: #fff; margin-bottom: 18px; text-shadow: 3px 3px 0 #222; }
.ui-loading {
  position: fixed; inset: 0; z-index: 58; display: none; align-items: center;
  justify-content: center; background: #141a2e; color: #fff; font-size: 22px;
}
.ui-loading.open { display: flex; }
.ui-settings { z-index: 66; background: rgba(0, 0, 0, 0.72); }
.ui-settings .ui-panel {
  position: relative; background: #2a2f45; padding: 20px 34px; border: 2px solid #555d80;
  border-radius: 4px; max-height: 90vh; overflow-y: auto; gap: 9px;
}
.ui-set-close {
  position: sticky; top: 0; align-self: flex-end; margin-right: -18px; width: 30px; height: 30px;
  font-size: 17px; line-height: 1; padding: 0; background: #3a4060; color: #cfd6f0;
  border: 1px solid #555d80; z-index: 2;
}
.ui-set-close:hover { background: #9d5f5f; color: #fff; }
.ui-settings h1 { font-size: 30px; color: #fff; margin: -14px 0 2px; text-shadow: 2px 2px 0 #14172a; }
.ui-set-label { color: #fff; font-size: 17px; }
.ui-set-slider { width: 320px; accent-color: #79c05a; cursor: pointer; }
.ui-set-hint { color: #9aa4c4; font-size: 12.5px; max-width: 340px; text-align: center; line-height: 1.5; }
.ui-set-section {
  color: #9fb0ff; font-size: 13px; letter-spacing: 2px; text-transform: uppercase;
  margin-top: 12px; padding-bottom: 3px; border-bottom: 1px solid #454d70; width: 344px; text-align: center;
}
.ui-list { width: 344px; max-height: 208px; overflow-y: auto; display: flex; flex-direction: column; gap: 5px; }
.ui-list-empty { color: #9aa4c4; font-size: 13px; text-align: center; padding: 8px; }
.ui-list-row {
  display: flex; align-items: center; gap: 8px; background: #3a4060; border: 1px solid #555d80; padding: 5px 8px;
}
.ui-list-info { flex: 1; display: flex; flex-direction: column; overflow: hidden; text-align: left; }
.ui-list-info b { color: #fff; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ui-list-info span { color: #9aa4c4; font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ui-list-go {
  font-size: 13px; padding: 5px 12px; background: #5a7a4a; color: #fff;
  border: 2px solid; border-color: #8fd070 #2f3f22 #2f3f22 #8fd070;
}
.ui-list-go:hover { background: #6a8a58; }
.ui-list-del { font-size: 13px; padding: 4px 8px; background: #6d3f3f; color: #fff; border: 1px solid #8a5a5a; line-height: 1; }
.ui-list-del:hover { background: #9d5f5f; }
.ui-srv-icon { width: 28px; height: 28px; border-radius: 5px; object-fit: cover; flex: 0 0 auto; border: 1px solid #555d80; }
.ui-status-dot { width: 11px; height: 11px; border-radius: 50%; flex: 0 0 auto; background: #888; }
.ui-status-dot.online { background: #4fd141; box-shadow: 0 0 5px #4fd141; }
.ui-status-dot.offline { background: #e04b3a; }
.ui-status-dot.checking { background: #e8c02c; }
.ui-set-fps { display: flex; gap: 5px; flex-wrap: wrap; justify-content: center; width: 344px; }
.ui-set-fps .ui-btn { width: auto; font-size: 13px; padding: 6px 12px; }
.ui-set-fps .ui-btn.sel { background: #5a7a4a; border-color: #8fd070 #2f3f22 #2f3f22 #8fd070; }
.ui-key-row {
  display: flex; align-items: center; justify-content: space-between; width: 344px; gap: 12px;
}
.ui-key-row > span { color: #e2e6f5; font-size: 15px; }
.ui-key-btn {
  min-width: 104px; padding: 5px 10px; font-size: 14px; text-align: center; color: #fff;
  background: #46506f; border: 2px solid; border-color: #6d78a0 #2a2f45 #2a2f45 #6d78a0;
}
.ui-key-btn:hover { background: #566188; }
.ui-key-btn.listening { background: #7a6a2f; color: #ffe25e; border-color: #c9b25a #3a3110 #3a3110 #c9b25a; }
.ui-biomes-grid { display: grid; grid-template-columns: repeat(3, 150px); gap: 6px; }
.ui-biomes-grid .ui-btn { width: auto; font-size: 14px; padding: 8px 4px; }
.ui-biomes-status { color: #ffe25e; font-size: 14px; min-height: 18px; text-align: center; }
`;

// Server-Status prüfen: gelingt der WebSocket-Handshake, ist der Server online. Der Server
// schickt sofort eine „serverinfo"-Nachricht (Name, MotD, Bild) — die wird mit zurückgegeben.
function pingServer(adresse, cb) {
  let url;
  try {
    url = adresse
      ? (adresse.startsWith('ws') ? adresse : 'ws://' + adresse)
      : (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
  } catch { cb(false, null); return; }
  let done = false, ws, info = null, t1, t2;
  const finish = (ok) => { if (done) return; done = true; clearTimeout(t1); clearTimeout(t2); try { ws && ws.close(); } catch { /* egal */ } cb(ok, info); };
  try { ws = new WebSocket(url); } catch { cb(false, null); return; }
  t1 = setTimeout(() => finish(false), 3500);
  ws.onopen = () => { clearTimeout(t1); t2 = setTimeout(() => finish(true), 500); }; // kurz auf serverinfo warten
  ws.onmessage = (e) => {
    try {
      const m = JSON.parse(e.data);
      if (m.type === 'serverinfo') { info = { name: m.name || '', motd: m.motd || '', icon: m.icon || '' }; finish(true); }
    } catch { /* egal */ }
  };
  ws.onerror = () => finish(false);
}

// Zwischenspeicher für die zuletzt bekannten Server-Infos (fürs Anzeigen offline).
function serverInfoCache() { try { return JSON.parse(localStorage.getItem('fablemc.srvinfo') || '{}') || {}; } catch { return {}; } }
function saveServerInfo(key, info) {
  try { const c = serverInfoCache(); c[key] = info; localStorage.setItem('fablemc.srvinfo', JSON.stringify(c)); } catch { /* egal */ }
}

export class UI {
  constructor(ctx) {
    this.ctx = ctx;
    this._fps = 60;
    this._debugTimer = 0;
    this._toastTimer = null;
    // i18n: registrierte Closures, die ihren Text bei Sprachwechsel neu setzen
    this._i18nUpdaters = [];
    onLangChange(() => this._applyLang());

    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    this.crosshair = this._el('div', 'ui-crosshair');
    this.ring = this._el('div', 'ui-ring');
    this.debugEl = this._el('div', 'ui-debug');
    this.debugL = document.createElement('div');
    this.debugR = document.createElement('div');
    this.debugR.className = 'dbg-r';
    this.debugEl.appendChild(this.debugL);
    this.debugEl.appendChild(this.debugR);
    this.toastEl = this._el('div', 'ui-toast');
    // Fadenkreuz-Fenster: zeigt Block/Mob im Visier mit Bild + Name
    this.lookatEl = this._el('div', 'ui-lookat');
    this.lookatImg = document.createElement('img');
    this.lookatName = document.createElement('span');
    this.lookatEl.appendChild(this.lookatImg); this.lookatEl.appendChild(this.lookatName);
    // Boss-Leiste (Blutroter Zombie)
    this.bossEl = this._el('div', 'ui-bossbar');
    this.bossName = document.createElement('div'); this.bossName.className = 'ui-bossbar-name';
    const bossTrack = document.createElement('div'); bossTrack.className = 'ui-bossbar-track';
    this.bossFill = document.createElement('div'); this.bossFill.className = 'ui-bossbar-fill';
    bossTrack.appendChild(this.bossFill);
    this.bossEl.appendChild(this.bossName); this.bossEl.appendChild(bossTrack);
    this.loadingEl = this._el('div', 'ui-loading');
    this._reg(() => { this.loadingEl.textContent = t('loading.world'); });

    // pause menu
    this.pauseEl = this._el('div', 'ui-overlay ui-pause');
    const pausePanel = this._el('div', 'ui-panel');
    const ph = document.createElement('h1');
    this._reg(() => { ph.textContent = t('pause.title'); });
    pausePanel.appendChild(ph);
    const btnResume = this._btnT('pause.resume', () => {
      this.hidePause();
      this.ctx.requestLock();
    });
    const btnSave = this._btnT('pause.save', () => {
      this.ctx.save.save();
      this.toast(t('pause.saved'));
    });
    pausePanel.appendChild(btnResume);
    pausePanel.appendChild(btnSave);
    pausePanel.appendChild(this._btnT('menu.settings', () => this.showSettings()));
    this.pauseBiomeBtn = this._btnT('pause.biome', () => {
      this.hidePause();
      this.showBiomeMenu();
    });
    pausePanel.appendChild(this.pauseBiomeBtn);
    pausePanel.appendChild(this._btnT('pause.mainMenu', () => this._backToMenu(), 'ui-btn-quit'));
    this.pauseEl.appendChild(pausePanel);

    this._buildSettings();
    this._buildBiomeMenu();

    document.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.debugEl.style.display = this.debugEl.style.display === 'flex' ? 'none' : 'flex';
      }
    });
  }

  _el(tag, cls) {
    const el = document.createElement(tag);
    el.className = cls;
    document.body.appendChild(el);
    return el;
  }

  _btn(text, onClick, cls = '') {
    const b = document.createElement('button');
    b.className = 'ui-btn' + (cls ? ' ' + cls : '');
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  // i18n: fn sofort ausführen und für spätere Sprachwechsel merken
  _reg(fn) { fn(); this._i18nUpdaters.push(fn); return fn; }

  _applyLang() {
    for (const fn of this._i18nUpdaters) {
      try { fn(); } catch { /* abgelöste Knoten o. Ä. — nie fatal */ }
    }
  }

  // Übersetzter Button: Beschriftung folgt automatisch der Sprache
  _btnT(key, onClick, cls = '') {
    const b = this._btn(t(key), onClick, cls);
    this._reg(() => { b.textContent = t(key); });
    return b;
  }

  // ---- settings ----

  _buildSettings() {
    this.settingsEl = this._el('div', 'ui-overlay ui-settings');
    const panel = document.createElement('div');
    panel.className = 'ui-panel';
    this.settingsEl.appendChild(panel);

    // schließen per ✕, Esc oder Klick auf den abgedunkelten Hintergrund
    const close = document.createElement('button');
    close.className = 'ui-set-close';
    close.textContent = '✕';
    this._reg(() => { close.title = t('set.close'); });
    close.addEventListener('click', () => this.hideSettings());
    panel.appendChild(close);
    this.settingsEl.addEventListener('mousedown', (e) => {
      if (e.target === this.settingsEl) this.hideSettings();
    });
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.settingsEl.classList.contains('open')) {
        e.stopImmediatePropagation();
        if (this._rebinding) { this._rebinding.cancel(); return; } // Esc bricht Tastenbelegung ab
        this.hideSettings();
      }
    }, true);

    const h1 = document.createElement('h1');
    this._reg(() => { h1.textContent = t('set.title'); });
    panel.appendChild(h1);

    // ---- lokale Baukästen ----
    const addSection = (key) => {
      const d = document.createElement('div');
      d.className = 'ui-set-section';
      this._reg(() => { d.textContent = t(key); });
      panel.appendChild(d);
    };
    const addLabel = (fn) => {
      const d = document.createElement('div');
      d.className = 'ui-set-label';
      const upd = () => { d.textContent = fn(); };
      this._reg(upd);
      panel.appendChild(d);
      return upd; // Rückgabe: erlaubt sofortiges Auffrischen bei Wert-Änderung
    };
    const addHint = (key, ...args) => {
      const d = document.createElement('div');
      d.className = 'ui-set-hint';
      this._reg(() => { d.textContent = t(key, ...args); });
      panel.appendChild(d);
    };
    const addToggle = (getFn, setFn) => {
      const refresh = () => { b.textContent = t(getFn() ? 'set.on' : 'set.off'); };
      const b = this._btn('', () => { setFn(!getFn()); refresh(); });
      this._reg(refresh);
      panel.appendChild(b);
      return b;
    };
    const addSlider = (min, max, step, getFn, setFn) => {
      const s = document.createElement('input');
      s.type = 'range'; s.min = String(min); s.max = String(max); s.step = String(step);
      s.value = String(getFn()); s.className = 'ui-set-slider';
      s.addEventListener('input', () => setFn(Number(s.value)));
      panel.appendChild(s);
      return s;
    };

    // ── Sprache ──
    addSection('set.language');
    const langBtn = this._btn(LANG_NAMES[getLang()], () => setLang(getLang() === 'de' ? 'en' : 'de'));
    this._reg(() => { langBtn.textContent = LANG_NAMES[getLang()]; });
    panel.appendChild(langBtn);

    // ── Grafik ──
    addSection('set.sec.graphics');
    const updRender = addLabel(() => t('set.renderDistance', Settings.renderDistance, Settings.renderDistance * 16));
    addSlider(5, 36, 1, () => Settings.renderDistance, (v) => {
      Settings.renderDistance = v; Settings.save(); updRender();
    });
    addHint('set.renderHint', VOXEL_DETAIL_CAP);
    addLabel(() => t('set.clouds'));
    addToggle(() => Settings.clouds, (v) => { Settings.clouds = v; Settings.save(); });
    const updSpeed = addLabel(() => t('set.creativeSpeed', Settings.creativeSpeed.toFixed(2).replace(/\.?0+$/, '')));
    addSlider(1, 3, 0.25, () => Settings.creativeSpeed, (v) => {
      Settings.creativeSpeed = v; Settings.save(); updSpeed();
    });

    // ── Leistung ──
    addSection('set.sec.performance');
    const updFps = addLabel(() => t('set.maxFps', Settings.maxFps === 0 ? t('set.unlimited') : Settings.maxFps));
    const fpsRow = document.createElement('div');
    fpsRow.className = 'ui-set-fps';
    const fpsBtns = [];
    const refreshFps = () => { for (const x of fpsBtns) x.b.classList.toggle('sel', Settings.maxFps === x.v); };
    for (const v of [30, 60, 90, 120, 144, 0]) {
      const b = document.createElement('button');
      b.className = 'ui-btn';
      this._reg(() => { b.textContent = v === 0 ? t('set.unlimited') : String(v); });
      b.addEventListener('click', () => {
        Settings.maxFps = v; Settings.save(); updFps(); refreshFps();
      });
      fpsBtns.push({ b, v });
      fpsRow.appendChild(b);
    }
    refreshFps();
    panel.appendChild(fpsRow);
    addLabel(() => t('set.vsync'));
    addToggle(() => Settings.vsync, (v) => { Settings.vsync = v; Settings.save(); });
    addHint('set.vsyncHint');

    // ── Steuerung ── (belegbare Tasten)
    addSection('set.sec.controls');
    addHint('set.rebindHint');
    this._keyBtns = [];
    for (const action of KEYBIND_ACTIONS) {
      const row = document.createElement('div');
      row.className = 'ui-key-row';
      const name = document.createElement('span');
      this._reg(() => { name.textContent = t('key.' + action); });
      const keyBtn = document.createElement('button');
      keyBtn.className = 'ui-key-btn';
      const refreshKey = () => { keyBtn.textContent = keyLabel(Keybinds.get(action)); };
      refreshKey();
      keyBtn.addEventListener('click', () => this._startRebind(action, keyBtn));
      row.appendChild(name);
      row.appendChild(keyBtn);
      panel.appendChild(row);
      this._keyBtns.push({ action, refreshKey });
    }
    panel.appendChild(this._btnT('set.resetKeys', () => {
      Keybinds.reset();
      for (const k of this._keyBtns) k.refreshKey();
    }));

    panel.appendChild(this._btnT('set.done', () => this.hideSettings()));
  }

  // Tastenbelegung ändern: nächste gedrückte Taste wird zugewiesen (Esc bricht ab).
  _startRebind(action, btn) {
    if (this._rebinding) this._rebinding.cancel();
    btn.classList.add('listening');
    btn.textContent = t('set.rebindWait');
    const finish = () => {
      document.removeEventListener('keydown', onKey, true);
      btn.classList.remove('listening');
      this._rebinding = null;
      for (const k of (this._keyBtns || [])) k.refreshKey();
    };
    const onKey = (e) => {
      if (e.code === 'Escape') return; // Escape behandelt der Settings-Handler als Abbruch
      e.preventDefault();
      e.stopImmediatePropagation();
      Keybinds.set(action, e.code);
      finish();
    };
    this._rebinding = { cancel: finish };
    document.addEventListener('keydown', onKey, true);
  }

  showSettings() {
    this.settingsEl.classList.add('open');
  }

  hideSettings() {
    this.settingsEl.classList.remove('open');
  }

  // ---- biome teleport (creative) ----

  _buildBiomeMenu() {
    this.biomeEl = this._el('div', 'ui-overlay ui-settings');
    const panel = document.createElement('div');
    panel.className = 'ui-panel';
    this.biomeEl.appendChild(panel);

    const close = document.createElement('button');
    close.className = 'ui-set-close';
    close.textContent = '✕';
    close.addEventListener('click', () => this.hideBiomeMenu());
    panel.appendChild(close);
    this.biomeEl.addEventListener('mousedown', (e) => {
      if (e.target === this.biomeEl) this.hideBiomeMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.biomeEl.classList.contains('open')) {
        e.stopImmediatePropagation();
        this.hideBiomeMenu();
      }
    }, true);

    const h1 = document.createElement('h1');
    this._reg(() => { h1.textContent = t('biome.title'); });
    panel.appendChild(h1);

    this.biomeStatus = document.createElement('div');
    this.biomeStatus.className = 'ui-biomes-status';
    this._reg(() => { this.biomeStatus.textContent = t('biome.prompt'); });
    panel.appendChild(this.biomeStatus);

    const grid = document.createElement('div');
    grid.className = 'ui-biomes-grid';
    for (const key of Object.keys(BIOME_NAMES)) {
      const b = this._btn('', () => this._teleportToBiome(key, biomeName(key)));
      this._reg(() => { b.textContent = biomeName(key); }); // bei Sprachwechsel neu beschriften
      grid.appendChild(b);
    }
    panel.appendChild(grid);
  }

  showBiomeMenu() {
    if (this.ctx.state.mode !== 'creative') return;
    this.ctx.state.uiOpen = true;
    if (document.pointerLockElement) document.exitPointerLock();
    this.biomeEl.classList.add('open');
  }

  hideBiomeMenu() {
    this.biomeEl.classList.remove('open');
    this.ctx.state.uiOpen = false;
    this._searchId = (this._searchId || 0) + 1; // laufende Suche abbrechen
    const s = this.ctx.state;
    if (s.gameStarted && !s.paused && !s.dead) this.ctx.requestLock();
  }

  async _teleportToBiome(key, name) {
    const sid = this._searchId = (this._searchId || 0) + 1;
    this.biomeStatus.textContent = `Suche ${name}…`;
    const p = this.ctx.player.pos;
    const found = await this._findBiome(key, p.x, p.z, sid);
    if (sid !== this._searchId) return; // Menü wurde geschlossen / neue Suche
    if (!found) {
      this.biomeStatus.textContent = `Kein ${name} im Umkreis von 8000 Blöcken gefunden.`;
      return;
    }
    const dist = Math.round(Math.hypot(found.x - p.x, found.z - p.z));
    const player = this.ctx.player;
    player.pos.set(found.x + 0.5, Math.max(found.surf, 150) + 2, found.z + 0.5);
    player.vel.set(0, 0, 0);
    player.fallDistance = 0;
    player.flying = true; // schwebend ankommen, bis die Chunks da sind
    this.hideBiomeMenu();
    this.toast(`${name} gefunden — ${dist} Blöcke entfernt`);
  }

  async _findBiome(target, px, pz, sid) {
    let checked = 0;
    for (let r = 0; r <= 8000; r += 24) {
      const samples = r === 0 ? 1 : Math.max(8, Math.floor((2 * Math.PI * r) / 48));
      for (let i = 0; i < samples; i++) {
        const a = (i / samples) * Math.PI * 2;
        const x = Math.round(px + Math.cos(a) * r);
        const z = Math.round(pz + Math.sin(a) * r);
        const c = columnInfo(this.ctx.seed, x, z);
        if (c.biome === target) return { x, z, surf: c.surf };
        if (++checked % 4000 === 0) {
          await new Promise((rs) => setTimeout(rs));
          if (sid !== this._searchId) return null;
        }
      }
    }
    return null;
  }

  // ---- Konto-Bildschirm (Pflicht vor dem Hauptmenü) ----

  showAccount() {
    return new Promise((resolve) => {
      const overlay = this._el('div', 'ui-overlay ui-title open');
      const panel = this._el('div', 'ui-panel');
      overlay.appendChild(panel);

      const h1 = document.createElement('div');
      h1.className = 'ui-h1'; h1.textContent = 'Fable MC';
      const sub = document.createElement('div');
      sub.className = 'ui-sub'; sub.textContent = t('acc.subtitle');
      panel.appendChild(h1); panel.appendChild(sub);

      let mode = 'login';
      const tabs = document.createElement('div'); tabs.className = 'ui-account-tabs';
      const tabLogin = this._btn(t('acc.login'), () => setMode('login'));
      const tabReg = this._btn(t('acc.register'), () => setMode('register'));
      tabs.appendChild(tabLogin); tabs.appendChild(tabReg);
      panel.appendChild(tabs);

      const userIn = document.createElement('input');
      userIn.className = 'ui-seed'; userIn.placeholder = t('acc.username'); userIn.maxLength = 20;
      panel.appendChild(userIn);
      const passIn = document.createElement('input');
      passIn.className = 'ui-seed'; passIn.type = 'password'; passIn.placeholder = t('acc.password'); passIn.maxLength = 64;
      panel.appendChild(passIn);

      const err = document.createElement('div'); err.className = 'ui-account-err';
      panel.appendChild(err);
      const submit = this._btn('', () => go());
      panel.appendChild(submit);
      const hint = document.createElement('div'); hint.className = 'ui-account-hint';
      panel.appendChild(hint);

      const setMode = (m) => {
        mode = m; err.textContent = '';
        tabLogin.classList.toggle('sel', m === 'login');
        tabReg.classList.toggle('sel', m === 'register');
        submit.textContent = m === 'login' ? t('acc.loginBtn') : t('acc.registerBtn');
        hint.textContent = m === 'register' ? t('acc.hintRegister') : t('acc.hintLogin');
      };
      let busy = false;
      const go = async () => {
        if (busy) return;
        const u = userIn.value.trim(), p = passIn.value;
        if (!u || !p) { err.textContent = t('acc.needBoth'); return; }
        busy = true; submit.disabled = true; err.textContent = t('acc.working');
        try {
          if (mode === 'register') await register(u, p); else await login(u, p);
          overlay.remove();
          resolve();
        } catch (e) {
          err.textContent = e.message || 'Fehler';
          busy = false; submit.disabled = false;
        }
      };
      passIn.addEventListener('keydown', (e) => { if (e.code === 'Enter') go(); });

      setMode('login');
      if (!isConfigured()) err.textContent = t('acc.notConfigured');
    });
  }

  // ---- title screen ----

  showTitle() {
    return new Promise((resolve) => {
      const overlay = this._el('div', 'ui-overlay ui-title open');
      const panel = this._el('div', 'ui-panel');
      overlay.appendChild(panel);

      const h1 = document.createElement('div');
      h1.className = 'ui-h1';
      h1.textContent = 'Fable MC';
      // Zufälliger, lustiger Spruch (Minecraft-Stil) — wechselt bei jedem Start & Sprachwechsel
      const sub = document.createElement('div');
      sub.className = 'ui-sub ui-splash';
      this._reg(() => { sub.textContent = randomSplash(); });
      panel.appendChild(h1);
      panel.appendChild(sub);

      // Drei Bildschirme im selben Panel: Hauptmenü, Einzelspieler, Mehrspieler
      const screen = () => { const d = document.createElement('div'); d.className = 'ui-screen'; return d; };
      const mainScreen = screen();
      const spScreen = screen();
      const mpScreen = screen();
      panel.appendChild(mainScreen);
      panel.appendChild(spScreen);
      panel.appendChild(mpScreen);
      const zeige = (el) => {
        for (const s of [mainScreen, spScreen, mpScreen]) s.style.display = 'none';
        el.style.display = '';
      };

      const finish = (mode, seed, gamemode, extra) => {
        overlay.remove();
        resolve({ mode, seed, gamemode, ...(extra || {}) });
      };

      // ---- Hauptmenü ----
      mainScreen.appendChild(this._btnT('menu.singleplayer', () => zeige(spScreen)));
      mainScreen.appendChild(this._btnT('menu.multiplayer', () => zeige(mpScreen)));
      mainScreen.appendChild(this._btnT('menu.settings', () => this.showSettings()));
      // „Beenden" nur in der Desktop-App (Electron) — schließt das Fenster/die App.
      if (/electron/i.test(navigator.userAgent)) {
        mainScreen.appendChild(this._btnT('menu.quit', () => window.close(), 'danger'));
      }
      // Angemeldeter Account + Abmelden
      const konto = currentUser();
      if (konto) {
        const bar = document.createElement('div'); bar.className = 'ui-user-bar';
        bar.textContent = t('acc.loggedIn') + ' ';
        const b = document.createElement('b'); b.textContent = konto; bar.appendChild(b);
        const out = document.createElement('span'); out.className = 'ui-user-logout'; out.textContent = t('acc.logout');
        out.addEventListener('click', () => { logout(); location.reload(); });
        bar.appendChild(out);
        mainScreen.appendChild(bar);
      }

      // ---- Einzelspieler ----
      const worldNameInput = document.createElement('input');
      worldNameInput.className = 'ui-seed';
      worldNameInput.maxLength = 24;
      this._reg(() => { worldNameInput.placeholder = t('sp.worldName'); });
      spScreen.appendChild(worldNameInput);
      const seedInput = document.createElement('input');
      seedInput.className = 'ui-seed';
      this._reg(() => { seedInput.placeholder = t('sp.seedPlaceholder'); });
      spScreen.appendChild(seedInput);
      let gamemode = 'survival';
      const modeBtn = this._btn(t('sp.modeSurvival'), () => {
        gamemode = gamemode === 'survival' ? 'creative' : 'survival';
        modeBtn.textContent = t(gamemode === 'survival' ? 'sp.modeSurvival' : 'sp.modeCreative');
      });
      this._reg(() => { modeBtn.textContent = t(gamemode === 'survival' ? 'sp.modeSurvival' : 'sp.modeCreative'); });
      spScreen.appendChild(modeBtn);
      spScreen.appendChild(this._btnT('sp.create', () => {
        const nm = worldNameInput.value.trim() || ('Welt ' + (SaveManager.listWorlds().length + 1));
        finish('new', parseSeed(seedInput.value), gamemode, { worldId: SaveManager.newId(), worldName: nm });
      }));

      // ── Gespeicherte Welten ──
      const worldsHead = document.createElement('div');
      worldsHead.className = 'ui-set-section';
      this._reg(() => { worldsHead.textContent = t('sp.savedWorlds'); });
      spScreen.appendChild(worldsHead);
      const worldList = document.createElement('div');
      worldList.className = 'ui-list';
      spScreen.appendChild(worldList);
      const rebuildWorlds = () => {
        worldList.textContent = '';
        const worlds = SaveManager.listWorlds();
        if (!worlds.length) {
          const empty = document.createElement('div');
          empty.className = 'ui-list-empty';
          empty.textContent = t('sp.noWorlds');
          worldList.appendChild(empty);
          return;
        }
        for (const w of worlds) {
          const row = document.createElement('div'); row.className = 'ui-list-row';
          const info = document.createElement('div'); info.className = 'ui-list-info';
          const nm = document.createElement('b'); nm.textContent = w.name;
          const meta = document.createElement('span');
          meta.textContent = `Seed ${w.seed} · ${t(w.mode === 'creative' ? 'sp.creative' : 'sp.survival')}`;
          info.appendChild(nm); info.appendChild(meta);
          const load = document.createElement('button'); load.className = 'ui-list-go';
          load.textContent = t('sp.load');
          load.addEventListener('click', () => finish('load', w.seed, w.mode || 'survival', { worldId: w.id }));
          const del = document.createElement('button'); del.className = 'ui-list-del';
          del.textContent = '✕'; del.title = t('sp.delete');
          del.addEventListener('click', () => {
            if (window.confirm(t('sp.deleteConfirm'))) { SaveManager.deleteWorld(w.id); rebuildWorlds(); this.toast(t('sp.deleted')); }
          });
          row.appendChild(info); row.appendChild(load); row.appendChild(del);
          worldList.appendChild(row);
        }
      };
      rebuildWorlds();
      this._reg(rebuildWorlds); // bei Sprachwechsel neu beschriften
      spScreen.appendChild(this._btnT('menu.back', () => zeige(mainScreen)));

      // ---- Mehrspieler ----
      // Mit Account beitreten: ist man angemeldet, wird automatisch der Account-Name
      // benutzt (kein Namensfeld). Ohne eingerichtetes Konto-System bleibt das Namensfeld.
      const mpKonto = currentUser();
      let nameInput = null;
      if (mpKonto) {
        const asLine = document.createElement('div');
        asLine.className = 'ui-mp-asuser';
        const fillAsLine = () => {
          asLine.textContent = t('mp.joinAs') + ' ';
          const b = document.createElement('b'); b.textContent = mpKonto; asLine.appendChild(b);
        };
        fillAsLine(); this._reg(fillAsLine);
        mpScreen.appendChild(asLine);
      } else {
        nameInput = document.createElement('input');
        nameInput.className = 'ui-seed';
        this._reg(() => { nameInput.placeholder = t('mp.namePlaceholder'); });
        nameInput.maxLength = 20;
        mpScreen.appendChild(nameInput);
      }
      const addrInput = document.createElement('input');
      addrInput.className = 'ui-seed';
      this._reg(() => { addrInput.placeholder = t('mp.addrPlaceholder'); });
      mpScreen.appendChild(addrInput);
      // Der Beitritts-Name kommt vom Account (falls angemeldet), sonst aus dem Namensfeld.
      const joinName = () => (mpKonto || (nameInput ? nameInput.value : '') || '').trim() || t('mp.defaultName');
      const joinWith = (adresse) => {
        overlay.remove();
        resolve({
          mode: 'multiplayer', gamemode: 'survival',
          name: joinName(), adresse: (adresse || '').trim(),
        });
      };
      mpScreen.appendChild(this._btnT('mp.join', () => joinWith(addrInput.value)));

      // vorherige Server laden, Namensfeld ggf. vorbelegen (nur ohne Konto)
      let servers = [];
      try { servers = JSON.parse(localStorage.getItem('fablemc.servers.v1') || '[]'); } catch { servers = []; }
      if (!Array.isArray(servers)) servers = [];
      if (nameInput && servers[0]?.name && !nameInput.value) nameInput.value = servers[0].name;

      // ── Vorherige Server (mit Online-Status) ──
      const srvHead = document.createElement('div');
      srvHead.className = 'ui-set-section';
      this._reg(() => { srvHead.textContent = t('mp.prevServers'); });
      mpScreen.appendChild(srvHead);
      const srvList = document.createElement('div');
      srvList.className = 'ui-list';
      mpScreen.appendChild(srvList);
      const rebuildServers = () => {
        srvList.textContent = '';
        if (!servers.length) {
          const empty = document.createElement('div');
          empty.className = 'ui-list-empty';
          empty.textContent = t('mp.noServers');
          srvList.appendChild(empty);
          return;
        }
        for (const srv of servers) {
          const key = srv.adresse || 'local';
          let cached = serverInfoCache()[key] || null;
          const row = document.createElement('div'); row.className = 'ui-list-row';
          const icon = document.createElement('img'); icon.className = 'ui-srv-icon'; icon.alt = '';
          const dot = document.createElement('span'); dot.className = 'ui-status-dot checking';
          dot.title = t('mp.checking');
          const info = document.createElement('div'); info.className = 'ui-list-info';
          const nm = document.createElement('b');
          const meta = document.createElement('span');
          info.appendChild(nm); info.appendChild(meta);
          // zeigt Name/MotD/Bild aus der (zuletzt bekannten oder live) Server-Info
          const applyInfo = (ci) => {
            nm.textContent = (ci && ci.name) || srv.name;
            meta.textContent = (ci && ci.motd) || srv.adresse || t('mp.thisServer');
            if (ci && ci.icon) { icon.src = ci.icon; icon.style.display = 'block'; } else { icon.style.display = 'none'; }
          };
          applyInfo(cached);
          const go = document.createElement('button'); go.className = 'ui-list-go';
          go.textContent = t('mp.connect');
          go.addEventListener('click', () => joinWith(srv.adresse));
          const del = document.createElement('button'); del.className = 'ui-list-del';
          del.textContent = '✕';
          del.addEventListener('click', () => {
            servers = servers.filter((x) => x !== srv);
            try { localStorage.setItem('fablemc.servers.v1', JSON.stringify(servers)); } catch { /* egal */ }
            rebuildServers();
          });
          row.appendChild(icon); row.appendChild(dot); row.appendChild(info); row.appendChild(go); row.appendChild(del);
          srvList.appendChild(row);
          pingServer(srv.adresse, (ok, live) => {
            dot.className = 'ui-status-dot ' + (ok ? 'online' : 'offline');
            dot.title = ok ? t('mp.online') : t('mp.offline');
            if (ok && live && (live.name || live.motd || live.icon)) { cached = live; saveServerInfo(key, live); applyInfo(live); }
          });
        }
      };
      rebuildServers();
      this._reg(rebuildServers);
      mpScreen.appendChild(this._btnT('menu.back', () => zeige(mainScreen)));

      zeige(mainScreen); // Start im Hauptmenü
    });
  }

  // ---- game HUD ----

  setMiningProgress(p) {
    if (p <= 0) {
      this.ring.style.display = 'none';
    } else {
      this.ring.style.display = 'block';
      const deg = Math.round(p * 360);
      this.ring.style.background =
        `conic-gradient(#ffffff ${deg}deg, rgba(255,255,255,0.2) ${deg}deg)`;
      this.ring.style.clipPath = 'circle(50%)';
      this.ring.style.mask = 'radial-gradient(circle, transparent 9px, #000 10px)';
      this.ring.style.webkitMask = 'radial-gradient(circle, transparent 9px, #000 10px)';
    }
  }

  showLoading(show) {
    this.loadingEl.classList.toggle('open', show);
  }

  showPause() {
    this.ctx.state.paused = true;
    this.pauseBiomeBtn.style.display = this.ctx.state.mode === 'creative' ? '' : 'none';
    this.pauseEl.classList.add('open');
  }

  hidePause() {
    this.ctx.state.paused = false;
    this.pauseEl.classList.remove('open');
  }

  // Zurück zum Titelbildschirm. Im Einzelspieler vorher lokal speichern, im
  // Mehrspieler sauber vom Server trennen. Ein voller Reload garantiert einen
  // frischen Zustand ohne Speicher-/WebGL-Lecks — der Titel erscheint wieder.
  _backToMenu() {
    const mp = this.ctx.net?.active;
    if (!mp) {
      try { this.ctx.save?.save(); } catch { /* Speichern best effort */ }
    } else {
      try { this.ctx.net.ws?.close(); } catch { /* egal, Reload trennt ohnehin */ }
    }
    location.reload();
  }

  toast(text) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), 2200);
  }

  // Schlaf-Sequenz: Bild wird schwarz, im Dunkeln springt die Zeit (onDark), dann aufwachen
  sleep(onDark) {
    if (this._sleeping) return;
    this._sleeping = true;
    const el = document.createElement('div');
    el.style.cssText =
      'position:fixed;inset:0;z-index:60;background:#000;opacity:0;' +
      'transition:opacity 1.1s;display:flex;align-items:center;justify-content:center;' +
      'color:#ddd;font-size:22px;pointer-events:none;';
    el.textContent = 'Du schläfst …';
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; });
    setTimeout(() => {
      onDark?.();
      setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => { el.remove(); this._sleeping = false; }, 1200);
      }, 700);
    }, 1400);
  }

  update(dt) {
    this._fps += (1 / Math.max(dt, 1e-4) - this._fps) * 0.05;
    this._frameMs = (this._frameMs ?? 16) * 0.95 + dt * 1000 * 0.05;
    this._updateBossbar();
    this._updateLookAt();
    this._debugTimer += dt;
    if (this._debugTimer > 0.25 && this.debugEl.style.display === 'flex' &&
        this.ctx.player && this.ctx.state.gameStarted) {
      this._debugTimer = 0;
      this._renderDebug();
    }
  }

  // Boss-Leiste: nächstgelegenen lebenden Boss in Reichweite anzeigen
  _updateBossbar() {
    const ents = this.ctx.entities;
    const p = this.ctx.player?.pos;
    let boss = null;
    if (ents && p && this.ctx.state.gameStarted) {
      let bestD = 46 * 46;
      for (const e of ents.list) {
        if (e.type !== 'crimson_zombie' || e.remove || e.dying > 0) continue;
        const d = e.pos.distanceToSquared(p);
        if (d < bestD) { bestD = d; boss = e; }
      }
    }
    if (boss) {
      this.bossEl.classList.add('show');
      this.bossName.textContent = boss.name || 'Blutroter Zombie';
      const frac = Math.max(0, Math.min(1, boss.health / (boss.maxHealth || 1)));
      this.bossFill.style.width = (frac * 100) + '%';
    } else {
      this.bossEl.classList.remove('show');
    }
  }

  // Fadenkreuz-Fenster: Bild + Name des angevisierten Blocks/Mobs (Wasser/Lava ausgenommen)
  _updateLookAt() {
    const la = this.ctx.player?.lookAt;
    const key = la ? (la.kind === 'block' ? 'b' + la.id : 'm' + la.type) : '';
    if (key === this._lookKey) return; // nichts geändert → keine Arbeit
    this._lookKey = key;
    if (!la || !this.ctx.state.gameStarted) { this.lookatEl.classList.remove('show'); return; }
    let name, url;
    if (la.kind === 'block') {
      name = nameOf(la.id);
      url = getIconDataURL(la.id);
    } else {
      name = la.name || MOB_NAMES[la.type] || la.type;
      url = this.ctx.entities?.getMobIcon(la.type);
    }
    if (!name) { this.lookatEl.classList.remove('show'); return; }
    this.lookatName.textContent = name;
    if (url) { this.lookatImg.src = url; this.lookatImg.style.display = 'block'; }
    else this.lookatImg.style.display = 'none';
    this.lookatEl.classList.add('show');
  }

  // ---- F3-Debug: zwei Spalten — links Spiel/Welt, rechts Engine-Interna ----
  _renderDebug() {
    const { player, world, entities, daynight, seed, state: st } = this.ctx;
    const p = player.pos;
    const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
    const cx = Math.floor(bx / CHUNK_SIZE), cz = Math.floor(bz / CHUNK_SIZE);
    const lx = bx - cx * CHUNK_SIZE, lz = bz - cz * CHUNK_SIZE;

    // Blick & Bewegung
    const yawDeg = ((player.yaw * 180 / Math.PI) % 360 + 360) % 360;
    const pitchDeg = player.pitch * 180 / Math.PI;
    const CARD = { N: t('dbg.dirN'), S: t('dbg.dirS'), E: t('dbg.dirE'), W: t('dbg.dirW') };
    const hSpeed = Math.hypot(player.vel.x, player.vel.z);
    const zustand = [
      player.onGround ? t('dbg.onGround') : t('dbg.inAir'),
      player.inWater ? t('dbg.inWater') : null,
      player.inLava ? t('dbg.inLava') : null,
      BLOCKS[world.getBlock(bx, by, bz)]?.climbable ? t('dbg.climbing') : null,
      player.flying ? t('dbg.flyingState') : null,
    ].filter(Boolean).join(' · ');

    // Klima & Spalte (tiefer als MC: die rohen Noise-Werte der Biomwahl)
    const col = columnInfo(seed, bx, bz);

    // Licht am Spieler (Nibble: Himmel/Block)
    const L = world.getLight(bx, by, bz);
    const licht = L >= 0 ? t('dbg.lightVal', L >> 4, L & 15) : '—';

    // Zeit
    const f = daynight.dayFraction;
    const hours = (f * 24 + 6) % 24;
    const hh = String(Math.floor(hours)).padStart(2, '0');
    const mm = String(Math.floor((hours % 1) * 60)).padStart(2, '0');
    const tag = Math.floor(this.ctx.state.time / Rules.dayLengthSec) + 1;

    // Effekte
    const fx = player.effects || {};
    const effekte = Object.entries(fx).filter(([, s]) => s > 0)
      .map(([k, s]) => `${k} ${Math.ceil(s)}s`).join(', ') || '—';

    // Ziel-Block
    let ziel = '—';
    const tgt = player.target;
    if (tgt) {
      const def = BLOCKS[tgt.id];
      const tL = world.getLight(tgt.x + tgt.nx, tgt.y + tgt.ny, tgt.z + tgt.nz);
      ziel = `${def?.name ?? '?'} (#${tgt.id})  @ ${tgt.x}/${tgt.y}/${tgt.z}\n` +
        `  ${t('dbg.hardness')} ${def?.hardness ?? '—'} · ${t('dbg.tool')} ${def?.tool ?? t('dbg.hand')} · ${t('dbg.tier')} ${def?.harvestLevel ?? 0}` +
        (tL >= 0 ? ` · ${t('dbg.light')} ${tL >> 4}/${tL & 15}` : '');
    }

    // Hand
    let hand = '—';
    const held = this.ctx.inventory.selectedItem();
    if (held) {
      hand = `${nameOf(held.id)} (#${held.id}) ×${held.count}`;
      if (isEquipment(held.id)) {
        hand += ` · ${t('inv.durability')} ${durabilityLeft(held)}/${maxDurability(held)}`;
        if (held.slots) hand += ` · Slots ${(held.upgrades || []).length}/${held.slots}`;
      }
    }

    const sp = player.spawnPoint;
    this.debugL.textContent =
      `Fable MC — ${Math.round(this._fps)} FPS (${this._frameMs.toFixed(1)} ms)\n` +
      `${t('dbg.mode')}: ${st.mode}${st.spectator ? ' (Spectator)' : ''}\n` +
      `\n` +
      `XYZ: ${p.x.toFixed(3)} / ${p.y.toFixed(3)} / ${p.z.toFixed(3)}\n` +
      `Block: ${bx} ${by} ${bz}\n` +
      `Chunk: ${lx} ${by} ${lz}  in  ${cx} ${cz}\n` +
      `${t('dbg.facing')}: ${CARD[yawToCardinal(player.yaw)]}  (yaw ${yawDeg.toFixed(1)}° / pitch ${pitchDeg.toFixed(1)}°)\n` +
      `${t('dbg.speed')}: ${t('dbg.speedUnit', hSpeed.toFixed(2), player.vel.y.toFixed(2))}\n` +
      `${t('dbg.status')}: ${zustand}\n` +
      `\n` +
      `${t('dbg.biome')}: ${biomeName(col.biome)}\n` +
      `${t('dbg.climate')}: T ${col.T.toFixed(3)} · H ${col.H.toFixed(3)} · Berg ${col.mEff.toFixed(3)}\n` +
      `${t('dbg.surface')}: y ${col.surf} (Δ ${(p.y - col.surf).toFixed(1)})\n` +
      `${t('dbg.lightHere')}: ${licht}\n` +
      `\n` +
      `${t('dbg.time')}: ${hh}:${mm} ${daynight.isNight() ? t('dbg.night') : t('dbg.dayLabel')} · ${t('dbg.day')} ${tag}\n` +
      `Seed: ${seed}\n` +
      `${t('dbg.spawn')}: ${sp ? `${sp.x} ${sp.y} ${sp.z} ${t('dbg.spawnBed')}` : t('dbg.spawnWorld')}\n` +
      `${t('dbg.effects')}: ${effekte}\n` +
      `\n` +
      `${t('dbg.target')}: ${ziel}\n` +
      `${t('dbg.hand')}: ${hand}`;

    // ---- rechte Spalte: Engine ----
    let meshed = 0, dirty = 0, lightDirty = 0, mitDaten = 0;
    for (const c of world.chunks.values()) {
      if (c.data) mitDaten++;
      if (c.meshed) meshed++;
      if (c.dirty) dirty++;
      if (c.lightDirty) lightDirty++;
    }
    const info = this.ctx.renderer?.info;
    const heap = performance.memory
      ? `${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)} / ${(performance.memory.jsHeapSizeLimit / 1048576).toFixed(0)} MB`
      : '—';
    const typen = {};
    for (const e of entities.list) typen[e.type] = (typen[e.type] || 0) + 1;
    const typZeile = Object.entries(typen).map(([k, n]) => `${k} ${n}`).join(' · ') || '—';
    let editChunks = 0, editZellen = 0;
    for (const em of world.edits.values()) { editChunks++; editZellen += em.size; }
    let saveKB = '—';
    try {
      const s = localStorage.getItem('fablemc.save.v7');
      if (s) saveKB = (s.length / 1024).toFixed(1) + ' KB';
    } catch { /* egal */ }
    const fluids = this.ctx.fluids;
    const flora = this.ctx.flora;
    const blocks = this.ctx.blocks;

    this.debugR.textContent =
      `— Engine —\n` +
      `Chunks: ${world.chunkCount} geladen · ${mitDaten} generiert · ${meshed} gemesht\n` +
      `  dirty ${dirty} · relight ${lightDirty} · Gen-Queue ${world._pending?.size ?? 0} · Mesh-Queue ${world._meshResults?.size ?? 0}\n` +
      `Worker: ${world._workers?.length ?? 0}\n` +
      `Draw-Calls: ${this.ctx.renderStats?.calls ?? '—'} · Dreiecke: ${(this.ctx.renderStats?.triangles ?? 0).toLocaleString('de-DE')}\n` +
      `GPU-Speicher: ${info?.memory.geometries ?? '—'} Geometrien · ${info?.memory.textures ?? '—'} Texturen\n` +
      `JS-Heap: ${heap}\n` +
      `\n` +
      `Entities: ${entities.count}\n` +
      `  ${typZeile}\n` +
      `Partikel: ${this.ctx.furnaces?.particles.length ?? 0}\n` +
      `Öfen: ${this.ctx.furnaces?.map.size ?? 0} · Truhen: ${blocks?.chests.size ?? 0} · Events: ${blocks?.lootEvents.size ?? 0}\n` +
      `\n` +
      `Fluid-Sim: Wasser ${fluids?.queueW.size ?? 0} · Lava ${fluids?.queueL.size ?? 0} Zellen\n` +
      `  Gischt ${fluids?._gischtZellen?.length ?? 0} · Funken ${fluids?._funkenZellen?.length ?? 0}\n` +
      `Flora: Laub-Queue ${flora?.decayQueue.size ?? 0} · Setzlinge ${flora?.saplings.size ?? 0} · Kristalle ${flora?._kristalle?.length ?? 0}\n` +
      `\n` +
      `Welt-Edits: ${editZellen.toLocaleString('de-DE')} Blöcke in ${editChunks} Chunks\n` +
      `Spielstand: ${saveKB}`;
  }
}

function parseSeed(text) {
  const t = text.trim();
  if (!t) return Math.floor(Math.random() * 2147483647);
  if (/^-?\d+$/.test(t)) return Number(t) | 0;
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
  return h;
}
