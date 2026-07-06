// Persistenz via localStorage. Mehrere Welten: je Welt ein Schlüssel fablemc.world.<id>,
// dazu ein Index fablemc.worlds.v1 mit Meta-Daten (Name, Seed, Modus, Zeitstempel).
// Eine ältere Einzelwelt (fablemc.save.v7) wird beim ersten Zugriff einmalig übernommen.

const LEGACY_KEY = 'fablemc.save.v7';
const INDEX_KEY = 'fablemc.worlds.v1';
const worldKey = (id) => 'fablemc.world.' + id;

function readJSON(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function writeJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); return true; }
  catch (e) { console.warn('Speichern fehlgeschlagen (Speicher voll?):', e); return false; }
}

export class SaveManager {
  constructor(ctx) { this.ctx = ctx; this._interval = null; }

  // ---- Welt-Verwaltung (statisch) ----

  static _migrate() {
    if (SaveManager._migrated) return;
    SaveManager._migrated = true;
    if (readJSON(INDEX_KEY)) return;                    // neues System existiert schon
    const old = readJSON(LEGACY_KEY);
    if (!old) { writeJSON(INDEX_KEY, []); return; }
    const id = 'legacy';
    writeJSON(worldKey(id), { ...old, name: 'Welt 1' });
    writeJSON(INDEX_KEY, [{ id, name: 'Welt 1', seed: old.seed, mode: old.mode || 'survival', updated: Date.now() }]);
    try { localStorage.removeItem(LEGACY_KEY); } catch { /* egal */ }
  }

  static _index() {
    SaveManager._migrate();
    const list = readJSON(INDEX_KEY);
    return Array.isArray(list) ? list : [];
  }
  static _writeIndex(list) { writeJSON(INDEX_KEY, list); }

  // Gespeicherte Welten, neueste zuerst
  static listWorlds() {
    return SaveManager._index().slice().sort((a, b) => (b.updated || 0) - (a.updated || 0));
  }
  static hasSave() { return SaveManager._index().length > 0; } // Kompatibilität
  static readWorld(id) { return readJSON(worldKey(id)); }
  static deleteWorld(id) {
    try { localStorage.removeItem(worldKey(id)); } catch { /* egal */ }
    SaveManager._writeIndex(SaveManager._index().filter((w) => w.id !== id));
  }
  static newId() { return 'w' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

  // ---- Instanz: an ctx.worldId gebunden ----

  load() { return this.ctx.worldId ? SaveManager.readWorld(this.ctx.worldId) : null; }

  save() {
    const ctx = this.ctx;
    if (!ctx.state.gameStarted || !ctx.worldId) return; // Mehrspieler (kein worldId): nichts lokal speichern
    const data = {
      version: 2,
      seed: ctx.seed,
      name: ctx.worldName || 'Welt',
      mode: ctx.state.mode,
      time: ctx.state.time,
      edits: ctx.world.getEdits(),
      player: ctx.player.serialize(),
      survival: ctx.survival.serialize(),
      experience: ctx.experience.serialize(),
      inventory: ctx.inventory.serialize(),
      furnaces: ctx.furnaces.serialize(),
      brewing: ctx.brewing.serialize(),
      washer: ctx.washer.serialize(),
      flora: ctx.flora.serialize(),
      blocks: ctx.blocks.serialize(),
    };
    if (!writeJSON(worldKey(ctx.worldId), data)) return;
    const list = SaveManager._index().filter((w) => w.id !== ctx.worldId);
    list.push({ id: ctx.worldId, name: data.name, seed: ctx.seed, mode: ctx.state.mode, updated: Date.now() });
    SaveManager._writeIndex(list);
  }

  startAutosave() {
    if (this._interval) return;
    this._interval = setInterval(() => {
      if (!this.ctx.state.dead) this.save();
    }, 15000);
    window.addEventListener('beforeunload', () => this.save());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.save();
    });
  }
}
