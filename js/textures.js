// Procedural 16x16 pixel-art tile atlas (8x8 tiles = 128x128 canvas) + inventory icons.

import * as THREE from 'three';
import { mulberry32 } from './noise.js';
import { BLOCKS, ITEMS, isBlockId } from './constants.js';
import { TILE_NAMES, TILE_PX as TILE, ATLAS_COLS as COLS, uvRect } from './atlasmap.js';

// ---- painter helpers -------------------------------------------------------

function makePaintCtx(g, ox, oy, seedName) {
  let s = 0;
  for (let i = 0; i < seedName.length; i++) s = (s * 31 + seedName.charCodeAt(i)) | 0;
  const rand = mulberry32(s ^ 0x51ab);
  return {
    rand,
    px(x, y, c) { g.fillStyle = c; g.fillRect(ox + x, oy + y, 1, 1); },
    rect(x, y, w, h, c) { g.fillStyle = c; g.fillRect(ox + x, oy + y, w, h); },
    clear(x, y, w = 1, h = 1) { g.clearRect(ox + x, oy + y, w, h); },
    speckle(palette, weights) {
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const r = rand();
        let acc = 0, c = palette[0];
        for (let i = 0; i < palette.length; i++) { acc += weights ? weights[i] : 1 / palette.length; if (r < acc) { c = palette[i]; break; } }
        g.fillStyle = c; g.fillRect(ox + x, oy + y, 1, 1);
      }
    },
    blob(cx, cy, rx, ry, main, hi, lo) {
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        const d = dx * dx + dy * dy + (rand() - 0.5) * 0.25;
        if (d <= 1) {
          let c = main;
          if (hi && dx + dy < -0.5) c = hi;
          else if (lo && dx + dy > 0.6) c = lo;
          g.fillStyle = c; g.fillRect(ox + x, oy + y, 1, 1);
        }
      }
    },
  };
}

const GRASS = ['#79c05a', '#70b350', '#86ca67', '#64a446'];
const DIRTS = ['#96694a', '#8a5f42', '#a0714f', '#7d5539'];
const STONES = ['#828282', '#8a8a8a', '#787878', '#909090', '#6e6e6e'];
const SANDS = ['#dbc681', '#d1bc76', '#e3d08d', '#c9b26c'];
const WOOD_D = '#5d4527', WOOD_M = '#6e5230', WOOD_L = '#7d5e38';
const PLANK_M = '#b8945f', PLANK_L = '#c9a56d', PLANK_D = '#9c7c4e';

function paintDirt(p) { p.speckle(DIRTS, [0.4, 0.25, 0.2, 0.15]); }
function paintStoneBase(p) { p.speckle(STONES, [0.35, 0.2, 0.2, 0.15, 0.1]); }

// Beerenbusch-Sprite: grüner Busch (unten dichter) mit farbigen Beeren-Tupfen
function paintBerryBush(p, berry, berryLite) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const r = p.rand();
    if (r < 0.36 + (15 - y) * 0.006) continue; // Buschform: unten voller, oben lockerer
    p.px(x, y, r < 0.5 ? '#2c5a1e' : r < 0.8 ? '#377326' : '#4a9134');
  }
  for (let i = 0; i < 10; i++) {
    const x = 3 + Math.floor(p.rand() * 10), y = 5 + Math.floor(p.rand() * 9);
    p.px(x, y, berry);
    p.px(x, y - 1, p.rand() < 0.5 ? berryLite : berry); // kleines Glanzlicht
  }
}

// Beeren als Item-Symbol: kleine Traube aus drei runden Beeren
function paintBerries(p, main, lite, dark) {
  p.blob(6, 9, 3, 3, main, lite, dark);
  p.blob(10, 10, 3, 3, main, lite, dark);
  p.blob(9, 5, 2.6, 2.6, main, lite, dark);
}
// Farbige Brett-Textur (Maserung + versetzte Fugen) — pro Holzart eigene Töne.
function paintPlanksColored(p, M, L, D) {
  p.speckle([M, L], [0.85, 0.15]);
  for (let row = 0; row < 4; row++) {
    p.rect(0, row * 4 + 3, 16, 1, D);
    const seam = row % 2 === 0 ? 11 : 4;
    p.rect(seam, row * 4, 1, 3, D);
  }
}
function paintPlanks(p) { paintPlanksColored(p, PLANK_M, PLANK_L, PLANK_D); } // Eiche (Standard)
// ---- animierte Unterwasser-Pflanzen (4 Frames, wehen hin und her wie in MC) ----

function paintSeagrassFrame(p, f) {
  p.clear(0, 0, 16, 16);
  const ph = (f / 4) * Math.PI * 2;
  for (const [x0, h, sw] of [[3, 9, 1], [6, 12, -1], [9, 10, 1], [12, 8, -1]]) {
    for (let i = 0; i < h; i++) {
      // je höher am Halm, desto stärker das Wehen
      const lean = Math.round(Math.sin(ph + i * 0.35) * (i / h) * 2.2) * sw;
      const x = Math.max(0, Math.min(15, x0 + lean));
      p.px(x, 15 - i, i % 3 === 0 ? '#3e8e4e' : '#4aa65c');
    }
  }
}

function paintKelpFrame(p, f) {
  p.clear(0, 0, 16, 16);
  const ph = (f / 4) * Math.PI * 2;
  for (let i = 0; i < 16; i++) {
    const x = 7 + Math.round(Math.sin(i * 0.8 + ph) * 1.8);
    p.px(x, 15 - i, '#3a7d3a'); p.px(x + 1, 15 - i, '#4e9948');
  }
  for (const [k, [x, y]] of [[4, 3], [11, 5], [4, 9], [11, 11]].entries()) {
    const wx = Math.max(0, Math.min(14, x + Math.round(Math.sin(ph + k) * 1.5)));
    p.rect(wx, y, 2, 1, '#5aa852'); p.px(wx + (wx < 8 ? 2 : -1), y, '#4e9948');
  }
}

function paintKelpTopFrame(p, f) {
  p.clear(0, 0, 16, 16);
  const ph = (f / 4) * Math.PI * 2;
  // kurzer Strang, der oben ausläuft
  for (let i = 0; i < 10; i++) {
    const x = 7 + Math.round(Math.sin(i * 0.8 + ph) * 1.6);
    p.px(x, 15 - i, '#3a7d3a'); p.px(x + 1, 15 - i, '#4e9948');
  }
  // kleine Unterwasser-Blüte an der Spitze (wiegt mit)
  const bx = 7 + Math.round(Math.sin(10 * 0.8 + ph) * 1.6);
  p.rect(bx - 1, 3, 4, 3, '#7ac4b0');
  p.rect(bx, 2, 2, 1, '#a4e0cc'); p.rect(bx, 6, 2, 1, '#5aa892');
  p.px(bx - 2, 4, '#a4e0cc'); p.px(bx + 3, 4, '#a4e0cc');
  p.px(bx, 4, '#f0e6a8'); p.px(bx + 1, 4, '#e8d488'); // Blütenmitte
}

// Stehendes Wasser: ruhiges, statisches Muster (bewegt sich nicht)
function paintStillWater(p) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const wave = (y + ((x / 4) | 0)) % 8 < 2;
    p.px(x, y, wave ? '#4f86f0' : p.rand() < 0.1 ? '#3660c4' : '#3f76e4');
  }
}

// Fließendes Wasser: Streifen wandern deutlich in v-Richtung (Fließrichtung
// wird im Mesher per UV-Rotation an das Gefälle angepasst)
function paintWaterFlowFrame(p, f) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const v = (y + ((x / 5) | 0) + f * 4) % 16; // scrollt pro Frame um 4px (Periode 16 → 4 Frames)
    const strom = v < 5;
    const schaum = v === 5 && p.rand() < 0.55;
    p.px(x, y, schaum ? '#9cc0ff' : strom ? '#5b92f6' : p.rand() < 0.12 ? '#3660c4' : '#3f76e4');
  }
}

// Lava: Farb-Shift rot → orange → gelb → orange → rot (4 Frames) + kriechendes Muster
const LAVA_SHIFT = [
  ['#c94a10', '#e8721c', '#ffb830', '#ffe75c'], // rötlich
  ['#d85a14', '#f08228', '#ffc648', '#fff07a'], // orange
  ['#e8721c', '#ffa030', '#ffd85c', '#fff9a0'], // gelblich
  ['#d85a14', '#f08228', '#ffc648', '#fff07a'], // orange (zurück)
];
// Stehende Lava: Muster steht still, nur die Farben pulsieren langsam
function paintLavaFrame(p, f) {
  const [dunkel, mittel, hell, spitze] = LAVA_SHIFT[f % 4];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const wave = (y + ((x / 3) | 0)) % 6 < 2;
    const r = p.rand();
    p.px(x, y, wave ? (r < 0.3 ? spitze : hell) : r < 0.15 ? dunkel : mittel);
  }
}

// Fließende Lava: Strömungsstreifen scrollen in Fließrichtung + Farb-Puls
function paintLavaFlowFrame(p, f) {
  const [dunkel, mittel, hell, spitze] = LAVA_SHIFT[f % 4];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const v = (y + ((x / 5) | 0) + f * 4) % 16; // 4px pro Frame, Periode 16
    const strom = v < 5;
    const glut = v === 5 && p.rand() < 0.5;
    const r = p.rand();
    p.px(x, y, glut ? spitze : strom ? hell : r < 0.15 ? dunkel : mittel);
  }
}

// Frames im Atlas zyklisch neu malen — alle animierten Quads wechseln synchron
const ANIM_TILES = {
  seagrass: paintSeagrassFrame,
  kelp: paintKelpFrame,
  kelp_top: paintKelpTopFrame,
  water_flow: paintWaterFlowFrame,
  lava: paintLavaFrame,
  lava_flow: paintLavaFlowFrame,
};
let animTimer = 0;
let animFrame = 0;
export function updateAnimatedTiles(dt) {
  if (!atlasResult) return;
  animTimer += dt;
  if (animTimer < 0.25) return;
  animTimer = 0;
  animFrame = (animFrame + 1) % 4;
  const g = atlasCanvas.getContext('2d');
  for (const [name, painter] of Object.entries(ANIM_TILES)) {
    const i = TILE_NAMES.indexOf(name);
    if (i < 0) continue;
    painter(makePaintCtx(g, (i % COLS) * TILE, Math.floor(i / COLS) * TILE, name), animFrame);
  }
  atlasResult.texture.needsUpdate = true;
}

// Metallblock: geprägter Rahmen + glänzende Mitte (MC-Stil)
function paintMetalBlock(p, M, L, D) {
  p.rect(0, 0, 16, 16, M);
  p.rect(0, 0, 16, 1, L); p.rect(0, 0, 1, 16, L);
  p.rect(0, 15, 16, 1, D); p.rect(15, 0, 1, 16, D);
  p.rect(2, 2, 12, 12, D); p.rect(2, 2, 11, 11, L);
  p.rect(3, 3, 10, 10, M);
  for (let i = 0; i < 4; i++) p.px(4 + i, 5 - i > 3 ? 5 - i : 3, L); // Glanzstreifen
  p.px(12, 12, D); p.px(11, 12, D);
}

// Kristallblock: getöntes Glas mit Facetten und Funkel-Punkten
function paintCrystal(p, M, L, D) {
  p.clear(0, 0, 16, 16);
  for (let i = 0; i < 16; i++) { p.px(i, 0, D); p.px(i, 15, D); p.px(0, i, D); p.px(15, i, D); }
  // Facetten-Diagonalen
  for (let i = 0; i < 10; i++) { p.px(3 + i, 12 - i, M); p.px(4 + i, 12 - i, L); }
  for (let i = 0; i < 6; i++) { p.px(9 + i > 14 ? 14 : 9 + i, 14 - i, M); }
  for (let i = 0; i < 5; i++) { p.px(2 + i, 5 - i > 1 ? 5 - i : 1, M); }
  // Funkel-Sterne
  for (const [x, y] of [[4, 4], [11, 6], [7, 10], [12, 12]]) {
    p.px(x, y, '#ffffff'); p.px(x - 1, y, L); p.px(x + 1, y, L); p.px(x, y - 1, L); p.px(x, y + 1, L);
  }
}

// Gefärbtes Glas: wie Glas, aber mit farbiger Tönung (halbtransparente Füllung)
function paintColorGlass(p, M, L) {
  p.clear(0, 0, 16, 16);
  for (let i = 0; i < 16; i++) { p.px(i, 0, M); p.px(i, 15, M); p.px(0, i, M); p.px(15, i, M); }
  // leichte Streu-Tönung im Innenraum + Glanzstreifen
  for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) {
    if ((x * 7 + y * 3) % 11 === 0) p.px(x, y, M);
  }
  for (let i = 0; i < 5; i++) { p.px(3 + i, 7 - i, L); p.px(6 + i, 12 - i, L); }
}

// Kristall-Scherbe (Item): gezackter Splitter
function paintShard(p, M, L, D) {
  p.clear(0, 0, 16, 16);
  p.rect(6, 3, 4, 9, M);
  p.px(7, 2, L); p.px(8, 2, L); p.rect(7, 12, 2, 2, D); p.px(7, 14, D);
  p.px(5, 5, M); p.px(5, 6, D); p.px(10, 7, M); p.px(10, 8, D);
  p.rect(7, 4, 1, 6, L); // Glanzkante
  p.px(8, 5, '#ffffff');
}

// Schriftrolle: Pergament mit farbigem Siegelband
function paintScroll(p, M, D) {
  p.clear(0, 0, 16, 16);
  p.rect(4, 2, 8, 12, '#e8dcc0'); // Pergament
  p.rect(4, 2, 8, 1, '#f4ecd8'); p.rect(4, 13, 8, 1, '#c9bc9c');
  p.rect(3, 2, 1, 12, '#c9bc9c'); p.rect(12, 2, 1, 12, '#c9bc9c'); // Rollkanten
  p.rect(4, 7, 8, 2, M); p.px(11, 8, D); // Siegelband
  p.px(7, 4, '#a89c7c'); p.px(9, 5, '#a89c7c'); p.px(6, 11, '#a89c7c'); p.px(8, 11, '#a89c7c'); // Schriftzeichen
}

