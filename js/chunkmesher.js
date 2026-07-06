// Geteilter Chunk-Mesher: arbeitet auf einem erweiterten 18×H×18-Array
// (eigener Chunk + 1-Block-Rand der Nachbarn für Culling/AO/Licht).
// Läuft im Worker (genworker.js) und als synchroner Fallback im Main Thread.
// Kein THREE-Import — Ergebnis sind rohe TypedArrays.

import {
  CHUNK_SIZE as CS, WORLD_HEIGHT as WH,
  BLOCK, BLOCKS, isWaterId, isLavaId, fluidTop, fluidLevel,
} from './constants.js';
import { uvRect } from './atlasmap.js';

const G = CS + 2;      // 18
const GG = G * G;      // Ebenen-Stride im erweiterten Array

// Flächen-Tabellen (Winding CCW von außen geprüft)
const FACES = [
  { n: [1, 0, 0],  corners: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]], uvs: [[0,0],[0,1],[1,1],[1,0]], shade: 0.80 },
  { n: [-1, 0, 0], corners: [[0,0,1],[0,1,1],[0,1,0],[0,0,0]], uvs: [[0,0],[0,1],[1,1],[1,0]], shade: 0.80 },
  { n: [0, 1, 0],  corners: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]], uvs: [[0,0],[1,0],[1,1],[0,1]], shade: 1.00 },
  { n: [0, -1, 0], corners: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]], uvs: [[0,1],[1,1],[1,0],[0,0]], shade: 0.60 },
  { n: [0, 0, 1],  corners: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]], uvs: [[0,0],[1,0],[1,1],[0,1]], shade: 0.90 },
  { n: [0, 0, -1], corners: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]], uvs: [[0,0],[1,0],[1,1],[0,1]], shade: 0.90 },
];
const TANGENTS = FACES.map((f) => {
  const k = f.n[0] !== 0 ? 0 : f.n[1] !== 0 ? 1 : 2;
  return [0, 1, 2].filter((a) => a !== k);
});

// Kolben-Schubrichtung als 3D-Flächen-Normale (für die Front-Kachel) — inkl. vertikal
const PISTON_FRONT = { N: [0, 0, -1], E: [1, 0, 0], S: [0, 0, 1], W: [-1, 0, 0], UP: [0, 1, 0], DOWN: [0, -1, 0] };

function occludes(id) {
  return id > 0 && !isWaterId(id) && !isLavaId(id) && BLOCKS[id]?.opaque !== false;
}
function transparentFor(id) {
  return id === BLOCK.AIR || isWaterId(id) || isLavaId(id) || (id > 0 && BLOCKS[id]?.opaque === false);
}

function emitCross(buf, lx, y, lz, tileName, blkL, skyL) {
  const uvr = uvRect(tileName);
  const quads = [
    [[0.15, 0.15], [0.85, 0.85]],
    [[0.85, 0.15], [0.15, 0.85]],
  ];
  for (const [[x0, z0], [x1, z1]] of quads) {
    const base = buf.pos.length / 3;
    buf.pos.push(
      lx + x0, y, lz + z0,
      lx + x1, y, lz + z1,
      lx + x1, y + 1, lz + z1,
      lx + x0, y + 1, lz + z0
    );
    for (let i = 0; i < 4; i++) {
      buf.col.push(blkL, skyL, 0);
    }
    buf.uv.push(uvr.u0, uvr.v0, uvr.u1, uvr.v0, uvr.u1, uvr.v1, uvr.u0, uvr.v1);
    buf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    buf.idx.push(base + 2, base + 1, base, base + 3, base + 2, base);
  }
}

// UV-Zuordnung pro Fläche: [u-Achse, uGespiegelt, v-Achse, vGespiegelt] —
// deckungsgleich mit den uvs-Tabellen in FACES, aber für Teil-Boxen parametrisiert.
const UVMAP = [
  [2, false, 1, false], // +x
  [2, true, 1, false],  // -x
  [0, false, 2, true],  // +y
  [0, false, 2, true],  // -y
  [0, false, 1, false], // +z
  [0, true, 1, false],  // -z
];

