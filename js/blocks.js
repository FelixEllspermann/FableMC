// Spezialblock-Verwaltung: Truhen-Inventare, Tür-/Bett-Paarpflege, Leiter-Halt.

import { BLOCK, BLOCKS, ITEM, isBedId, isSolid, isWaterId } from './constants.js';

export class SpecialBlocks {
  constructor(ctx) {
    this.ctx = ctx;
    this.chests = new Map();     // "x,y,z" → { slots: Array(27) }
    this.lootEvents = new Map(); // "x,y,z" → { phase: 1|2 }
  }

  // ---- Dschungeltempel: versiegelte Truhe mit Monsterwellen ----

  triggerLootChest(x, y, z, vonId = 0) {
    const key = x + ',' + y + ',' + z;
    const net = this.ctx.net;
    // Gast: Auslösung an den Host schicken — der simuliert die Wellen
    if (net?.active && !net.isHost && vonId === 0) {
      this._ausgelöst ??= new Set();
      if (this._ausgelöst.has(key)) {
        this.ctx.ui.toast('Die Truhe ist noch versiegelt — besiege alle Wächter!');
        return;
      }
      this._ausgelöst.add(key);
      net.sendEvTrig(x, y, z);
      this.ctx.ui.toast('⚔ Die Truhe erwacht! Welle 1: Wächter greifen an!');
      this.ctx.sounds.fuse();
      return;
    }
    if (this.lootEvents.has(key)) {
      if (vonId === 0) this.ctx.ui.toast('Die Truhe ist noch versiegelt — besiege alle Wächter!');
      return;
    }
    this.lootEvents.set(key, { phase: 1, wer: vonId });
    this._spawnWave(key, 1, vonId);
    this.ctx.ui.toast('⚔ Die Truhe erwacht! Welle 1: Wächter greifen an!');
    this.ctx.sounds.fuse();
  }

  // Position eines Spielers (0 = ich, sonst Mitspieler-Avatar)
  _playerPosById(id) {
    if (id) {
      const r = this.ctx.net?.remote.get(id);
      if (r) return r.mesh.position;
    }
    return this.ctx.player.pos;
  }

  // Spawnposition um eine Spieler-Position herum finden (Bodensuche nahe Spielerhöhe)
  _spawnSpotNear(p, dist) {
    const w = this.ctx.world;
    const a = Math.random() * Math.PI * 2;
    const x = Math.floor(p.x + Math.cos(a) * dist);
    const z = Math.floor(p.z + Math.sin(a) * dist);
    let y = Math.floor(p.y) + 2;
    for (let i = 0; i < 8 && y > 2; i++, y--) {
      if (isSolid(w.getBlock(x, y - 1, z)) &&
          !isSolid(w.getBlock(x, y, z)) && !isSolid(w.getBlock(x, y + 1, z))) {
        return { x, y, z };
      }
    }
    return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
  }

  _spawnWave(key, phase, vonId = 0) {
    const ents = this.ctx.entities;
    const pos = this._playerPosById(vonId); // Wellen erscheinen um den Auslöser
    if (phase === 1) {
      // Welle 1: Zombies + Skelette rund um den Spieler
      for (let i = 0; i < 4; i++) {
        const s = this._spawnSpotNear(pos, 3.5 + Math.random() * 3);
        ents._spawnMob('zombie', s.x, s.y, s.z, { eventKey: key });
      }
      for (let i = 0; i < 3; i++) {
        const s = this._spawnSpotNear(pos, 4 + Math.random() * 4);
        ents._spawnMob('skeleton', s.x, s.y, s.z, { eventKey: key });
      }
    } else {
      // Welle 2: 4 Mega-Zombies (50% größer) mit 1–2 zufälligen Modifiern
      const POOL = ['schaden', 'tempo', 'anker', 'leben', 'split'];
      for (let i = 0; i < 4; i++) {
        const s = this._spawnSpotNear(pos, 4 + Math.random() * 3);
        const mods = [POOL[(Math.random() * POOL.length) | 0]];
        if (Math.random() < 0.5) {
          const zweiter = POOL[(Math.random() * POOL.length) | 0];
          if (!mods.includes(zweiter)) mods.push(zweiter);
        }
        ents._spawnMob('zombie', s.x, s.y, s.z, {
          eventKey: key, scale: 1.5, hp: 40,
          moveSpeed: mods.includes('tempo') ? 3.7 : 2.4,
          attackDamage: mods.includes('schaden') ? 8 : 5,
          modifiers: mods,
        });
      }
    }
  }

