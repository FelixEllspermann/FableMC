// Washer: reinigt Dirty Flux mit Wasser zu Flux-Staub. Pro Block ein Zustand
// (Eingabe, Wasser, Ausgabe). Host-autoritativ, Zustand wird per Netz geteilt
// (wie Braustand/Truhe) — im Mehrspieler sehen alle dasselbe.

import { BLOCK, ITEM, stackSizeOf } from './constants.js';

const WASH_TIME = 3; // Sekunden pro Dirty Flux

export class Washer {
  constructor(ctx) {
    this.ctx = ctx;
    this.map = new Map(); // "x,y,z" -> { input, water, output, progress }
  }

  key(x, y, z) { return x + ',' + y + ',' + z; }

  get(x, y, z) {
    const k = this.key(x, y, z);
    let w = this.map.get(k);
    if (!w) { w = { input: null, water: null, output: null, progress: 0 }; this.map.set(k, w); }
    return w;
  }

  // waschbereit? Dirty Flux + Wassereimer (bleibt, wird nicht verbraucht) + Platz in der Ausgabe
  _canWash(w) {
    if (!w.input || w.input.id !== ITEM.DIRTY_FLUX || w.input.count < 1) return false;
    if (!w.water || w.water.id !== ITEM.WATER_BUCKET) return false;
    if (w.output && (w.output.id !== BLOCK.REDSTONE_DUST || w.output.count >= stackSizeOf(BLOCK.REDSTONE_DUST))) return false;
    return true;
  }

  update(dt) {
    const net = this.ctx.net;
    if (net?.active && !net.isHost) return; // Gäste bekommen den Zustand vom Host
    for (const [k, w] of this.map) {
      if (this._canWash(w)) {
        w.progress += dt;
        w._netTimer = (w._netTimer || 0) + dt;
        if (w.progress >= WASH_TIME) {
          w.progress = 0;
          w.input.count--; if (w.input.count <= 0) w.input = null;
          if (w.output) w.output.count++;
          else w.output = { id: BLOCK.REDSTONE_DUST, count: 1 };
          w._dirtyUI = true;
          this.ctx.sounds?.pickup?.();
          this._broadcast(k, w);
        } else if (w._netTimer >= 1) { w._netTimer = 0; this._broadcast(k, w); }
      } else if (w.progress !== 0) { w.progress = 0; w._dirtyUI = true; this._broadcast(k, w); }
    }
  }

  _broadcast(k, w) {
    this.ctx.net?.sendWash(k, { input: w.input, water: w.water, output: w.output, progress: w.progress });
  }

  onBlockChanged(x, y, z) {
    const k = this.key(x, y, z);
    const w = this.map.get(k);
    if (!w) return;
    if (this.ctx.world.getBlock(x, y, z) === BLOCK.WASHER) return;
    for (const slot of ['input', 'water', 'output']) {
      if (w[slot]) this.ctx.entities.spawnItemDrop(x + 0.5, y + 0.5, z + 0.5, w[slot]);
    }
    this.map.delete(k);
  }

  serialize() {
    const out = [];
    for (const [k, w] of this.map) if (w.input || w.water || w.output) {
      out.push([k, { input: w.input, water: w.water, output: w.output, progress: w.progress }]);
    }
    return out;
  }

  restore(data) {
    if (!Array.isArray(data)) return;
    for (const [k, w] of data) {
      this.map.set(k, { input: w.input || null, water: w.water || null, output: w.output || null, progress: w.progress || 0 });
    }
  }
}
