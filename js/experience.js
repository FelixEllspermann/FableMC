// Erfahrung & Level: persönliche XP-Leiste über der Hotbar + Minecraft-Levelkurve.
//
// XP ist eine PERSÖNLICHE Größe — jeder Client zählt seine eigene und sieht nur
// die eigene Leiste. Multiplayer-sauber:
//   • Erzabbau  → lokal beim Abbauenden (Block-Bruch läuft auf jedem Client selbst)
//   • Mob-Kills → der Mob-Besitzer (Host/Einzelspieler) rechnet die XP dem
//     Verursacher zu: eigener Kill = lokal, Gast-Kill = per Netz an den Gast.
// Was Level später FREISCHALTEN, kommt in einem späteren Schritt — hier nur die
// Grundlage (XP sammeln, aufsteigen, Leiste anzeigen, speichern).

import { BLOCK } from './constants.js';

const STYLE = `
.xp-wrap {
  position: fixed; bottom: 60px; left: 50%; transform: translateX(-50%);
  z-index: 21; pointer-events: none; display: none;
}
.xp-bar {
  position: relative; width: 100%; height: 7px;
  background: #0b0f08; border: 1px solid #000;
  box-shadow: 0 0 0 1px rgba(255,255,255,0.08);
}
.xp-fill {
  position: absolute; top: 0; left: 0; bottom: 0; width: 0%;
  background: linear-gradient(#9bff45, #4fb016);
  box-shadow: 0 0 5px #8bef3a;
}
.xp-level {
  position: absolute; left: 50%; bottom: 3px; transform: translateX(-50%);
  font-family: 'Courier New', monospace; font-size: 18px; font-weight: bold;
  color: #86ff33; white-space: nowrap;
  text-shadow: 1px 0 #123400, -1px 0 #123400, 0 1px #123400, 0 -1px #123400,
    1px 1px #123400, -1px -1px #123400;
}
.xp-level.bump { animation: xpbump 0.4s ease-out; }
@keyframes xpbump {
  0%   { transform: translateX(-50%) scale(1); }
  35%  { transform: translateX(-50%) scale(1.7); color: #ffffff; }
  100% { transform: translateX(-50%) scale(1); }
}
`;

// XP-Ausbeute pro Mob-Typ [min, max]. Passive Tiere wenig, Monster mehr,
// Dorfbewohner nichts (kein Anreiz, sie umzubringen). Boss separat.
const MOB_XP = {
  pig: [1, 3], sheep: [1, 3], chicken: [1, 3], fish: [1, 3], cow: [1, 3],
  zombie: [5, 5], skeleton: [5, 5], creeper: [5, 5], slime: [1, 4],
  villager: [0, 0],
};
const BOSS_XP = 50;

// XP pro abgebautem Erz [min, max] — seltener = mehr.
const ORE_XP = {
  [BLOCK.COAL_ORE]: [1, 2],
  [BLOCK.IRON_ORE]: [1, 1],
  [BLOCK.GOLD_ORE]: [1, 1],
  [BLOCK.DIAMOND_ORE]: [3, 7],
  [BLOCK.EMERALD_ORE]: [3, 7],
  [BLOCK.SAPPHIRE_ORE]: [5, 9],
  [BLOCK.FLUX_ORE]: [1, 3],
};

function randInt(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }

export class Experience {
  constructor(ctx) {
    this.ctx = ctx;
    this.level = 0;
    this.xp = 0; // Punkte innerhalb der aktuellen Stufe (0 .. xpToNext(level))

    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    this.wrap = document.createElement('div');
    this.wrap.className = 'xp-wrap';
    this.barEl = document.createElement('div');
    this.barEl.className = 'xp-bar';
    this.fillEl = document.createElement('div');
    this.fillEl.className = 'xp-fill';
    this.levelEl = document.createElement('div');
    this.levelEl.className = 'xp-level';
    this.barEl.appendChild(this.fillEl);
    this.wrap.appendChild(this.barEl);
    this.wrap.appendChild(this.levelEl);
    document.body.appendChild(this.wrap);

    this.render();
  }

  // Minecraft-Levelkurve: benötigte XP für den Aufstieg von `level` → `level+1`.
  xpToNext(level) {
    if (level >= 30) return 112 + (level - 30) * 9;
    if (level >= 15) return 37 + (level - 15) * 5;
    return 7 + level * 2;
  }

  // Kernfunktion: XP gutschreiben, ggf. mehrere Stufen aufsteigen, Feedback geben.
  add(n) {
    if (!n || n <= 0) return;
    if (this.ctx.state.mode !== 'survival') return; // im Kreativ-/Spectator-Modus kein XP
    this.xp += n;
    let need = this.xpToNext(this.level);
    let stieg = false;
    while (this.xp >= need) {
      this.xp -= need;
      this.level++;
      stieg = true;
      need = this.xpToNext(this.level);
    }
    if (stieg) {
      this.ctx.sounds?.levelUp?.();
      this.ctx.ui?.toast?.('Level ' + this.level);
      // Zahl kurz aufpoppen lassen
      this.levelEl.classList.remove('bump');
      void this.levelEl.offsetWidth; // Reflow erzwingen, damit die Animation neu startet
      this.levelEl.classList.add('bump');
    } else {
      this.ctx.sounds?.xp?.();
    }
    this.render();
  }

  // XP-Wert für einen erlegten Mob (der Aufrufer entscheidet, wem sie zufällt).
  xpForMob(type, isBoss) {
    if (isBoss) return BOSS_XP;
    const r = MOB_XP[type];
    return r ? randInt(r[0], r[1]) : 0;
  }

  // XP fürs Abbauen eines Erzes (lokal beim Abbauenden aufgerufen).
  addForOre(blockId) {
    const r = ORE_XP[blockId];
    if (r) this.add(randInt(r[0], r[1]));
  }

  // Reicht das aktuelle Level für eine Ausgabe von `levels` Stufen? (z. B. Amboss)
  canAfford(levels) { return this.level >= levels; }

  // `levels` Stufen ausgeben. Der Fortschrittsbalken der aktuellen Stufe bleibt
  // erhalten, nur die Levelzahl sinkt. Gibt false zurück, wenn zu wenig da ist.
  spendLevels(levels) {
    if (levels <= 0) return true;
    if (this.level < levels) return false;
    this.level -= levels;
    this.render();
    return true;
  }

  render() {
    const need = this.xpToNext(this.level);
    const frac = need > 0 ? Math.max(0, Math.min(1, this.xp / need)) : 0;
    this.fillEl.style.width = (frac * 100).toFixed(1) + '%';
    this.levelEl.textContent = this.level > 0 ? String(this.level) : '';
  }

  update() {
    // nur im Überlebensmodus sichtbar (wie die Gesundheits-/Hungerleisten)
    const show = this.ctx.state.mode === 'survival';
    if (this._shown !== show) {
      this._shown = show;
      this.wrap.style.display = show ? 'block' : 'none';
    }
    // Breite an die Hotbar angleichen, sobald sie gemessen werden kann
    if (show && !this._widthSet) {
      const hb = this.ctx.inventory?.hotbarEl;
      if (hb && hb.offsetWidth > 10) { this.wrap.style.width = hb.offsetWidth + 'px'; this._widthSet = true; }
    }
  }

  serialize() { return { level: this.level, xp: this.xp }; }

  restore(d) {
    if (!d) return;
    this.level = Math.max(0, d.level | 0);
    this.xp = Math.max(0, d.xp | 0);
    this.render();
  }
}