// Beliebige Teil-Boxen (Stufen, Treppen, Türen, Teppiche …): 6 Flächen je Box,
// UVs auf den Ausschnitt der Kachel gemappt, bündige Flächen gegen opake Nachbarn gecullt.
// topUvRot (0/90/180/270) dreht die Oberseiten-Textur — für Bett-Kissen nach Ausrichtung.
function emitBoxes(buf, lx, y, lz, boxes, tiles, blkL, skyL, get, ex, ez, topUvRot = 0) {
  for (const b of boxes) {
    for (let f = 0; f < 6; f++) {
      const face = FACES[f];
      const n = face.n;
      // bündig mit der Zellgrenze? Dann normales Nachbar-Culling
      const flush =
        (n[0] === 1 && b[3] === 1) || (n[0] === -1 && b[0] === 0) ||
        (n[1] === 1 && b[4] === 1) || (n[1] === -1 && b[1] === 0) ||
        (n[2] === 1 && b[5] === 1) || (n[2] === -1 && b[2] === 0);
      if (flush) {
        const nb = get(ex + n[0], y + n[1], ez + n[2]);
        if (nb === -1 || !transparentFor(nb)) continue;
      }
      const tileName = n[1] > 0 ? (tiles.top ?? tiles.side) : n[1] < 0 ? (tiles.bottom ?? tiles.side) : tiles.side;
      const uvr = uvRect(tileName);
      const [ua, uFlip, va, vFlip] = UVMAP[f];
      const base = buf.pos.length / 3;
      for (let v = 0; v < 4; v++) {
        const c = face.corners[v];
        const pp = [
          c[0] === 1 ? b[3] : b[0],
          c[1] === 1 ? b[4] : b[1],
          c[2] === 1 ? b[5] : b[2],
        ];
        buf.pos.push(lx + pp[0], y + pp[1], lz + pp[2]);
        let pu = uFlip ? 1 - pp[ua] : pp[ua];
        let pv = vFlip ? 1 - pp[va] : pp[va];
        if (f === 2 && topUvRot) {
          // Oberseiten-UV um die Kachelmitte drehen
          const ru = topUvRot === 90 ? pv : topUvRot === 180 ? 1 - pu : 1 - pv;
          const rv = topUvRot === 90 ? 1 - pu : topUvRot === 180 ? 1 - pv : pu;
          pu = ru; pv = rv;
        }
        buf.uv.push(uvr.u0 + (uvr.u1 - uvr.u0) * pu, uvr.v0 + (uvr.v1 - uvr.v0) * pv);
        buf.col.push(face.shade * 0.9 * blkL, face.shade * 0.9 * skyL, 0);
      }
      buf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
}

// Bett-Ausrichtung: UV-Rotation der Oberseite aus der Lage des Partner-Teils.
// Kissen ist in der Kachel „oben" (Nordkante bei Rotation 0).
const BED_AXIS_ROT = { N: 0, S: 180, W: 90, E: 270 };
function bedTopRot(def, get, ex, y, ez) {
  const want = def.bed === 'head' ? 'foot' : 'head';
  for (const [dx, dz, dir] of [[0, -1, 'N'], [1, 0, 'E'], [0, 1, 'S'], [-1, 0, 'W']]) {
    const nb = get(ex + dx, y, ez + dz);
    if (nb > 0 && BLOCKS[nb]?.bed === want) {
      // Achse Fuß→Kopf bestimmt die Richtung; Kopf: vom Fuß weg, Fuß: zum Kopf hin
      const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };
      const axis = def.bed === 'head' ? OPP[dir] : dir;
      return BED_AXIS_ROT[axis];
    }
  }
  return 0;
}

// Leiter: flaches Paneel an der ersten soliden Nachbarwand
function ladderBoxes(get, ex, y, ez) {
  const T = 0.0625;
  if (occludes(get(ex, y, ez - 1))) return [[0, 0, 0.001, 1, 1, T]];
  if (occludes(get(ex, y, ez + 1))) return [[0, 0, 1 - T, 1, 1, 0.999]];
  if (occludes(get(ex - 1, y, ez))) return [[0.001, 0, 0, T, 1, 1]];
  if (occludes(get(ex + 1, y, ez))) return [[1 - T, 0, 0, 0.999, 1, 1]];
  return [[0, 0, 0.4, 1, 1, 0.4 + T]]; // freistehend: mittig
}

// Glasscheibe: Mittelpfosten + Arme zu verbindenden Nachbarn (Scheiben, Glas, solide Blöcke)
function paneBoxes(get, ex, y, ez) {
  const A = 0.4375, B = 0.5625;
  const connects = (id) => id > 0 && (BLOCKS[id]?.pane || id === BLOCK.GLASS || occludes(id));
  const n = connects(get(ex, y, ez - 1)), s = connects(get(ex, y, ez + 1));
  const w = connects(get(ex - 1, y, ez)), e = connects(get(ex + 1, y, ez));
  const boxes = [];
  if (!n && !s && !w && !e) return [[A, 0, 0, B, 1, 1]]; // freistehend: gerade Scheibe
  if (n || s) boxes.push([A, 0, n ? 0 : A, B, 1, s ? 1 : B]);
  if (w || e) boxes.push([w ? 0 : A, 0, A, e ? 1 : B, 1, B]);
  return boxes;
}

// Redstone-Leitung: Mittelpunkt + flache Arme zu verbundenen Nachbarn (Leitung/Hebel/Knopf/Kolben)
function dustBoxes(get, ex, y, ez) {
  const T = 0.0625, A = 0.32, B = 0.68;
  const conn = (id) => id > 0 && (BLOCKS[id]?.redstone || BLOCKS[id]?.fluxSource);
  const n = conn(get(ex, y, ez - 1)), s = conn(get(ex, y, ez + 1));
  const w = conn(get(ex - 1, y, ez)), e = conn(get(ex + 1, y, ez));
  const boxes = [[A, 0, A, B, T, B]]; // Mittelpunkt (Punkt)
  if (n) boxes.push([A, 0, 0, B, T, A]);
  if (s) boxes.push([A, 0, B, B, T, 1]);
  if (w) boxes.push([0, 0, A, A, T, B]);
  if (e) boxes.push([B, 0, A, 1, T, B]);
  return boxes;
}

// Kolbenarm: Kopfplatte an der Schubseite + Stange zurück zum Kolben (Nachbar sucht den Kolben)
function pistonHeadBoxes(get, ex, y, ez) {
  const isP = (id) => id > 0 && BLOCKS[id]?.redstone === 'piston';
  const r = 0.35, R = 0.65;
  if (isP(get(ex - 1, y, ez))) return [[0.72, 0.15, 0.15, 1, 0.85, 0.85], [0, r, r, 0.72, R, R]];
  if (isP(get(ex + 1, y, ez))) return [[0, 0.15, 0.15, 0.28, 0.85, 0.85], [0.28, r, r, 1, R, R]];
  if (isP(get(ex, y, ez - 1))) return [[0.15, 0.15, 0.72, 0.85, 0.85, 1], [r, r, 0, R, R, 0.72]];
  if (isP(get(ex, y, ez + 1))) return [[0.15, 0.15, 0, 0.85, 0.85, 0.28], [r, r, 0.28, R, R, 1]];
  if (isP(get(ex, y - 1, ez))) return [[0.15, 0.72, 0.15, 0.85, 1, 0.85], [r, 0, r, R, 0.72, R]]; // Kolben darunter → Arm nach oben
  if (isP(get(ex, y + 1, ez))) return [[0.15, 0, 0.15, 0.85, 0.28, 0.85], [r, 0.28, r, R, 1, R]]; // Kolben darüber → Arm nach unten
  return [[0.3, 0.3, 0.3, 0.7, 0.7, 0.7]];
}

function finalize(buf) {
  if (buf.idx.length === 0) return null;
  const vertCount = buf.pos.length / 3;
  return {
    pos: new Float32Array(buf.pos),
    uv: new Float32Array(buf.uv),
    col: new Float32Array(buf.col),
    // Uint16 spart die Hälfte, wenn der Chunk klein genug ist (fast immer)
    idx: vertCount <= 65535 ? new Uint16Array(buf.idx) : new Uint32Array(buf.idx),
  };
}

// data/light: Uint8Array der Größe G*G*(copyTop+1), Index = ex + ez*G + y*GG
// (ex/ez = lokale Koordinate + 1). maxY = höchster Nicht-Luft-Block des Chunks.
export function buildChunkMesh(data, light, maxY, copyTop) {
  const get = (ex, y, ez) => {
    if (y < 0) return BLOCK.BEDROCK;
    if (y > copyTop) return BLOCK.AIR;
    return data[ex + ez * G + y * GG];
  };
  const getL = (ex, y, ez) => {
    if (y > copyTop) return 0xf0; // über dem höchsten Block: voller Himmel
    if (y < 0) return 0;
    return light[ex + ez * G + y * GG];
  };

  const solid = { pos: [], uv: [], col: [], idx: [] };
  const water = { pos: [], uv: [], col: [], idx: [] };
  const lava = { pos: [], uv: [], col: [], idx: [] };
  const aoVals = [0, 0, 0, 0];

  const yTop = Math.min(WH - 1, maxY);
  for (let y = 0; y <= yTop; y++) {
    for (let ez = 1; ez <= CS; ez++) {
      for (let ex = 1; ex <= CS; ex++) {
        const id = data[ex + ez * G + y * GG];
        if (id === BLOCK.AIR) continue;
        const isWater = isWaterId(id);
        const isLava = isLavaId(id);
        const def = BLOCKS[id];
        if (def.cross) {
          const CL = getL(ex, y, ez);
          // Kelp-Spitze bekommt die Blüten-Kachel
          const tile = (id === BLOCK.KELP && get(ex, y + 1, ez) !== BLOCK.KELP)
            ? 'kelp_top' : def.tiles.side;
          emitCross(solid, ex - 1, y, ez - 1, tile, (CL & 0x0f) / 15, (CL >> 4) / 15);
          continue;
        }
        // Teilblöcke (Stufen, Treppen, Türen, Truhen, Teppiche, Betten, Scheiben, Leitern)
        if (def.boxes || def.ladder) {
          const CL = getL(ex, y, ez);
          const bl = (CL & 0x0f) / 15, sl = (CL >> 4) / 15;
          const boxes = def.ladder ? ladderBoxes(get, ex, y, ez)
            : def.pane ? paneBoxes(get, ex, y, ez)
            : def.redstone === 'dust' ? dustBoxes(get, ex, y, ez)
            : def.redstone === 'head' ? pistonHeadBoxes(get, ex, y, ez)
            : def.boxes;
          const rot = def.bed ? bedTopRot(def, get, ex, y, ez) : 0;
          emitBoxes(solid, ex - 1, y, ez - 1, boxes, def.tiles, bl, sl, get, ex, ez, rot);
          continue;
        }
        const tiles = def.tiles;
        const above = get(ex, y + 1, ez);
        const fluidSurface = (isWater && !isWaterId(above)) || (isLava && !isLavaId(above));
        const myTop = (isWater || isLava) ? (fluidSurface ? fluidTop(id) : 1) : 1;

        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const n = face.n;
          const nb = get(ex + n[0], y + n[1], ez + n[2]);
          let bottomOff = 0;
          if (isWater || isLava) {
            const famFn = isWater ? isWaterId : isLavaId;
            if (famFn(nb)) {
              // Nachbar ist gleiche Flüssigkeit: normalerweise keine Innenfläche —
              // AUSSER der Nachbar-Pegel ist niedriger: dann den Spalt seitlich schließen
              if (n[1] !== 0) continue;
              const nbAbove = get(ex + n[0], y + 1, ez + n[2]);
              const nbTop = famFn(nbAbove) ? 1 : fluidTop(nb);
              if (nbTop >= myTop - 0.01) continue;
              bottomOff = nbTop;
            } else if (isWater) {
              // Wasserpflanzen zählen als Wasser: keine Innenflächen gegen sie
              if (!(nb === BLOCK.AIR || isLavaId(nb) ||
                (nb > 0 && BLOCKS[nb]?.cross && !BLOCKS[nb]?.waterPlant))) continue;
            } else {
              if (!(nb === BLOCK.AIR || isWaterId(nb) || (nb > 0 && BLOCKS[nb]?.cross))) continue;
            }
          } else {
            if (nb === -1 || !transparentFor(nb)) continue;
            // Glas an Glas: innere Flächen weglassen
            if (def.cullSame && nb === id) continue;
          }

          const buf = isWater ? water : isLava ? lava : solid;
          let tileName;
          if (def.logAxis === 'x') tileName = n[0] !== 0 ? tiles.top : tiles.side;      // Stirnholz an den X-Enden
          else if (def.logAxis === 'z') tileName = n[2] !== 0 ? tiles.top : tiles.side;  // Stirnholz an den Z-Enden
          else tileName = n[1] > 0 ? (tiles.top ?? tiles.side) : n[1] < 0 ? (tiles.bottom ?? tiles.side) : tiles.side;
          if (def.pistonDir && tiles.front) { // Kolben: Front-Kachel nur auf der Schub-Seite
            const fn = PISTON_FRONT[def.pistonDir];
            if (n[0] === fn[0] && n[1] === fn[1] && n[2] === fn[2]) tileName = tiles.front;
          }
          const uvr = uvRect(tileName);
          const base = buf.pos.length / 3;
          const [ta, tb] = TANGENTS[f];
          const topOff = myTop;
          const L = getL(ex + n[0], y + n[1], ez + n[2]);
          const skyL = (L >> 4) / 15;
          const blkL = (L & 0x0f) / 15;

          // Fließende Flüssigkeit: Oberseiten-Animation dreht sich in Fließrichtung
          // (Scroll läuft zum niedrigsten Nachbar-Pegel bzw. zur offenen Kante)
          let topRot = 0;
          const isFlowCell =
            (isWater && id >= BLOCK.WATER_FLOW7 && id <= BLOCK.WATER_FLOW1) ||
            (isLava && id >= BLOCK.LAVA_FLOW6 && id <= BLOCK.LAVA_FLOW2);
          if (f === 2 && isFlowCell) {
            const famF = isWater ? isWaterId : isLavaId;
            let best = 99, dir = 0; // 0=N 1=E 2=S 3=W
            const NB4 = [[0, -1], [1, 0], [0, 1], [-1, 0]];
            for (let k = 0; k < 4; k++) {
              const nid = get(ex + NB4[k][0], y, ez + NB4[k][1]);
              const lv = nid === BLOCK.AIR ? -1 : famF(nid) ? fluidLevel(nid) : 99;
              if (lv < best) { best = lv; dir = k; }
            }
            topRot = [0, 270, 180, 90][dir];
          }

          for (let v = 0; v < 4; v++) {
            const corner = face.corners[v];
            const cy = corner[1] === 1 ? topOff : bottomOff;
            buf.pos.push(ex - 1 + corner[0], y + cy, ez - 1 + corner[2]);
            const uvc = face.uvs[v];
            let pu = uvc[0], pv = uvc[1];
            if (topRot) {
              const ru = topRot === 90 ? pv : topRot === 180 ? 1 - pu : 1 - pv;
              const rv = topRot === 90 ? 1 - pu : topRot === 180 ? 1 - pv : pu;
              pu = ru; pv = rv;
            }
            buf.uv.push(
              uvr.u0 + (uvr.u1 - uvr.u0) * pu,
              uvr.v0 + (uvr.v1 - uvr.v0) * pv
            );
            let ao = 3;
            if (!isWater && !isLava) {
              const p = [ex + n[0], y + n[1], ez + n[2]];
              const sa = corner[ta] === 1 ? 1 : -1;
              const sb = corner[tb] === 1 ? 1 : -1;
              const s1p = [...p]; s1p[ta] += sa;
              const s2p = [...p]; s2p[tb] += sb;
              const cp = [...p]; cp[ta] += sa; cp[tb] += sb;
              const s1 = occludes(get(s1p[0], s1p[1], s1p[2])) ? 1 : 0;
              const s2 = occludes(get(s2p[0], s2p[1], s2p[2])) ? 1 : 0;
              const co = occludes(get(cp[0], cp[1], cp[2])) ? 1 : 0;
              ao = s1 && s2 ? 0 : 3 - (s1 + s2 + co);
            }
            aoVals[v] = ao;
            if (isLava) {
              buf.col.push(1, 1, 1);
            } else {
              const aoShade = face.shade * (0.34 + 0.22 * ao);
              buf.col.push(aoShade * blkL, aoShade * skyL, 0);
            }
          }
          if (aoVals[0] + aoVals[2] < aoVals[1] + aoVals[3]) {
            buf.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base + 0);
          } else {
            buf.idx.push(base + 0, base + 1, base + 2, base + 0, base + 2, base + 3);
          }
        }
      }
    }
  }

  return { solid: finalize(solid), water: finalize(water), lava: finalize(lava) };
}
