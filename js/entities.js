// Entity manager: pigs, zombies, skeletons, creepers, arrows, item drops.

import * as THREE from 'three';
import {
  BLOCK, ITEM, PIG_CAP, ZOMBIE_CAP, isBlockId, BLOCKS, ITEMS, GRASSY, isSolid, isLiquid,
  isWaterId,
} from './constants.js';
import { stepEntity } from './physics.js';
import { armorStats } from './equip.js';
import { biomeAt, villagesNear } from './worldgen.js';

const SLIME_CAP = 5; // max. Schleime pro Spieler-Umkreis

// ---- Zucht (Breeding) ----
const TRADES_PER_LEVEL = 2; // erfolgreiche Trades pro Handelslevel (schaltet je 1 Slot frei)
const LOVE_TIME = 25;       // Sekunden im "Verliebt"-Zustand (sucht Partner)
const BREED_COOLDOWN = 45;  // Abklingzeit nach dem Züchten
const BABY_GROW_TIME = 100; // bis ein Baby erwachsen ist (Skalierung 0.5 → 1)

const ITEM_LIFETIME = 360; // gedroppte Items despawnen nach 6 Minuten
const DESPAWN_DIST = 64;
const SKELETON_CAP = 4;
const CREEPER_CAP = 3;
const SHEEP_CAP = 6;
const CHICKEN_CAP = 6;
const FISH_CAP = 8;

// Weidetiere je Biom — nur in Biomen, in denen sie Sinn ergeben (kein Wüsten-/Ozean-/Berg-Spawn)
const LAND_ANIMALS = {
  ebene: ['pig', 'sheep', 'chicken'],
  blumenwiese: ['pig', 'sheep', 'chicken'],
  wald: ['pig', 'sheep', 'chicken'],
  birkenwald: ['pig', 'sheep', 'chicken'],
  savanne: ['pig', 'sheep', 'chicken'],
  tannenwald: ['pig', 'sheep', 'chicken'],
  gebirgsfuss: ['pig', 'sheep'],
  dschungel: ['pig', 'chicken'],       // Dschungel: Schweine & Hühner (typische Dschungeltiere)
  schneelandschaft: ['sheep'],          // Schnee: nur Schafe (Wolle passt zur Kälte)
  schneewald: ['sheep'],
};
const FUSE_TIME = 1.5;
const EXPLODE_RADIUS = 2.6;

function box(w, h, d, material, x, y, z, pivotTop = false) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (pivotTop) g.translate(0, -h / 2, 0);
  const m = new THREE.Mesh(g, material);
  m.position.set(x, y, z);
  return m;
}

export class EntityManager {
  constructor(ctx) {
    this.ctx = ctx;
    this.list = [];
    this.spawnTimer = 0;
    this._nextEid = 1;      // Netz-Kennungen (Host vergibt)
    this._remoteMap = new Map(); // eid → Remote-Entity (Nicht-Host)
    this._nextItemNet = 1;  // laufende Nummer für synchronisierte Item-Drops
    this._itemGeoCache = new Map();
    this._itemMat = new THREE.MeshLambertMaterial({
      map: ctx.textures.texture, alphaTest: 0.1, side: THREE.DoubleSide,
    });
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._telegraphs = []; // rote AoE-Telegraf-Kreise (auch bei Gästen, per Netz)
  }

  get count() { return this.list.length; }

  // ---- meshes ----

  _makePig() {
    const main = new THREE.MeshLambertMaterial({ color: 0xeda3a3 });
    const accent = new THREE.MeshLambertMaterial({ color: 0xd18787 });
    const g = new THREE.Group();
    g.add(box(0.62, 0.5, 0.95, main, 0, 0.6, 0));            // body
    const head = box(0.5, 0.5, 0.45, main, 0, 0.72, 0.62);   // head (faces +z)
    g.add(head);
    g.add(box(0.24, 0.18, 0.1, accent, 0, 0.66, 0.9));       // snout
    const legs = [];
    for (const [lx, lz] of [[-0.2, 0.32], [0.2, 0.32], [-0.2, -0.32], [0.2, -0.32]]) {
      const leg = box(0.18, 0.38, 0.18, accent, lx, 0.38, lz, true);
      legs.push(leg);
      g.add(leg);
    }
    return { group: g, legs, arms: [], materials: [main, accent] };
  }

  _makeZombie() {
    const skin = new THREE.MeshLambertMaterial({ color: 0x6b9c50 });
    const shirt = new THREE.MeshLambertMaterial({ color: 0x2c8577 });
    const pants = new THREE.MeshLambertMaterial({ color: 0x4a3f7a });
    const g = new THREE.Group();
    g.add(box(0.5, 0.72, 0.26, shirt, 0, 1.14, 0));          // torso
    g.add(box(0.48, 0.48, 0.48, skin, 0, 1.76, 0));          // head
    const legs = [];
    for (const lx of [-0.13, 0.13]) {
      const leg = box(0.22, 0.76, 0.24, pants, lx, 0.78, 0, true);
      legs.push(leg);
      g.add(leg);
    }
    const arms = [];
    for (const lx of [-0.36, 0.36]) {
      const arm = box(0.2, 0.2, 0.7, skin, lx, 1.35, 0.3);   // stretched forward
      arms.push(arm);
      g.add(arm);
    }
    return { group: g, legs, arms, materials: [skin, shirt, pants] };
  }

  // Boss: großer blutroter Zombie mit glühenden Augen (Grundmaß ~2 Blöcke, wird skaliert)
  _makeCrimsonZombie() {
    const skin = new THREE.MeshLambertMaterial({ color: 0x8e1f1a });   // blutrote Haut
    const shirt = new THREE.MeshLambertMaterial({ color: 0x4a0f10 });  // zerfetztes dunkelrotes Gewand
    const pants = new THREE.MeshLambertMaterial({ color: 0x281016 });  // fast schwarze Hose
    const eye = new THREE.MeshBasicMaterial({ color: 0xff3a24 });      // glühende Augen (immer hell)
    const g = new THREE.Group();
    g.add(box(0.72, 0.94, 0.42, shirt, 0, 1.2, 0));          // breiter Oberkörper
    g.add(box(0.62, 0.6, 0.6, skin, 0, 1.95, 0));            // massiger Kopf
    g.add(box(0.13, 0.1, 0.06, eye, -0.15, 1.99, 0.31));     // Augen
    g.add(box(0.13, 0.1, 0.06, eye, 0.15, 1.99, 0.31));
    const legs = [];
    for (const lx of [-0.19, 0.19]) {
      const leg = box(0.3, 0.9, 0.32, pants, lx, 0.9, 0, true);
      legs.push(leg); g.add(leg);
    }
    const arms = [];
    for (const lx of [-0.48, 0.48]) {
      const arm = box(0.28, 0.28, 0.9, skin, lx, 1.46, 0.36); // lange, nach vorn gestreckte Arme
      arms.push(arm); g.add(arm);
    }
    return { group: g, legs, arms, materials: [skin, shirt, pants] };
  }

  // Schleim: durchscheinender grüner Gel-Würfel mit Augen (hüpft im Sumpf)
  _makeSlime() {
    const gel = new THREE.MeshLambertMaterial({ color: 0x5ec85e, transparent: true, opacity: 0.78 });
    const eye = new THREE.MeshBasicMaterial({ color: 0x20401e });
    const g = new THREE.Group();
    g.add(box(0.9, 0.9, 0.9, gel, 0, 0.45, 0));            // Gel-Würfel
    g.add(box(0.12, 0.12, 0.05, eye, -0.18, 0.5, 0.46));   // Augen
    g.add(box(0.12, 0.12, 0.05, eye, 0.18, 0.5, 0.46));
    g.add(box(0.26, 0.08, 0.05, eye, 0, 0.32, 0.46));      // Mund
    return { group: g, legs: [], arms: [], materials: [gel] };
  }

