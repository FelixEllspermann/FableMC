// Deterministic terrain generation with layered noises:
//   continentalness -> base elevation (deep oceans .. inland)
//   erosion         -> how flat/hilly a region is
//   hills fbm       -> local detail
//   mountainness    -> big peaks (inland only), sharpened by ridge noise (Grate/Kämme)
//   valley noise    -> carved valleys & gorges (Täler/Schluchten)
//   lake noise      -> inland lake basins
//   mushroom noise  -> rare islands in oceans
// Biomes are picked from heat + humidity noises (Whittaker-style), with
// elevation-based mountain sub-biomes and water/beach biomes on top.

import { makeNoise2D, makeNoise3D, fbm2, ridgedFbm, hash2, mulberry32 } from './noise.js';
import { BLOCK, BLOCKS, CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL, blockIndex, CARDINAL_DELTA } from './constants.js';

let cache = null;
function noises(seed) {
  if (!cache || cache.seed !== seed) {
    cache = {
      seed,
      cont: makeNoise2D(seed ^ 0x0c0417),
      eros: makeNoise2D(seed ^ 0x1a2b3c),
      height: makeNoise2D(seed ^ 0x2b3c4d),
      mountain: makeNoise2D(seed ^ 0x3c4d5e),
      ridge: makeNoise2D(seed ^ 0x99aa11),
      warp1: makeNoise2D(seed ^ 0x1f2e3d),
      warp2: makeNoise2D(seed ^ 0x4c5b6a),
      rough: makeNoise2D(seed ^ 0x7d8e9f),
      terr: makeNoise2D(seed ^ 0xa1b2c3),
      valley: makeNoise2D(seed ^ 0x77cc33),
      lake: makeNoise2D(seed ^ 0x55ee77),
      mushroom: makeNoise2D(seed ^ 0x33bb99),
      temp: makeNoise2D(seed ^ 0x4d5e6f),
      humid: makeNoise2D(seed ^ 0xbb44dd),
      cave1: makeNoise3D(seed ^ 0x6f7081),
      cave2: makeNoise3D(seed ^ 0x708192),
      cavern: makeNoise3D(seed ^ 0x8192a3),
      ore: makeNoise3D(seed ^ 0x92a3b4),
      // Höhlensystem 2.0 (alles 2D, pro Säule ausgewertet)
      ravine: makeNoise2D(seed ^ 0xc0ffee),
      ravineY: makeNoise2D(seed ^ 0xdeed42),
      shaft: makeNoise2D(seed ^ 0xfeed11),
      entrance: makeNoise2D(seed ^ 0xace777),
      aquifer: makeNoise2D(seed ^ 0xb0a712),
      lavaN: makeNoise2D(seed ^ 0x5eeded),
      cavebiome: makeNoise2D(seed ^ 0x9d8c7b),
      pillarReg: makeNoise2D(seed ^ 0x246813),
      pillar2: makeNoise2D(seed ^ 0x135792),
    };
  }
  return cache;
}

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// continentalness -> base surface height (sea level = 150)
const CONT_SPLINE = [
  [-0.50, 62],
  [-0.26, 92],
  [-0.12, 132],
  [-0.02, 148],
  [0.08, 162],
  [0.25, 176],
  [0.60, 196],
];
function baseHeight(c) {
  if (c <= CONT_SPLINE[0][0]) return CONT_SPLINE[0][1];
  for (let i = 1; i < CONT_SPLINE.length; i++) {
    if (c <= CONT_SPLINE[i][0]) {
      const [x0, y0] = CONT_SPLINE[i - 1];
      const [x1, y1] = CONT_SPLINE[i];
      return y0 + ((c - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return CONT_SPLINE[CONT_SPLINE.length - 1][1];
}

// mountain sub-biome elevation bands
const Y_GIPFEL = 290;
const Y_HOCHGEBIRGE = 252;
const Y_HAENGE = 212;
const Y_FUSS = 172;

// Everything about a column, computed once (all noise layers stacked).
export function columnInfo(seed, x, z) {
  const n = noises(seed);

  // --- height pipeline ---
  const C = fbm2(n.cont, x * 0.0009, z * 0.0009, 3, 2, 0.5);
  const E = fbm2(n.eros, x * 0.0018, z * 0.0018, 2, 2, 0.5);
  const hillAmp = 8 + (1 - smoothstep(-0.4, 0.4, E)) * 26;
  const hills = fbm2(n.height, x * 0.008, z * 0.008, 4, 2, 0.5) * hillAmp;
  // two-scale domain warping: mountain shapes get their coordinates distorted so
  // peaks/ridges stop looking like clean symmetric noise blobs
  const wx1 = x + n.warp1(x * 0.004, z * 0.004) * 80;
  const wz1 = z + n.warp2(x * 0.004, z * 0.004) * 80;
  const wx2 = wx1 + n.warp1(x * 0.017, z * 0.017) * 14;
  const wz2 = wz1 + n.warp2(x * 0.017, z * 0.017) * 14;
  const M = smoothstep(0.12, 0.5, fbm2(n.mountain, wx1 * 0.003, wz1 * 0.003, 3, 2, 0.5));
  const inland = smoothstep(-0.05, 0.15, C);
  const mEff = M * inland;
  // ridged multifractal builds the mountain body: sharp creases at several scales,
  // self-modulating, so every massif gets its own character
  const rmf = ridgedFbm(n.ridge, wx2 * 0.0045, wz2 * 0.0045, 4, 2.1, 0.55);
  let mAmp = mEff * (55 + 160 * rmf);
  // patchy extra jaggedness: some faces are broken scree, others stay smooth slab
  const patch = smoothstep(-0.1, 0.5, n.terr(x * 0.007, z * 0.007));
  mAmp += fbm2(n.rough, x * 0.03, z * 0.03, 2, 2, 0.5) * mEff * 30 * patch;
  // occasional rock benches: varying step size AND a drifting phase, so the bench
  // lines wander and break up instead of forming closed contour rings around peaks
  const bench = smoothstep(0.35, 0.7, n.terr(z * 0.005 + 31.7, x * 0.005 - 17.3));
  if (bench > 0.01) {
    const step = 7 + (n.warp1(x * 0.006, z * 0.006) + 1) * 8; // 7..23 blocks
    const phase = n.warp2(x * 0.011, z * 0.011) * step;
    const q = Math.round((mAmp + phase) / step) * step - phase;
    mAmp = mAmp * (1 - 0.3 * bench) + q * (0.3 * bench);
  }
  let h = baseHeight(C) + hills + mAmp;

  // inland lake basins
  const lakeV = fbm2(n.lake, x * 0.004, z * 0.004, 2, 2, 0.5);
  h -= smoothstep(0.48, 0.62, lakeV) * inland * (1 - M) * 24;

  // valleys & gorges: narrow carved lines, deep in mountains (Schluchten)
  const v = Math.abs(fbm2(n.valley, x * 0.0035, z * 0.0035, 2, 2, 0.5));
  const valley = 1 - smoothstep(0.02, 0.09, v);
  h -= valley * inland * (9 + 48 * M);

  // mushroom islands: rare bumps that only exist in open ocean
  const oceanMask = smoothstep(0.12, 0.3, -C);
  const island = smoothstep(0.44, 0.56, fbm2(n.mushroom, x * 0.005, z * 0.005, 2, 2, 0.5)) * oceanMask;
  if (island > 0.03) {
    h = Math.max(h, SEA_LEVEL + 1 + island * (5 + Math.max(0, hills * 0.4)));
  }

  // --- climate ---
  // Biome-Blending: das Klima wird an leicht verwürfelten Koordinaten abgetastet,
  // dadurch verzahnen sich Biome an den Grenzen (gemischte Blöcke/Bäume) statt harter Kanten
  const jx = x + (hash2(seed ^ 0xd17e, x, z) - 0.5) * 14;
  const jz = z + (hash2(seed ^ 0x71ed, x, z) - 0.5) * 14;
  const T = fbm2(n.temp, jx * 0.0016, jz * 0.0016, 2, 2, 0.5);
  const H = fbm2(n.humid, jx * 0.0016, jz * 0.0016, 2, 2, 0.5);

  // --- biome decision (before swamp flattening) ---
  let surf = Math.round(Math.max(30, Math.min(WORLD_HEIGHT - 30, h)));
  let biome;

  if (island > 0.05 && surf > SEA_LEVEL) {
    biome = 'pilzinsel';
  } else if (surf <= SEA_LEVEL - 1) {
    biome = C < 0 ? 'ozean' : 'see'; // See = Wasser im Landesinneren
  } else if (surf >= Y_GIPFEL) {
    biome = 'gipfel';
  } else if (surf >= Y_HOCHGEBIRGE) {
    biome = 'hochgebirge';
  } else if (surf >= Y_HAENGE && mEff > 0.12) {
    biome = 'haenge';
  } else if (surf >= Y_FUSS && mEff > 0.18) {
    biome = 'gebirgsfuss';
  } else if (T > 0.16) { // hot
    if (H < -0.18) biome = 'badlands';
    else if (H < 0) biome = 'wueste';
    else if (H < 0.2) biome = 'savanne';
    else biome = 'dschungel'; // heiß + feucht
  } else if (T < -0.28) { // frozen
    biome = H < 0.03 ? 'schneelandschaft' : 'schneewald';
  } else if (T < -0.08) { // cool
    if (H > 0.06) biome = 'tannenwald';
    else if (H > -0.15) biome = 'wald';
    else biome = 'ebene';
  } else { // temperate
    if (H < -0.18) biome = 'ebene';
    else if (H < -0.06) biome = 'blumenwiese';
    else if (H < 0.08) biome = 'birkenwald';
    else if (H < 0.24) biome = 'wald';
    else biome = surf <= SEA_LEVEL + 6 ? 'sumpf' : 'wald';
  }

  // swamp: flatten SMOOTHLY toward the waterline (blends into neighbors, no hard step)
  if (surf > SEA_LEVEL - 2 && surf <= SEA_LEVEL + 10 && H > 0.18 && T > -0.16 && T < 0.26) {
    const T0 = fbm2(n.temp, x * 0.0016, z * 0.0016, 2, 2, 0.5);
    const H0 = fbm2(n.humid, x * 0.0016, z * 0.0016, 2, 2, 0.5);
    const sw = smoothstep(0.26, 0.38, H0) *
      smoothstep(-0.12, -0.04, T0) * (1 - smoothstep(0.14, 0.22, T0)) *
      (1 - smoothstep(SEA_LEVEL + 4, SEA_LEVEL + 10, surf));
    if (sw > 0.01) {
      const target = SEA_LEVEL + 1 + Math.max(0, surf - SEA_LEVEL - 1) * 0.25;
      let sh = surf * (1 - sw) + target * sw;
      if (biome === 'sumpf' && fbm2(n.lake, x * 0.02, z * 0.02, 2, 2, 0.5) > 0.24) {
        sh = Math.min(sh, SEA_LEVEL - 1);
      }
      surf = Math.round(sh);
    }
  }

  // beaches: the strip right at the waterline (not for swamps/mushroom islands)
  if (biome !== 'sumpf' && biome !== 'pilzinsel' &&
      surf >= SEA_LEVEL && surf <= SEA_LEVEL + 1) {
    biome = 'strand';
  }

  return { surf, biome, T, H, mEff };
}

export function heightAt(seed, x, z) {
  return columnInfo(seed, x, z).surf;
}

export function biomeAt(seed, x, z) {
  return columnInfo(seed, x, z).biome;
}

// ---- trees & structures -----------------------------------------------------

const MAX_TREE_DENSITY = 0.095;
const TREE_DENSITY = {
  wald: [0.055, 'oak'],
  birkenwald: [0.05, 'birch'],
  tannenwald: [0.05, 'spruce'],
  schneewald: [0.03, 'spruce'],
  sumpf: [0.018, 'oak'],
  savanne: [0.007, 'acacia'],
  ebene: [0.004, 'oak'],
  blumenwiese: [0.003, 'oak'],
  gebirgsfuss: [0.01, 'spruce'],
  pilzinsel: [0.02, 'mushroom'],
  dschungel: [0.09, 'jungle'], // sehr dicht
};

// Deterministic per-column tree check: same result no matter which chunk asks.
function treeAt(seed, x, z) {
  const r = hash2(seed ^ 0x7ee5, x, z);
  if (r >= MAX_TREE_DENSITY) return null; // cheap reject before noise lookups
  const { surf, biome } = columnInfo(seed, x, z);
  const entry = TREE_DENSITY[biome];
  if (!entry || r >= entry[0]) return null;
  if (surf <= SEA_LEVEL || surf + 12 >= WORLD_HEIGHT) return null;
  let type = entry[1];
  const th = hash2(seed ^ 0xbeef, x, z);
  if (type === 'birch' && th > 0.85) type = 'oak'; // birch forests get a few oaks
  if (type === 'mushroom') type = th > 0.5 ? 'mushroom_red' : 'mushroom_brown';
  const h = type === 'spruce' ? 6 + Math.floor(th * 4)
    : type.startsWith('mushroom') ? 4 + Math.floor(th * 3)
    : type === 'acacia' ? 4 + Math.floor(th * 2)
    : type === 'jungle' ? 8 + Math.floor(th * 6)
    : 4 + Math.floor(th * 3);
  return { surf, h, type };
}

// Writes one tree's blocks that fall inside the chunk starting at (ox, oz).
function writeTree(data, ox, oz, tx, tz, t) {
  const { surf, h, type } = t;
  const topY = surf + h;
  const put = (wx, wy, wz, id, onlyAir) => {
    const lx = wx - ox, lz = wz - oz;
    if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || wy < 0 || wy >= WORLD_HEIGHT) return;
    const i = blockIndex(lx, wy, lz);
    if (onlyAir && data[i] !== BLOCK.AIR) return;
    data[i] = id;
  };
  const ring = (y, r, id, skipCorners) => {
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (dx === 0 && dz === 0) continue;
      if (skipCorners && Math.abs(dx) === r && Math.abs(dz) === r) continue;
      put(tx + dx, y, tz + dz, id, true);
    }
  };

  if (type === 'oak' || type === 'birch') {
    const logId = type === 'birch' ? BLOCK.BIRCH_LOG : BLOCK.LOG;
    const leafId = type === 'birch' ? BLOCK.BIRCH_LEAVES : BLOCK.LEAVES;
    for (let y = topY - 1; y <= topY; y++) ring(y, 2, leafId, true);
    ring(topY + 1, 1, leafId, true);
    put(tx, topY + 1, tz, leafId, true);
    put(tx, topY + 2, tz, leafId, true);
    for (let y = surf + 1; y <= topY; y++) put(tx, y, tz, logId, false);
  } else if (type === 'jungle') {
    // hoher Urwaldriese: große Krone oben + Zwischenkrone, Lianen hängen herab
    for (let y = topY - 1; y <= topY; y++) ring(y, 2, BLOCK.LEAVES, true);
    ring(topY + 1, 1, BLOCK.LEAVES, true);
    put(tx, topY + 1, tz, BLOCK.LEAVES, true);
    const midY = surf + Math.floor(h * 0.55);
    ring(midY, 1, BLOCK.LEAVES, true); // kleine Zwischenkrone
    for (let y = surf + 1; y <= topY; y++) put(tx, y, tz, BLOCK.JUNGLE_LOG, false);
    // Lianen: von Kronen-Randzellen 2–5 Blöcke herabhängen
    for (const [vx, vz, salt] of [[-2, 0, 1], [2, 0, 2], [0, -2, 3], [0, 2, 4]]) {
      const vh = 2 + Math.floor(hash2(tx * 31 + salt, tx + vx, tz + vz) * 4);
      for (let i = 0; i < vh; i++) {
        put(tx + vx, topY - 1 - i, tz + vz, BLOCK.VINE, true);
      }
    }
  } else if (type === 'spruce') {
    // conical: alternating radius-2 / radius-1 rings up the trunk
    for (let y = surf + 3; y <= topY; y++) {
      const k = topY - y;
      ring(y, k % 2 === 1 ? 2 : 1, BLOCK.SPRUCE_LEAVES, true);
    }
    ring(topY + 1, 1, BLOCK.SPRUCE_LEAVES, true);
    put(tx, topY + 1, tz, BLOCK.SPRUCE_LEAVES, true);
    put(tx, topY + 2, tz, BLOCK.SPRUCE_LEAVES, true);
    for (let y = surf + 1; y <= topY; y++) put(tx, y, tz, BLOCK.SPRUCE_LOG, false);
  } else if (type === 'acacia') {
    // flat-topped canopy
    ring(topY, 2, BLOCK.LEAVES, true);
    put(tx, topY, tz, BLOCK.LEAVES, true);
    ring(topY + 1, 1, BLOCK.LEAVES, false);
    put(tx, topY + 1, tz, BLOCK.LEAVES, true);
    for (let y = surf + 1; y <= topY; y++) put(tx, y, tz, BLOCK.LOG, false);
  } else { // mushroom_red / mushroom_brown
    const cap = type === 'mushroom_red' ? BLOCK.MUSHROOM_CAP_RED : BLOCK.MUSHROOM_CAP_BROWN;
    ring(topY, 2, cap, true);
    put(tx, topY, tz, cap, true);
    ring(topY + 1, 1, cap, false);
    put(tx, topY + 1, tz, cap, true);
    for (let y = surf + 1; y <= topY; y++) put(tx, y, tz, BLOCK.MUSHROOM_STEM, false);
  }
}

// ---- chunk fill --------------------------------------------------------------

// biomes that keep their surface material even on steep faces
const SOFT_SURFACE = new Set(['wueste', 'strand', 'badlands', 'ozean', 'see']);
const ROCKY_BIOMES = new Set(['gipfel', 'hochgebirge', 'haenge', 'schneelandschaft', 'schneewald']);

function surfaceBlocks(biome, surf, seed, x, z, slope) {
  // returns [topBlock, topDepth, underBlock, underDepth]
  const hs = hash2(seed ^ 0x5109, x, z);
  if (surf < SEA_LEVEL) {
    if (biome === 'sumpf') return [BLOCK.DIRT, 1, BLOCK.DIRT, 3];
    // Unterwasser: Sand mit Kies-Flecken
    return hs < 0.35 ? [BLOCK.GRAVEL, 3, BLOCK.GRAVEL, 0] : [BLOCK.SAND, 3, BLOCK.SAND, 0];
  }
  // steep faces lose their top layers (no snow/grass draped down cliff walls)
  if (slope >= 3 && !SOFT_SURFACE.has(biome)) {
    if (slope >= 5 || ROCKY_BIOMES.has(biome)) return [BLOCK.STONE, 1, BLOCK.STONE, 0];
    return [BLOCK.DIRT, 1, BLOCK.DIRT, 2];
  }
  switch (biome) {
    case 'strand': case 'wueste': return [BLOCK.SAND, 3, BLOCK.SAND, 0];
    case 'badlands': return [BLOCK.RED_SAND, 2, BLOCK.TERRACOTTA, 14];
    case 'schneelandschaft': case 'schneewald':
      return [BLOCK.SNOWY_GRASS, 1, BLOCK.DIRT, 3];
    case 'gipfel': return [BLOCK.SNOW, 3, BLOCK.STONE, 0];
    case 'hochgebirge': {
      // coherent snowfields (more snow the higher you get) instead of per-column speckle
      const sp = fbm2(noises(seed).rough, x * 0.045, z * 0.045, 2, 2, 0.5) +
        (surf - Y_HOCHGEBIRGE) / 50 - 0.15;
      return sp > 0 ? [BLOCK.SNOW, 1, BLOCK.STONE, 0] : [BLOCK.STONE, 1, BLOCK.STONE, 0];
    }
    case 'haenge':
      return hs < 0.18 ? [BLOCK.GRASS, 1, BLOCK.DIRT, 1] : [BLOCK.STONE, 1, BLOCK.STONE, 0];
    case 'gebirgsfuss':
      return hs < 0.3 ? [BLOCK.STONE, 1, BLOCK.STONE, 0] : [BLOCK.GRASS, 1, BLOCK.DIRT, 2];
    case 'savanne': return [BLOCK.SAVANNA_GRASS, 1, BLOCK.DIRT, 3];
    case 'pilzinsel': return [BLOCK.MYCELIUM, 1, BLOCK.DIRT, 3];
    default: return [BLOCK.GRASS, 1, BLOCK.DIRT, 3];
  }
}

// decoration: [flowerChance, tallGrassChance]
const DECO = {
  blumenwiese: [0.09, 0.4],
  ebene: [0.012, 0.12],
  savanne: [0, 0.3],
  wald: [0.012, 0.06],
  birkenwald: [0.012, 0.06],
  sumpf: [0, 0.18],
  gebirgsfuss: [0, 0.05],
  tannenwald: [0, 0.04],
  dschungel: [0.02, 0.55], // dichter Unterwuchs
};

export function generateChunkData(cx, cz, seed) {
  const n = noises(seed);
  const data = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT); // Block-ids bis 65535
  const ox = cx * CHUNK_SIZE, oz = cz * CHUNK_SIZE;

  // precompute heights/biomes with a 1-block margin so we can measure local slope
  const G = CHUNK_SIZE + 2;
  const H = new Int16Array(G * G);
  const B = new Array(G * G);
  for (let gz = 0; gz < G; gz++) {
    for (let gx = 0; gx < G; gx++) {
      const info = columnInfo(seed, ox + gx - 1, oz + gz - 1);
      H[gz * G + gx] = info.surf;
      B[gz * G + gx] = info.biome;
    }
  }

  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const x = ox + lx, z = oz + lz;
      const gi = (lz + 1) * G + (lx + 1);
      const surf = H[gi];
      const biome = B[gi];
      const slope = Math.max(
        Math.abs(surf - H[gi - 1]), Math.abs(surf - H[gi + 1]),
        Math.abs(surf - H[gi - G]), Math.abs(surf - H[gi + G])
      );
      const [topId, topDepth, underId, underDepth] = surfaceBlocks(biome, surf, seed, x, z, slope);

      data[blockIndex(lx, 0, lz)] = BLOCK.BEDROCK;
      for (let y = 1; y <= surf; y++) {
        let id = BLOCK.STONE;
        const d = surf - y;
        if (d < topDepth) {
          id = topId;
        } else if (d < topDepth + underDepth) {
          id = underId;
          if (biome === 'badlands') {
            // banded terracotta (Mesa-Streifen)
            id = Math.floor(y / 3) % 2 === 0 ? BLOCK.TERRACOTTA : BLOCK.TERRACOTTA_RED;
          }
        }
        // ores only inside stone, in their depth bands (Gold/Diamant nur in der Tiefe)
        // Hohe Rausch-Frequenz (0.22) → viele kleine Adern pro Chunk (~76, Ø ~5
        // Blöcke) statt weniger großer Klumpen. Die Gesamt-Ausbeute bleibt dabei
        // gleich (nur die Verteilung wird feiner); Erz-Typ-Verhältnisse unverändert.
        if (id === BLOCK.STONE && y >= 5 && y <= 145) {
          const v = n.ore(x * 0.22, y * 0.22, z * 0.22);
          if (v > 0.59) id = (y <= 40 && v > 0.67) ? BLOCK.GOLD_ORE : BLOCK.COAL_ORE;
          else if (v < -0.61 && y <= 95) id = (y <= 20 && v < -0.69) ? BLOCK.DIAMOND_ORE : BLOCK.IRON_ORE;
          else if (v > 0.58 && y <= 56) id = BLOCK.FLUX_ORE; // Flux-Erz (droppt Dirty Flux)
        }
        // Edelsteine (eigener Rausch): Smaragd selten, Saphir sehr selten & tief
        if (id === BLOCK.STONE && y >= 5 && y <= 80) {
          const gv = n.ore(x * 0.2 + 51.3, y * 0.2 - 22.7, z * 0.2 + 9.1);
          if (gv < -0.86 && y <= 44) id = BLOCK.SAPPHIRE_ORE;
          else if (gv > 0.72) id = BLOCK.EMERALD_ORE;
        }
        data[blockIndex(lx, y, lz)] = id;
      }
      // water
      for (let y = surf + 1; y <= SEA_LEVEL; y++) {
        data[blockIndex(lx, y, lz)] = BLOCK.WATER;
      }
      // ---- Höhlensystem 2.0 -------------------------------------------------
      const underwaterCol = surf <= SEA_LEVEL + 1;
      // natürliche Eingänge: in Eingangs-Regionen dürfen Höhlen die Oberfläche durchbrechen
      const breach = !underwaterCol && n.entrance(x * 0.008, z * 0.008) > 0.18;
      const caveTopG = breach ? surf + 1 : surf - (underwaterCol ? 10 : 6);

      // Aquifere (unterirdische Wasserspiegel, fleckig) & Lavaseen ganz unten
      const aqRaw = n.aquifer(x * 0.0035, z * 0.0035);
      const aqLevel = aqRaw > 0.1 ? 24 + aqRaw * 40 : -1;
      const lavaLevel = 11 + n.lavaN(x * 0.02, z * 0.02) * 5;

      // Höhlenbiom: normal / Tropfstein / Lush
      const cbv = n.cavebiome(x * 0.004, z * 0.004);
      const caveBiome = cbv < -0.28 ? 'dripstone' : cbv > 0.3 ? 'lush' : 'normal';

      // Pillar Caves: in manchen Regionen bleiben Säulen in großen Kammern stehen
      const pillarSolid = n.pillarReg(x * 0.003, z * 0.003) > 0.2 &&
        n.pillar2(x * 0.045, z * 0.045) > 0.42;

      // Ravines: lange, diagonale Schluchten mit fast senkrechten Wänden;
      // dürfen überall durchbrechen — auch unter dem Ozean
      const rvRaw = n.ravine(x * 0.0025, z * 0.0025);
      const RW = 0.018;
      let ravTop = -1, ravBot = 1e9;
      if (Math.abs(rvRaw) < RW) {
        const rw = 1 - Math.abs(rvRaw) / RW;
        const centerY = 72 + n.ravineY(x * 0.004, z * 0.004) * 68;
        const halfH = 20 + 18 * rw;
        ravBot = Math.max(6, Math.round(centerY - halfH));
        ravTop = Math.round(centerY + halfH);
        if (ravTop > surf - 10) ravTop = surf + 1; // Durchbruch (auch unter Wasser)
      }

      // Vertical Shafts: seltene runde Schächte, verbinden die Ebenen
      const shaftRaw = n.shaft(x * 0.008, z * 0.008);
      const shaftOn = shaftRaw > 0.7;
      const shaftTop = shaftRaw > 0.78 ? surf + 1 : Math.min(surf - 4, 150);

      const carveMax = Math.min(WORLD_HEIGHT - 2,
        Math.max(caveTopG, ravTop, shaftOn ? shaftTop : -1));

      for (let y = 2; y <= carveMax; y++) {
        const idx = blockIndex(lx, y, lz);
        const cur = data[idx];
        if (cur === BLOCK.AIR || cur === BLOCK.WATER || cur === BLOCK.BEDROCK) continue;

        let carved = false;
        if (y <= caveTopG) {
          // Mündungs-Flare: in Eingangs-Regionen weiten sich Höhlen in den obersten
          // ~16 Blöcken zur Oberfläche hin → breite, offene Höhlenmünder statt 1×1-Löcher
          const prox = breach ? Math.max(0, 1 - (surf - y) / 16) : 0;
          // Cheese Caves: große unregelmäßige Kammern (ggf. mit stehenden Säulen);
          // in Eingangs-Regionen dürfen sie bis zur Oberfläche reichen
          const cheeseTop = breach ? caveTopG : surf - 12;
          if (y <= cheeseTop && !pillarSolid) {
            const thr = 0.46 + Math.max(0, (y - 100) * 0.0045) - prox * 0.1;
            if (n.cavern(x * 0.01, y * 0.016, z * 0.01) > thr) carved = true;
          }
          if (!carved) {
            // Spaghetti Caves: schmale, lange, verwinkelte Tunnel
            const c1 = n.cave1(x * 0.06, y * 0.08, z * 0.06);
            const c2 = n.cave2(x * 0.06, y * 0.08, z * 0.06);
            if (c1 * c1 + c2 * c2 < 0.0135 * (1 + 2.2 * prox)) {
              carved = true;
            } else {
              // Noodle Caves: dünner und enger
              const d1 = n.cave1(x * 0.13 + 137.7, y * 0.17, z * 0.13 - 71.3);
              const d2 = n.cave2(x * 0.13 - 55.1, y * 0.17, z * 0.13 + 99.9);
              if (d1 * d1 + d2 * d2 < 0.0036 * (1 + prox)) carved = true;
            }
          }
        }
        if (!carved && ravTop > 0 && y >= ravBot && y <= ravTop) {
          // leicht verjüngt nach unten → steile, fast senkrechte Wände
          const t = (y - ravBot) / Math.max(1, ravTop - ravBot);
          if (Math.abs(rvRaw) < RW * (0.5 + 0.5 * t)) carved = true;
        }
        if (!carved && shaftOn && y >= 9 && y <= shaftTop) carved = true;

        if (carved) {
          data[idx] = y <= lavaLevel ? BLOCK.LAVA
            : (aqLevel > 0 && y <= aqLevel ? BLOCK.WATER : BLOCK.AIR);
        }
      }

      // ---- Höhlen-Dekoration: Boden/Decke (Wandmoos folgt in eigenem Pass) ----
      {
        const decoTop = Math.min(surf - 2, carveMax);
        const support = (id) => id === BLOCK.STONE || id === BLOCK.DIRT || id === BLOCK.COAL_ORE ||
          id === BLOCK.IRON_ORE || id === BLOCK.DRIPSTONE || id === BLOCK.MOSS || id === BLOCK.ROOTED_DIRT;
        for (let y = 3; y <= decoTop; y++) {
          const cur = blockIndex(lx, y, lz);
          if (data[cur] !== BLOCK.AIR) continue;
          const bIdx = blockIndex(lx, y - 1, lz), aIdx = blockIndex(lx, y + 1, lz);
          const floorSolid = support(data[bIdx]);
          const ceilSolid = support(data[aIdx]);
          const h1 = hash2(seed ^ (y * 2654435761), x, z);
          const h2v = hash2(seed ^ (y * 40503 + 977), x, z);
          const h3 = hash2(seed ^ (y * 19349663 + 1013), x, z);

          if (caveBiome === 'dripstone') {
            if (floorSolid) {
              data[bIdx] = BLOCK.DRIPSTONE;
              if (h1 < 0.2) data[cur] = BLOCK.DRIPSTONE; // Stalagmit
            }
            if (ceilSolid && data[cur] === BLOCK.AIR) {
              data[aIdx] = BLOCK.DRIPSTONE;
              if (h2v < 0.2) data[cur] = BLOCK.DRIPSTONE; // Stalaktit
            }
            if (data[cur] === BLOCK.AIR && h3 < 0.006) data[cur] = BLOCK.GLOW_LICHEN; // seltenes Höhlenleuchten
          } else if (caveBiome === 'lush') {
            if (floorSolid) {
              data[bIdx] = BLOCK.MOSS;
              if (h1 < 0.12) data[cur] = BLOCK.TALL_GRASS;
              else if (h1 < 0.16) data[cur] = h2v < 0.5 ? BLOCK.FLOWER_RED : BLOCK.FLOWER_YELLOW;
              else if (h1 < 0.2) data[cur] = BLOCK.GLOW_LICHEN; // leuchtende Flechte am Boden
            }
            if (ceilSolid && data[cur] === BLOCK.AIR) {
              if (h2v < 0.2) { // hängende Höhlenranke
                data[cur] = BLOCK.CAVE_VINE;
                if (h2v < 0.09 && data[bIdx] === BLOCK.AIR) data[bIdx] = BLOCK.CAVE_VINE;
              } else if (h2v < 0.34) { // Wurzeln, die aus Wurzelerde hängen
                data[aIdx] = BLOCK.ROOTED_DIRT;
                data[cur] = BLOCK.HANGING_ROOTS;
                if (h2v < 0.18 && data[bIdx] === BLOCK.AIR) data[bIdx] = BLOCK.HANGING_ROOTS;
              } else if (h2v < 0.4) { // Moos an der Decke, ab und zu leuchtend
                data[aIdx] = BLOCK.MOSS;
                if (h3 < 0.14) data[cur] = BLOCK.GLOW_LICHEN;
              }
            }
          } else { // normal — dezente Deko, damit auch normale Höhlen leben
            if (floorSolid && data[bIdx] === BLOCK.STONE && h1 < 0.02) data[bIdx] = BLOCK.MOSS;
            if (ceilSolid && data[cur] === BLOCK.AIR) {
              if (h2v < 0.014) { data[aIdx] = BLOCK.ROOTED_DIRT; data[cur] = BLOCK.HANGING_ROOTS; }
              else if (h2v < 0.02) data[cur] = BLOCK.COBWEB; // Spinnennetz an der Decke
            }
            if (data[cur] === BLOCK.AIR && h3 < 0.0035) data[cur] = BLOCK.GLOW_LICHEN;
          }
        }
      }
      // decoration (flowers / tall grass) on grassy dry land
      const deco = DECO[biome];
      if (deco && surf > SEA_LEVEL && surf + 1 < WORLD_HEIGHT &&
          data[blockIndex(lx, surf, lz)] === topId && // Oberfläche nicht von Höhle durchbrochen
          data[blockIndex(lx, surf + 1, lz)] === BLOCK.AIR &&
          (topId === BLOCK.GRASS || topId === BLOCK.SAVANNA_GRASS)) {
        const r = hash2(seed ^ 0xf10a, x, z);
        if (r < deco[0]) {
          data[blockIndex(lx, surf + 1, lz)] =
            hash2(seed ^ 0xf10b, x, z) < 0.5 ? BLOCK.FLOWER_RED : BLOCK.FLOWER_YELLOW;
        } else if (r < deco[0] + deco[1]) {
          data[blockIndex(lx, surf + 1, lz)] = BLOCK.TALL_GRASS;
        }
      }
      // Dschungel: dichter Blätter-Unterwuchs (Büsche) auf sonst freiem Boden
      if (biome === 'dschungel' && surf > SEA_LEVEL && surf + 1 < WORLD_HEIGHT &&
          topId === BLOCK.GRASS && data[blockIndex(lx, surf, lz)] === topId &&
          data[blockIndex(lx, surf + 1, lz)] === BLOCK.AIR &&
          hash2(seed ^ 0x9b17, x, z) < 0.35) {
        data[blockIndex(lx, surf + 1, lz)] = BLOCK.JUNGLE_BUSH;
      }
      // Kiesel-Deko an Land: kleine aufsammelbare Steinchen
      if (surf > SEA_LEVEL && surf + 1 < WORLD_HEIGHT &&
          data[blockIndex(lx, surf, lz)] === topId &&
          data[blockIndex(lx, surf + 1, lz)] === BLOCK.AIR &&
          hash2(seed ^ 0xbeb1, x, z) < 0.012) {
        data[blockIndex(lx, surf + 1, lz)] = BLOCK.PEBBLES;
      }
      // Trocken-Biome: dürre Büsche (Savanne/Badlands/Wüste), Kakteen nur in der Wüste
      if ((biome === 'savanne' || biome === 'badlands' || biome === 'wueste') &&
          surf > SEA_LEVEL && surf + 4 < WORLD_HEIGHT &&
          data[blockIndex(lx, surf, lz)] === topId &&
          data[blockIndex(lx, surf + 1, lz)] === BLOCK.AIR) {
        const rd = hash2(seed ^ 0xd3b5, x, z);
        if (rd < 0.035) {
          data[blockIndex(lx, surf + 1, lz)] = BLOCK.SHRUB;
        } else if (biome === 'wueste' && topId === BLOCK.SAND && rd < 0.048) {
          // Kaktus 1–3 hoch, oben mit etwas Glück eine pinke Blüte.
          // Koordinaten-Offsets: hash2 mit nahen Seed-Salts korreliert sonst zu stark
          const kh = 1 + Math.floor(hash2(seed ^ 0xd3b6, x + 421, z + 137) * 3);
          let top = 0;
          for (let i = 1; i <= kh; i++) {
            if (data[blockIndex(lx, surf + i, lz)] !== BLOCK.AIR) break;
            data[blockIndex(lx, surf + i, lz)] = BLOCK.CACTUS;
            top = surf + i;
          }
          if (top > 0 && hash2(seed ^ 0xd3b7, x - 613, z + 977) < 0.35 &&
              data[blockIndex(lx, top + 1, lz)] === BLOCK.AIR) {
            data[blockIndex(lx, top + 1, lz)] = BLOCK.CACTUS_FLOWER;
          }
        }
      }
      // Zuckerrohr wächst am Wasser (Uferblöcke auf Meereshöhe)
      if (surf === SEA_LEVEL && (topId === BLOCK.GRASS || topId === BLOCK.SAND) &&
          hash2(seed ^ 0xca9e, x, z) < 0.22 &&
          data[blockIndex(lx, surf, lz)] === topId) {
        const nahWasser = H[gi - 1] < SEA_LEVEL || H[gi + 1] < SEA_LEVEL ||
          H[gi - G] < SEA_LEVEL || H[gi + G] < SEA_LEVEL;
        if (nahWasser) {
          const ch = 1 + Math.floor(hash2(seed ^ 0xca9f, x, z) * 3);
          for (let i = 1; i <= ch && surf + i < WORLD_HEIGHT; i++) {
            if (data[blockIndex(lx, surf + i, lz)] !== BLOCK.AIR) break;
            data[blockIndex(lx, surf + i, lz)] = BLOCK.SUGAR_CANE;
          }
        }
      }
      // Unterwasser-Flora: üppiges Seegras, dichte Kelp-Wälder in tieferem Wasser
      if (surf < SEA_LEVEL - 1 && data[blockIndex(lx, surf, lz)] !== BLOCK.AIR) {
        const tiefe = SEA_LEVEL - surf;
        const rw = hash2(seed ^ 0x5ea6, x, z);
        if (rw < 0.42 && data[blockIndex(lx, surf + 1, lz)] === BLOCK.WATER) {
          data[blockIndex(lx, surf + 1, lz)] = BLOCK.SEAGRASS;
        } else if (rw < 0.66 && tiefe >= 4) {
          // Kelp-Säule: stark variierende Höhe (1 bis fast zur Oberfläche)
          const hv = hash2(seed ^ 0x5ea7, x, z);
          const kh = 1 + Math.floor(hv * hv * (tiefe - 2)); // quadratisch: viele kurze, wenige lange
          for (let i = 1; i <= kh && surf + i < SEA_LEVEL - 1; i++) {
            if (data[blockIndex(lx, surf + i, lz)] !== BLOCK.WATER) break;
            data[blockIndex(lx, surf + i, lz)] = BLOCK.KELP;
          }
        }
        // Verstreute Kiesel auf dem Meeresboden (wo über dem Grund noch Wasser steht)
        if (data[blockIndex(lx, surf + 1, lz)] === BLOCK.WATER &&
            hash2(seed ^ 0x5eb0, x, z) < 0.05) {
          data[blockIndex(lx, surf + 1, lz)] = BLOCK.PEBBLES_WET;
        }
      }
    }
  }

  // ---- Wandmoos-Pass: in Lush-Höhlen Steinwände neben Luft mit Moos überziehen ----
  // (eigener Durchgang, weil hier alle Nachbarspalten schon gefüllt & ausgehöhlt sind)
  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const x = ox + lx, z = oz + lz;
      if (n.cavebiome(x * 0.004, z * 0.004) <= 0.3) continue; // nur feuchte (Lush-)Höhlen
      const surf = H[(lz + 1) * G + (lx + 1)];
      const top = Math.min(surf - 2, WORLD_HEIGHT - 2);
      for (let y = 3; y <= top; y++) {
        const idx = blockIndex(lx, y, lz);
        const id = data[idx];
        if (id !== BLOCK.STONE && id !== BLOCK.DIRT) continue;
        let wall = false; // Höhlenwand? mindestens ein horizontaler Nachbar (im Chunk) ist Luft
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nlx = lx + dx, nlz = lz + dz;
          if (nlx < 0 || nlx > 15 || nlz < 0 || nlz > 15) continue;
          if (data[blockIndex(nlx, y, nlz)] === BLOCK.AIR) { wall = true; break; }
        }
        if (wall && hash2(seed ^ 0x3055, x * 7 + y, z * 13) < 0.42) data[idx] = BLOCK.MOSS;
      }
    }
  }

  // trees & structures: scan a 2-block margin so nothing gets clipped at chunk borders
  for (let tz = oz - 2; tz <= oz + 17; tz++) {
    for (let tx = ox - 2; tx <= ox + 17; tx++) {
      const t = treeAt(seed, tx, tz);
      if (t) writeTree(data, ox, oz, tx, tz, t);
      const dw = wellAt(seed, tx, tz);
      if (dw) writeWell(data, ox, oz, tx, tz, dw.surf);
      const bo = boulderAt(seed, tx, tz);
      if (bo) writeBoulder(data, ox, oz, tx, tz, bo.surf, bo.r, bo.unterwasser, seed, bo.jungle);
      const pd = pondAt(seed, tx, tz);
      if (pd) writePond(data, ox, oz, tx, tz, pd.surf, seed);
    }
  }
  // Dschungelriesen (dicker 2×2-Stamm, mehrstöckige Krone): Scan mit ±5-Rand
  for (let tz = oz - 5; tz <= oz + 20; tz++) {
    for (let tx = ox - 5; tx <= ox + 20; tx++) {
      const gt = giantJungleAt(seed, tx, tz);
      if (gt) writeGiantJungle(data, ox, oz, tx, tz, gt.surf, gt.h, seed);
    }
  }
  // Tempel (9×9 + Lianen) und Unterwasser-Ruinen (7×7): Scan mit ±5-Rand
  for (let tz = oz - 5; tz <= oz + 20; tz++) {
    for (let tx = ox - 5; tx <= ox + 20; tx++) {
      const tp = templeAt(seed, tx, tz);
      if (tp) writeTemple(data, ox, oz, tx, tz, tp.surf, seed);
      const ru = ruinAt(seed, tx, tz);
      if (ru) writeRuin(data, ox, oz, tx, tz, ru.surf, seed);
      const cr = crimsonRuinAt(seed, tx, tz);
      if (cr) writeCrimsonRuin(data, ox, oz, tx, tz, cr.surf, seed);
    }
  }
  // Magier-Türme streuen Kristall-Formationen bis Radius 9: Scan mit ±9-Rand
  for (let tz = oz - 9; tz <= oz + 24; tz++) {
    for (let tx = ox - 9; tx <= ox + 24; tx++) {
      const tw = towerAt(seed, tx, tz);
      if (tw) writeTower(data, ox, oz, tx, tz, tw.surf, seed);
    }
  }
  // Schiffswracks: bis zu 7 Blöcke lang vom Anker: Scan mit ±7-Rand
  for (let tz = oz - 7; tz <= oz + 22; tz++) {
    for (let tx = ox - 7; tx <= ox + 22; tx++) {
      const wr = wreckAt(seed, tx, tz);
      if (wr) writeWreck(data, ox, oz, tx, tz, wr.surf, wr.gestrandet, seed);
    }
  }
  // Dungeons: Region-basiert — angrenzende Regionen abfragen, Ausschnitt schreiben
  {
    const R = DUNGEON_REGION, W = DUNGEON_REICHWEITE;
    const rx0 = Math.floor((ox - W) / R), rx1 = Math.floor((ox + 15 + W) / R);
    const rz0 = Math.floor((oz - W) / R), rz1 = Math.floor((oz + 15 + W) / R);
    for (let rz = rz0; rz <= rz1; rz++) {
      for (let rx = rx0; rx <= rx1; rx++) {
        const d = dungeonForRegion(seed, rx, rz);
        if (!d) continue;
        if (d.ex + W < ox || d.ex - W > ox + 15 || d.ez + W < oz || d.ez - W > oz + 15) continue;
        writeDungeonPart(data, ox, oz, d, seed);
      }
    }
  }
  // Dörfer: Region-basiert (selten) — angrenzende Regionen abfragen, Gebäude einschreiben
  {
    const R = VILLAGE_REGION, W = VILLAGE_REICHWEITE;
    const rx0 = Math.floor((ox - W) / R), rx1 = Math.floor((ox + 15 + W) / R);
    const rz0 = Math.floor((oz - W) / R), rz1 = Math.floor((oz + 15 + W) / R);
    for (let rz = rz0; rz <= rz1; rz++) {
      for (let rx = rx0; rx <= rx1; rx++) {
        const v = villageForRegion(seed, rx, rz);
        if (v) writeVillage(data, ox, oz, v, seed);
      }
    }
  }
  return data;
}

