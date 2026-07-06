// Infinite chunked voxel world: streaming, meshing (face culling + vertex AO), edits.

import * as THREE from 'three';
import {
  CHUNK_SIZE as CS, WORLD_HEIGHT as WH, VOXEL_DETAIL_CAP,
  BLOCK, BLOCKS, blockIndex, chunkKey, isWaterId, isLavaId, fluidTop,
} from './constants.js';
import { generateChunkData } from './worldgen.js';
import { computeLight, lightOpaque, lightEmission, bfs } from './lighting.js';
import { buildChunkMesh } from './chunkmesher.js';
import { Settings } from './settings.js';

// offsets sorted by chebyshev ring, then euclidean — used for nearest-first streaming
const SORTED_OFFSETS = (() => {
  const list = [];
  const R = VOXEL_DETAIL_CAP + 4; // covers the max unload radius
  for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) list.push([dx, dz]);
  list.sort((a, b) => {
    const ra = Math.max(Math.abs(a[0]), Math.abs(a[1])), rb = Math.max(Math.abs(b[0]), Math.abs(b[1]));
    if (ra !== rb) return ra - rb;
    return (a[0] * a[0] + a[1] * a[1]) - (b[0] * b[0] + b[1] * b[1]);
  });
  return list;
})();

const YSTRIDE = CS * CS;

function computeMaxY(data) {
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i] !== 0) return (i / YSTRIDE) | 0;
  }
  return 0;
}

class Chunk {
  constructor(cx, cz) {
    this.cx = cx; this.cz = cz;
    this.data = null;
    this.light = null; // Nibble-gepackt: high = Himmelslicht, low = Blocklicht
    this.maxY = WH - 1; // highest non-air block; meshing only scans up to here
    this.solidMesh = null;
    this.waterMesh = null;
    this.lavaMesh = null;
    this.meshed = false;
    this.dirty = false;
    this.lightDirty = true; // Licht an den Grenzen von Nachbarn nachziehen
    this.meshInFlight = false;
  }
}

export class World {
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = ctx.scene;
    this.seed = ctx.seed;
    this.atlas = ctx.textures;
    this.chunks = new Map();
    this.edits = new Map(); // key -> Map(voxelIndex -> id)
    this._uvCache = new Map();
    this._unloadTimer = 0;

