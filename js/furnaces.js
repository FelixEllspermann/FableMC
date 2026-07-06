// Öfen mit persistentem Block-Zustand: schmelzen im Hintergrund weiter (UI zu),
// tauschen ihre Textur (FURNACE ↔ FURNACE_ON, leuchtet), speien Feuerpartikel
// und droppen ihren Inhalt beim Abbau.

import * as THREE from 'three';
import { BLOCK, SMELT, FUEL, stackSizeOf } from './constants.js';

const SMELT_TIME = 2; // Sekunden pro Vorgang
const MAX_PARTICLES = 200;
const MAX_HEARTS = 80;

export class Furnaces {
  constructor(ctx) {
    this.ctx = ctx;
    this.map = new Map(); // "x,y,z" -> {input, fuel, output, progress, fuelLeft}

    // Feuerpartikel (ein Points-System für alle Öfen)
    this.particles = [];
    this._pPos = new Float32Array(MAX_PARTICLES * 3).fill(-99999);
    this._pCol = new Float32Array(MAX_PARTICLES * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this._pPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this._pCol, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.12, vertexColors: true, transparent: true, opacity: 0.95, sizeAttenuation: true,
    }));
    this.points.frustumCulled = false;
    ctx.scene.add(this.points);

    // Herz-Partikel (Zucht) — eigenes Points-System mit Herz-Textur, damit es
    // echte Herzen statt Vierecke sind. Fire/Smoke bleiben unverändert.
    this.heartParticles = [];
    this._hPos = new Float32Array(MAX_HEARTS * 3).fill(-99999);
    const hgeo = new THREE.BufferGeometry();
    hgeo.setAttribute('position', new THREE.BufferAttribute(this._hPos, 3));
    this.heartPoints = new THREE.Points(hgeo, new THREE.PointsMaterial({
      map: this._makeHeartTexture(), size: 0.5, transparent: true, alphaTest: 0.5,
      depthWrite: false, sizeAttenuation: true,
    }));
    this.heartPoints.frustumCulled = false;
    // nach dem (transparenten) Wasser zeichnen (renderOrder 1), sonst malt das Wasser
    // die Herzen zu → sie würden „hinter dem Wasser" erscheinen
    this.heartPoints.renderOrder = 2;
    ctx.scene.add(this.heartPoints);
  }

  // Pixel-Herz auf ein Canvas malen (passend zum Pixel-Look des Spiels)
  _makeHeartTexture() {
    const HEART = [
      '00000000', '01100110', '11111111', '11111111', '01111110', '00111100', '00011000', '00000000',
    ];
    const cell = 4, n = 8, size = n * cell;
    const cv = document.createElement('canvas'); cv.width = cv.height = size;
    const g = cv.getContext('2d');
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (HEART[r][c] === '1') {
        g.fillStyle = r <= 2 ? '#ff5a77' : '#ff2e50'; // oben etwas heller
        g.fillRect(c * cell, r * cell, cell, cell);
      }
    }
    g.fillStyle = '#ffd0dc'; g.fillRect(2 * cell, 2 * cell, cell, cell); // Glanzpunkt
    const tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    return tex;
  }

  // Herzchen aufsteigen lassen (Zucht/Verliebt)
  heart(x, y, z, n = 5) {
    for (let i = 0; i < n; i++) {
      if (this.heartParticles.length >= MAX_HEARTS) return;
      this.heartParticles.push({
        x: x + (Math.random() - 0.5) * 0.5,
        y: y + Math.random() * 0.15,
        z: z + (Math.random() - 0.5) * 0.5,
        vx: (Math.random() - 0.5) * 0.35,
        vy: 0.7 + Math.random() * 0.4,
        vz: (Math.random() - 0.5) * 0.35,
        life: 0.8 + Math.random() * 0.5,
      });
    }
  }

  key(x, y, z) { return x + ',' + y + ',' + z; }

  get(x, y, z) {
    const k = this.key(x, y, z);
    let f = this.map.get(k);
    if (!f) {
      f = { input: null, fuel: null, output: null, progress: 0, fuelLeft: 0 };
      this.map.set(k, f);
    }
    return f;
  }

  // Block an Position geändert: Ofen weg → Inhalt droppen
  onBlockChanged(x, y, z) {
    const k = this.key(x, y, z);
    const f = this.map.get(k);
    if (!f) return;
    const id = this.ctx.world.getBlock(x, y, z);
    if (id === BLOCK.FURNACE || id === BLOCK.FURNACE_ON) return;
    for (const slot of ['input', 'fuel', 'output']) {
      if (f[slot]) this.ctx.entities.spawnItemDrop(x + 0.5, y + 0.5, z + 0.5, f[slot]);
    }
    this.map.delete(k);
  }

  _spawnParticle(x, y, z) {
    if (this.particles.length >= MAX_PARTICLES) return;
    const smoke = Math.random() < 0.3;
    this.particles.push({
      x: x + 0.3 + Math.random() * 0.4,
      y: y + 1.02,
      z: z + 0.3 + Math.random() * 0.4,
      vy: 0.6 + Math.random() * 0.7,
      life: 0.7 + Math.random() * 0.8,
      r: smoke ? 0.45 : 1.0,
      g: smoke ? 0.45 : 0.55 + Math.random() * 0.3,
      b: smoke ? 0.45 : 0.1,
    });
  }

  // Einzelner Umgebungs-Partikel (Blätter, Gischt, Funken …) mit frei wählbarer Bewegung/Farbe
  dot(x, y, z, opt = {}) {
    if (this.particles.length >= MAX_PARTICLES) return;
    this.particles.push({
      x, y, z,
      vx: opt.vx || 0, vy: opt.vy ?? 0.5, vz: opt.vz || 0,
      grav: opt.grav || 0,
      life: opt.life ?? 0.6,
      r: opt.r ?? 1, g: opt.g ?? 1, b: opt.b ?? 1,
    });
  }

  // Explosions-/Ereigniswolke: n Partikel kugelförmig auseinanderstieben lassen.
  // Ohne `color` Feuer/Rauch-Mix, mit color {r,g,b} eine getönte Wolke (z. B. Knochenmehl-Grün).
  burst(x, y, z, n = 28, color = null) {
    for (let i = 0; i < n; i++) {
      if (this.particles.length >= MAX_PARTICLES) return;
      const a = Math.random() * Math.PI * 2;
      const sp = color ? 0.8 + Math.random() * 1.6 : 1.5 + Math.random() * 4;
      const smoke = !color && Math.random() < 0.55;
      const v = 0.85 + Math.random() * 0.3;
      this.particles.push({
        x, y, z,
        vx: Math.cos(a) * sp,
        vy: Math.random() * sp,
        vz: Math.sin(a) * sp,
        life: 0.4 + Math.random() * 0.8,
        r: color ? color.r * v : smoke ? 0.35 : 1.0,
        g: color ? color.g * v : smoke ? 0.35 : 0.5 + Math.random() * 0.35,
        b: color ? color.b * v : smoke ? 0.35 : 0.08,
      });
    }
  }

  update(dt) {
    const w = this.ctx.world;
    const p = this.ctx.player?.pos;

    // 1) Schmelzen (alle bekannten Öfen in geladenen Chunks)
    for (const [k, f] of this.map) {
      const [x, y, z] = k.split(',').map(Number);
      const blockId = w.getBlock(x, y, z);
      if (blockId === -1) continue; // Chunk nicht geladen: eingefroren
      if (blockId !== BLOCK.FURNACE && blockId !== BLOCK.FURNACE_ON) {
        this.onBlockChanged(x, y, z);
        continue;
      }

      const smeltable = f.input && SMELT[f.input.id];
      const outFits = smeltable && (!f.output ||
        (f.output.id === SMELT[f.input.id] && f.output.count < stackSizeOf(f.output.id)));
      let active = false;

      if (smeltable && outFits) {
        if (f.fuelLeft <= 0 && f.fuel && FUEL[f.fuel.id]) {
          f.fuelLeft = FUEL[f.fuel.id];
          f.fuel.count--;
          if (f.fuel.count <= 0) f.fuel = null;
          f._dirtyUI = true;
        }
        if (f.fuelLeft > 0) {
          active = true;
          f.progress += dt;
          if (f.progress >= SMELT_TIME) {
            f.progress = 0;
            f.fuelLeft--;
            const outId = SMELT[f.input.id];
            f.input.count--;
            if (f.input.count <= 0) f.input = null;
            if (f.output) f.output.count++;
            else f.output = { id: outId, count: 1 };
            f._dirtyUI = true;
          }
        } else {
          f.progress = 0;
        }
      } else {
        f.progress = 0;
      }

      // Textur-/Licht-Zustand umschalten
      if (active && blockId === BLOCK.FURNACE) w.setBlock(x, y, z, BLOCK.FURNACE_ON);
      else if (!active && blockId === BLOCK.FURNACE_ON) w.setBlock(x, y, z, BLOCK.FURNACE);

      // Feuerpartikel in Spielernähe
      if (active && p && Math.abs(x - p.x) < 40 && Math.abs(z - p.z) < 40) {
        if (Math.random() < dt * 5) this._spawnParticle(x, y, z);
      }
    }

    // 2) Partikel animieren
    let i = 0;
    for (const pt of this.particles) {
      pt.life -= dt;
      if (pt.grav) pt.vy -= pt.grav * dt; // Funken fliegen im Bogen
      pt.y += pt.vy * dt;
      if (!pt.grav) pt.vy *= 1 - 0.5 * dt;
      if (pt.vx) { pt.x += pt.vx * dt; pt.vx *= 1 - 2.5 * dt; }
      if (pt.vz) { pt.z += pt.vz * dt; pt.vz *= 1 - 2.5 * dt; }
    }
    this.particles = this.particles.filter((pt) => pt.life > 0);
    for (; i < this.particles.length; i++) {
      const pt = this.particles[i];
      this._pPos[i * 3] = pt.x;
      this._pPos[i * 3 + 1] = pt.y;
      this._pPos[i * 3 + 2] = pt.z;
      this._pCol[i * 3] = pt.r;
      this._pCol[i * 3 + 1] = pt.g;
      this._pCol[i * 3 + 2] = pt.b;
    }
    for (; i < MAX_PARTICLES; i++) this._pPos[i * 3 + 1] = -99999;
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;

    // 3) Herz-Partikel (Zucht) animieren
    for (const h of this.heartParticles) {
      h.life -= dt;
      h.x += h.vx * dt; h.y += h.vy * dt; h.z += h.vz * dt;
      h.vy *= 1 - 0.6 * dt; // steigen, dann sanft langsamer
      h.vx *= 1 - 2 * dt; h.vz *= 1 - 2 * dt;
    }
    this.heartParticles = this.heartParticles.filter((h) => h.life > 0);
    let j = 0;
    for (; j < this.heartParticles.length; j++) {
      const h = this.heartParticles[j];
      this._hPos[j * 3] = h.x; this._hPos[j * 3 + 1] = h.y; this._hPos[j * 3 + 2] = h.z;
    }
    for (; j < MAX_HEARTS; j++) this._hPos[j * 3 + 1] = -99999;
    this.heartPoints.geometry.attributes.position.needsUpdate = true;
  }

  serialize() {
    const out = [];
    for (const [k, f] of this.map) {
      if (f.input || f.fuel || f.output || f.fuelLeft > 0) {
        out.push([k, {
          input: f.input, fuel: f.fuel, output: f.output,
          progress: f.progress, fuelLeft: f.fuelLeft,
        }]);
      }
    }
    return out;
  }

  restore(data) {
    if (!Array.isArray(data)) return;
    for (const [k, f] of data) {
      this.map.set(k, {
        input: f.input || null, fuel: f.fuel || null, output: f.output || null,
        progress: f.progress || 0, fuelLeft: f.fuelLeft || 0,
      });
    }
  }
}