  // Kleines 3D-Icon eines Mobs (dataURL, pro Typ gecacht) — fürs Fadenkreuz-Fenster
  getMobIcon(type) {
    if (!this._mobIconCache) this._mobIconCache = new Map();
    if (this._mobIconCache.has(type)) return this._mobIconCache.get(type);
    const renderer = this.ctx.renderer;
    if (!renderer) return null;
    const built =
      type === 'pig' ? this._makePig() :
      type === 'sheep' ? this._makeSheep() :
      type === 'chicken' ? this._makeChicken() :
      type === 'villager' ? this._makeVillager() :
      type === 'fish' ? this._makeFish() :
      type === 'skeleton' ? this._makeSkeleton() :
      type === 'creeper' ? this._makeCreeper() :
      type === 'crimson_zombie' ? this._makeCrimsonZombie() : this._makeZombie();
    const grp = built.group;
    const scene = new THREE.Scene();
    scene.add(grp);
    scene.add(new THREE.AmbientLight(0xffffff, 0.95));
    const dl = new THREE.DirectionalLight(0xffffff, 0.7); dl.position.set(0.6, 1.2, 1); scene.add(dl);
    const box3 = new THREE.Box3().setFromObject(grp);
    const size = box3.getSize(new THREE.Vector3());
    const center = box3.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    cam.position.set(center.x + maxDim * 0.9, center.y + maxDim * 0.28, center.z + maxDim * 1.8);
    cam.lookAt(center);
    const S = 64;
    const target = new THREE.WebGLRenderTarget(S, S);
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, cam);
    const pixels = new Uint8Array(S * S * 4);
    renderer.readRenderTargetPixels(target, 0, 0, S, S, pixels);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    // Pixel in ein Canvas übertragen (Y gespiegelt)
    const canvas = document.createElement('canvas'); canvas.width = S; canvas.height = S;
    const g2 = canvas.getContext('2d');
    const img = g2.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      const sy = S - 1 - y;
      for (let x = 0; x < S; x++) {
        const di = (y * S + x) * 4, si = (sy * S + x) * 4;
        img.data[di] = pixels[si]; img.data[di + 1] = pixels[si + 1];
        img.data[di + 2] = pixels[si + 2]; img.data[di + 3] = pixels[si + 3];
      }
    }
    g2.putImageData(img, 0, 0);
    const url = canvas.toDataURL();
    target.dispose();
    grp.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
    this._mobIconCache.set(type, url);
    return url;
  }

  _makeSheep() {
    const wool = new THREE.MeshLambertMaterial({ color: 0xf0f0ea });
    const skin = new THREE.MeshLambertMaterial({ color: 0xd8b09c });
    const dark = new THREE.MeshLambertMaterial({ color: 0xc09a86 });
    const g = new THREE.Group();
    g.add(box(0.58, 0.5, 0.88, skin, 0, 0.78, 0));            // Körper (geschoren sichtbar)
    const woolBody = box(0.74, 0.66, 1.02, wool, 0, 0.82, 0); // Wollschicht
    g.add(woolBody);
    const head = box(0.36, 0.36, 0.34, skin, 0, 1.02, 0.62);  // Kopf
    g.add(head);
    const woolCap = box(0.42, 0.24, 0.28, wool, 0, 1.2, 0.56); // Woll-Schopf
    g.add(woolCap);
    const legs = [];
    for (const [lx, lz] of [[-0.18, 0.3], [0.18, 0.3], [-0.18, -0.3], [0.18, -0.3]]) {
      const leg = box(0.15, 0.5, 0.15, dark, lx, 0.5, lz, true);
      legs.push(leg);
      g.add(leg);
    }
    return { group: g, legs, arms: [], materials: [wool, skin, dark], woolParts: [woolBody, woolCap] };
  }

  _makeChicken() {
    const feather = new THREE.MeshLambertMaterial({ color: 0xf4f4ee }); // weißes Gefieder
    const comb = new THREE.MeshLambertMaterial({ color: 0xd63b2f });    // roter Kamm/Kehllappen
    const beak = new THREE.MeshLambertMaterial({ color: 0xf0a63c });    // oranger Schnabel & Beine
    const eye = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
    const g = new THREE.Group();
    g.add(box(0.34, 0.36, 0.42, feather, 0, 0.42, 0));       // Körper
    g.add(box(0.26, 0.28, 0.24, feather, 0, 0.66, 0.16));    // Kopf (faces +z)
    g.add(box(0.1, 0.1, 0.12, beak, 0, 0.64, 0.34));         // Schnabel (+z)
    g.add(box(0.14, 0.1, 0.06, comb, 0, 0.81, 0.14));        // Kamm oben
    g.add(box(0.06, 0.1, 0.05, comb, 0, 0.55, 0.3));         // Kehllappen
    g.add(box(0.05, 0.05, 0.03, eye, -0.11, 0.68, 0.27));    // Augen
    g.add(box(0.05, 0.05, 0.03, eye, 0.11, 0.68, 0.27));
    const arms = []; // Flügel (an den Seiten) — animiert wie Arme
    for (const lx of [-0.2, 0.2]) {
      const wing = box(0.05, 0.28, 0.34, feather, lx, 0.44, 0);
      arms.push(wing); g.add(wing);
    }
    const legs = [];
    for (const lx of [-0.09, 0.09]) {
      const leg = box(0.06, 0.24, 0.06, beak, lx, 0.24, 0, true);
      legs.push(leg); g.add(leg);
    }
    return { group: g, legs, arms, materials: [feather, comb, beak] };
  }

  // Dorfbewohner: gleiche Proportionen wie das Spieler-Modell, aber Villager-Farben
  _makeVillager() {
    const robe = new THREE.MeshLambertMaterial({ color: 0x8a6f4e }); // braune Robe (Torso/Arme)
    const skin = new THREE.MeshLambertMaterial({ color: 0xb48a63 }); // Hautton (Kopf)
    const nose = new THREE.MeshLambertMaterial({ color: 0x9c7550 }); // Nase: etwas dunkler als die Haut
    const pants = new THREE.MeshLambertMaterial({ color: 0x5f4a30 }); // dunkle Beine
    const brow = new THREE.MeshLambertMaterial({ color: 0x3c2f1e });
    const eye = new THREE.MeshBasicMaterial({ color: 0x241a12 });    // dunkle Augen
    const g = new THREE.Group();
    g.add(box(0.5, 0.72, 0.26, robe, 0, 1.14, 0));                  // Torso
    g.add(box(0.46, 0.46, 0.46, skin, 0, 1.74, 0));                 // Kopf
    g.add(box(0.14, 0.2, 0.16, nose, 0, 1.68, 0.28));               // große Nase (+z), dunkler
    g.add(box(0.36, 0.06, 0.05, brow, 0, 1.88, 0.24));             // Monobraue (schwarzer Balken)
    g.add(box(0.09, 0.09, 0.04, eye, -0.13, 1.81, 0.235));         // Augen unter dem Balken
    g.add(box(0.09, 0.09, 0.04, eye, 0.13, 1.81, 0.235));
    const legs = [];
    for (const lx of [-0.13, 0.13]) { const l = box(0.2, 0.72, 0.24, pants, lx, 0.76, 0, true); legs.push(l); g.add(l); }
    const arms = [];
    for (const lx of [-0.33, 0.33]) { const a = box(0.16, 0.6, 0.2, robe, lx, 1.46, 0, true); arms.push(a); g.add(a); }
    return { group: g, legs, arms, materials: [robe, skin, pants] };
  }

  // Deterministische Handelsangebote eines Dorfbewohners (aus der eid → auf Host & Gast gleich)
  villagerTrades(eid) {
    let s = ((eid * 2654435761) ^ 0x7ade) >>> 0; // einfacher LCG, deterministisch aus der eid
    const rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const pick = (arr, k) => { const c = arr.slice(); const out = []; while (out.length < k && c.length) out.push(c.splice(Math.floor(rng() * c.length), 1)[0]); return out; };
    // cost = was der Spieler zahlt, result = was er bekommt
    const E = ITEM.EMERALD, S = ITEM.SAPPHIRE;
    const buys = [ // Dorfbewohner KAUFT (Spieler gibt Ware → bekommt Währung)
      { costId: ITEM.WHEAT, costCount: 16, resultId: E, resultCount: 1 },
      { costId: ITEM.COAL, costCount: 12, resultId: E, resultCount: 1 },
      { costId: BLOCK.LOG, costCount: 20, resultId: E, resultCount: 1 },
      { costId: ITEM.IRON_INGOT, costCount: 4, resultId: E, resultCount: 2 },
      { costId: ITEM.GOLD_INGOT, costCount: 6, resultId: E, resultCount: 2 },
      { costId: ITEM.PORKCHOP, costCount: 10, resultId: E, resultCount: 1 },
      { costId: BLOCK.WOOL, costCount: 12, resultId: E, resultCount: 1 },
      { costId: ITEM.DIAMOND, costCount: 2, resultId: S, resultCount: 1 },
      { costId: ITEM.EMERALD, costCount: 12, resultId: S, resultCount: 1 },
    ];
    const sells = [ // Dorfbewohner VERKAUFT (Spieler gibt Währung → bekommt Ware)
      { costId: E, costCount: 1, resultId: ITEM.BREAD, resultCount: 3 },
      { costId: E, costCount: 1, resultId: BLOCK.TORCH, resultCount: 8 },
      { costId: E, costCount: 3, resultId: ITEM.IRON_INGOT, resultCount: 2 },
      { costId: E, costCount: 4, resultId: ITEM.IRON_PICKAXE, resultCount: 1 },
      { costId: E, costCount: 7, resultId: ITEM.IRON_CHEST, resultCount: 1 },
      { costId: E, costCount: 2, resultId: BLOCK.GLASS, resultCount: 8 },
      { costId: E, costCount: 1, resultId: ITEM.ARROW, resultCount: 8 },
      { costId: E, costCount: 4, resultId: ITEM.BOW, resultCount: 1 },
      { costId: S, costCount: 1, resultId: ITEM.DIAMOND, resultCount: 3 },
      { costId: S, costCount: 3, resultId: ITEM.DIAMOND_PICKAXE, resultCount: 1 },
      { costId: S, costCount: 5, resultId: ITEM.DIAMOND_CHEST, resultCount: 1 },
    ];
    const all = [...pick(buys, 3), ...pick(sells, 4)]; // größerer Pool zum Freischalten
    for (let i = all.length - 1; i > 0; i--) { const k = Math.floor(rng() * (i + 1)); const t = all[i]; all[i] = all[k]; all[k] = t; } // mischen
    // sehr seltenes Top-Angebot: ein Rucksack als letzter (höchster) Slot
    if (rng() < 0.07) all.push({ costId: ITEM.SAPPHIRE, costCount: 20, resultId: ITEM.BACKPACK, resultCount: 1 });
    return all;
  }

  // Handelslevel eines Dorfbewohners: startet bei 1 Slot, alle 2 Trades ein weiterer
  villagerLevel(e) {
    const pool = e.trades?.length || 1;
    return Math.min(pool, 1 + Math.floor((e.tradeXp || 0) / TRADES_PER_LEVEL));
  }

  // Erfahrung fürs Handeln gutschreiben (host-autoritativ)
  gainTradeXp(e) {
    if (!e || e.type !== 'villager') return;
    if (!e.trades) e.trades = this.villagerTrades(e.eid);
    const before = this.villagerLevel(e);
    e.tradeXp = (e.tradeXp || 0) + 1;
    if (this.villagerLevel(e) > before) this.ctx.sounds?.pickup?.(); // Level-up-Feedback
  }

  _makeFish() {
    const body = new THREE.MeshLambertMaterial({ color: 0x7a9ec4 });
    const belly = new THREE.MeshLambertMaterial({ color: 0xc4ccd4 });
    const fin = new THREE.MeshLambertMaterial({ color: 0x5a7ea4 });
    const g = new THREE.Group();
    g.add(box(0.18, 0.22, 0.42, body, 0, 0.16, 0));       // Rumpf (schwimmt bei ~Körpermitte)
    g.add(box(0.14, 0.08, 0.3, belly, 0, 0.05, 0.02));    // Bauch
    const tail = box(0.04, 0.18, 0.16, fin, 0, 0.16, -0.28); // Schwanzflosse
    g.add(tail);
    g.add(box(0.04, 0.1, 0.12, fin, 0, 0.3, 0.02));       // Rückenflosse
    return { group: g, legs: [], arms: [], materials: [body, belly, fin], tail };
  }

  _makeSkeleton() {
    const bone = new THREE.MeshLambertMaterial({ color: 0xdcd8cc });
    const dark = new THREE.MeshLambertMaterial({ color: 0xb8b4a6 });
    const bow = new THREE.MeshLambertMaterial({ color: 0x6b4a2a });
    const g = new THREE.Group();
    g.add(box(0.4, 0.72, 0.2, dark, 0, 1.14, 0));            // Brustkorb
    g.add(box(0.44, 0.44, 0.44, bone, 0, 1.74, 0));          // Schädel
    const legs = [];
    for (const lx of [-0.11, 0.11]) {
      const leg = box(0.14, 0.76, 0.14, bone, lx, 0.78, 0, true);
      legs.push(leg);
      g.add(leg);
    }
    const arms = [];
    for (const lx of [-0.3, 0.3]) {
      const arm = box(0.13, 0.13, 0.62, bone, lx, 1.38, 0.26);
      arms.push(arm);
      g.add(arm);
    }
    // simpler Bogen vor der linken Hand
    g.add(box(0.06, 0.7, 0.08, bow, -0.3, 1.38, 0.62));
    return { group: g, legs, arms, materials: [bone, dark, bow] };
  }

  _makeCreeper() {
    const skin = new THREE.MeshLambertMaterial({ color: 0x51a83e });
    const dark = new THREE.MeshLambertMaterial({ color: 0x3c7e2e });
    const face = new THREE.MeshLambertMaterial({ color: 0x1e3d17 });
    const g = new THREE.Group();
    g.add(box(0.5, 0.85, 0.32, skin, 0, 0.95, 0));           // Rumpf
    g.add(box(0.5, 0.5, 0.5, skin, 0, 1.62, 0));             // Kopf
    // Gesicht (Augen + trauriger Mund) auf +z
    g.add(box(0.12, 0.12, 0.03, face, -0.12, 1.72, 0.25));
    g.add(box(0.12, 0.12, 0.03, face, 0.12, 1.72, 0.25));
    g.add(box(0.14, 0.2, 0.03, face, 0, 1.5, 0.25));
    const legs = [];
    for (const [lx, lz] of [[-0.14, 0.2], [0.14, 0.2], [-0.14, -0.2], [0.14, -0.2]]) {
      const leg = box(0.22, 0.34, 0.22, dark, lx, 0.34, lz, true);
      legs.push(leg);
      g.add(leg);
    }
    return { group: g, legs, arms: [], materials: [skin, dark, face] };
  }

  _itemGeometry(id) {
    // Cross-Pflanzen (Setzlinge, Blumen, Fackeln) droppen als flache Sprites
    const block = isBlockId(id) && !BLOCKS[id]?.cross;
    const tileName = isBlockId(id) ? (BLOCKS[id]?.tiles.side ?? 'stone') : (ITEMS[id]?.tile ?? 'stone');
    const key = (block ? 'b:' : 'i:') + tileName;
    let geo = this._itemGeoCache.get(key);
    if (!geo) {
      // blocks drop as mini cubes, items (meat, tools …) as flat sprites
      geo = block ? new THREE.BoxGeometry(0.28, 0.28, 0.28) : new THREE.PlaneGeometry(0.44, 0.44);
      const r = this.ctx.textures.uv(tileName);
      const uv = geo.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, r.u0 + (r.u1 - r.u0) * uv.getX(i), r.v0 + (r.v1 - r.v0) * uv.getY(i));
      }
      uv.needsUpdate = true;
      this._itemGeoCache.set(key, geo);
    }
    return geo;
  }

  // ---- spawning ----

  _spawnMob(type, x, y, z, opts = {}) {
    const built =
      type === 'pig' ? this._makePig() :
      type === 'sheep' ? this._makeSheep() :
      type === 'chicken' ? this._makeChicken() :
      type === 'villager' ? this._makeVillager() :
      type === 'fish' ? this._makeFish() :
      type === 'skeleton' ? this._makeSkeleton() :
      type === 'creeper' ? this._makeCreeper() :
      type === 'crimson_zombie' ? this._makeCrimsonZombie() :
      type === 'slime' ? this._makeSlime() : this._makeZombie();
    const scale = opts.scale ?? 1;
    const baseW = type === 'pig' ? 0.8 : type === 'sheep' ? 0.85 : type === 'chicken' ? 0.4 : type === 'fish' ? 0.3 : type === 'crimson_zombie' ? 0.7 : type === 'slime' ? 0.9 : type === 'villager' ? 0.55 : 0.6;
    const baseH = type === 'pig' ? 1.0 : type === 'sheep' ? 1.2 : type === 'chicken' ? 0.7 : type === 'fish' ? 0.3 : type === 'creeper' ? 1.85 : type === 'crimson_zombie' ? 1.95 : type === 'slime' ? 0.9 : 1.9;
    const e = {
      type,
      pos: new THREE.Vector3(x + 0.5, y, z + 0.5),
      vel: new THREE.Vector3(),
      width: baseW * scale,
      height: baseH * scale,
      onGround: false, inWater: false, fallDistance: 0,
      health: opts.hp ?? (type === 'pig' ? 10 : type === 'sheep' ? 8 : type === 'chicken' ? 4 : type === 'fish' ? 3 : type === 'slime' ? 12 : 20),
      home: opts.home || null, // Dorfbewohner: Leine ans Dorfzentrum
      tail: built.tail || null, swimTimer: 0,
      mesh: built.group, legs: built.legs, arms: built.arms, materials: built.materials,
      ai: { mode: 'idle', timer: 1 + Math.random() * 2, dirX: 0, dirZ: 0 },
      yaw: Math.random() * Math.PI * 2,
      animPhase: 0,
      invuln: 0, flash: 0, dying: 0, burnAcc: 0, attackCooldown: 0,
      shootTimer: 1 + Math.random(), fuse: 0, fusing: false,
      woolParts: built.woolParts || null, hasWool: type === 'sheep', eatTimer: 0,
      // Zucht: Verliebt-Timer, Abklingzeit, Baby-Wachstum (baseW/baseH = ungeskalt)
      love: 0, breedCd: 0, baby: !!opts.baby, growTimer: opts.baby ? BABY_GROW_TIME : 0,
      baseW, baseH, _heartT: 0, _netScale: scale,
      // Dorfbewohner: Handels-Erfahrung (schaltet Slots frei) — bleiben geladen, damit das Level erhalten bleibt
      tradeXp: 0,
      // Ereignis-/Modifier-Felder (Dschungeltempel-Wellen, Mega-Zombies)
      scale, eventKey: opts.eventKey || null, noDespawn: type === 'villager' || !!opts.eventKey,
      spawnerKey: opts.spawnerKey || null,
      eid: this._nextEid++, remoteNet: false, netTarget: null,
      moveSpeed: opts.moveSpeed ?? null, attackDamage: opts.attackDamage ?? null,
      modifiers: new Set(opts.modifiers || []), extraLives: 0, maxHealth: 0,
      remove: false,
    };
    e.maxHealth = e.health;
    if (e.modifiers.has('leben')) e.extraLives = 1;
    if (scale !== 1) e.mesh.scale.setScalar(scale);
    // Modifier-Färbung: der erste Modifier tönt das Modell
    const TINT = { schaden: 0xff8866, tempo: 0x7ce4ff, anker: 0xbbbbbb, leben: 0xffd24a, split: 0x9cff8a };
    for (const m of e.modifiers) {
      if (TINT[m]) {
        for (const mat of e.materials) mat.color.multiplyScalar(0.75).addScalar(0);
        e.materials[0].color.setHex(TINT[m]);
        break;
      }
    }
    this.ctx.scene.add(e.mesh);
    this.list.push(e);
    return e;
  }

  // ---- Schafe scheren & Wolle nachwachsen lassen ----

  // Mob-Drop, den auch Mitspieler sehen (netId-synchronisiert, kein Dupe)
  _dropShared(x, y, z, id, count) {
    this.dropSynced(x, y, z, id, count);
  }

  shearSheep(e) {
    if (e.type !== 'sheep' || !e.hasWool) return false;
    e.hasWool = false;
    for (const m of e.woolParts) m.visible = false;
    const n = 1 + Math.floor(Math.random() * 3); // 1–3 Wolle
    this._dropShared(e.pos.x, e.pos.y + 0.8, e.pos.z, BLOCK.WOOL, n);
    e.eatTimer = 270 + Math.random() * 90; // frisst in ~5 min wieder Gras
    this.ctx.sounds.shear();
    this.ctx.sounds.sheep();
    return true;
  }

  // ---- Zucht (Breeding) ----

  // Ist `id` das passende Zuchtfutter für diese Tierart?
  // Schwein: alles Essbare · Huhn: reine Samen · Schaf: Weizen (Heu)
  breedFoodFor(type, id) {
    if (id == null) return false;
    const it = ITEMS[id];
    if (type === 'pig') return it?.food != null;
    if (type === 'chicken') return it?.plant != null && it?.food == null;
    if (type === 'sheep') return id === ITEM.WHEAT;
    return false;
  }

  // Kann `id` überhaupt irgendein Tier verlieben? (spart Raycasts beim Rechtsklick)
  isAnyBreedFood(id) {
    return this.breedFoodFor('pig', id) || this.breedFoodFor('chicken', id) || this.breedFoodFor('sheep', id);
  }

  // Erwachsen, nicht schon verliebt, keine Abklingzeit → zuchtbereit
  canBreed(e) {
    return !!e && !e.baby && (e.scale ?? 1) >= 0.9 &&
      (e.love || 0) <= 0 && (e.breedCd || 0) <= 0 && (e.dying || 0) <= 0;
  }

  // Tier füttern: verlieben (Herzchen) oder Baby-Wachstum beschleunigen.
  // Gibt true zurück, wenn das Futter verbraucht werden soll.
  feed(e) {
    if (!e || e.remove) return false;
    if (e.baby) { // Baby füttern → wächst schneller
      e.growTimer = Math.max(0, (e.growTimer || 0) - BABY_GROW_TIME * 0.1);
      this._heartBurst(e);
      return true;
    }
    if (!this.canBreed(e)) return false;
    e.love = LOVE_TIME;
    this._heartBurst(e);
    this.ctx.sounds?.pickup?.();
    return true;
  }

  _heartBurst(e) {
    this.ctx.furnaces?.heart(e.pos.x, e.pos.y + (e.height || 0.8) * 0.95, e.pos.z, 5);
  }

  // Nächstes verliebtes, zuchtbereites Tier gleicher Art (innerhalb 8 Blöcken)
  _breedPartner(e) {
    let best = null, bd = 64;
    for (const o of this.list) {
      if (o === e || o.remove || o.type !== e.type || o.baby) continue;
      if ((o.love || 0) <= 0 || (o.breedCd || 0) > 0) continue;
      const d = (o.pos.x - e.pos.x) ** 2 + (o.pos.z - e.pos.z) ** 2;
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  _breed(a, b) {
    a.love = 0; b.love = 0;
    a.breedCd = BREED_COOLDOWN; b.breedCd = BREED_COOLDOWN;
    const bx = (a.pos.x + b.pos.x) / 2, bz = (a.pos.z + b.pos.z) / 2, by = a.pos.y;
    const baby = this._spawnMob(a.type, Math.floor(bx), by, Math.floor(bz), { baby: true, scale: 0.5 });
    baby.pos.set(bx, by, bz);
    this.ctx.furnaces?.heart(bx, by + 0.6, bz, 10); // Zucht-Herzchen
    this.ctx.sounds?.pickup?.();
  }

  // ---- Pfeile (Skelett-Projektile) ----

  _shootArrow(e, targetPos) {
    const sx = e.pos.x, sy = e.pos.y + 1.4, sz = e.pos.z;
    const dx = targetPos.x - sx, dy = (targetPos.y + 1.2) - sy, dz = targetPos.z - sz;
    const dist = Math.hypot(dx, dy, dz) || 1;
    const SPEED = 18;
    const spray = 0.35; // leichte Ungenauigkeit
    const vel = new THREE.Vector3(
      (dx / dist) * SPEED + (Math.random() - 0.5) * spray * 2,
      (dy / dist) * SPEED + dist * 0.12, // Bogenschuss: etwas Vorhalt nach oben
      (dz / dist) * SPEED + (Math.random() - 0.5) * spray * 2,
    );
    const geo = new THREE.BoxGeometry(0.05, 0.05, 0.55);
    const mat = new THREE.MeshLambertMaterial({ color: 0x9c8b70 });
    const mesh = new THREE.Mesh(geo, mat);
    const a = {
      type: 'arrow',
      pos: new THREE.Vector3(sx, sy, sz),
      vel, mesh, age: 0, remove: false, materials: [mat],
      eid: this._nextEid++, remoteNet: false, netTarget: null, health: undefined,
    };
    mesh.position.copy(a.pos);
    this.ctx.scene.add(mesh);
    this.list.push(a);
    this.ctx.sounds.shoot();
  }

  // Vom Spieler mit dem Bogen abgeschossener Pfeil. `eye` = Augenposition,
  // `dir` = normierte Blickrichtung, `charge` 0..1 (Spannung → Tempo & Schaden).
  // owner:'player' → trifft Mobs statt den Spieler. Host synchronisiert den
  // Flug via Snapshot; ein Gast simuliert lokal und meldet Treffer per Netz.
  playerShootArrow(eye, dir, charge) {
    const SPEED = 16 + charge * 22; // 16..38 je nach Spannung
    const vel = new THREE.Vector3(dir.x * SPEED, dir.y * SPEED, dir.z * SPEED);
    const geo = new THREE.BoxGeometry(0.05, 0.05, 0.55);
    const mat = new THREE.MeshLambertMaterial({ color: 0x9c8b70 });
    const mesh = new THREE.Mesh(geo, mat);
    const a = {
      type: 'arrow', owner: 'player',
      dmg: Math.round(3 + charge * 5), // 3..8 Schaden
      pos: new THREE.Vector3(eye.x + dir.x * 0.6, eye.y - 0.1 + dir.y * 0.6, eye.z + dir.z * 0.6),
      vel, mesh, age: 0, remove: false, materials: [mat],
      eid: this._nextEid++, remoteNet: false, netTarget: null, health: undefined,
    };
    mesh.position.copy(a.pos);
    this.ctx.scene.add(mesh);
    this.list.push(a);
    this.ctx.sounds.shoot();
  }

  _updateArrow(a, dt) {
    a.age += dt;
    if (a.age > 8) { this._removeEntity(a); return; }
    a.vel.y -= 14 * dt; // leichte Schwerkraft → Flugbahn
    a.pos.addScaledVector(a.vel, dt);

    // Block getroffen?
    const bx = Math.floor(a.pos.x), by = Math.floor(a.pos.y), bz = Math.floor(a.pos.z);
    if (isSolid(this.ctx.world.getBlock(bx, by, bz))) { this._removeEntity(a); return; }

    if (a.owner === 'player') {
      // --- Spieler-Pfeil: trifft Mobs (nicht den Schützen) ---
      for (const o of this.list) {
        if (o === a || o.remove || o.dying > 0) continue;
        if (o.type === 'item' || o.type === 'arrow' || o.type === 'falling' || o.type === 'tnt') continue;
        const hw = (o.width || 0.6) / 2 + 0.15;
        if (Math.abs(a.pos.x - o.pos.x) < hw && Math.abs(a.pos.z - o.pos.z) < hw &&
            a.pos.y > o.pos.y - 0.1 && a.pos.y < o.pos.y + (o.height || 1.8)) {
          const kl = Math.hypot(a.vel.x, a.vel.z) || 1;
          const kx = a.vel.x / kl, kz = a.vel.z / kl;
          if (o.remoteNet) {
            // Gast: Treffer an den Host melden, lokales Feedback zeigen
            this.ctx.net?.sendHit(o.eid, a.dmg, kx, kz);
            if (o.materials) { o.flash = 0.18; for (const m of o.materials) { m.emissive.setHex(0xff0000); m.emissiveIntensity = 0.55; } }
          } else {
            this.hurt(o, a.dmg, { x: kx, z: kz }, 'local'); // eigener Pfeil → XP an mich
          }
          this._removeEntity(a);
          return;
        }
      }
      // PvP: Mitspieler mit Pfeil treffen (nur bei aktiviertem PvP)
      const netP = this.ctx.net;
      if (netP?.active && netP.pvp) {
        for (const [id, r] of netP.remote) {
          const rp = r.mesh.position;
          if (Math.abs(a.pos.x - rp.x) < 0.45 && Math.abs(a.pos.z - rp.z) < 0.45 &&
              a.pos.y > rp.y - 0.1 && a.pos.y < rp.y + 1.9) {
            const kl = Math.hypot(a.vel.x, a.vel.z) || 1;
            netP.sendPvp(id, a.dmg, (a.vel.x / kl) * 6, (a.vel.z / kl) * 6);
            r.flash = 0.2;
            this._removeEntity(a);
            return;
          }
        }
      }
    } else {
      // --- Skelett-Pfeil: trifft den lokalen Spieler ---
      const p = this.ctx.player;
      const st = this.ctx.state;
      if (!st.dead && st.mode === 'survival' && !st.spectator) {
        const inX = Math.abs(a.pos.x - p.pos.x) < 0.45;
        const inZ = Math.abs(a.pos.z - p.pos.z) < 0.45;
        const inY = a.pos.y > p.pos.y - 0.1 && a.pos.y < p.pos.y + 1.9;
        if (inX && inZ && inY) {
          this.ctx.survival.damage(3, 'arrow');
          if (!armorStats(this.ctx.inventory?.armor).kbImmune) {
            const kl = Math.hypot(a.vel.x, a.vel.z) || 1;
            p.vel.x += (a.vel.x / kl) * 4;
            p.vel.z += (a.vel.z / kl) * 4;
            p.vel.y = Math.min(p.vel.y + 2.5, 6);
          }
          this._removeEntity(a);
          return;
        }
      }
      // Mitspieler getroffen? (nur der Host simuliert Skelett-Pfeile)
      const netA = this.ctx.net;
      if (netA?.active && netA.isHost) {
        for (const [id, r] of netA.remote) {
          const rp = r.mesh.position;
          if (Math.abs(a.pos.x - rp.x) < 0.45 && Math.abs(a.pos.z - rp.z) < 0.45 &&
              a.pos.y > rp.y - 0.1 && a.pos.y < rp.y + 1.9) {
            const kl = Math.hypot(a.vel.x, a.vel.z) || 1;
            netA.sendPlayerHit(id, 3, (a.vel.x / kl) * 4, (a.vel.z / kl) * 4);
            this._removeEntity(a);
            return;
          }
        }
      }
    }

    // Mesh entlang der Flugrichtung ausrichten
    a.mesh.position.copy(a.pos);
    this._v1.copy(a.pos).add(a.vel);
    a.mesh.lookAt(this._v1);
  }

  // ---- Explosionen (Creeper & TNT) ----

  // Kugel-Explosion bei (cx,cy,cz): sprengt Blöcke, verletzt Spieler + Mobs,
  // zündet getroffenes TNT (Kettenreaktion). `source` wird vom Schaden ausgenommen.
  explode(cx, cy, cz, radius, maxDmg, source = null) {
    const w = this.ctx.world;
    this.ctx.sounds.explode();
    this.ctx.furnaces?.burst(cx, cy, cz, Math.round(radius * 15));

    // Blöcke im Kugelradius wegsprengen (Bedrock hält stand)
    const iR = Math.ceil(radius);
    const editListe = [];
    for (let dy = -iR; dy <= iR; dy++) {
      for (let dz = -iR; dz <= iR; dz++) {
        for (let dx = -iR; dx <= iR; dx++) {
          if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
          const bx = Math.floor(cx + dx), by = Math.floor(cy + dy), bz = Math.floor(cz + dz);
          const id = w.getBlock(bx, by, bz);
          if (id <= 0 || id === BLOCK.BEDROCK || isLiquid(id)) continue;
          w.setBlock(bx, by, bz, BLOCK.AIR); // benachrichtigt Fluide/Fallphysik/Flora selbst
          editListe.push([bx, by, bz, BLOCK.AIR]);
          if (id === BLOCK.TNT) {
            // Kettenreaktion: getroffenes TNT zündet mit kurzer Zufalls-Lunte
            this.spawnPrimedTnt(bx, by, bz, 0.4 + Math.random() * 0.6);
          }
        }
      }
    }
    this.ctx.net?.sendEdits(editListe); // Krater für alle Mitspieler

    // Schaden: Spieler (mit Abstand skaliert) + andere Mobs
    const dmgRange = radius + 2.5;
    const pDist = this._v1.set(cx, cy, cz).distanceTo(
      this._v2.set(this.ctx.player.pos.x, this.ctx.player.pos.y + 0.9, this.ctx.player.pos.z));
    if (pDist < dmgRange && this.ctx.state.mode === 'survival') {
      this.ctx.survival.damage(Math.max(1, Math.round(maxDmg * (1 - pDist / dmgRange))), 'explosion');
      if (!armorStats(this.ctx.inventory?.armor).kbImmune) {
        const p = this.ctx.player;
        const kx = p.pos.x - cx, kz = p.pos.z - cz;
        const kl = Math.hypot(kx, kz) || 1;
        const force = 9 * (1 - pDist / dmgRange);
        p.vel.x += (kx / kl) * force;
        p.vel.z += (kz / kl) * force;
        p.vel.y = Math.min(p.vel.y + force * 0.7, 9);
      }
    }
    for (const o of this.list) {
      if (o === source || o.type === 'item' || o.type === 'arrow' || o.type === 'falling' || o.dying > 0) continue;
      if (o.type === 'tnt') continue; // gezündetes TNT fliegt weiter
      const d = this._v1.set(cx, cy, cz).distanceTo(o.pos);
      if (d < dmgRange) {
        o.invuln = 0;
        this.hurt(o, Math.round((maxDmg - 2) * (1 - d / dmgRange)), null);
      }
    }
    // Mitspieler im Radius: distanzskalierter Schaden übers Netz
    // (auch Gäste — deren selbst gezündetes TNT simuliert nur lokal)
    const netE = this.ctx.net;
    if (netE?.active) {
      for (const [id, r] of netE.remote) {
        const d = this._v1.set(cx, cy, cz).distanceTo(
          this._v2.set(r.mesh.position.x, r.mesh.position.y + 0.9, r.mesh.position.z));
        if (d < dmgRange) {
          const kx = r.mesh.position.x - cx, kz = r.mesh.position.z - cz;
          const kl = Math.hypot(kx, kz) || 1;
          const force = 9 * (1 - d / dmgRange);
          netE.sendPlayerHit(id, Math.max(1, Math.round(maxDmg * (1 - d / dmgRange))),
            (kx / kl) * force, (kz / kl) * force);
        }
      }
    }
  }

  _explode(e) {
    this.explode(e.pos.x, e.pos.y + 0.9, e.pos.z, EXPLODE_RADIUS, 14, e);
    this._removeEntity(e); // explodierter Creeper droppt nichts
  }

  // ---- TNT ----

  spawnPrimedTnt(x, y, z, fuse = 4) {
    // Gast: TNT gehört dem Host (wie Mobs). Zündung dorthin melden statt lokal
    // zu simulieren — der Host spawnt es und alle sehen es über den Snapshot.
    const net = this.ctx.net;
    if (net?.active && !net.isHost) {
      net.sendIgniteTnt(x, y, z, fuse);
      return null;
    }
    const mat = new THREE.MeshLambertMaterial({ map: this.ctx.textures.texture });
    const mesh = new THREE.Mesh(this._fallingGeometry(BLOCK.TNT), mat);
    mesh.userData.sharedGeo = true;
    const e = {
      type: 'tnt',
      pos: new THREE.Vector3(x + 0.5, y, z + 0.5),
      vel: new THREE.Vector3(),
      width: 0.95, height: 0.98,
      onGround: false, inWater: false, fallDistance: 0,
      fuse, mesh, materials: [mat], remove: false,
      eid: this._nextEid++, remoteNet: false, netTarget: null, // für den Netz-Snapshot
    };
    this.ctx.scene.add(mesh);
    this.list.push(e);
    this.ctx.sounds.fuse();
    return e;
  }

  _updateTnt(e, dt) {
    e.fuse -= dt;
    if (e.fuse <= 0) {
      const pos = e.pos.clone();
      this._removeEntity(e);
      this.explode(pos.x, pos.y + 0.5, pos.z, 3.6, 20, null);
      return;
    }
    stepEntity(this.ctx.world, e, dt);
    if (e.onGround) {
      e.vel.x *= Math.max(0, 1 - 6 * dt);
      e.vel.z *= Math.max(0, 1 - 6 * dt);
    }
    // weißes Blinken, gegen Ende schneller
    const rate = e.fuse < 1 ? 16 : 7;
    const on = Math.sin(e.fuse * rate) > 0;
    e.materials[0].emissive.setHex(0xffffff);
    e.materials[0].emissiveIntensity = on ? 0.75 : 0;
    const puls = 1 + Math.max(0, 1 - e.fuse / 4) * 0.08 + (on ? 0.03 : 0);
    e.mesh.scale.setScalar(puls);
    e.mesh.position.set(e.pos.x, e.pos.y + e.height / 2, e.pos.z);
  }

  // ---- Fallphysik: Sand & roter Sand stürzen ohne Halt nach unten ----

  notifyGravity(x, y, z) {
    const w = this.ctx.world;
    const id = w.getBlock(x, y, z);
    if (id !== BLOCK.SAND && id !== BLOCK.RED_SAND) return;
    const below = w.getBlock(x, y - 1, z);
    if (below !== BLOCK.AIR && !(below > 0 && (BLOCKS[below]?.solid === false))) return;
    w.setBlock(x, y, z, BLOCK.AIR); // löst über onBlockEdit die Kette nach oben aus
    this.ctx.net?.sendEdits([[x, y, z, BLOCK.AIR]]);
    this._spawnFallingBlock(x, y, z, id);
  }

  _fallingGeometry(id) {
    const tileName = BLOCKS[id]?.tiles.side ?? 'sand';
    const key = 'f:' + tileName;
    let geo = this._itemGeoCache.get(key);
    if (!geo) {
      geo = new THREE.BoxGeometry(0.98, 0.98, 0.98);
      const r = this.ctx.textures.uv(tileName);
      const uv = geo.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, r.u0 + (r.u1 - r.u0) * uv.getX(i), r.v0 + (r.v1 - r.v0) * uv.getY(i));
      }
      uv.needsUpdate = true;
      this._itemGeoCache.set(key, geo);
    }
    return geo;
  }

  _spawnFallingBlock(x, y, z, id) {
    const mesh = new THREE.Mesh(this._fallingGeometry(id), this._itemMat);
    const e = {
      type: 'falling', blockId: id,
      pos: new THREE.Vector3(x + 0.5, y, z + 0.5),
      vel: new THREE.Vector3(),
      width: 0.95, height: 0.98,
      onGround: false, inWater: false, fallDistance: 0,
      mesh, age: 0, remove: false,
    };
    this.ctx.scene.add(mesh);
    this.list.push(e);
    return e;
  }

  _updateFalling(e, dt) {
    e.age += dt;
    stepEntity(this.ctx.world, e, dt);
    if (e.onGround || e.age > 30) {
      const w = this.ctx.world;
      const bx = Math.floor(e.pos.x), bz = Math.floor(e.pos.z);
      let by = Math.round(e.pos.y);
      // erste freie Zelle (Luft/Fluid/Pflanze) von unten nach oben suchen
      for (let i = 0; i < 6 && by < 511; i++, by++) {
        const cur = w.getBlock(bx, by, bz);
        if (cur === BLOCK.AIR || (cur > 0 && BLOCKS[cur]?.solid === false)) {
          w.setBlock(bx, by, bz, e.blockId);
          this.ctx.net?.sendEdits([[bx, by, bz, e.blockId]]);
          this._removeEntity(e);
          return;
        }
      }
      // kein Platz: als Item droppen
      this.spawnItemDrop(e.pos.x, e.pos.y + 0.5, e.pos.z, e.blockId, 1);
      this._removeEntity(e);
    } else {
      e.mesh.position.set(e.pos.x, e.pos.y + e.height / 2, e.pos.z);
    }
  }

  spawnItemDrop(x, y, z, idOrStack, count = 1, netId = null) {
    // akzeptiert eine id ODER eine komplette Item-Instanz (Ausrüstung mit Slots etc.)
    const stack = typeof idOrStack === 'object' && idOrStack !== null
      ? idOrStack : { id: idOrStack, count };
    const mesh = new THREE.Mesh(this._itemGeometry(stack.id), this._itemMat);
    const e = {
      type: 'item', stack, id: stack.id, count: stack.count,
      pos: new THREE.Vector3(x, y, z),
      vel: new THREE.Vector3((Math.random() - 0.5) * 2.5, 3.5, (Math.random() - 0.5) * 2.5),
      width: 0.25, height: 0.25,
      onGround: false, inWater: false, fallDistance: 0,
      mesh, age: 0, remove: false, netId,
    };
    this.ctx.scene.add(mesh);
    this.list.push(e);
    return e;
  }

  // Autoritativer Drop, den ALLE Spieler sehen: lokal spawnen + über eine
  // eindeutige netId broadcasten. Hebt einer das Item auf, verschwindet es
  // per netId bei allen (kein Dupe). Genutzt für Würfe, Mob-Beute, Abbau-Drops.
  dropSynced(x, y, z, idOrStack, count = 1) {
    const net = this.ctx.net;
    const netId = net?.active ? net.id * 1e7 + (this._nextItemNet++) : null;
    const e = this.spawnItemDrop(x, y, z, idOrStack, count, netId);
    if (netId != null) net.sendItemDrop(netId, x, y, z, e.stack.id, e.stack.count);
    return e;
  }

  // Von einem Mitspieler gedropptes Item lokal nachbilden (kein Re-Broadcast)
  spawnRemoteItem(netId, x, y, z, id, count) {
    for (const o of this.list) if (o.type === 'item' && o.netId === netId) return;
    this.spawnItemDrop(x, y, z, id, count, netId);
  }

  // Ein synchronisiertes Item entfernen (jemand hat es aufgehoben)
  removeItemByNetId(netId) {
    for (const e of this.list) {
      if (e.type === 'item' && e.netId === netId && !e.remove) { this._removeEntity(e); return; }
    }
  }

  // Alle Spawn-Anker: der eigene Spieler und (als Host) jeder Mitspieler.
  // So können um JEDEN Spieler Mobs erscheinen. Der Cap wächst mit der Spielerzahl,
  // bleibt aber ein gemeinsamer (globaler) Deckel — kein unbegrenztes Wuseln.
  _alleAnker() {
    const net = this.ctx.net;
    const anker = [this.ctx.player.pos];
    if (net?.active && net.isHost) {
      for (const r of net.remote.values()) anker.push(r.mesh.position);
    }
    return anker;
  }

  _countType(t) {
    let n = 0;
    for (const e of this.list) if (e.type === t && !e.remove) n++;
    return n;
  }

  _attemptSpawns(anchor, capScale) {
    const { world, daynight } = this.ctx;
    // erst den Ort wählen (für biom-abhängige Spawns wie Sumpf-Schleime)
    const a = Math.random() * Math.PI * 2;
    const d = 20 + Math.random() * 20;
    const x = Math.floor(anchor.x + Math.cos(a) * d);
    const z = Math.floor(anchor.z + Math.sin(a) * d);
    if (!world.isLoaded(x, z)) return;
    const y = world.surfaceY(x, z);
    if (y < 1) return;
    const ground = world.getBlock(x, y, z);
    const openAbove = world.getBlock(x, y + 1, z) === BLOCK.AIR && world.getBlock(x, y + 2, z) === BLOCK.AIR;

    // Sumpf: böse Schleime, die herumhüpfen (Tag wie Nacht)
    if (biomeAt(this.ctx.seed, x, z) === 'sumpf' && Math.random() < 0.4) {
      if (!openAbove || !isSolid(ground)) return;
      let slimes = 0;
      for (const e of this.list) if (e.type === 'slime') slimes++;
      if (slimes < SLIME_CAP * capScale) this._spawnMob('slime', x, y + 1, z);
      return;
    }

    if (daynight.isNight()) {
      // Nacht: Monster überall, wo Platz ist
      let type, cap;
      const r = Math.random();
      if (r < 0.45) { type = 'zombie'; cap = ZOMBIE_CAP; }
      else if (r < 0.75) { type = 'skeleton'; cap = SKELETON_CAP; }
      else { type = 'creeper'; cap = CREEPER_CAP; }
      if (!openAbove || this._countType(type) >= cap * capScale) return;
      this._spawnMob(type, x, y + 1, z);
      return;
    }
    // Tag: Fische im Wasser; Weidetiere (Schwein/Schaf/Huhn) nur auf Gras in sinnvollen Biomen
    if (isWaterId(ground)) {
      if (!isWaterId(world.getBlock(x, y - 2, z))) return; // braucht eine Wassersäule
      if (this._countType('fish') >= FISH_CAP * capScale) return;
      this._spawnMob('fish', x, y - 1.5, z);
      return;
    }
    if (!openAbove || !GRASSY.includes(ground)) return;
    const tiere = LAND_ANIMALS[biomeAt(this.ctx.seed, x, z)];
    if (!tiere) return; // Wüste, Ödland, Berge, Pilzinsel …: keine Weidetiere
    const type = tiere[Math.floor(Math.random() * tiere.length)];
    const cap = (type === 'pig' ? PIG_CAP : type === 'sheep' ? SHEEP_CAP : CHICKEN_CAP) * capScale;
    if (this._countType(type) >= cap) return;
    this._spawnMob(type, x, y + 1, z);
  }

  // Monster in stockdunklen Tiefen (Höhlen & Dungeons) — Tag wie Nacht.
  // Mehrere Stichproben pro Tick, weil Hohlräume nur einen Bruchteil des Gesteins ausmachen.
  _attemptCaveSpawn(anchor, capScale) {
    const { world } = this.ctx;
    const player = { pos: anchor };
    let monster = 0;
    for (const e of this.list) if (e.type === 'zombie' || e.type === 'skeleton') monster++;
    if (monster >= ZOMBIE_CAP * capScale) return;
    for (let versuch = 0; versuch < 10; versuch++) {
      const mx = Math.floor(player.pos.x + (Math.random() - 0.5) * 32);
      const mz = Math.floor(player.pos.z + (Math.random() - 0.5) * 32);
      const my = Math.floor(player.pos.y + (Math.random() - 0.5) * 14);
      if (my < 3 || !world.isLoaded(mx, mz)) continue;
      if (my > world.surfaceY(mx, mz) - 5) continue; // nur richtig unter Tage
      if (world.getBlock(mx, my, mz) !== BLOCK.AIR ||
          world.getBlock(mx, my + 1, mz) !== BLOCK.AIR ||
          !isSolid(world.getBlock(mx, my - 1, mz))) continue;
      const L = world.getLight(mx, my, mz);
      if ((L >> 4) > 0 || (L & 15) >= 6) continue; // Fackeln halten Monster fern
      const dx = mx + 0.5 - player.pos.x, dz = mz + 0.5 - player.pos.z;
      if (Math.hypot(dx, dz) < 9 && Math.abs(my - player.pos.y) < 5) continue; // nicht direkt neben dem Spieler
      this._spawnMob(Math.random() < 0.6 ? 'zombie' : 'skeleton', mx, my, mz);
      return;
    }
  }

  // Dorfbewohner in der Nähe eines Dorfs auffüllen (host-autoritativ, Tag wie Nacht)
  _attemptVillagerSpawn(anchor, capScale) {
    const { world } = this.ctx;
    const villages = villagesNear(this.ctx.seed, Math.floor(anchor.x), Math.floor(anchor.z));
    for (const v of villages) {
      if (Math.hypot(v.cx - anchor.x, v.cz - anchor.z) > 90) continue;
      const cap = Math.min(v.buildings.length, 12) * capScale;
      if (this._countType('villager') >= cap) return;
      for (let t = 0; t < 6; t++) {
        // in den Gassen rund um ein Gebäude spawnen (nicht aufs Dach)
        const b = v.buildings[Math.floor(Math.random() * v.buildings.length)];
        const ang = Math.random() * Math.PI * 2, dist = 4 + Math.floor(Math.random() * 3);
        const sx = b.ax + Math.round(Math.cos(ang) * dist);
        const sz = b.az + Math.round(Math.sin(ang) * dist);
        if (!world.isLoaded(sx, sz)) continue;
        const sy = world.surfaceY(sx, sz);
        if (sy < 1 || !isSolid(world.getBlock(sx, sy, sz))) continue;
        if (world.getBlock(sx, sy + 1, sz) !== BLOCK.AIR || world.getBlock(sx, sy + 2, sz) !== BLOCK.AIR) continue;
        this._spawnMob('villager', sx, sy + 1, sz, { home: { x: v.cx, z: v.cz } });
        return;
      }
    }
  }

  // ---- Mehrspieler Stufe 2: Host simuliert, Gäste rendern Snapshots ----

  // Host: kompakter Zustand aller Mobs/Pfeile/TNT.
  // Items und fallende Blöcke NICHT: die entstehen deterministisch aus den
  // synchronisierten Block-Edits auf jedem Client selbst (sonst Duplikate).
  collectSnapshot() {
    const list = [];
    for (const e of this.list) {
      if (e.remove || e.type === 'item' || e.type === 'falling' || e.remoteNet) continue;
      const s = {
        eid: e.eid, t: e.type,
        x: +e.pos.x.toFixed(2), y: +e.pos.y.toFixed(2), z: +e.pos.z.toFixed(2),
        yaw: +(e.yaw || 0).toFixed(2), hp: e.health,
      };
      if (e.scale !== 1) s.s = e.scale;
      if (e.isBoss) s.mhp = e.maxHealth; // Bossleiste bei Gästen korrekt füllen
      if (e.type === 'sheep') s.w = e.hasWool ? 1 : 0;
      if (e.love > 0) s.lv = 1; // verliebt → Gäste zeigen Herzchen
      if (e.type === 'villager' && e.tradeXp) s.tx = e.tradeXp; // Handelslevel synchron halten
      if (e.fusing) s.f = 1;
      if (e.modifiers?.size) s.m = [...e.modifiers];
      list.push(s);
    }
    return list;
  }

  // Gast: Snapshot des Hosts anwenden (spawnen/bewegen/entfernen)
  applyRemoteSnapshot(list) {
    const gesehen = new Set();
    for (const s of list) {
      gesehen.add(s.eid);
      let e = this._remoteMap.get(s.eid);
      if (!e) {
        e = this._spawnRemote(s);
        if (!e) continue;
        this._remoteMap.set(s.eid, e);
      }
      e.netTarget = { x: s.x, y: s.y, z: s.z, yaw: s.yaw || 0 };
      if (s.hp < e.health && e.materials) { // Treffer-Feedback
        e.flash = 0.18;
        for (const m of e.materials) { m.emissive.setHex(0xff0000); m.emissiveIntensity = 0.55; }
      }
      e.health = s.hp;
      if (e.type === 'sheep' && e.woolParts) {
        const wolle = s.w !== 0;
        if (wolle !== e.hasWool) {
          e.hasWool = wolle;
          for (const m of e.woolParts) m.visible = wolle;
        }
      }
      e.love = s.lv ? 1 : 0;   // Herzchen beim Gast
      e._netScale = s.s ?? 1;  // Baby-Wachstum synchron nachziehen
      if (e.type === 'villager') e.tradeXp = s.tx || 0; // Handelslevel vom Host
      e.fusing = !!s.f;
    }
    // nicht mehr gemeldete Entities sterben aus
    for (const [eid, e] of this._remoteMap) {
      if (!gesehen.has(eid) && !e.remove && e.dying <= 0) {
        // Verschwindet ferngesteuertes TNT, ist es explodiert → Boom auch beim Gast
        if (e.type === 'tnt') {
          this.ctx.sounds.explode();
          this.ctx.furnaces?.burst(e.pos.x, e.pos.y + 0.5, e.pos.z, 55);
          this._removeEntity(e);
          continue;
        }
        e.dying = 0.25;
      }
      if (e.remove) this._remoteMap.delete(eid);
    }
  }

  _spawnRemote(s) {
    let e = null;
    if (s.t === 'arrow') {
      const mat = new THREE.MeshLambertMaterial({ color: 0x9c8b70 });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.55), mat);
      e = { type: 'arrow', pos: new THREE.Vector3(s.x, s.y, s.z), vel: new THREE.Vector3(),
        mesh, materials: [mat], age: 0, remove: false, dying: 0, invuln: 0, flash: 0 };
      this.ctx.scene.add(mesh);
      this.list.push(e);
    } else if (s.t === 'tnt') {
      const mat = new THREE.MeshLambertMaterial({ map: this.ctx.textures.texture });
      const mesh = new THREE.Mesh(this._fallingGeometry(BLOCK.TNT), mat);
      mesh.userData.sharedGeo = true;
      e = { type: 'tnt', pos: new THREE.Vector3(s.x, s.y, s.z), vel: new THREE.Vector3(),
        mesh, materials: [mat], height: 0.98, fuse: 4, age: 0, remove: false, dying: 0, invuln: 0, flash: 0 };
      this.ctx.scene.add(mesh);
      this.list.push(e);
    } else {
      e = this._spawnMob(s.t, Math.floor(s.x), s.y, Math.floor(s.z), {
        scale: s.s ?? 1, hp: s.hp, modifiers: s.m || [],
      });
      e.pos.set(s.x, s.y, s.z);
      // Boss beim Gast vollständig kennzeichnen (Leiste + korrekte Maximal-LP)
      if (s.t === 'crimson_zombie') {
        e.isBoss = true;
        e.name = 'Blutroter Zombie';
        e.maxHealth = s.mhp ?? e.health;
      }
    }
    e.remoteNet = true;
    e.eid = s.eid;
    return e;
  }

  // Host: Aktionen von Mitspielern anwenden
  findByEid(eid) {
    for (const e of this.list) if (e.eid === eid && !e.remove) return e;
    return null;
  }
  applyNetHit(eid, dmg, kx, kz, von) {
    const e = this.findByEid(eid);
    if (e) this.hurt(e, dmg, (kx || kz) ? { x: kx, z: kz } : null, von); // von = Gast-id → XP-Gutschrift
  }
  applyNetUse(eid, was) {
    const e = this.findByEid(eid);
    if (!e) return;
    if (was === 'schere') this.shearSheep(e);
    else if (was === 'feed') this.feed(e); // Gast hat gefüttert → Host verliebt das Tier
    else if (was === 'trade') this.gainTradeXp(e); // Gast hat gehandelt → Host zählt XP
  }

  // Host-Wechsel: alle Remote-Entities verwerfen (eigene Simulation übernimmt)
  clearRemote() {
    for (const e of this._remoteMap.values()) this._removeEntity(e);
    this._remoteMap.clear();
  }

  // Nächster angreifbarer Spieler (eigener oder Mitspieler) als KI-Ziel.
  // null, wenn niemand angreifbar ist. Der eigene Spieler zählt nur in
  // Survival + lebendig; ob ein MITSPIELER verwundbar ist, prüft dessen
  // Client selbst beim Empfang von 'phit'.
  _zielSpieler(e) {
    const st = this.ctx.state;
    let best = null;
    if (!st.dead && st.mode === 'survival' && !st.spectator) {
      const eigen = this.ctx.player.pos;
      best = { pos: eigen, id: 0, dist: e.pos.distanceTo(eigen) };
    }
    const net = this.ctx.net;
    if (net?.active) {
      for (const [id, r] of net.remote) {
        const d = e.pos.distanceTo(r.mesh.position);
        if (!best || d < best.dist) best = { pos: r.mesh.position, id, dist: d };
      }
    }
    return best;
  }

  // Schaden an einen Spieler austeilen (lokal oder übers Netz)
  _spielerSchaden(ziel, dmg, kx, kz) {
    if (ziel.id === 0) {
      this.ctx.survival.damage(dmg, 'mob');
      if (kx || kz) {
        const p = this.ctx.player;
        if (!armorStats(this.ctx.inventory?.armor).kbImmune) {
          p.vel.x += kx; p.vel.z += kz;
          p.vel.y = Math.min(p.vel.y + 3.5, 7);
        }
      }
    } else {
      this.ctx.net?.sendPlayerHit(ziel.id, dmg, kx, kz);
    }
  }

  // ---- Boss: Blutroter Zombie ----

  spawnBoss(x, y, z, spawnerKey = null) {
    const e = this._spawnMob('crimson_zombie', x, y, z, {
      hp: 150, scale: 1.8, moveSpeed: 2.7, attackDamage: 6,
    });
    e.noDespawn = true;
    e.isBoss = true;
    e.name = 'Blutroter Zombie';
    e.spawnerKey = spawnerKey;
    e.boss = { state: 'chase', t: 0, cd: 2.5, airborne: false, ring: null, aimX: 0, aimZ: 1 };
    this.ctx.furnaces?.burst(e.pos.x, e.pos.y + 1, e.pos.z, 30, { r: 0.85, g: 0.1, b: 0.08 });
    this.ctx.sounds?.explode?.();
    return e;
  }

  // AoE-Schaden an alle Spieler im Umkreis (mit optionalem Rückstoß nach außen)
  _bossAoe(cx, cy, cz, radius, dmg, knock = 0) {
    const st = this.ctx.state;
    const targets = [];
    if (!st.dead && st.mode === 'survival' && !st.spectator) targets.push({ pos: this.ctx.player.pos, id: 0 });
    const net = this.ctx.net;
    if (net?.active) for (const [id, r] of net.remote) targets.push({ pos: r.mesh.position, id });
    for (const t of targets) {
      const dx = t.pos.x - cx, dz = t.pos.z - cz;
      const d = Math.hypot(dx, dz);
      if (d <= radius && Math.abs(t.pos.y - cy) < 3.5) {
        const len = d || 1;
        this._spielerSchaden(t, dmg, (dx / len) * knock, (dz / len) * knock);
      }
    }
  }

  // Roten Telegraf-Kreis am Boden zeigen/verstecken (kündigt den Boden-Schlag an)
  _bossRingShow(e, x, y, z, radius) {
    this._bossRingHide(e);
    const geo = new THREE.CircleGeometry(radius, 30);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff2418, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, y + 0.06, z);
    ring.renderOrder = 2;
    this.ctx.scene.add(ring);
    e.boss.ring = ring;
  }

  _bossRingHide(e) {
    const ring = e.boss?.ring;
    if (ring) {
      this.ctx.scene.remove(ring);
      ring.geometry.dispose(); ring.material.dispose();
      e.boss.ring = null;
    }
  }

  // Eigenständiger Telegraf-Kreis mit Ablaufzeit — für Gäste (Host zeigt seinen eigenen Ring).
  // Wird per Netz ('bossring') ausgelöst, damit Mitspieler dem Boden-Schlag ausweichen können.
  showTelegraph(x, y, z, r, dur) {
    const geo = new THREE.CircleGeometry(r, 30);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff2418, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y + 0.06, z);
    mesh.renderOrder = 2;
    this.ctx.scene.add(mesh);
    this._telegraphs.push({ mesh, ttl: dur || 1.1 });
  }

  _tickTelegraphs(dt) {
    if (!this._telegraphs.length) return;
    for (let i = this._telegraphs.length - 1; i >= 0; i--) {
      const t = this._telegraphs[i];
      t.ttl -= dt;
      t.mesh.material.opacity = 0.25 + 0.32 * Math.abs(Math.sin(t.ttl * 6));
      if (t.ttl <= 0) {
        this.ctx.scene.remove(t.mesh);
        t.mesh.geometry.dispose(); t.mesh.material.dispose();
        this._telegraphs.splice(i, 1);
      }
    }
  }

  // Brüllen: verlangsamt alle Spieler im Umkreis — lokal direkt, Mitspieler per Netz
  _bossSlow(cx, cz, radius, dur) {
    const st = this.ctx.state;
    if (!st.dead && st.mode === 'survival' && !st.spectator) {
      const p = this.ctx.player.pos;
      if (Math.hypot(p.x - cx, p.z - cz) <= radius) {
        this.ctx.player.effects.slow = Math.max(this.ctx.player.effects.slow || 0, dur);
        this.ctx.ui?.toast?.('Das Brüllen lähmt dich!');
      }
    }
    const net = this.ctx.net;
    if (net?.active) {
      for (const [id, r] of net.remote) {
        if (Math.hypot(r.mesh.position.x - cx, r.mesh.position.z - cz) <= radius) net.sendPlayerSlow(id, dur);
      }
    }
  }

  // ---- combat ----

  hurt(entity, dmg, knockDir, attacker) {
    if (entity.type === 'item' || entity.type === 'arrow' || entity.type === 'falling'
      || entity.type === 'tnt' || entity.invuln > 0 || entity.dying > 0) return;
    // Wer den letzten echten Treffer landet, bekommt beim Tod die XP.
    // 'local' = eigener Spieler, Zahl = Gast-id, undefined = Umwelt (kein XP).
    if (attacker !== undefined) entity.lastAttacker = attacker;
    entity.health -= dmg;
    entity.invuln = 0.5;
    entity.flash = 0.18;
    for (const m of entity.materials) {
      m.emissive.setHex(0xff0000);
      m.emissiveIntensity = 0.55;
    }
    if (knockDir && !entity.modifiers?.has('anker')) { // „Anker": kein Rückstoß
      const kb = entity.isBoss ? 1.2 : 7; // der schwere Boss lässt sich kaum wegstoßen
      entity.vel.x += knockDir.x * kb;
      entity.vel.z += knockDir.z * kb;
      entity.vel.y = Math.min(entity.vel.y + (entity.isBoss ? 0.8 : 5), entity.isBoss ? 2 : 8);
    }
    if (entity.type === 'pig' || entity.type === 'sheep' || entity.type === 'chicken' || entity.type === 'fish' || entity.type === 'villager') {
      entity.ai.mode = 'flee';
      entity.ai.timer = 5;
    }
    if (entity.health <= 0) {
      // „Zweites Leben": einmal voll heilen statt zu sterben (goldenes Aufblitzen)
      if (entity.extraLives > 0) {
        entity.extraLives--;
        entity.health = entity.maxHealth;
        entity.flash = 0.5;
        for (const m of entity.materials) {
          m.emissive.setHex(0xffd24a);
          m.emissiveIntensity = 0.9;
        }
        return;
      }
      entity.dying = 0.25;
    }
  }

  raycast(origin, dir, maxDist) {
    let best = null, bestDist = maxDist;
    for (const e of this.list) {
      if (e.type === 'item' || e.type === 'falling' || e.type === 'arrow'
        || e.type === 'tnt' || e.dying > 0) continue;
      const h = e.width / 2;
      // ray vs AABB slab test
      let tmin = 0, tmax = bestDist, ok = true;
      const mins = [e.pos.x - h, e.pos.y, e.pos.z - h];
      const maxs = [e.pos.x + h, e.pos.y + e.height, e.pos.z + h];
      const o = [origin.x, origin.y, origin.z];
      const dd = [dir.x, dir.y, dir.z];
      for (let i = 0; i < 3; i++) {
        if (Math.abs(dd[i]) < 1e-9) {
          if (o[i] < mins[i] || o[i] > maxs[i]) { ok = false; break; }
        } else {
          let t1 = (mins[i] - o[i]) / dd[i];
          let t2 = (maxs[i] - o[i]) / dd[i];
          if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
          tmin = Math.max(tmin, t1);
          tmax = Math.min(tmax, t2);
          if (tmin > tmax) { ok = false; break; }
        }
      }
      if (ok && tmin < bestDist) {
        best = { entity: e, dist: tmin };
        bestDist = tmin;
      }
    }
    return best;
  }

  _die(e) {
    // XP an den Verursacher (nur Spieler-Kills zählen; reine Umwelt-Tode geben nichts).
    // Läuft auf dem Mob-Besitzer: eigener Kill → lokal, Gast-Kill → per Netz an den Gast.
    const att = e.lastAttacker;
    if (att != null) {
      const xp = this.ctx.experience?.xpForMob(e.type, e.isBoss) || 0;
      if (xp > 0) {
        if (att === 'local') this.ctx.experience.add(xp);
        else this.ctx.net?.sendXp(att, xp); // att = Gast-id
      }
    }
    // Split-Modifier: zerfällt in 4 schnelle Mini-Zombies (erben den Event-Schlüssel)
    if (e.modifiers?.has('split')) {
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const mini = this._spawnMob('zombie',
          Math.floor(e.pos.x + Math.cos(a) * 0.8), Math.floor(e.pos.y) + 0.5, Math.floor(e.pos.z + Math.sin(a) * 0.8), {
            scale: 0.5, hp: 5, moveSpeed: 3.6, attackDamage: 1,
            eventKey: e.eventKey,
          });
        mini.vel.set(Math.cos(a) * 3, 4, Math.sin(a) * 3);
      }
    }
    // Boss: fette Beute, Feuerwerk, und der Blutkern wird „geleert" (kein Respawn)
    if (e.isBoss) {
      this._bossRingHide(e);
      this._dropShared(e.pos.x, e.pos.y + 1, e.pos.z, ITEM.CRIMSON_BLOOD, 2 + Math.floor(Math.random() * 3)); // 2–4 Crimson Blood
      this._dropShared(e.pos.x, e.pos.y + 1, e.pos.z, ITEM.DIAMOND, 1 + Math.floor(Math.random() * 2));
      this._dropShared(e.pos.x, e.pos.y + 1, e.pos.z, ITEM.IRON_INGOT, 4 + Math.floor(Math.random() * 4));
      if (Math.random() < 0.05) { // sehr seltener Bonus: ein Rucksack
        this._dropShared(e.pos.x, e.pos.y + 1.2, e.pos.z, ITEM.BACKPACK, 1);
        this.ctx.ui?.toast?.('Ein Rucksack ist aus dem Blutroten Zombie gefallen!');
      }
      this.ctx.furnaces?.burst(e.pos.x, e.pos.y + 1, e.pos.z, 50, { r: 0.9, g: 0.1, b: 0.08 });
      this.ctx.ui?.toast?.('Der Blutrote Zombie ist besiegt!');
      if (e.spawnerKey) {
        const [sx, sy, sz] = e.spawnerKey.split(',').map(Number);
        if (this.ctx.world.getBlock(sx, sy, sz) === BLOCK.BOSS_SPAWNER) {
          this.ctx.world.setBlock(sx, sy, sz, BLOCK.AIR);
          this.ctx.net?.sendEdits([[sx, sy, sz, BLOCK.AIR]]);
        }
      }
    }
    // drops
    if (e.type === 'pig') {
      const n = 1 + Math.floor(Math.random() * 2);
      this._dropShared(e.pos.x, e.pos.y + 0.5, e.pos.z, ITEM.PORKCHOP, n);
    } else if (e.type === 'zombie') {
      const n = Math.floor(Math.random() * 3);
      if (n > 0) this._dropShared(e.pos.x, e.pos.y + 0.5, e.pos.z, ITEM.ROTTEN_FLESH, n);
    } else if (e.type === 'sheep') {
      const n = 1 + Math.floor(Math.random() * 2);
      this._dropShared(e.pos.x, e.pos.y + 0.5, e.pos.z, ITEM.MUTTON, n);
      if (e.hasWool) this._dropShared(e.pos.x, e.pos.y + 0.5, e.pos.z, BLOCK.WOOL, 1);
    } else if (e.type === 'chicken') {
      this._dropShared(e.pos.x, e.pos.y + 0.3, e.pos.z, ITEM.RAW_CHICKEN, 1);
      const f = Math.floor(Math.random() * 3); // 0–2 Federn
      if (f > 0) this._dropShared(e.pos.x, e.pos.y + 0.3, e.pos.z, ITEM.FEATHER, f);
    } else if (e.type === 'fish') {
      this._dropShared(e.pos.x, e.pos.y + 0.2, e.pos.z, ITEM.RAW_FISH, 1);
    } else if (e.type === 'skeleton') {
      const n = Math.floor(Math.random() * 3);
      if (n > 0) this._dropShared(e.pos.x, e.pos.y + 0.5, e.pos.z, ITEM.BONE, n);
    } else if (e.type === 'creeper') {
      // nur beim Erschlagen (nicht bei Explosion — dann wird _die nie erreicht)
      const n = Math.floor(Math.random() * 3);
      if (n > 0) this._dropShared(e.pos.x, e.pos.y + 0.5, e.pos.z, ITEM.GUNPOWDER, n);
    } else if (e.type === 'slime') {
      this._dropShared(e.pos.x, e.pos.y + 0.4, e.pos.z, ITEM.SLIMEBALL, 1 + Math.floor(Math.random() * 2)); // 1–2 Schleimbälle
    }
  }

  _removeEntity(e) {
    this.ctx.scene.remove(e.mesh);
    if (e.type !== 'item' && e.type !== 'falling') {
      e.mesh.traverse((o) => {
        if (o.geometry && !o.userData.sharedGeo) o.geometry.dispose();
      });
      for (const m of e.materials) m.dispose();
    }
    e.remove = true;
  }

  // ---- per-frame update ----

  update(dt) {
    const { world, player, survival, daynight, state } = this.ctx;

    this._tickTelegraphs(dt); // Boss-Telegraf-Kreise (Gäste) ablaufen lassen

    // Mehrspieler-Gast: keine eigene Spawn-Logik — der Host simuliert
    const gast = this.ctx.net?.active && !this.ctx.net.isHost;
    this.spawnTimer += dt;
    if (this.spawnTimer >= 2 && !gast) {
      this.spawnTimer = 0;
      // Um JEDEN Spieler ein Spawn-Versuch; der gemeinsame Cap wächst mit der Spielerzahl
      const anker = this._alleAnker();
      for (const a of anker) {
        this._attemptSpawns(a, anker.length);
        this._attemptCaveSpawn(a, anker.length);
        this._attemptVillagerSpawn(a, anker.length);
      }
    }

    for (const e of this.list) {
      if (e.remove) continue;

      // Remote-Entity (Gast): nur zum Netz-Ziel bewegen + Basis-Animation
      if (e.remoteNet) {
        e.invuln = Math.max(0, (e.invuln || 0) - dt);
        if (e.flash > 0) {
          e.flash -= dt;
          if (e.flash <= 0 && e.materials) for (const m of e.materials) m.emissiveIntensity = 0;
        }
        if (e.dying > 0) {
          e.dying -= dt;
          e.mesh.scale.setScalar(Math.max(0.01, (e.dying / 0.25) * (e.scale || 1)));
          if (e.dying <= 0) this._removeEntity(e); // ohne Drops — die sendet der Host
          continue;
        }
        if (e.netTarget) {
          const k = Math.min(1, dt * 12);
          const altX = e.pos.x, altZ = e.pos.z;
          e.pos.x += (e.netTarget.x - e.pos.x) * k;
          e.pos.y += (e.netTarget.y - e.pos.y) * k;
          e.pos.z += (e.netTarget.z - e.pos.z) * k;
          e.yaw = (e.yaw ?? 0) + ((e.netTarget.yaw - (e.yaw ?? 0)) * k);
          const tempo = Math.hypot(e.pos.x - altX, e.pos.z - altZ) / Math.max(dt, 1e-4);
          e.animPhase = (e.animPhase || 0) + dt * tempo * 3.5;
          if (e.legs) {
            const swing = Math.sin(e.animPhase) * 0.55 * Math.min(1, tempo);
            for (let i = 0; i < e.legs.length; i++) e.legs[i].rotation.x = i % 2 === 0 ? swing : -swing;
          }
        }
        if (e.type === 'tnt' && e.materials) { // Blinken auch für Gäste
          const on = Math.sin(performance.now() * 0.012) > 0;
          e.materials[0].emissive.setHex(0xffffff);
          e.materials[0].emissiveIntensity = on ? 0.75 : 0;
        }
        if (e.type === 'creeper' && e.fusing) e.mesh.scale.setScalar((e.scale || 1) * 1.15);
        // Weidetiere beim Gast: Baby-Wachstum nachziehen + Zucht-Herzchen zeigen
        if (e.type === 'pig' || e.type === 'sheep' || e.type === 'chicken') {
          const ns = e._netScale ?? 1;
          if (Math.abs(ns - (e.scale || 1)) > 0.01) { e.scale = ns; e.mesh.scale.setScalar(ns); }
          if (e.love > 0) { e._heartT = (e._heartT || 0) - dt; if (e._heartT <= 0) { e._heartT = 0.7; this._heartBurst(e); } }
        }
        e.mesh.position.set(e.pos.x, e.pos.y + (e.type === 'tnt' || e.type === 'falling' ? (e.height || 1) / 2 : 0), e.pos.z);
        if (e.type !== 'tnt' && e.type !== 'falling') e.mesh.rotation.y = e.yaw || 0;
        continue;
      }

      if (e.type === 'item') {
        this._updateItem(e, dt);
        continue;
      }
      if (e.type === 'falling') {
        this._updateFalling(e, dt);
        continue;
      }
      if (e.type === 'arrow') {
        this._updateArrow(e, dt);
        continue;
      }
      if (e.type === 'tnt') {
        this._updateTnt(e, dt);
        continue;
      }

      // timers
      e.invuln = Math.max(0, e.invuln - dt);
      e.attackCooldown = Math.max(0, e.attackCooldown - dt);
      if (e.flash > 0) {
        e.flash -= dt;
        if (e.flash <= 0) for (const m of e.materials) m.emissiveIntensity = 0;
      }
      if (e.dying > 0) {
        e.dying -= dt;
        e.mesh.scale.setScalar(Math.max(0.01, e.dying / 0.25));
        if (e.dying <= 0) {
          this._die(e);
          this._removeEntity(e);
        }
        continue;
      }

      // despawn far away (Ereignis-Monster bleiben) — nur wenn ALLE Spieler fern sind
      if (!e.noDespawn) {
        let dMin = e.pos.distanceTo(player.pos);
        const netD = this.ctx.net;
        if (netD?.active) {
          for (const r of netD.remote.values()) {
            const d = e.pos.distanceTo(r.mesh.position);
            if (d < dMin) dMin = d;
          }
        }
        // Dorfbewohner bleiben länger geladen, damit sie im Dorf nicht verschwinden
        if (dMin > (e.type === 'villager' ? 96 : DESPAWN_DIST)) {
          this._removeEntity(e);
          continue;
        }
      }

      // AI
      let wantSpeed = 0;
      const ai = e.ai;
      if (e.type === 'zombie') {
        // burn at day — aber nur unter offenem Himmel (Untertage-Monster sind sicher)
        if (!daynight.isNight() && !e.eventKey) {
          const bl = world.getLight(Math.floor(e.pos.x), Math.floor(e.pos.y + 1), Math.floor(e.pos.z));
          if ((bl >> 4) >= 12) {
            e.burnAcc += dt;
            if (e.burnAcc >= 1) {
              e.burnAcc = 0;
              this.hurt(e, 1, null);
              if (e.dying > 0) continue;
            }
          }
        }
        const ziel = this._zielSpieler(e);
        if (ziel && ziel.dist < 20) {
          const distP = ziel.dist;
          const dx = ziel.pos.x - e.pos.x, dz = ziel.pos.z - e.pos.z;
          const len = Math.hypot(dx, dz) || 1;
          ai.dirX = dx / len; ai.dirZ = dz / len;
          wantSpeed = e.moveSpeed ?? 2.3;
          if (distP < 1.5 * e.scale && e.attackCooldown <= 0) {
            e.attackCooldown = 1;
            const kx = (dx / len) * 6, kz = (dz / len) * 6;
            this._spielerSchaden(ziel, e.attackDamage ?? 3, kx, kz);
            if (ziel.id === 0) {
              const thorns = survival.getThorns();
              if (thorns > 0) {
                this.hurt(e, thorns, null); // Dornen-Rückschaden
                if (e.dying > 0) continue;
              }
            }
          }
        } else {
          wantSpeed = this._wander(e, dt, 0.8);
        }
      } else if (e.type === 'crimson_zombie') {
        // Boss: verbrennt nie, jagt den Spieler und wechselt zwischen 3 Angriffen
        const b = e.boss;
        const ziel = this._zielSpieler(e);
        b.cd -= dt; b.t -= dt;
        if (ziel) {
          const dx = ziel.pos.x - e.pos.x, dz = ziel.pos.z - e.pos.z;
          const len = Math.hypot(dx, dz) || 1;
          b.aimX = dx / len; b.aimZ = dz / len;
        }
        if (b.state === 'chase') {
          if (ziel && ziel.dist < 40) {
            ai.dirX = b.aimX; ai.dirZ = b.aimZ;
            wantSpeed = e.moveSpeed;
            if (b.cd <= 0 && ziel.dist < 13) {
              const r = Math.random();
              if (ziel.dist > 6 && r < 0.5) {
                // 1) Sprung-Angriff: zum Spieler springen, beim Aufschlag Schaden + Rückstoß
                b.state = 'jump'; b.t = 1.3; b.airborne = false;
                e.vel.y = 9; e.vel.x = b.aimX * 9; e.vel.z = b.aimZ * 9;
                this.ctx.sounds?.shoot?.();
              } else if (r < 0.8) {
                // 2) Boden-Schlag: roter Telegraf-Kreis am Spielerstandort, verzögerter AoE
                b.state = 'slamWind'; b.t = 1.1;
                b.slamX = ziel.pos.x; b.slamY = ziel.pos.y; b.slamZ = ziel.pos.z;
                this._bossRingShow(e, b.slamX, b.slamY, b.slamZ, 3.6);
                this.ctx.net?.sendBossRing(b.slamX, b.slamY, b.slamZ, 3.6, 1.1); // Gäste sehen den Kreis auch
              } else {
                // 3) Brüllen: verlangsamt alle Spieler in der Nähe (lokal + Mitspieler per Netz)
                b.state = 'roar'; b.t = 0.8;
                this.ctx.sounds?.hurt?.();
                this.ctx.furnaces?.burst(e.pos.x, e.pos.y + 1.6, e.pos.z, 24, { r: 0.9, g: 0.15, b: 0.1 });
                this._bossSlow(e.pos.x, e.pos.z, 14, 4);
              }
            }
          } else {
            wantSpeed = this._wander(e, dt, 0.9);
          }
        } else if (b.state === 'slamWind') {
          if (b.ring) b.ring.material.opacity = 0.25 + 0.32 * Math.abs(Math.sin(e.animPhase * 6));
          if (b.t <= 0) {
            this._bossRingHide(e);
            this._bossAoe(b.slamX, b.slamY, b.slamZ, 3.6, e.attackDamage + 3, 6);
            this.ctx.furnaces?.burst(b.slamX, b.slamY + 0.3, b.slamZ, 34, { r: 0.85, g: 0.12, b: 0.08 });
            this.ctx.sounds?.explode?.();
            b.state = 'recover'; b.t = 0.5; b.cd = 3 + Math.random();
          }
        } else if (b.state === 'jump') {
          ai.dirX = b.aimX; ai.dirZ = b.aimZ; wantSpeed = e.moveSpeed * 1.4;
          if (!e.onGround) b.airborne = true;
          if ((b.airborne && e.onGround) || b.t <= 0) {
            this._bossAoe(e.pos.x, e.pos.y, e.pos.z, 3.2, e.attackDamage, 9);
            this.ctx.furnaces?.burst(e.pos.x, e.pos.y + 0.2, e.pos.z, 28, { r: 0.85, g: 0.12, b: 0.08 });
            this.ctx.sounds?.explode?.();
            b.state = 'recover'; b.t = 0.5; b.cd = 3 + Math.random();
          }
        } else if (b.state === 'roar') {
          if (b.t <= 0) { b.state = 'recover'; b.t = 0.4; b.cd = 3.5 + Math.random(); }
        } else { // recover
          if (ziel) { ai.dirX = b.aimX; ai.dirZ = b.aimZ; wantSpeed = e.moveSpeed * 0.4; }
          if (b.t <= 0) b.state = 'chase';
        }
      } else if (e.type === 'slime') {
        // Schleim: hüpft (zum Spieler, sonst zufällig) und macht Kontaktschaden
        const ziel = this._zielSpieler(e);
        if (e.onGround) {
          e.vel.x *= 0.5; e.vel.z *= 0.5; // Reibung zwischen den Sprüngen
          e._slimeT = (e._slimeT || 0) - dt;
          if (e._slimeT <= 0) {
            e._slimeT = 0.7 + Math.random() * 0.7;
            let hx, hz;
            if (ziel && ziel.dist < 16) { const dx = ziel.pos.x - e.pos.x, dz = ziel.pos.z - e.pos.z, len = Math.hypot(dx, dz) || 1; hx = dx / len; hz = dz / len; }
            else { const ang = Math.random() * Math.PI * 2; hx = Math.cos(ang); hz = Math.sin(ang); }
            e.vel.x = hx * 3.6; e.vel.z = hz * 3.6; e.vel.y = 6.8; // Sprung
            e.yaw = Math.atan2(hx, hz);
          }
        }
        if (ziel && ziel.dist < 1.4 * e.scale && e.attackCooldown <= 0) {
          e.attackCooldown = 0.9;
          const dx = ziel.pos.x - e.pos.x, dz = ziel.pos.z - e.pos.z, len = Math.hypot(dx, dz) || 1;
          this._spielerSchaden(ziel, e.attackDamage ?? 2, (dx / len) * 4, (dz / len) * 4);
        }
      } else if (e.type === 'skeleton') {
        // verbrennt am Tag wie der Zombie (nur unter offenem Himmel)
        if (!daynight.isNight() && !e.eventKey) {
          const bl = world.getLight(Math.floor(e.pos.x), Math.floor(e.pos.y + 1), Math.floor(e.pos.z));
          if ((bl >> 4) >= 12) {
            e.burnAcc += dt;
            if (e.burnAcc >= 1) {
              e.burnAcc = 0;
              this.hurt(e, 1, null);
              if (e.dying > 0) continue;
            }
          }
        }
        const ziel = this._zielSpieler(e);
        if (ziel && ziel.dist < 18) {
          const distP = ziel.dist;
          const dx = ziel.pos.x - e.pos.x, dz = ziel.pos.z - e.pos.z;
          const len = Math.hypot(dx, dz) || 1;
          // Abstand halten: zu nah → weg, zu fern → ran, sonst stehen und schießen
          let sign = 0;
          if (distP < 7) sign = -1;
          else if (distP > 13) sign = 1;
          ai.dirX = (dx / len) * sign; ai.dirZ = (dz / len) * sign;
          wantSpeed = sign !== 0 ? 2.4 : 0;
          if (sign === 0) e.yaw = Math.atan2(dx, dz); // Ziel anvisieren
          e.shootTimer -= dt;
          if (e.shootTimer <= 0 && distP < 16) {
            e.shootTimer = 2 + Math.random() * 0.6;
            this._shootArrow(e, ziel.pos);
          }
        } else {
          wantSpeed = this._wander(e, dt, 0.8);
        }
      } else if (e.type === 'creeper') {
        const zielC = this._zielSpieler(e);
        const distP = zielC ? zielC.dist : Infinity;
        const canTarget = !!zielC;
        if (canTarget && distP < 2.8) {
          // Zündung: stehen bleiben, zischen, blinken, anschwellen
          if (!e.fusing) { e.fusing = true; this.ctx.sounds.fuse(); }
          e.fuse += dt;
          ai.dirX = 0; ai.dirZ = 0;
          const dx = zielC.pos.x - e.pos.x, dz = zielC.pos.z - e.pos.z;
          e.yaw = Math.atan2(dx, dz);
          const blink = Math.sin(e.fuse * 22) > 0 ? 0.9 : 0;
          for (const m of e.materials) {
            m.emissive.setHex(0xffffff);
            m.emissiveIntensity = blink;
          }
          e.mesh.scale.setScalar(1 + (e.fuse / FUSE_TIME) * 0.3);
          if (e.fuse >= FUSE_TIME) {
            this._explode(e);
            continue;
          }
        } else {
          // Zündung bricht ab, wenn der Spieler entkommt
          if (e.fusing) {
            e.fuse = Math.max(0, e.fuse - dt * 2);
            if (e.fuse <= 0) {
              e.fusing = false;
              for (const m of e.materials) m.emissiveIntensity = 0;
              e.mesh.scale.setScalar(1);
            } else {
              e.mesh.scale.setScalar(1 + (e.fuse / FUSE_TIME) * 0.3);
            }
          }
          if (canTarget && distP < 14) {
            const dx = zielC.pos.x - e.pos.x, dz = zielC.pos.z - e.pos.z;
            const len = Math.hypot(dx, dz) || 1;
            ai.dirX = dx / len; ai.dirZ = dz / len;
            wantSpeed = 2.6;
          } else {
            wantSpeed = this._wander(e, dt, 0.9);
          }
        }
      } else if (e.type === 'fish') {
        // Fisch: freies 3D-Schwimmen, bleibt im Wasser, zappelt an Land
        e.swimTimer -= dt;
        if (e.swimTimer <= 0 || !e.swimDir) {
          e.swimTimer = 1.5 + Math.random() * 2.5;
          const a = Math.random() * Math.PI * 2;
          e.swimDir = { x: Math.cos(a), y: (Math.random() - 0.5) * 0.5, z: Math.sin(a) };
        }
        let sp = 1.3;
        if (ai.mode === 'flee') {
          ai.timer -= dt;
          const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z;
          const l = Math.hypot(dx, dz) || 1;
          e.swimDir.x = dx / l; e.swimDir.z = dz / l;
          sp = 3.2;
          if (ai.timer <= 0) { ai.mode = 'idle'; ai.timer = 1; }
        }
        if (e.inWater) {
          // nicht aus dem Wasser schwimmen: voraus prüfen, sonst umdrehen
          const ahead = world.getBlock(
            Math.floor(e.pos.x + e.swimDir.x),
            Math.floor(e.pos.y + 0.15 + e.swimDir.y),
            Math.floor(e.pos.z + e.swimDir.z));
          if (!isWaterId(ahead)) {
            e.swimDir.x *= -1; e.swimDir.z *= -1;
            e.swimDir.y = -Math.abs(e.swimDir.y) * 0.5;
          }
          const acc = 6;
          e.vel.x += Math.max(-acc * dt, Math.min(acc * dt, e.swimDir.x * sp - e.vel.x));
          e.vel.y += Math.max(-acc * dt, Math.min(acc * dt, e.swimDir.y * sp * 0.6 - e.vel.y));
          e.vel.z += Math.max(-acc * dt, Math.min(acc * dt, e.swimDir.z * sp - e.vel.z));
          stepEntity(world, e, dt, { noGravity: true });
          e.fallDistance = 0;
        } else {
          // gestrandet: zappeln und langsam ersticken
          stepEntity(world, e, dt);
          if (e.onGround && Math.random() < dt * 2.5) {
            e.vel.y = 3.2;
            e.vel.x = (Math.random() - 0.5) * 2.5;
            e.vel.z = (Math.random() - 0.5) * 2.5;
          }
          e.suffocate = (e.suffocate || 0) + dt;
          if (e.suffocate >= 2) {
            e.suffocate = 0;
            e.invuln = 0;
            this.hurt(e, 1, null);
            if (e.dying > 0) continue;
          }
        }
        e.mesh.position.copy(e.pos);
        const spd = e.vel.length();
        if (spd > 0.05) e.yaw = Math.atan2(e.vel.x, e.vel.z);
        e.mesh.rotation.y = e.yaw;
        e.animPhase += dt * (2 + spd * 4);
        if (e.tail) e.tail.rotation.y = Math.sin(e.animPhase * 4) * 0.6;
        continue;
      } else { // pig, sheep & chicken (Weidetiere)
        if (e.breedCd > 0) e.breedCd -= dt;
        let seeking = false;
        // Zucht: verliebte Tiere suchen den nächsten Partner und paaren sich
        if (e.love > 0) {
          e.love -= dt;
          e._heartT -= dt;
          if (e._heartT <= 0) { e._heartT = 0.7; this._heartBurst(e); } // Herzchen steigen auf
          const partner = this._breedPartner(e);
          if (partner) {
            const dx = partner.pos.x - e.pos.x, dz = partner.pos.z - e.pos.z;
            const d = Math.hypot(dx, dz) || 1;
            if (d < 1.2) { this._breed(e, partner); }
            else { ai.dirX = dx / d; ai.dirZ = dz / d; wantSpeed = 1.8; seeking = true; }
          }
        }
        if (!seeking) {
          if (ai.mode === 'flee') {
            ai.timer -= dt;
            const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z;
            const len = Math.hypot(dx, dz) || 1;
            ai.dirX = dx / len; ai.dirZ = dz / len;
            wantSpeed = 3.5;
            if (ai.timer <= 0) { ai.mode = 'idle'; ai.timer = 1 + Math.random() * 2; }
          } else {
            wantSpeed = this._wander(e, dt, e.type === 'sheep' ? 1.1 : 1.4);
          }
          // Dorfbewohner bleiben in der Nähe ihres Dorfs (Leine ans Zentrum)
          if (e.type === 'villager' && e.home) {
            const hx = e.home.x - e.pos.x, hz = e.home.z - e.pos.z, hd = Math.hypot(hx, hz);
            if (hd > 22) { ai.dirX = hx / hd; ai.dirZ = hz / hd; wantSpeed = Math.max(wantSpeed, 1.3); }
          }
        }
        // Geschorene Schafe fressen nach ~5 min Gras → Wolle wächst nach
        if (e.type === 'sheep' && !e.hasWool) {
          e.eatTimer -= dt;
          if (e.eatTimer <= 0) {
            const bx = Math.floor(e.pos.x), by = Math.floor(e.pos.y - 0.05), bz = Math.floor(e.pos.z);
            if (world.getBlock(bx, by, bz) === BLOCK.GRASS) {
              world.setBlock(bx, by, bz, BLOCK.DIRT); // Gras ist abgegrast
              e.hasWool = true;
              for (const m of e.woolParts) m.visible = true;
              this.ctx.sounds.sheep();
            } else {
              e.eatTimer = 4 + Math.random() * 6; // kein Gras hier — bald erneut versuchen
            }
          }
        }
        // Baby wächst allmählich zum erwachsenen Tier (Skalierung 0.5 → 1)
        if (e.baby) {
          e.growTimer -= dt;
          if (e.growTimer <= 0) {
            e.baby = false; e.scale = 1;
            e.mesh.scale.setScalar(1); e.width = e.baseW; e.height = e.baseH;
          } else {
            const t = Math.max(0, Math.min(1, 1 - e.growTimer / BABY_GROW_TIME));
            const sc = 0.5 + 0.5 * t;
            e.scale = sc; e.mesh.scale.setScalar(sc);
            e.width = e.baseW * sc; e.height = e.baseH * sc;
          }
        }
      }

      // steer
      const accel = 25;
      if (e.type !== 'slime') { // Schleime bewegen sich per Sprung, nicht durch Steuern
        e.vel.x += Math.max(-accel * dt, Math.min(accel * dt, ai.dirX * wantSpeed - e.vel.x));
        e.vel.z += Math.max(-accel * dt, Math.min(accel * dt, ai.dirZ * wantSpeed - e.vel.z));
      }

      let stepOpts;
      if (e.type === 'chicken') {
        // Huhn flattert herab: eigene sanfte Schwerkraft, Fallgeschwindigkeit auf 3 B/s gedeckelt
        e.vel.y = Math.max(-3, e.vel.y - 18 * dt);
        stepOpts = { noGravity: true };
      }
      const res = stepEntity(world, e, dt, stepOpts);
      if (res.landed && res.fallDistance > 3 && e.type !== 'chicken') {
        this.hurt(e, Math.floor(res.fallDistance - 3), null);
      }
      if (e.inLava) {
        e.lavaAcc = (e.lavaAcc || 0) + dt;
        if (e.lavaAcc >= 0.5) {
          e.lavaAcc = 0;
          e.invuln = 0;
          this.hurt(e, 3, null);
          if (e.dying > 0) continue;
        }
      }
      // jump when running against a wall (Huhn springt niedriger, passend zur sanften Schwerkraft)
      if (wantSpeed > 0 && e.onGround) {
        const moving = Math.hypot(e.vel.x, e.vel.z);
        if (moving < wantSpeed * 0.35) e.vel.y = e.type === 'chicken' ? 5 : 8.5;
      }
      if (e.inWater) e.vel.y = Math.min(e.vel.y + 20 * dt, 3); // mobs paddle up

      // mesh sync + animation
      e.mesh.position.copy(e.pos);
      if (e.type === 'slime') { // immer ein perfekter Würfel (kein Squash), zeigt in Sprungrichtung
        e.mesh.scale.setScalar(e.scale || 1);
        e.mesh.rotation.y = e.yaw;
        continue;
      }
      const speed = Math.hypot(e.vel.x, e.vel.z);
      if (speed > 0.1) {
        e.yaw = Math.atan2(e.vel.x, e.vel.z);
        e.animPhase += dt * speed * 3.5;
      }
      e.mesh.rotation.y = e.yaw;
      const swing = Math.sin(e.animPhase) * 0.55 * Math.min(1, speed);
      for (let i = 0; i < e.legs.length; i++) {
        e.legs[i].rotation.x = i % 2 === 0 ? swing : -swing;
      }
      for (let i = 0; i < e.arms.length; i++) {
        e.arms[i].rotation.x = Math.sin(e.animPhase * 0.7) * 0.1;
      }
    }

    // compact list
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.list[i].remove) this.list.splice(i, 1);
    }
  }

  _wander(e, dt, speed) {
    const ai = e.ai;
    ai.timer -= dt;
    if (ai.timer <= 0) {
      if (ai.mode === 'walk' || Math.random() < 0.55) {
        ai.mode = 'idle';
        ai.timer = 1 + Math.random() * 2.5;
        ai.dirX = 0; ai.dirZ = 0;
      } else {
        ai.mode = 'walk';
        ai.timer = 2 + Math.random() * 3;
        const a = Math.random() * Math.PI * 2;
        ai.dirX = Math.cos(a); ai.dirZ = Math.sin(a);
      }
    }
    return ai.mode === 'walk' ? speed : 0;
  }

  _updateItem(e, dt) {
    e.age += dt;
    if (e.age > ITEM_LIFETIME) { this._removeEntity(e); return; }

    const player = this.ctx.player;
    const center = this._v1.set(player.pos.x, player.pos.y + 0.9, player.pos.z);
    const d = e.pos.distanceTo(center);

    if (e.age > (e.pickupDelay ?? 0.5) && d < 1.8 && !this.ctx.state.spectator) {
      // magnet toward player
      const dir = this._v2.subVectors(center, e.pos).normalize();
      e.vel.set(dir.x * 8, dir.y * 8, dir.z * 8);
      e.pos.addScaledVector(e.vel, dt);
      if (d < 0.7) {
        const left = this.ctx.inventory.addItemStack(e.stack);
        if (left <= 0) {
          this.ctx.sounds.pickup();
          if (e.netId != null) this.ctx.net?.sendItemPick(e.netId); // bei allen entfernen
          this._removeEntity(e);
          return;
        }
        e.stack.count = left;
        e.count = left;
      }
    } else {
      stepEntity(this.ctx.world, e, dt);
      // ground friction
      if (e.onGround) {
        e.vel.x *= Math.max(0, 1 - 8 * dt);
        e.vel.z *= Math.max(0, 1 - 8 * dt);
      }
    }

    e.mesh.position.set(e.pos.x, e.pos.y + 0.18 + Math.sin(e.age * 2.5) * 0.05, e.pos.z);
    e.mesh.rotation.y = e.age * 1.8;
  }

  dispose() {
    for (const e of this.list) this._removeEntity(e);
    this.list.length = 0;
    for (const g of this._itemGeoCache.values()) g.dispose();
    this._itemMat.dispose();
  }
}
