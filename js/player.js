// First-person player: pointer-lock look, movement, mining, placing, attacking, eating.

import * as THREE from 'three';
import {
  WALK_SPEED, SPRINT_SPEED, SNEAK_SPEED, JUMP_SPEED, SWIM_UP_SPEED, REACH, PLAYER,
  BLOCK, BLOCKS, ITEM, ITEMS, isBlockId, isLiquid, ATTACK_COOLDOWN, nameOf,
  isSaplingId, GRASSY, isSolid, isStairsId, isSlabId, isCarpetId,
  toggledDoorId, doorId, yawToCardinal, CARDINAL_DELTA, CARDINAL_OPP,
} from './constants.js';
import { Rules } from '../config.js';
import {
  isEquipment, damageItem, miningTimeFor, toolLevelFor, meleeDamageFor, equipStats, armorStats,
} from './equip.js';
import { getTilePixels } from './textures.js';
import { TILE_NAMES, ATLAS_COLS, TILE_PX, uvRect } from './atlasmap.js';

// Extrudierte 3D-Pixel-Modelle für Items in der Hand (wie MC): jeder sichtbare
// Pixel bekommt Tiefe, die Kanten übernehmen die Pixelfarbe aus dem Atlas.
const extrudeCache = new Map();
function extrudedGeometry(tileName) {
  let geo = extrudeCache.get(tileName);
  if (geo) return geo;
  const px = getTilePixels(tileName);
  const T = 16, s = 1 / T, d = s * 1.2; // gut 1 Pixel dick
  const r = uvRect(tileName);
  const W = ATLAS_COLS * TILE_PX;
  const idx = TILE_NAMES.indexOf(tileName);
  const colOff = (idx % ATLAS_COLS) * TILE_PX;
  const rowOff = Math.floor(idx / ATLAS_COLS) * TILE_PX;
  const opaque = (x, y) => x >= 0 && x < T && y >= 0 && y < T && px[(y * T + x) * 4 + 3] > 10;
  const pos = [], uv = [], index = [];
  const quad = (verts, uvs) => {
    const b = pos.length / 3;
    for (const v of verts) pos.push(v[0], v[1], v[2]);
    for (const u of uvs) uv.push(u[0], u[1]);
    index.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  // Vorder-/Rückseite als volle Quads (alphaTest schneidet die Löcher)
  quad([[0, 0, d / 2], [1, 0, d / 2], [1, 1, d / 2], [0, 1, d / 2]],
    [[r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1]]);
  quad([[1, 0, -d / 2], [0, 0, -d / 2], [0, 1, -d / 2], [1, 1, -d / 2]],
    [[r.u1, r.v0], [r.u0, r.v0], [r.u0, r.v1], [r.u1, r.v1]]);
  // Kanten: für jeden sichtbaren Pixel mit transparentem Nachbarn eine Seitenfläche
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      if (!opaque(x, y)) continue;
      const cu = (colOff + x + 0.5) / W;
      const cv = 1 - (rowOff + y + 0.5) / W;
      const uvs = [[cu, cv], [cu, cv], [cu, cv], [cu, cv]];
      const x0 = x * s, x1 = x0 + s;
      const y1 = (T - y) * s, y0 = y1 - s; // Canvas-y ist invertiert
      if (!opaque(x - 1, y)) quad([[x0, y0, -d / 2], [x0, y0, d / 2], [x0, y1, d / 2], [x0, y1, -d / 2]], uvs);
      if (!opaque(x + 1, y)) quad([[x1, y0, d / 2], [x1, y0, -d / 2], [x1, y1, -d / 2], [x1, y1, d / 2]], uvs);
      if (!opaque(x, y - 1)) quad([[x0, y1, d / 2], [x1, y1, d / 2], [x1, y1, -d / 2], [x0, y1, -d / 2]], uvs);
      if (!opaque(x, y + 1)) quad([[x0, y0, -d / 2], [x1, y0, -d / 2], [x1, y0, d / 2], [x0, y0, d / 2]], uvs);
    }
  }
  geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  geo.setIndex(index);
  geo.translate(-0.5, -0.5, 0);
  extrudeCache.set(tileName, geo);
  return geo;
}
import { stepEntity, aabbIntersectsBlock, entitiesOverlapBlock } from './physics.js';
import { raycastVoxel } from './raycast.js';
import { Settings } from './settings.js';

const MOUSE_SENS = 0.0022;

export class Player {
  constructor(ctx) {
    this.ctx = ctx;
    this.camera = ctx.camera;
    this.world = ctx.world;

    this.pos = new THREE.Vector3(0, 80, 0);
    this.vel = new THREE.Vector3();
    this.width = PLAYER.WIDTH;
    this.height = PLAYER.HEIGHT;
    this.onGround = false;
    this.inWater = false;
    this.fallDistance = 0;

    this.yaw = 0;
    this.pitch = 0;
    this.target = null;
    this.lookAt = null; // { kind:'block', id } oder { kind:'mob', type, name } fürs UI-Fenster
    this.sprinting = false;
    // Schriftrollen-Effekte (Restsekunden) + Erz-Umriss-Renderer
    this.effects = { mining: 0, water: 0, levitation: 0, slow: 0, resist: 0, speed: 0 };
    this._oreLines = null;
    this._oreScanTimer = 0;

    this.keys = {};
    this.leftHeld = false;
    this.rightHeld = false;
    this.miningKey = null;
    this.miningProgress = 0;
    this.eatTimer = 0;
    this.drawTimer = 0;      // Bogen-Spannung (Sekunden gehalten)
    this._drawing = false;   // spannt der Spieler gerade den Bogen?
    this.attackCooldown = 0;
    this.placeTimer = 0;
    this.lastW = -1;
    this.lastSpace = -1;
    this.flying = false;
    this.modFly = false; // Moderator-Befehl /fly: Fliegen auch im Überlebensmodus
    this.wasInWater = false;

    // shared temp vectors (no per-frame allocations)
    this._dir = new THREE.Vector3();
    this._eye = new THREE.Vector3();
    this._wish = new THREE.Vector3();
    this._knock = new THREE.Vector3();

    // dynamisches Licht: Fackel in der Hand beleuchtet die Umgebung beim Laufen
    // (Terrain über Shader-Uniform, Mobs/Items über dieses PointLight)
    this.torchLight = new THREE.PointLight(0xffc880, 0, 18, 2);
    ctx.scene.add(this.torchLight);

    // First-Person-Hand: eigene Szene + Kamera (2. Render-Pass, clippt nie in Wände)
    this.handScene = new THREE.Scene();
    this.handCam = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 5);
    this.handGroup = new THREE.Group();
    this.handScene.add(this.handGroup);
    this._handMats = [];
    this._handHeldId = undefined;
    this.swing = 0;      // 0 = ruhig, >0 = Schwung läuft (0..1)
    this._bobT = 0;

