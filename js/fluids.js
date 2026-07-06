// Minecraft-artige Fluid-Simulation (zellulärer Automat, schlafend bis gestört):
// Wasser: fließt nach unten, breitet sich 7 Blöcke horizontal aus (Pegel 7..1)
// Lava: gleiches Prinzip, langsamer, nur ~3 Blöcke weit (Pegel 6/4/2)
// Wasser + Lava => Stein (Quelle) / Bruchstein (fließend)

import {
  BLOCK, isSolid, isWaterId, isLavaId, fluidLevel, waterFlowId, lavaFlowId, BLOCKS,
} from './constants.js';

const WATER_TICK = 0.25;
const LAVA_TICK = 0.75;
const MAX_CELLS_PER_TICK = 500;

export class Fluids {
  constructor(ctx) {
    this.ctx = ctx;
    this.queueW = new Set();
    this.queueL = new Set();
    this._tw = 0;
    this._tl = 0;
  }

  // Ein Block bei (x,y,z) hat sich geändert: angrenzende Fluide aufwecken
  notify(x, y, z) {
    const w = this.ctx.world;
    for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const id = w.getBlock(x + dx, y + dy, z + dz);
      if (isWaterId(id)) this.queueW.add((x + dx) + ',' + (y + dy) + ',' + (z + dz));
      else if (isLavaId(id)) this.queueL.add((x + dx) + ',' + (y + dy) + ',' + (z + dz));
    }
  }

  update(dt) {
    this._tw += dt;
    if (this._tw >= WATER_TICK) { this._tw = 0; this._tick(this.queueW, true); }
    this._tl += dt;
    if (this._tl >= LAVA_TICK) { this._tl = 0; this._tick(this.queueL, false); }

    // Gischt- & Funken-Quellen in Spielernähe registrieren:
    // fließende Wasserzellen und offene Lava-Oberflächen
    this._gischtScan = (this._gischtScan || 0) + dt;
    if (this._gischtScan >= 1) {
      this._gischtScan = 0;
      this._gischtZellen = [];
      this._funkenZellen = [];
      const w = this.ctx.world;
      const p = this.ctx.player?.pos;
      if (p) {
        const px = Math.floor(p.x), py = Math.floor(p.y), pz = Math.floor(p.z);
        for (let x = px - 16; x <= px + 16; x++) {
          for (let z = pz - 16; z <= pz + 16; z++) {
            for (let y = Math.max(1, py - 10); y <= py + 10; y++) {
              const id = w.getBlock(x, y, z);
              if (id >= BLOCK.WATER_FLOW7 && id <= BLOCK.WATER_FLOW1 &&
                  this._gischtZellen.length < 60 &&
                  w.getBlock(x, y + 1, z) === BLOCK.AIR) {
                this._gischtZellen.push([x, y + fluidLevel(id) * 0.115, z]);
                break; // eine pro Säule reicht
              }
              if (isLavaId(id) && this._funkenZellen.length < 60 &&
                  w.getBlock(x, y + 1, z) === BLOCK.AIR) {
                this._funkenZellen.push([x, y + fluidLevel(id) * 0.115, z]);
                break;
              }
            }
          }
        }
      }
    }
    // … und regelmäßig weiße/hellblaue Tröpfchen darüber aufsteigen lassen
    this._gischtT = (this._gischtT || 0) + dt;
    if (this._gischtT >= 0.12 && this._gischtZellen?.length) {
      this._gischtT = 0;
      const fx = this.ctx.furnaces;
      for (let i = 0; i < 2; i++) {
        const [sx, sy, sz] = this._gischtZellen[(Math.random() * this._gischtZellen.length) | 0];
        const weiß = Math.random() < 0.5;
        fx?.dot(sx + Math.random(), sy + 0.12, sz + Math.random(), {
          vx: (Math.random() - 0.5) * 1.2,
          vy: 0.8 + Math.random() * 1.2,
          vz: (Math.random() - 0.5) * 1.2,
          life: 0.3 + Math.random() * 0.35,
          r: weiß ? 1 : 0.45, g: weiß ? 1 : 0.65, b: 1,
        });
      }
    }
    // Lava spuckt Funken: springen hoch und fallen im Bogen zurück
    this._funkenT = (this._funkenT || 0) + dt;
    if (this._funkenT >= 0.3 && this._funkenZellen?.length) {
      this._funkenT = 0;
      const fx = this.ctx.furnaces;
      const [sx, sy, sz] = this._funkenZellen[(Math.random() * this._funkenZellen.length) | 0];
      const glut = Math.random();
      fx?.dot(sx + 0.3 + Math.random() * 0.4, sy + 0.1, sz + 0.3 + Math.random() * 0.4, {
        vx: (Math.random() - 0.5) * 0.9,
        vy: 3 + Math.random() * 2.5,
        vz: (Math.random() - 0.5) * 0.9,
        grav: 7,
        life: 0.9 + Math.random() * 0.6,
        r: 1, g: glut < 0.3 ? 0.25 : glut < 0.7 ? 0.5 : 0.85, b: 0.05,
      });
    }
    // (Zuckerrohr-Wachstum läuft jetzt host-autoritativ in flora.js — synchron im MP)
  }

  _tick(queue, isWater) {
    if (queue.size === 0) return;
    const w = this.ctx.world;
    const p = this.ctx.player?.pos;
    const cells = [];
    for (const key of queue) {
      queue.delete(key);
      // Nur in Spielernähe simulieren (wie Minecraft-Chunk-Ticks): ferne Zellen
      // frieren mitten im Fluss ein und wachen erst wieder auf, wenn man sie stört.
      if (p) {
        const ci = key.indexOf(',');
        const x = Number(key.slice(0, ci));
        const z = Number(key.slice(key.lastIndexOf(',') + 1));
        if (Math.abs(x - p.x) > 64 || Math.abs(z - p.z) > 64) continue;
      }
      cells.push(key);
      if (cells.length >= MAX_CELLS_PER_TICK) break;
    }
    const requeue = (x, y, z) => queue.add(x + ',' + y + ',' + z);
    const fam = isWater ? isWaterId : isLavaId;
    const enemy = isWater ? isLavaId : isWaterId;
    const sourceId = isWater ? BLOCK.WATER : BLOCK.LAVA;
    const flowId = isWater ? waterFlowId : lavaFlowId;
    const drop = isWater ? 1 : 2;

    for (const key of cells) {
      const [x, y, z] = key.split(',').map(Number);
      const id = w.getBlock(x, y, z);
      if (!fam(id)) continue;
      const level = fluidLevel(id);
      // Wasserpflanzen (Seegras/Kelp) sind geflutete Quellzellen — nie neu berechnen
      const isSource = id === sourceId || !!BLOCKS[id]?.waterPlant;


      // Wasser trifft Lava (oder umgekehrt): Verfestigung
      let converted = false;
      for (const [dx, dy, dz] of [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
        const nid = w.getBlock(x + dx, y + dy, z + dz);
        if (enemy(nid)) {
          if (isWater) {
            // Lava-Zelle wird zu Stein/Bruchstein
            w.setBlock(x + dx, y + dy, z + dz, nid === BLOCK.LAVA ? BLOCK.STONE : BLOCK.COBBLESTONE);
          } else {
            // Lava-Zelle selbst verfestigt
            w.setBlock(x, y, z, isSource ? BLOCK.STONE : BLOCK.COBBLESTONE);
            converted = true;
          }
          break;
        }
      }
      if (converted) continue;

      // Fließende Zellen: Pegel aus Nachbarn neu herleiten (trocknet aus, wenn Quelle weg)
      if (!isSource) {
        const above = w.getBlock(x, y + 1, z);
        let support = 0;
        if (fam(above)) {
          support = 7;
        } else {
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nid = w.getBlock(x + dx, y, z + dz);
            if (fam(nid)) support = Math.max(support, fluidLevel(nid) - drop);
          }
        }
        // unendliche Wasserquelle: 2+ angrenzende Quellen auf festem Grund
        if (isWater && support > 0) {
          let sources = 0;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (w.getBlock(x + dx, y, z + dz) === BLOCK.WATER) sources++;
          }
          if (sources >= 2 && isSolid(w.getBlock(x, y - 1, z))) {
            w.setBlock(x, y, z, BLOCK.WATER);
            this._wakeAround(x, y, z, requeue);
            continue;
          }
        }
        if (support < 1) {
          w.setBlock(x, y, z, BLOCK.AIR);
          this._wakeAround(x, y, z, requeue);
          continue;
        }
        if (support !== level) {
          w.setBlock(x, y, z, flowId(support));
          this._wakeAround(x, y, z, requeue);
          continue;
        }
      }

      // nach unten fließen
      const below = w.getBlock(x, y - 1, z);
      const canFlowInto = (bid) => bid === BLOCK.AIR ||
        (bid > 0 && BLOCKS[bid]?.cross && !BLOCKS[bid]?.waterPlant) ||
        (fam(bid) && bid !== sourceId && !BLOCKS[bid]?.waterPlant && fluidLevel(bid) < 7);
      if (y > 1 && canFlowInto(below) && !fam(below)) {
        w.setBlock(x, y - 1, z, flowId(7));
        requeue(x, y - 1, z);
        requeue(x, y, z);
        continue;
      }
      // horizontal ausbreiten (nur wenn unten fest oder Fluid)
      const spread = level - drop;
      if (spread >= 1 && (isSolid(below) || fam(below))) {
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nid = w.getBlock(x + dx, y, z + dz);
          // Wasserpflanzen (Kelp/Seegras) NICHT überfluten — sonst frisst sich
          // fließendes Wasser durch den ganzen Kelpwald und der Chunk laggt.
          if (nid > 0 && BLOCKS[nid]?.waterPlant) continue;
          if (nid === BLOCK.AIR || (nid > 0 && BLOCKS[nid]?.cross) ||
              (fam(nid) && nid !== sourceId && fluidLevel(nid) < spread)) {
            w.setBlock(x + dx, y, z + dz, flowId(spread));
            requeue(x + dx, y, z + dz);
          }
        }
      }
    }
  }

  _wakeAround(x, y, z, requeue) {
    requeue(x, y, z);
    requeue(x + 1, y, z); requeue(x - 1, y, z);
    requeue(x, y + 1, z); requeue(x, y - 1, z);
    requeue(x, y, z + 1); requeue(x, y, z - 1);
  }
}