  // Magier-Truhe: beim ersten Öffnen mit Turm-Beute füllen, dann normale Truhe
  openTowerChest(x, y, z) {
    const c = this.getChest(x, y, z);
    const SHARDS = [ITEM.CRYSTAL_BLUE_SHARD, ITEM.CRYSTAL_PURPLE_SHARD,
      ITEM.CRYSTAL_GREEN_SHARD, ITEM.CRYSTAL_ORANGE_SHARD];
    // 8%: eine zufällige Schriftrolle (das Highlight)
    if (Math.random() < 0.08) {
      const rollen = [ITEM.SCROLL_MINING, ITEM.SCROLL_WATER, ITEM.SCROLL_LEVITATION];
      c.slots[13] = { id: rollen[(Math.random() * 3) | 0], count: 1 };
    }
    // sehr seltenes Highlight: ein Spell Core für den Verzauberungstisch
    if (Math.random() < 0.06) c.slots[4] = { id: ITEM.SPELL_CORE, count: 1 };
    // Kristalle (1–2 Farben), Diamanten, Gold, Knochen — bewusst KEIN Eisen
    const frei = [3, 5, 11, 15, 21, 23];
    let fi = 0;
    const lege = (id, count) => { if (fi < frei.length) c.slots[frei[fi++]] = { id, count }; };
    lege(SHARDS[(Math.random() * 4) | 0], 2 + (Math.random() * 5 | 0));
    if (Math.random() < 0.5) lege(SHARDS[(Math.random() * 4) | 0], 1 + (Math.random() * 3 | 0));
    if (Math.random() < 0.5) lege(ITEM.DIAMOND, 1 + (Math.random() * 2 | 0));
    if (Math.random() < 0.6) lege(ITEM.GOLD_INGOT, 1 + (Math.random() * 3 | 0));
    if (Math.random() < 0.7) lege(ITEM.BONE, 2 + (Math.random() * 4 | 0));
    this._tauscheZuTruhe(x, y, z);
    this.ctx.sounds.pickup();
  }

  // Schiffstruhe: hauptsächlich Gold, Diamanten und Eisen
  openWreckChest(x, y, z) {
    const c = this.getChest(x, y, z);
    const frei = [3, 5, 11, 13, 15, 21, 23];
    let fi = 0;
    const lege = (id, count) => { if (fi < frei.length) c.slots[frei[fi++]] = { id, count }; };
    lege(ITEM.GOLD_INGOT, 2 + (Math.random() * 4 | 0));
    if (Math.random() < 0.9) lege(ITEM.IRON_INGOT, 2 + (Math.random() * 5 | 0));
    if (Math.random() < 0.55) lege(ITEM.DIAMOND, 1 + (Math.random() * 3 | 0));
    if (Math.random() < 0.5) lege(ITEM.RAW_GOLD, 1 + (Math.random() * 3 | 0));
    if (Math.random() < 0.5) lege(ITEM.RAW_IRON, 2 + (Math.random() * 3 | 0));
    this._tauscheZuTruhe(x, y, z);
    this.ctx.sounds.pickup();
  }