// Steinziegel-Grundmuster: versetzte Ziegelreihen mit Fugen
function paintBricks(p, palette, fuge) {
  p.speckle(palette, [0.5, 0.3, 0.2]);
  for (let row = 0; row < 4; row++) {
    p.rect(0, row * 4 + 3, 16, 1, fuge);
    const off = row % 2 === 0 ? 7 : 3;
    p.rect(off, row * 4, 1, 3, fuge);
    p.rect((off + 8) % 16, row * 4, 1, 3, fuge);
  }
}

// Teppich: gewebtes Fischgrät-Muster in 3 Tönen [Basis, dunkel, hell]
function paintCarpet(p, [M, D, L]) {
  p.rect(0, 0, 16, 16, M);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const k = (x + y * 2) % 4;
      if (k === 0) p.px(x, y, D);
      else if (k === 2 && (x + y) % 2 === 0) p.px(x, y, L);
    }
  }
}

function paintOre(p, main, dark) {
  paintStoneBase(p);
  for (let i = 0; i < 4; i++) {
    const x = 2 + Math.floor(p.rand() * 11), y = 2 + Math.floor(p.rand() * 11);
    p.rect(x, y, 2, 2, main);
    p.px(x + (p.rand() < 0.5 ? -1 : 2), y + Math.floor(p.rand() * 2), main);
    p.px(x + 1, y + 1, dark);
  }
}

// Axis-aligned tool icons: vertical handle + head. Read well at 16px.
function paintHandle(p, fromY = 5) {
  for (let y = fromY; y <= 14; y++) { p.px(7, y, WOOD_M); p.px(8, y, WOOD_D); }
}
function paintPickaxe(p, M, L, D) {
  p.rect(3, 2, 10, 2, M);
  p.rect(2, 3, 2, 3, M); p.rect(12, 3, 2, 3, M);
  p.px(2, 6, D); p.px(13, 6, D);
  p.rect(3, 2, 10, 1, L);
  paintHandle(p, 4);
}
function paintAxe(p, M, L, D) {
  p.rect(4, 1, 7, 6, M);
  p.rect(4, 1, 7, 2, L);
  p.rect(4, 6, 7, 1, D);
  p.clear(9, 3, 2, 3); // notch so the blade reads as an axe
  paintHandle(p, 3);
}
function paintShovel(p, M, L, D) {
  p.rect(5, 1, 6, 5, M);
  p.rect(5, 1, 6, 2, L);
  p.rect(5, 5, 6, 1, D);
  paintHandle(p, 6);
}
function paintSword(p, M, L, D) {
  p.rect(7, 1, 2, 9, M);
  p.rect(7, 1, 1, 9, L);
  p.px(7, 0, L); p.px(8, 0, M);
  p.rect(5, 10, 6, 1, D);
  for (let y = 11; y <= 14; y++) { p.px(7, y, WOOD_M); p.px(8, y, WOOD_D); }
}
const WOODMAT = ['#9c7c4e', '#b8945f', '#7a5f3c'];
const STONEMAT = ['#8a8a8a', '#a0a0a0', '#6e6e6e'];
const IRONMAT = ['#d8d8d8', '#f2f2f2', '#a8a8a8'];
const GOLDMAT = ['#f5d340', '#fce87b', '#c9a42c'];
const DIAMAT = ['#4fd8d0', '#8ef0e8', '#2ba8a0'];

// Barren als schräges Parallelogramm mit Facetten (Oberseite hell, Kante dunkel)
function paintIngot(p, M, L, D) {
  // Oberseite (parallelogramm-schräg)
  p.rect(6, 4, 8, 1, L);
  p.rect(5, 5, 8, 1, L);
  p.px(14, 5, M);
  // Front
  p.rect(3, 6, 10, 5, M);
  p.px(2, 7, M); p.px(2, 8, M); p.px(2, 9, M);
  // rechte Kante (Schatten, schräg)
  p.rect(13, 6, 2, 1, D); p.rect(13, 7, 2, 1, D);
  p.rect(13, 8, 1, 3, D);
  // Unterkante
  p.rect(3, 11, 11, 1, D);
  p.px(2, 10, D);
  // Glanzlichter
  p.rect(4, 7, 3, 1, L);
  p.px(5, 8, L);
}

// Rüstungs-Icons (Helm, Brustplatte, Hose, Stiefel) in Materialfarben
function paintHelmet(p, M, L, D) {
  p.rect(4, 4, 8, 4, M);
  p.rect(4, 3, 8, 1, L);
  p.rect(3, 5, 1, 3, M); p.rect(12, 5, 1, 3, M);
  p.rect(4, 8, 2, 3, M); p.rect(10, 8, 2, 3, M);
  p.rect(4, 10, 2, 1, D); p.rect(10, 10, 2, 1, D);
}
function paintChest(p, M, L, D) {
  p.rect(3, 3, 3, 2, M); p.rect(10, 3, 3, 2, M); // Schultern
  p.rect(4, 5, 8, 8, M);
  p.rect(4, 5, 8, 1, L);
  p.rect(7, 6, 2, 6, D);
  p.rect(4, 12, 8, 1, D);
}
function paintLegs(p, M, L, D) {
  p.rect(4, 3, 8, 3, M);
  p.rect(4, 3, 8, 1, L);
  p.rect(4, 6, 3, 7, M); p.rect(9, 6, 3, 7, M);
  p.rect(4, 12, 3, 1, D); p.rect(9, 12, 3, 1, D);
}
function paintBoots(p, M, L, D) {
  p.rect(4, 5, 3, 5, M); p.rect(10, 5, 3, 5, M);
  p.rect(4, 10, 4, 2, M); p.rect(10, 10, 4, 2, M);
  p.rect(4, 11, 4, 1, D); p.rect(10, 11, 4, 1, D);
  p.rect(4, 5, 3, 1, L); p.rect(10, 5, 3, 1, L);
}

// Metall-Eimer (Trapez, oben weit, unten schmal). fill = [dunkel, hell, glanz]
// für Wasser/Lava; null = leerer Eimer.
function paintBucket(p, fill) {
  p.clear(0, 0, 16, 16);
  const L = '#c9cbd4', M = '#9a9ca6', D = '#6b6d78', H = '#e6e8f0';
  if (fill) { // Flüssigkeit im Eimer (oben), bevor der Rand drübergeht
    p.rect(4, 5, 8, 3, fill[0]);
    p.rect(4, 5, 8, 1, fill[1]);
    p.px(6, 6, fill[2]); p.px(9, 6, fill[2]);
  }
  p.rect(3, 4, 10, 2, M); p.rect(3, 4, 10, 1, H);   // Rand oben
  p.rect(4, 8, 8, 2, L); p.rect(4, 10, 7, 1, M);    // oberer Körper
  p.rect(5, 11, 5, 2, L); p.rect(6, 13, 4, 2, M);   // verjüngter unterer Körper
  p.rect(11, 8, 1, 2, D); p.rect(10, 10, 1, 3, D); p.rect(9, 13, 1, 2, D); // rechte Schattenkante
  p.px(4, 9, H); p.px(5, 12, H);                    // Glanzlichter
}

// Feldfrucht als Cross-Sprite: senkrechte Halme von topY bis zum Boden, farbige
// Spitze. Je kleiner topY, desto höher/reifer die Pflanze.
function paintCrop(p, topY, base, tip) {
  p.clear(0, 0, 16, 16);
  for (const x of [3, 6, 9, 12]) {
    for (let y = topY; y <= 14; y++) p.px(x, y, base);
    p.px(x, topY, tip); p.px(x, topY + 1, tip);
    if (x < 12) p.px(x + 1, topY + 3, base); // kleines Blatt
  }
}

// Harke: Holzstiel + waagerechtes Blatt oben rechts
function paintHoe(p, M, L, D) {
  paintHandle(p, 3);
  p.rect(9, 2, 4, 2, M);
  p.rect(9, 2, 4, 1, L);
  p.rect(9, 4, 4, 1, D);
  p.px(8, 2, M); p.px(8, 3, M);
}

