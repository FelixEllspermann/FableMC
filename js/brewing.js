// Braustand: pro Block ein Zustand (Flaschen-, Wasser- und 2 Zutaten-Slots).
// Braut nach kurzer Zeit die Flaschen zu Heiltränken, wenn Wasser + Crimson Blood
// + Vine vorhanden sind. Läuft im Hintergrund weiter (auch bei geschlossener UI) —
// client-lokal wie der Ofen.

import { BLOCK, ITEM } from './constants.js';

const BREW_TIME = 6; // Sekunden pro Brauvorgang

// Braurezepte: Zutaten-Paar (Reihenfolge egal) → Trank. Immer + Glasflaschen + Wassereimer.
const BREW_RECIPES = [
  { a: ITEM.CRIMSON_BLOOD, b: BLOCK.VINE, result: ITEM.CRIMSON_POTION }, // Heiltrank
  { a: ITEM.SUGAR, b: ITEM.KELP, result: ITEM.SPEED_POTION },            // Speed-Trank
];

export class Brewing {
  constructor(ctx) {
    this.ctx = ctx;
    this.map = new Map(); // "x,y,z" -> { bottles, water, ing1, ing2, progress, _dirtyUI }
  }

  key(x, y, z) { return x + ',' + y + ',' + z; }

  get(x, y, z) {
    const k = this.key(x, y, z);
    let b = this.map.get(k);
    if (!b) { b = { bottles: null, water: null, ing1: null, ing2: null, progress: 0 }; this.map.set(k, b); }
    return b;
  }

  // Passendes Rezept (oder null): Glasflaschen + Wassereimer + gültiges Zutaten-Paar
  _recipeFor(b) {
    if (!b.bottles || b.bottles.id !== ITEM.GLASS_BOTTLE || b.bottles.count < 1) return null;
    if (!b.water || b.water.id !== ITEM.WATER_BUCKET) return null;
    const ids = [b.ing1?.id, b.ing2?.id];
    for (const r of BREW_RECIPES) {
      if (ids.includes(r.a) && ids.includes(r.b)) return r;
    }
    return null;
  }

  update(dt) {
    // Mehrspieler: nur der Host lässt die Zeit laufen (guests bekommen den Zustand per Netz)
    const net = this.ctx.net;
    if (net?.active && !net.isHost) return;
    for (const [k, b] of this.map) {
      const recipe = this._recipeFor(b);
      if (recipe) {
        b.progress += dt;
        b._netTimer = (b._netTimer || 0) + dt;
        if (b.progress >= BREW_TIME) {
          b.progress = 0;
          // alle Flaschen im Slot → der passende Trank (3 rein = 3 raus)
          b.bottles = { id: recipe.result, count: b.bottles.count };
          // Wassereimer wird geleert
          b.water = { id: ITEM.BUCKET, count: 1 };
          // je 1 der beiden Zutaten verbrauchen
          for (const key of ['ing1', 'ing2']) {
            const s = b[key];
            if (s && (s.id === recipe.a || s.id === recipe.b)) {
              s.count--;
              if (s.count <= 0) b[key] = null;
            }
          }
          b._dirtyUI = true;
          this.ctx.sounds?.pickup?.();
          this._broadcast(k, b); // Fertig → an Mitspieler
        } else if (b._netTimer >= 1) {
          b._netTimer = 0;
          this._broadcast(k, b); // ~1×/s Fortschritt spiegeln, damit der Balken bei Gästen läuft
        }
      } else if (b.progress !== 0) {
        b.progress = 0;
        b._dirtyUI = true;
        this._broadcast(k, b);
      }
    }
  }

  // Zustand dieses Braustands an die Mitspieler senden
  _broadcast(k, b) {
    this.ctx.net?.sendBrew(k, {
      bottles: b.bottles, water: b.water, ing1: b.ing1, ing2: b.ing2, progress: b.progress,
    });
  }

  // Braustand abgebaut → Inhalt fällt heraus
  onBlockChanged(x, y, z) {
    const k = this.key(x, y, z);
    const b = this.map.get(k);
    if (!b) return;
    if (this.ctx.world.getBlock(x, y, z) === BLOCK.BREWING_STAND) return;
    for (const slot of ['bottles', 'water', 'ing1', 'ing2']) {
      if (b[slot]) this.ctx.entities.spawnItemDrop(x + 0.5, y + 0.5, z + 0.5, b[slot]);
    }
    this.map.delete(k);
  }

  serialize() {
    const out = [];
    for (const [k, b] of this.map) {
      if (b.bottles || b.water || b.ing1 || b.ing2) {
        out.push([k, { bottles: b.bottles, water: b.water, ing1: b.ing1, ing2: b.ing2, progress: b.progress }]);
      }
    }
    return out;
  }

  restore(data) {
    if (!Array.isArray(data)) return;
    for (const [k, b] of data) {
      this.map.set(k, {
        bottles: b.bottles || null, water: b.water || null,
        ing1: b.ing1 || null, ing2: b.ing2 || null, progress: b.progress || 0,
      });
    }
  }
}