  // Dungeon-Truhe: gemischte Ausrüstungs-Beute, kleine Chance auf Rolle/Rune
  openDungeonChest(x, y, z) {
    const c = this.getChest(x, y, z);
    const frei = [3, 5, 11, 13, 15, 21, 23];
    let fi = 0;
    const lege = (id, count) => { if (fi < frei.length) c.slots[frei[fi++]] = { id, count }; };
    if (Math.random() < 0.06) {
      const rollen = [ITEM.SCROLL_MINING, ITEM.SCROLL_WATER, ITEM.SCROLL_LEVITATION];
      lege(rollen[(Math.random() * 3) | 0], 1);
    } else if (Math.random() < 0.05) {
      lege(ITEM.SOCKET_RUNE, 1);
    }
    if (Math.random() < 0.8) lege(ITEM.BONE, 2 + (Math.random() * 4 | 0));
    if (Math.random() < 0.7) lege(ITEM.IRON_INGOT, 2 + (Math.random() * 4 | 0));
    if (Math.random() < 0.6) lege(ITEM.COAL, 3 + (Math.random() * 6 | 0));
    if (Math.random() < 0.5) lege(ITEM.GOLD_INGOT, 1 + (Math.random() * 4 | 0));
    if (Math.random() < 0.25) lege(ITEM.DIAMOND, 1 + (Math.random() * 2 | 0));
    if (Math.random() < 0.4) lege(ITEM.COOKED_PORKCHOP, 1 + (Math.random() * 2 | 0));
    this._tauscheZuTruhe(x, y, z);
    this.ctx.sounds.pickup();
  }

  // ---- Monster-Spawner: spawnen bei Spielernähe, bis man sie zerschlägt ----

  _updateSpawners(dt) {
    const w = this.ctx.world;
    const p = this.ctx.player?.pos;
    if (!p) return;
    // Registry: 1×/s nach Spawner-Blöcken in der Nähe suchen
    this._spawnerScan = (this._spawnerScan || 0) + dt;
    if (this._spawnerScan >= 1) {
      this._spawnerScan = 0;
      this._spawnerZellen = [];
      this._bossZellen = [];
      const px = Math.floor(p.x), py = Math.floor(p.y), pz = Math.floor(p.z);
      for (let x = px - 14; x <= px + 14; x++) {
        for (let z = pz - 14; z <= pz + 14; z++) {
          for (let y = Math.max(1, py - 10); y <= py + 10; y++) {
            const id = w.getBlock(x, y, z);
            if (id === BLOCK.SPAWNER) this._spawnerZellen.push([x, y, z]);
            else if (id === BLOCK.BOSS_SPAWNER) this._bossZellen.push([x, y, z]);
          }
        }
      }
    }
    this._checkBossSpawn(p);
    if (!this._spawnerZellen?.length) return;
    this._spawnerTimer ??= new Map();
    const fx = this.ctx.furnaces;
    for (const [sx, sy, sz] of this._spawnerZellen) {
      const key = sx + ',' + sy + ',' + sz;
      const dist = Math.hypot(sx + 0.5 - p.x, sy - p.y, sz + 0.5 - p.z);
      if (dist > 12) continue;
      // Käfig-Glut
      if (Math.random() < dt * 6) {
        fx?.dot(sx + 0.3 + Math.random() * 0.4, sy + 0.4 + Math.random() * 0.4, sz + 0.3 + Math.random() * 0.4, {
          vx: (Math.random() - 0.5) * 0.6, vy: 0.3, vz: (Math.random() - 0.5) * 0.6,
          life: 0.4, r: 1, g: 0.5, b: 0.1,
        });
      }
      let t = this._spawnerTimer.get(key) ?? 1.5;
      t -= dt;
      if (t <= 0) {
        t = 3.5 + Math.random() * 2;
        // Cap: max. 4 lebende Monster pro Spawner
        const lebend = this.ctx.entities.list.filter(
          (e) => e.spawnerKey === key && !e.remove && e.dying <= 0).length;
        if (lebend < 4) {
          // freien Platz neben dem Spawner suchen
          for (let versuch = 0; versuch < 6; versuch++) {
            const ox = sx + Math.floor(Math.random() * 5) - 2;
            const oz = sz + Math.floor(Math.random() * 5) - 2;
            if (w.getBlock(ox, sy, oz) !== BLOCK.AIR ||
                w.getBlock(ox, sy + 1, oz) !== BLOCK.AIR ||
                !isSolid(w.getBlock(ox, sy - 1, oz))) continue;
            this.ctx.entities._spawnMob(
              Math.random() < 0.6 ? 'zombie' : 'skeleton', ox, sy, oz, { spawnerKey: key });
            fx?.burst(ox + 0.5, sy + 0.8, oz + 0.5, 8);
            break;
          }
        }
      }
      this._spawnerTimer.set(key, t);
    }
  }