const PAINTERS = {
  bucket(p) { paintBucket(p, null); },
  water_bucket(p) { paintBucket(p, ['#2f6fd6', '#4f8ff0', '#8fbcff']); },
  lava_bucket(p) { paintBucket(p, ['#e2531a', '#ff8a2e', '#ffd24a']); },
  // ---- Farming ----
  farmland(p) {
    p.speckle(['#6a4f30', '#5c4529', '#77593a'], [0.4, 0.35, 0.25]);
    p.rect(0, 2, 16, 1, '#463320'); p.rect(0, 7, 16, 1, '#463320'); p.rect(0, 12, 16, 1, '#463320');
    p.rect(0, 0, 16, 1, '#836543');
  },
  farmland_wet(p) {
    p.speckle(['#493420', '#3f2c1a', '#523a25'], [0.4, 0.35, 0.25]);
    p.rect(0, 2, 16, 1, '#2b1d10'); p.rect(0, 7, 16, 1, '#2b1d10'); p.rect(0, 12, 16, 1, '#2b1d10');
    p.px(4, 5, '#4a3f5e'); p.px(11, 9, '#4a3f5e'); p.px(7, 13, '#4a3f5e');
  },
  wheat_0(p) { paintCrop(p, 12, '#8a9a4a', '#8a9a4a'); },
  wheat_1(p) { paintCrop(p, 9, '#8a9a4a', '#9aaa5a'); },
  wheat_2(p) { paintCrop(p, 6, '#9aaa4a', '#c8b84a'); },
  wheat_3(p) { paintCrop(p, 3, '#a8983a', '#e6c84a'); },
  carrot_0(p) { paintCrop(p, 12, '#3f9a3a', '#3f9a3a'); },
  carrot_1(p) { paintCrop(p, 10, '#3f9a3a', '#4faa4a'); },
  carrot_2(p) { paintCrop(p, 7, '#3f9a3a', '#5aba5a'); },
  carrot_3(p) { paintCrop(p, 4, '#3f9a3a', '#e08a2a'); },
  potato_0(p) { paintCrop(p, 12, '#4aa84a', '#4aa84a'); },
  potato_1(p) { paintCrop(p, 10, '#4aa84a', '#5ab85a'); },
  potato_2(p) { paintCrop(p, 7, '#4aa84a', '#6ac86a'); },
  potato_3(p) { paintCrop(p, 5, '#3f9a3a', '#d8d86a'); },
  wooden_hoe(p) { paintHoe(p, WOODMAT[0], WOODMAT[1], WOODMAT[2]); },
  stone_hoe(p) { paintHoe(p, STONEMAT[0], STONEMAT[1], STONEMAT[2]); },
  iron_hoe(p) { paintHoe(p, IRONMAT[0], IRONMAT[1], IRONMAT[2]); },
  wheat_seeds(p) {
    p.clear(0, 0, 16, 16);
    for (const [x, y] of [[5, 6], [8, 5], [10, 8], [6, 9], [9, 10], [7, 7]]) {
      p.px(x, y, '#8a9a4a'); p.px(x + 1, y, '#6a7a34'); p.px(x, y + 1, '#7a8a3e');
    }
  },
  wheat(p) {
    p.clear(0, 0, 16, 16);
    for (const x of [5, 8, 11]) {
      for (let y = 3; y <= 13; y++) p.px(x, y, '#c8a838');
      for (let y = 3; y <= 8; y++) { p.px(x - 1, y, '#e6c84a'); p.px(x + 1, y, '#e6c84a'); }
    }
  },
  carrot(p) {
    p.clear(0, 0, 16, 16);
    p.rect(6, 6, 4, 5, '#e08a2a'); p.rect(7, 11, 2, 2, '#e08a2a'); p.px(8, 13, '#d07a1a');
    p.rect(6, 6, 4, 1, '#f0a24a'); p.px(6, 7, '#f0a24a');
    p.rect(6, 3, 1, 3, '#3f9a3a'); p.rect(8, 2, 1, 4, '#3f9a3a'); p.rect(10, 3, 1, 3, '#4faa4a'); // grünes Kraut
  },
  potato(p) {
    p.clear(0, 0, 16, 16);
    p.rect(4, 6, 8, 6, '#b98a52'); p.rect(4, 6, 8, 1, '#cc9d64'); p.rect(4, 11, 8, 1, '#98703f');
    p.px(5, 6, '#cc9d64'); p.px(10, 7, '#8a6236'); p.px(6, 9, '#8a6236'); p.px(9, 10, '#cc9d64'); // Augen/Flecken
  },
  bread(p) {
    p.clear(0, 0, 16, 16);
    p.rect(3, 5, 10, 7, '#b9793a'); p.rect(3, 5, 10, 2, '#cc8f50');
    p.rect(3, 11, 10, 1, '#8a5527');
    p.px(6, 7, '#8a5527'); p.px(9, 8, '#8a5527'); p.px(7, 9, '#8a5527'); // Kruste
  },
  grass_top(p) { p.speckle(GRASS, [0.4, 0.25, 0.2, 0.15]); },
  grass_side(p) {
    paintDirt(p);
    p.rect(0, 0, 16, 3, GRASS[0]);
    for (let x = 0; x < 16; x++) {
      p.px(x, 1 + (p.rand() < 0.5 ? 0 : 1), GRASS[3]);
      if (p.rand() < 0.6) p.px(x, 3, GRASS[1]);
    }
  },
  dirt: paintDirt,
  stone: paintStoneBase,
  cobblestone(p) {
    // voronoi-ish stones with dark mortar
    const seeds = [];
    for (let i = 0; i < 6; i++) seeds.push([p.rand() * 16, p.rand() * 16, STONES[i % 4]]);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      let d1 = 1e9, d2 = 1e9, c = STONES[0];
      for (const [sx, sy, sc] of seeds) {
        // wrap-around distance keeps the tile seamless
        const dx = Math.min(Math.abs(x - sx), 16 - Math.abs(x - sx));
        const dy = Math.min(Math.abs(y - sy), 16 - Math.abs(y - sy));
        const d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; c = sc; } else if (d < d2) { d2 = d; }
      }
      p.px(x, y, Math.sqrt(d2) - Math.sqrt(d1) < 1.1 ? '#5a5a5a' : c);
    }
  },
  log_top(p) {
    p.speckle([WOOD_M, WOOD_L], [0.7, 0.3]);
    p.rect(0, 0, 16, 1, WOOD_D); p.rect(0, 15, 16, 1, WOOD_D);
    p.rect(0, 0, 1, 16, WOOD_D); p.rect(15, 0, 1, 16, WOOD_D);
    p.rect(3, 3, 10, 10, '#a5804d');
    p.rect(5, 5, 6, 6, '#c9a466');
    p.rect(7, 7, 2, 2, '#a5804d');
  },
  log_side(p) {
    for (let x = 0; x < 16; x++) {
      const shade = x % 4 === 0 ? WOOD_D : x % 4 === 2 ? WOOD_L : WOOD_M;
      for (let y = 0; y < 16; y++) p.px(x, y, p.rand() < 0.12 ? WOOD_D : shade);
    }
  },
  planks: paintPlanks,
  birch_planks(p) { paintPlanksColored(p, '#d6c69c', '#e7dab8', '#bcab82'); }, // hell, blass
  spruce_planks(p) { paintPlanksColored(p, '#775734', '#8a6a44', '#5b4328'); }, // dunkelbraun
  jungle_planks(p) { paintPlanksColored(p, '#a97246', '#bd8557', '#8a5c37'); }, // rötlich-warm
  leaves(p) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = p.rand();
      if (r < 0.22) continue; // transparent hole
      p.px(x, y, r < 0.45 ? '#2f6b1d' : r < 0.75 ? '#3d7a25' : '#4f9c31');
    }
  },
  sand(p) { p.speckle(SANDS, [0.4, 0.25, 0.2, 0.15]); },
  water(p) { paintStillWater(p); },
  water_flow(p) { paintWaterFlowFrame(p, 0); },
  bedrock(p) {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const c = ['#565656', '#3a3a3a', '#444444', '#2e2e2e'][Math.floor(p.rand() * 4)];
      p.rect(x * 2, y * 2, 2, 2, c);
    }
  },
  coal_ore(p) { paintOre(p, '#2b2b2b', '#161616'); },
  iron_ore(p) { paintOre(p, '#d8af93', '#b78868'); },
  crafting_table_top(p) {
    paintPlanks(p);
    p.rect(0, 0, 16, 1, WOOD_D); p.rect(0, 15, 16, 1, WOOD_D);
    p.rect(0, 0, 1, 16, WOOD_D); p.rect(15, 0, 1, 16, WOOD_D);
    p.rect(7, 1, 2, 14, WOOD_D); p.rect(1, 7, 14, 2, WOOD_D);
  },
  crafting_table_side(p) {
    paintPlanks(p);
    p.rect(0, 0, 16, 2, PLANK_L);
    p.rect(2, 5, 4, 5, WOOD_D); p.rect(10, 5, 4, 5, WOOD_D);
    p.rect(3, 6, 2, 3, '#8a6a40'); p.rect(11, 6, 2, 3, '#8a6a40');
  },
  stick(p) {
    for (let i = 0; i < 10; i++) {
      p.px(3 + i, 13 - i, WOOD_M);
      p.px(4 + i, 13 - i, WOOD_D);
    }
  },
  wooden_pickaxe(p) { paintPickaxe(p, WOODMAT[0], WOODMAT[1], WOODMAT[2]); },
  wooden_axe(p) { paintAxe(p, WOODMAT[0], WOODMAT[1], WOODMAT[2]); },
  wooden_shovel(p) { paintShovel(p, WOODMAT[0], WOODMAT[1], WOODMAT[2]); },
  wooden_sword(p) { paintSword(p, WOODMAT[0], WOODMAT[1], WOODMAT[2]); },
  stone_pickaxe(p) { paintPickaxe(p, STONEMAT[0], STONEMAT[1], STONEMAT[2]); },
  stone_axe(p) { paintAxe(p, STONEMAT[0], STONEMAT[1], STONEMAT[2]); },
  stone_shovel(p) { paintShovel(p, STONEMAT[0], STONEMAT[1], STONEMAT[2]); },
  stone_sword(p) { paintSword(p, STONEMAT[0], STONEMAT[1], STONEMAT[2]); },
  porkchop(p) {
    p.blob(9, 6, 5.5, 4.5, '#e78e8e', '#f4b8b8', '#c96b6b');
    p.rect(4, 10, 2, 4, '#efe9dc');
    p.px(3, 13, '#efe9dc'); p.px(6, 13, '#efe9dc');
  },
  rotten_flesh(p) {
    p.blob(8, 8, 5.5, 5, '#8a6a3a', '#a07c44', '#6b512c');
    p.rect(6, 6, 2, 2, '#6b8c3a'); p.rect(10, 9, 2, 2, '#6b8c3a');
    p.clear(8, 11, 2, 2);
  },
  apple(p) {
    p.blob(8, 9, 4.5, 4.5, '#d83b3b', '#f06666', '#a82828');
    p.rect(8, 2, 1, 3, WOOD_D);
    p.rect(9, 3, 2, 1, '#4f9c31');
  },
  coal(p) { p.blob(8, 8, 5, 4.5, '#2b2b2b', '#454545', '#161616'); },
  raw_iron(p) { p.blob(8, 8, 5, 4.5, '#d8af93', '#eecbb4', '#b78868'); },
  // ---- Verzauberungs-Kette (Leder, Papier, Buch, Spell Core; Obsidian, Regal, Tisch) ----
  leather(p) { p.blob(8, 8, 5, 4, '#8a5a34', '#a8764a', '#6b4526'); p.px(6, 6, '#6b4526'); p.px(10, 10, '#6b4526'); },
  paper(p) {
    p.rect(3, 2, 10, 12, '#efeadd');
    p.rect(3, 2, 10, 1, '#d8d2c2'); p.rect(3, 13, 10, 1, '#d8d2c2');
    for (let y = 4; y <= 11; y += 2) p.rect(5, y, 6, 1, '#c9c2ad');
  },
  book(p) {
    p.rect(3, 2, 10, 12, '#8a3b2e');   // Einband
    p.rect(4, 3, 8, 10, '#a54a38');
    p.rect(11, 3, 1, 10, '#efeadd');   // Seiten
    p.rect(3, 6, 10, 1, '#e0c65a');    // goldenes Band
  },
  spell_core(p) {
    p.clear(0, 0, 16, 16);
    p.blob(8, 8, 5, 5, '#5a3ba8', '#8a6ad8', '#3a2570');
    p.px(8, 8, '#e6dcff'); p.px(7, 7, '#c8b8ff'); p.px(9, 9, '#c8b8ff');
    for (const [x, y] of [[3, 4], [13, 5], [4, 12], [12, 11], [8, 2]]) p.px(x, y, '#b6a0ff');
  },
  obsidian(p) {
    p.speckle(['#241a33', '#1c1428', '#2e2242', '#15101f'], [0.35, 0.3, 0.2, 0.15]);
    for (let i = 0; i < 5; i++) { const x = Math.floor(p.rand() * 15), y = Math.floor(p.rand() * 15); p.px(x, y, '#4a3a6a'); }
  },
  bookshelf(p) {
    paintPlanks(p);
    p.rect(0, 4, 16, 3, '#3a2a1c'); p.rect(0, 10, 16, 3, '#3a2a1c'); // zwei Regalböden
    const cols = ['#a54a38', '#3f7a3a', '#3a5aa0', '#c0a02f', '#7a3a9a', '#a86a2a', '#4a8a8a'];
    for (const row of [4, 10]) for (let i = 0; i < 7; i++) p.rect(1 + i * 2, row, 1, 3, cols[(i + row) % cols.length]);
  },
  ench_table_top(p) {
    p.speckle(['#241a33', '#1c1428', '#2e2242'], [0.4, 0.35, 0.25]);
    p.rect(4, 4, 8, 8, '#3a2a5a'); p.rect(5, 5, 6, 6, '#6a4aa8');
    p.px(7, 7, '#d6c8ff'); p.px(8, 8, '#d6c8ff'); p.px(8, 7, '#b6a0ff'); p.px(7, 8, '#b6a0ff');
  },
  ench_table_side(p) {
    p.speckle(['#241a33', '#1c1428', '#2e2242', '#15101f'], [0.35, 0.3, 0.2, 0.15]);
    for (const [x, y] of [[3, 3], [11, 5], [5, 9], [12, 11], [8, 7]]) p.px(x, y, '#8a6ad8');
  },
  snow(p) { p.speckle(['#f6f9fc', '#eaf0f6', '#dfe8f0'], [0.55, 0.3, 0.15]); },
  grass_side_snowy(p) {
    paintDirt(p);
    p.rect(0, 0, 16, 3, '#f6f9fc');
    for (let x = 0; x < 16; x++) {
      p.px(x, 2 + (p.rand() < 0.5 ? 0 : 1), '#eaf0f6');
      if (p.rand() < 0.4) p.px(x, 3, '#dfe8f0');
    }
  },
  birch_log_side(p) {
    p.speckle(['#e8e2d4', '#dcd5c4', '#efe9dd'], [0.5, 0.3, 0.2]);
    for (let i = 0; i < 7; i++) {
      const x = Math.floor(p.rand() * 14), y = Math.floor(p.rand() * 15);
      p.rect(x, y, 2 + Math.floor(p.rand() * 2), 1, '#3d3a33');
    }
  },
  birch_leaves(p) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = p.rand();
      if (r < 0.22) continue;
      p.px(x, y, r < 0.5 ? '#5aa03c' : r < 0.8 ? '#6cb44c' : '#7fc45e');
    }
  },
  spruce_log_side(p) {
    for (let x = 0; x < 16; x++) {
      const shade = x % 4 === 0 ? '#3a2a18' : x % 4 === 2 ? '#573f27' : '#4a3521';
      for (let y = 0; y < 16; y++) p.px(x, y, p.rand() < 0.12 ? '#3a2a18' : shade);
    }
  },
  spruce_leaves(p) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = p.rand();
      if (r < 0.16) continue;
      p.px(x, y, r < 0.5 ? '#24402a' : r < 0.8 ? '#2d4c33' : '#3a5f41');
    }
  },
  jungle_log_side(p) {
    // warmes Mittelbraun mit vertikaler Maserung + dunkle Rindenknoten
    for (let x = 0; x < 16; x++) {
      const shade = x % 4 === 0 ? '#4a3a22' : x % 4 === 2 ? '#7e6440' : '#6b5334';
      for (let y = 0; y < 16; y++) p.px(x, y, p.rand() < 0.14 ? '#4a3a22' : shade);
    }
    for (let i = 0; i < 5; i++) {
      const x = Math.floor(p.rand() * 15), y = Math.floor(p.rand() * 14);
      p.rect(x, y, 1, 2 + Math.floor(p.rand() * 2), '#3c2e1a');
    }
  },
  jungle_bush(p) {
    // dichter, sattgrüner Blätterbüschel (als Kreuz-Pflanze gerendert)
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = p.rand();
      // unten voller, oben lockerer → Buschform
      if (r < 0.30 + y * 0.02) continue; // transparente Lücken
      p.px(x, y, r < 0.5 ? '#2c6a1c' : r < 0.78 ? '#398a26' : '#4fa835');
    }
  },
  // Beerenbüsche: grüner Busch (unten voller) mit farbigen Beeren-Tupfen
  berry_bush_red(p) { paintBerryBush(p, '#b52d2d', '#e46a6a'); },
  berry_bush_blue(p) { paintBerryBush(p, '#2f47b0', '#6a82e6'); },
  berry_bush_yellow(p) { paintBerryBush(p, '#caa018', '#f4d45a'); },
  // Beeren als Item-Symbol: kleine Traube aus 3 Beeren
  berry_red(p) { paintBerries(p, '#b52d2d', '#e46a6a', '#821f1f'); },
  berry_blue(p) { paintBerries(p, '#2f47b0', '#6a82e6', '#1f2f80'); },
  berry_yellow(p) { paintBerries(p, '#caa018', '#f4d45a', '#8f7010'); },
  red_sand(p) { p.speckle(['#c1682f', '#b55f2a', '#cc7136', '#a95826'], [0.4, 0.25, 0.2, 0.15]); },
  terracotta(p) { p.speckle(['#b5713f', '#ab6939', '#bd7944'], [0.5, 0.3, 0.2]); },
  terracotta_red(p) { p.speckle(['#8f4a2e', '#85422a', '#99522f'], [0.5, 0.3, 0.2]); },
  mycelium_top(p) { p.speckle(['#7a6a80', '#6d5e73', '#857490', '#5f5264'], [0.35, 0.3, 0.2, 0.15]); },
  mycelium_side(p) {
    paintDirt(p);
    p.rect(0, 0, 16, 3, '#7a6a80');
    for (let x = 0; x < 16; x++) {
      p.px(x, 2 + (p.rand() < 0.5 ? 0 : 1), '#5f5264');
      if (p.rand() < 0.5) p.px(x, 3, '#6d5e73');
    }
  },
  mushroom_stem(p) {
    for (let x = 0; x < 16; x++) {
      const shade = x % 3 === 0 ? '#c9c2b4' : '#d8d1c3';
      for (let y = 0; y < 16; y++) p.px(x, y, p.rand() < 0.1 ? '#b8b1a2' : shade);
    }
  },
  mushroom_cap_red(p) {
    p.speckle(['#b0332e', '#a52c28', '#bd3c36'], [0.5, 0.3, 0.2]);
    for (let i = 0; i < 4; i++) {
      const x = 1 + Math.floor(p.rand() * 12), y = 1 + Math.floor(p.rand() * 12);
      p.rect(x, y, 2, 2, '#efe9dc');
    }
  },
  mushroom_cap_brown(p) { p.speckle(['#8a6a4a', '#7f6042', '#957552'], [0.5, 0.3, 0.2]); },
  // laubbedecktes Gras (Spruce Valley): Gras + braune/orange Blattstreu
  leafy_grass_top(p) {
    p.speckle(GRASS, [0.4, 0.25, 0.2, 0.15]);
    for (let i = 0; i < 24; i++) {
      const x = Math.floor(p.rand() * 16), y = Math.floor(p.rand() * 16);
      const c = ['#8a6a3a', '#a0703a', '#6f5a2e', '#b5854a'][i % 4];
      p.px(x, y, c);
      if (p.rand() < 0.45) p.px((x + 1) & 15, y, c);
    }
  },
  leafy_grass_side(p) {
    paintDirt(p);
    p.rect(0, 0, 16, 3, GRASS[0]);
    for (let x = 0; x < 16; x++) {
      p.px(x, 1 + (p.rand() < 0.5 ? 0 : 1), GRASS[3]);
      if (p.rand() < 0.5) p.px(x, 2, ['#8a6a3a', '#a0703a'][x % 2]); // Laubkante
    }
  },
  // dunkleres, kühleres Gras (Old Birch Forest)
  dark_grass_top(p) { p.speckle(['#3c5a2c', '#34501f', '#436633', '#2b4520'], [0.4, 0.25, 0.2, 0.15]); },
  dark_grass_side(p) {
    paintDirt(p);
    p.rect(0, 0, 16, 3, '#3c5a2c');
    for (let x = 0; x < 16; x++) {
      p.px(x, 1 + (p.rand() < 0.5 ? 0 : 1), '#2b4520');
      if (p.rand() < 0.6) p.px(x, 3, '#34501f');
    }
  },
  // kleine Bodenpilze (Stiel + Kappe)
  mushroom_red(p) {
    for (let y = 9; y <= 14; y++) { p.px(7, y, '#ede5d4'); p.px(8, y, '#dcd3bf'); }
    p.rect(4, 5, 8, 4, '#b0332e');
    p.rect(5, 4, 6, 1, '#bd3c36');
    p.clear(4, 8); p.clear(11, 8);
    for (const [x, y] of [[6, 5], [9, 6], [7, 7], [10, 5]]) p.px(x, y, '#f0ece0');
  },
  mushroom_brown(p) {
    for (let y = 9; y <= 14; y++) { p.px(7, y, '#ede5d4'); p.px(8, y, '#dcd3bf'); }
    p.rect(4, 6, 8, 3, '#8a6743');
    p.rect(5, 5, 6, 1, '#9a7550');
    p.clear(4, 8); p.clear(11, 8);
  },
  savanna_grass_top(p) { p.speckle(['#a9a24a', '#9d9743', '#b5ae52', '#918b3e'], [0.4, 0.25, 0.2, 0.15]); },
  savanna_grass_side(p) {
    paintDirt(p);
    p.rect(0, 0, 16, 3, '#a9a24a');
    for (let x = 0; x < 16; x++) {
      p.px(x, 1 + (p.rand() < 0.5 ? 0 : 1), '#918b3e');
      if (p.rand() < 0.6) p.px(x, 3, '#9d9743');
    }
  },
  flower_red(p) {
    for (let y = 6; y <= 14; y++) p.px(7, y, '#3d7a25');
    p.px(6, 10, '#3d7a25'); p.px(8, 9, '#4f9c31');
    p.rect(5, 2, 4, 4, '#d83b3b');
    p.px(5, 2, '#00000000'); p.clear(5, 2); p.clear(8, 2); p.clear(5, 5); p.clear(8, 5);
    p.rect(6, 3, 2, 2, '#f06666');
  },
  flower_yellow(p) {
    for (let y = 6; y <= 14; y++) p.px(7, y, '#3d7a25');
    p.px(8, 10, '#3d7a25');
    p.rect(5, 2, 4, 4, '#f0d030');
    p.clear(5, 2); p.clear(8, 2); p.clear(5, 5); p.clear(8, 5);
    p.rect(6, 3, 2, 2, '#f7e883');
  },
  tall_grass(p) {
    for (let i = 0; i < 7; i++) {
      const x = 2 + Math.floor(p.rand() * 12);
      const h = 5 + Math.floor(p.rand() * 8);
      const c = ['#4f9c31', '#3d7a25', '#5fae3e'][i % 3];
      for (let y = 0; y < h; y++) {
        p.px(x + (y > h - 3 && p.rand() < 0.5 ? 1 : 0), 15 - y, c);
      }
    }
  },
  lava(p) { paintLavaFrame(p, 0); },
  lava_flow(p) { paintLavaFlowFrame(p, 0); },
  dripstone(p) { p.speckle(['#8a7362', '#7d6656', '#96806e', '#6f5a4c'], [0.35, 0.3, 0.2, 0.15]); },
  moss(p) { p.speckle(['#4a6b2a', '#547a31', '#3f5c24', '#5d8737'], [0.35, 0.3, 0.2, 0.15]); },
  cave_vine(p) {
    for (let i = 0; i < 4; i++) {
      const x = 2 + Math.floor(p.rand() * 12);
      const len = 9 + Math.floor(p.rand() * 7);
      for (let y = 0; y < len; y++) {
        p.px(x + (y % 5 === 4 ? 1 : 0), y, y % 4 === 3 ? '#5d8737' : '#3f5c24');
        if (p.rand() < 0.12) p.px(x + 1, y, '#ffb830'); // Glühbeeren
      }
    }
  },
  hanging_roots(p) {
    // dünne, herabhängende tan-/braune Wurzelstränge von oben
    p.clear(0, 0, 16, 16);
    for (let i = 0; i < 5; i++) {
      const len = 6 + Math.floor(p.rand() * 9);
      let x = 1 + Math.floor(p.rand() * 14);
      for (let y = 0; y < len; y++) {
        p.px(x, y, y % 3 === 0 ? '#8a6f47' : y % 3 === 1 ? '#a8895c' : '#c0a878');
        if (p.rand() < 0.22) x += p.rand() < 0.5 ? 1 : -1; // leichtes Ausfransen
        if (x < 0) x = 0; if (x > 15) x = 15;
      }
    }
  },
  rooted_dirt(p) {
    paintDirt(p);
    for (let i = 0; i < 7; i++) { // helle Wurzelfäden
      let x = Math.floor(p.rand() * 16), y = Math.floor(p.rand() * 16);
      const len = 3 + Math.floor(p.rand() * 5);
      for (let k = 0; k < len; k++) {
        p.px(x, y, p.rand() < 0.5 ? '#c9b48a' : '#b09a6e');
        x += p.rand() < 0.5 ? 1 : 0; y += p.rand() < 0.6 ? 1 : -1;
        if (x < 0 || x > 15 || y < 0 || y > 15) break;
      }
    }
  },
  glow_lichen(p) {
    // fleckige, leuchtende Flechte (cyan-grün), helle Kerne
    p.clear(0, 0, 16, 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = p.rand();
      if (r < 0.42) continue; // durchlässige Lücken
      p.px(x, y, r < 0.62 ? '#3f8f6a' : r < 0.82 ? '#5fd39a' : '#b6ffe0');
    }
  },
  torch(p) {
    p.rect(7, 6, 2, 9, WOOD_M);   // Stiel
    p.rect(7, 6, 1, 9, WOOD_D);
    p.rect(6, 3, 4, 3, '#ffb830'); // Flamme
    p.rect(7, 2, 2, 2, '#ffe75c');
    p.px(7, 1, '#fff6c9'); p.px(8, 1, '#ffe75c');
    p.px(6, 5, '#e8721c'); p.px(9, 5, '#e8721c');
  },
  gravel(p) { p.speckle(['#8a8078', '#79706a', '#9b928a', '#6b625c'], [0.35, 0.3, 0.2, 0.15]); },
  sugar_cane(p) {
    for (const x of [4, 8, 12]) {
      for (let y = 1; y < 16; y++) {
        p.px(x, y, y % 4 === 0 ? '#7fb069' : '#a8d982');
        if (p.rand() < 0.3) p.px(x + (p.rand() < 0.5 ? -1 : 1), y, '#93c47250');
      }
      p.px(x - 1, 2, '#c3e6a0'); p.px(x + 1, 4, '#c3e6a0');
    }
  },
  anvil(p) {
    p.speckle(['#4a4a4a', '#3d3d3d'], [0.7, 0.3]);
    p.rect(2, 3, 12, 3, '#5a5a5a');   // Kopf
    p.rect(2, 3, 12, 1, '#6e6e6e');
    p.rect(6, 6, 4, 5, '#454545');    // Taille
    p.rect(4, 11, 8, 3, '#525252');   // Fuß
    p.rect(4, 13, 8, 1, '#333333');
  },
  gold_ore(p) { paintOre(p, '#f5d340', '#c9a42c'); },
  diamond_ore(p) { paintOre(p, '#4fd8d0', '#2ba8a0'); },
  emerald_ore(p) { paintOre(p, '#2ecc5e', '#1f9c48'); },
  sapphire_ore(p) { paintOre(p, '#3a6ff5', '#2246c0'); },
  flint(p) { p.blob(8, 8, 4.5, 4, '#3a3f45', '#555c64', '#22262b'); },
  sugar(p) {
    for (let i = 0; i < 40; i++) {
      p.px(3 + Math.floor(p.rand() * 10), 4 + Math.floor(p.rand() * 9), p.rand() < 0.6 ? '#f5f5f5' : '#e3e3e8');
    }
    p.rect(5, 11, 6, 2, '#efefef');
  },
  raw_gold(p) { p.blob(8, 8, 5, 4.5, '#f5d340', '#fce87b', '#c9a42c'); },
  diamond(p) {
    p.rect(5, 5, 6, 4, '#4fd8d0');
    p.rect(6, 4, 4, 1, '#8ef0e8');
    p.rect(6, 9, 4, 2, '#3ec0b8');
    p.rect(7, 11, 2, 2, '#2ba8a0');
    p.px(6, 5, '#c8fff9');
  },
  emerald(p) {
    p.rect(5, 5, 6, 4, '#2ecc5e');
    p.rect(6, 4, 4, 1, '#7bf0a0');
    p.rect(6, 9, 4, 2, '#22a84c');
    p.rect(7, 11, 2, 2, '#178038');
    p.px(6, 5, '#c8ffd8');
  },
  sapphire(p) {
    p.rect(5, 5, 6, 4, '#3a6ff5');
    p.rect(6, 4, 4, 1, '#8ea8ff');
    p.rect(6, 9, 4, 2, '#2a52c8');
    p.rect(7, 11, 2, 2, '#1f3fb0');
    p.px(6, 5, '#d0dcff');
  },
  backpack(p) {
    p.clear(0, 0, 16, 16);
    p.rect(5, 2, 1, 3, '#4a3220'); p.rect(10, 2, 1, 3, '#4a3220'); // Träger
    p.rect(2, 7, 2, 6, '#5e3e24'); p.rect(12, 7, 2, 6, '#5e3e24'); // Seitentaschen
    p.rect(3, 4, 10, 10, '#6e4a2c'); // Korpus
    p.rect(3, 13, 10, 1, '#553921');
    p.rect(3, 4, 10, 4, '#7d5636'); // Deckelklappe
    p.rect(3, 4, 10, 1, '#8a6038');
    p.rect(6, 6, 4, 2, '#caa25a'); p.px(7, 6, '#8a6a2e'); p.px(8, 7, '#8a6a2e'); // Schnalle
  },
  bow(p) {
    p.clear(0, 0, 16, 16);
    const W = '#7a552f', WD = '#543a20', S = '#eae7dc';
    // Bogenholz als nach rechts gewölbter Bogen
    const arc = [[5, 2], [6, 2], [8, 3], [9, 4], [10, 5], [11, 6], [11, 7],
      [12, 8], [11, 9], [11, 10], [10, 11], [9, 12], [8, 13], [6, 14], [5, 14]];
    for (const [x, y] of arc) { p.px(x, y, W); p.px(x + 1, y, WD); }
    // Sehne: gerade Verbindung der beiden Bogenspitzen
    for (let y = 3; y <= 13; y++) p.px(5, y, S);
    p.px(5, 2, WD); p.px(5, 14, WD); // Spitzen/Nocken
    p.px(12, 8, '#3a2716');          // Griff-Markierung
  },
  arrow(p) {
    p.clear(0, 0, 16, 16);
    const shaft = '#8a6a40', shaftD = '#65482a', tip = '#454a51', tipL = '#606770', feat = '#eae7dc';
    // Schaft diagonal (unten-links → oben-rechts)
    for (let i = 0; i < 9; i++) { p.px(3 + i, 12 - i, shaft); p.px(3 + i, 13 - i, shaftD); }
    // Feuerstein-Spitze (oben rechts)
    p.px(12, 3, tip); p.px(13, 2, tipL); p.px(13, 3, tip); p.px(12, 4, tip); p.px(11, 4, tip); p.px(12, 2, tip);
    // Federn (unten links)
    p.px(2, 11, feat); p.px(2, 13, feat); p.px(1, 12, feat); p.px(3, 10, feat); p.px(4, 13, feat); p.px(2, 12, '#c8c8c2');
  },
  furnace_front(p) {
    paintStoneBase(p);
    p.rect(1, 1, 14, 1, '#6e6e6e'); p.rect(1, 14, 14, 1, '#5a5a5a');
    p.rect(4, 8, 8, 6, '#1d1d1d'); // Feueröffnung
    p.rect(5, 10, 6, 3, '#e8721c');
    p.rect(6, 11, 4, 2, '#ffb830');
    p.px(7, 10, '#ffe75c'); p.px(9, 11, '#ffe75c');
  },
  furnace_side(p) {
    paintStoneBase(p);
    p.rect(1, 1, 14, 1, '#6e6e6e'); p.rect(1, 14, 14, 1, '#5a5a5a');
  },
  furnace_front_on(p) {
    paintStoneBase(p);
    p.rect(1, 1, 14, 1, '#6e6e6e'); p.rect(1, 14, 14, 1, '#5a5a5a');
    p.rect(4, 8, 8, 6, '#2b1005'); // glühende Feueröffnung
    p.rect(4, 9, 8, 4, '#c94a10');
    p.rect(5, 9, 6, 4, '#e8721c');
    p.rect(5, 10, 6, 3, '#ffb830');
    p.rect(6, 11, 4, 2, '#ffe75c');
    p.px(6, 9, '#ffe75c'); p.px(9, 10, '#fff6c9'); p.px(7, 12, '#fff6c9');
  },
  iron_ingot(p) { paintIngot(p, IRONMAT[0], IRONMAT[1], IRONMAT[2]); },
  gold_ingot(p) { paintIngot(p, GOLDMAT[0], GOLDMAT[1], GOLDMAT[2]); },
  bone(p) {
    // diagonaler Knochen mit Enden
    for (let i = 0; i < 8; i++) {
      p.px(4 + i, 11 - i, '#ece8dc');
      p.px(5 + i, 11 - i, '#d8d4c8');
    }
    p.rect(2, 11, 3, 3, '#ece8dc'); p.px(2, 10, '#ece8dc'); p.px(4, 13, '#d8d4c8');
    p.rect(11, 2, 3, 3, '#ece8dc'); p.px(13, 4, '#d8d4c8'); p.px(11, 2, '#fdfaf0');
  },
  gunpowder(p) {
    for (let i = 0; i < 34; i++) {
      const x = 3 + Math.floor(p.rand() * 10), y = 6 + Math.floor(p.rand() * 7);
      p.px(x, y, p.rand() < 0.6 ? '#4a4a4a' : '#2e2e2e');
    }
    p.rect(5, 11, 6, 2, '#3a3a3a');
    p.px(7, 5, '#5a5a5a'); p.px(9, 6, '#5a5a5a');
  },
  carpet(p) { paintCarpet(p, ['#cbb27a', '#bda269', '#d8c28c']); },
  carpet_red(p) { paintCarpet(p, ['#b8433a', '#a53a31', '#c9534a']); },
  carpet_yellow(p) { paintCarpet(p, ['#d9c04a', '#c9b03e', '#e8d15e']); },
  carpet_white(p) { paintCarpet(p, ['#e4e4e0', '#d4d4d0', '#f2f2ee']); },
  bed_side(p) {
    p.speckle([PLANK_M, PLANK_L], [0.85, 0.15]);
    p.rect(0, 0, 16, 9, '#b8433a'); p.rect(0, 8, 16, 1, '#8f2f28'); // Decke
    p.rect(0, 0, 16, 2, '#e4e4e0'); // Lakenkante
  },
  bed_foot(p) {
    p.rect(0, 0, 16, 16, '#b8433a');
    for (let i = 0; i < 12; i++) p.px(2 + Math.floor(p.rand() * 12), 2 + Math.floor(p.rand() * 12), '#a53a31');
    p.rect(0, 0, 16, 1, '#8f2f28'); p.rect(0, 15, 16, 1, '#8f2f28');
    p.rect(0, 0, 1, 16, '#8f2f28'); p.rect(15, 0, 1, 16, '#8f2f28');
  },
  bed_head(p) {
    p.rect(0, 0, 16, 16, '#b8433a');
    p.rect(2, 2, 12, 8, '#f2f2ee'); p.rect(2, 9, 12, 1, '#d4d4d0'); // Kissen
    p.rect(3, 3, 10, 5, '#ffffff');
    p.rect(0, 0, 16, 1, '#8f2f28'); p.rect(0, 15, 16, 1, '#8f2f28');
    p.rect(0, 0, 1, 16, '#8f2f28'); p.rect(15, 0, 1, 16, '#8f2f28');
  },
  bone_meal(p) {
    for (let i = 0; i < 34; i++) {
      const x = 3 + Math.floor(p.rand() * 10), y = 6 + Math.floor(p.rand() * 7);
      p.px(x, y, p.rand() < 0.6 ? '#e8e4d8' : '#c8c4b6');
    }
    p.rect(5, 11, 6, 2, '#dcd8ca');
    p.px(7, 5, '#f4f0e4'); p.px(9, 6, '#f4f0e4');
  },
  sapling(p) {
    p.rect(7, 9, 2, 5, WOOD_M); p.px(7, 13, WOOD_D);
    p.rect(5, 4, 6, 5, '#4f8f3c'); p.rect(6, 2, 4, 3, '#5da548');
    p.px(4, 6, '#4f8f3c'); p.px(11, 5, '#5da548'); p.px(5, 3, '#6ab554');
  },
  birch_sapling(p) {
    p.rect(7, 9, 2, 5, '#d8d4c4'); p.px(7, 11, '#3a3a3a');
    p.rect(5, 4, 6, 5, '#74a85a'); p.rect(6, 2, 4, 3, '#88bc6c');
    p.px(4, 5, '#74a85a'); p.px(11, 6, '#88bc6c');
  },
  spruce_sapling(p) {
    p.rect(7, 11, 2, 3, WOOD_D);
    // kleine Tanne: gestufte Dreiecksform
    p.rect(7, 1, 2, 2, '#2e5d33');
    p.rect(6, 3, 4, 2, '#356b3b');
    p.rect(5, 5, 6, 2, '#2e5d33');
    p.rect(4, 7, 8, 2, '#356b3b');
    p.rect(3, 9, 10, 2, '#2e5d33');
  },
  tnt_side(p) {
    p.speckle(['#c8352c', '#b52d24', '#d84038'], [0.55, 0.3, 0.15]);
    p.rect(0, 5, 16, 5, '#e8e0d0');
    p.rect(0, 5, 16, 1, '#c8c0b0');
    // „TNT" in dunklen Pixeln
    const T = (x) => { p.rect(x, 6, 3, 1, '#2e2a26'); p.rect(x + 1, 6, 1, 3, '#2e2a26'); };
    T(2); T(11);
    p.rect(7, 6, 1, 3, '#2e2a26'); p.rect(9, 6, 1, 3, '#2e2a26'); p.px(8, 7, '#2e2a26');
  },
  tnt_top(p) {
    p.speckle(['#c8352c', '#b52d24', '#d84038'], [0.55, 0.3, 0.15]);
    p.rect(4, 4, 8, 8, '#e8e0d0');
    p.rect(6, 6, 4, 4, '#8a8276');
    p.rect(7, 7, 2, 2, '#4a453e');
  },
  vine(p) {
    p.clear(0, 0, 16, 16);
    // herabhängende Ranken mit Blättchen
    for (const [x0, sw] of [[2, 1], [5, -1], [8, 1], [11, -1], [14, 1]]) {
      for (let y = 0; y < 16; y++) {
        const x = Math.max(0, Math.min(15, x0 + (y % 5 === 3 ? sw : 0)));
        if ((y + x0) % 7 !== 6) p.px(x, y, (y + x0) % 3 === 0 ? '#2e6b28' : '#3c8232');
        if ((y + x0 * 3) % 6 === 2) p.px(Math.min(15, x + 1), y, '#4a9c3e');
      }
    }
  },
  stone_bricks(p) { paintBricks(p, ['#8a8a8a', '#828282', '#909090'], '#6a6a6a'); },
  cracked_stone_bricks(p) {
    paintBricks(p, ['#8a8a8a', '#828282', '#909090'], '#6a6a6a');
    // diagonale Risse
    for (const [sx, sy] of [[3, 2], [10, 8]]) {
      let x = sx, y = sy;
      for (let i = 0; i < 6; i++) {
        p.px(x, y, '#4a4a4a');
        x += (i % 2 === 0) ? 1 : 0; y += 1;
        if (x > 15 || y > 15) break;
      }
    }
  },
  mossy_stone_bricks(p) {
    paintBricks(p, ['#8a8a8a', '#828282', '#909090'], '#6a6a6a');
    for (let i = 0; i < 26; i++) {
      const x = Math.floor(p.rand() * 16), y = Math.floor(p.rand() * 16);
      p.px(x, y, p.rand() < 0.5 ? '#4f7a3a' : '#5d8a44');
    }
  },
  loot_chest(p) {
    p.speckle(['#5a4a7a', '#4f4070', '#655086'], [0.5, 0.3, 0.2]); // dunkles Runenholz
    p.rect(0, 0, 16, 1, '#2e2648'); p.rect(0, 15, 16, 1, '#2e2648');
    p.rect(0, 0, 1, 16, '#2e2648'); p.rect(15, 0, 1, 16, '#2e2648');
    p.rect(1, 6, 14, 1, '#2e2648'); // Deckelfuge
    p.rect(7, 5, 2, 4, '#ffd24a'); p.px(7, 5, '#ffe98c'); p.px(8, 8, '#c9a42c'); // Gold-Schloss
    p.px(3, 3, '#9c86d4'); p.px(12, 3, '#9c86d4'); p.px(3, 11, '#9c86d4'); p.px(12, 11, '#9c86d4'); // Runen
  },
  loot_chest_top(p) {
    p.speckle(['#5a4a7a', '#4f4070', '#655086'], [0.5, 0.3, 0.2]);
    p.rect(0, 0, 16, 1, '#2e2648'); p.rect(0, 15, 16, 1, '#2e2648');
    p.rect(0, 0, 1, 16, '#2e2648'); p.rect(15, 0, 1, 16, '#2e2648');
    p.rect(6, 6, 4, 4, '#9c86d4'); p.rect(7, 7, 2, 2, '#ffd24a'); // Runenkreis
  },
  socket_rune(p) {
    p.clear(0, 0, 16, 16);
    // Steintafel mit leuchtendem Sockel-Ring
    p.rect(3, 2, 10, 12, '#7a7a82'); p.rect(4, 3, 8, 10, '#8a8a92');
    p.rect(3, 2, 10, 1, '#9a9aa2'); p.rect(3, 13, 10, 1, '#5a5a62');
    p.rect(6, 5, 4, 4, '#3c2e5c');
    p.px(6, 5, '#9c86d4'); p.px(9, 5, '#9c86d4'); p.px(6, 8, '#9c86d4'); p.px(9, 8, '#9c86d4');
    p.rect(7, 6, 2, 2, '#c9b6ff'); p.px(7, 6, '#ffffff'); // leuchtender Kern
    p.rect(5, 11, 6, 1, '#6a5a92');
  },
  cobweb(p) {
    p.clear(0, 0, 16, 16);
    const W = '#e8e8e4', G = '#c8c8c2';
    // radiale Fäden aus der Mitte
    for (let i = 0; i < 8; i++) { p.px(7 + i, 7, W); p.px(7 - i > 0 ? 7 - i : 0, 8, G); }
    for (let i = 0; i < 8; i++) { p.px(7, 7 - i > 0 ? 7 - i : 0, W); p.px(8, 7 + i, G); }
    for (let i = 0; i < 6; i++) { p.px(8 + i, 8 + i, W); p.px(6 - i > 0 ? 6 - i : 0, 6 - i > 0 ? 6 - i : 0, G); }
    for (let i = 0; i < 6; i++) { p.px(6 - i > 0 ? 6 - i : 0, 8 + i, W); p.px(8 + i, 6 - i > 0 ? 6 - i : 0, G); }
    // Spiral-Ringe (angedeutet)
    for (const r of [3, 6]) {
      for (let i = -r; i <= r; i += 1) {
        if (Math.abs(i) === r || (i + r) % 2 === 0) { p.px(7 + i, 7 - r, G); p.px(7 + i, 8 + r > 15 ? 15 : 8 + r, G); }
      }
      p.px(7 - r, 7, G); p.px(8 + r > 15 ? 15 : 8 + r, 8, G);
    }
  },
  spawner(p) {
    p.speckle(['#2a2a32', '#232329', '#32323c'], [0.5, 0.3, 0.2]); // dunkler Käfig
    // Gitterstäbe
    for (const k of [0, 5, 10, 15]) { p.rect(k, 0, 1, 16, '#14141a'); p.rect(0, k, 16, 1, '#14141a'); }
    for (const k of [2, 7, 12]) { p.rect(k, 0, 1, 16, '#3c3c48'); p.rect(0, k, 16, 1, '#3c3c48'); }
    // Glut in der Mitte
    p.rect(6, 6, 4, 4, '#8a2c1c'); p.rect(7, 7, 2, 2, '#e8721c'); p.px(7, 7, '#ffb830');
  },
  boss_core(p) {
    p.speckle(['#2a1416', '#341a1c', '#231012'], [0.5, 0.3, 0.2]); // dunkler Blut-Stein
    for (const k of [0, 5, 10, 15]) { p.rect(k, 0, 1, 16, '#140a0c'); p.rect(0, k, 16, 1, '#140a0c'); }
    for (const k of [2, 7, 12]) { p.rect(k, 0, 1, 16, '#5a1e20'); p.rect(0, k, 16, 1, '#5a1e20'); }
    // glühender Blutkern
    p.rect(5, 5, 6, 6, '#7a0e12'); p.rect(6, 6, 4, 4, '#d81820'); p.rect(7, 7, 2, 2, '#ff5a4a'); p.px(7, 7, '#ffd0a0');
  },
  crimson_blood(p) {
    p.clear(0, 0, 16, 16);
    p.blob(8, 9, 4.5, 4.5, '#b01020', '#e0384a', '#7a0812'); // Blut-Tropfen
    p.rect(7, 3, 2, 3, '#8a0c16'); p.px(8, 2, '#a01020');     // Spitze (Tropfenform)
    p.px(6, 7, '#f06a78'); p.px(7, 6, '#f8909a');             // Glanz
  },
  crimson_potion(p) {
    p.clear(0, 0, 16, 16);
    p.rect(6, 1, 4, 2, '#8a6a3a');   // Korken
    p.rect(7, 3, 2, 4, '#b8b8c4');   // Hals (Glas)
    p.rect(4, 7, 8, 7, '#b8b8c4');   // Körper (Glas)
    p.rect(5, 9, 6, 4, '#cc1828');   // roter Trank
    p.rect(4, 10, 8, 3, '#cc1828');
    p.rect(4, 9, 8, 1, '#e84050');   // Oberfläche heller
    p.px(5, 11, '#f26070'); p.px(10, 12, '#8a1018'); // Glanz + Schatten
    p.px(6, 5, '#e6e6f0');           // Glasglanz
  },
  speed_potion(p) {
    p.clear(0, 0, 16, 16);
    p.rect(6, 1, 4, 2, '#8a6a3a');   // Korken
    p.rect(7, 3, 2, 4, '#b8b8c4');   // Hals (Glas)
    p.rect(4, 7, 8, 7, '#b8b8c4');   // Körper (Glas)
    p.rect(5, 9, 6, 4, '#1c9ce0');   // blauer Trank
    p.rect(4, 10, 8, 3, '#1c9ce0');
    p.rect(4, 9, 8, 1, '#5ac8f0');   // Oberfläche heller
    p.px(5, 11, '#8ce0ff'); p.px(10, 12, '#0e5a90'); // Glanz + Schatten
    p.px(6, 5, '#e6e6f0');           // Glasglanz
  },
  glass_bottle(p) {
    p.clear(0, 0, 16, 16);
    p.rect(6, 1, 4, 2, '#8a6a3a');   // Korken
    p.rect(7, 3, 2, 4, '#cdd2dc');   // Hals (Glas)
    p.rect(4, 7, 8, 7, '#cdd2dc');   // Körper (Glas)
    p.rect(5, 8, 6, 5, '#e8ecf2');   // leerer Innenraum (hell)
    p.rect(5, 12, 6, 1, '#aeb6c4');  // Boden
    p.px(5, 9, '#ffffff'); p.px(10, 11, '#9aa2b2'); // Glanz + Schatten
  },
  brewing_stand(p) {
    p.speckle(['#4a4a52', '#3e3e46', '#54545c'], [0.5, 0.3, 0.2]); // Steinsockel
    p.rect(0, 11, 16, 5, '#3a3a42'); // Sockel unten dunkler
    p.rect(7, 2, 2, 10, '#7a7060');  // Metallstange
    p.rect(6, 1, 4, 2, '#9a8f78');   // Kopf
    p.px(7, 3, '#b8ad94');           // Glanz
    p.rect(3, 8, 2, 4, '#8aa0c8'); p.rect(11, 8, 2, 4, '#8aa0c8'); // angedeutete Flaschen
  },
  brewing_stand_top(p) {
    p.speckle(['#4a4a52', '#3e3e46', '#54545c'], [0.5, 0.3, 0.2]);
    for (const [cx, cz] of [[4, 8], [8, 4], [12, 8]]) { // 3 Flaschen-Vertiefungen
      p.rect(cx - 1, cz - 1, 3, 3, '#26262c'); p.px(cx, cz, '#8aa0c8');
    }
    p.rect(7, 7, 2, 2, '#7a7060'); // Stange in der Mitte
  },
  redstone_dust(p) {
    // Form kommt aus den Verbindungs-Boxen; Kachel = dunkles Rot (aus)
    p.speckle(['#7a1616', '#6a1010', '#861c1c'], [0.5, 0.3, 0.2]);
    p.rect(6, 6, 4, 4, '#9a2222');
  },
  redstone_dust_on(p) {
    p.speckle(['#d82424', '#c81818', '#e83a2a'], [0.5, 0.3, 0.2]); // leuchtendes Rot (an)
    p.rect(5, 5, 6, 6, '#ff5030'); p.rect(6, 6, 4, 4, '#ff8464'); // glühender Kern
  },
  lever(p) {
    p.clear(0, 0, 16, 16);
    p.rect(4, 12, 8, 4, '#7a7a82'); p.rect(4, 12, 8, 1, '#9a9aa2'); // Steinsockel
    p.rect(6, 2, 4, 11, '#6a4e28'); p.rect(7, 2, 2, 11, '#8a6a3a'); // Holzhebel
    p.rect(5, 1, 6, 3, '#c86a3a'); p.rect(6, 1, 4, 2, '#e08850'); // Knauf
  },
  button(p) {
    p.clear(0, 0, 16, 16);
    p.rect(4, 6, 8, 5, '#8a8a92'); p.rect(5, 7, 6, 3, '#a2a2aa'); p.rect(6, 8, 4, 1, '#787880'); // Steinknopf
  },
  piston(p) {
    p.speckle(['#8a8a92', '#7c7c86', '#9a9aa2'], [0.5, 0.3, 0.2]); // Metallgehäuse
    for (const k of [0, 15]) { p.rect(k, 0, 1, 16, '#4a4a52'); p.rect(0, k, 16, 1, '#4a4a52'); } // Rahmen
    p.rect(3, 3, 10, 10, '#8a6a3a'); p.rect(4, 4, 8, 8, '#9a7a48'); // Holzplatte (Schubfläche)
    for (const [x, y] of [[1, 1], [13, 1], [1, 13], [13, 13]]) { p.rect(x, y, 2, 2, '#5a5a62'); p.px(x, y, '#c0c0c8'); } // Bolzen
    p.rect(6, 6, 4, 4, '#6a4e28'); // Nut
  },
  piston_head(p) {
    p.speckle(['#9a7a48', '#8a6a3a', '#a88a54'], [0.5, 0.3, 0.2]); // Holzarm
    for (const k of [0, 15]) { p.rect(k, 0, 1, 16, '#5a4428'); p.rect(0, k, 16, 1, '#5a4428'); }
    p.rect(2, 6, 12, 4, '#9a9aa2'); p.rect(2, 7, 12, 2, '#c0c0c8'); // Metallband
  },
  piston_body(p) {
    p.speckle(['#7c7c86', '#6e6e78', '#8a8a92'], [0.5, 0.3, 0.2]); // Metallkörper
    for (const k of [0, 15]) { p.rect(k, 0, 1, 16, '#4a4a52'); p.rect(0, k, 16, 1, '#4a4a52'); } // Rahmen
    for (const x of [4, 8, 11]) { p.rect(x, 2, 1, 12, '#5a5a62'); p.rect(x + 1, 2, 1, 12, '#9aa0a8'); } // Führungsschienen
    p.rect(2, 7, 12, 2, '#6a6a72'); // Quernaht
  },
  flux_ore(p) {
    p.speckle(['#8a8a90', '#7c7c82', '#9a9aa0'], [0.5, 0.3, 0.2]); // Stein
    for (const [x, y] of [[4, 4], [10, 5], [6, 10], [11, 11], [3, 9]]) { // Flux-Kristalle
      p.rect(x, y, 2, 2, '#c81848'); p.px(x, y, '#ff4a70');
    }
  },
  washer(p) {
    p.speckle(['#7a8088', '#6c727a', '#8a9098'], [0.5, 0.3, 0.2]); // Metallgehäuse
    for (const k of [0, 15]) { p.rect(k, 0, 1, 16, '#454a52'); p.rect(0, k, 16, 1, '#454a52'); }
    p.rect(3, 5, 10, 7, '#3a6a8a'); p.rect(3, 5, 10, 1, '#5a9ac0'); p.px(6, 7, '#8ac8e8'); // Wasserfenster
    p.rect(3, 12, 10, 2, '#5a5a62');
  },
  washer_top(p) {
    p.speckle(['#7a8088', '#6c727a', '#8a9098'], [0.5, 0.3, 0.2]);
    p.rect(3, 3, 10, 10, '#3a6a8a'); p.rect(4, 4, 8, 8, '#4a86b0'); // Wasserbecken
    p.px(6, 6, '#8ac8e8'); p.px(9, 9, '#2a5a7a');
  },
  flux_block(p) {
    p.speckle(['#c81830', '#b01028', '#e02840'], [0.5, 0.3, 0.2]); // leuchtendes Rot
    for (const k of [0, 15]) { p.rect(k, 0, 1, 16, '#7a0e1c'); p.rect(0, k, 16, 1, '#7a0e1c'); }
    for (const [x, y] of [[4, 5], [10, 4], [7, 10], [11, 11]]) { p.rect(x, y, 2, 2, '#ff5060'); p.px(x, y, '#ffa0a0'); }
    p.px(6, 6, '#ff8080');
  },
  dirty_flux(p) {
    p.clear(0, 0, 16, 16);
    p.blob(8, 9, 5, 4.5, '#7a3838', '#9a5050', '#5a2828'); // schmutziger Klumpen
    p.px(6, 8, '#a86868'); p.px(10, 10, '#4a2020');
    p.px(7, 7, '#c04a4a'); p.px(9, 11, '#8a3030'); // rötliche Flux-Reste
  },
  washer_bottom(p) {
    p.speckle(['#5a5e66', '#4e525a', '#6a6e76'], [0.5, 0.3, 0.2]); // dunkle Metallplatte
    for (const k of [0, 15]) { p.rect(k, 0, 1, 16, '#3a3e46'); p.rect(0, k, 16, 1, '#3a3e46'); }
    for (const [x, y] of [[4, 4], [10, 4], [4, 10], [10, 10], [7, 7]]) p.rect(x, y, 2, 2, '#2a2e36'); // Ablauflöcher
    for (const [x, y] of [[1, 1], [13, 1], [1, 13], [13, 13]]) p.px(x, y, '#8a8e96'); // Nieten
  },
  piston_sticky(p) {
    p.speckle(['#8a8a92', '#7c7c86', '#9a9aa2'], [0.5, 0.3, 0.2]); // Metallgehäuse
    for (const k of [0, 15]) { p.rect(k, 0, 1, 16, '#4a4a52'); p.rect(0, k, 16, 1, '#4a4a52'); }
    p.rect(3, 3, 10, 10, '#4aa84a'); p.rect(4, 4, 8, 8, '#5ec85e'); // klebrige grüne Fläche
    p.px(6, 6, '#8aff8a'); p.px(9, 9, '#3a883a');
    for (const [x, y] of [[1, 1], [13, 1], [1, 13], [13, 13]]) { p.rect(x, y, 2, 2, '#5a5a62'); p.px(x, y, '#c0c0c8'); } // Bolzen
  },
  slimeball(p) {
    p.clear(0, 0, 16, 16);
    p.blob(8, 9, 5, 4.5, '#4aa84a', '#6ec86e', '#3a883a'); // grüner Gel-Klumpen
    p.px(6, 7, '#9affaa'); p.px(7, 6, '#c0ffc0'); p.px(10, 11, '#2a682a');
  },
  string(p) {
    p.clear(0, 0, 16, 16);
    // aufgerollter Faden
    for (let i = 0; i < 12; i++) { p.px(3 + i, 5 + Math.round(Math.sin(i * 0.9) * 2), '#e8e8e4'); }
    for (let i = 0; i < 12; i++) { p.px(2 + i, 9 + Math.round(Math.sin(i * 0.8 + 1) * 2), '#d4d4ce'); }
    p.rect(6, 6, 4, 4, '#e8e8e4'); p.rect(7, 7, 2, 2, '#c8c8c2'); // Knäuel
  },
  dungeon_chest(p) {
    p.speckle(['#463c30', '#3c342a', '#524638'], [0.5, 0.3, 0.2]); // altes Eichenholz
    p.rect(0, 0, 16, 1, '#1c1814'); p.rect(0, 15, 16, 1, '#1c1814');
    p.rect(0, 0, 1, 16, '#1c1814'); p.rect(15, 0, 1, 16, '#1c1814');
    p.rect(1, 6, 14, 1, '#1c1814');
    p.rect(2, 2, 1, 12, '#6a6a72'); p.rect(13, 2, 1, 12, '#6a6a72'); // Eisenbänder
    p.rect(7, 5, 2, 4, '#8a8a92'); p.px(7, 5, '#b8b8c0'); p.px(8, 8, '#5a5a62'); // Eisen-Schloss
  },
  dungeon_chest_top(p) {
    p.speckle(['#463c30', '#3c342a', '#524638'], [0.5, 0.3, 0.2]);
    p.rect(0, 0, 16, 1, '#1c1814'); p.rect(0, 15, 16, 1, '#1c1814');
    p.rect(0, 0, 1, 16, '#1c1814'); p.rect(15, 0, 1, 16, '#1c1814');
    p.rect(2, 2, 1, 12, '#6a6a72'); p.rect(13, 2, 1, 12, '#6a6a72');
    p.rect(6, 6, 4, 4, '#8a8a92'); p.rect(7, 7, 2, 2, '#b8b8c0');
  },
  mossy_cobblestone(p) {
    // wie Bruchstein (Voronoi-Steine), aber mit Moosflecken über Steinen und Fugen
    const seeds = [];
    for (let i = 0; i < 6; i++) seeds.push([p.rand() * 16, p.rand() * 16, STONES[i % 4]]);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      let d1 = 1e9, d2 = 1e9, c = STONES[0];
      for (const [sx, sy, sc] of seeds) {
        const dx = Math.min(Math.abs(x - sx), 16 - Math.abs(x - sx));
        const dy = Math.min(Math.abs(y - sy), 16 - Math.abs(y - sy));
        const d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; c = sc; } else if (d < d2) { d2 = d; }
      }
      p.px(x, y, Math.sqrt(d2) - Math.sqrt(d1) < 1.1 ? '#5a5a5a' : c);
    }
    for (let i = 0; i < 30; i++) {
      const x = Math.floor(p.rand() * 16), y = Math.floor(p.rand() * 16);
      p.px(x, y, p.rand() < 0.5 ? '#4f7a3a' : '#5d8a44');
      if (p.rand() < 0.4) p.px(Math.min(15, x + 1), y, '#547f3e');
    }
  },
  pebbles(p) {
    p.clear(0, 0, 16, 16);
    // kleine runde Steinchen (Ansicht von oben/seitlich für den Teilblock)
    for (const [x, y, w, h, c] of [
      [2, 4, 5, 4, '#8a8a8a'], [8, 7, 6, 5, '#7d7d7d'], [4, 10, 4, 3, '#909090'],
    ]) {
      p.rect(x, y, w, h, c);
      p.rect(x + 1, y, w - 2, 1, '#a0a0a0'); // Glanz oben
      p.rect(x, y + h - 1, w, 1, '#6a6a6a');
      p.px(x, y, '#6e6e6e'); p.px(x + w - 1, y, '#6e6e6e'); // Ecken runden
      p.px(x, y + h - 1, '#5a5a5a'); p.px(x + w - 1, y + h - 1, '#5a5a5a');
    }
  },
  pebble(p) {
    p.clear(0, 0, 16, 16);
    p.rect(5, 6, 6, 5, '#8a8a8a');
    p.rect(6, 5, 4, 1, '#a0a0a0'); p.rect(6, 11, 4, 1, '#6a6a6a');
    p.px(5, 6, '#6e6e6e'); p.px(10, 6, '#6e6e6e'); p.px(5, 10, '#5a5a5a'); p.px(10, 10, '#5a5a5a');
    p.px(6, 7, '#b0b0b0'); p.px(7, 6, '#b0b0b0'); // Glanzpunkt
  },
  iron_block(p) { paintMetalBlock(p, '#d8d8d8', '#f2f2f2', '#a8a8a8'); },
  gold_block(p) { paintMetalBlock(p, '#f5d340', '#fce87b', '#c9a42c'); },
  diamond_block(p) { paintMetalBlock(p, '#4fd8d0', '#8ef0e8', '#2ba8a0'); },
  wreck_chest(p) {
    p.speckle(['#4a3a2a', '#403224', '#544030'], [0.5, 0.3, 0.2]); // versalzenes Wrackholz
    p.rect(0, 0, 16, 1, '#241a10'); p.rect(0, 15, 16, 1, '#241a10');
    p.rect(0, 0, 1, 16, '#241a10'); p.rect(15, 0, 1, 16, '#241a10');
    p.rect(1, 6, 14, 1, '#241a10');
    p.rect(7, 5, 2, 4, '#8a9a5a'); p.px(7, 5, '#aabf70'); p.px(8, 8, '#5a6a3a'); // Algen-Schloss
    p.px(3, 12, '#6a8a8a'); p.px(12, 4, '#6a8a8a'); p.px(4, 3, '#6a8a8a'); // Seepocken
  },
  wreck_chest_top(p) {
    p.speckle(['#4a3a2a', '#403224', '#544030'], [0.5, 0.3, 0.2]);
    p.rect(0, 0, 16, 1, '#241a10'); p.rect(0, 15, 16, 1, '#241a10');
    p.rect(0, 0, 1, 16, '#241a10'); p.rect(15, 0, 1, 16, '#241a10');
    p.rect(6, 6, 4, 4, '#8a9a5a'); p.px(11, 3, '#6a8a8a'); p.px(4, 11, '#6a8a8a');
  },
  crystal_blue(p) { paintCrystal(p, '#4a9de8', '#8ec8ff', '#2a6db8'); },
  crystal_purple(p) { paintCrystal(p, '#9a5ce0', '#c99cff', '#6a34a8'); },
  crystal_green(p) { paintCrystal(p, '#4ac878', '#8effb4', '#2a9850'); },
  crystal_orange(p) { paintCrystal(p, '#e8944a', '#ffc98e', '#b8642a'); },
  glass_blue(p) { paintColorGlass(p, '#4a9de8', '#8ec8ff'); },
  glass_purple(p) { paintColorGlass(p, '#9a5ce0', '#c99cff'); },
  glass_green(p) { paintColorGlass(p, '#4ac878', '#8effb4'); },
  glass_orange(p) { paintColorGlass(p, '#e8944a', '#ffc98e'); },
  shard_blue(p) { paintShard(p, '#4a9de8', '#8ec8ff', '#2a6db8'); },
  shard_purple(p) { paintShard(p, '#9a5ce0', '#c99cff', '#6a34a8'); },
  shard_green(p) { paintShard(p, '#4ac878', '#8effb4', '#2a9850'); },
  shard_orange(p) { paintShard(p, '#e8944a', '#ffc98e', '#b8642a'); },
  scroll_mining(p) { paintScroll(p, '#ffd24a', '#c9a42c'); },
  scroll_water(p) { paintScroll(p, '#4a9de8', '#2a6db8'); },
  scroll_levitation(p) { paintScroll(p, '#c9b6ff', '#9c86d4'); },
  tower_chest(p) {
    p.speckle(['#3c5a8a', '#345080', '#466a9a'], [0.5, 0.3, 0.2]); // arkanes Blauholz
    p.rect(0, 0, 16, 1, '#1e2c48'); p.rect(0, 15, 16, 1, '#1e2c48');
    p.rect(0, 0, 1, 16, '#1e2c48'); p.rect(15, 0, 1, 16, '#1e2c48');
    p.rect(1, 6, 14, 1, '#1e2c48');
    p.rect(7, 5, 2, 4, '#8ec8ff'); p.px(7, 5, '#d0eaff'); p.px(8, 8, '#4a7db8'); // Kristall-Schloss
    p.px(3, 3, '#8ec8ff'); p.px(12, 3, '#8ec8ff'); p.px(3, 11, '#8ec8ff'); p.px(12, 11, '#8ec8ff');
  },
  tower_chest_top(p) {
    p.speckle(['#3c5a8a', '#345080', '#466a9a'], [0.5, 0.3, 0.2]);
    p.rect(0, 0, 16, 1, '#1e2c48'); p.rect(0, 15, 16, 1, '#1e2c48');
    p.rect(0, 0, 1, 16, '#1e2c48'); p.rect(15, 0, 1, 16, '#1e2c48');
    p.rect(6, 6, 4, 4, '#8ec8ff'); p.rect(7, 7, 2, 2, '#d0eaff');
  },
  sandstone(p) {
    p.speckle(['#e0d3a0', '#d6c893', '#e8dcae'], [0.5, 0.3, 0.2]);
    // horizontale Schichtbänder
    p.rect(0, 4, 16, 1, '#c9ba82'); p.rect(0, 9, 16, 1, '#c9ba82'); p.rect(0, 13, 16, 1, '#cfc088');
    p.rect(0, 0, 16, 1, '#eee2b8'); p.rect(0, 15, 16, 1, '#bfae76');
    for (let i = 0; i < 6; i++) {
      const x = Math.floor(p.rand() * 15), y = 1 + Math.floor(p.rand() * 13);
      p.px(x, y, '#b8a670');
    }
  },
  sandstone_top(p) {
    p.speckle(['#e0d3a0', '#d6c893', '#e8dcae'], [0.5, 0.3, 0.2]);
    p.rect(0, 0, 16, 1, '#cfc088'); p.rect(0, 15, 16, 1, '#cfc088');
    p.rect(0, 0, 1, 16, '#cfc088'); p.rect(15, 0, 1, 16, '#cfc088');
    p.rect(4, 4, 8, 8, '#dbcf9c'); p.rect(5, 5, 6, 6, '#e4d8a8');
  },
  shrub(p) {
    p.clear(0, 0, 16, 16);
    // dürrer Busch: Stamm + zusammenhängende Diagonal-Zweige (jeder Pixel
    // berührt seinen Vorgänger — nichts schwebt)
    const D = '#6e5230', M = '#8a6a42', H = '#a68050';
    p.rect(7, 11, 2, 5, D);
    p.px(7, 10, M); p.px(8, 10, M);
    const zweig = (pts) => pts.forEach(([x, y], i) => p.px(x, y, i >= pts.length - 2 ? H : M));
    zweig([[6, 10], [5, 9], [4, 8], [3, 7], [2, 6]]);      // links außen
    zweig([[9, 10], [10, 9], [11, 8], [12, 7], [13, 6]]);  // rechts außen
    zweig([[7, 9], [6, 8], [6, 7], [5, 6], [5, 5]]);       // links mitte
    zweig([[8, 9], [9, 8], [9, 7], [10, 6], [10, 5]]);     // rechts mitte
    zweig([[7, 9], [7, 8], [8, 7], [8, 6], [8, 5], [7, 4]]); // mitte hoch
    zweig([[6, 12], [5, 11], [4, 11]]);                    // Stummel links
    zweig([[9, 12], [10, 11], [11, 11]]);                  // Stummel rechts
  },
  cactus_side(p) {
    p.speckle(['#4f8f3c', '#458234', '#5aa146'], [0.5, 0.3, 0.2]);
    for (const x of [2, 7, 12]) p.rect(x, 0, 1, 16, '#3a6e2c'); // Rippen
    for (let i = 0; i < 8; i++) {
      const x = 1 + Math.floor(p.rand() * 14), y = 1 + Math.floor(p.rand() * 14);
      p.px(x, y, '#e8f0d0'); // Stacheln
    }
  },
  cactus_top(p) {
    p.speckle(['#4f8f3c', '#458234', '#5aa146'], [0.5, 0.3, 0.2]);
    p.rect(1, 1, 14, 1, '#3a6e2c'); p.rect(1, 14, 14, 1, '#3a6e2c');
    p.rect(1, 1, 1, 14, '#3a6e2c'); p.rect(14, 1, 1, 14, '#3a6e2c');
    p.rect(6, 6, 4, 4, '#5aa146'); p.px(7, 7, '#e8f0d0'); p.px(8, 8, '#e8f0d0');
  },
  cactus_flower(p) {
    p.clear(0, 0, 16, 16);
    p.rect(7, 10, 2, 6, '#4f8f3c'); // kurzer Stiel
    // pinke Blüte mit heller Mitte
    p.rect(5, 4, 6, 5, '#f06eb4');
    p.rect(6, 3, 4, 1, '#f78cc6'); p.rect(6, 9, 4, 1, '#d4509c');
    p.px(4, 5, '#f78cc6'); p.px(4, 7, '#d4509c'); p.px(11, 5, '#f78cc6'); p.px(11, 7, '#d4509c');
    p.px(3, 6, '#f06eb4'); p.px(12, 6, '#f06eb4');
    p.rect(7, 5, 2, 2, '#ffe08a'); p.px(7, 6, '#ffca4a'); // Mitte
  },
  seagrass(p) { paintSeagrassFrame(p, 0); },
  kelp(p) { paintKelpFrame(p, 0); },
  kelp_top(p) { paintKelpTopFrame(p, 0); },
  raw_fish(p) {
    p.clear(0, 0, 16, 16);
    p.rect(3, 6, 8, 4, '#8fb4cc'); p.rect(4, 5, 6, 1, '#a4c4d8'); p.rect(4, 10, 6, 1, '#7aa0b8');
    p.px(11, 7, '#8fb4cc'); p.px(11, 8, '#8fb4cc');
    p.rect(12, 5, 2, 2, '#7aa0b8'); p.rect(12, 9, 2, 2, '#7aa0b8'); p.px(13, 7, '#7aa0b8'); p.px(13, 8, '#7aa0b8');
    p.px(4, 7, '#2e2e2e'); // Auge
  },
  cooked_fish(p) {
    p.clear(0, 0, 16, 16);
    p.rect(3, 6, 8, 4, '#c9955c'); p.rect(4, 5, 6, 1, '#dbaa70'); p.rect(4, 10, 6, 1, '#b07e48');
    p.px(11, 7, '#c9955c'); p.px(11, 8, '#c9955c');
    p.rect(12, 5, 2, 2, '#b07e48'); p.rect(12, 9, 2, 2, '#b07e48'); p.px(13, 7, '#b07e48'); p.px(13, 8, '#b07e48');
    p.px(5, 7, '#8a5f34'); p.px(8, 8, '#8a5f34'); // Röststreifen
  },
  mutton(p) {
    p.clear(0, 0, 16, 16);
    p.rect(4, 4, 8, 9, '#c4525a'); p.rect(5, 3, 6, 1, '#d46670');
    p.rect(5, 11, 6, 2, '#e8c8c8'); // Fettrand
    p.rect(6, 13, 4, 2, '#e8e0d8'); p.px(7, 15, '#d8d0c8'); // Knochen
    p.px(6, 6, '#a83e46'); p.px(9, 8, '#a83e46');
  },
  raw_chicken(p) {
    p.clear(0, 0, 16, 16);
    p.blob(8, 7, 5, 4.5, '#f0c4a8', '#f8dcc6', '#e0a286'); // blasse rohe Keule
    p.rect(6, 12, 4, 3, '#efe9dc'); p.px(7, 15, '#e0dccf'); // Knochen
    p.px(6, 6, '#dc9c82'); p.px(10, 9, '#dc9c82');          // Fleisch-Fleckchen
  },
  cooked_chicken(p) {
    p.clear(0, 0, 16, 16);
    p.blob(8, 7, 5, 4.5, '#c78a4e', '#dba766', '#a56a34'); // goldbraun gebraten
    p.rect(6, 12, 4, 3, '#efe9dc'); p.px(7, 15, '#e0dccf');
    p.px(6, 6, '#7a4a24'); p.px(10, 9, '#7a4a24');          // Röststellen
  },
  feather(p) {
    p.clear(0, 0, 16, 16);
    p.blob(8, 8, 3, 6, '#f2f2ea', '#ffffff', '#dadad0'); // weiße Fahne
    for (let y = 3; y <= 14; y++) p.px(8, y, '#c2c2b8');  // Kiel
    p.px(8, 14, '#a8a89e'); p.px(8, 15, '#a8a89e');       // Kielspitze
  },
  cooked_mutton(p) {
    p.clear(0, 0, 16, 16);
    p.rect(4, 4, 8, 9, '#9a5f34'); p.rect(5, 3, 6, 1, '#ac7040');
    p.rect(5, 11, 6, 2, '#c9a06a');
    p.rect(6, 13, 4, 2, '#e8e0d8'); p.px(7, 15, '#d8d0c8');
    p.px(6, 6, '#7a4626'); p.px(9, 8, '#7a4626');
  },
  cooked_porkchop(p) {
    p.clear(0, 0, 16, 16);
    p.rect(3, 5, 10, 7, '#c98a50'); p.rect(4, 4, 8, 1, '#dba062');
    p.rect(4, 12, 8, 1, '#b0713c');
    p.rect(4, 6, 2, 4, '#e8cfa0'); // heller Fettstreifen
    p.px(8, 7, '#9a6230'); p.px(10, 9, '#9a6230');
  },
  wool(p) {
    p.speckle(['#f2f2ee', '#e6e6e0', '#dadad2'], [0.5, 0.3, 0.2]);
    // flauschige Knubbel
    for (let i = 0; i < 9; i++) {
      const x = 1 + Math.floor(p.rand() * 13), y = 1 + Math.floor(p.rand() * 13);
      p.px(x, y, '#fbfbf8'); p.px(x + 1, y, '#e6e6e0');
    }
  },
  shears(p) {
    // zwei gekreuzte Klingen mit Griffen
    for (let i = 0; i < 7; i++) { p.px(4 + i, 10 - i, '#c8c8cc'); p.px(5 + i, 10 - i, '#a8a8ae'); }
    for (let i = 0; i < 7; i++) { p.px(11 - i, 10 - i, '#dcdce0'); p.px(10 - i, 10 - i, '#b8b8be'); }
    p.px(7, 7, '#6a6a70'); p.px(8, 7, '#6a6a70'); // Niete
    p.rect(3, 11, 2, 3, '#8a5f3c'); p.rect(11, 11, 2, 3, '#8a5f3c'); // Griffe
    p.px(4, 4, '#f4f4f8'); p.px(11, 4, '#f4f4f8'); // Spitzen-Glanz
  },
  chest_front(p) {
    p.speckle([PLANK_M, PLANK_L], [0.8, 0.2]);
    p.rect(0, 0, 16, 1, PLANK_D); p.rect(0, 15, 16, 1, PLANK_D);
    p.rect(0, 0, 1, 16, PLANK_D); p.rect(15, 0, 1, 16, PLANK_D);
    p.rect(1, 6, 14, 1, PLANK_D); // Deckelfuge
    p.rect(7, 5, 2, 4, '#8a8a8a'); p.px(7, 5, '#c0c0c0'); p.px(8, 8, '#5a5a5a'); // Schloss
  },
  chest_top(p) {
    p.speckle([PLANK_M, PLANK_L], [0.8, 0.2]);
    p.rect(0, 0, 16, 1, PLANK_D); p.rect(0, 15, 16, 1, PLANK_D);
    p.rect(0, 0, 1, 16, PLANK_D); p.rect(15, 0, 1, 16, PLANK_D);
  },
  glass(p) {
    p.clear(0, 0, 16, 16);
    for (let i = 0; i < 16; i++) { p.px(i, 0, '#dff3f5'); p.px(i, 15, '#dff3f5'); p.px(0, i, '#dff3f5'); p.px(15, i, '#dff3f5'); }
    // Glanz-Streifen diagonal
    for (let i = 0; i < 5; i++) { p.px(3 + i, 7 - i, '#ffffff'); p.px(6 + i, 12 - i, '#cfe9ee'); }
  },
  door_lower(p) {
    p.speckle([PLANK_M, PLANK_L], [0.85, 0.15]);
    p.rect(0, 0, 1, 16, PLANK_D); p.rect(15, 0, 1, 16, PLANK_D); p.rect(0, 15, 16, 1, PLANK_D);
    p.rect(3, 2, 4, 12, PLANK_D); p.rect(4, 3, 2, 10, PLANK_M); // Kassetten
    p.rect(9, 2, 4, 12, PLANK_D); p.rect(10, 3, 2, 10, PLANK_M);
  },
  door_upper(p) {
    p.speckle([PLANK_M, PLANK_L], [0.85, 0.15]);
    p.rect(0, 0, 1, 16, PLANK_D); p.rect(15, 0, 1, 16, PLANK_D); p.rect(0, 0, 16, 1, PLANK_D);
    p.rect(3, 3, 4, 5, '#9adbe8'); p.rect(9, 3, 4, 5, '#9adbe8'); // Fensterchen
    p.px(3, 3, '#cdeef5'); p.px(9, 3, '#cdeef5');
    p.rect(3, 10, 4, 4, PLANK_D); p.rect(9, 10, 4, 4, PLANK_D);
    p.px(1, 8, '#3a3a3a'); p.px(1, 9, '#5a5a5a'); // Griff
  },
  ladder(p) {
    p.clear(0, 0, 16, 16);
    p.rect(2, 0, 2, 16, WOOD_M); p.rect(12, 0, 2, 16, WOOD_M);
    p.rect(2, 0, 1, 16, WOOD_L); p.rect(12, 0, 1, 16, WOOD_L);
    for (const y of [2, 7, 12]) { p.rect(4, y, 8, 2, WOOD_D); p.rect(4, y, 8, 1, WOOD_M); }
  },
  trapdoor(p) {
    p.speckle([PLANK_M, PLANK_L], [0.85, 0.15]);
    p.rect(0, 0, 16, 1, PLANK_D); p.rect(0, 15, 16, 1, PLANK_D);
    p.rect(0, 0, 1, 16, PLANK_D); p.rect(15, 0, 1, 16, PLANK_D);
    p.rect(4, 4, 8, 8, PLANK_D); p.rect(5, 5, 6, 6, PLANK_M);
    p.rect(7, 1, 2, 2, '#6a6a6a'); // Griffring
  },
  flint_and_steel(p) {
    // Feuerstein (dunkel, unten links)
    p.rect(3, 8, 5, 4, '#3f4046'); p.rect(4, 7, 3, 1, '#55565e');
    p.px(2, 9, '#2e2f34'); p.px(7, 12, '#2e2f34'); p.px(5, 9, '#6a6b74');
    // Stahlbügel (C-Form, oben rechts)
    p.rect(9, 3, 4, 2, '#c8c8c8');
    p.rect(8, 4, 2, 4, '#c8c8c8');
    p.rect(9, 8, 4, 2, '#d8d8d8');
    p.px(12, 5, '#a8a8a8'); p.px(13, 4, '#e8e8e8');
    // Funke
    p.px(7, 5, '#ffd24a'); p.px(6, 4, '#ffb62e'); p.px(8, 6, '#ffe98c');
  },
  iron_pickaxe(p) { paintPickaxe(p, IRONMAT[0], IRONMAT[1], IRONMAT[2]); },
  iron_axe(p) { paintAxe(p, IRONMAT[0], IRONMAT[1], IRONMAT[2]); },
  iron_shovel(p) { paintShovel(p, IRONMAT[0], IRONMAT[1], IRONMAT[2]); },
  iron_sword(p) { paintSword(p, IRONMAT[0], IRONMAT[1], IRONMAT[2]); },
  gold_pickaxe(p) { paintPickaxe(p, GOLDMAT[0], GOLDMAT[1], GOLDMAT[2]); },
  gold_axe(p) { paintAxe(p, GOLDMAT[0], GOLDMAT[1], GOLDMAT[2]); },
  gold_shovel(p) { paintShovel(p, GOLDMAT[0], GOLDMAT[1], GOLDMAT[2]); },
  gold_sword(p) { paintSword(p, GOLDMAT[0], GOLDMAT[1], GOLDMAT[2]); },
  diamond_pickaxe(p) { paintPickaxe(p, DIAMAT[0], DIAMAT[1], DIAMAT[2]); },
  diamond_axe(p) { paintAxe(p, DIAMAT[0], DIAMAT[1], DIAMAT[2]); },
  diamond_shovel(p) { paintShovel(p, DIAMAT[0], DIAMAT[1], DIAMAT[2]); },
  diamond_sword(p) { paintSword(p, DIAMAT[0], DIAMAT[1], DIAMAT[2]); },
  iron_helmet(p) { paintHelmet(p, IRONMAT[0], IRONMAT[1], IRONMAT[2]); },
  iron_chest(p) { paintChest(p, IRONMAT[0], IRONMAT[1], IRONMAT[2]); },
  iron_legs(p) { paintLegs(p, IRONMAT[0], IRONMAT[1], IRONMAT[2]); },
  iron_boots(p) { paintBoots(p, IRONMAT[0], IRONMAT[1], IRONMAT[2]); },
  gold_helmet(p) { paintHelmet(p, GOLDMAT[0], GOLDMAT[1], GOLDMAT[2]); },
  gold_chest(p) { paintChest(p, GOLDMAT[0], GOLDMAT[1], GOLDMAT[2]); },
  gold_legs(p) { paintLegs(p, GOLDMAT[0], GOLDMAT[1], GOLDMAT[2]); },
  gold_boots(p) { paintBoots(p, GOLDMAT[0], GOLDMAT[1], GOLDMAT[2]); },
  diamond_helmet(p) { paintHelmet(p, DIAMAT[0], DIAMAT[1], DIAMAT[2]); },
  diamond_chest(p) { paintChest(p, DIAMAT[0], DIAMAT[1], DIAMAT[2]); },
  diamond_legs(p) { paintLegs(p, DIAMAT[0], DIAMAT[1], DIAMAT[2]); },
  diamond_boots(p) { paintBoots(p, DIAMAT[0], DIAMAT[1], DIAMAT[2]); },
};