// ---- Desert Well: seltener kleiner Brunnen, nur in der Wüste -------------------

// Deterministischer Anker-Check pro Spalte (wie treeAt) — sehr seltene Struktur
function wellAt(seed, x, z) {
  if (hash2(seed ^ 0x3e77, x, z) >= 0.00006) return null; // sehr selten: viele Wüsten haben gar keinen
  const { surf, biome } = columnInfo(seed, x, z);
  if (biome !== 'wueste' || surf <= SEA_LEVEL + 1 || surf + 7 >= WORLD_HEIGHT) return null;
  // braucht halbwegs ebenen Boden (Ecken der 5×5-Plattform)
  for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
    if (Math.abs(columnInfo(seed, x + dx, z + dz).surf - surf) > 2) return null;
  }
  return { surf };
}

// Brunnen: 5×5 Sandstein-Plattform, 3×3-Becken mit Wasser, 4 Säulen, 3×3-Dach
function writeWell(data, ox, oz, wx, wz, surf) {
  const put = (x, y, z, id) => {
    const lx = x - ox, lz = z - oz;
    if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || y < 1 || y >= WORLD_HEIGHT) return;
    data[blockIndex(lx, y, lz)] = id;
  };
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      put(wx + dx, surf - 1, wz + dz, BLOCK.SANDSTONE); // Fundament
      put(wx + dx, surf, wz + dz, BLOCK.SANDSTONE);     // Plattform
      for (let dy = 1; dy <= 6; dy++) put(wx + dx, surf + dy, wz + dz, BLOCK.AIR);
    }
  }
  // Becken-Ring mit Wasserquelle in der Mitte (rundum dicht — bleibt stabil)
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      put(wx + dx, surf + 1, wz + dz, dx === 0 && dz === 0 ? BLOCK.WATER : BLOCK.SANDSTONE);
    }
  }
  for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    put(wx + cx, surf + 2, wz + cz, BLOCK.SANDSTONE); // Ecksäulen
    put(wx + cx, surf + 3, wz + cz, BLOCK.SANDSTONE);
  }
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      put(wx + dx, surf + 4, wz + dz, BLOCK.SANDSTONE); // Dach
    }
  }
}

