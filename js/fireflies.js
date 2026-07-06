// Glühwürmchen: nachts schwirren über Gras-Landschaften kleine leuchtende
// 2-Pixel-Partikel umher. Rein visuell — keine Kollision, keine Netzwerk-Sync;
// jeder Client erzeugt sein eigenes Schwärmchen rund um den Spieler.

import * as THREE from 'three';
import { BLOCK } from './constants.js';

const MAX = 22;          // Obergrenze gleichzeitiger Glühwürmchen (dezent, nicht schwarmartig)
const RANGE = 26;        // Spawn-Radius um den Spieler (x/z)
const DESPAWN = 40;      // jenseits davon verschwinden sie wieder
const GROUND = [BLOCK.GRASS, BLOCK.SAVANNA_GRASS]; // nur über grünem Gras

export class Fireflies {
  constructor(ctx) {
    this.ctx = ctx;
    this.flies = [];
    this.clock = 0;
    this._spawnAcc = 0;
    this._pos = new Float32Array(MAX * 3).fill(-99999);
    this._col = new Float32Array(MAX * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this._pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this._col, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 2.6, vertexColors: true, transparent: true, opacity: 1,
      sizeAttenuation: false,           // feste Pixelgröße → ~2–3 px, egal wie weit weg
      depthWrite: false, blending: THREE.AdditiveBlending, // leuchten additiv gegen die Nacht
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    ctx.scene.add(this.points);
  }

  update(dt) {
    this.clock += dt;
    const p = this.ctx.player?.pos;
    const w = this.ctx.world;
    const elev = this.ctx.daynight?._elev ?? 1;
    // Nacht-Faktor: 0 am Tag, 1 in tiefer Nacht, weicher Übergang in der Dämmerung
    const night = Math.max(0, Math.min(1, (-elev - 0.02) / 0.18));

    if (night <= 0 || !p || !w) {
      if (this.flies.length) { this.flies.length = 0; this._flush(0); }
      return;
    }

    // Nachwuchs: Zielzahl skaliert mit dem Nacht-Faktor
    const want = Math.round(night * MAX);
    this._spawnAcc += dt * 24;                 // bis zu ~24 Spawn-Versuche/s
    let tries = Math.min(6, this._spawnAcc | 0);
    this._spawnAcc -= tries;
    while (this.flies.length < want && tries-- > 0) this._trySpawn(p, w);

    // Bewegung + Blinken + Aussortieren (an Ort und Stelle kompaktieren)
    let n = 0;
    for (let i = 0; i < this.flies.length; i++) {
      const f = this.flies[i];
      f.ttl -= dt;
      // Umherschweben: Richtung dreht langsam weg (glatte Kurven), konstantes Tempo,
      // dazu ein sanftes vertikales Wippen ums Ruhe-Niveau — sieht aus wie echtes Schwirren.
      f.dir += (Math.random() - 0.5) * f.turn * dt;
      f.x += Math.cos(f.dir) * f.speed * dt;
      f.z += Math.sin(f.dir) * f.speed * dt;
      // sanfte Leine zur Ursprungsstelle: bleiben übers grüne Fleckchen (schwirren im Radius ~2 m)
      f.x += (f.homeX - f.x) * 0.4 * dt;
      f.z += (f.homeZ - f.z) * 0.4 * dt;
      // der Bodenhöhe folgen, damit sie nie im Gelände stecken bleiben
      const sy = w.surfaceY(Math.floor(f.x), Math.floor(f.z));
      if (sy > 0) f.homeY += ((sy + f.hover) - f.homeY) * 1.5 * dt;
      f.y = f.homeY + Math.sin(this.clock * f.bobSpeed + f.bobPhase) * f.bobAmp;

      if (f.ttl <= 0 || Math.abs(f.x - p.x) > DESPAWN || Math.abs(f.z - p.z) > DESPAWN) continue;

      // Blinken: gemächlicher Puls, dimmt aber nie ganz weg (Flug bleibt sichtbar)
      const puls = 0.15 + 0.85 * Math.pow(0.5 + 0.5 * Math.sin(this.clock * f.blink + f.phase), 2);
      const k = puls * night;
      // warmes Gelbgrün (viel Rot+Grün, kaum Blau): leuchtet golden gegen die Nacht und
      // clippt über hellem Gras höchstens zu Gelb statt zu Weiß.
      this._pos[n * 3] = f.x; this._pos[n * 3 + 1] = f.y; this._pos[n * 3 + 2] = f.z;
      this._col[n * 3] = 1.0 * k; this._col[n * 3 + 1] = 0.82 * k; this._col[n * 3 + 2] = 0.22 * k;
      this.flies[n++] = f;
    }
    this.flies.length = n;
    this._flush(n);
  }

  _trySpawn(p, w) {
    const a = Math.random() * Math.PI * 2;
    const r = 6 + Math.random() * (RANGE - 6);
    const x = Math.floor(p.x + Math.cos(a) * r);
    const z = Math.floor(p.z + Math.sin(a) * r);
    const sy = w.surfaceY(x, z);
    if (sy < 1) return;
    if (!GROUND.includes(w.getBlock(x, sy, z))) return; // nur über Gras
    const hover = 1.2 + Math.random() * 2.2;            // Wunsch-Höhe über dem Boden (1–3 Blöcke)
    const y = sy + hover;
    this.flies.push({
      x: x + 0.5, y, z: z + 0.5,
      homeX: x + 0.5, homeZ: z + 0.5, homeY: y, hover, // Ursprungsstelle als sanfte Leine
      dir: Math.random() * Math.PI * 2,     // Flugrichtung (dreht langsam weg)
      speed: 0.4 + Math.random() * 0.6,     // 0.4–1.0 m/s gemächliches Schwirren
      turn: 1.6 + Math.random() * 2.2,      // Wende-Rate der Richtung
      bobSpeed: 1.2 + Math.random() * 1.6,  // Tempo des Auf-und-Ab
      bobPhase: Math.random() * Math.PI * 2,
      bobAmp: 0.25 + Math.random() * 0.55,  // Höhe des vertikalen Wippens
      phase: Math.random() * Math.PI * 2,
      blink: 2 + Math.random() * 2.5,       // Puls-Frequenz je Tier
      ttl: 8 + Math.random() * 12,          // lebt 8–20 s, taucht dann woanders neu auf
    });
  }

  _flush(n) {
    for (let i = n; i < MAX; i++) this._pos[i * 3 + 1] = -99999;
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}
