// Generation worker: builds chunk data and far-terrain tiles off the main thread.
// Several of these run in parallel (pools created by world.js / farterrain.js).

import { generateChunkData, farSample } from './worldgen.js';
import { computeLight } from './lighting.js';
import { buildChunkMesh } from './chunkmesher.js';
import { CHUNK_SIZE } from './constants.js';

const YSTRIDE = CHUNK_SIZE * CHUNK_SIZE;

self.onmessage = (e) => {
  const d = e.data;

  if (d.type === 'mesh') {
    // Chunk-Meshing off-thread: erweitertes Array rein, Vertex-Puffer raus.
    // Fehler (z. B. Speicherdruck) töten den Worker NICHT — der Main Thread
    // bekommt eine Fail-Nachricht und versucht es später erneut.
    try {
      const res = buildChunkMesh(new Uint16Array(d.data), new Uint8Array(d.light), d.maxY, d.copyTop);
      const transfer = [];
      for (const k of ['solid', 'water', 'lava']) {
        const b = res[k];
        if (b) transfer.push(b.pos.buffer, b.uv.buffer, b.col.buffer, b.idx.buffer);
      }
      self.postMessage({ type: 'mesh', key: d.key, ...res }, transfer);
    } catch (err) {
      self.postMessage({ type: 'meshfail', key: d.key, msg: String(err && err.message) });
    }
    return;
  }

  if (d.type === 'fartile') {
    // sampled heightmap tile with biome colors (simplified distant landscape)
    const { key, tx, tz, seed, size, sample } = d;
    const n = size / sample + 1;
    const heights = new Float32Array(n * n);
    const colors = new Float32Array(n * n * 3);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const s = farSample(seed, tx * size + i * sample, tz * size + j * sample);
        const k = j * n + i;
        heights[k] = s.h;
        colors[k * 3] = s.r;
        colors[k * 3 + 1] = s.g;
        colors[k * 3 + 2] = s.b;
      }
    }
    self.postMessage(
      { type: 'fartile', key, tx, tz, n, heights: heights.buffer, colors: colors.buffer },
      [heights.buffer, colors.buffer]
    );
    return;
  }

  // full chunk generation (+ initiale Licht-Berechnung)
  try {
    const { key, cx, cz, seed } = d;
    const data = generateChunkData(cx, cz, seed);
    let maxY = 0;
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i] !== 0) { maxY = (i / YSTRIDE) | 0; break; }
    }
    const light = computeLight(data, maxY);
    self.postMessage(
      { key, buffer: data.buffer, maxY, light: light.buffer },
      [data.buffer, light.buffer]
    );
  } catch (err) {
    self.postMessage({ type: 'genfail', key: d.key, msg: String(err && err.message) });
  }
};
