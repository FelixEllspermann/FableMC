// Day/night cycle: sun orbit, sky/fog colors, ambient light, stars.

import * as THREE from 'three';
import { DAY_LENGTH, CHUNK_SIZE, isWaterId, isLavaId } from './constants.js';
import { Settings } from './settings.js';

const DAY = new THREE.Color(0x87ceeb);
const DUSK = new THREE.Color(0xfda65e);
const NIGHT = new THREE.Color(0x0b0e1a);
const SUN_WARM = new THREE.Color(0xffc478);
const SUN_WHITE = new THREE.Color(0xffffff);

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

    this._elev = 1;

    // underwater tint overlay
    this.waterOverlay = document.createElement('div');
    this.waterOverlay.style.cssText =
      'position:fixed;inset:0;z-index:10;pointer-events:none;opacity:0;' +
      'background:rgba(18,60,130,0.32);transition:opacity 0.15s;';
    document.body.appendChild(this.waterOverlay);
    this._underwaterColor = new THREE.Color(0x12417d);
  }

  get dayFraction() {
    const t = this.ctx.state.time % DAY_LENGTH;
    return (t < 0 ? t + DAY_LENGTH : t) / DAY_LENGTH;
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
    this.sun.position.set(
      p.x + Math.cos(ang) * 120,
      p.y + elev * 120,
      p.z + 40
    );
    this.sun.target.position.set(p.x, p.y, p.z);
    this.sun.target.updateMatrixWorld();

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