// ---- Blutrote Ruine: seltene Badlands-Struktur mit Boss (Blutroter Zombie) ------

// Deterministischer Anker: sehr selten, nur in den Badlands, lokales Minimum in ±12
function crimsonRuinAt(seed, x, z) {
  const eigen = hash2(seed ^ 0x9c3d, x, z);
  if (eigen >= 0.00003) return null;
  for (let dx = -12; dx <= 12; dx++) {
    for (let dz = -12; dz <= 12; dz++) {
      if ((dx || dz) && hash2(seed ^ 0x9c3d, x + dx, z + dz) < eigen) return null;
    }
  }
  const { surf, biome } = columnInfo(seed, x, z);
  if (biome !== 'badlands' || surf <= SEA_LEVEL + 1 || surf + 8 >= WORLD_HEIGHT) return null;
  // halbwegs ebener Boden (Ecken der 9×9-Grundfläche)
  for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) {
    if (Math.abs(columnInfo(seed, x + dx, z + dz).surf - surf) > 2) return null;
  }
  return { surf };
}

// Verfallene 9×9-Kammer aus Ziegeln/Terrakotta mit Blutkern-Altar in der Mitte.
// Der Blutkern beschwört bei Annäherung den Boss (siehe blocks._checkBossSpawn).
function writeCrimsonRuin(data, ox, oz, wx, wz, surf, seed) {
  const put = (x, y, z, id) => {
    const lx = x - ox, lz = z - oz;
    if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || y < 1 || y >= WORLD_HEIGHT) return;
    data[blockIndex(lx, y, lz)] = id;
  };
  const R = 4;
  // Boden (Schachbrett) + Innenraum ausräumen
  for (let dx = -R; dx <= R; dx++) {
    for (let dz = -R; dz <= R; dz++) {
      put(wx + dx, surf, wz + dz, (dx + dz) & 1 ? BLOCK.TERRACOTTA_RED : BLOCK.TERRACOTTA);
      for (let dy = 1; dy <= 5; dy++) put(wx + dx, surf + dy, wz + dz, BLOCK.AIR);
    }
  }
  // verfallene Mauern (Höhe 4) mit Rissen, Löchern und einem Eingang in der Südwand
  for (let dx = -R; dx <= R; dx++) {
    for (let dz = -R; dz <= R; dz++) {
      if (Math.abs(dx) !== R && Math.abs(dz) !== R) continue;
      for (let dy = 1; dy <= 4; dy++) {
        if (dz === -R && Math.abs(dx) <= 1 && dy <= 3) continue; // Eingang
        const h = hash2(seed ^ 0x5b0b, wx + dx * 7 + dy, wz + dz * 7);
        if (dy === 4 && h < 0.5) continue;   // bröckelnde Krone
        if (dy < 4 && h < 0.08) continue;    // vereinzelte Löcher
        const id = h < 0.35 ? BLOCK.CRACKED_STONE_BRICKS : (h < 0.7 ? BLOCK.STONE_BRICKS : BLOCK.TERRACOTTA);
        put(wx + dx, surf + dy, wz + dz, id);
      }
    }
  }
  // Ecksäulen etwas höher
  for (const [cx, cz] of [[-R, -R], [R, -R], [-R, R], [R, R]]) {
    for (let dy = 1; dy <= 5; dy++) put(wx + cx, surf + dy, wz + cz, BLOCK.STONE_BRICKS);
  }
  // Altar (3×3 erhöht) mit Blutkern obenauf
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) put(wx + dx, surf + 1, wz + dz, BLOCK.TERRACOTTA_RED);
  put(wx, surf + 2, wz, BLOCK.BOSS_SPAWNER);
}