    // block selection outline
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002));
    this.selectionBox = new THREE.LineSegments(
      edges, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 })
    );
    this.selectionBox.visible = false;
    ctx.scene.add(this.selectionBox);

    this._bindInput();
  }

  get playable() {
    const s = this.ctx.state;
    return s.gameStarted && !s.paused && !s.uiOpen && !s.dead && document.pointerLockElement != null;
  }

  _bindInput() {
    document.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      this.keys[e.code] = true;
      if (e.code === 'KeyW') {
        const now = performance.now();
        if (now - this.lastW < 280) this.sprinting = true;
        this.lastW = now;
      }
      if (e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5));
        if (n >= 1 && n <= 9) this.ctx.inventory.setHotbarIndex(n - 1);
      }
      const s = this.ctx.state;
      if (e.code === 'Space' && !e.repeat) {
        // Doppel-Leertaste: Fliegen umschalten (Kreativ oder Levitations-Zauber)
        const now = performance.now();
        if ((s.mode === 'creative' || this.effects.levitation > 0) &&
            !s.spectator && this.playable && now - this.lastSpace < 300) {
          this.flying = !this.flying;
          this.vel.y = 0;
          this.ctx.ui.toast(this.flying ? 'Fliegen an' : 'Fliegen aus');
        }
        this.lastSpace = now;
      }
      if (e.code === 'F4' && s.mode === 'creative' && s.gameStarted && !s.dead) {
        s.spectator = !s.spectator;
        if (s.spectator) this.flying = true;
        this.ctx.ui.toast(s.spectator ? 'Spectator an (durch Blöcke fliegen)' : 'Spectator aus');
      }
      if (e.code === 'KeyB' && s.mode === 'creative' && this.playable) {
        this.ctx.ui.showBiomeMenu();
      }
      // Q: gewähltes Item fallen lassen (wirft es in Blickrichtung)
      if (e.code === 'KeyQ' && this.playable && !s.spectator) {
        this.dropSelected();
      }
      // while playing (pointer locked): swallow everything the browser would react to
      // (Leertaste-Scroll, Schnellsuche, F1/F3, Alt-Menü …). F5/F11/F12 bleiben erlaubt.
      if (
        document.pointerLockElement && !e.metaKey &&
        e.code !== 'F5' && e.code !== 'F11' && e.code !== 'F12'
      ) {
        e.preventDefault();
      }
    });
    document.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      if (document.pointerLockElement &&
          (e.code === 'AltLeft' || e.code === 'AltRight' || e.code === 'F10')) {
        e.preventDefault(); // keeps Alt/F10 from focusing the browser menu
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!document.pointerLockElement || this.ctx.state.uiOpen) return;
      this.yaw -= e.movementX * MOUSE_SENS;
      this.pitch -= e.movementY * MOUSE_SENS;
      const lim = Math.PI / 2 - 0.017;
      this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
    });

    document.addEventListener('mousedown', (e) => {
      if (!this.playable || this.ctx.state.spectator) return;
      if (e.button === 0) {
        this.leftHeld = true;
        this._startSwing();
        this._tryAttack();
      } else if (e.button === 2) {
        this.rightHeld = true;
        this._startSwing();
        this._rightAction();
        this.placeTimer = 0.25;
      }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) { this.leftHeld = false; this._resetMining(); }
      if (e.button === 2) {
        if (this._drawing) this._releaseBow(); // Bogen loslassen → Pfeil schießen
        this.rightHeld = false; this.eatTimer = 0;
      }
    });
    document.addEventListener('wheel', (e) => {
      if (!this.playable) return;
      e.preventDefault(); // blocks browser zoom (Strg+Rad) while sprinting
      const inv = this.ctx.inventory;
      inv.setHotbarIndex((inv.hotbarIndex + (e.deltaY > 0 ? 1 : -1) + 9) % 9);
    }, { passive: false });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  heldId() {
    const it = this.ctx.inventory.selectedItem();
    return it ? it.id : null;
  }

  // Was ist im Fadenkreuz? Mob (falls näher) sonst Block — Wasser/Lava ausgenommen.
  _computeLookAt(eye, dir, reach) {
    const hit = this.ctx.entities.raycast(eye, dir, reach);
    const t = this.target;
    let blockDist = Infinity;
    if (t) blockDist = Math.hypot(t.x + 0.5 - eye.x, t.y + 0.5 - eye.y, t.z + 0.5 - eye.z);
    if (hit && hit.dist <= blockDist) {
      return { kind: 'mob', type: hit.entity.type, name: hit.entity.name || null };
    }
    if (t && t.id > 0 && !isLiquid(t.id)) return { kind: 'block', id: t.id };
    return null;
  }

  _viewDir(out) {
    const cp = Math.cos(this.pitch);
    out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    return out;
  }

  _eyePos(out) {
    return out.set(this.pos.x, this.pos.y + PLAYER.EYE_HEIGHT, this.pos.z);
  }

  // ---- First-Person-Hand ----

  _startSwing() {
    if (this.swing <= 0) this.swing = 0.001;
    this.ctx.net?.sendSwing(); // Mitspieler sehen den Arm-Schwung
  }

  _rebuildHand(heldId) {
    this._handHeldId = heldId;
    for (const c of [...this.handGroup.children]) {
      this.handGroup.remove(c);
      if (!c.userData.sharedGeo) c.geometry?.dispose();
    }
    for (const m of this._handMats) m.dispose();
    this._handMats = [];
    const atlas = this.ctx.textures;

    if (heldId == null) {
      // leerer Arm
      const mat = new THREE.MeshBasicMaterial({ color: 0xe8b08a });
      this._handMats.push(mat);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.5), mat);
      arm.rotation.set(0.3, -0.25, 0.1);
      this.handGroup.add(arm);
    } else if (isBlockId(heldId) && !BLOCKS[heldId].cross) {
      // Block als Mini-Würfel
      const tiles = BLOCKS[heldId].tiles;
      const geo = new THREE.BoxGeometry(0.32, 0.32, 0.32);
      const uv = geo.getAttribute('uv');
      // Face-Reihenfolge Box: +x,-x,+y,-y,+z,-z
      const names = [tiles.side, tiles.side, tiles.top ?? tiles.side,
        tiles.bottom ?? tiles.side, tiles.side, tiles.side];
      for (let face = 0; face < 6; face++) {
        const r = atlas.uv(names[face]);
        for (let i = face * 4; i < face * 4 + 4; i++) {
          uv.setXY(i, r.u0 + (r.u1 - r.u0) * uv.getX(i), r.v0 + (r.v1 - r.v0) * uv.getY(i));
        }
      }
      uv.needsUpdate = true;
      const mat = new THREE.MeshBasicMaterial({ map: atlas.texture, alphaTest: 0.1 });
      this._handMats.push(mat);
      const cube = new THREE.Mesh(geo, mat);
      cube.rotation.set(0.1, 0.8, 0);
      this.handGroup.add(cube);
    } else {
      // Item (oder Kreuz-Block wie Fackel/Zuckerrohr) als extrudiertes 3D-Pixel-Modell
      const tile = isBlockId(heldId)
        ? BLOCKS[heldId].tiles.side
        : (ITEMS[heldId]?.tile ?? 'stick');
      const geo = extrudedGeometry(tile);
      const mat = new THREE.MeshBasicMaterial({
        map: atlas.texture, alphaTest: 0.1, side: THREE.DoubleSide,
      });
      this._handMats.push(mat);
      const m = new THREE.Mesh(geo, mat);
      m.userData.sharedGeo = true; // Geometrie ist gecacht — nie disposen
      m.scale.setScalar(0.5);
      m.rotation.set(-0.15, 0.9, 0.35);
      this.handGroup.add(m);
    }
  }

  _updateHand(dt, moving) {
    const held = this.ctx.inventory?.selectedItem();
    const heldId = held ? held.id : null;
    if (heldId !== this._handHeldId) this._rebuildHand(heldId);

    // Schwung-Animation (0.28 s Bogen)
    if (this.swing > 0) {
      this.swing += dt / 0.28;
      if (this.swing >= 1) this.swing = 0;
    }
    const sw = this.swing > 0 ? Math.sin(this.swing * Math.PI) : 0;

    // Lauf-Bobbing
    if (moving && this.onGround) this._bobT += dt * 9;
    const bobY = Math.sin(this._bobT) * 0.012;
    const bobX = Math.cos(this._bobT * 0.5) * 0.008;

    // X-Position ans Seitenverhältnis anpassen (sonst bei schmalen Fenstern außerhalb)
    const halfW = Math.tan((70 / 2) * Math.PI / 180) * 0.66 * this.handCam.aspect;
    this.handGroup.position.set(
      halfW * 0.62 + bobX - sw * 0.18,
      -0.38 + bobY - sw * 0.10,
      -0.66 - sw * 0.22
    );
    this.handGroup.rotation.set(-sw * 1.1, sw * 0.35, -sw * 0.2);

    // Ess-/Trink-Animation: Hand zum Mund heben, leicht wackeln, Flasche kippen
    if (this._consuming) {
      const wob = Math.sin(this.eatTimer * 28) * 0.02;
      this.handGroup.position.x -= 0.14;
      this.handGroup.position.y += 0.12 + wob;
      this.handGroup.position.z += 0.10;
      this.handGroup.rotation.x -= 0.35;
      this.handGroup.rotation.z += this._consumeIsDrink ? 0.6 : 0.3; // Trank stärker kippen
    }

    // Bogen spannen: Hand heranziehen + leichtes Zittern bei voller Spannung
    if (this._drawing) {
      const c = Math.min(this.drawTimer / 0.9, 1);
      const jitter = c >= 1 ? Math.sin(this._bobT * 20) * 0.006 : 0;
      this.handGroup.position.x -= 0.10 * c;
      this.handGroup.position.y += 0.05 * c + jitter;
      this.handGroup.position.z += 0.15 * c;
      this.handGroup.rotation.y -= 0.28 * c;
    }

    // Hand-Beleuchtung: Umgebungslicht + eigenes Fackellicht abtasten
    const w = this.ctx.world;
    const L = w.getLight(Math.floor(this.pos.x), Math.floor(this.pos.y + PLAYER.EYE_HEIGHT), Math.floor(this.pos.z));
    const lum = Math.max(
      Math.max((L >> 4) / 15 * w.dayLight.value, (L & 15) / 15),
      w.dynLightStrength.value * 0.9,
      0.08
    );
    for (const m of this._handMats) m.color.setScalar(Math.min(1, lum));
  }

  _damageHeld(n = 1) {
    if (this.ctx.state.mode === 'creative') return;
    const s = this.ctx.inventory.selectedItem();
    if (!s || !isEquipment(s.id)) return;
    if (damageItem(s, n)) {
      this.ctx.inventory.slots[this.ctx.inventory.hotbarIndex] = null;
      this.ctx.ui.toast(nameOf(s.id) + ' ist zerbrochen!');
      this.ctx.sounds.hurt();
    }
    this.ctx.inventory._renderAll();
  }

  // Bogen weiter spannen, solange rechte Maustaste gehalten wird (aus update()).
  _updateBow(dt) {
    if (!this._drawing) return;
    if (!this.rightHeld || this.heldId() !== ITEM.BOW || !this.playable) {
      this._drawing = false; this.drawTimer = 0; return; // Slot gewechselt / Pause → abbrechen
    }
    this.drawTimer = Math.min(this.drawTimer + dt, 1.2);
  }

  // Bogen loslassen: Pfeil abschießen, Stärke ergibt sich aus der Spannung.
  _releaseBow() {
    const charge = Math.min(this.drawTimer / 0.9, 1); // volle Spannung nach 0.9 s
    this._drawing = false;
    this.drawTimer = 0;
    if (this.heldId() !== ITEM.BOW || charge < 0.15) return; // zu wenig gespannt → kein Schuss
    const creative = this.ctx.state.mode === 'creative';
    if (!creative) {
      if (this.ctx.inventory.countItem(ITEM.ARROW) < 1) return;
      this.ctx.inventory.removeItems(ITEM.ARROW, 1);
    }
    const eye = this._eyePos(this._eye);
    const dir = this._viewDir(this._dir);
    this.ctx.entities.playerShootArrow(eye, dir, charge); // spielt bereits den Schuss-Sound
    if (!creative) this._damageHeld(1);
    this._startSwing();
  }

  _tryAttack() {
    if (this.attackCooldown > 0) return;
    const eye = this._eyePos(this._eye);
    const dir = this._viewDir(this._dir);
    const reach = REACH - 1 + equipStats(this.ctx.inventory.selectedItem()).reach;
    const hit = this.ctx.entities.raycast(eye, dir, reach);
    // PvP: steht ein Mitspieler (näher als ein evtl. getroffenes Mob) im Fadenkreuz?
    const net = this.ctx.net;
    if (net?.active && net.pvp) {
      const ph = this._raycastRemotePlayer(eye, dir, hit ? Math.min(reach, hit.dist) : reach);
      if (ph) {
        this.attackCooldown = ATTACK_COOLDOWN;
        this._knock.set(dir.x, 0, dir.z).normalize();
        const dmg = meleeDamageFor(this.ctx.inventory.selectedItem(), false);
        net.sendPvp(ph.id, dmg, this._knock.x * 6, this._knock.z * 6);
        const r = net.remote.get(ph.id);
        if (r) r.flash = 0.2; // sofortiges Feedback (das Ziel meldet den Treffer via phurt)
        this.ctx.sounds.hit?.();
        this._damageHeld(1);
        this.ctx.survival.addExhaustion(0.3);
        this._resetMining();
        return;
      }
    }
    if (hit) {
      this.attackCooldown = ATTACK_COOLDOWN;
      this._knock.set(dir.x, 0, dir.z).normalize();
      const held = this.ctx.inventory.selectedItem();
      const isAnimal = ['pig', 'sheep', 'fish'].includes(hit.entity.type);
      const dmg = meleeDamageFor(held, isAnimal);
      if (hit.entity.remoteNet) {
        // Gast: Treffer an den Host melden; sofortiges lokales Feedback
        // (Richtung unskaliert — hurt() auf dem Host skaliert selbst)
        this.ctx.net?.sendHit(hit.entity.eid, dmg, this._knock.x, this._knock.z);
        const e = hit.entity;
        if (e.materials && e.dying <= 0) {
          e.flash = 0.18;
          for (const m of e.materials) { m.emissive.setHex(0xff0000); m.emissiveIntensity = 0.55; }
        }
        this.ctx.sounds.hit?.();
      } else {
        this.ctx.entities.hurt(hit.entity, dmg, this._knock, 'local'); // eigener Nahkampf → XP an mich
      }
      this._damageHeld(1);
      this.ctx.survival.addExhaustion(0.3);
      this._resetMining();
    }
  }

  // Ray vs. Mitspieler-Avatare (AABB). Liefert { id, dist } des nächsten Treffers.
  _raycastRemotePlayer(eye, dir, maxDist) {
    const net = this.ctx.net;
    if (!net) return null;
    let best = null, bestDist = maxDist;
    const o = [eye.x, eye.y, eye.z];
    const dd = [dir.x, dir.y, dir.z];
    for (const [id, r] of net.remote) {
      if (r.dead > 0) continue;
      const p = r.mesh.position;
      const mins = [p.x - 0.35, p.y, p.z - 0.35];
      const maxs = [p.x + 0.35, p.y + 1.9, p.z + 0.35];
      let tmin = 0, tmax = bestDist, ok = true;
      for (let i = 0; i < 3; i++) {
        if (Math.abs(dd[i]) < 1e-9) {
          if (o[i] < mins[i] || o[i] > maxs[i]) { ok = false; break; }
        } else {
          let t1 = (mins[i] - o[i]) / dd[i], t2 = (maxs[i] - o[i]) / dd[i];
          if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
          tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
          if (tmin > tmax) { ok = false; break; }
        }
      }
      if (ok && tmin < bestDist) { best = { id, dist: tmin }; bestDist = tmin; }
    }
    return best;
  }

  // Block setzen UND im Mehrspieler an den Server melden (nur Spieler-Aktionen —
  // Simulations-Kaskaden laufen auf jedem Client deterministisch selbst)
  _editBlock(x, y, z, id) {
    const w = this.world;
    w.setBlock(x, y, z, id);
    this.ctx.net?.sendEdits([[x, y, z, id]]);
  }

  // Das gehaltene Item durch ein anderes ersetzen (Eimer füllen/leeren).
  // Im Kreativmodus bleibt der Eimer unverändert (unbegrenzt nutzbar).
  _swapHeld(newId) {
    if (this.ctx.state.mode === 'creative') return;
    const inv = this.ctx.inventory;
    const s = inv.slots[inv.hotbarIndex];
    if (!s) return;
    if (s.count > 1) { // Eimer sind eigentlich nicht stapelbar — Sicherheitsfall
      s.count--;
      if (inv.addItem(newId, 1) > 0) {
        this.ctx.entities.dropSynced(this.pos.x, this.pos.y + 1, this.pos.z, newId, 1);
      }
    } else {
      inv.slots[inv.hotbarIndex] = { id: newId, count: 1 };
    }
    inv.refreshHotbar();
  }

  // Schriftrolle aktivieren: 5 Minuten Wirkung
  activateScroll(art) {
    this.effects[art] = 300;
    const NAMEN = {
      mining: '⛏ Schürfblick: Erze leuchten 5 Minuten durch das Gestein!',
      water: '🌊 Wasseratmung: 5 Minuten Luft unter Wasser!',
      levitation: '🕊 Levitation: 5 Minuten fliegen (2× Leertaste)!',
    };
    if (art === 'levitation') this.flying = true;
    this.ctx.ui.toast(NAMEN[art]);
    this.ctx.sounds.pickup();
    this.ctx.sounds.fuse();
  }

  // Effekt-Timer + goldene Erz-Umrisse (durch Wände sichtbar) pflegen
  _updateEffects(dt) {
    const fx = this.effects;
    if (fx.slow > 0) fx.slow = Math.max(0, fx.slow - dt); // Boss-Brüllen: läuft still ab
    if (fx.resist > 0) fx.resist = Math.max(0, fx.resist - dt); // Heiltrank-Schutz: läuft still ab
    if (fx.speed > 0) fx.speed = Math.max(0, fx.speed - dt); // Speed-Trank: läuft still ab
    for (const k of ['mining', 'water', 'levitation']) {
      if (fx[k] <= 0) continue;
      fx[k] -= dt;
      if (fx[k] <= 0) {
        fx[k] = 0;
        if (k === 'levitation' && this.ctx.state.mode !== 'creative') this.flying = false;
        this.ctx.ui.toast('Die Zauberwirkung verfliegt …');
      }
    }
    // Erz-Umrisse: während des Schürfblicks jede Sekunde neu einsammeln
    if (fx.mining > 0) {
      this._oreScanTimer -= dt;
      if (this._oreScanTimer <= 0) {
        this._oreScanTimer = 1;
        this._rebuildOreOutlines();
      }
    } else if (this._oreLines) {
      this.ctx.scene.remove(this._oreLines);
      this._oreLines.geometry.dispose();
      this._oreLines.material.dispose();
      this._oreLines = null;
    }
  }

  _rebuildOreOutlines() {
    const ERZE = new Set([BLOCK.COAL_ORE, BLOCK.IRON_ORE, BLOCK.GOLD_ORE, BLOCK.DIAMOND_ORE, BLOCK.EMERALD_ORE, BLOCK.SAPPHIRE_ORE, BLOCK.FLUX_ORE]);
    const w = this.world;
    const px = Math.floor(this.pos.x), py = Math.floor(this.pos.y), pz = Math.floor(this.pos.z);
    const pos = [];
    const R = 12;
    for (let y = Math.max(1, py - R); y <= py + R; y++) {
      for (let z = pz - R; z <= pz + R; z++) {
        for (let x = px - R; x <= px + R; x++) {
          if (!ERZE.has(w.getBlock(x, y, z))) continue;
          // 12 Kanten des Blockwürfels
          const k = 0.02, a = [x + k, y + k, z + k], b = [x + 1 - k, y + 1 - k, z + 1 - k];
          const E = [
            [a[0],a[1],a[2], b[0],a[1],a[2]], [a[0],b[1],a[2], b[0],b[1],a[2]],
            [a[0],a[1],b[2], b[0],a[1],b[2]], [a[0],b[1],b[2], b[0],b[1],b[2]],
            [a[0],a[1],a[2], a[0],b[1],a[2]], [b[0],a[1],a[2], b[0],b[1],a[2]],
            [a[0],a[1],b[2], a[0],b[1],b[2]], [b[0],a[1],b[2], b[0],b[1],b[2]],
            [a[0],a[1],a[2], a[0],a[1],b[2]], [b[0],a[1],a[2], b[0],a[1],b[2]],
            [a[0],b[1],a[2], a[0],b[1],b[2]], [b[0],b[1],a[2], b[0],b[1],b[2]],
          ];
          for (const e of E) pos.push(...e);
        }
      }
    }
    if (!this._oreLines) {
      const mat = new THREE.LineBasicMaterial({
        color: 0xffd24a, depthTest: false, transparent: true, opacity: 0.9,
      });
      this._oreLines = new THREE.LineSegments(new THREE.BufferGeometry(), mat);
      this._oreLines.renderOrder = 999;
      this._oreLines.frustumCulled = false;
      this.ctx.scene.add(this._oreLines);
    }
    this._oreLines.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  }

  // 1 Stück des gewählten Items (bzw. das ganze Ausrüstungsteil) in Blickrichtung werfen
  dropSelected() {
    const inv = this.ctx.inventory;
    const s = inv.selectedItem();
    if (!s) return;
    let stack;
    if (s.count <= 1) {
      stack = s;
      inv.slots[inv.hotbarIndex] = null;
    } else {
      s.count--;
      stack = { id: s.id, count: 1 };
    }
    inv.refreshHotbar();
    const eye = this._eyePos(this._eye);
    const dir = this._viewDir(this._dir);
    const d = this.ctx.entities.dropSynced(
      eye.x + dir.x * 0.4, eye.y - 0.25, eye.z + dir.z * 0.4, stack);
    d.vel.set(dir.x * 6.5, dir.y * 6.5 + 2.2, dir.z * 6.5);
    d.pickupDelay = 1.5; // nicht sofort wieder einsammeln
    this._startSwing();
  }

  _rightAction() {
    const held = this.heldId();
    // Bogen: Rechtsklick-Halten spannt (Loslassen schießt in mouseup/_releaseBow).
    // _rightAction wird beim Halten alle 0.25 s erneut aufgerufen — drawTimer
    // darum nur beim ersten Mal zurücksetzen, sonst lädt der Bogen nie auf.
    if (held === ITEM.BOW) {
      if (!this._drawing) {
        const creative = this.ctx.state.mode === 'creative';
        if (creative || this.ctx.inventory.countItem(ITEM.ARROW) > 0) {
          this._drawing = true;
          this.drawTimer = 0;
        } else {
          this.ctx.ui.toast?.('Keine Pfeile!');
        }
      }
      return;
    }
    const t = this.target;
    // Schere: Schaf im Fadenkreuz scheren
    if (held === ITEM.SHEARS) {
      const eye = this._eyePos(this._eye);
      const dir = this._viewDir(this._dir);
      const reach = REACH - 1 + equipStats(this.ctx.inventory.selectedItem()).reach;
      const hit = this.ctx.entities.raycast(eye, dir, reach);
      if (hit && hit.entity.type === 'sheep' && hit.entity.hasWool) {
        if (hit.entity.remoteNet) {
          // Gast: der Host schert und broadcastet Wolle + Drop
          this.ctx.net?.sendUse(hit.entity.eid, 'schere');
          this.ctx.sounds.shear();
        } else {
          this.ctx.entities.shearSheep(hit.entity);
        }
        if (this.ctx.state.mode !== 'creative') this._damageHeld(1);
        this._startSwing();
        this.rightHeld = false;
        return;
      }
    }
    // Dorfbewohner im Fadenkreuz → Handel öffnen (nicht beim Schleichen)
    if (!this.keys.ShiftLeft) {
      const eye = this._eyePos(this._eye);
      const dir = this._viewDir(this._dir);
      const reach = REACH - 1 + equipStats(this.ctx.inventory.selectedItem()).reach;
      const hit = this.ctx.entities.raycast(eye, dir, reach);
      if (hit && hit.entity.type === 'villager' && hit.entity.dying <= 0) {
        this.ctx.inventory.open('trade', hit.entity);
        this._startSwing();
        this.rightHeld = false;
        return;
      }
    }
    // Zucht: passendes Futter am Tier im Fadenkreuz → verlieben (Herzchen)
    if (held != null && this.ctx.entities.isAnyBreedFood(held) && !this.keys.ShiftLeft) {
      const eye = this._eyePos(this._eye);
      const dir = this._viewDir(this._dir);
      const reach = REACH - 1 + equipStats(this.ctx.inventory.selectedItem()).reach;
      const hit = this.ctx.entities.raycast(eye, dir, reach);
      if (hit && this.ctx.entities.breedFoodFor(hit.entity.type, held)) {
        const e = hit.entity;
        let fed;
        if (e.remoteNet) {
          // Gast: der Host verliebt das Tier & synchronisiert es zurück
          fed = this.ctx.entities.canBreed(e) || e.baby;
          if (fed) { this.ctx.net?.sendUse(e.eid, 'feed'); this.ctx.entities._heartBurst(e); }
        } else {
          fed = this.ctx.entities.feed(e);
        }
        if (fed && this.ctx.state.mode !== 'creative') this.ctx.inventory.consumeSelected(1);
        this._startSwing();
        this.rightHeld = false;
        return; // klickt ein Tier an → nie stattdessen essen/pflanzen
      }
    }
    // interact: crafting table / anvil (unless sneaking)
    if (t && t.id === BLOCK.CRAFTING_TABLE && !this.keys.ShiftLeft) {
      this.ctx.inventory.open(true);
      this.rightHeld = false;
      return;
    }
    if (t && t.id === BLOCK.ANVIL && !this.keys.ShiftLeft) {
      this.ctx.inventory.open('anvil');
      this.rightHeld = false;
      return;
    }
    if (t && (t.id === BLOCK.FURNACE || t.id === BLOCK.FURNACE_ON) && !this.keys.ShiftLeft) {
      this.ctx.inventory.open('furnace', { x: t.x, y: t.y, z: t.z });
      this.rightHeld = false;
      return;
    }
    if (t && t.id === BLOCK.BREWING_STAND && !this.keys.ShiftLeft) {
      this.ctx.inventory.open('brewing', { x: t.x, y: t.y, z: t.z });
      this.rightHeld = false;
      return;
    }
    if (t && t.id === BLOCK.WASHER && !this.keys.ShiftLeft) {
      this.ctx.inventory.open('washer', { x: t.x, y: t.y, z: t.z });
      this.rightHeld = false;
      return;
    }
    // Redstone: Hebel umschalten / Knopf drücken (das Redstone-System reagiert)
    if (t && (t.id === BLOCK.LEVER || t.id === BLOCK.LEVER_ON)) {
      this._editBlock(t.x, t.y, t.z, t.id === BLOCK.LEVER ? BLOCK.LEVER_ON : BLOCK.LEVER);
      this.ctx.sounds.door();
      this.rightHeld = false;
      return;
    }
    if (t && t.id === BLOCK.BUTTON) {
      this._editBlock(t.x, t.y, t.z, BLOCK.BUTTON_ON); // Redstone-System stellt nach kurzer Zeit zurück
      this.ctx.sounds.door();
      this.rightHeld = false;
      return;
    }
    if (t && t.id === BLOCK.CHEST && !this.keys.ShiftLeft) {
      this.ctx.inventory.open('chest', { x: t.x, y: t.y, z: t.z });
      this.rightHeld = false;
      return;
    }
    // Versiegelte Tempel-Truhe: startet das Wellen-Ereignis
    if (t && t.id === BLOCK.LOOT_CHEST) {
      this.ctx.blocks.triggerLootChest(t.x, t.y, t.z);
      this.rightHeld = false;
      return;
    }
    // Kiesel (Land + Unterwasser): Rechtsklick hebt sie direkt auf
    if (t && BLOCKS[t.id]?.pebbles) {
      // Unterwasser-Kiesel hinterlassen Wasser statt Luft
      this._editBlock(t.x, t.y, t.z, t.id === BLOCK.PEBBLES_WET ? BLOCK.WATER : BLOCK.AIR);
      const übrig = this.ctx.inventory.addItemStack({ id: ITEM.PEBBLE, count: 1 });
      if (übrig > 0) this.ctx.entities.dropSynced(t.x + 0.5, t.y + 0.3, t.z + 0.5, ITEM.PEBBLE, übrig);
      this.ctx.sounds.pickup();
      this.rightHeld = false;
      return;
    }
    // Magier-/Schiffs-/Dungeon-Truhe: füllt sich beim ersten Öffnen mit Beute
    if (t && (t.id === BLOCK.TOWER_CHEST || t.id === BLOCK.WRECK_CHEST || t.id === BLOCK.DUNGEON_CHEST)) {
      if (t.id === BLOCK.TOWER_CHEST) this.ctx.blocks.openTowerChest(t.x, t.y, t.z);
      else if (t.id === BLOCK.WRECK_CHEST) this.ctx.blocks.openWreckChest(t.x, t.y, t.z);
      else this.ctx.blocks.openDungeonChest(t.x, t.y, t.z);
      this.ctx.inventory.open('chest', { x: t.x, y: t.y, z: t.z });
      this.rightHeld = false;
      return;
    }
    // Schriftrollen: Rechtsklick aktiviert 5 Minuten Zauberwirkung
    if (held != null && ITEMS[held]?.scroll) {
      this.activateScroll(ITEMS[held].scroll);
      if (this.ctx.state.mode !== 'creative') this.ctx.inventory.consumeSelected(1);
      this.rightHeld = false;
      return;
    }
    // Tür öffnen/schließen (beide Hälften togglen)
    if (t && BLOCKS[t.id]?.door && !this.keys.ShiftLeft) {
      const lowerY = BLOCKS[t.id].door === 'lower' ? t.y : t.y - 1;
      const lo = this.world.getBlock(t.x, lowerY, t.z);
      const up = this.world.getBlock(t.x, lowerY + 1, t.z);
      if (BLOCKS[lo]?.door && BLOCKS[up]?.door) {
        this._editBlock(t.x, lowerY, t.z, toggledDoorId(lo));
        this._editBlock(t.x, lowerY + 1, t.z, toggledDoorId(up));
        this.ctx.sounds.door();
      }
      this.rightHeld = false;
      return;
    }
    // Falltür togglen
    if (t && BLOCKS[t.id]?.trapdoor && !this.keys.ShiftLeft) {
      if (BLOCKS[t.id].trapdoor === 'closed') {
        // öffnet weg vom Spieler: Paneel an der fernen Kante
        const dx = t.x + 0.5 - this.pos.x, dz = t.z + 0.5 - this.pos.z;
        const dir = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'E' : 'W') : (dz > 0 ? 'S' : 'N');
        this._editBlock(t.x, t.y, t.z, BLOCK['TRAPDOOR_OPEN_' + dir]);
      } else {
        this._editBlock(t.x, t.y, t.z, BLOCK.TRAPDOOR);
      }
      this.ctx.sounds.door();
      this.rightHeld = false;
      return;
    }
    // Bett: Spawnpunkt setzen, nachts schlafen (Bild wird schwarz, Nacht wird übersprungen)
    if (t && BLOCKS[t.id]?.bed && !this.keys.ShiftLeft) {
      this.spawnPoint = { x: t.x, y: t.y + 1, z: t.z };
      if (this.ctx.daynight.isNight()) {
        this.ctx.ui.sleep(() => {
          const L = Rules.dayLengthSec;
          const day = Math.floor(this.ctx.state.time / L);
          this.ctx.state.time = (day + 1) * L + Rules.startFraction * L;
          this.ctx.net?.sendTime(this.ctx.state.time); // Morgen für alle Mitspieler
        });
        this.ctx.ui.toast('Spawnpunkt gesetzt');
      } else {
        this.ctx.ui.toast('Spawnpunkt gesetzt — schlafen geht nur nachts');
      }
      this.rightHeld = false;
      return;
    }
    // Knochenmehl auf einen Setzling: Wachstumsschub
    if (t && held === ITEM.BONE_MEAL && isSaplingId(t.id)) {
      if (this.ctx.flora.bonemeal(t.x, t.y, t.z)) {
        if (this.ctx.state.mode !== 'creative') this.ctx.inventory.consumeSelected(1);
        this.ctx.sounds.pickup();
      }
      this.rightHeld = false;
      return;
    }
    // Feuerzeug auf TNT: zünden!
    if (t && held === ITEM.FLINT_AND_STEEL && t.id === BLOCK.TNT) {
      this._editBlock(t.x, t.y, t.z, BLOCK.AIR);
      this.ctx.entities.spawnPrimedTnt(t.x, t.y, t.z, 4);
      if (this.ctx.state.mode !== 'creative') this._damageHeld(1);
      this.rightHeld = false;
      return;
    }
    // Leerer Eimer: an einer Wasser-/Lavaquelle füllen (eigener Fluid-Raycast)
    if (held === ITEM.BUCKET) {
      const eye = this._eyePos(this._eye);
      const dir = this._viewDir(this._dir);
      const reach = REACH - 1 + equipStats(this.ctx.inventory.selectedItem()).reach;
      const fh = raycastVoxel(this.world, eye, dir, reach, true); // hält an Flüssigkeit
      if (fh && (fh.id === BLOCK.WATER || fh.id === BLOCK.LAVA)) {
        this._editBlock(fh.x, fh.y, fh.z, BLOCK.AIR); // Quelle aufnehmen (synchronisiert)
        this._swapHeld(fh.id === BLOCK.WATER ? ITEM.WATER_BUCKET : ITEM.LAVA_BUCKET);
        this.ctx.sounds.pickup();
        this._startSwing();
      }
      this.rightHeld = false;
      return;
    }
    // Gefüllter Eimer: Flüssigkeit ausleeren (Eimer wird leer)
    if (held === ITEM.WATER_BUCKET || held === ITEM.LAVA_BUCKET) {
      if (t) {
        const bx = t.x + t.nx, by = t.y + t.ny, bz = t.z + t.nz;
        const cur = this.world.getBlock(bx, by, bz);
        if (cur === BLOCK.AIR || (cur > 0 && BLOCKS[cur]?.cross && !BLOCKS[cur]?.waterPlant)) {
          this._editBlock(bx, by, bz, held === ITEM.WATER_BUCKET ? BLOCK.WATER : BLOCK.LAVA);
          this._swapHeld(ITEM.BUCKET);
          this.ctx.sounds.pickup();
          this._startSwing();
        }
      }
      this.rightHeld = false;
      return;
    }
    // Harke: Erde/Gras zu Ackerland machen (nur mit freiem Platz darüber)
    if (t && ITEMS[held]?.hoe) {
      const tillbar = t.id === BLOCK.DIRT || GRASSY.includes(t.id);
      if (tillbar && this.world.getBlock(t.x, t.y + 1, t.z) === BLOCK.AIR) {
        this._editBlock(t.x, t.y, t.z, BLOCK.FARMLAND);
        if (this.ctx.state.mode !== 'creative') this._damageHeld(1);
        this.ctx.sounds.pickup();
        this._startSwing();
      }
      this.rightHeld = false;
      return;
    }
    // Saat/Setzgut auf Ackerland pflanzen (Weizensamen, Karotten, Kartoffeln)
    if (t && held != null && ITEMS[held]?.plant != null &&
        (t.id === BLOCK.FARMLAND || t.id === BLOCK.FARMLAND_WET) &&
        this.world.getBlock(t.x, t.y + 1, t.z) === BLOCK.AIR) {
      this._editBlock(t.x, t.y + 1, t.z, ITEMS[held].plant);
      if (this.ctx.state.mode !== 'creative') this.ctx.inventory.consumeSelected(1);
      this.ctx.sounds.pickup();
      this._startSwing();
      this.rightHeld = false;
      return;
    }
    // eating handled continuously in update()
    if (held != null && ITEMS[held]?.food) return;
    // place block
    if (t && held != null && isBlockId(held)) {
      const bx = t.x + t.nx, by = t.y + t.ny, bz = t.z + t.nz;
      const cur = this.world.getBlock(bx, by, bz);
      if (cur !== BLOCK.AIR && !isLiquid(cur) && !(cur > 0 && BLOCKS[cur]?.cross)) return;
      // Zuckerrohr nur auf Gras/Erde/Sand (oder Zuckerrohr) platzieren
      if (held === BLOCK.SUGAR_CANE) {
        const unter = this.world.getBlock(bx, by - 1, bz);
        if (![BLOCK.GRASS, BLOCK.DIRT, BLOCK.SAND, BLOCK.SUGAR_CANE].includes(unter)) return;
      }
      // Setzlinge nur auf Gras-/Erdboden
      if (isSaplingId(held)) {
        const unter = this.world.getBlock(bx, by - 1, bz);
        if (unter !== BLOCK.DIRT && !GRASSY.includes(unter)) return;
      }
      // Teppich & Kiesel brauchen einen Boden darunter
      if ((isCarpetId(held) || held === BLOCK.PEBBLES) &&
          !isSolid(this.world.getBlock(bx, by - 1, bz))) return;
      // Wasserpflanzen nur in Wasser, mit Halt darunter (Kelp auch auf Kelp)
      if (BLOCKS[held]?.waterPlant) {
        if (!isWaterId(cur)) return;
        const unter = this.world.getBlock(bx, by - 1, bz);
        if (!isSolid(unter) && !(held === BLOCK.KELP && unter === BLOCK.KELP)) return;
      }
      // Fackel braucht einen soliden Block darunter
      if (held === BLOCK.TORCH && !isSolid(this.world.getBlock(bx, by - 1, bz))) return;
      // Redstone-Leitung, Hebel, Knopf brauchen einen soliden Block darunter
      if ((held === BLOCK.REDSTONE_DUST || BLOCKS[held]?.redstone === 'lever' || BLOCKS[held]?.redstone === 'button')
          && !isSolid(this.world.getBlock(bx, by - 1, bz))) return;
      // Kaktus nur auf Sand/Kaktus, Kaktusblüte nur auf Kaktus, Busch auf trockenem Boden
      if (held === BLOCK.CACTUS) {
        const unter = this.world.getBlock(bx, by - 1, bz);
        if (![BLOCK.SAND, BLOCK.RED_SAND, BLOCK.CACTUS].includes(unter)) return;
      }
      if (held === BLOCK.CACTUS_FLOWER && this.world.getBlock(bx, by - 1, bz) !== BLOCK.CACTUS) return;
      if (held === BLOCK.SHRUB) {
        const unter = this.world.getBlock(bx, by - 1, bz);
        if (![BLOCK.SAND, BLOCK.RED_SAND, BLOCK.DIRT, BLOCK.TERRACOTTA].includes(unter) &&
            !GRASSY.includes(unter)) return;
      }
      // Lianen brauchen einen soliden Nachbarn (oben oder seitlich)
      if (held === BLOCK.VINE) {
        let halt = false;
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
          const nb = this.world.getBlock(bx + dx, by + dy, bz + dz);
          if (isSolid(nb) || nb === BLOCK.VINE) { halt = true; break; }
        }
        if (!halt) return;
      }
      // Leiter nur an eine Wand (irgendein solider horizontaler Nachbar)
      if (held === BLOCK.LADDER) {
        let wand = false;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nb = this.world.getBlock(bx + dx, by, bz + dz);
          if (nb > 0 && BLOCKS[nb]?.opaque !== false) { wand = true; break; }
        }
        if (!wand) return;
      }
      if (aabbIntersectsBlock(this.pos, this.width, this.height, bx, by, bz)) return;
      if (entitiesOverlapBlock(this.ctx.entities.list, bx, by, bz)) return;

      // Ausrichtungs-/Mehrzell-Blöcke
      let placeId = held;
      // Decke getroffen oder obere Hälfte einer Seitenfläche → Über-Kopf-Variante
      const hitUpper = t.ny === -1 || (t.ny === 0 && (t.py - t.y) > 0.5);
      if (isStairsId(held)) {
        // Aufstieg in Blickrichtung: hohe Hälfte liegt vom Spieler weg
        const dir = yawToCardinal(this.yaw);
        const mat = BLOCKS[held].matBase; // Holzart/Material der gehaltenen Treppe
        placeId = BLOCK[mat + '_' + dir + (hitUpper ? '_TOP' : '')];
      } else if (isSlabId(held)) {
        const mat = BLOCKS[held].matBase; // Holzart/Material der gehaltenen Stufe
        placeId = BLOCK[mat + (hitUpper ? '_TOP' : '')];
      } else if (BLOCKS[held]?.redstone === 'piston') {
        const pre = BLOCKS[held].sticky ? 'STICKY_PISTON_' : 'PISTON_';
        // Kolben schiebt in Blickrichtung; steiler Blick (>45°) → nach oben/unten
        const face = this.pitch > Math.PI / 4 ? 'UP' : this.pitch < -Math.PI / 4 ? 'DOWN' : yawToCardinal(this.yaw);
        placeId = BLOCK[pre + face];
      } else if (BLOCKS[held]?.door) {
        // Tür: 2 Zellen hoch, Paneel-Kante zeigt zum Spieler
        if (!isSolid(this.world.getBlock(bx, by - 1, bz))) return;
        const oben = this.world.getBlock(bx, by + 1, bz);
        if (oben !== BLOCK.AIR && !(oben > 0 && BLOCKS[oben]?.cross)) return;
        const dir = yawToCardinal(this.yaw); // Kardinal Richtung Spieler = Gegenrichtung des Blicks
        this._editBlock(bx, by, bz, doorId('lower', CARDINAL_OPP[dir]));
        this._editBlock(bx, by + 1, bz, doorId('upper', CARDINAL_OPP[dir]));
        if (this.ctx.state.mode !== 'creative') this.ctx.inventory.consumeSelected(1);
        this.ctx.sounds.blockPlace();
        return;
      } else if (BLOCKS[held]?.bed) {
        // Bett: Fußteil hier, Kopfteil in Blickrichtung
        const dir = yawToCardinal(this.yaw);
        const [dx, dz] = CARDINAL_DELTA[dir];
        const hx = bx + dx, hz = bz + dz;
        const kopfZelle = this.world.getBlock(hx, by, hz);
        if (kopfZelle !== BLOCK.AIR && !(kopfZelle > 0 && BLOCKS[kopfZelle]?.cross)) return;
        if (!isSolid(this.world.getBlock(bx, by - 1, bz)) || !isSolid(this.world.getBlock(hx, by - 1, hz))) return;
        if (entitiesOverlapBlock(this.ctx.entities.list, hx, by, hz)) return;
        this._editBlock(bx, by, bz, BLOCK.BED_FOOT);
        this._editBlock(hx, by, hz, BLOCK.BED_HEAD);
        if (this.ctx.state.mode !== 'creative') this.ctx.inventory.consumeSelected(1);
        this.ctx.sounds.blockPlace();
        return;
      }

      this._editBlock(bx, by, bz, placeId);
      if (isSaplingId(held)) this.ctx.flora.addSapling(bx, by, bz);
      if (BLOCKS[held]?.leaves) this.ctx.flora.markPlaced(bx, by, bz); // Spieler-Laub zerfällt nie
      if (this.ctx.state.mode !== 'creative') this.ctx.inventory.consumeSelected(1);
      this.ctx.sounds.blockPlace();
    }
  }

  _resetMining() {
    this.miningKey = null;
    this.miningProgress = 0;
    this.ctx.ui.setMiningProgress(0);
  }

  _updateMining(dt) {
    const t = this.target;
    if (!this.leftHeld || !t) { if (this.miningKey) this._resetMining(); return; }
    const key = t.x + ',' + t.y + ',' + t.z;
    if (key !== this.miningKey) {
      this.miningKey = key;
      this.miningProgress = 0;
    }
    const creative = this.ctx.state.mode === 'creative';
    const time = creative ? 0.05 : miningTimeFor(BLOCKS[t.id], this.ctx.inventory.selectedItem());
    if (!isFinite(time)) { this.ctx.ui.setMiningProgress(0); return; }
    this._startSwing(); // Arm schwingt, solange abgebaut wird
    this.miningProgress += dt / Math.max(0.05, time);
    this.ctx.ui.setMiningProgress(Math.min(1, this.miningProgress));
    if (this.miningProgress >= 1) {
      const def = BLOCKS[t.id];
      // Wasserpflanzen hinterlassen Wasser statt Luft
      this._editBlock(t.x, t.y, t.z, def.waterPlant ? BLOCK.WATER : BLOCK.AIR);
      this.ctx.sounds.blockBreak();
      this.ctx.survival.addExhaustion(0.02);
      if (!creative) { // kein Drop im Kreativmodus
        const held = this.ctx.inventory.selectedItem();
        const level = toolLevelFor(held, def.tool);
        if (level >= (def.harvestLevel ?? 0)) {
          if (def.crop) {
            // Ernte: reif → Ertrag (1–3) + evtl. Samen; unreif → nur der Samen zurück
            const c = def.crop;
            if (c.mature) {
              this.ctx.entities.dropSynced(t.x + 0.5, t.y + 0.4, t.z + 0.5, c.produce, 1 + (Math.random() * 3 | 0));
              if (c.seed !== c.produce && Math.random() < 0.85) {
                this.ctx.entities.dropSynced(t.x + 0.5, t.y + 0.6, t.z + 0.5, c.seed, 1 + (Math.random() * 2 | 0));
              }
            } else {
              this.ctx.entities.dropSynced(t.x + 0.5, t.y + 0.4, t.z + 0.5, c.seed, 1);
            }
          } else if (def.dropTable) {
            // Laub: mehrere Zufalls-Drops (Apfel/Setzling/Stock)
            this.ctx.flora.dropLeafLoot(t.id, t.x, t.y, t.z);
          } else {
            let dropId = def.drops ?? t.id;
            // Alternativ-Drop (z. B. Kies → 10% Feuerstein)
            if (def.dropAlt && Math.random() < def.dropAlt.chance) dropId = def.dropAlt.id;
            const chance = def.dropChance ?? 1;
            if (dropId && Math.random() < chance) {
              this.ctx.entities.dropSynced(t.x + 0.5, t.y + 0.5, t.z + 0.5, dropId, 1);
            }
          }
          // XP fürs Abbauen von Erzen (lokal — jeder Client zählt sein eigenes)
          this.ctx.experience?.addForOre(t.id);
        }
        // Werkzeug-Verschleiß (nur bei echtem Abbau)
        if (def.hardness >= 0.1) this._damageHeld(1);
      }
      this._resetMining();
    }
  }

  _updateEating(dt) {
    if (this.ctx.state.mode !== 'survival') { this._consuming = false; return; }
    const held = this.heldId();
    const food = held != null ? ITEMS[held]?.food : null;
    const potDef = held != null ? ITEMS[held]?.potion : null;
    const isPotion = !!potDef;
    // essen nur bei Hunger; Trank immer trinkbar
    const consuming = this.rightHeld && ((food && this.ctx.survival.hunger < 20) || isPotion);
    this._consuming = consuming;
    this._consumeIsDrink = consuming && isPotion;
    if (consuming) {
      const time = isPotion ? 1.6 : 1.2; // Trinken dauert etwas länger
      this.eatTimer += dt;
      this.ctx.ui.setMiningProgress(Math.min(1, this.eatTimer / time));
      if (this.eatTimer >= time) {
        if (isPotion) {
          if (potDef.heal) this.ctx.survival.heal(potDef.heal);   // Herzen
          if (potDef.resist) this.effects.resist = potDef.resist; // Schadensschutz
          if (potDef.cleanse) this.effects.slow = 0;              // negative Effekte entfernen
          if (potDef.speed) this.effects.speed = potDef.speed;    // Tempo-Boost
          this.ctx.sounds.eat();
          this.ctx.ui?.toast?.(potDef.label || 'Trank getrunken');
        } else {
          this.ctx.survival.eat(food);
        }
        this.ctx.inventory.consumeSelected(1);
        this.eatTimer = 0;
        this.ctx.ui.setMiningProgress(0);
      }
    } else if (this.eatTimer > 0) {
      this.eatTimer = 0;
      if (!this.leftHeld) this.ctx.ui.setMiningProgress(0);
    }
  }

  update(dt) {
    const s = this.ctx.state;
    // safety net: recover from any corrupted position instead of crashing the loop
    if (!isFinite(this.pos.x + this.pos.y + this.pos.z)) {
      console.error('Ungültige Spielerposition — setze auf letzte gültige Position zurück');
      this.pos.copy(this._lastGoodPos ?? new THREE.Vector3(0.5, 320, 0.5));
      this.vel.set(0, 0, 0);
    } else {
      (this._lastGoodPos ??= new THREE.Vector3()).copy(this.pos);
    }
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    const active = this.playable;

    // --- movement input ---
    const wish = this._wish.set(0, 0, 0);
    if (active) {
      if (this.keys.KeyW) wish.z -= 1;
      if (this.keys.KeyS) wish.z += 1;
      if (this.keys.KeyA) wish.x -= 1;
      if (this.keys.KeyD) wish.x += 1;
      if (this.keys.ControlLeft && this.keys.KeyW) this.sprinting = true;
    }
    if (!this.keys.KeyW || wish.z >= 0) this.sprinting = false;
    if (wish.lengthSq() > 0) {
      wish.normalize();
      // rotate by yaw
      const c = Math.cos(this.yaw), sn = Math.sin(this.yaw);
      const wx = wish.x * c + wish.z * sn;
      const wz = -wish.x * sn + wish.z * c;
      wish.set(wx, 0, wz);
    }
    this._updateEffects(dt);
    const creative = s.mode === 'creative';
    const spectator = s.spectator;
    const isFlying = spectator || ((creative || this.effects.levitation > 0 || this.modFly) && this.flying);
    const speedMult = (creative ? Settings.creativeSpeed : 1)
      * (this.effects.slow > 0 ? 0.42 : 1)
      * (this.effects.speed > 0 ? 1.3 : 1); // Speed-Trank: 30 % schneller

    if (isFlying) {
      // Flug: Leertaste hoch, Shift runter, keine Schwerkraft
      const flySpeed = (this.sprinting ? 22 : 11) * speedMult;
      const accel = 45;
      const tx = wish.x * flySpeed, tz = wish.z * flySpeed;
      let ty = 0;
      if (active && this.keys.Space) ty = flySpeed;
      else if (active && this.keys.ShiftLeft) ty = -flySpeed;
      this.vel.x += Math.max(-accel * dt, Math.min(accel * dt, tx - this.vel.x));
      this.vel.z += Math.max(-accel * dt, Math.min(accel * dt, tz - this.vel.z));
      this.vel.y += Math.max(-accel * dt, Math.min(accel * dt, ty - this.vel.y));
      this.fallDistance = 0;
      if (spectator) {
        // Noclip: direkt bewegen, keine Kollisionen
        this.pos.addScaledVector(this.vel, Math.min(dt, 1 / 20));
        this.onGround = false;
        this.inWater = false;
      } else {
        stepEntity(this.world, this, dt, { noGravity: true });
        this.fallDistance = 0;
      }
    } else {
      let speed = (this.sprinting ? SPRINT_SPEED : this.keys.ShiftLeft ? SNEAK_SPEED : WALK_SPEED) * speedMult;
      if (this.inWater) speed *= 0.6;
      const accel = this.inWater ? 25 : this.onGround ? 45 : 12;
      const tx = wish.x * speed, tz = wish.z * speed;
      this.vel.x += Math.max(-accel * dt, Math.min(accel * dt, tx - this.vel.x));
      this.vel.z += Math.max(-accel * dt, Math.min(accel * dt, tz - this.vel.z));

      if (active && this.keys.Space) {
        if (this.inWater) {
          this.vel.y += Math.min(SWIM_UP_SPEED - this.vel.y, 30 * dt);
        } else if (this.onGround) {
          this.vel.y = JUMP_SPEED;
          this.ctx.survival.addExhaustion(0.2);
          this.ctx.sounds.jump();
        }
      }
      if (this.sprinting && wish.lengthSq() > 0) this.ctx.survival.addExhaustion(0.1 * dt);

      // --- Leiter-Klettern & Spinnennetze ---
      const feetId = this.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.1), Math.floor(this.pos.z));
      const midId = this.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 1.2), Math.floor(this.pos.z));
      if (BLOCKS[feetId]?.web || BLOCKS[midId]?.web) {
        // im Netz: zäh wie Sirup, kein Fallschaden, langsames Durchsinken
        this.vel.x *= 0.25;
        this.vel.z *= 0.25;
        this.vel.y = Math.max(Math.min(this.vel.y, 1.0), -1.4);
        this.fallDistance = 0;
      }
      if (BLOCKS[feetId]?.climbable || BLOCKS[midId]?.climbable) {
        this.fallDistance = 0;
        if (active && (wish.lengthSq() > 0 || this.keys.Space)) {
          this.vel.y = 3.4; // hochklettern
        } else if (active && this.keys.ShiftLeft) {
          this.vel.y = Math.max(this.vel.y, 0); // festhalten
        } else {
          this.vel.y = Math.max(this.vel.y, -2.2); // langsam abrutschen
        }
      }

      // --- physics (Basis-Auto-Step für Stufen/Treppen/Teppiche, Gold-Hose erhöht) ---
      const aStats = armorStats(this.ctx.inventory?.armor);
      const res = stepEntity(this.world, this, dt, { stepHeight: 0.55 + aStats.stepHeight });
      const fallLimit = 3 + aStats.fallBonus;
      if (Rules.fallDamage && res.landed && res.fallDistance > fallLimit && s.mode === 'survival') {
        this.ctx.survival.damage(Math.floor(res.fallDistance - fallLimit), 'fall');
      }
      if (this.inWater && !this.wasInWater && this.vel.y < -4) this.ctx.sounds.splash();
      this.wasInWater = this.inWater;
    }

    // --- camera ---
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.position.set(this.pos.x, this.pos.y + PLAYER.EYE_HEIGHT, this.pos.z);
    const targetFov = this.sprinting && wish.lengthSq() > 0 ? 84 : 75;
    if (Math.abs(this.camera.fov - targetFov) > 0.1) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, 10 * dt);
      this.camera.updateProjectionMatrix();
    }

    // --- First-Person-Hand ---
    this._updateHand(dt, wish.lengthSq() > 0 && !isFlying);

    // --- dynamisches Fackel-Licht (mit leichtem Flackern) ---
    const w = this.ctx.world;
    const torchHeld = this.heldId() === BLOCK.TORCH && !spectator;
    const flicker = 0.92 + Math.sin(performance.now() * 0.011) * 0.05 + Math.sin(performance.now() * 0.037) * 0.03;
    const targetStr = torchHeld ? flicker : 0;
    w.dynLightStrength.value += (targetStr - w.dynLightStrength.value) * Math.min(1, 14 * dt);
    w.dynLightPos.value.set(this.pos.x, this.pos.y + PLAYER.EYE_HEIGHT, this.pos.z);
    this.torchLight.intensity = w.dynLightStrength.value * 18;
    this.torchLight.position.set(this.pos.x, this.pos.y + PLAYER.EYE_HEIGHT, this.pos.z);

    // --- targeting (Spectator interagiert nicht; Gold-Upgrade erhöht Reichweite) ---
    if (active && !spectator) {
      const eye = this._eyePos(this._eye);
      const dir = this._viewDir(this._dir);
      const reach = REACH + equipStats(this.ctx.inventory.selectedItem()).reach;
      this.target = raycastVoxel(this.world, eye, dir, reach);
      this.lookAt = this._computeLookAt(eye, dir, reach); // Fadenkreuz-Info fürs UI-Fenster
    } else {
      this.target = null;
      this.lookAt = null;
    }
    if (this.target) {
      this.selectionBox.visible = true;
      this.selectionBox.position.set(this.target.x + 0.5, this.target.y + 0.5, this.target.z + 0.5);
    } else {
      this.selectionBox.visible = false;
    }

    // --- actions ---
    if (active) {
      this._updateMining(dt);
      this._updateEating(dt);
      this._updateBow(dt);
      if (this.rightHeld) {
        this.placeTimer -= dt;
        if (this.placeTimer <= 0) {
          this._rightAction();
          this.placeTimer = 0.25;
        }
      }
    } else {
      if (this.miningKey) this._resetMining();
      this.eatTimer = 0;
      if (this._drawing) { this._drawing = false; this.drawTimer = 0; } // Pause → Spannung verwerfen
    }
  }

  respawnAt(x, y, z) {
    this.pos.set(x + 0.5, y + 0.1, z + 0.5);
    this.vel.set(0, 0, 0);
    this.fallDistance = 0;
    this.yaw = 0;
    this.pitch = 0;
  }

  serialize() {
    return {
      pos: [this.pos.x, this.pos.y, this.pos.z], yaw: this.yaw, pitch: this.pitch,
      spawnPoint: this.spawnPoint || null,
      effects: { ...this.effects },
    };
  }

  restore(data) {
    if (!data) return;
    this.pos.set(data.pos[0], data.pos[1], data.pos[2]);
    this.yaw = data.yaw ?? 0;
    this.pitch = data.pitch ?? 0;
    this.spawnPoint = data.spawnPoint || null;
    if (data.effects) this.effects = { mining: 0, water: 0, levitation: 0, slow: 0, resist: 0, speed: 0, ...data.effects };
    this.vel.set(0, 0, 0);
  }
}
