// Licht-Engine: pro Chunk ein Uint8Array, Nibble-gepackt (high = Himmelslicht, low = Blocklicht).
// Himmelslicht: 15 in der freien Luftsäule, breitet sich per BFS mit -1 pro Block aus
// (so fällt Licht in Höhleneingänge). Blocklicht: Lava strahlt 14 aus.
// Berechnung pro Chunk (Worker); Chunk-übergreifend zieht world.js Licht an den Grenzen nach.

import { CHUNK_SIZE as CS, WORLD_HEIGHT as WH, BLOCK, BLOCKS, isLavaId } from './constants.js';

const YS = CS * CS;

export function lightOpaque(id) {
  if (id <= 0) return false;
  const d = BLOCKS[id];
  return d ? d.opaque !== false : false;
}

// Blocklicht-Emission eines Blocks (0 = leuchtet nicht)
export function lightEmission(id) {
  if (isLavaId(id)) return 14;
  if (id === BLOCK.TORCH) return 14;
  if (id === BLOCK.FURNACE_ON) return 13;
  if (id === BLOCK.GLOW_LICHEN) return 8; // Leuchtflechte: sanftes Höhlenlicht
  return 0;
}

export function computeLight(data, maxY = WH - 1) {
  const light = new Uint8Array(data.length);
  const top = Math.min(WH - 1, maxY + 1);

  // 1) Himmelslicht-Säulen (15 bis zum ersten undurchsichtigen Block)
  for (let lz = 0; lz < CS; lz++) {
    for (let lx = 0; lx < CS; lx++) {
      const col = lx + lz * CS;
      for (let y = WH - 1; y >= 0; y--) {
        const idx = col + y * YS;
        if (lightOpaque(data[idx])) break;
        light[idx] = 0xf0;
      }
    }
  }

  // 2) Seeds: himmelsbeleuchtete Zellen mit dunklem, durchlässigem Nachbarn
  const queue = [];
  for (let y = 1; y <= top; y++) {
    const yo = y * YS;
    for (let lz = 0; lz < CS; lz++) {
      for (let lx = 0; lx < CS; lx++) {
        const idx = lx + lz * CS + yo;
        if ((light[idx] >> 4) !== 15) continue;
        // Nachbar unten oder seitlich unbeleuchtet & durchlässig?
        const below = idx - YS;
        if ((light[below] >> 4) < 14 && !lightOpaque(data[below])) { queue.push(idx); continue; }
        if (lx > 0 && (light[idx - 1] >> 4) < 14 && !lightOpaque(data[idx - 1])) { queue.push(idx); continue; }
        if (lx < CS - 1 && (light[idx + 1] >> 4) < 14 && !lightOpaque(data[idx + 1])) { queue.push(idx); continue; }
        if (lz > 0 && (light[idx - CS] >> 4) < 14 && !lightOpaque(data[idx - CS])) { queue.push(idx); continue; }
        if (lz < CS - 1 && (light[idx + CS] >> 4) < 14 && !lightOpaque(data[idx + CS])) { queue.push(idx); }
      }
    }
  }
  bfs(data, light, queue, 4); // Himmelslicht-Kanal

  // 3) Blocklicht: Lava & Fackeln strahlen
  const bq = [];
  for (let i = 0; i < data.length; i++) {
    const em = lightEmission(data[i]);
    if (em > 0) {
      light[i] = (light[i] & 0xf0) | em;
      bq.push(i);
    }
  }
  bfs(data, light, bq, 0); // Blocklicht-Kanal

  return light;
}

// BFS-Ausbreitung eines Kanals (shift 4 = Himmel, 0 = Block) innerhalb des Chunks.
export function bfs(data, light, queue, shift) {
  const mask = 0x0f << shift;
  const other = 0x0f << (4 - shift);
  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const lvl = (light[idx] >> shift) & 0x0f;
    if (lvl <= 1) continue;
    const nl = lvl - 1;
    const y = (idx / YS) | 0;
    const rem = idx - y * YS;
    const lz = (rem / CS) | 0;
    const lx = rem - lz * CS;
    // 6 Nachbarn (nur innerhalb des Chunks)
    if (lx > 0) spread(idx - 1);
    if (lx < CS - 1) spread(idx + 1);
    if (lz > 0) spread(idx - CS);
    if (lz < CS - 1) spread(idx + CS);
    if (y > 0) spread(idx - YS);
    if (y < WH - 1) spread(idx + YS);

    function spread(n) {
      if (lightOpaque(data[n])) return;
      if (((light[n] >> shift) & 0x0f) >= nl) return;
      light[n] = (light[n] & other) | (nl << shift);
      queue.push(n);
    }
  }
}