// ---- atlas -----------------------------------------------------------------

let atlasCanvas = null;
let atlasResult = null;
const iconCache = new Map();

export function createAtlas() {
  if (atlasResult) return atlasResult;
  atlasCanvas = document.createElement('canvas');
  atlasCanvas.width = COLS * TILE;
  atlasCanvas.height = COLS * TILE;
  const g = atlasCanvas.getContext('2d');

  TILE_NAMES.forEach((name, i) => {
    const ox = (i % COLS) * TILE, oy = Math.floor(i / COLS) * TILE;
    PAINTERS[name](makePaintCtx(g, ox, oy, name));
  });

  const texture = new THREE.CanvasTexture(atlasCanvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;

  atlasResult = {
    texture,
    canvas: atlasCanvas,
    tileIndex(name) { return TILE_NAMES.indexOf(name); },
    uv: uvRect,
  };
  return atlasResult;
}

// Pixel-Daten einer Kachel (RGBA, 16×16) — für extrudierte 3D-Handmodelle
const pixelCache = new Map();
export function getTilePixels(name) {
  let d = pixelCache.get(name);
  if (d) return d;
  createAtlas();
  const i = TILE_NAMES.indexOf(name);
  const g = atlasCanvas.getContext('2d');
  d = g.getImageData((i % COLS) * TILE, Math.floor(i / COLS) * TILE, TILE, TILE).data;
  pixelCache.set(name, d);
  return d;
}

// Kachel abgedunkelt in ein 16×16-Zwischencanvas zeichnen (Transparenz bleibt erhalten)
function shadedTile(tileName, shade) {
  const i = TILE_NAMES.indexOf(tileName);
  const t = document.createElement('canvas');
  t.width = TILE; t.height = TILE;
  const tg = t.getContext('2d');
  tg.imageSmoothingEnabled = false;
  tg.drawImage(atlasCanvas, (i % COLS) * TILE, Math.floor(i / COLS) * TILE, TILE, TILE, 0, 0, TILE, TILE);
  if (shade < 1) {
    tg.globalCompositeOperation = 'source-atop';
    tg.fillStyle = `rgba(0,0,0,${(1 - shade).toFixed(2)})`;
    tg.fillRect(0, 0, TILE, TILE);
  }
  return t;
}

// Isometrische Projektion einer Zellposition (0..1) ins 48×48-Icon
function isoProj(x, y, z) {
  return [24 + (x - z) * 20.8, 25.6 - y * 24 + (x + z) * 10.4];
}

// Eine Parallelogramm-Fläche: Textur affin auf A→B (u) / A→D (v) abbilden
function isoFace(g, tile, A, B, D) {
  g.save();
  g.setTransform(
    (B[0] - A[0]) / TILE, (B[1] - A[1]) / TILE,
    (D[0] - A[0]) / TILE, (D[1] - A[1]) / TILE,
    A[0], A[1]
  );
  g.imageSmoothingEnabled = false;
  g.drawImage(tile, 0, 0);
  g.restore();
}

// Crisp icon for a block or item id (48x48 PNG data URL, cached).
// Blöcke werden wie in Minecraft als isometrische 3D-Würfel/-Formen gezeichnet,
// Items und Kreuz-Pflanzen als flache Kachel.
export function getIconDataURL(id) {
  if (iconCache.has(id)) return iconCache.get(id);
  createAtlas();
  const c = document.createElement('canvas');
  c.width = 48; c.height = 48;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;

  const def = isBlockId(id) ? BLOCKS[id] : null;
  const flach = !def || def.cross || def.ladder;
  if (flach) {
    const tileName = def ? (def.tiles.side ?? 'stone') : (ITEMS[id]?.tile ?? 'stone');
    const i = TILE_NAMES.indexOf(tileName);
    g.drawImage(atlasCanvas, (i % COLS) * TILE, Math.floor(i / COLS) * TILE, TILE, TILE, 0, 0, 48, 48);
  } else {
    // sichtbare Flächen: oben (hell), Süden +z (mittel), Osten +x (dunkel)
    const top = shadedTile(def.tiles.top ?? def.tiles.side, 1.0);
    const south = shadedTile(def.tiles.side, 0.8);
    const east = shadedTile(def.tiles.side, 0.6);
    const boxes = def.boxes || [[0, 0, 0, 1, 1, 1]];
    for (const b of boxes) {
      const [x0, y0, z0, x1, y1, z1] = b;
      // Oberseite: A=(x0,y1,z0), u→(x1), v→(z1)
      isoFace(g, top, isoProj(x0, y1, z0), isoProj(x1, y1, z0), isoProj(x0, y1, z1));
      // Südseite (+z): A=(x0,y1,z1), u→x, v→−y
      isoFace(g, south, isoProj(x0, y1, z1), isoProj(x1, y1, z1), isoProj(x0, y0, z1));
      // Ostseite (+x): A=(x1,y1,z1), u→−z, v→−y
      isoFace(g, east, isoProj(x1, y1, z1), isoProj(x1, y1, z0), isoProj(x1, y0, z1));
    }
  }
  const url = c.toDataURL();
  iconCache.set(id, url);
  return url;
}
