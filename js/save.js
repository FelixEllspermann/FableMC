// Persistence via localStorage: seed, time, world edits, player, survival, inventory.

const KEY = 'fablemc.save.v7'; // v7: Item-ids ab 1000, Wolle als Block — ältere Stände inkompatibel

export class SaveManager {
  constructor(ctx) {
    this.ctx = ctx;
    this._interval = null;
  }

  static hasSave() {
    try { return localStorage.getItem(KEY) != null; } catch { return false; }
  }

  static readMeta() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY));
      return d ? { seed: d.seed } : null;
    } catch { return null; }
  }

  static clear() {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  }

  load() {
    try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
  }

  save() {
    const ctx = this.ctx;
    if (!ctx.state.gameStarted) return;
    const data = {
      version: 1,
      seed: ctx.seed,
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
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Speichern fehlgeschlagen (Speicher voll?):', e);
    }
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
