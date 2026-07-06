// Pflanzenwelt: Laub-Zerfall (Blätter brauchen einen Stamm in Reichweite),
// Setzlinge, die zu Bäumen wachsen, und Knochenmehl als Dünger.

import {
  BLOCK, BLOCKS, WORLD_HEIGHT, isLeafId, isLogId, isSaplingId, isWaterId,
} from './constants.js';

const DECAY_RANGE = 4;        // maximale Blatt-Distanz zum nächsten Stamm (BFS durch Laub)
const CHECKS_PER_FRAME = 40;  // Budget, damit große Zerfallswellen nicht ruckeln
const SAPLING_TICK = 4;       // Sekunden zwischen Wachstums-Würfen
const GROW_CHANCE = 0.12;     // Chance pro Tick und Setzling (⌀ ~35 s bis zum Baum)
const FARM_TICK = 2.5;        // Sekunden zwischen Feld-Ticks (Nässe + Feldfrucht-Wachstum)
const FARM_RANGE = 18;        // Radius (x/z) um den Spieler, in dem Felder simuliert werden
// Dauer EINER Wachstumsphase (Stufe → nächste Stufe). Jede Pflanze würfelt pro Phase
// einen festen Wert aus der passenden Spanne: nass 3–6 min, trocken 10–15 min.
const GROW_WET_MIN = 180, GROW_WET_MAX = 360;   // nass: 3–6 Minuten pro Phase
const GROW_DRY_MIN = 600, GROW_DRY_MAX = 900;   // trocken: 10–15 Minuten pro Phase
const CANE_GROW_MIN = 240, CANE_GROW_MAX = 480; // Zuckerrohr: 4–8 Minuten je Block (langsam)
const CROP_SWEEP_EVERY = 8;   // alle N Feld-Ticks verwaiste Fortschritts-Einträge aufräumen

export class Flora {
  constructor(ctx) {
    this.ctx = ctx;
    this.decayQueue = new Map();   // "x,y,z" → Zeitpunkt (state.time-unabhängig: eigene Uhr)
    this.placedLeaves = new Set(); // vom Spieler platziertes Laub zerfällt nie
    this.saplings = new Set();     // registrierte Setzlinge (nur die können wachsen)
    this.clock = 0;
    this._saplingTimer = 0;
    this._farmTimer = 0;
    this.cropProgress = new Map(); // "x,y,z" → { prog: 0..1, f: 0..1 } Wachstumsfortschritt je Feldfrucht
    this.caneProgress = new Map(); // "x,y,z" → { prog, f } Wachstumsfortschritt je Zuckerrohr-Spitze
    this._cropSweep = 0;
  }

  // ---- Ereignisse ----

