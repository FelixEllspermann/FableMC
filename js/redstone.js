// Rudimentäres Redstone: Leitung (Redstone), Hebel, Knopf, Kolben.
// Host-autoritativer, periodischer Scan um die Spieler herum. Alle Block-Änderungen
// laufen über net.sendEdits — im Mehrspieler sehen also alle dasselbe.

import { BLOCK, BLOCKS, PISTON_DELTA } from './constants.js';

const TICK = 0.1;        // Sekunden zwischen Redstone-Updates
const R = 12, RY = 6;    // Scan-Radius um jeden Spieler (x/z, y)
const BUTTON_TIME = 1.5; // Knopf bleibt so lange gedrückt
const NB6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

export class Redstone {
  constructor(ctx) {
    this.ctx = ctx;
    this._t = 0;
    this.buttonTimers = new Map(); // "x,y,z" -> Restsekunden
  }

  update(dt) {
    const net = this.ctx.net;
    if (net?.active && !net.isHost) return; // Gäste bekommen die Edits vom Host
    this._t += dt;
    if (this._t < TICK) return;
    const step = this._t; this._t = 0;
    this._buttons(step);
    this._recompute();
  }

  // gedrückte Knöpfe nach kurzer Zeit zurückstellen
  _buttons(dt) {
    const w = this.ctx.world;
    for (const [k, t] of this.buttonTimers) {
      const nt = t - dt;
      if (nt <= 0) {
        const [x, y, z] = k.split(',').map(Number);
        if (w.getBlock(x, y, z) === BLOCK.BUTTON_ON) this._set(x, y, z, BLOCK.BUTTON);
        this.buttonTimers.delete(k);
      } else this.buttonTimers.set(k, nt);
    }
  }

  _set(x, y, z, id) {
    this.ctx.world.setBlock(x, y, z, id);
    this.ctx.net?.sendEdits([[x, y, z, id]]);
  }

  _anchors() {
    const list = [this.ctx.player.pos];
    const net = this.ctx.net;
    if (net?.active && net.isHost) for (const r of net.remote.values()) list.push(r.mesh.position);
    return list;
  }

  _recompute() {
    const w = this.ctx.world;
    const dust = new Set();     // "x,y,z" mit Redstone-Leitung
    const sources = new Set();  // "x,y,z" mit aktiver Quelle (Hebel/Knopf an)
    const pistons = [];         // {x,y,z,dir}
    const seen = new Set();
    for (const p of this._anchors()) {
      const px = Math.floor(p.x), py = Math.floor(p.y), pz = Math.floor(p.z);
      for (let x = px - R; x <= px + R; x++) {
        for (let z = pz - R; z <= pz + R; z++) {
          for (let y = Math.max(1, py - RY); y <= py + RY; y++) {
            const k = x + ',' + y + ',' + z;
            if (seen.has(k)) continue; seen.add(k);
            const def = BLOCKS[w.getBlock(x, y, z)];
            if (!def) continue;
            if (def.fluxSource) { sources.add(k); continue; } // Flux-Block: dauerhafte Quelle
            const rs = def.redstone;
            if (!rs) continue;
            if (rs === 'dust') dust.add(k);
            else if (rs === 'piston') pistons.push({ x, y, z, dir: def.pistonDir, sticky: !!def.sticky });
            else if ((rs === 'lever' || rs === 'button') && def.on) {
              sources.add(k);
              if (rs === 'button' && !this.buttonTimers.has(k)) this.buttonTimers.set(k, BUTTON_TIME);
            }
          }
        }
      }
    }
    if (!dust.size && !pistons.length) return;

    // Leistung durch die (flache) Leitung ausbreiten: BFS, 15 an einer Quelle, -1 pro Schritt
    const power = new Map();
    const q = [];
    for (const k of dust) {
      const [x, y, z] = k.split(',').map(Number);
      if (this._nearSource(x, y, z, sources)) { power.set(k, 15); q.push([x, y, z, 15]); }
      else power.set(k, 0);
    }
    while (q.length) {
      const [x, y, z, pw] = q.shift();
      if (pw <= 1) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nk = (x + dx) + ',' + y + ',' + (z + dz);
        if (dust.has(nk) && (power.get(nk) || 0) < pw - 1) {
          power.set(nk, pw - 1); q.push([x + dx, y, z + dz, pw - 1]);
        }
      }
    }