  // Blutkern der Badlands-Ruine: beschwört den Boss, sobald der Spieler eintritt
  _checkBossSpawn(p) {
    if (!this._bossZellen?.length) return;
    const w = this.ctx.world;
    const ents = this.ctx.entities;
    for (const [sx, sy, sz] of this._bossZellen) {
      const key = sx + ',' + sy + ',' + sz;
      const dist = Math.hypot(sx + 0.5 - p.x, sy - p.y, sz + 0.5 - p.z);
      if (dist > 11) continue;
      // schon ein Boss von diesem Kern lebendig? dann nicht erneut beschwören
      if (ents.list.some((e) => e.isBoss && e.spawnerKey === key && !e.remove && e.dying <= 0)) continue;
      // freien Stand mit Boden neben dem Kern suchen
      for (let versuch = 0; versuch < 12; versuch++) {
        const ox = sx + Math.floor(Math.random() * 7) - 3;
        const oz = sz + Math.floor(Math.random() * 7) - 3;
        if (w.getBlock(ox, sy - 1, oz) === BLOCK.AIR) continue; // Boden nötig
        if (w.getBlock(ox, sy, oz) !== BLOCK.AIR || w.getBlock(ox, sy + 1, oz) !== BLOCK.AIR ||
            w.getBlock(ox, sy + 2, oz) !== BLOCK.AIR) continue; // Platz für den großen Boss
        ents.spawnBoss(ox, sy, oz, key);
        break;
      }
    }
  }

  update(dt) {
    // Gäste simulieren weder Spawner noch Events — das macht der Host
    if (this.ctx.net?.active && !this.ctx.net.isHost) return;
    this._updateSpawners(dt);
    if (this.lootEvents.size === 0) return;
    this._eventTimer = (this._eventTimer || 0) + dt;
    if (this._eventTimer < 0.5) return;
    this._eventTimer = 0;
    for (const [key, ev] of this.lootEvents) {
      const lebend = this.ctx.entities.list.some(
        (e) => e.eventKey === key && !e.remove && e.dying <= 0);
      if (lebend) continue;
      if (ev.phase === 1) {
        ev.phase = 2;
        this._spawnWave(key, 2, ev.wer);
        this.ctx.ui.toast('⚔ Welle 2: MEGA-Zombies! Vorsicht!');
        this.ctx.sounds.explode();
      } else {
        // Ereignis geschafft: Truhe wird zur normalen Truhe voller Beute
        this.lootEvents.delete(key);
        const [x, y, z] = key.split(',').map(Number);
        if (this.ctx.world.getBlock(x, y, z) === BLOCK.LOOT_CHEST) {
          const c = this.getChest(x, y, z);
          c.slots[13] = { id: ITEM.SOCKET_RUNE, count: 1 }; // 100%: Sockel-Rune (Mitte)
          const extras = [
            [ITEM.GOLD_INGOT, 1 + (Math.random() * 3 | 0), 0.8],
            [ITEM.IRON_INGOT, 1 + (Math.random() * 4 | 0), 0.8],
            [ITEM.DIAMOND, 1 + (Math.random() * 2 | 0), 0.5],
            [ITEM.BONE, 2 + (Math.random() * 4 | 0), 0.9],
          ];
          const freie = [4, 10, 16, 22];
          extras.forEach(([id, count, chance], i) => {
            if (Math.random() < chance) c.slots[freie[i]] = { id, count };
          });
          this._tauscheZuTruhe(x, y, z); // erst füllen, dann tauschen + syncen
          this.ctx.ui.toast('✨ Die Truhe ist entsiegelt!');
          this.ctx.sounds.pickup();
        }
      }
    }
  }

  getChest(x, y, z) {
    const k = x + ',' + y + ',' + z;
    let c = this.chests.get(k);
    if (!c) {
      c = { slots: new Array(27).fill(null) };
      this.chests.set(k, c);
    }
    return c;
  }

  // Truhen-Inhalt + Block-Tausch im Mehrspieler teilen
  _syncChest(x, y, z) {
    const k = x + ',' + y + ',' + z;
    const c = this.chests.get(k);
    if (c) this.ctx.net?.sendChest(k, c.slots);
  }

