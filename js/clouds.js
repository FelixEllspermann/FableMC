// Wolkenschicht: eine große horizontale Ebene hoch über dem Spieler mit einer
// kachelbaren Wolkentextur. Weltverankert + zeitbasierter Drift (deterministisch,
// damit alle Mitspieler dieselben Wolken sehen). An/Aus über Settings.clouds.

import * as THREE from 'three';
import { Settings } from './settings.js';

const SPAN = 2400;   // Kantenlänge der Ebene in Blöcken
const REPEAT = 10;   // Kachel-Wiederholungen → eine Kachel ≈ 240 Blöcke
const HEIGHT = 110;  // Höhe über dem Spieler

export class Clouds {
  constructor(ctx) {
    this.ctx = ctx;
    this.tex = makeCloudTexture();
    this.tex.wrapS = this.tex.wrapT = THREE.RepeatWrapping;
    this.tex.repeat.set(REPEAT, REPEAT);
    this.tex.minFilter = THREE.LinearMipmapLinearFilter;

    const geo = new THREE.PlaneGeometry(SPAN, SPAN);
    geo.rotateX(-Math.PI / 2); // in die Horizontale legen
    this.mat = new THREE.MeshBasicMaterial({
      map: this.tex, transparent: true, opacity: 0.8,
      depthWrite: false, fog: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.renderOrder = -3;
    this.mesh.frustumCulled = false;
    ctx.scene.add(this.mesh);
  }

  update() {
    const on = Settings.clouds;
    this.mesh.visible = on;
    if (!on) return;

    const p = this.ctx.player ? this.ctx.player.pos : { x: 0, y: 64, z: 0 };
    this.mesh.position.set(p.x, (p.y || 64) + HEIGHT, p.z);

    // Weltverankerung: derselbe Weltpunkt fällt immer auf dieselbe UV-Stelle,
    // plus langsamer zeitbasierter Drift (gemeinsame Weltzeit → gleiche Wolken für alle).
    const t = this.ctx.state.time || 0;
    const k = REPEAT / SPAN;
    this.tex.offset.set(p.x * k + t * 0.0016, p.z * k + t * 0.0005);

    // nachts abdunkeln, damit die Wolken nicht hell leuchten
    const dl = this.ctx.world ? this.ctx.world.dayLight.value : 1; // 0.12 (Nacht) .. 1 (Tag)
    const shade = 0.35 + 0.65 * dl;
    this.mat.color.setRGB(shade, shade, shade);
    this.mat.opacity = 0.55 + 0.3 * dl;
  }

  dispose() {
    this.ctx.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.tex.dispose();
  }
}

// Kachelbare Wolkentextur: weiche weiße Kleckse auf transparent. Für nahtloses
// Kacheln wird jeder Klecks an den Rändern gespiegelt mitgezeichnet (±S).
function makeCloudTexture() {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, S, S);

  // deterministische Pseudozufallszahlen (kein Math.random nötig, gleiche Textur überall)
  let seed = 1337;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  const blob = (x, y, r) => {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  };

  for (let i = 0; i < 26; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 16 + rnd() * 34;
    // Klecks + gespiegelte Nachbarn für nahtloses Kacheln
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) blob(x + ox, y + oy, r);
  }

  const tex = new THREE.CanvasTexture(cv);
  return tex;
}