    // worker pool: chunk generation AND meshing run parallel off the main thread
    this._pending = new Set();
    this._workers = [];
    this._nextWorker = 0;
    this._meshInFlight = 0;
    this._workerBirth = performance.now();
    this._backoffUntil = 0; // bei Speicherdruck kurz keine neuen Jobs (GC-Atempause)
    try {
      const n = Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 4) - 2));
      for (let i = 0; i < n; i++) {
        const w = new Worker(new URL('./genworker.js', import.meta.url), { type: 'module' });
        w.onmessage = (e) => {
          const d = e.data;
          if (d.type === 'mesh') this._onMeshResult(d);
          else if (d.type === 'meshfail') this._onMeshFail(d);
          else if (d.type === 'genfail') this._onGenFail(d);
          else this._onGenerated(d);
        };
        w.onerror = (e) => {
          // Nur früh (Modul-Ladefehler) komplett aufgeben — spätere Fehler
          // (z. B. Speicherdruck) sind transient, Worker weiterbenutzen.
          if (performance.now() - this._workerBirth < 5000) {
            console.warn('Worker-Startfehler, wechsle auf synchrone Generierung:', e.message);
            this._teardownWorkers();
          } else {
            console.warn('Worker-Fehler (transient):', e.message);
            this._backoffUntil = performance.now() + 3000;
          }
        };
        this._workers.push(w);
      }
    } catch (err) {
      console.warn('Web Worker nicht verfügbar — generiere synchron:', err);
      this._workers = [];
    }
    // Terrain wird komplett über die eigene Licht-Engine beleuchtet (unlit Material):
    // vColor.g = Himmelslicht (skaliert mit Tageszeit), vColor.r = Blocklicht (konstant)
    this.dayLight = { value: 1 };
    // dynamisches Licht: gleitende Lichtquelle (Fackel in der Hand)
    this.dynLightPos = { value: new THREE.Vector3(0, -9999, 0) };
    this.dynLightStrength = { value: 0 };
    const injectLight = (shader) => {
      shader.uniforms.uDayLight = this.dayLight;
      shader.uniforms.uDynPos = this.dynLightPos;
      shader.uniforms.uDynStr = this.dynLightStrength;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
        .replace('#include <begin_vertex>',
          '#include <begin_vertex>\nvWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>',
          '#include <common>\nuniform float uDayLight;\nuniform vec3 uDynPos;\nuniform float uDynStr;\nvarying vec3 vWorldPos;')
        .replace('#include <color_fragment>', `{
          float dynT = clamp(1.0 - distance(vWorldPos, uDynPos) / 13.0, 0.0, 1.0);
          float dyn = dynT * dynT * uDynStr;
          diffuseColor.rgb *= max(max(max(vColor.g * uDayLight, vColor.r), dyn), 0.045);
        }`);
    };
    this.solidMat = new THREE.MeshBasicMaterial({
      map: this.atlas.texture, vertexColors: true, alphaTest: 0.5,
    });
    this.solidMat.onBeforeCompile = injectLight;
    this.waterMat = new THREE.MeshBasicMaterial({
      map: this.atlas.texture, vertexColors: true, transparent: true, opacity: 0.72,
      depthWrite: false, side: THREE.DoubleSide,
    });
    this.waterMat.onBeforeCompile = injectLight;
    // Lava ist selbstleuchtend, glüht auch in stockdunklen Höhlen
    this.lavaMat = new THREE.MeshBasicMaterial({ map: this.atlas.texture, vertexColors: true });
  }

  get chunkCount() { return this.chunks.size; }

  _teardownWorkers() {
    for (const w of this._workers) w.terminate();
    this._workers = [];
    this._pending.clear();
  }

  _onGenerated({ key, buffer, maxY, light }) {
    this._pending.delete(key);
    const c = this.chunks.get(key);
    if (!c || c.data) return; // chunk was unloaded (or raced) meanwhile
    c.data = new Uint16Array(buffer); // Block-ids bis 65535 (Items beginnen bei 1000)
    c.maxY = maxY;
    const em = this.edits.get(key);
    if (em) {
      for (const [idx, id] of em) {
        c.data[idx] = id;
        const y = (idx / YSTRIDE) | 0;
        if (id !== 0 && y > c.maxY) c.maxY = y;
      }
      // Edits verändern das Licht → neu berechnen
      c.light = computeLight(c.data, c.maxY);
    } else {
      c.light = light ? new Uint8Array(light) : computeLight(c.data, c.maxY);
    }
  }

  getChunk(cx, cz) { return this.chunks.get(chunkKey(cx, cz)); }

  getBlock(x, y, z) {
    if (y < 0) return BLOCK.BEDROCK;
    if (y >= WH) return BLOCK.AIR;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c || !c.data) return -1;
    return c.data[blockIndex(x - cx * CS, y, z - cz * CS)];
  }

  setBlock(x, y, z, id) {
    if (y < 0 || y >= WH) return;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const key = chunkKey(cx, cz);
    const c = this.chunks.get(key);
    if (!c || !c.data) return;
    const lx = x - cx * CS, lz = z - cz * CS;
    const old = c.data[blockIndex(lx, y, lz)];
    c.data[blockIndex(lx, y, lz)] = id;
    if (id !== 0 && y > c.maxY) c.maxY = y;
    // record edit so it survives unload + save
    let em = this.edits.get(key);
    if (!em) { em = new Map(); this.edits.set(key, em); }
    em.set(blockIndex(lx, y, lz), id);
    c.dirty = true;
    // Licht nur neu berechnen, wenn sich Lichtdurchlässigkeit oder Leuchten ändert —
    // Wasser-/Fluidbewegung ist lichtneutral (verhindert Relight-Stürme bei Fluten)
    const relightNeeded = lightOpaque(old) !== lightOpaque(id) || lightEmission(old) !== lightEmission(id);
    if (relightNeeded) {
      c.relight = true;
      c.lightDirty = true;
    }
    const touchNb = (ncx, ncz, near) => {
      if (!near) return;
      const nc = this.chunks.get(chunkKey(ncx, ncz));
      if (nc && nc.meshed) {
        if (relightNeeded) nc.lightDirty = true;
        nc.dirty = true;
      }
    };
    touchNb(cx - 1, cz, relightNeeded ? lx <= 8 : lx === 0);
    touchNb(cx + 1, cz, relightNeeded ? lx >= CS - 9 : lx === CS - 1);
    touchNb(cx, cz - 1, relightNeeded ? lz <= 8 : lz === 0);
    touchNb(cx, cz + 1, relightNeeded ? lz >= CS - 9 : lz === CS - 1);
    this.ctx.onBlockEdit?.(x, y, z, id, old);
  }

  _markDirty(cx, cz) {
    const c = this.chunks.get(chunkKey(cx, cz));
    if (c && c.meshed) c.dirty = true;
  }

  applyEdits(obj) {
    for (const key of Object.keys(obj)) {
      let em = this.edits.get(key);
      if (!em) { em = new Map(); this.edits.set(key, em); }
      for (const [idxStr, id] of Object.entries(obj[key])) em.set(Number(idxStr), id);
      const c = this.chunks.get(key);
      if (c && c.data) {
        for (const [idx, id] of em) {
          c.data[idx] = id;
          const y = (idx / YSTRIDE) | 0;
          if (id !== 0 && y > c.maxY) c.maxY = y;
        }
        c.dirty = true;
      }
    }
  }

  getEdits() {
    const out = {};
    for (const [key, em] of this.edits) {
      const o = {};
      for (const [idx, id] of em) o[idx] = id;
      out[key] = o;
    }
    return out;
  }

  isLoaded(x, z) {
    const c = this.chunks.get(chunkKey(Math.floor(x / CS), Math.floor(z / CS)));
    return !!(c && c.data);
  }

  // Licht an Weltkoordinate (Nibble-Byte); ungeladene Bereiche gelten als voll himmelshell
  getLight(x, y, z) {
    if (y >= WH) return 0xf0;
    if (y < 0) return 0;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c || !c.light) return 0xf0;
    return c.light[blockIndex(x - cx * CS, y, z - cz * CS)];
  }

  // Licht von den 4 Nachbarn über die Chunk-Grenzen hereinziehen (BFS im eigenen Chunk).
  // Monoton aufhellend → konvergiert; danach ggf. Nachbarn zum Nachziehen markieren.
  _pullLight(c) {
    if (!c.data || !c.light) return;
    const seeds = [];
    const pull = (nc, myLx, myLz, theirLx, theirLz, along) => {
      if (!nc || !nc.light) return;
      const top = Math.min(WH - 1, Math.max(c.maxY, nc.maxY) + 1);
      for (let y = 0; y <= top; y++) {
        for (let k = 0; k < CS; k++) {
          const mi = blockIndex(along === 'x' ? myLx : k, y, along === 'x' ? k : myLz);
          if (lightOpaque(c.data[mi])) continue;
          const ti = blockIndex(along === 'x' ? theirLx : k, y, along === 'x' ? k : theirLz);
          const tl = nc.light[ti];
          const ml = c.light[mi];
          const sIn = (tl >> 4) - 1, bIn = (tl & 0x0f) - 1;
          let changed = false;
          let nv = ml;
          if (sIn > (ml >> 4)) { nv = (nv & 0x0f) | (sIn << 4); changed = true; }
          if (bIn > (ml & 0x0f)) { nv = (nv & 0xf0) | bIn; changed = true; }
          if (changed) { c.light[mi] = nv; seeds.push(mi); }
        }
      }
    };
    pull(this.chunks.get(chunkKey(c.cx - 1, c.cz)), 0, 0, CS - 1, 0, 'x');
    pull(this.chunks.get(chunkKey(c.cx + 1, c.cz)), CS - 1, 0, 0, 0, 'x');
    pull(this.chunks.get(chunkKey(c.cx, c.cz - 1)), 0, 0, 0, CS - 1, 'z');
    pull(this.chunks.get(chunkKey(c.cx, c.cz + 1)), 0, CS - 1, 0, 0, 'z');
    if (!seeds.length) {
      c.lightDirty = false;
      return false;
    }
    // Grenz-Schnappschüsse: Nachbarn nur wecken, wenn sich ihre gemeinsame
    // Grenze wirklich geändert hat — verhindert endloses Remesh-Ping-Pong
    const top = Math.min(WH - 1, c.maxY + 1);
    const snap = (lx, lz, along) => {
      const out = new Uint8Array(CS * (top + 1));
      let i = 0;
      for (let y = 0; y <= top; y++) {
        for (let k = 0; k < CS; k++) {
          out[i++] = c.light[along === 'x' ? blockIndex(lx, y, k) : blockIndex(k, y, lz)];
        }
      }
      return out;
    };
    const before = [snap(0, 0, 'x'), snap(CS - 1, 0, 'x'), snap(0, 0, 'z'), snap(0, CS - 1, 'z')];
    bfs(c.data, c.light, [...seeds], 4);
    bfs(c.data, c.light, seeds, 0);
    const after = [snap(0, 0, 'x'), snap(CS - 1, 0, 'x'), snap(0, 0, 'z'), snap(0, CS - 1, 'z')];
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (let i = 0; i < 4; i++) {
      const a = before[i], b = after[i];
      let diff = false;
      for (let j = 0; j < a.length; j++) {
        if (a[j] !== b[j]) { diff = true; break; }
      }
      if (!diff) continue;
      const nc = this.chunks.get(chunkKey(c.cx + dirs[i][0], c.cz + dirs[i][1]));
      if (nc && nc.meshed && !nc.lightDirty) nc.lightDirty = true;
    }
    c.lightDirty = false;
    return true;
  }

  surfaceY(x, z) {
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c || !c.data) return -1;
    const lx = x - cx * CS, lz = z - cz * CS;
    for (let y = c.maxY; y >= 0; y--) {
      const id = c.data[blockIndex(lx, y, lz)];
      if (id !== BLOCK.AIR && !isWaterId(id) && !isLavaId(id)) return y;
    }
    return -1;
  }

  isReadyAround(x, z, radius = 1) {
    const pcx = Math.floor(x / CS), pcz = Math.floor(z / CS);
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
      const c = this.chunks.get(chunkKey(pcx + dx, pcz + dz));
      if (!c || !c.meshed) return false;
    }
    return true;
  }

  update(dt, playerPos, anchors = []) {
    const pcx = Math.floor(playerPos.x / CS), pcz = Math.floor(playerPos.z / CS);
    // dynamic radii from the settings menu (voxel detail capped, far terrain beyond).
    // ctx.renderDistance überschreibt die globale Einstellung (z. B. leichter Menü-Hintergrund).
    const R = Math.min(this.ctx.renderDistance ?? Settings.renderDistance, VOXEL_DETAIL_CAP);
    const GEN = R + 1, UNLOAD = R + 3;

    // 1) generate chunk data, nearest first — parallel via workers when available
    const useWorkers = this._workers.length > 0;
    const inBackoff = performance.now() < this._backoffUntil; // GC-Atempause nach Speicherdruck
    const maxPending = this._workers.length * 2;
    let syncBudget = 1; // fallback without workers
    for (const [dx, dz] of SORTED_OFFSETS) {
      if (inBackoff) break;
      const r = Math.max(Math.abs(dx), Math.abs(dz));
      if (r > GEN) break;
      const cx = pcx + dx, cz = pcz + dz;
      const key = chunkKey(cx, cz);
      let c = this.chunks.get(key);
      if (!c) { c = new Chunk(cx, cz); this.chunks.set(key, c); }
      if (c.data || this._pending.has(key)) continue;
      if (useWorkers) {
        if (this._pending.size >= maxPending) break;
        this._pending.add(key);
        const w = this._workers[this._nextWorker++ % this._workers.length];
        w.postMessage({ key, cx, cz, seed: this.seed });
      } else {
        if (syncBudget <= 0) break;
        const data = generateChunkData(cx, cz, this.seed);
        this._onGenerated({ key, buffer: data.buffer, maxY: computeMaxY(data) });
        syncBudget--;
      }
    }

    // fertige Mesh-Ergebnisse häppchenweise auf die GPU laden
    this._applyQueuedMeshes(8);

    // 2) mesh chunks: an Worker verteilen (dirty + nächste zuerst)
    let meshBudget = useWorkers ? 6 : 2;
    const maxMeshInFlight = this._workers.length * 2;
    for (const [dx, dz] of SORTED_OFFSETS) {
      if (meshBudget <= 0 || inBackoff) break;
      if (useWorkers && this._meshInFlight >= maxMeshInFlight) break;
      const r = Math.max(Math.abs(dx), Math.abs(dz));
      if (r > R) break;
      const c = this.chunks.get(chunkKey(pcx + dx, pcz + dz));
      if (!c || !c.data || c.meshInFlight || (c.meshed && !c.dirty && !c.lightDirty)) continue;
      if (!this._neighborsReady(c.cx, c.cz)) continue;
      let lightChanged = false;
      if (c.relight) { c.light = computeLight(c.data, c.maxY); c.relight = false; lightChanged = true; }
      if (c.lightDirty) lightChanged = this._pullLight(c) || lightChanged;
      // Nur remeshen, wenn sich wirklich etwas geändert hat (kein Ping-Pong-Meshing)
      if (c.meshed && !c.dirty && !lightChanged) continue;
      c.dirty = false;
      const { expD, expL, copyTop } = this._expandForMesh(c);
      if (useWorkers) {
        c.meshInFlight = true;
        this._meshInFlight++;
        const w = this._workers[this._nextWorker++ % this._workers.length];
        w.postMessage(
          { type: 'mesh', key: chunkKey(c.cx, c.cz), maxY: c.maxY, copyTop, data: expD.buffer, light: expL.buffer },
          [expD.buffer, expL.buffer]
        );
      } else {
        try {
          this._applyMeshResult(c, buildChunkMesh(expD, expL, c.maxY, copyTop));
        } catch (err) {
          c.dirty = true; // später erneut — Frame-Loop darf nie sterben
          this._backoffUntil = performance.now() + 3000;
          console.warn('Sync-Meshing fehlgeschlagen (Retry nach Backoff):', err.message);
          break;
        }
      }
      meshBudget--;
    }

    // 2b) Mehrspieler-Host: Chunk-DATEN um entfernte Mitspieler erzeugen (kein
    // Meshing/Rendern) — nötig, damit Mobs auch um sie herum spawnen können.
    if (anchors.length) this._genAroundAnchors(anchors);

    // 3) unload far chunks (throttled) — Anker-Chunks bleiben erhalten
    this._unloadTimer += dt;
    if (this._unloadTimer > 1) {
      this._unloadTimer = 0;
      const ankerZellen = anchors.map((a) => [Math.floor(a.x / CS), Math.floor(a.z / CS)]);
      for (const [key, c] of this.chunks) {
        if (Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz)) <= UNLOAD) continue;
        let naheAnker = false;
        for (const [ax, az] of ankerZellen) {
          if (Math.max(Math.abs(c.cx - ax), Math.abs(c.cz - az)) <= 4) { naheAnker = true; break; }
        }
        if (naheAnker) continue;
        this._disposeChunkMeshes(c);
        this.chunks.delete(key);
      }
    }
  }

  // Nur Chunk-DATEN um zusätzliche Anker (Mitspieler) erzeugen — der Host rendert
  // sie nicht, braucht sie aber für Mob-Spawns & -Simulation in ihrer Nähe.
  _genAroundAnchors(anchors) {
    const RAD = 3; // ~48 Blöcke Radius, deckt die Spawn-Distanz (20–40) ab
    const useWorkers = this._workers.length > 0;
    // Kleines RESERVIERTES Budget, damit die eigene Gebiets-Generierung des Hosts
    // die Anker-Chunks nicht dauerhaft aushungert (sonst spawnen um bewegliche
    // Mitspieler nie Mobs). Max. 2 neue Anker-Chunks pro Frame.
    const grenze = this._pending.size + 2;
    let budget = 2;
    for (const a of anchors) {
      const acx = Math.floor(a.x / CS), acz = Math.floor(a.z / CS);
      for (let dz = -RAD; dz <= RAD; dz++) {
        for (let dx = -RAD; dx <= RAD; dx++) {
          if (budget <= 0) return;
          const cx = acx + dx, cz = acz + dz;
          const key = chunkKey(cx, cz);
          let c = this.chunks.get(key);
          if (!c) { c = new Chunk(cx, cz); this.chunks.set(key, c); }
          if (c.data || this._pending.has(key)) continue;
          if (useWorkers) {
            if (this._pending.size >= grenze) return; // Reserve erschöpft
            this._pending.add(key);
            const w = this._workers[this._nextWorker++ % this._workers.length];
            w.postMessage({ key, cx, cz, seed: this.seed });
            budget--;
          } else {
            const data = generateChunkData(cx, cz, this.seed);
            this._onGenerated({ key, buffer: data.buffer, maxY: computeMaxY(data) });
            return; // ohne Worker nur 1 Chunk pro Frame
          }
        }
      }
    }
  }

  _neighborsReady(cx, cz) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const c = this.chunks.get(chunkKey(cx + dx, cz + dz));
      if (!c || !c.data) return false;
    }
    return true;
  }

  _disposeChunkMeshes(c) {
    for (const m of [c.solidMesh, c.waterMesh, c.lavaMesh]) {
      if (m) { this.scene.remove(m); m.geometry.dispose(); }
    }
    c.solidMesh = null; c.waterMesh = null; c.lavaMesh = null;
    c.meshed = false;
  }

  dispose() {
    this._teardownWorkers();
    for (const c of this.chunks.values()) this._disposeChunkMeshes(c);
    this.chunks.clear();
    this.solidMat.dispose();
    this.waterMat.dispose();
    this.lavaMat.dispose();
  }

  // ---- meshing (läuft im Worker; hier nur Packen & Anwenden) ----

  // Chunk + 1-Block-Rand der Nachbarn in ein 18×H×18-Array packen (Transferables)
  _expandForMesh(c) {
    const G2 = CS + 2, GG2 = G2 * G2;
    const copyTop = Math.min(WH - 1, c.maxY + 2);
    const size = GG2 * (copyTop + 1);
    const expD = new Uint16Array(size); // Blockdaten: 16 Bit
    const expL = new Uint8Array(size);  // Licht bleibt Nibble-gepackt in 8 Bit
    // eigener Chunk
    for (let y = 0; y <= copyTop; y++) {
      const yo = y * GG2;
      for (let lz = 0; lz < CS; lz++) {
        const srcI = blockIndex(0, y, lz);
        const dst = 1 + (lz + 1) * G2 + yo;
        expD.set(c.data.subarray(srcI, srcI + CS), dst);
        expL.set(c.light.subarray(srcI, srcI + CS), dst);
      }
    }
    // Kanten der 4 Nachbarn
    const edge = (nc, myEx, myEz, theirLx, theirLz, along) => {
      if (!nc || !nc.data || !nc.light) return;
      for (let y = 0; y <= copyTop; y++) {
        const yo = y * GG2;
        for (let k = 0; k < CS; k++) {
          const srcI = along === 'x' ? blockIndex(theirLx, y, k) : blockIndex(k, y, theirLz);
          const dst = along === 'x' ? (myEx + (k + 1) * G2 + yo) : ((k + 1) + myEz * G2 + yo);
          expD[dst] = nc.data[srcI];
          expL[dst] = nc.light[srcI];
        }
      }
    };
    edge(this.chunks.get(chunkKey(c.cx - 1, c.cz)), 0, 0, CS - 1, 0, 'x');
    edge(this.chunks.get(chunkKey(c.cx + 1, c.cz)), G2 - 1, 0, 0, 0, 'x');
    edge(this.chunks.get(chunkKey(c.cx, c.cz - 1)), 0, 0, 0, CS - 1, 'z');
    edge(this.chunks.get(chunkKey(c.cx, c.cz + 1)), 0, G2 - 1, 0, 0, 'z');
    // Ecken der Diagonal-Nachbarn (nur für AO relevant)
    const corner = (nc, ex, ez, tlx, tlz) => {
      if (!nc || !nc.data) return;
      for (let y = 0; y <= copyTop; y++) {
        const srcI = blockIndex(tlx, y, tlz);
        const dst = ex + ez * G2 + y * GG2;
        expD[dst] = nc.data[srcI];
        expL[dst] = nc.light ? nc.light[srcI] : 0;
      }
    };
    corner(this.chunks.get(chunkKey(c.cx - 1, c.cz - 1)), 0, 0, CS - 1, CS - 1);
    corner(this.chunks.get(chunkKey(c.cx + 1, c.cz - 1)), G2 - 1, 0, 0, CS - 1);
    corner(this.chunks.get(chunkKey(c.cx - 1, c.cz + 1)), 0, G2 - 1, CS - 1, 0);
    corner(this.chunks.get(chunkKey(c.cx + 1, c.cz + 1)), G2 - 1, G2 - 1, 0, 0);
    return { expD, expL, copyTop };
  }

  _onMeshResult(d) {
    this._meshInFlight = Math.max(0, this._meshInFlight - 1);
    const c = this.chunks.get(d.key);
    if (!c || !c.data) return; // Chunk wurde inzwischen entladen
    c.meshInFlight = false;
    // GPU-Uploads pro Frame drosseln; pro Chunk zählt nur das NEUESTE Ergebnis
    // (Map statt Queue — sonst stauen sich bei Remesh-Wellen tausende Resultate)
    (this._meshResults ??= new Map()).set(d.key, d);
  }

  _onMeshFail(d) {
    this._meshInFlight = Math.max(0, this._meshInFlight - 1);
    const c = this.chunks.get(d.key);
    if (c) { c.meshInFlight = false; c.dirty = true; } // später erneut versuchen
    this._backoffUntil = performance.now() + 3000;
    console.warn('Mesh-Job fehlgeschlagen (Retry nach Backoff):', d.msg);
  }

  _onGenFail(d) {
    this._pending.delete(d.key);
    this._backoffUntil = performance.now() + 3000;
    console.warn('Generierungs-Job fehlgeschlagen (Retry nach Backoff):', d.msg);
  }

  _applyQueuedMeshes(budget) {
    const q = this._meshResults;
    if (!q || !q.size) return;
    for (const [key, d] of q) {
      if (budget-- <= 0) break;
      q.delete(key);
      const c = this.chunks.get(key);
      if (!c || !c.data) continue;
      this._applyMeshResult(c, d);
    }
  }

  _applyMeshResult(c, res) {
    const ox = c.cx * CS, oz = c.cz * CS;
    this._disposeChunkMeshes(c);
    c.solidMesh = this._makeMesh(res.solid, this.solidMat, ox, oz, 0);
    c.waterMesh = this._makeMesh(res.water, this.waterMat, ox, oz, 1);
    c.lavaMesh = this._makeMesh(res.lava, this.lavaMat, ox, oz, 0);
    c.meshed = true;
  }

  _makeMesh(b, material, ox, oz, renderOrder) {
    if (!b) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(b.pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(b.uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(b.col, 3));
    g.setIndex(new THREE.BufferAttribute(b.idx, 1));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, material);
    mesh.position.set(ox, 0, oz);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.renderOrder = renderOrder;
    this.scene.add(mesh);
    return mesh;
  }
}