    // Leitung an/aus (nur bei Wechsel → kein Edit-Spam)
    for (const [k, pw] of power) {
      const [x, y, z] = k.split(',').map(Number);
      const id = w.getBlock(x, y, z);
      if (pw > 0 && id === BLOCK.REDSTONE_DUST) this._set(x, y, z, BLOCK.REDSTONE_DUST_ON);
      else if (pw === 0 && id === BLOCK.REDSTONE_DUST_ON) this._set(x, y, z, BLOCK.REDSTONE_DUST);
    }

    // Kolben aus-/einfahren
    for (const pst of pistons) {
      const powered = this._blockPowered(pst.x, pst.y, pst.z, sources, power);
      const [dx, dy, dz] = PISTON_DELTA[pst.dir];
      const fx = pst.x + dx, fy = pst.y + dy, fz = pst.z + dz;
      const extended = w.getBlock(fx, fy, fz) === BLOCK.PISTON_HEAD;
      if (powered && !extended) this._extend(fx, fy, fz, dx, dy, dz);
      else if (!powered && extended) this._retract(fx, fy, fz, dx, dy, dz, pst.sticky);
    }
  }

  // aktive Quelle unter den 6 Nachbarn?
  _nearSource(x, y, z, sources) {
    for (const [dx, dy, dz] of NB6) if (sources.has((x + dx) + ',' + (y + dy) + ',' + (z + dz))) return true;
    return false;
  }

  // Block bekommt Strom, wenn ein Nachbar Quelle ODER geladene Leitung ist
  _blockPowered(x, y, z, sources, power) {
    for (const [dx, dy, dz] of NB6) {
      const k = (x + dx) + ',' + (y + dy) + ',' + (z + dz);
      if (sources.has(k) || (power.get(k) || 0) > 0) return true;
    }
    return false;
  }

  // Kolben ausfahren: schiebt eine Kette von bis zu 16 Blöcken 1 nach vorn (Platz nötig)
  _extend(fx, fy, fz, dx, dy, dz) {
    const w = this.ctx.world;
    const MAX = 16;
    const chain = [];
    let cx = fx, cy = fy, cz = fz;
    while (true) {
      const b = w.getBlock(cx, cy, cz);
      if (b === BLOCK.AIR) break;      // Platz gefunden → schieben
      if (!this._pushable(b)) return;  // blockiert (auch bei -1 = ungeladen)
      chain.push({ x: cx, y: cy, z: cz, id: b });
      if (chain.length > MAX) return;  // Kette länger als 16 → nicht schieben
      cx += dx; cy += dy; cz += dz;
    }
    if (chain.length === 0) { this._set(fx, fy, fz, BLOCK.PISTON_HEAD); return; } // Front war Luft
    for (let i = chain.length - 1; i >= 0; i--) { // von hinten nach vorne verschieben
      const c = chain[i];
      this._set(c.x + dx, c.y + dy, c.z + dz, c.id);
    }
    this._set(fx, fy, fz, BLOCK.PISTON_HEAD); // geräumte Front wird zum Arm
  }

  // Kolben einfahren: Arm weg; klebriger Kolben zieht den Block vor dem Arm mit zurück
  _retract(fx, fy, fz, dx, dy, dz, sticky) {
    const w = this.ctx.world;
    this._set(fx, fy, fz, BLOCK.AIR);
    if (sticky) {
      const bx = fx + dx, by = fy + dy, bz = fz + dz;
      const b = w.getBlock(bx, by, bz);
      if (this._pushable(b)) {
        this._set(bx, by, bz, BLOCK.AIR);
        this._set(fx, fy, fz, b); // an die Arm-Position ziehen
      }
    }
  }

  _pushable(id) {
    const def = BLOCKS[id];
    if (!def || def.opaque !== true || (def.hardness ?? 0) < 0) return false;
    if (def.redstone || def.spawner || def.bossSpawner || def.brewing || def.washer) return false;
    return id !== BLOCK.CHEST && id !== BLOCK.FURNACE && id !== BLOCK.FURNACE_ON;
  }
}