// ---- Dschungel-Tempel: seltene überwucherte Ruine mit Ereignis-Truhe -----------

function templeAt(seed, x, z) {
  const eigen = hash2(seed ^ 0x7e41, x, z);
  if (eigen >= 0.0005) return null;
  for (let dx = -12; dx <= 12; dx++) {
    for (let dz = -12; dz <= 12; dz++) {
      if ((dx || dz) && hash2(seed ^ 0x7e41, x + dx, z + dz) < eigen) return null;
    }
  }
  const { surf, biome } = columnInfo(seed, x, z);
  if (biome !== 'dschungel' || surf <= SEA_LEVEL + 1 || surf + 10 >= WORLD_HEIGHT) return null;
  for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) {
    if (Math.abs(columnInfo(seed, x + dx, z + dz).surf - surf) > 3) return null;
  }
  return { surf };
}

// 9×9-Tempel: Steinziegel-Mix (normal/bemoost/rissig), Eingang im Süden,
// zweistufiges Dach, Lianen an den Außenwänden, Ereignis-Truhe in der Mitte
function writeTemple(data, ox, oz, wx, wz, surf, seed) {
  const put = (x, y, z, id) => {
    const lx = x - ox, lz = z - oz;
    if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || y < 1 || y >= WORLD_HEIGHT) return;
    data[blockIndex(lx, y, lz)] = id;
  };
  const brick = (x, y, z) => {
    const r = hash2(seed ^ 0x8b1c, x * 7 + y * 131, z * 13 - y * 57);
    return r < 0.55 ? BLOCK.STONE_BRICKS : r < 0.8 ? BLOCK.MOSSY_STONE_BRICKS : BLOCK.CRACKED_STONE_BRICKS;
  };
  // Fundament + Boden 9×9, Innenraum & Umfeld über dem Boden freiräumen
  for (let dx = -4; dx <= 4; dx++) {
    for (let dz = -4; dz <= 4; dz++) {
      put(wx + dx, surf - 1, wz + dz, brick(wx + dx, surf - 1, wz + dz));
      put(wx + dx, surf, wz + dz, brick(wx + dx, surf, wz + dz));
      for (let dy = 1; dy <= 8; dy++) put(wx + dx, surf + dy, wz + dz, BLOCK.AIR);
    }
  }
  // Wände Ebene 1 (y+1..+3), Eingang Süden (dz=+4, dx −1..1)
  for (let dy = 1; dy <= 3; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -4; dz <= 4; dz++) {
        if (Math.abs(dx) !== 4 && Math.abs(dz) !== 4) continue;
        if (dz === 4 && Math.abs(dx) <= 1 && dy <= 2) continue; // Eingang
        put(wx + dx, surf + dy, wz + dz, brick(wx + dx, surf + dy, wz + dz));
      }
    }
  }
  // Dach Ebene 1 (9×9) + Aufsatz 5×5 (y+5) + Deckel 3×3 (y+6)
  for (let dx = -4; dx <= 4; dx++) {
    for (let dz = -4; dz <= 4; dz++) {
      put(wx + dx, surf + 4, wz + dz, brick(wx + dx, surf + 4, wz + dz));
    }
  }
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (Math.abs(dx) === 2 || Math.abs(dz) === 2) {
        put(wx + dx, surf + 5, wz + dz, brick(wx + dx, surf + 5, wz + dz));
      }
    }
  }
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      put(wx + dx, surf + 6, wz + dz, brick(wx + dx, surf + 6, wz + dz));
    }
  }
  // Ereignis-Truhe in der Tempelmitte
  put(wx, surf + 1, wz, BLOCK.LOOT_CHEST);
  // Lianen-Bewuchs an den Außenwänden (nur in Luftzellen)
  for (let dy = 1; dy <= 4; dy++) {
    for (const [dx, dz] of [[-5, 0], [5, 0], [0, -5], [-5, -2], [5, 2], [2, -5], [-2, -5], [3, 5], [-3, 5]]) {
      if (hash2(seed ^ 0x9f2e, wx + dx + dy * 17, wz + dz) < 0.5) {
        const lx = wx + dx - ox, lz = wz + dz - oz;
        if (lx >= 0 && lx <= 15 && lz >= 0 && lz <= 15) {
          const i = blockIndex(lx, surf + dy, lz);
          if (data[i] === BLOCK.AIR) data[i] = BLOCK.VINE;
        }
      }
    }
  }
}

