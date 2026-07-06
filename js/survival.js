// Survival stats: health, hunger, air (drowning), death/respawn, damage feedback UI.

import { PLAYER, isWaterId, ITEMS, nameOf, BLOCKS, BLOCK } from './constants.js';
import { findSpawn } from './worldgen.js';
import { equipStats, damageItem, armorStats } from './equip.js';

const ARMOR_SLOTS = ['helmet', 'chest', 'legs', 'boots'];

const STYLE = `
.sv-bars {
  position: fixed; bottom: 74px; left: 50%; transform: translateX(-50%);
  width: 420px; display: flex; justify-content: space-between; z-index: 20;
  pointer-events: none; font-size: 16px; line-height: 1;
}
.sv-row { display: flex; gap: 1px; }
.sv-cell { position: relative; width: 18px; height: 18px; }
.sv-cell .base { position: absolute; inset: 0; filter: grayscale(1) brightness(0.45); }
.sv-cell .fill { position: absolute; top: 0; left: 0; bottom: 0; overflow: hidden; white-space: nowrap; }
.sv-air { position: fixed; bottom: 96px; left: 50%; transform: translateX(-50%);
  width: 420px; display: flex; justify-content: flex-end; gap: 1px; z-index: 20;
  pointer-events: none; font-size: 14px; }
.sv-vignette {
  position: fixed; inset: 0; z-index: 30; pointer-events: none; opacity: 0;
  box-shadow: inset 0 0 120px 60px rgba(200, 0, 0, 0.75);
  transition: opacity 0.4s ease-out;
}
.sv-death {
  position: fixed; inset: 0; z-index: 60; display: none;
  align-items: center; justify-content: center; flex-direction: column; gap: 24px;
  background: rgba(110, 0, 0, 0.45);
}
.sv-death.open { display: flex; }
.sv-death h1 { font-size: 44px; color: #fff; text-shadow: 3px 3px 0 #3f0000; }
.sv-death button {
  font-size: 20px; padding: 10px 36px; background: #6d6d6d; color: #fff;
  border: 2px solid; border-color: #a8a8a8 #2f2f2f #2f2f2f #a8a8a8;
}
.sv-death button:hover { background: #7f7f9d; }
`;

export class Survival {
  constructor(ctx) {
    this.ctx = ctx;
    this.health = 20;
    this.hunger = 20;
    this.air = 10;
    this.exhaustion = 0;
    this.regenTimer = 0;
    this.starveTimer = 0;
    this.drownTimer = 0;
    this.invuln = 0;
    this.god = false; // Moderator-Befehl /god: unverwundbar

    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    this.barsEl = document.createElement('div');
    this.barsEl.className = 'sv-bars';
    this.heartsEl = document.createElement('div');
    this.heartsEl.className = 'sv-row';
    this.hungerEl = document.createElement('div');
    this.hungerEl.className = 'sv-row';
    this.barsEl.appendChild(this.heartsEl);
    this.barsEl.appendChild(this.hungerEl);
    document.body.appendChild(this.barsEl);

    this.airEl = document.createElement('div');
    this.airEl.className = 'sv-air';
    document.body.appendChild(this.airEl);

    this.vignetteEl = document.createElement('div');
    this.vignetteEl.className = 'sv-vignette';
    document.body.appendChild(this.vignetteEl);

    this.deathEl = document.createElement('div');
    this.deathEl.className = 'sv-death';
    const h1 = document.createElement('h1');
    h1.textContent = 'Du bist gestorben';
    const btn = document.createElement('button');
    btn.textContent = 'Respawn';
    btn.addEventListener('click', () => this._respawn());
    this.deathEl.appendChild(h1);
    this.deathEl.appendChild(btn);
    document.body.appendChild(this.deathEl);

    this._buildCells(this.heartsEl, '❤️');
    this._buildCells(this.hungerEl, '🍗');
    this._buildCells(this.airEl, '🫧');
    this.render();
  }

  _buildCells(row, emoji) {
    for (let i = 0; i < 10; i++) {
      const cell = document.createElement('div');
      cell.className = 'sv-cell';
      const base = document.createElement('span');
      base.className = 'base';
      base.textContent = emoji;
      const fill = document.createElement('span');
      fill.className = 'fill';
      fill.textContent = emoji;
      cell.appendChild(base);
      cell.appendChild(fill);
      row.appendChild(cell);
    }
  }

  _setRow(row, value, reverse = false) { // value 0..20, half steps
    const cells = row.children;
    for (let i = 0; i < 10; i++) {
      // reverse: leftmost cell empties first (wie die MC-Hungerleiste)
      const slot = reverse ? 9 - i : i;
      const v = value - slot * 2; // 2 points per cell
      const fill = cells[i].lastChild;
      fill.style.width = v >= 2 ? '100%' : v >= 1 ? '50%' : '0';
    }
  }

