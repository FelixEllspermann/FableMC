// Day/night cycle: sun orbit, sky/fog colors, ambient light, stars.

import * as THREE from 'three';
import { CHUNK_SIZE, isWaterId, isLavaId } from './constants.js';
import { biomeAt } from './worldgen.js';
import { Rules } from '../config.js';
import { Settings } from './settings.js';

const DAY = new THREE.Color(0x87ceeb);
const DUSK = new THREE.Color(0xfda65e);
const NIGHT = new THREE.Color(0x0b0e1a);
const SUN_WARM = new THREE.Color(0xffc478);
const SUN_WHITE = new THREE.Color(0xffffff);

// Biome-abhängige Färbung (Nebel/Himmel + Wasser). Weitere Biome kommen dazu.
const BIOME_FOG = {
  old_birch: new THREE.Color(0x6b7a5a),      // gedämpftes Waldgrün
  spruce_valley: new THREE.Color(0x7a93a0),  // kühler, blaugrauer Talnebel
};
const BIOME_WATER = {
  old_birch: new THREE.Color(0xa9ccb8),      // leicht grünliches Wasser
  spruce_valley: new THREE.Color(0x8fb9c9),  // klares, kühles Flusswasser
};
const WATER_WHITE = new THREE.Color(0xffffff);                // Standard (keine Tönung)