// ---- Magier-Turm: Aussichtsturm mit 4 Stockwerken, Kristallfenstern & Truhen ---

function towerAt(seed, x, z) {
  const eigen = hash2(seed ^ 0x70a3, x, z);
  if (eigen >= 0.00004) return null; // selten: ~1 pro 160×160
  // Dedupe: gewinnt nur der kleinste Hash im 12er-Umkreis (verhindert Turm-Zwillinge)
  for (let dx = -12; dx <= 12; dx++) {
    for (let dz = -12; dz <= 12; dz++) {
      if (dx === 0 && dz === 0) continue;
      const andere = hash2(seed ^ 0x70a3, x + dx, z + dz);
      if (andere < eigen) return null;
    }
  }
  const { surf, biome } = columnInfo(seed, x, z);
  if ((biome !== 'ebene' && biome !== 'wald') || surf <= SEA_LEVEL + 1 || surf + 22 >= WORLD_HEIGHT) return null;
  for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
    if (Math.abs(columnInfo(seed, x + dx, z + dz).surf - surf) > 3) return null;
  }
  return { surf };
}

const CRYSTAL_IDS = [BLOCK.CRYSTAL_BLUE, BLOCK.CRYSTAL_PURPLE, BLOCK.CRYSTAL_GREEN, BLOCK.CRYSTAL_ORANGE];

function writeTower(data, ox, oz, wx, wz, surf, seed) {
  const put = (x, y, z, id) => {
    const lx = x - ox, lz = z - oz;
    if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || y < 1 || y >= WORLD_HEIGHT) return;
    data[blockIndex(lx, y, lz)] = id;
  };
  const brick = (x, y, z) => {
    const r = hash2(seed ^ 0x70b7, x * 7 + y * 131, z * 13 - y * 57);
    return r < 0.8 ? BLOCK.STONE_BRICKS : r < 0.92 ? BLOCK.MOSSY_STONE_BRICKS : BLOCK.CRACKED_STONE_BRICKS;
  };
  const wand = (dx, dz) => (Math.abs(dx) === 3 || Math.abs(dz) === 3) && !(Math.abs(dx) === 3 && Math.abs(dz) === 3);
  // Fundament + Freiraum
  for (let dx = -3; dx <= 3; dx++) {
    for (let dz = -3; dz <= 3; dz++) {
      if (Math.abs(dx) === 3 && Math.abs(dz) === 3) continue; // Oktogon: Ecken kappen
      put(wx + dx, surf - 1, wz + dz, brick(wx + dx, surf - 1, wz + dz));
      put(wx + dx, surf, wz + dz, brick(wx + dx, surf, wz + dz));
      for (let dy = 1; dy <= 18; dy++) put(wx + dx, surf + dy, wz + dz, BLOCK.AIR);
    }
  }
  // 4 Stockwerke: Wände y+1..+16, Zwischenböden bei +4/+8/+12 (mit Leiterloch), Dach +16
  for (let dy = 1; dy <= 15; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        if (!wand(dx, dz)) continue;
        if (dz === 3 && Math.abs(dx) <= 0 && dy <= 2) continue; // Tür Süden (1×2)
        put(wx + dx, surf + dy, wz + dz, brick(wx + dx, surf + dy, wz + dz));
      }
    }
  }
  // Kristallfenster: pro Stockwerk auf 3 Seiten — die Ostwand bleibt massiv,
  // dort hängt die Leiter (Leitern brauchen durchgehend soliden Halt!)
  const towerColor = CRYSTAL_IDS[Math.floor(hash2(seed ^ 0x70c1, wx, wz) * 4)];
  for (let etage = 0; etage < 4; etage++) {
    const fy = surf + 2 + etage * 4;
    for (const [fx, fz] of [[-3, 0], [0, 3], [0, -3]]) {
      if (etage === 0 && fz === 3) continue; // Tür nicht überschreiben
      put(wx + fx, fy, wz + fz, towerColor);
      put(wx + fx, fy + 1, wz + fz, towerColor);
    }
  }
  // Zwischenböden mit Leiterloch bei (wx+2, wz) + Leiter an der Ostwand
  for (const fy of [surf + 4, surf + 8, surf + 12]) {
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (dx === 2 && dz === 0) continue; // Leiterloch
        put(wx + dx, fy, wz + dz, BLOCK.PLANKS);
      }
    }
  }
  for (let dy = 1; dy <= 15; dy++) put(wx + 2, surf + dy, wz, BLOCK.LADDER);
  // Dach (voll) + Zinnen + Kristallspitze
  for (let dx = -3; dx <= 3; dx++) {
    for (let dz = -3; dz <= 3; dz++) {
      if (Math.abs(dx) === 3 && Math.abs(dz) === 3) continue;
      if (dx === 2 && dz === 0) continue; // Ausstieg aufs Dach
      put(wx + dx, surf + 16, wz + dz, brick(wx + dx, surf + 16, wz + dz));
    }
  }
  for (let dx = -3; dx <= 3; dx++) {
    for (let dz = -3; dz <= 3; dz++) {
      if (!wand(dx, dz)) continue;
      if ((dx + dz + 100) % 2 === 0) put(wx + dx, surf + 17, wz + dz, brick(wx + dx, surf + 17, wz + dz));
    }
  }
  put(wx, surf + 17, wz, towerColor); // leuchtende Spitze in der Dachmitte
  // Truhen: pro Stockwerk 15% Chance (Nordwest-Ecke des Innenraums)
  for (let etage = 0; etage < 4; etage++) {
    if (hash2(seed ^ 0x70d9, wx + etage * 53, wz - etage * 91) < 0.15) {
      put(wx - 2, surf + 1 + etage * 4, wz - 2, BLOCK.TOWER_CHEST);
    }
  }
  // Kristall-Formationen rund um den Turm (Radius 4–8): Hauptzacke 2–3 hoch
  // mit 2–3 kleineren Seitenzacken — sieht nach gewachsenem Kristall aus
  const spitze = (bx, bz, höhe, farbe) => {
    const lx = bx - ox, lz = bz - oz;
    if (lx < 0 || lx > 15 || lz < 0 || lz > 15) return;
    for (let y = surf + 5; y > surf - 6 && y > 1; y--) {
      const unten = data[blockIndex(lx, y - 1, lz)];
      const hier = data[blockIndex(lx, y, lz)];
      if (hier === BLOCK.AIR && unten !== BLOCK.AIR && unten !== BLOCK.WATER &&
          !BLOCKS[unten]?.cross && unten !== BLOCK.LADDER && !BLOCKS[unten]?.crystal) {
        for (let i = 0; i < höhe && y + i < WORLD_HEIGHT; i++) {
          if (data[blockIndex(lx, y + i, lz)] !== BLOCK.AIR) break;
          data[blockIndex(lx, y + i, lz)] = farbe;
        }
        return;
      }
    }
  };
  for (let dx = -8; dx <= 8; dx++) {
    for (let dz = -8; dz <= 8; dz++) {
      const d = Math.max(Math.abs(dx), Math.abs(dz));
      if (d < 4 || d > 8) continue;
      if (hash2(seed ^ 0x70e5, wx + dx, wz + dz) >= 0.012) continue;
      const farbe = CRYSTAL_IDS[Math.floor(hash2(seed ^ 0x70f1, wx + dx, wz + dz) * 4)];
      const hh = hash2(seed ^ 0x70f7, wx + dx, wz + dz);
      spitze(wx + dx, wz + dz, 2 + Math.floor(hh * 2), farbe);       // Hauptzacke 2–3
      const seiten = [[1, 0], [0, 1], [-1, 0], [0, -1]];
      for (let k = 0; k < 4; k++) {
        if (hash2(seed ^ 0x70fd + k, wx + dx, wz + dz) < 0.65) {
          spitze(wx + dx + seiten[k][0], wz + dz + seiten[k][1],
            1 + Math.floor(hash2(seed ^ 0x7103 + k, wx + dx, wz + dz) * 2), farbe);
        }
      }
    }
  }
}

// ---- Felsbrocken: verstreute Steine als Deko (an Land und unter Wasser) --------

function boulderAt(seed, x, z) {
  const h = hash2(seed ^ 0xb0d4, x, z);
  if (h >= 0.004) return null;                    // cheap reject bei der Dschungel-Rate
  const { surf, biome } = columnInfo(seed, x, z);
  const jungle = biome === 'dschungel';
  if (!jungle && h >= 0.0009) return null;         // außerhalb Dschungel wieder selten
  if (surf < 40 || surf + 6 >= WORLD_HEIGHT) return null;
  const unterwasser = surf < SEA_LEVEL - 2;
  if (!unterwasser && (biome === 'wueste' || biome === 'badlands' || biome === 'strand')) return null;
  // groß (Radius 2, mehrblöckig) oder klein (Radius 1 / Einzelstein) — im Dschungel öfter groß
  const groß = hash2(seed ^ 0xb0e5, x, z) < (jungle ? 0.6 : 0.35);
  return { surf, unterwasser, r: groß ? 2 : 1, jungle };
}

const BOULDER_MIX_WASSER = [BLOCK.STONE, BLOCK.MOSSY_COBBLESTONE, BLOCK.COBBLESTONE, BLOCK.MOSSY_COBBLESTONE];
const BOULDER_MIX_LAND = [BLOCK.STONE, BLOCK.STONE, BLOCK.COBBLESTONE, BLOCK.MOSSY_COBBLESTONE];
const BOULDER_MIX_JUNGLE = [BLOCK.MOSSY_COBBLESTONE, BLOCK.MOSSY_COBBLESTONE, BLOCK.MOSS, BLOCK.COBBLESTONE];

function writeBoulder(data, ox, oz, bx, bz, surf, r, unterwasser, seed, jungle) {
  const mix = jungle ? BOULDER_MIX_JUNGLE : unterwasser ? BOULDER_MIX_WASSER : BOULDER_MIX_LAND;
  const cy = surf + r; // ragt sichtbar auf, Basis bleibt im Boden verankert
  for (let dy = -r; dy <= r; dy++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const jitter = (hash2(seed ^ 0xb0f6, bx * 7 + dx * 31 + dy * 131, bz * 13 + dz * 57) - 0.5) * 1.4;
        if (dx * dx + dy * dy + dz * dz + jitter > r * r) continue;
        const lx = bx + dx - ox, lz = bz + dz - oz;
        if (lx < 0 || lx > 15 || lz < 0 || lz > 15) continue;
        const y = cy + dy;
        if (y < 1 || y >= WORLD_HEIGHT) continue;
        const m = mix[Math.floor(hash2(seed ^ 0xb107, bx + dx * 3, bz + dz * 5 + dy * 17) * mix.length)];
        data[blockIndex(lx, y, lz)] = m;
      }
    }
  }
}

// ---- Dschungel-Tümpel: kleine Wasserlöcher im Urwaldboden ----------------------

function pondAt(seed, x, z) {
  const h = hash2(seed ^ 0x70dd, x, z);
  if (h >= 0.0016) return null;                   // cheap reject: selten
  const { surf, biome } = columnInfo(seed, x, z);
  if (biome !== 'dschungel' || surf <= SEA_LEVEL || surf + 3 >= WORLD_HEIGHT) return null;
  // Umland darf nicht tiefer liegen (sonst läuft das Wasser aus) und muss flach sein
  for (const [dx, dz] of [[-2, 0], [2, 0], [0, -2], [0, 2], [-2, -2], [2, 2]]) {
    const s2 = columnInfo(seed, x + dx, z + dz).surf;
    if (s2 < surf || s2 - surf > 1) return null;
  }
  return { surf };
}

function writePond(data, ox, oz, px, pz, surf, seed) {
  const R = 2;
  for (let dz = -R; dz <= R; dz++) {
    for (let dx = -R; dx <= R; dx++) {
      const jitter = (hash2(seed ^ 0x70ee, px + dx * 31, pz + dz * 57) - 0.5) * 1.2;
      const d2 = dx * dx + dz * dz + jitter;
      if (d2 > R * R) continue;
      const lx = px + dx - ox, lz = pz + dz - oz;
      if (lx < 0 || lx > 15 || lz < 0 || lz > 15) continue;
      const depth = d2 < 1.2 ? 2 : 1;             // Mitte etwas tiefer
      // Wasser bis Oberflächenhöhe, Boden aus Moos/Erde, Deko darüber entfernen
      for (let y = surf - depth + 1; y <= surf; y++) data[blockIndex(lx, y, lz)] = BLOCK.WATER;
      data[blockIndex(lx, surf - depth, lz)] =
        hash2(seed ^ 0x70ff, px + dx, pz + dz) < 0.5 ? BLOCK.MOSS : BLOCK.DIRT;
      for (let y = surf + 1; y <= surf + 2 && y < WORLD_HEIGHT; y++) data[blockIndex(lx, y, lz)] = BLOCK.AIR;
    }
  }
}

// ---- Dschungelriese: dicker 2×2-Stamm, mehrstöckige Krone, Lianen --------------

