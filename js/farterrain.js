// Simplified distant landscape beyond the voxel detail radius ("Distant Horizons"-Stil):
// a ring of coarse heightmap tiles (64x64 blocks, sampled every 4) with biome colors,
// generated in a dedicated worker. Cheap enough for view distances up to 36 chunks.

import * as THREE from 'three';
import { CHUNK_SIZE, VOXEL_DETAIL_CAP } from './constants.js';
import { Settings } from './settings.js';

const TILE = 64;    // blocks per tile
const SAMPLE = 4;   // blocks per sample point

export class FarTerrain {
  constructor(ctx) {
    this.ctx = ctx;
    this.tiles = new Map();   // "tx,tz" -> mesh
    this.pending = new Set();
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this._timer = 1; // run on first update
    try {
      this.worker = new Worker(new URL('./genworker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => this._onTile(e.data);
    } catch {
      this.worker = null;
    }
  }

  update(dt, playerPos) {
    if (!this.worker) return;
    this._timer += dt;
    if (this._timer < 0.25) return;
    this._timer = 0;

    const R = Settings.renderDistance * CHUNK_SIZE;
    const voxelR = Math.min(Settings.renderDistance, VOXEL_DETAIL_CAP) * CHUNK_SIZE;
    if (R <= voxelR) {
      if (this.tiles.size) for (const key of [...this.tiles.keys()]) this._dispose(key);
      return;
    }

    const ptx = Math.floor(playerPos.x / TILE), ptz = Math.floor(playerPos.z / TILE);
    const tileR = Math.ceil(R / TILE) + 1;
    const needed = new Set();
    for (let dz = -tileR; dz <= tileR; dz++) {
      for (let dx = -tileR; dx <= tileR; dx++) {
        const tx = ptx + dx, tz = ptz + dz;
        const cx = tx * TILE + TILE / 2 - playerPos.x;
        const cz = tz * TILE + TILE / 2 - playerPos.z;
        const dist = Math.max(Math.abs(cx), Math.abs(cz));
        if (dist > R + TILE) continue;          // beyond view
        if (dist < voxelR - TILE) continue;      // fully covered by voxel chunks
        const key = tx + ',' + tz;
        needed.add(key);
        if (!this.tiles.has(key) && !this.pending.has(key) && this.pending.size < 8) {
          this.pending.add(key);
          this.worker.postMessage({
            type: 'fartile', key, tx, tz, seed: this.ctx.seed, size: TILE, sample: SAMPLE,
          });
        }
      }
    }
    for (const key of [...this.tiles.keys()]) {
      if (!needed.has(key)) this._dispose(key);
    }
  }

  _onTile(d) {
    this.pending.delete(d.key);
    if (this.tiles.has(d.key)) return;
    const heights = new Float32Array(d.heights);
    const colors = new Float32Array(d.colors);
    const n = d.n;

    const pos = new Float32Array(n * n * 3);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        pos[k * 3] = i * SAMPLE;
        pos[k * 3 + 1] = heights[k] - 0.4; // sit slightly below real voxels
        pos[k * 3 + 2] = j * SAMPLE;
      }
    }
    const idx = [];
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i, b = a + 1, c = a + n, e = c + 1;
        idx.push(a, c, b, b, c, e);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.set(d.tx * TILE, 0, d.tz * TILE);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.ctx.scene.add(mesh);
    this.tiles.set(d.key, mesh);
  }

  _dispose(key) {
    const mesh = this.tiles.get(key);
    if (!mesh) return;
    this.ctx.scene.remove(mesh);
    mesh.geometry.dispose();
    this.tiles.delete(key);
  }

  dispose() {
    for (const key of [...this.tiles.keys()]) this._dispose(key);
    if (this.worker) this.worker.terminate();
    this.material.dispose();
  }
}