  // Ein Block hat sich geändert: betroffenes Laub zum Zerfalls-Check vormerken.
  // Verschwindet ein Stamm oder Laub, wird die volle Halte-Reichweite gescannt —
  // nur Nachbar-Checks würden Blätter übersehen, deren Nachbarn noch gehalten werden.
  notify(x, y, z, oldId = 0) {
    const w = this.ctx.world;
    const cur = w.getBlock(x, y, z);
    if (!isLeafId(cur)) this.placedLeaves.delete(x + ',' + y + ',' + z);
    if (!isSaplingId(cur)) this.saplings.delete(x + ',' + y + ',' + z);
    const r = (isLogId(oldId) || isLeafId(oldId)) ? DECAY_RANGE + 1 : 1;
    for (let dy = -r; dy <= r; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > r + 1) continue;
          const nx = x + dx, ny = y + dy, nz = z + dz;
          if (!isLeafId(w.getBlock(nx, ny, nz))) continue;
          const key = nx + ',' + ny + ',' + nz;
          if (!this.decayQueue.has(key) && !this.placedLeaves.has(key)) {
            this.decayQueue.set(key, this.clock + 0.35 + Math.random() * 0.9);
          }
        }
      }
    }
  }

  markPlaced(x, y, z) { this.placedLeaves.add(x + ',' + y + ',' + z); }
  addSapling(x, y, z) { this.saplings.add(x + ',' + y + ',' + z); }

  // ---- pro Frame ----

  update(dt) {
    this.clock += dt;
    this._decayTick();
    this._saplingTimer += dt;
    if (this._saplingTimer >= SAPLING_TICK) {
      this._saplingTimer = 0;
      this._saplingTick();
    }
    this._farmTimer += dt;
    if (this._farmTimer >= FARM_TICK) {
      this._farmTimer = 0;
      this._farmTick();
    }
    // Ambiente: ab und zu segeln kleine Blätter aus natürlichem Laub
    this._leafTimer = (this._leafTimer || 0) + dt;
    if (this._leafTimer >= 0.2) {
      this._leafTimer = 0;
      this._leafParticles();
    }
    // Kristalle glitzern: Registry-Scan 1×/s, Funkel-Partikel im Takt
    this._kristallScan = (this._kristallScan || 0) + dt;
    if (this._kristallScan >= 1) {
      this._kristallScan = 0;
      this._kristalle = [];
      const w = this.ctx.world;
      const p = this.ctx.player?.pos;
      if (p) {
        const px = Math.floor(p.x), py = Math.floor(p.y), pz = Math.floor(p.z);
        außen: for (let x = px - 14; x <= px + 14; x++) {
          for (let z = pz - 14; z <= pz + 14; z++) {
            for (let y = Math.max(1, py - 10); y <= py + 12; y++) {
              const id = w.getBlock(x, y, z);
              if (BLOCKS[id]?.crystal) {
                this._kristalle.push([x, y, z, id]);
                if (this._kristalle.length >= 40) break außen;
              }
            }
          }
        }
      }
    }
    this._glitzerT = (this._glitzerT || 0) + dt;
    if (this._glitzerT >= 0.18 && this._kristalle?.length) {
      this._glitzerT = 0;
      const FARBE = {
        [BLOCK.CRYSTAL_BLUE]: [0.45, 0.75, 1], [BLOCK.CRYSTAL_PURPLE]: [0.75, 0.5, 1],
        [BLOCK.CRYSTAL_GREEN]: [0.45, 1, 0.65], [BLOCK.CRYSTAL_ORANGE]: [1, 0.75, 0.45],
      };
      const [x, y, z, id] = this._kristalle[(Math.random() * this._kristalle.length) | 0];
      const [r, g2, b] = Math.random() < 0.4 ? [1, 1, 1] : FARBE[id];
      this.ctx.furnaces?.dot(x + Math.random(), y + Math.random(), z + Math.random(), {
        vx: (Math.random() - 0.5) * 0.3,
        vy: 0.15 + Math.random() * 0.35,
        vz: (Math.random() - 0.5) * 0.3,
        life: 0.35 + Math.random() * 0.3,
        r, g: g2, b,
      });
    }
  }

  // zufällige Laubkronen in Spielernähe finden und Blatt-Partikel fallen lassen
  _leafParticles() {
    const w = this.ctx.world;
    const p = this.ctx.player?.pos;
    const fx = this.ctx.furnaces;
    if (!p || !fx) return;
    for (let versuch = 0; versuch < 9; versuch++) {
      const x = Math.floor(p.x + (Math.random() - 0.5) * 40);
      const z = Math.floor(p.z + (Math.random() - 0.5) * 40);
      const top = w.surfaceY(x, z);
      if (top < 1) continue;
      // von der Kronenoberkante abwärts zur Kronen-UNTERSEITE durchsteigen
      for (let y = top; y > top - 10 && y > 1; y--) {
        const id = w.getBlock(x, y, z);
        if (!isLeafId(id)) {
          if (id !== BLOCK.AIR) break; // Stamm/Boden erreicht: Säule verwerfen
          continue;
        }
        if (w.getBlock(x, y - 1, z) !== BLOCK.AIR) continue; // noch im Kroneninneren
        if (this.placedLeaves.has(x + ',' + y + ',' + z)) break; // nur natürliches Laub
        if (Math.random() < 0.5) {
          const g = 0.45 + Math.random() * 0.25;
          fx.dot(x + 0.15 + Math.random() * 0.7, y - 0.05, z + 0.15 + Math.random() * 0.7, {
            vx: (Math.random() - 0.5) * 0.5,
            vy: -(0.6 + Math.random() * 0.5),
            vz: (Math.random() - 0.5) * 0.5,
            life: 1.4 + Math.random() * 1.4,
            r: 0.2 + Math.random() * 0.1, g, b: 0.15,
          });
        }
        break;
      }
    }
  }

  _decayTick() {
    if (this.decayQueue.size === 0) return;
    const w = this.ctx.world;
    let done = 0;
    for (const [key, when] of this.decayQueue) {
      if (done >= CHECKS_PER_FRAME) break;
      if (when > this.clock) continue;
      this.decayQueue.delete(key);
      done++;
      const [x, y, z] = key.split(',').map(Number);
      const id = w.getBlock(x, y, z);
      if (!isLeafId(id) || this.placedLeaves.has(key)) continue;
      if (this._hasLogNearby(x, y, z)) continue;
      // Zerfall: Block entfernen (stößt über onBlockEdit die Nachbar-Blätter an) + Drops
      w.setBlock(x, y, z, BLOCK.AIR);
      this.dropLeafLoot(id, x, y, z);
    }
  }

  // BFS durch zusammenhängendes Laub: gibt es in ≤ DECAY_RANGE Schritten einen Stamm?
  _hasLogNearby(x, y, z) {
    const w = this.ctx.world;
    const seen = new Set([x + ',' + y + ',' + z]);
    let frontier = [[x, y, z]];
    for (let depth = 0; depth < DECAY_RANGE; depth++) {
      const next = [];
      for (const [cx, cy, cz] of frontier) {
        for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
          const nx = cx + dx, ny = cy + dy, nz = cz + dz;
          const key = nx + ',' + ny + ',' + nz;
          if (seen.has(key)) continue;
          seen.add(key);
          const id = w.getBlock(nx, ny, nz);
          if (id === -1) return true;          // Chunk nicht geladen: lieber stehen lassen
          if (isLogId(id)) return true;
          if (isLeafId(id)) next.push([nx, ny, nz]);
        }
      }
      frontier = next;
      if (frontier.length === 0) break;
    }
    return false;
  }

  // Drop-Tabelle eines Laubblocks auswürfeln (auch beim manuellen Abbau genutzt)
  dropLeafLoot(id, x, y, z) {
    const table = BLOCKS[id]?.dropTable;
    if (!table) return;
    for (const { id: dropId, chance } of table) {
      if (Math.random() < chance) {
        this.ctx.entities.spawnItemDrop(x + 0.5, y + 0.5, z + 0.5, dropId, 1);
      }
    }
  }

  // ---- Felder (nur der Host simuliert; Änderungen werden per net.sendEdits verteilt) ----

  _farmTick() {
    if (this.ctx.net?.active && !this.ctx.net.isHost) return; // Gäste warten auf Host-Edits
    const w = this.ctx.world;
    const p = this.ctx.player?.pos;
    if (!p) return;
    const px = Math.floor(p.x), py = Math.floor(p.y), pz = Math.floor(p.z);
    const R = FARM_RANGE;
    let nassBudget = 48; // begrenzt Nässe-Umschaltungen pro Tick (verhindert Ruckler bei Riesenfeldern)
    for (let x = px - R; x <= px + R; x++) {
      for (let z = pz - R; z <= pz + R; z++) {
        for (let y = Math.max(1, py - 7); y <= py + 6; y++) {
          const id = w.getBlock(x, y, z);
          const def = BLOCKS[id];
          if (!def) continue;
          if (def.farmland) {
            const nass = this._wasserNah(x, y, z);
            if (nass && !def.wet && nassBudget > 0) { this._edit(x, y, z, BLOCK.FARMLAND_WET); nassBudget--; }
            else if (!nass && def.wet && nassBudget > 0) { this._edit(x, y, z, BLOCK.FARMLAND); nassBudget--; }
          } else if (def.crop && def.crop.next) {
            // Fortschritt sammeln: pro Phase eine feste, gewürfelte Dauer (f = Perzentil in der
            // Spanne). Nass/trocken wählt die Spanne — ändert sich die Nässe, wechselt das Tempo
            // beim selben Perzentil, sodass die Phase garantiert im Zielbereich bleibt.
            const key = x + ',' + y + ',' + z;
            const feucht = !!BLOCKS[w.getBlock(x, y - 1, z)]?.wet;
            let e = this.cropProgress.get(key);
            if (!e) { e = { prog: 0, f: Math.random() }; this.cropProgress.set(key, e); }
            const dauer = feucht
              ? GROW_WET_MIN + (GROW_WET_MAX - GROW_WET_MIN) * e.f
              : GROW_DRY_MIN + (GROW_DRY_MAX - GROW_DRY_MIN) * e.f;
            e.prog += FARM_TICK / dauer;
            if (e.prog >= 1) {
              this._edit(x, y, z, def.crop.next);
              e.prog = 0; e.f = Math.random(); // nächste Phase neu würfeln
            }
          } else if (id === BLOCK.SUGAR_CANE && w.getBlock(x, y + 1, z) === BLOCK.AIR) {
            // Zuckerrohr wächst langsam nach oben — nur die oberste Spitze, höchstens 3 hoch.
            let h = 1;
            while (w.getBlock(x, y - h, z) === BLOCK.SUGAR_CANE) h++;
            if (h < 3) {
              const key = x + ',' + y + ',' + z;
              let e = this.caneProgress.get(key);
              if (!e) { e = { prog: 0, f: Math.random() }; this.caneProgress.set(key, e); }
              e.prog += FARM_TICK / (CANE_GROW_MIN + (CANE_GROW_MAX - CANE_GROW_MIN) * e.f);
              if (e.prog >= 1) { this._edit(x, y + 1, z, BLOCK.SUGAR_CANE); this.caneProgress.delete(key); }
            }
          }
        }
      }
    }
    // Verwaiste Fortschritts-Einträge (geerntet/zerstört/reif) periodisch entfernen
    if (++this._cropSweep >= CROP_SWEEP_EVERY) {
      this._cropSweep = 0;
      for (const key of this.cropProgress.keys()) {
        const [cx, cy, cz] = key.split(',').map(Number);
        const cid = w.getBlock(cx, cy, cz);
        if (cid === -1) continue; // Chunk nicht geladen: Eintrag behalten
        if (!BLOCKS[cid]?.crop?.next) this.cropProgress.delete(key);
      }
      // Zuckerrohr: Einträge entfernen, deren Spitze weg/geerntet/schon gewachsen ist
      for (const key of this.caneProgress.keys()) {
        const [cx, cy, cz] = key.split(',').map(Number);
        const cid = w.getBlock(cx, cy, cz);
        if (cid === -1) continue; // Chunk nicht geladen: Eintrag behalten
        if (cid !== BLOCK.SUGAR_CANE || w.getBlock(cx, cy + 1, cz) !== BLOCK.AIR) this.caneProgress.delete(key);
      }
    }
  }

  // Wasser (still oder fließend) in ±4 Feldern, auf gleicher Höhe oder eine darüber?
  _wasserNah(x, y, z) {
    const w = this.ctx.world;
    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -4; dz <= 4; dz++) {
        for (let dy = 0; dy <= 1; dy++) {
          if (isWaterId(w.getBlock(x + dx, y + dy, z + dz))) return true;
        }
      }
    }
    return false;
  }

  // Feld-Block setzen und (im MP) an alle Mitspieler spiegeln
  _edit(x, y, z, id) {
    this.ctx.world.setBlock(x, y, z, id);
    this.ctx.net?.sendEdits([[x, y, z, id]]);
  }

  // ---- Setzlinge ----

  _saplingTick() {
    if (this.saplings.size === 0) return;
    const w = this.ctx.world;
    const p = this.ctx.player?.pos;
    for (const key of [...this.saplings]) {
      const [x, y, z] = key.split(',').map(Number);
      const id = w.getBlock(x, y, z);
      if (!isSaplingId(id)) { this.saplings.delete(key); continue; }
      if (p && (Math.abs(x - p.x) > 64 || Math.abs(z - p.z) > 64)) continue; // nur in Spielernähe
      if (Math.random() < GROW_CHANCE) this.growSapling(x, y, z);
    }
  }

  // Setzling → Baum (true, wenn gewachsen). Braucht freien Platz über dem Stamm.
  growSapling(x, y, z) {
    const w = this.ctx.world;
    const id = w.getBlock(x, y, z);
    const type = BLOCKS[id]?.sapling;
    if (!type) return false;
    const h = type === 'spruce' ? 6 + Math.floor(Math.random() * 3)
      : 4 + Math.floor(Math.random() * 3);
    if (y + h + 2 >= WORLD_HEIGHT) return false;
    // Stammspur muss frei sein (Setzling selbst zählt nicht)
    for (let i = 1; i <= h + 1; i++) {
      const cur = w.getBlock(x, y + i, z);
      if (cur !== BLOCK.AIR && !(cur > 0 && BLOCKS[cur]?.cross)) return false;
    }
    this.saplings.delete(x + ',' + y + ',' + z);
    this._buildTree(x, y - 1, z, type, h); // wächst ab dem Boden unter dem Setzling
    return true;
  }

  // Baumformen wie in der Weltgenerierung (worldgen.writeTree), aber via setBlock
  _buildTree(x, surf, z, type, h) {
    const w = this.ctx.world;
    const topY = surf + h;
    const gesendet = [];
    const put = (wx, wy, wz, id, onlyAir) => {
      if (wy < 0 || wy >= WORLD_HEIGHT) return;
      const cur = w.getBlock(wx, wy, wz);
      if (onlyAir && cur !== BLOCK.AIR && !(cur > 0 && BLOCKS[cur]?.cross)) return;
      w.setBlock(wx, wy, wz, id);
      gesendet.push([wx, wy, wz, id]);
    };
    // am Ende gesammelt an Mitspieler schicken (siehe unten)
    Promise.resolve().then(() => this.ctx.net?.sendEdits(gesendet));
    const ring = (yy, r, id, skipCorners) => {
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (dx === 0 && dz === 0) continue;
        if (skipCorners && Math.abs(dx) === r && Math.abs(dz) === r) continue;
        put(x + dx, yy, z + dz, id, true);
      }
    };
    if (type === 'spruce') {
      for (let yy = surf + 3; yy <= topY; yy++) {
        const k = topY - yy;
        ring(yy, k % 2 === 1 ? 2 : 1, BLOCK.SPRUCE_LEAVES, true);
      }
      ring(topY + 1, 1, BLOCK.SPRUCE_LEAVES, true);
      put(x, topY + 1, z, BLOCK.SPRUCE_LEAVES, true);
      put(x, topY + 2, z, BLOCK.SPRUCE_LEAVES, true);
      for (let yy = surf + 1; yy <= topY; yy++) put(x, yy, z, BLOCK.SPRUCE_LOG, false);
    } else {
      const logId = type === 'birch' ? BLOCK.BIRCH_LOG : BLOCK.LOG;
      const leafId = type === 'birch' ? BLOCK.BIRCH_LEAVES : BLOCK.LEAVES;
      for (let yy = topY - 1; yy <= topY; yy++) ring(yy, 2, leafId, true);
      ring(topY + 1, 1, leafId, true);
      put(x, topY + 1, z, leafId, true);
      put(x, topY + 2, z, leafId, true);
      for (let yy = surf + 1; yy <= topY; yy++) put(x, yy, z, logId, false);
    }
  }

  // Knochenmehl auf einen Setzling: sofortiger Wachstumsversuch (45% Chance)
  bonemeal(x, y, z) {
    if (!isSaplingId(this.ctx.world.getBlock(x, y, z))) return false;
    this.ctx.furnaces?.burst(x + 0.5, y + 0.5, z + 0.5, 14, { r: 0.55, g: 0.95, b: 0.5 });
    if (Math.random() < 0.45) this.growSapling(x, y, z);
    return true; // Knochenmehl wird immer verbraucht
  }

  // ---- Persistenz ----

  serialize() {
    return {
      placedLeaves: [...this.placedLeaves],
      saplings: [...this.saplings],
      // Feldfrucht- + Zuckerrohr-Fortschritt sichern, damit lange Phasen einen Neustart überstehen
      cropProgress: [...this.cropProgress].map(([k, e]) => [k, e.prog, e.f]),
      caneProgress: [...this.caneProgress].map(([k, e]) => [k, e.prog, e.f]),
    };
  }

  restore(data) {
    if (!data) return;
    this.placedLeaves = new Set(data.placedLeaves || []);
    this.saplings = new Set(data.saplings || []);
    this.cropProgress = new Map((data.cropProgress || []).map(([k, prog, f]) => [k, { prog, f }]));
    this.caneProgress = new Map((data.caneProgress || []).map(([k, prog, f]) => [k, { prog, f }]));
  }
}