export class DayNight {
  constructor(ctx) {
    this.ctx = ctx;
    const scene = ctx.scene;

    this.sky = new THREE.Color(0x87ceeb);
    scene.background = this.sky;
    const far = Settings.renderDistance * CHUNK_SIZE;
    scene.fog = new THREE.Fog(0x87ceeb, far * 0.55, far * 0.95);
    scene.fog.color = this.sky;

    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(this.ambient);

    // stars
    const starPos = new Float32Array(350 * 3);
    for (let i = 0; i < 350; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * Math.PI * 0.5;
      const r = 400;
      starPos[i * 3] = Math.cos(a) * Math.cos(e) * r;
      starPos[i * 3 + 1] = Math.sin(e) * r * 0.9 + 20;
      starPos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this.starMat = new THREE.PointsMaterial({
      color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false,
    });
    this.stars = new THREE.Points(starGeo, this.starMat);
    scene.add(this.stars);

    // Sichtbare Sonne & Mond: als Sprites weit am Himmel, folgen dem Sonnenwinkel.
    // depthTest an (vom Gelände verdeckt = Sonne hinterm Berg), depthWrite aus,
    // kleiner renderOrder → Wolken ziehen davor vorbei.
    const skyBody = (tex, size) => {
      const mat = new THREE.SpriteMaterial({
        map: tex, transparent: true, depthTest: true, depthWrite: false, fog: false,
      });
      const s = new THREE.Sprite(mat);
      s.scale.set(size, size, 1);
      s.renderOrder = -5;
      scene.add(s);
      return s;
    };
    this.sunSprite = skyBody(this._discTexture('sun'), 58);
    this.moonSprite = skyBody(this._discTexture('moon'), 48);
    this._sunDir = new THREE.Vector3();

    this._elev = 1;

    // underwater tint overlay
    this.waterOverlay = document.createElement('div');
    this.waterOverlay.style.cssText =
      'position:fixed;inset:0;z-index:10;pointer-events:none;opacity:0;' +
      'background:rgba(18,60,130,0.32);transition:opacity 0.15s;';
    document.body.appendChild(this.waterOverlay);
    this._underwaterColor = new THREE.Color(0x12417d);
  }

  // Prozedurale Textur für Sonne (warmer Glühkreis) bzw. Mond (bleiche Scheibe mit Kratern).
  _discTexture(kind) {
    const S = 64;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d');
    const cx = S / 2, cy = S / 2;
    if (kind === 'sun') {
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, cx);
      grad.addColorStop(0, 'rgba(255,255,245,1)');
      grad.addColorStop(0.45, 'rgba(255,241,170,1)');
      grad.addColorStop(0.72, 'rgba(255,201,92,0.9)');
      grad.addColorStop(1, 'rgba(255,180,60,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, S, S);
    } else {
      // Mondscheibe
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, cx);
      grad.addColorStop(0, 'rgba(238,242,255,1)');
      grad.addColorStop(0.78, 'rgba(206,214,236,1)');
      grad.addColorStop(0.94, 'rgba(150,160,190,0.85)');
      grad.addColorStop(1, 'rgba(120,130,160,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(cx, cy, cx - 2, 0, Math.PI * 2);
      g.fill();
      // ein paar dezente Krater
      g.fillStyle = 'rgba(150,158,186,0.55)';
      for (const [dx, dy, r] of [[-10, -6, 5], [8, -9, 3], [4, 8, 6], [-6, 10, 3], [12, 5, 2.5]]) {
        g.beginPath();
        g.arc(cx + dx, cy + dy, r, 0, Math.PI * 2);
        g.fill();
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.LinearFilter;
    return tex;
  }

  get dayFraction() {
    const L = Rules.dayLengthSec;
    const t = this.ctx.state.time % L;
    return (t < 0 ? t + L : t) / L;
  }

  // Sonnenphase 0..1 → Winkel. Der Tagbogen (Sonne über dem Horizont, Phase
  // 0..0.5) füllt die ersten 2/3 des Zyklus (10 min), die Nacht das letzte
  // Drittel (5 min). So dauert der Tag doppelt so lange wie die Nacht.
  _sunPhase(f) {
    const DAY_SHARE = 3 / 4; // Tag = 3/4 des Zyklus (30 min), Nacht = 1/4 (10 min)
    return f < DAY_SHARE
      ? (f / DAY_SHARE) * 0.5
      : 0.5 + ((f - DAY_SHARE) / (1 - DAY_SHARE)) * 0.5;
  }

  isNight() {
    return this._elev < -0.08;
  }

  update(dt) {
    const s = this.ctx.state;
    if (s.gameStarted && !s.paused && !s.dead) s.time += dt;

    const f = this.dayFraction;
    const ang = this._sunPhase(f) * Math.PI * 2; // 0 = sunrise, PI/2 noon, PI sunset
    const elev = Math.sin(ang);
    this._elev = elev;

    const p = this.ctx.player ? this.ctx.player.pos : { x: 0, y: 0, z: 0 };
    // gemeinsame Himmelsrichtung für Licht, Sonne & Mond (leicht auf Z geneigter Bogen)
    this._sunDir.set(Math.cos(ang), elev, 0.33).normalize();
    this.sun.position.set(
      p.x + this._sunDir.x * 120,
      p.y + this._sunDir.y * 120,
      p.z + this._sunDir.z * 120
    );
    this.sun.target.position.set(p.x, p.y, p.z);
    this.sun.target.updateMatrixWorld();

    // sichtbare Sonne & Mond gegenüberliegend am Himmel platzieren und je nach Höhe einblenden
    const R = 300;
    this.sunSprite.position.set(p.x + this._sunDir.x * R, p.y + this._sunDir.y * R, p.z + this._sunDir.z * R);
    this.moonSprite.position.set(p.x - this._sunDir.x * R, p.y - this._sunDir.y * R, p.z - this._sunDir.z * R);
    this.sunSprite.material.opacity = Math.min(1, Math.max(0, (elev + 0.06) / 0.16));
    this.moonSprite.material.opacity = Math.min(1, Math.max(0, (0.06 - elev) / 0.16));

    this.sun.intensity = Math.max(0.03, elev) * 1.0;
    this.sun.color.lerpColors(SUN_WARM, SUN_WHITE, Math.min(1, Math.max(0, elev * 2.5)));
    this.ambient.intensity = 0.28 + Math.max(0, elev) * 0.35;
    // Tageslicht-Faktor für die Terrain-Licht-Engine (Himmelslicht-Kanal)
    if (this.ctx.world) {
      this.ctx.world.dayLight.value = 0.12 + Math.max(0, Math.min(1, elev * 1.6)) * 0.88;
    }

    // sky color blend
    if (elev >= 0.25) {
      this.sky.copy(DAY);
    } else if (elev >= 0) {
      this.sky.lerpColors(DUSK, DAY, elev / 0.25);
    } else if (elev >= -0.3) {
      this.sky.lerpColors(DUSK, NIGHT, -elev / 0.3);
    } else {
      this.sky.copy(NIGHT);
    }

    // Biome-abhängige Färbung von Nebel/Himmel und Wasser (tagsüber wirksam)
    const pb = this.ctx.world ? biomeAt(this.ctx.seed, Math.floor(p.x), Math.floor(p.z)) : null;
    const fogTint = pb && BIOME_FOG[pb];
    if (fogTint) this.sky.lerp(fogTint, 0.32 * Math.max(0, Math.min(1, elev * 2)));
    if (this.ctx.world?.waterMat) {
      this.ctx.world.waterMat.color.lerp((pb && BIOME_WATER[pb]) || WATER_WHITE, 0.1);
    }

    // stars
    this.starMat.opacity = Math.min(0.9, Math.max(0, -elev * 3));
    this.stars.position.set(p.x, p.y - 40, p.z);

    // in Flüssigkeit: dichter Nebel + Farbton (Wasser blau, Lava orange)
    const cam = this.ctx.camera.position;
    const camBlock = this.ctx.world && this.ctx.player
      ? this.ctx.world.getBlock(Math.floor(cam.x), Math.floor(cam.y), Math.floor(cam.z))
      : 0;
    const fog = this.ctx.scene.fog;
    const far = Settings.renderDistance * CHUNK_SIZE;
    if (isWaterId(camBlock)) {
      this.sky.lerp(this._underwaterColor, 0.85);
      fog.near = 0.5;
      fog.far = 18;
      this.waterOverlay.style.background = 'rgba(18,60,130,0.32)';
      this.waterOverlay.style.opacity = '1';
    } else if (isLavaId(camBlock)) {
      fog.near = 0.1;
      fog.far = 4;
      this.waterOverlay.style.background = 'rgba(214,92,14,0.55)';
      this.waterOverlay.style.opacity = '1';
    } else {
      fog.near = far * 0.55;
      fog.far = far * 0.95;
      this.waterOverlay.style.opacity = '0';
    }
  }
}