  _tauscheZuTruhe(x, y, z) {
    const w = this.ctx.world;
    w.setBlock(x, y, z, BLOCK.CHEST);
    this.ctx.net?.sendEdits([[x, y, z, BLOCK.CHEST]]);
    this._syncChest(x, y, z);
  }

  // Nach jeder Block-Änderung: Konsistenz wahren
  onBlockChanged(x, y, z) {
    const w = this.ctx.world;
    const id = w.getBlock(x, y, z);

    // Truhe entfernt → Inhalt fällt heraus
    const k = x + ',' + y + ',' + z;
    if (id !== BLOCK.CHEST && this.chests.has(k)) {
      const c = this.chests.get(k);
      this.chests.delete(k);
      for (const s of c.slots) {
        if (s) this.ctx.entities.spawnItemDrop(x + 0.5, y + 0.5, z + 0.5, s);
      }
    }

    // Kaskaden-Änderungen (Halt-Regeln, Türen, Betten, Lianen …) müssen wie
    // Spieler-Edits an den Server — sonst tauchen z. B. abgefallene Zuckerrohre
    // nach einem Neustart/Wiederbeitritt wieder auf, weil der Server sie nie
    // erfahren hat. Der applyingRemote-Schutz in sendEdits verhindert Echo, wenn
    // die Kette durch einen fremden Edit ausgelöst wurde.
    const put = (bx, by, bz, bid) => {
      w.setBlock(bx, by, bz, bid);
      this.ctx.net?.sendEdits([[bx, by, bz, bid]]);
    };

    // Tür-Invariante: Ober-Hälfte braucht Unter-Hälfte darunter (und umgekehrt)
    const above = w.getBlock(x, y + 1, z);
    if (BLOCKS[above]?.door === 'upper' && BLOCKS[id]?.door !== 'lower') {
      put(x, y + 1, z, BLOCK.AIR);
    }
    const below = w.getBlock(x, y - 1, z);
    if (BLOCKS[below]?.door === 'lower' && BLOCKS[id]?.door !== 'upper') {
      put(x, y - 1, z, BLOCK.AIR);
    }

    // Bett-Hälfte entfernt → Partner suchen und entfernen
    if (id === BLOCK.AIR) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nb = w.getBlock(x + dx, y, z + dz);
        if (isBedId(nb) && !this._bedHasPartner(x + dx, y, z + dz)) {
          put(x + dx, y, z + dz, BLOCK.AIR);
        }
      }
    }

    // Halt-Regeln: Fackeln, Zuckerrohr, Kelp und Seegras brechen ohne Unterlage
    {
      const above = w.getBlock(x, y + 1, z);
      const supportGone = !isSolid(id);
      if (supportGone && above === BLOCK.TORCH) {
        put(x, y + 1, z, BLOCK.AIR);
        this.ctx.entities.spawnItemDrop(x + 0.5, y + 1.5, z + 0.5, BLOCK.TORCH, 1);
      }
      if (above === BLOCK.SUGAR_CANE &&
          ![BLOCK.GRASS, BLOCK.DIRT, BLOCK.SAND, BLOCK.SUGAR_CANE].includes(id)) {
        put(x, y + 1, z, BLOCK.AIR); // Kette läuft über onBlockEdit weiter nach oben
        this.ctx.entities.spawnItemDrop(x + 0.5, y + 1.5, z + 0.5, BLOCK.SUGAR_CANE, 1);
      }
      if (above === BLOCK.KELP && !isSolid(id) && id !== BLOCK.KELP) {
        put(x, y + 1, z, BLOCK.WATER); // Kelp hinterlässt Wasser
        this.ctx.entities.spawnItemDrop(x + 0.5, y + 1.5, z + 0.5, BLOCKS[BLOCK.KELP].drops, 1);
      }
      if (above === BLOCK.SEAGRASS && !isSolid(id)) {
        put(x, y + 1, z, BLOCK.WATER);
      }
      // Busch fällt ohne Boden, Kaktus-Säule bricht (Kette), Blüte braucht ihren Kaktus
      if (above === BLOCK.SHRUB && !isSolid(id)) {
        put(x, y + 1, z, BLOCK.AIR);
        this.ctx.entities.spawnItemDrop(x + 0.5, y + 1.5, z + 0.5, BLOCK.SHRUB, 1);
      }
      if ((above === BLOCK.PEBBLES || above === BLOCK.PEBBLES_WET) && !isSolid(id)) {
        put(x, y + 1, z, above === BLOCK.PEBBLES_WET ? BLOCK.WATER : BLOCK.AIR);
        this.ctx.entities.spawnItemDrop(x + 0.5, y + 1.5, z + 0.5, BLOCKS[above].drops, 1);
      }
      if (above === BLOCK.CACTUS &&
          ![BLOCK.CACTUS, BLOCK.SAND, BLOCK.RED_SAND].includes(id)) {
        put(x, y + 1, z, BLOCK.AIR); // Kette läuft über onBlockEdit weiter
        this.ctx.entities.spawnItemDrop(x + 0.5, y + 1.5, z + 0.5, BLOCK.CACTUS, 1);
      }
      if (above === BLOCK.CACTUS_FLOWER && id !== BLOCK.CACTUS) {
        put(x, y + 1, z, BLOCK.AIR);
        this.ctx.entities.spawnItemDrop(x + 0.5, y + 1.5, z + 0.5, BLOCK.CACTUS_FLOWER, 1);
      }
      // Feldfrucht braucht Ackerland darunter: fällt sonst ab (reif → Ertrag, sonst Samen).
      // Der synchronisierte Drop entsteht nur beim auslösenden Client (kein Doppel-Drop im MP).
      if (BLOCKS[above]?.crop && !BLOCKS[id]?.farmland) {
        const c = BLOCKS[above].crop;
        put(x, y + 1, z, BLOCK.AIR);
        if (!this.ctx.net?.applyingRemote) {
          this.ctx.entities.dropSynced(x + 0.5, y + 1.4, z + 0.5, c.mature ? c.produce : c.seed, 1);
        }
      }
    }

    // Lianen brauchen irgendeinen soliden Nachbarn (oben oder seitlich)
    if (id === BLOCK.AIR) {
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]) {
        const vx = x + dx, vy = y + dy, vz = z + dz;
        if (w.getBlock(vx, vy, vz) !== BLOCK.VINE) continue;
        let halt = false;
        for (const [ex, ey, ez] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
          const nb = w.getBlock(vx + ex, vy + ey, vz + ez);
          if (isSolid(nb) || nb === BLOCK.VINE) { halt = true; break; }
        }
        if (!halt) put(vx, vy, vz, BLOCK.AIR); // Kette läuft weiter
      }
    }

    // Leitern in Nachbarzellen: ohne solide Wand fallen sie ab
    if (id === BLOCK.AIR) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const lx = x + dx, lz = z + dz;
        if (w.getBlock(lx, y, lz) !== BLOCK.LADDER) continue;
        let halt = false;
        for (const [ex, ez] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nb = w.getBlock(lx + ex, y, lz + ez);
          if (nb > 0 && BLOCKS[nb]?.opaque !== false) { halt = true; break; }
        }
        if (!halt) {
          put(lx, y, lz, BLOCK.AIR);
          this.ctx.entities.spawnItemDrop(lx + 0.5, y + 0.5, lz + 0.5, BLOCK.LADDER, 1);
        }
      }
    }
  }

  _bedHasPartner(x, y, z) {
    const w = this.ctx.world;
    const me = BLOCKS[w.getBlock(x, y, z)]?.bed;
    if (!me) return true;
    const want = me === 'foot' ? 'head' : 'foot';
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (BLOCKS[w.getBlock(x + dx, y, z + dz)]?.bed === want) return true;
    }
    return false;
  }

  serialize() {
    const out = {};
    for (const [k, c] of this.chests) {
      out[k] = c.slots.map((s) => (s ? { ...s } : null));
    }
    return out;
  }

  restore(data) {
    if (!data) return;
    for (const [k, slots] of Object.entries(data)) {
      this.chests.set(k, { slots: slots.map((s) => (s ? { ...s } : null)) });
    }
  }
}
