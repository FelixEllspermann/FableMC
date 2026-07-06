// UI: title screen, pause menu, crosshair, mining progress, debug overlay, toasts.

import { SaveManager } from './save.js';
import { biomeAt, columnInfo } from './worldgen.js';
import { Settings } from './settings.js';
import {
  VOXEL_DETAIL_CAP, CHUNK_SIZE, DAY_LENGTH, BLOCKS, ITEMS, isBlockId, nameOf,
  yawToCardinal,
} from './constants.js';
import { isEquipment, maxDurability, durabilityLeft } from './equip.js';
import { getIconDataURL } from './textures.js';

// Anzeigenamen der Mobs fürs Fadenkreuz-Fenster
const MOB_NAMES = {
  pig: 'Schwein', sheep: 'Schaf', chicken: 'Huhn', fish: 'Fisch',
  zombie: 'Zombie', skeleton: 'Skelett', creeper: 'Creeper',
  crimson_zombie: 'Blutroter Zombie', slime: 'Schleim', villager: 'Dorfbewohner',
};

export const BIOME_NAMES = {
  ozean: 'Ozean', see: 'See', strand: 'Strand', ebene: 'Ebene', wald: 'Wald',
  birkenwald: 'Birkenwald', tannenwald: 'Tannenwald', blumenwiese: 'Blumenwiese',
  sumpf: 'Sumpf', wueste: 'Wüste', savanne: 'Savanne', badlands: 'Badlands',
  dschungel: 'Dschungel',
  schneelandschaft: 'Schneelandschaft', schneewald: 'Schneewald', pilzinsel: 'Pilzinsel',
  gebirgsfuss: 'Gebirgsfuß', haenge: 'Mittlere Hänge', hochgebirge: 'Hochgebirge', gipfel: 'Gipfel',
};

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
  background: linear-gradient(#2c3e66, #141a2e);
}
.ui-panel { display: flex; flex-direction: column; gap: 12px; align-items: center; }
.ui-screen { display: flex; flex-direction: column; gap: 12px; align-items: center; }
.ui-h1 {
  font-size: 62px; color: #fff; letter-spacing: 4px; margin-bottom: 6px;
  text-shadow: 4px 4px 0 #26418c, 6px 6px 0 rgba(0,0,0,0.5);
}
.ui-sub { color: #ffe25e; font-size: 15px; margin-bottom: 20px; text-shadow: 2px 2px 0 #3f3f00; }
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
.ui-controls {
  margin-top: 26px; color: #b8c2e0; font-size: 13px; line-height: 1.7; text-align: center;
}
.ui-pause h1 { font-size: 40px; color: #fff; margin-bottom: 18px; text-shadow: 3px 3px 0 #222; }
.ui-loading {
  position: fixed; inset: 0; z-index: 58; display: none; align-items: center;
  justify-content: center; background: #141a2e; color: #fff; font-size: 22px;
}
.ui-loading.open { display: flex; }
.ui-settings { z-index: 66; background: rgba(0, 0, 0, 0.72); }
.ui-settings .ui-panel { position: relative; background: #2a2f45; padding: 26px 34px; border: 2px solid #555d80; border-radius: 4px; }
.ui-set-close {
  position: absolute; top: 6px; right: 8px; width: 30px; height: 30px;
  font-size: 17px; line-height: 1; padding: 0; background: #3a4060; color: #cfd6f0;
  border: 1px solid #555d80;
}
.ui-set-close:hover { background: #9d5f5f; color: #fff; }
.ui-settings h1 { font-size: 30px; color: #fff; margin-bottom: 4px; text-shadow: 2px 2px 0 #14172a; }
.ui-set-label { color: #fff; font-size: 17px; }
.ui-set-slider { width: 320px; accent-color: #79c05a; cursor: pointer; }
.ui-set-hint { color: #9aa4c4; font-size: 12.5px; max-width: 340px; text-align: center; line-height: 1.5; }
.ui-biomes-grid { display: grid; grid-template-columns: repeat(3, 150px); gap: 6px; }
.ui-biomes-grid .ui-btn { width: auto; font-size: 14px; padding: 8px 4px; }
.ui-biomes-status { color: #ffe25e; font-size: 14px; min-height: 18px; text-align: center; }
`;

const CONTROLS_TEXT =
  'WASD Bewegen · Leertaste Springen/Schwimmen · Strg/2×W Sprinten · Shift Schleichen\n' +
  'Linksklick Abbauen/Angreifen · Rechtsklick Platzieren/Essen/Werkbank\n' +
  'E Inventar · 1–9 / Mausrad Hotbar · F3 Debug · Esc Pause\n' +
  'Kreativ: 2×Leertaste Fliegen (Leertaste/Shift hoch/runter) · B Biom-Teleport · F4 Spectator';

export class UI {
  constructor(ctx) {
    this.ctx = ctx;
    this._fps = 60;
    this._debugTimer = 0;
    this._toastTimer = null;

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
    this.loadingEl.textContent = 'Welt wird generiert…';

    // pause menu
    this.pauseEl = this._el('div', 'ui-overlay ui-pause');
    const pausePanel = this._el('div', 'ui-panel');
    const ph = document.createElement('h1');
    ph.textContent = 'Pause';
    pausePanel.appendChild(ph);
    const btnResume = this._btn('Weiterspielen', () => {
      this.hidePause();
      this.ctx.requestLock();
    });
    const btnSave = this._btn('Speichern', () => {
      this.ctx.save.save();
      this.toast('Gespeichert');
    });
    pausePanel.appendChild(btnResume);
    pausePanel.appendChild(btnSave);
    pausePanel.appendChild(this._btn('Einstellungen', () => this.showSettings()));
    this.pauseBiomeBtn = this._btn('Biom-Teleport', () => {
      this.hidePause();
      this.showBiomeMenu();
    });
    pausePanel.appendChild(this.pauseBiomeBtn);
    pausePanel.appendChild(this._btn('Zurück zum Hauptmenü', () => this._backToMenu(), 'ui-btn-quit'));
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
    close.title = 'Schließen';
    close.addEventListener('click', () => this.hideSettings());
    panel.appendChild(close);
    this.settingsEl.addEventListener('mousedown', (e) => {
      if (e.target === this.settingsEl) this.hideSettings();
    });
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.settingsEl.classList.contains('open')) {
        e.stopImmediatePropagation();
        this.hideSettings();
      }
    }, true);

    const h1 = document.createElement('h1');
    h1.textContent = 'Einstellungen';
    panel.appendChild(h1);

    const label = document.createElement('div');
    label.className = 'ui-set-label';
    const updateLabel = () => {
      const v = Settings.renderDistance;
      label.textContent = `Sichtweite: ${v} Chunks (${v * 16} Blöcke)`;
    };
    updateLabel();
    panel.appendChild(label);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '5';
    slider.max = '36';
    slider.step = '1';
    slider.value = String(Settings.renderDistance);
    slider.className = 'ui-set-slider';
    slider.addEventListener('input', () => {
      Settings.renderDistance = Number(slider.value);
      Settings.save();
      updateLabel();
    });
    panel.appendChild(slider);

    const hint = document.createElement('div');
    hint.className = 'ui-set-hint';
    hint.textContent =
      `Bis ${VOXEL_DETAIL_CAP} Chunks volle Voxel-Details — darüber wird entferntes Gelände ` +
      'vereinfacht dargestellt (Höhenprofil mit Biomfarben). Sehr hohe Werte kosten Leistung. ' +
      'Wirkt sofort, ohne Neustart.';
    panel.appendChild(hint);

    // Lauftempo im Kreativmodus (1x .. 3x)
    const speedLabel = document.createElement('div');
    speedLabel.className = 'ui-set-label';
    const updateSpeedLabel = () => {
      speedLabel.textContent = `Lauftempo im Kreativmodus: ×${Settings.creativeSpeed.toFixed(2).replace(/\.?0+$/, '')}`;
    };
    updateSpeedLabel();
    panel.appendChild(speedLabel);

    const speedSlider = document.createElement('input');
    speedSlider.type = 'range';
    speedSlider.min = '1';
    speedSlider.max = '3';
    speedSlider.step = '0.25';
    speedSlider.value = String(Settings.creativeSpeed);
    speedSlider.className = 'ui-set-slider';
    speedSlider.addEventListener('input', () => {
      Settings.creativeSpeed = Number(speedSlider.value);
      Settings.save();
      updateSpeedLabel();
    });
    panel.appendChild(speedSlider);

    panel.appendChild(this._btn('Fertig', () => this.hideSettings()));
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
    h1.textContent = 'Biom-Teleport';
    panel.appendChild(h1);

    this.biomeStatus = document.createElement('div');
    this.biomeStatus.className = 'ui-biomes-status';
    this.biomeStatus.textContent = 'Nächstes Vorkommen suchen und hinspringen:';
    panel.appendChild(this.biomeStatus);

    const grid = document.createElement('div');
    grid.className = 'ui-biomes-grid';
    for (const [key, name] of Object.entries(BIOME_NAMES)) {
      const b = this._btn(name, () => this._teleportToBiome(key, name));
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

  // ---- title screen ----

  showTitle() {
    return new Promise((resolve) => {
      const overlay = this._el('div', 'ui-overlay ui-title open');
      const panel = this._el('div', 'ui-panel');
      overlay.appendChild(panel);

      const h1 = document.createElement('div');
      h1.className = 'ui-h1';
      h1.textContent = 'Fable MC';
      const sub = document.createElement('div');
      sub.className = 'ui-sub';
      sub.textContent = 'Ein Minecraft-Klon — komplett prozedural';
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

      const finish = (mode, seed, gamemode) => {
        overlay.remove();
        resolve({ mode, seed, gamemode });
      };

      // ---- Hauptmenü ----
      mainScreen.appendChild(this._btn('Einzelspieler', () => zeige(spScreen)));
      mainScreen.appendChild(this._btn('Mehrspieler', () => zeige(mpScreen)));
      mainScreen.appendChild(this._btn('Einstellungen', () => this.showSettings()));
      // „Beenden" nur in der Desktop-App (Electron) — schließt das Fenster/die App.
      if (/electron/i.test(navigator.userAgent)) {
        mainScreen.appendChild(this._btn('Beenden', () => window.close(), 'danger'));
      }

      // ---- Einzelspieler ----
      const seedInput = document.createElement('input');
      seedInput.className = 'ui-seed';
      seedInput.placeholder = 'Seed (leer = zufällig)';
      spScreen.appendChild(seedInput);
      let gamemode = 'survival';
      const modeBtn = this._btn('Spielmodus: Überleben', () => {
        gamemode = gamemode === 'survival' ? 'creative' : 'survival';
        modeBtn.textContent = gamemode === 'survival' ? 'Spielmodus: Überleben' : 'Spielmodus: Kreativ';
      });
      spScreen.appendChild(modeBtn);
      spScreen.appendChild(this._btn('Neue Welt', () => finish('new', parseSeed(seedInput.value), gamemode)));
      const btnLoad = this._btn('Welt fortsetzen', () => {
        const meta = SaveManager.readMeta();
        if (meta) finish('load', meta.seed, gamemode);
      });
      const btnDelete = this._btn('Welt löschen', () => {
        if (window.confirm('Gespeicherte Welt wirklich löschen?')) {
          SaveManager.clear();
          btnLoad.disabled = true;
          btnDelete.disabled = true;
          this.toast('Welt gelöscht');
        }
      }, 'danger');
      if (!SaveManager.hasSave()) {
        btnLoad.disabled = true;
        btnDelete.disabled = true;
      }
      spScreen.appendChild(btnLoad);
      spScreen.appendChild(btnDelete);
      spScreen.appendChild(this._btn('‹ Zurück', () => zeige(mainScreen)));

      // ---- Mehrspieler ----
      const nameInput = document.createElement('input');
      nameInput.className = 'ui-seed';
      nameInput.placeholder = 'Spielername';
      nameInput.maxLength = 20;
      mpScreen.appendChild(nameInput);
      const addrInput = document.createElement('input');
      addrInput.className = 'ui-seed';
      addrInput.placeholder = 'Server-Adresse (leer = dieser Server)';
      mpScreen.appendChild(addrInput);
      mpScreen.appendChild(this._btn('Mehrspieler beitreten', () => {
        overlay.remove();
        resolve({
          mode: 'multiplayer', gamemode: 'survival',
          name: nameInput.value.trim() || 'Spieler',
          adresse: addrInput.value.trim(),
        });
      }));
      // „Wieder verbinden": letzten Server mit demselben Namen erneut betreten
      let letzter = null;
      try { letzter = JSON.parse(localStorage.getItem('fablemc.lastserver') || 'null'); } catch { letzter = null; }
      if (letzter && letzter.name) {
        nameInput.value = letzter.name; // Felder vorbelegen
        addrInput.value = letzter.adresse || '';
      }
      const btnRejoin = this._btn(
        letzter && letzter.name
          ? `Wieder verbinden (${letzter.name}${letzter.adresse ? ' @ ' + letzter.adresse : ''})`
          : 'Wieder verbinden',
        () => {
          overlay.remove();
          resolve({
            mode: 'multiplayer', gamemode: 'survival',
            name: letzter.name, adresse: letzter.adresse || '',
          });
        });
      if (!(letzter && letzter.name)) btnRejoin.disabled = true;
      mpScreen.appendChild(btnRejoin);
      mpScreen.appendChild(this._btn('‹ Zurück', () => zeige(mainScreen)));

      zeige(mainScreen); // Start im Hauptmenü

      const controls = document.createElement('div');
      controls.className = 'ui-controls';
      controls.textContent = CONTROLS_TEXT;
      panel.appendChild(controls);
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
    const CARD = { N: 'Norden (−z)', S: 'Süden (+z)', E: 'Osten (+x)', W: 'Westen (−x)' };
    const hSpeed = Math.hypot(player.vel.x, player.vel.z);
    const zustand = [
      player.onGround ? 'am Boden' : 'in der Luft',
      player.inWater ? 'im Wasser' : null,
      player.inLava ? 'in Lava!' : null,
      BLOCKS[world.getBlock(bx, by, bz)]?.climbable ? 'klettert' : null,
      player.flying ? 'fliegt' : null,
    ].filter(Boolean).join(' · ');

    // Klima & Spalte (tiefer als MC: die rohen Noise-Werte der Biomwahl)
    const col = columnInfo(seed, bx, bz);

    // Licht am Spieler (Nibble: Himmel/Block)
    const L = world.getLight(bx, by, bz);
    const licht = L >= 0 ? `Himmel ${L >> 4} / Block ${L & 15}` : '—';

    // Zeit
    const f = daynight.dayFraction;
    const hours = (f * 24 + 6) % 24;
    const hh = String(Math.floor(hours)).padStart(2, '0');
    const mm = String(Math.floor((hours % 1) * 60)).padStart(2, '0');
    const tag = Math.floor(this.ctx.state.time / DAY_LENGTH) + 1;

    // Effekte
    const fx = player.effects || {};
    const effekte = Object.entries(fx).filter(([, s]) => s > 0)
      .map(([k, s]) => `${k} ${Math.ceil(s)}s`).join(', ') || '—';

    // Ziel-Block
    let ziel = '—';
    const t = player.target;
    if (t) {
      const def = BLOCKS[t.id];
      const tL = world.getLight(t.x + t.nx, t.y + t.ny, t.z + t.nz);
      ziel = `${def?.name ?? '?'} (#${t.id})  @ ${t.x}/${t.y}/${t.z}\n` +
        `  Härte ${def?.hardness ?? '—'} · Werkzeug ${def?.tool ?? 'Hand'} · Stufe ${def?.harvestLevel ?? 0}` +
        (tL >= 0 ? ` · Licht ${tL >> 4}/${tL & 15}` : '');
    }

    // Hand
    let hand = '—';
    const held = this.ctx.inventory.selectedItem();
    if (held) {
      hand = `${nameOf(held.id)} (#${held.id}) ×${held.count}`;
      if (isEquipment(held.id)) {
        hand += ` · Haltbarkeit ${durabilityLeft(held)}/${maxDurability(held)}`;
        if (held.slots) hand += ` · Slots ${(held.upgrades || []).length}/${held.slots}`;
      }
    }

    const sp = player.spawnPoint;
    this.debugL.textContent =
      `Fable MC — ${Math.round(this._fps)} FPS (${this._frameMs.toFixed(1)} ms)\n` +
      `Modus: ${st.mode}${st.spectator ? ' (Spectator)' : ''}\n` +
      `\n` +
      `XYZ: ${p.x.toFixed(3)} / ${p.y.toFixed(3)} / ${p.z.toFixed(3)}\n` +
      `Block: ${bx} ${by} ${bz}\n` +
      `Chunk: ${lx} ${by} ${lz}  in  ${cx} ${cz}\n` +
      `Blick: ${CARD[yawToCardinal(player.yaw)]}  (yaw ${yawDeg.toFixed(1)}° / pitch ${pitchDeg.toFixed(1)}°)\n` +
      `Tempo: ${hSpeed.toFixed(2)} B/s horizontal · ${player.vel.y.toFixed(2)} vertikal\n` +
      `Status: ${zustand}\n` +
      `\n` +
      `Biom: ${BIOME_NAMES[col.biome] ?? col.biome}\n` +
      `Klima: T ${col.T.toFixed(3)} · H ${col.H.toFixed(3)} · Berg ${col.mEff.toFixed(3)}\n` +
      `Oberfläche: y ${col.surf} (Δ ${(p.y - col.surf).toFixed(1)})\n` +
      `Licht hier: ${licht}\n` +
      `\n` +
      `Zeit: ${hh}:${mm} ${daynight.isNight() ? '☾ Nacht' : '☀ Tag'} · Tag ${tag}\n` +
      `Seed: ${seed}\n` +
      `Spawn: ${sp ? `${sp.x} ${sp.y} ${sp.z} (Bett)` : 'Welt-Spawn'}\n` +
      `Effekte: ${effekte}\n` +
      `\n` +
      `Ziel: ${ziel}\n` +
      `Hand: ${hand}`;

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