  render() {
    this._setRow(this.heartsEl, this.health);
    this._setRow(this.hungerEl, this.hunger, true);
    const maxAir = this._maxAir || 10;
    this._setRow(this.airEl, (this.air / maxAir) * 20, true);
    this.airEl.style.display = this.air < maxAir ? 'flex' : 'none';
  }

  addExhaustion(v) {
    this.exhaustion += v;
  }

  // Summe der Dornen-Werte der getragenen Rüstung (Rückschaden für Angreifer)
  getThorns() {
    let t = 0;
    const armor = this.ctx.inventory?.armor;
    if (armor) for (const k of ARMOR_SLOTS) {
      if (armor[k]) t += equipStats(armor[k]).thorns;
    }
    return t;
  }

  damage(amount, cause = '') {
    if (this.ctx.state.mode !== 'survival') return; // Creative/Spectator: unverwundbar
    if (this.god) return;                            // /god: unverwundbar
    if (this.ctx.state.dead || amount <= 0) return;
    if (this.invuln > 0 && cause !== 'starve' && cause !== 'drown') return;
    // Rüstung: Schutzpunkte reduzieren den Schaden (4% pro Punkt, max 80%),
    // dafür verschleißt jedes getragene Teil
    const armor = this.ctx.inventory?.armor;
    if (armor && cause !== 'starve' && cause !== 'drown') {
      let def = 0;
      for (const k of ARMOR_SLOTS) {
        const p = armor[k];
        if (p) def += (ITEMS[p.id]?.armor?.defense || 0) + equipStats(p).defense;
      }
      if (def > 0) amount = Math.max(0.5, amount * (1 - Math.min(0.8, def * 0.04)));
      for (const k of ARMOR_SLOTS) {
        const p = armor[k];
        if (p && damageItem(p, 1)) {
          armor[k] = null;
          this.ctx.ui.toast(nameOf(p.id) + ' ist zerbrochen!');
        }
      }
    }
    // Heiltrank-Effekt: 50 % Schadensschutz, solange resist läuft
    if (this.ctx.player?.effects?.resist > 0) amount *= 0.5;
    this.invuln = 0.5;
    this.health = Math.max(0, this.health - amount);
    this.regenTimer = 0;      // Heil-Verzögerung startet nach Schaden neu
    this.regenPrimed = false;
    this.ctx.net?.sendHurt();  // Mitspieler sehen den Treffer-Blitz
    this.ctx.sounds.hurt();
    this.vignetteEl.style.transition = 'none';
    this.vignetteEl.style.opacity = '0.85';
    requestAnimationFrame(() => {
      this.vignetteEl.style.transition = 'opacity 0.4s ease-out';
      this.vignetteEl.style.opacity = '0';
    });
    this.render();
    if (this.health <= 0) this._die();
  }

  eat(food) {
    this.hunger = Math.min(20, this.hunger + food);
    this.ctx.sounds.eat();
    this.render();
  }

  // Sofort-Heilung (Heiltrank) — Herzen auffüllen, gedeckelt bei 20
  heal(n) {
    this.health = Math.min(20, this.health + n);
    this.render();
  }

  _die() {
    this.ctx.state.dead = true;
    this.ctx.net?.sendDead(); // Mitspieler sehen den Avatar umfallen + poof
    this.deathEl.classList.add('open');
    if (document.pointerLockElement) document.exitPointerLock();
  }

  _respawn() {
    // Bett-Spawnpunkt, sofern das Bett noch steht — sonst Welt-Spawn
    let spawn = null;
    const sp = this.ctx.player.spawnPoint;
    if (sp && BLOCKS[this.ctx.world.getBlock(sp.x, sp.y - 1, sp.z)]?.bed) {
      spawn = sp;
    } else {
      spawn = findSpawn(this.ctx.seed);
    }
    this.health = 20;
    this.hunger = 20;
    this.air = 10;
    this.exhaustion = 0;
    this.ctx.player.respawnAt(spawn.x, spawn.y, spawn.z);
    this.ctx.state.dead = false;
    this.ctx.net?.sendAlive(); // Mitspieler-Avatar wieder aufrichten
    this.deathEl.classList.remove('open');
    this.render();
    this.ctx.requestLock();
  }