function giantJungleAt(seed, x, z) {
  const eigen = hash2(seed ^ 0x9a17, x, z);
  if (eigen >= 0.0018) return null;               // cheap reject: sehr selten
  // lokaler Ausschluss (±3) → keine zwei Riesen dicht beieinander
  for (let dx = -3; dx <= 3; dx++) {
    for (let dz = -3; dz <= 3; dz++) {
      if ((dx || dz) && hash2(seed ^ 0x9a17, x + dx, z + dz) < eigen) return null;
    }
  }
  const { surf, biome } = columnInfo(seed, x, z);
  if (biome !== 'dschungel' || surf <= SEA_LEVEL || surf + 24 >= WORLD_HEIGHT) return null;
  // 2×2-Fußabdruck braucht halbwegs ebenen Boden
  for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    if (Math.abs(columnInfo(seed, x + dx, z + dz).surf - surf) > 1) return null;
  }
  const h = 13 + Math.floor(hash2(seed ^ 0x9a29, x, z) * 8); // 13–20 hoch
  return { surf, h };
}

function writeGiantJungle(data, ox, oz, tx, tz, surf, h, seed) {
  const topY = surf + h;
  const put = (wx, wy, wz, id, onlyAir) => {
    const lx = wx - ox, lz = wz - oz;
    if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || wy < 0 || wy >= WORLD_HEIGHT) return;
    const i = blockIndex(lx, wy, lz);
    if (onlyAir && data[i] !== BLOCK.AIR) return;
    data[i] = id;
  };
  // gefüllte Laubscheibe um die 2×2-Stammmitte (Zellenmitte-Offset = dx-0.5)
  const disk = (y, r) => {
    for (let dx = -r; dx <= r + 1; dx++) {
      for (let dz = -r; dz <= r + 1; dz++) {
        const ex = dx - 0.5, ez = dz - 0.5;
        const d2 = ex * ex + ez * ez;
        if (d2 > (r + 0.5) * (r + 0.5)) continue;
        // Ränder leicht ausfransen
        if (d2 > (r - 0.3) * (r - 0.3) && hash2(seed ^ 0x9a3b, tx + dx * 7, tz + dz * 13 + y) < 0.4) continue;
        put(tx + dx, y, tz + dz, BLOCK.LEAVES, true);
      }
    }
  };
  // 2×2-Stamm
  for (let y = surf + 1; y <= topY; y++) {
    for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) put(tx + dx, y, tz + dz, BLOCK.JUNGLE_LOG, false);
  }
  // obere Hauptkrone: mehrere Stockwerke
  disk(topY + 1, 1);
  disk(topY, 3);
  disk(topY - 1, 3);
  disk(topY - 2, 2);
  // Zwischenkronen (mehrstöckig) — machen den Baum voluminöser
  const mid1 = surf + Math.floor(h * 0.55);
  disk(mid1, 2); disk(mid1 - 1, 1);
  const mid2 = surf + Math.floor(h * 0.78);
  disk(mid2, 2);
  // Lianen hängen von den Kronenrändern herab
  for (const [vx, vz] of [[-3, 0], [4, 0], [0, -3], [0, 4], [-2, -2], [3, 3], [-2, 3], [3, -2]]) {
    const vh = 3 + Math.floor(hash2(seed ^ 0x9a4d, tx + vx * 3, tz + vz * 5) * 6);
    for (let i = 0; i < vh; i++) put(tx + vx, topY - 1 - i, tz + vz, BLOCK.VINE, true);
  }
}

// ---- Unterwasser-Ruine: eingestürzte Steinziegel-Reste, selten mit Truhe --------

function ruinAt(seed, x, z) {
  const eigen = hash2(seed ^ 0x2e17, x, z);
  if (eigen >= 0.00002) return null;
  for (let dx = -12; dx <= 12; dx++) {
    for (let dz = -12; dz <= 12; dz++) {
      if ((dx || dz) && hash2(seed ^ 0x2e17, x + dx, z + dz) < eigen) return null;
    }
  }
  const { surf, biome } = columnInfo(seed, x, z);
  if ((biome !== 'ozean' && biome !== 'see') || SEA_LEVEL - surf < 5) return null;
  for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
    if (Math.abs(columnInfo(seed, x + dx, z + dz).surf - surf) > 2) return null;
  }
  return { surf };
}

function writeRuin(data, ox, oz, wx, wz, surf, seed) {
  const put = (x, y, z, id) => {
    const lx = x - ox, lz = z - oz;
    if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || y < 1 || y >= WORLD_HEIGHT) return;
    data[blockIndex(lx, y, lz)] = id;
  };
  // stark verwitterter Ziegel-Mix
  const brick = (x, y, z) => {
    const r = hash2(seed ^ 0x2e28, x * 7 + y * 131, z * 13 - y * 57);
    return r < 0.4 ? BLOCK.MOSSY_STONE_BRICKS : r < 0.68 ? BLOCK.STONE_BRICKS : BLOCK.CRACKED_STONE_BRICKS;
  };
  // 7×7-Grundriss: lückenhafter Boden + eingestürzter Mauerring
  for (let dx = -3; dx <= 3; dx++) {
    for (let dz = -3; dz <= 3; dz++) {
      const rr = hash2(seed ^ 0x2e39, wx + dx, wz + dz);
      if (rr < 0.6) put(wx + dx, surf, wz + dz, brick(wx + dx, surf, wz + dz));
      if (Math.abs(dx) === 3 || Math.abs(dz) === 3) {
        const h = Math.floor(hash2(seed ^ 0x2e4a, wx + dx * 5, wz + dz * 3) * 4); // 0–3 hoch
        for (let dy = 1; dy <= h; dy++) {
          put(wx + dx, surf + dy, wz + dz, brick(wx + dx, surf + dy, wz + dz));
        }
      }
    }
  }
  // zerbrochene Mittelsäule + Truhen-Chance
  const sh = 1 + Math.floor(hash2(seed ^ 0x2e5b, wx, wz) * 3);
  for (let dy = 1; dy <= sh; dy++) put(wx - 1, surf + dy, wz - 1, brick(wx - 1, surf + dy, wz - 1));
  if (hash2(seed ^ 0x2e6c, wx, wz) < 0.4) {
    put(wx, surf + 1, wz, BLOCK.WRECK_CHEST);
  }
}

// ---- Schiffswrack: versunken im Ozean, manchmal auch am Strand gestrandet ------

function wreckAt(seed, x, z) {
  const eigen = hash2(seed ^ 0x5a1b, x, z);
  if (eigen >= 0.00002) return null; // deutlich seltener
  // Dedupe: nur der kleinste Hash im 16er-Umkreis baut
  for (let dx = -16; dx <= 16; dx++) {
    for (let dz = -16; dz <= 16; dz++) {
      if ((dx || dz) && hash2(seed ^ 0x5a1b, x + dx, z + dz) < eigen) return null;
    }
  }
  const { surf, biome } = columnInfo(seed, x, z);
  if (biome !== 'ozean' && biome !== 'strand') return null;
  if (surf < 60 || surf + 12 >= WORLD_HEIGHT) return null;
  if (biome === 'ozean' && surf > SEA_LEVEL - 4) return null; // braucht etwas Wassertiefe
  return { surf, gestrandet: biome === 'strand' };
}

// Rumpf ~13 lang, 5 breit: Kiel, Bordwände, löchriges Deck, Maststumpf,
// 2 Schiffstruhen; im Ozean ist der Innenraum geflutet
function writeWreck(data, ox, oz, wx, wz, surf, gestrandet, seed) {
  const langsX = hash2(seed ^ 0x5a2c, wx, wz) < 0.5; // Ausrichtung
  const put = (dl, dw, dy, id, nurLuftWasser = false) => {
    const x = wx + (langsX ? dl : dw), z = wz + (langsX ? dw : dl);
    const lx = x - ox, lz = z - oz;
    if (lx < 0 || lx > 15 || lz < 0 || lz > 15) return;
    const y = surf + dy;
    if (y < 1 || y >= WORLD_HEIGHT) return;
    const i = blockIndex(lx, y, lz);
    if (nurLuftWasser && data[i] !== BLOCK.AIR && data[i] !== BLOCK.WATER) return;
    data[i] = id;
  };
  const kaputt = (salz) => hash2(seed ^ 0x5a3d, wx * 13 + salz, wz * 7 - salz) < 0.16;
  const füllung = gestrandet ? BLOCK.AIR : BLOCK.WATER;
  for (let dl = -6; dl <= 6; dl++) {
    // Rumpfbreite: Bug und Heck laufen spitz zu
    const halbe = Math.abs(dl) >= 6 ? 0 : Math.abs(dl) >= 4 ? 1 : 2;
    for (let dw = -halbe; dw <= halbe; dw++) {
      put(dl, dw, 0, BLOCK.PLANKS); // Kiel/Boden
      if (Math.abs(dw) === halbe && halbe > 0) {
        // Bordwände (mit Wrack-Löchern)
        if (!kaputt(dl * 31 + dw * 7 + 1)) put(dl, dw, 1, BLOCK.PLANKS);
        if (!kaputt(dl * 31 + dw * 7 + 2)) put(dl, dw, 2, BLOCK.PLANKS);
      } else {
        // Innenraum: geflutet (Ozean) oder offen (Strand)
        put(dl, dw, 1, füllung);
        put(dl, dw, 2, füllung);
      }
    }
    // Deck über der Mitte, teilweise eingebrochen
    if (Math.abs(dl) <= 3) {
      for (let dw = -1; dw <= 1; dw++) {
        if (!kaputt(dl * 17 + dw * 5)) put(dl, dw, 3, BLOCK.PLANKS);
      }
    }
  }
  // Maststumpf (abgebrochen)
  for (let dy = 1; dy <= 4; dy++) put(0, 0, dy, BLOCK.LOG);
  // 2 Schiffstruhen: Bug und Heck, im Rumpf
  put(-4, 0, 1, BLOCK.WRECK_CHEST);
  put(4, 0, 1, BLOCK.WRECK_CHEST);
}

// ---- Prozedurale Dungeons (Roguelike-Stil) --------------------------------------
// Pro 192×192-Region würfelt ein geseedeter RNG deterministisch ein komplettes
// Layout (2–4 Ebenen, Räume + L-Korridore + Leiterschächte). Jeder Chunk fragt die
// angrenzenden Regionen ab und schreibt nur die Zellen, die in ihn fallen.

const DUNGEON_REGION = 192;
const DUNGEON_REICHWEITE = 34; // maximale Ausdehnung vom Anker (28 + Raumhälfte + Schale)
const dungeonCache = new Map();

export function dungeonForRegion(seed, rx, rz) {
  const key = seed + ':' + rx + ':' + rz;
  if (dungeonCache.has(key)) return dungeonCache.get(key);
  let d = null;
  if (hash2(seed ^ 0xd07e, rx * 7919, rz * 104729) < 0.55) {
    const rng = mulberry32((seed ^ Math.imul(rx, 341873128) ^ Math.imul(rz, 132897987)) | 0);
    // bis zu 8 Kandidaten-Positionen: die erste mit flachem Land-Umfeld gewinnt
    for (let versuch = 0; versuch < 8 && !d; versuch++) {
      const ex = rx * DUNGEON_REGION + 44 + Math.floor(rng() * (DUNGEON_REGION - 88));
      const ez = rz * DUNGEON_REGION + 44 + Math.floor(rng() * (DUNGEON_REGION - 88));
      const info = columnInfo(seed, ex, ez);
      if (info.surf <= SEA_LEVEL + 1 || info.surf + 8 >= WORLD_HEIGHT ||
          info.biome === 'ozean' || info.biome === 'see') continue;
      let flach = true;
      for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
        if (Math.abs(columnInfo(seed, ex + dx, ez + dz).surf - info.surf) > 2) { flach = false; break; }
      }
      if (!flach) continue;
      d = buildDungeonLayout(ex, ez, info.surf, rng);
    }
  }
  if (dungeonCache.size > 64) dungeonCache.clear(); // simpel begrenzen
  dungeonCache.set(key, d);
  return d;
}