  update(dt) {
    // Statusleisten nur im Überlebensmodus anzeigen
    const survivalMode = this.ctx.state.mode === 'survival';
    if (this._barsVisible !== survivalMode) {
      this._barsVisible = survivalMode;
      this.barsEl.style.display = survivalMode ? 'flex' : 'none';
      if (!survivalMode) this.airEl.style.display = 'none';
    }
    if (!survivalMode) {
      this.air = 10;
      return;
    }
    if (this.ctx.state.dead) return;
    this.invuln = Math.max(0, this.invuln - dt);

    // Lava-Kontakt
    if (this.ctx.player.inLava) {
      this.lavaTimer = (this.lavaTimer || 0) + dt;
      if (this.lavaTimer >= 0.5) {
        this.lavaTimer = 0;
        this.invuln = 0;
        this.damage(3, 'lava');
      }
    } else {
      this.lavaTimer = 0;
    }

    // drowning
    const p = this.ctx.player;
    const eyeBlock = this.ctx.world.getBlock(
      Math.floor(p.pos.x), Math.floor(p.pos.y + PLAYER.EYE_HEIGHT), Math.floor(p.pos.z)
    );
    const prevAir = this.air;
    // Gold-Helm-Upgrade: mehr Atemluft; Wasser-Schriftrolle: gar kein Luftverbrauch
    const maxAir = 10 + armorStats(this.ctx.inventory?.armor).airBonus;
    if (this.ctx.player.effects?.water > 0) {
      this.air = maxAir;
      this.drownTimer = 0;
    } else if (isWaterId(eyeBlock)) {
      this.air = Math.max(0, this.air - dt);
      if (this.air <= 0) {
        this.drownTimer += dt;
        if (this.drownTimer >= 1) {
          this.drownTimer = 0;
          this.damage(1, 'drown');
        }
      }
    } else {
      this.air = Math.min(maxAir, this.air + dt * 3);
      this.drownTimer = 0;
    }
    this._maxAir = maxAir;
    if (Math.ceil(prevAir * 2) !== Math.ceil(this.air * 2)) this.render();

    // Kaktus-Kontakt: Berührung sticht (leicht vergrößerte Spieler-Box gegen Kaktus-Boxen)
    this._cactusTimer = Math.max(0, (this._cactusTimer || 0) - dt);
    if (this._cactusTimer <= 0) {
      const p = this.ctx.player;
      const w = this.ctx.world;
      const h = p.width / 2 + 0.04;
      const minX = Math.floor(p.pos.x - h), maxX = Math.floor(p.pos.x + h);
      const minY = Math.floor(p.pos.y - 0.05), maxY = Math.floor(p.pos.y + p.height);
      const minZ = Math.floor(p.pos.z - h), maxZ = Math.floor(p.pos.z + h);
      außen: for (let by = minY; by <= maxY; by++) {
        for (let bz = minZ; bz <= maxZ; bz++) {
          for (let bx = minX; bx <= maxX; bx++) {
            if (w.getBlock(bx, by, bz) !== BLOCK.CACTUS) continue;
            // Kaktus-Box (1px eingerückt) gegen erweiterte Spieler-Box
            if (p.pos.x - h < bx + 0.9375 && p.pos.x + h > bx + 0.0625 &&
                p.pos.y - 0.05 < by + 1 && p.pos.y + p.height > by &&
                p.pos.z - h < bz + 0.9375 && p.pos.z + h > bz + 0.0625) {
              this.damage(1, 'cactus');
              this._cactusTimer = 0.7;
              break außen;
            }
          }
        }
      }
    }

    // hunger from exhaustion (+ slow passive drain)
    this.exhaustion += 0.015 * dt;
    if (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      if (this.hunger > 0) {
        this.hunger--;
        this.render();
      }
    }

    // Heilung: läuft, solange der Hunger ≥ 60% (12) ist, und kostet 1 Hunger
    // pro Herz (1:1). Erster Tick nach 1 s Verzögerung, danach alle 0,5 s.
    if (this.hunger >= 12 && this.health < 20) {
      this.regenTimer += dt;
      const wartezeit = this.regenPrimed ? 0.5 : 1.0;
      if (this.regenTimer >= wartezeit) {
        this.regenTimer = 0;
        this.regenPrimed = true;
        this.health = Math.min(20, this.health + 1);
        this.hunger = Math.max(0, this.hunger - 1);
        this.render();
      }
    } else {
      this.regenTimer = 0;
      this.regenPrimed = false;
    }

    // starvation (down to 1 HP)
    if (this.hunger <= 0) {
      this.starveTimer += dt;
      if (this.starveTimer >= 4) {
        this.starveTimer = 0;
        if (this.health > 1) this.damage(1, 'starve');
      }
    } else {
      this.starveTimer = 0;
    }
  }

  serialize() {
    return { health: this.health, hunger: this.hunger, air: this.air };
  }

  restore(data) {
    if (!data) return;
    this.health = data.health ?? 20;
    this.hunger = data.hunger ?? 20;
    this.air = data.air ?? 10;
    this.render();
  }
}