function buildDungeonLayout(ex, ez, surf, rng) {
  const floors = [];
  const floorCount = 2 + Math.floor(rng() * 3); // 2–4 Ebenen
  let cx = ex, cz = ez; // Ankunftspunkt der Leiter auf jeder Ebene
  for (let k = 0; k < floorCount; k++) {
    const y = surf - 11 - k * 9; // Raum-Bodenhöhe der Ebene
    if (y < 14) break;
    const mkRoom = (rcx, rcz) => ({
      cx: rcx, cz: rcz,
      hw: 2 + Math.floor(rng() * 3), // halbe Ausdehnung 2–4 → Räume 5–9 breit
      hd: 2 + Math.floor(rng() * 3),
    });
    const rooms = [mkRoom(cx, cz)];
    const corridors = [];
    const roomCount = 5 + Math.floor(rng() * 5); // 5–9 Räume
    let prev = rooms[0];
    for (let i = 1; i < roomCount; i++) {
      const dir = Math.floor(rng() * 4);
      const dist = 11 + Math.floor(rng() * 9);
      let qx = prev.cx + (dir === 0 ? dist : dir === 1 ? -dist : 0);
      let qz = prev.cz + (dir === 2 ? dist : dir === 3 ? -dist : 0);
      qx = Math.max(ex - 28, Math.min(ex + 28, qx));
      qz = Math.max(ez - 28, Math.min(ez + 28, qz));
      const room = mkRoom(qx, qz);
      rooms.push(room);
      corridors.push({ ax: prev.cx, az: prev.cz, bx: qx, bz: qz });
      // Verzweigung: manchmal zweigt der nächste Korridor von einem älteren Raum ab
      prev = rng() < 0.35 ? rooms[Math.floor(rng() * rooms.length)] : room;
    }
    // Truhen (22% pro Raum, nicht im Startraum)
    const chests = [];
    for (let i = 1; i < rooms.length; i++) {
      if (rng() < 0.22) {
        const r = rooms[i];
        chests.push({ x: r.cx + Math.floor(rng() * 3) - 1, z: r.cz + Math.floor(rng() * 3) - 1 });
      }
    }
    // Fackel-Würfe pro Raum (für deterministisches Licht-Setzen)
    const torches = rooms.map(() => rng());
    // Spinnennetze: 0–2 pro Raum, am Boden oder unter der Decke
    const webs = [];
    for (const r of rooms) {
      const n = Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) {
        webs.push({
          x: r.cx + Math.floor(rng() * (r.hw * 2 + 1)) - r.hw,
          z: r.cz + Math.floor(rng() * (r.hd * 2 + 1)) - r.hd,
          oben: rng() < 0.5,
        });
      }
    }
    // Monster-Spawner: 1–2 pro Ebene in zufälligen Räumen (nicht im Startraum)
    const spawners = [];
    const ns = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < ns; i++) {
      const r = rooms[1 + Math.floor(rng() * (rooms.length - 1))];
      spawners.push({ x: r.cx + Math.floor(rng() * 3) - 1, z: r.cz + Math.floor(rng() * 3) - 1 });
    }
    floors.push({ y, rooms, corridors, upX: cx, upZ: cz, down: null, chests, torches, webs, spawners, boss: null });
    // Abgang in einem zufälligen Raum ≠ Startraum
    const downRoom = rooms[1 + Math.floor(rng() * (rooms.length - 1))];
    floors[k].down = { x: downRoom.cx, z: downRoom.cz };
    cx = downRoom.cx; cz = downRoom.cz;
  }
  // unterste Ebene: kein Abgang, dafür die Boss-Truhe im letzten Raum
  const last = floors[floors.length - 1];
  last.down = null;
  const bossRoom = last.rooms[last.rooms.length - 1];
  last.boss = { x: bossRoom.cx, z: bossRoom.cz };
  return { ex, ez, surf, floors };
}

function writeDungeonPart(data, ox, oz, d, seed) {
  const X1 = ox + 15, Z1 = oz + 15;
  const brick = (x, y, z) => {
    const r = hash2(seed ^ 0xdb21, x * 7 + y * 131, z * 13 - y * 57);
    return r < 0.45 ? BLOCK.STONE_BRICKS : r < 0.62 ? BLOCK.MOSSY_STONE_BRICKS
      : r < 0.84 ? BLOCK.COBBLESTONE : BLOCK.CRACKED_STONE_BRICKS;
  };
  const put = (x, y, z, id) => {
    if (x < ox || x > X1 || z < oz || z > Z1 || y < 1 || y >= WORLD_HEIGHT) return;
    data[blockIndex(x - ox, y, z - oz)] = id;
  };

  // --- Ebenen: erst alle Raum-Schalen, dann Korridore (schneiden Türen), dann Rest ---
  for (const f of d.floors) {
    for (const r of f.rooms) {
      const rx0 = r.cx - r.hw, rx1 = r.cx + r.hw;
      const rz0 = r.cz - r.hd, rz1 = r.cz + r.hd;
      // Schale (Wände inkl. Boden/Decke) + Innenraum
      for (let x = Math.max(rx0 - 1, ox); x <= Math.min(rx1 + 1, X1); x++) {
        for (let z = Math.max(rz0 - 1, oz); z <= Math.min(rz1 + 1, Z1); z++) {
          const wand = x < rx0 || x > rx1 || z < rz0 || z > rz1;
          if (wand) {
            for (let dy = -1; dy <= 4; dy++) put(x, f.y + dy, z, brick(x, f.y + dy, z));
          } else {
            put(x, f.y - 1, z, brick(x, f.y - 1, z));
            for (let dy = 0; dy <= 3; dy++) put(x, f.y + dy, z, BLOCK.AIR);
            put(x, f.y + 4, z, brick(x, f.y + 4, z));
          }
        }
      }
    }
    // Korridore: L-förmig (erst x, dann z), 2 breit, 3 hoch, Boden + Decke aus Ziegeln
    for (const c of f.corridors) {
      const gänge = [
        { x0: Math.min(c.ax, c.bx), x1: Math.max(c.ax, c.bx), z0: c.az, z1: c.az + 1 },
        { x0: c.bx, x1: c.bx + 1, z0: Math.min(c.az, c.bz), z1: Math.max(c.az, c.bz) },
      ];
      for (const g of gänge) {
        for (let x = Math.max(g.x0, ox); x <= Math.min(g.x1, X1); x++) {
          for (let z = Math.max(g.z0, oz); z <= Math.min(g.z1, Z1); z++) {
            put(x, f.y - 1, z, brick(x, f.y - 1, z));
            for (let dy = 0; dy <= 2; dy++) put(x, f.y + dy, z, BLOCK.AIR);
            put(x, f.y + 3, z, brick(x, f.y + 3, z));
          }
        }
      }
    }
    // Spinnennetze (vor Fackeln/Truhen — die überschreiben im Konfliktfall)
    for (const wb of f.webs) put(wb.x, f.y + (wb.oben ? 3 : 0), wb.z, BLOCK.COBWEB);
    // Monster-Spawner (Truhen/Boss gewinnen bei Überlappung)
    for (const sp of f.spawners) put(sp.x, f.y, sp.z, BLOCK.SPAWNER);
    // Fackeln in Raumecken (deterministisch pro Raum)
    for (let i = 0; i < f.rooms.length; i++) {
      const r = f.rooms[i];
      if (f.torches[i] < 0.75) {
        put(r.cx - r.hw, f.y, r.cz - r.hd, BLOCK.TORCH);
        if (f.torches[i] < 0.4) put(r.cx + r.hw, f.y, r.cz + r.hd, BLOCK.TORCH);
      }
    }
    // Truhen + Boss-Truhe (Ereignis-Truhe wie im Dschungeltempel)
    for (const ch of f.chests) put(ch.x, f.y, ch.z, BLOCK.DUNGEON_CHEST);
    if (f.boss) put(f.boss.x, f.y, f.boss.z, BLOCK.LOOT_CHEST);
  }

  // --- Leiterschächte: Eingang → Ebene 0, dann Ebene k → k+1 ---
  const schacht = (sx, sz, yUnten, yOben) => {
    for (let y = yUnten; y <= yOben; y++) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        put(sx + dx, y, sz + dz, brick(sx + dx, y, sz + dz));
      }
      put(sx, y, sz, BLOCK.LADDER);
    }
  };
  schacht(d.ex, d.ez, d.floors[0].y, d.surf);
  for (let k = 0; k + 1 < d.floors.length; k++) {
    const f = d.floors[k];
    schacht(f.down.x, f.down.z, d.floors[k + 1].y, f.y);
  }

  // --- Eingangs-Häuschen an der Oberfläche (5×5, Tür im Süden) ---
  // erst eine kleine Lichtung freiräumen (Bäume/Anhöhen über dem Bau)
  for (let dx = -3; dx <= 3; dx++) {
    for (let dz = -3; dz <= 3; dz++) {
      for (let dy = 1; dy <= 8; dy++) {
        put(d.ex + dx, d.surf + dy, d.ez + dz, BLOCK.AIR);
      }
    }
  }
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      const x = d.ex + dx, z = d.ez + dz;
      if (!(dx === 0 && dz === 0)) put(x, d.surf, z, brick(x, d.surf, z)); // Boden (Mitte = Schacht)
      for (let dy = 1; dy <= 3; dy++) {
        const wand = Math.abs(dx) === 2 || Math.abs(dz) === 2;
        if (wand && !(dz === 2 && dx === 0 && dy <= 2)) {
          put(x, d.surf + dy, z, brick(x, d.surf + dy, z));
        }
      }
      put(x, d.surf + 4, z, brick(x, d.surf + 4, z)); // Dach
    }
  }
  put(d.ex, d.surf + 1, d.ez - 1, BLOCK.TORCH); // Fackel neben dem Schacht
}

// ---- Dörfer: seltene Siedlungen mit verschiedenen Gebäuden -------------------
// Region-basiert wie Dungeons: pro Region ein Kandidat; nur flaches Grasland.

const VILLAGE_REGION = 512;      // groß → Dörfer sind selten
const VILLAGE_REICHWEITE = 40;   // max. Abstand (Eck-Plätze + Rodung) vom Zentrum
const VILLAGE_BIOMES = new Set(['ebene', 'blumenwiese', 'savanne', 'wald', 'birkenwald']);
const villageCache = new Map();

export function villageForRegion(seed, rx, rz) {
  const key = seed + ':v:' + rx + ':' + rz;
  if (villageCache.has(key)) return villageCache.get(key);
  let v = null;
  if (hash2(seed ^ 0x5117, rx * 7919, rz * 104729) < 0.5) { // Kandidat-Region
    const rng = mulberry32((seed ^ 0x5117 ^ Math.imul(rx, 341873128) ^ Math.imul(rz, 132897987)) | 0);
    for (let versuch = 0; versuch < 6 && !v; versuch++) {
      const cx = rx * VILLAGE_REGION + 70 + Math.floor(rng() * (VILLAGE_REGION - 140));
      const cz = rz * VILLAGE_REGION + 70 + Math.floor(rng() * (VILLAGE_REGION - 140));
      const info = columnInfo(seed, cx, cz);
      if (!VILLAGE_BIOMES.has(info.biome) || info.surf <= SEA_LEVEL + 1 || info.surf + 12 >= WORLD_HEIGHT) continue;
      let flach = true; // flaches, zusammenhängendes Grasland ums Zentrum
      for (const [dx, dz] of [[-8, 0], [8, 0], [0, -8], [0, 8], [-6, 6], [6, -6]]) {
        const ci = columnInfo(seed, cx + dx, cz + dz);
        if (!VILLAGE_BIOMES.has(ci.biome) || Math.abs(ci.surf - info.surf) > 3) { flach = false; break; }
      }
      if (!flach) continue;
      const layout = buildVillageLayout(seed, cx, cz, rng);
      if (layout.buildings.length >= 8) v = layout; // sonst kein Dorf
    }
  }
  if (villageCache.size > 48) villageCache.clear();
  villageCache.set(key, v);
  return v;
}

function buildVillageLayout(seed, cx, cz, rng) {
  const buildings = [];
  const SP = 11;
  const plots = [];
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) if (i || j) plots.push([i, j]);
  for (let i = plots.length - 1; i > 0; i--) { const k = Math.floor(rng() * (i + 1)); const t = plots[i]; plots[i] = plots[k]; plots[k] = t; }
  const want = 8 + Math.floor(rng() * 7); // 8–14 Gebäude
  for (const [i, j] of plots) {
    if (buildings.length >= want) break;
    const ax = cx + i * SP + (Math.floor(rng() * 3) - 1);
    const az = cz + j * SP + (Math.floor(rng() * 3) - 1);
    const info = columnInfo(seed, ax, az);
    if (!VILLAGE_BIOMES.has(info.biome) || info.surf <= SEA_LEVEL + 1) continue;
    let ok = true; // lokal flach genug für die Grundfläche
    for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
      if (Math.abs(columnInfo(seed, ax + dx, az + dz).surf - info.surf) > 2) { ok = false; break; }
    }
    if (!ok) continue;
    let type;
    if (buildings.length === 0) type = 'mill';
    else if (buildings.length === 1) type = 'blacksmith';
    else if (buildings.length === 3 || buildings.length === 8) type = 'field'; // 1–2 Felder für die Bauern
    else type = rng() < 0.4 ? 'house_large' : 'house_small';
    const tdx = cx - ax, tdz = cz - az; // Tür/Front zeigt zum Zentrum
    const dir = Math.abs(tdx) >= Math.abs(tdz) ? (tdx >= 0 ? 'E' : 'W') : (tdz >= 0 ? 'S' : 'N');
    buildings.push({ type, ax, az, surf: info.surf, dir });
  }
  return { cx, cz, surf: columnInfo(seed, cx, cz).surf, buildings };
}

// Dörfer in der Nähe von (x,z) — für das Villager-Spawnen
export function villagesNear(seed, x, z) {
  const R = VILLAGE_REGION, out = [];
  const rx = Math.floor(x / R), rz = Math.floor(z / R);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const v = villageForRegion(seed, rx + dx, rz + dz);
    if (v) out.push(v);
  }
  return out;
}

function villagePut(data, ox, oz) {
  return (x, y, z, id, onlyAir) => {
    const lx = x - ox, lz = z - oz;
    if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || y < 1 || y >= WORLD_HEIGHT) return;
    const idx = blockIndex(lx, y, lz);
    if (onlyAir && data[idx] !== BLOCK.AIR) return;
    data[idx] = id;
  };
}

// Grundfläche freiräumen + Fundament gießen (überbrückt leicht unebenes Gelände)
function villageBase(put, ax, az, surf, hw, hd, floorId, up) {
  for (let dx = -hw; dx <= hw; dx++) for (let dz = -hd; dz <= hd; dz++) {
    for (let fy = surf - 4; fy < surf; fy++) put(ax + dx, fy, az + dz, BLOCK.COBBLESTONE);
    put(ax + dx, surf, az + dz, floorId);
    for (let cy = surf + 1; cy <= surf + up; cy++) put(ax + dx, cy, az + dz, BLOCK.AIR);
  }
}

function writeHouse(data, ox, oz, b, seed, large) {
  const put = villagePut(data, ox, oz);
  const { ax, az, surf, dir } = b;
  const hw = large ? 3 : 2, hd = 2, H = large ? 4 : 3;
  villageBase(put, ax, az, surf, hw, hd, BLOCK.PLANKS, H + 3);
  for (let cy = surf + 1; cy <= surf + H; cy++) {
    for (let dx = -hw; dx <= hw; dx++) for (let dz = -hd; dz <= hd; dz++) {
      if (!(dx === -hw || dx === hw || dz === -hd || dz === hd)) continue;
      const corner = (dx === -hw || dx === hw) && (dz === -hd || dz === hd);
      let id = corner ? BLOCK.LOG : BLOCK.PLANKS;
      if (!corner && cy === surf + 2 && (dx === 0 || dz === 0)) id = BLOCK.GLASS; // Fenster
      put(ax + dx, cy, az + dz, id);
    }
  }
  const [ddx, ddz] = CARDINAL_DELTA[dir];
  const dxp = ax + ddx * hw, dzp = az + ddz * hd; // Türzelle in der Front-Wand
  put(dxp, surf, dzp, BLOCK.PLANKS);
  put(dxp, surf + 1, dzp, BLOCK['DOOR_LOWER_' + dir]);
  put(dxp, surf + 2, dzp, BLOCK['DOOR_UPPER_' + dir]);
  put(dxp + ddx, surf, dzp + ddz, BLOCK.COBBLE_SLAB); // Türstufe außen
  for (let dx = -hw; dx <= hw; dx++) for (let dz = -hd; dz <= hd; dz++) put(ax + dx, surf + H + 1, az + dz, BLOCK.PLANKS); // Dach
  put(ax - hw + 1, surf + 1, az - 1, BLOCK.BED_FOOT); // Bett
  put(ax - hw + 1, surf + 1, az, BLOCK.BED_HEAD);
  put(ax + hw - 1, surf + 1, az + 1, BLOCK.CRAFTING_TABLE);
  put(ax + hw - 1, surf + 2, az + 1, BLOCK.TORCH); // Fackel auf dem Tisch
  put(dxp + ddx, surf + 1, dzp + ddz, BLOCK.TORCH); // Außenfackel neben der Tür
}

function writeMill(data, ox, oz, b, seed) {
  const put = villagePut(data, ox, oz);
  const { ax, az, surf, dir } = b;
  const hw = 2, hd = 2, H = 7;
  villageBase(put, ax, az, surf, hw, hd, BLOCK.PLANKS, H + 4);
  for (let cy = surf + 1; cy <= surf + H; cy++) {
    for (let dx = -hw; dx <= hw; dx++) for (let dz = -hd; dz <= hd; dz++) {
      if (!(dx === -hw || dx === hw || dz === -hd || dz === hd)) continue;
      const corner = (dx === -hw || dx === hw) && (dz === -hd || dz === hd);
      let id = cy <= surf + 2 ? BLOCK.COBBLESTONE : BLOCK.PLANKS;
      if (!corner && (cy === surf + 4) && (dx === 0 || dz === 0)) id = BLOCK.GLASS;
      put(ax + dx, cy, az + dz, id);
    }
  }
  const [ddx, ddz] = CARDINAL_DELTA[dir];
  const dxp = ax + ddx * hw, dzp = az + ddz * hd;
  put(dxp, surf, dzp, BLOCK.PLANKS);
  put(dxp, surf + 1, dzp, BLOCK['DOOR_LOWER_' + dir]);
  put(dxp, surf + 2, dzp, BLOCK['DOOR_UPPER_' + dir]);
  for (let dx = -hw; dx <= hw; dx++) for (let dz = -hd; dz <= hd; dz++) put(ax + dx, surf + H + 1, az + dz, BLOCK.PLANKS); // Dach
  // Windmühlen-Flügel: Kreuz aus Brettern/Wolle vor der Front-Oberseite
  const topY = surf + H - 1;
  const qx = ddz, qz = -ddx; // senkrecht zur Front-Normale (in der Wandebene)
  const cxm = ax + ddx * (hw + 1), czm = az + ddz * (hd + 1); // Nabe vor der Wand
  for (let r = 1; r <= 3; r++) {
    const blade = r === 3 ? BLOCK.WOOL : BLOCK.PLANKS;
    put(cxm + qx * r, topY, czm + qz * r, blade);
    put(cxm - qx * r, topY, czm - qz * r, blade);
    put(cxm, topY + r, czm, blade);
    put(cxm, topY - r, czm, blade);
  }
  put(cxm, topY, czm, BLOCK.LOG); // Nabe
}

function writeBlacksmith(data, ox, oz, b, seed) {
  const put = villagePut(data, ox, oz);
  const { ax, az, surf, dir } = b;
  const hw = 2, hd = 2, H = 3;
  villageBase(put, ax, az, surf, hw, hd, BLOCK.COBBLESTONE, H + 2);
  const [ddx, ddz] = CARDINAL_DELTA[dir];
  for (let cy = surf + 1; cy <= surf + H; cy++) {
    for (let dx = -hw; dx <= hw; dx++) for (let dz = -hd; dz <= hd; dz++) {
      if (!(dx === -hw || dx === hw || dz === -hd || dz === hd)) continue;
      const frontCell = (ddx !== 0 && dx === ddx * hw) || (ddz !== 0 && dz === ddz * hd);
      if (frontCell && cy <= surf + 2) continue; // offene Werkstatt-Front
      const corner = (dx === -hw || dx === hw) && (dz === -hd || dz === hd);
      put(ax + dx, cy, az + dz, corner ? BLOCK.LOG : (cy === surf + H ? BLOCK.PLANKS : BLOCK.COBBLESTONE));
    }
  }
  for (let dx = -hw; dx <= hw; dx++) for (let dz = -hd; dz <= hd; dz++) put(ax + dx, surf + H + 1, az + dz, BLOCK.COBBLE_SLAB); // Dach
  // Schmiede-Einrichtung
  put(ax - 1, surf + 1, az - 1, BLOCK.FURNACE);
  put(ax, surf + 1, az - 1, BLOCK.ANVIL);
  put(ax + 1, surf + 1, az - 1, BLOCK.DUNGEON_CHEST); // Beute-Truhe (füllt sich beim Öffnen)
  put(ax + 1, surf, az + 1, BLOCK.LAVA); // Esse: Lava bündig im Cobble-Boden (eingefasst → fließt nicht)
  put(ax - 1, surf + 1, az + 1, BLOCK.TORCH);
}

function writeVillageWell(data, ox, oz, cx, cz, surf) {
  const put = villagePut(data, ox, oz);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    put(cx + dx, surf, cz + dz, BLOCK.COBBLESTONE);
    put(cx + dx, surf - 1, cz + dz, BLOCK.COBBLESTONE);
    put(cx + dx, surf + 1, cz + dz, BLOCK.AIR);
  }
  put(cx, surf, cz, BLOCK.WATER); put(cx, surf - 1, cz, BLOCK.WATER);
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) put(cx + dx, surf + 1, cz + dz, BLOCK.COBBLESTONE); // Rand
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { put(cx + dx, surf + 2, cz + dz, BLOCK.LOG); put(cx + dx, surf + 3, cz + dz, BLOCK.LOG); }
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) put(cx + dx, surf + 4, cz + dz, BLOCK.PLANK_SLAB); // Dach
}

// Dorf-Feld: 7×5 Ackerland mit Wasserrinne in der Mitte und Feldfrüchten in
// zufälligen Wachstumsstufen (manche reif) — Arbeitsplatz für die Bauern.
const FIELD_CROPS = [
  [BLOCK.WHEAT_0, BLOCK.WHEAT_1, BLOCK.WHEAT_2, BLOCK.WHEAT_3],
  [BLOCK.CARROT_0, BLOCK.CARROT_1, BLOCK.CARROT_2, BLOCK.CARROT_3],
  [BLOCK.POTATO_0, BLOCK.POTATO_1, BLOCK.POTATO_2, BLOCK.POTATO_3],
];
function writeField(data, ox, oz, b, seed) {
  const put = villagePut(data, ox, oz);
  const { ax, az, surf } = b;
  const hw = 3, hd = 2;
  villageBase(put, ax, az, surf, hw, hd, BLOCK.DIRT, 4); // Fläche freiräumen + Fundament
  for (let dx = -hw; dx <= hw; dx++) for (let dz = -hd; dz <= hd; dz++) {
    // schmale Wasserrinne in der Mittelreihe (Enden bleiben Ackerland → läuft nicht aus)
    if (dz === 0 && dx > -hw && dx < hw) { put(ax + dx, surf, az + dz, BLOCK.WATER); continue; }
    put(ax + dx, surf, az + dz, BLOCK.FARMLAND_WET);
    const kind = Math.floor(hash2(seed ^ 0xfa2e, ax + dx, az + dz) * 3) % 3;
    const stage = Math.floor(hash2(seed ^ 0xfa1d, (ax + dx) * 7, (az + dz) * 13) * 4); // 0..3, manche reif
    put(ax + dx, surf + 1, az + dz, FIELD_CROPS[kind][Math.min(3, stage)]);
  }
}

const VILLAGE_CLEAR = new Set([
  BLOCK.LEAVES, BLOCK.BIRCH_LEAVES, BLOCK.SPRUCE_LEAVES, BLOCK.LOG, BLOCK.BIRCH_LOG,
  BLOCK.SPRUCE_LOG, BLOCK.JUNGLE_LOG, BLOCK.VINE, BLOCK.JUNGLE_BUSH,
]);

function writeVillage(data, ox, oz, v, seed) {
  // Bäume im Dorfumfeld roden → Freifläche wie ein echtes Dorf (deckt auch Eck-Gebäude)
  const R = 36, R2 = R * R, y0 = Math.max(1, v.surf - 1), y1 = Math.min(WORLD_HEIGHT - 1, v.surf + 13);
  for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
    const dx = ox + lx - v.cx, dz = oz + lz - v.cz;
    if (dx * dx + dz * dz > R2) continue;
    for (let y = y0; y <= y1; y++) {
      const idx = blockIndex(lx, y, lz);
      if (VILLAGE_CLEAR.has(data[idx])) data[idx] = BLOCK.AIR;
    }
  }
  if (v.cx + 3 >= ox && v.cx - 3 <= ox + 15 && v.cz + 3 >= oz && v.cz - 3 <= oz + 15)
    writeVillageWell(data, ox, oz, v.cx, v.cz, v.surf);
  for (const b of v.buildings) {
    const hs = 6; // großzügiger Überlapp-Radius (deckt Dach/Flügel)
    if (b.ax + hs < ox || b.ax - hs > ox + 15 || b.az + hs < oz || b.az - hs > oz + 15) continue;
    if (b.type === 'mill') writeMill(data, ox, oz, b, seed);
    else if (b.type === 'blacksmith') writeBlacksmith(data, ox, oz, b, seed);
    else if (b.type === 'field') writeField(data, ox, oz, b, seed);
    else writeHouse(data, ox, oz, b, seed, b.type === 'house_large');
  }
}

// ---- far-terrain sampling (simplified distant landscape) ----------------------

// approximate top-down colors per biome (forest biomes darker = canopy)
const FAR_COLORS = {
  strand: [0.84, 0.77, 0.51],
  wueste: [0.85, 0.78, 0.52],
  badlands: [0.73, 0.44, 0.22],
  schneelandschaft: [0.93, 0.95, 0.97],
  schneewald: [0.72, 0.79, 0.75],
  gipfel: [0.93, 0.95, 0.97],
  hochgebirge: [0.74, 0.76, 0.8],
  haenge: [0.52, 0.52, 0.53],
  gebirgsfuss: [0.45, 0.53, 0.33],
  wald: [0.25, 0.46, 0.19],
  birkenwald: [0.34, 0.55, 0.25],
  tannenwald: [0.17, 0.32, 0.19],
  blumenwiese: [0.45, 0.66, 0.29],
  ebene: [0.44, 0.65, 0.3],
  savanne: [0.63, 0.6, 0.31],
  sumpf: [0.33, 0.47, 0.27],
  pilzinsel: [0.5, 0.44, 0.52],
  dschungel: [0.14, 0.38, 0.1],
};

// One sample point of the simplified far landscape: surface height + color.
export function farSample(seed, x, z) {
  const { surf, biome } = columnInfo(seed, x, z);
  if (surf < SEA_LEVEL) {
    const t = Math.min(1, (SEA_LEVEL - surf) / 40); // deeper = darker water
    return {
      h: SEA_LEVEL,
      r: 0.2 * (1 - t) + 0.04 * t,
      g: 0.42 * (1 - t) + 0.13 * t,
      b: 0.8 * (1 - t) + 0.42 * t,
    };
  }
  const c = FAR_COLORS[biome] || [0.44, 0.65, 0.3];
  const j = 0.9 + hash2(seed ^ 0xfa12, x, z) * 0.2; // subtle deterministic texture
  return { h: surf, r: c[0] * j, g: c[1] * j, b: c[2] * j };
}

const SPAWN_BIOMES = new Set(['ebene', 'wald', 'blumenwiese', 'birkenwald', 'tannenwald', 'savanne', 'strand']);

export function findSpawn(seed) {
  for (let r = 0; r <= 1200; r += 8) {
    const samples = r === 0 ? 1 : 16;
    for (let i = 0; i < samples; i++) {
      const a = (i / samples) * Math.PI * 2;
      const x = Math.round(Math.cos(a) * r);
      const z = Math.round(Math.sin(a) * r);
      const { surf, biome } = columnInfo(seed, x, z);
      if (surf > SEA_LEVEL && SPAWN_BIOMES.has(biome)) {
        return { x, y: surf + 1, z };
      }
    }
  }
  return { x: 0, y: heightAt(seed, 0, 0) + 1, z: 0 };
}
