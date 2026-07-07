// Inventory: 36 slots (9 hotbar + 27 main), hotbar HUD, drag/drop UI, crafting grid.

import { nameOf, stackSizeOf, BLOCKS, ITEMS, ITEM, BLOCK, SMELT, FUEL } from './constants.js';
import { getIconDataURL } from './textures.js';
import { matchGrid } from './crafting.js';
import { Keybinds } from './keybinds.js';
import { rollOptions, canEnchant, romanLevel } from './enchant.js';
import { t } from './lang.js';
import {
  isEquipment, equipKind, makeInstance, tooltipFor, durabilityLeft, maxDurability, UPGRADE_IDS,
} from './equip.js';

const BACKPACK_SIZE = 27; // Grundgröße (3×9); Stauraum-Verzauberung gibt +9 (1 Reihe) pro Level
const bagSize = (bp) => BACKPACK_SIZE + ((bp && bp.ench && bp.ench.space) || 0) * 9;

// Amboss-Arbeit kostet XP-Level (nur im Überleben; Kreativ ist gratis).
const AMBOSS_KOSTEN_SOCKEL = 4;  // Sockel-Rune einsetzen (+1 Upgrade-Slot)
const AMBOSS_KOSTEN_UPGRADE = 2; // ein Upgrade in einen Slot einsetzen

const STYLE = `
.inv-hotbar {
  position: fixed; bottom: 8px; left: 50%; transform: translateX(-50%);
  display: flex; gap: 2px; z-index: 20;
  background: rgba(0,0,0,0.45); padding: 3px; border-radius: 4px;
}
.inv-hotbar .inv-slot { width: 44px; height: 44px; }
.inv-hotbar .inv-slot.selected { outline: 3px solid #fff; outline-offset: -1px; }
.inv-slot {
  position: relative; width: 44px; height: 44px;
  background: #8b8b8b;
  border: 2px solid; border-color: #373737 #ffffff #ffffff #373737;
  image-rendering: pixelated;
}
.inv-slot img { width: 100%; height: 100%; display: block; pointer-events: none; }
.inv-slot .cnt {
  position: absolute; right: 2px; bottom: 0; font-size: 15px; font-weight: bold;
  color: #fff; text-shadow: 2px 2px 0 #3f3f3f; pointer-events: none; line-height: 1;
}
.inv-slot .dur {
  position: absolute; left: 3px; right: 3px; bottom: 2px; height: 3px;
  background: #222; pointer-events: none;
}
.inv-slot .dur > div { height: 100%; }
.inv-slot .upmark {
  position: absolute; left: 2px; top: 0; font-size: 11px; color: #ffe25e;
  text-shadow: 1px 1px 0 #3f3f3f; pointer-events: none; line-height: 1.2;
}
.inv-anvil-row { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.inv-anvil-ups { display: flex; gap: 2px; }
.inv-anvil-ups .inv-slot.leer { opacity: 0.55; }
.inv-anvil-hint { font-size: 12px; color: #3f3f3f; line-height: 1.35; margin-left: 4px; }
.inv-anvil-hint b { color: #1f7d0e; }
.inv-ench-opts { display: flex; flex-direction: column; gap: 6px; margin: 0 10px; min-width: 250px; }
.inv-ench-opt {
  padding: 6px 10px; background: #5b5168; color: #fff; cursor: pointer;
  border: 2px solid; border-color: #8a7ea0 #2f2a3a #2f2a3a #8a7ea0;
}
.inv-ench-opt:hover:not(.disabled) { background: #6f6086; }
.inv-ench-opt.disabled { opacity: 0.5; cursor: default; }
.inv-ench-name { font-size: 14px; color: #ecdcff; }
.inv-ench-cost { font-size: 11.5px; color: #d6cfe8; }
.inv-clear-btn {
  font-size: 13px; padding: 6px 10px; background: #8a5f5f; color: #fff;
  border: 2px solid; border-color: #b08a8a #4a3232 #4a3232 #b08a8a;
}
.inv-armor { display: grid; grid-template-rows: repeat(5, 44px); gap: 2px; margin-right: 10px; }
.inv-slot.bag.leer::after { content: '🎒'; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 22px; opacity: 0.28; }
.inv-slot.bag { border-color: #7a5a3a; }
.inv-smelt-col { display: flex; flex-direction: column; gap: 6px; align-items: center; }
.inv-smelt-bar {
  width: 60px; height: 8px; background: #555; border: 1px solid #333;
}
.inv-smelt-bar > div { height: 100%; width: 0; background: #ffb830; }
.inv-smelt-hint { font-size: 11px; color: #555; }
.inv-tip {
  position: fixed; z-index: 70; display: none; pointer-events: none;
  background: rgba(16, 12, 24, 0.94); color: #fff; border: 1px solid #5a4a8a;
  padding: 6px 10px; font-size: 13px; line-height: 1.45; white-space: pre-line;
  border-radius: 3px; max-width: 280px;
}
.inv-hotbar-label {
  position: fixed; bottom: 132px; left: 50%; transform: translateX(-50%);
  z-index: 21; color: #fff; font-size: 17px; font-weight: bold;
  text-shadow: 2px 2px 0 #3f3f3f; pointer-events: none;
  opacity: 0; transition: opacity 0.35s;
}
.inv-overlay {
  position: fixed; inset: 0; z-index: 40; display: none;
  align-items: center; justify-content: center; background: rgba(0,0,0,0.55);
}
.inv-overlay.open { display: flex; }
.inv-panel {
  background: #c6c6c6; border: 3px solid; border-color: #ffffff #555555 #555555 #ffffff;
  border-radius: 3px; padding: 14px; color: #3f3f3f;
}
.inv-panel h3 { font-size: 14px; margin: 2px 0 6px 2px; color: #404040; }
.inv-craft-row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.inv-grid { display: grid; gap: 2px; }
.inv-arrow { font-size: 28px; font-weight: bold; color: #6a6a6a; }
.inv-main { display: grid; grid-template-columns: repeat(9, 44px); gap: 2px; margin-bottom: 10px; }
.inv-palette {
  display: grid; grid-template-columns: repeat(9, 44px); gap: 2px;
  max-height: 190px; overflow-y: auto; margin-bottom: 10px; padding-right: 2px;
}
.inv-bar { display: grid; grid-template-columns: repeat(9, 44px); gap: 2px; }
.inv-trades { display: flex; flex-direction: column; gap: 4px; max-height: 220px; overflow-y: auto; }
.inv-trade-row {
  display: flex; align-items: center; gap: 8px; padding: 3px 8px; cursor: pointer;
  background: #cfc3a8; border: 2px solid #8a7d5e; border-radius: 3px;
}
.inv-trade-row:hover { background: #ddd0b2; }
.inv-trade-row.disabled { opacity: 0.5; cursor: not-allowed; }
.inv-trade-row.locked { opacity: 0.4; cursor: default; filter: grayscale(0.7); background: #b9ad91; }
.inv-trade-row.locked:hover { background: #b9ad91; }
.inv-trade-info { font-size: 12px; color: #4a4a4a; padding: 2px 4px 4px; font-weight: bold; }
.inv-cursor {
  position: fixed; left: 0; top: 0; width: 44px; height: 44px;
  pointer-events: none; z-index: 50; display: none; will-change: transform;
}
.inv-cursor img { width: 100%; height: 100%; }
.inv-cursor .cnt {
  position: absolute; right: 2px; bottom: 0; font-size: 15px; font-weight: bold;
  color: #fff; text-shadow: 2px 2px 0 #3f3f3f; line-height: 1;
}
`;

export class Inventory {
  constructor(ctx) {
    this.ctx = ctx;
    this.slots = new Array(36).fill(null); // 0-8 hotbar, 9-35 main
    this.hotbarIndex = 0;
    this.cursor = null;          // stack held on the mouse cursor
    this.craft = [];             // crafting grid cells
    this.craftW = 2;
    this.result = null;
    this._open = false;
    this.mode = 'basic';         // 'basic' | 'table' | 'anvil' | 'furnace' | 'trade' | 'backpack'
    this.armor = { helmet: null, chest: null, legs: null, boots: null };
    this.backpack = null;        // ausgerüsteter Rucksack (Item-Stack mit .bag = eigenes Inventar)
    this.anvilItem = null;       // Ausrüstung, die gerade im Amboss liegt
    this.enchantItem = null;     // Item im Verzauberungstisch
    this._enchOpts = null;       // die 3 ausgewürfelten Optionen
    this.furnace = { input: null, fuel: null, output: null, progress: 0, fuelLeft: 0 };

    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    this.hotbarEl = document.createElement('div');
    this.hotbarEl.className = 'inv-hotbar';
    document.body.appendChild(this.hotbarEl);

    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'inv-overlay';
    document.body.appendChild(this.overlayEl);
    // Klick NEBEN das Panel: Cursor-Stapel in die Welt werfen (links alles, rechts 1)
    this.overlayEl.addEventListener('mousedown', (e) => {
      if (!this.cursor) return;
      if (e.button === 2) {
        this._throwIntoWorld({ id: this.cursor.id, count: 1 });
        this.cursor.count--;
        if (this.cursor.count <= 0) this.cursor = null;
      } else {
        this._throwIntoWorld(this.cursor);
        this.cursor = null;
      }
      this._renderPanel();
      this._renderHotbar();
    });

    this.cursorEl = document.createElement('div');
    this.cursorEl.className = 'inv-cursor';
    document.body.appendChild(this.cursorEl);

    // Sofort-Tooltip (das native title-Attribut ist zu träge)
    this.tipEl = document.createElement('div');
    this.tipEl.className = 'inv-tip';
    document.body.appendChild(this.tipEl);

    // Item-Name über der Hotbar beim Slot-Wechsel (wie MC)
    this.labelEl = document.createElement('div');
    this.labelEl.className = 'inv-hotbar-label';
    document.body.appendChild(this.labelEl);
    this._labelTimer = null;

    // track the pointer at all times so a picked-up stack snaps to it instantly
    this._mx = 0; this._my = 0;
    const track = (e) => {
      this._mx = e.clientX; this._my = e.clientY;
      if (this.cursor) this._positionCursor();
    };
    document.addEventListener('pointermove', track, { passive: true });
    document.addEventListener('mousedown', track, true);

    document.addEventListener('keydown', (e) => {
      if (e.target && e.target.tagName === 'INPUT') return;
      const s = this.ctx.state;
      if (e.code === Keybinds.get('inventory')) {
        if (this._open) this.close();
        else if (s.gameStarted && !s.paused && !s.dead && !s.uiOpen) this.open(false);
      } else if (e.code === 'KeyB') {
        // Rucksack öffnen/schließen (nur wenn einer ausgerüstet ist)
        if (this._open && this.mode === 'backpack') this.close();
        else if (!this._open && this.backpack && s.gameStarted && !s.paused && !s.dead && !s.uiOpen) this.open('backpack');
      } else if (e.code === 'Escape' && this._open) {
        this.close();
      }
    });

    this._renderHotbar();
  }

  get isOpen() { return this._open; }

  // Hotbar-Anzeige von außen aktualisieren (z. B. nach Q-Drop)
  refreshHotbar() { this._renderHotbar(); }

  // Stapel als geworfenes Item vor dem Spieler spawnen
  _throwIntoWorld(stack) {
    const p = this.ctx.player;
    if (!p) return;
    const dir = p._viewDir(p._dir);
    const d = this.ctx.entities.spawnItemDrop(
      p.pos.x + dir.x * 0.4, p.pos.y + 1.3, p.pos.z + dir.z * 0.4, stack);
    d.vel.set(dir.x * 6, dir.y * 5 + 2.2, dir.z * 6);
    d.pickupDelay = 1.5;
  }

  // ---- data ops ----

  addItem(id, count) {
    let left = count;
    const max = stackSizeOf(id);
    for (let i = 0; i < 36 && left > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && !isEquipment(id) && s.count < max) {
        const take = Math.min(max - s.count, left);
        s.count += take; left -= take;
      }
    }
    for (let i = 0; i < 36 && left > 0; i++) {
      if (!this.slots[i]) {
        const take = Math.min(max, left);
        this.slots[i] = { id, count: take };
        left -= take;
      }
    }
    this._renderAll();
    return left;
  }

  // Instanz (Ausrüstung mit Slots/Haltbarkeit) unverändert einlagern — nie stapeln
  addItemStack(stack) {
    if (!stack) return 0;
    // Ausrüstung & Instanz-Items (z. B. Rucksack) nie stapeln — Zustand/Inhalt bleibt erhalten
    if (!isEquipment(stack.id) && !ITEMS[stack.id]?.instance) return this.addItem(stack.id, stack.count);
    for (let i = 0; i < 36; i++) {
      if (!this.slots[i]) {
        this.slots[i] = stack;
        this._renderAll();
        return 0;
      }
    }
    return stack.count; // kein Platz
  }

  consumeSelected(n = 1) {
    const s = this.slots[this.hotbarIndex];
    if (!s) return;
    s.count -= n;
    if (s.count <= 0) this.slots[this.hotbarIndex] = null;
    this._renderAll();
  }

  // Wie viele Items der Sorte `id` hat der Spieler (Haupt-Inventar + Hotbar)?
  countItem(id) {
    let n = 0;
    for (let i = 0; i < 36; i++) if (this.slots[i]?.id === id) n += this.slots[i].count;
    return n;
  }

  // `count` Items der Sorte `id` entfernen (true, wenn genug vorhanden waren)
  removeItems(id, count) {
    if (this.countItem(id) < count) return false;
    let left = count;
    for (let i = 0; i < 36 && left > 0; i++) {
      const s = this.slots[i];
      if (s?.id === id) { const take = Math.min(s.count, left); s.count -= take; left -= take; if (s.count <= 0) this.slots[i] = null; }
    }
    this._renderAll();
    return true;
  }

  selectedItem() {
    return this.slots[this.hotbarIndex];
  }

  setHotbarIndex(i) {
    const changed = this.hotbarIndex !== i;
    this.hotbarIndex = i;
    this._renderHotbar();
    if (changed) this._showHotbarLabel();
  }

  _showHotbarLabel() {
    const s = this.slots[this.hotbarIndex];
    if (!s) { this.labelEl.style.opacity = '0'; return; }
    this.labelEl.textContent = nameOf(s.id);
    this.labelEl.style.opacity = '1';
    if (this._labelTimer) clearTimeout(this._labelTimer);
    this._labelTimer = setTimeout(() => { this.labelEl.style.opacity = '0'; }, 1500);
  }

  _showTip(text, x, y) {
    this.tipEl.textContent = text;
    this.tipEl.style.display = 'block';
    const w = this.tipEl.offsetWidth, h = this.tipEl.offsetHeight;
    this.tipEl.style.left = Math.min(x + 14, window.innerWidth - w - 6) + 'px';
    this.tipEl.style.top = Math.min(y + 12, window.innerHeight - h - 6) + 'px';
  }

  _hideTip() {
    this.tipEl.style.display = 'none';
  }

  serialize() {
    return { slots: this.slots, hotbarIndex: this.hotbarIndex, armor: this.armor, backpack: this.backpack };
  }

  restore(data) {
    if (!data) return;
    this.slots = data.slots.map((s) => (s ? { ...s } : null));
    while (this.slots.length < 36) this.slots.push(null);
    this.hotbarIndex = data.hotbarIndex ?? 0;
    if (data.armor) {
      for (const k of ['helmet', 'chest', 'legs', 'boots']) {
        this.armor[k] = data.armor[k] ? { ...data.armor[k] } : null;
      }
    }
    // Rucksack inkl. Inhalt wiederherstellen
    this.backpack = data.backpack ? { ...data.backpack, bag: (data.backpack.bag || []).map((s) => (s ? { ...s } : null)) } : null;
    this._renderAll();
  }

  // ---- open/close ----

  open(mode = false, pos = null) {
    if (this._open) return;
    this.mode = ['anvil', 'enchant', 'furnace', 'chest', 'brewing', 'washer', 'trade', 'backpack'].includes(mode)
      ? mode : mode ? 'table' : 'basic';
    if (this.mode === 'enchant') { this.enchantItem = null; this._enchOpts = null; }
    // Rucksack: an den ausgerüsteten Rucksack binden (Inhalt lazy anlegen)
    if (this.mode === 'backpack') {
      if (!this.backpack) this.mode = 'basic';
      else if (!Array.isArray(this.backpack.bag)) this.backpack.bag = new Array(BACKPACK_SIZE).fill(null);
    }
    this.craftW = this.mode === 'table' ? 3 : 2;
    this.craft = new Array(this.craftW * this.craftW).fill(null);
    this.result = null;
    // Handel: an einen Dorfbewohner binden (Angebote deterministisch aus seiner eid)
    if (this.mode === 'trade' && pos) {
      this.trader = pos;
      if (!pos.trades) pos.trades = this.ctx.entities.villagerTrades(pos.eid);
    }
    // Ofen-UI bindet sich an den Zustand DIESES Blocks (schmilzt im Hintergrund weiter)
    if (this.mode === 'furnace' && pos) {
      this.furnace = this.ctx.furnaces.get(pos.x, pos.y, pos.z);
    }
    // Braustand-UI bindet sich an den Zustand DIESES Blocks (braut im Hintergrund weiter)
    if (this.mode === 'brewing' && pos) {
      this.brew = this.ctx.brewing.get(pos.x, pos.y, pos.z);
      this._brewPos = pos.x + ',' + pos.y + ',' + pos.z;
    }
    // Washer-UI bindet sich an den Zustand DIESES Blocks (wäscht im Hintergrund weiter)
    if (this.mode === 'washer' && pos) {
      this.wash = this.ctx.washer.get(pos.x, pos.y, pos.z);
      this._washPos = pos.x + ',' + pos.y + ',' + pos.z;
    }
    // Truhen-UI bindet sich an den Inhalt DIESES Blocks
    if (this.mode === 'chest' && pos) {
      this.chestData = this.ctx.blocks.getChest(pos.x, pos.y, pos.z);
      this._chestPos = pos.x + ',' + pos.y + ',' + pos.z;
    }
    this._open = true;
    this.ctx.state.uiOpen = true;
    if (document.pointerLockElement) document.exitPointerLock();
    this.overlayEl.classList.add('open');
    this._renderPanel();
  }

  close() {
    if (!this._open) return;
    // Mehrspieler: Truhen-Inhalt beim Schließen an den Server melden
    if (this.mode === 'chest' && this.chestData && this._chestPos) {
      this.ctx.net?.sendChest(this._chestPos, this.chestData.slots);
    }
    // Braustand/Washer: Slots beim Schließen spiegeln
    if (this.mode === 'brewing') this._syncBrew();
    if (this.mode === 'washer') this._syncWash();
    // return crafting grid + cursor + anvil contents
    for (const s of this.craft) {
      if (s) this._returnStack(s);
    }
    this.craft = [];
    if (this.cursor) { this._returnStack(this.cursor); this.cursor = null; }
    if (this.anvilItem) { this._returnStack(this.anvilItem); this.anvilItem = null; }
    if (this.enchantItem) { this._returnStack(this.enchantItem); this.enchantItem = null; }
    // Ofen-Inhalt bleibt im Block — er schmilzt im Hintergrund weiter
    this.result = null;
    this._open = false;
    this._hideTip();
    this.ctx.state.uiOpen = false;
    this.overlayEl.classList.remove('open');
    this.cursorEl.style.display = 'none';
    this._renderHotbar();
    const s = this.ctx.state;
    if (s.gameStarted && !s.paused && !s.dead) {
      this.ctx.requestLock();
    }
  }

  _returnStack(stack) {
    const left = this.addItemStack(stack);
    if (left > 0 && this.ctx.player) {
      const p = this.ctx.player.pos;
      this.ctx.entities.spawnItemDrop(p.x, p.y + 1, p.z, stack, left);
    }
  }

  // Handel ausführen: Kosten abziehen, Ergebnis gutschreiben (Überschuss droppt)
  _doTrade(tr) {
    if (this.countItem(tr.costId) < tr.costCount) { this.ctx.sounds?.hurt?.(); return false; }
    this.removeItems(tr.costId, tr.costCount);
    this._returnStack({ id: tr.resultId, count: tr.resultCount });
    this.ctx.sounds?.pickup?.();
    // Handels-XP für den Dorfbewohner (schaltet mit der Zeit weitere Slots frei)
    const v = this.trader;
    if (v) {
      if (v.remoteNet) { v.tradeXp = (v.tradeXp || 0) + 1; this.ctx.net?.sendUse(v.eid, 'trade'); }
      else this.ctx.entities.gainTradeXp(v);
    }
    return true;
  }

  // Ofen-/Braustand-UI aktuell halten (Schmelzen/Brauen läuft in furnaces.js/brewing.js)
  update(dt) {
    if (!this._open) return;
    if (this.mode === 'furnace') {
      const f = this.furnace;
      if (f._dirtyUI) { f._dirtyUI = false; this._renderPanel(); }
      else {
        const bar = document.querySelector('.inv-smelt-bar > div');
        if (bar) bar.style.width = (f.progress / 2 * 100).toFixed(0) + '%';
      }
    } else if (this.mode === 'brewing') {
      const b = this.brew;
      if (b._dirtyUI) { b._dirtyUI = false; this._renderPanel(); }
      else {
        const bar = document.querySelector('.inv-smelt-bar > div');
        if (bar) bar.style.width = (b.progress / 6 * 100).toFixed(0) + '%';
      }
    } else if (this.mode === 'washer') {
      const w = this.wash;
      if (w._dirtyUI) { w._dirtyUI = false; this._renderPanel(); }
      else {
        const bar = document.querySelector('.inv-smelt-bar > div');
        if (bar) bar.style.width = (w.progress / 3 * 100).toFixed(0) + '%';
      }
    }
  }

  // Braustand-Slots an die Mitspieler spiegeln (der Host startet dann den Timer)
  _syncBrew() {
    if (this.mode !== 'brewing' || !this._brewPos) return;
    const b = this.brew;
    this.ctx.net?.sendBrew(this._brewPos, {
      bottles: b.bottles, water: b.water, ing1: b.ing1, ing2: b.ing2, progress: b.progress,
    });
  }

  // Washer-Slots an die Mitspieler spiegeln
  _syncWash() {
    if (this.mode !== 'washer' || !this._washPos) return;
    const w = this.wash;
    this.ctx.net?.sendWash(this._washPos, { input: w.input, water: w.water, output: w.output, progress: w.progress });
  }

  // ---- slot interaction ----

  _clickCell(get, set, button, isCraft) {
    const cur = this.cursor;
    const s = get();
    if (button === 0) {
      if (!cur && s) { this.cursor = s; set(null); }
      else if (cur && !s) { set(cur); this.cursor = null; }
      else if (cur && s) {
        const max = stackSizeOf(s.id);
        if (s.id === cur.id && s.count < max) {
          const take = Math.min(max - s.count, cur.count);
          s.count += take; cur.count -= take;
          if (cur.count <= 0) this.cursor = null;
          set(s);
        } else {
          set(cur); this.cursor = s;
        }
      }
    } else {
      if (!cur && s) {
        const half = Math.ceil(s.count / 2);
        this.cursor = { id: s.id, count: half };
        s.count -= half;
        set(s.count > 0 ? s : null);
      } else if (cur) {
        const max = stackSizeOf(cur.id);
        if (!s) {
          set({ id: cur.id, count: 1 });
          cur.count--;
        } else if (s.id === cur.id && s.count < max) {
          s.count++; cur.count--;
          set(s);
        }
        if (cur.count <= 0) this.cursor = null;
      }
    }
    if (isCraft) this._updateResult();
    this._renderPanel();
    this._renderHotbar();
  }

  _updateResult() {
    const ids = this.craft.map((s) => (s ? s.id : 0));
    this.result = matchGrid(ids, this.craftW, this.craftW);
  }

  _takeResult() {
    if (!this.result) return;
    const r = this.result;
    if (isEquipment(r.id)) {
      // Ausrüstung: Upgrade-Slots werden aus den verbauten Materialien gewürfelt
      if (this.cursor) return;
      this.cursor = makeInstance(r.id, this.craft.map((s) => (s ? s.id : 0)));
    } else {
      const max = stackSizeOf(r.id);
      if (this.cursor) {
        if (this.cursor.id !== r.id || this.cursor.count + r.count > max) return;
        this.cursor.count += r.count;
      } else {
        this.cursor = { id: r.id, count: r.count };
      }
    }
    for (let i = 0; i < this.craft.length; i++) {
      const s = this.craft[i];
      if (s) {
        s.count--;
        if (s.count <= 0) this.craft[i] = null;
      }
    }
    this._updateResult();
    this._renderPanel();
    this._renderHotbar();
  }

  // ---- rendering ----

  _slotEl(stack, onClick, extraClass = '') {
    const el = document.createElement('div');
    el.className = 'inv-slot' + (extraClass ? ' ' + extraClass : '');
    if (stack) {
      const img = document.createElement('img');
      img.src = getIconDataURL(stack.id);
      img.draggable = false;
      el.appendChild(img);
      // Sofort-Tooltip statt trägem title-Attribut
      el.addEventListener('mouseenter', (e) => this._showTip(tooltipFor(stack), e.clientX, e.clientY));
      el.addEventListener('mousemove', (e) => this._showTip(tooltipFor(stack), e.clientX, e.clientY));
      el.addEventListener('mouseleave', () => this._hideTip());
      if (stack.count > 1) {
        const c = document.createElement('span');
        c.className = 'cnt';
        c.textContent = stack.count;
        el.appendChild(c);
      }
      if (isEquipment(stack.id)) {
        // Upgrade-Slots als Rauten (gefüllt = belegt)
        if (stack.slots > 0) {
          const m = document.createElement('span');
          m.className = 'upmark';
          m.textContent = '◆'.repeat((stack.upgrades || []).length) +
            '◇'.repeat(stack.slots - (stack.upgrades || []).length);
          el.appendChild(m);
        }
        // Haltbarkeitsbalken, sobald benutzt
        if ((stack.used || 0) > 0) {
          const wrap = document.createElement('div');
          wrap.className = 'dur';
          const bar = document.createElement('div');
          const frac = Math.max(0, durabilityLeft(stack) / maxDurability(stack));
          bar.style.width = (frac * 100).toFixed(0) + '%';
          bar.style.background = frac > 0.5 ? '#5fd141' : frac > 0.25 ? '#e8c02c' : '#e04b3a';
          wrap.appendChild(bar);
          el.appendChild(wrap);
        }
      }
    }
    if (onClick) {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick(e.button === 2 ? 2 : 0);
      });
    }
    return el;
  }

  _renderHotbar() {
    this.hotbarEl.textContent = '';
    for (let i = 0; i < 9; i++) {
      const el = this._slotEl(this.slots[i], null, i === this.hotbarIndex ? 'selected' : '');
      this.hotbarEl.appendChild(el);
    }
  }

  _positionCursor() {
    this.cursorEl.style.transform = `translate3d(${this._mx - 22}px, ${this._my - 22}px, 0)`;
  }

  _renderCursor() {
    if (this.cursor) {
      this._positionCursor();
      this.cursorEl.style.display = 'block';
      this.cursorEl.textContent = '';
      const img = document.createElement('img');
      img.src = getIconDataURL(this.cursor.id);
      this.cursorEl.appendChild(img);
      if (this.cursor.count > 1) {
        const c = document.createElement('span');
        c.className = 'cnt';
        c.textContent = this.cursor.count;
        this.cursorEl.appendChild(c);
      }
    } else {
      this.cursorEl.style.display = 'none';
    }
  }

  // Amboss: XP-Level für eine Arbeit abbuchen. Kreativ ist gratis. Reicht das
  // Level nicht, kommt eine Meldung und es wird NICHTS ausgeführt (Rückgabe false).
  _ambossBezahlen(kosten) {
    if (this.ctx.state.mode !== 'survival') return true; // Kreativ/Spectator: kostenlos
    const xp = this.ctx.experience;
    if (!xp || !xp.canAfford(kosten)) {
      this.ctx.ui.toast(t('hud.notEnoughXp', kosten));
      this.ctx.sounds.denied?.();
      return false;
    }
    xp.spendLevels(kosten);
    return true;
  }

  // Verzauberung bezahlen: XP-Level + je 10 Level entweder 10 Smaragde ODER 1 Saphir.
  // Erst Smaragde (10/Einheit), dann Saphire (1/Einheit). Kreativ ist gratis.
  _zahleVerzauberung(cost) {
    if (this.ctx.state.mode !== 'survival') return true;
    const xp = this.ctx.experience;
    const units = Math.ceil(cost / 10);
    const em = this.countItem(ITEM.EMERALD), sa = this.countItem(ITEM.SAPPHIRE);
    if (!xp || !xp.canAfford(cost)) {
      this.ctx.ui.toast(t('hud.notEnoughXp', cost)); this.ctx.sounds.denied?.(); return false;
    }
    if (Math.floor(em / 10) + sa < units) {
      this.ctx.ui.toast(t('hud.notEnoughGems', units * 10, units));
      this.ctx.sounds.denied?.(); return false;
    }
    xp.spendLevels(cost);
    const emUnits = Math.min(units, Math.floor(em / 10));
    if (emUnits > 0) this.removeItems(ITEM.EMERALD, emUnits * 10);
    if (units - emUnits > 0) this.removeItems(ITEM.SAPPHIRE, units - emUnits);
    return true;
  }

  // Eine gewählte Option auf das eingelegte Item anwenden (nur aufwerten, nie herabstufen)
  _applyEnchant(opt) {
    const item = this.enchantItem;
    if (!item || !opt.ench) return;
    if (!this._zahleVerzauberung(opt.cost)) return;
    item.ench = item.ench || {};
    item.ench[opt.ench.key] = Math.max(item.ench[opt.ench.key] || 0, opt.ench.level);
    this.ctx.sounds.pickup?.();
    this.ctx.ui.toast(t('hud.enchanted', t('ench.' + opt.ench.key), romanLevel(opt.ench.level)));
    this._enchOpts = rollOptions(item.id); // neu würfeln für die nächste Verzauberung
    this._renderPanel();
    this._renderHotbar();
  }

  _renderPanel() {
    if (!this._open) return;
    this.overlayEl.textContent = '';
    const panel = document.createElement('div');
    panel.className = 'inv-panel';
    panel.addEventListener('mousedown', (e) => e.stopPropagation());

    const h = document.createElement('h3');
    h.textContent = this.mode === 'anvil' ? t('inv.anvil') : this.mode === 'enchant' ? t('inv.enchant')
      : this.mode === 'furnace' ? t('inv.furnace')
      : this.mode === 'chest' ? t('inv.chest') : this.mode === 'brewing' ? t('inv.brewing')
      : this.mode === 'washer' ? t('inv.washer') : this.mode === 'trade' ? t('inv.trade')
      : this.mode === 'backpack' ? t('inv.backpack') : t('inv.craft');
    panel.appendChild(h);

    const craftRow = document.createElement('div');
    craftRow.className = 'inv-craft-row';

    // Rüstungs-Slots (Helm/Brust/Hose/Stiefel) links
    const armorCol = document.createElement('div');
    armorCol.className = 'inv-armor';
    for (const slotKey of ['helmet', 'chest', 'legs', 'boots']) {
      armorCol.appendChild(this._slotEl(this.armor[slotKey], (btn) => {
        const cur = this.cursor;
        const eq = this.armor[slotKey];
        if (cur) {
          if (!isEquipment(cur.id) || ITEMS[cur.id]?.armor?.slot !== slotKey) return;
          this.armor[slotKey] = cur;
          this.cursor = eq || null;
        } else if (eq) {
          this.cursor = eq;
          this.armor[slotKey] = null;
        }
        this._renderPanel();
        this._renderHotbar();
      }, this.armor[slotKey] ? '' : 'leer'));
    }
    // Rucksack-Slot (nur Rucksäcke; legt beim Ausrüsten den Inhalt an)
    armorCol.appendChild(this._slotEl(this.backpack, () => {
      const cur = this.cursor, eq = this.backpack;
      if (cur) {
        if (cur.id !== ITEM.BACKPACK) return; // nur ein Rucksack passt hier rein
        if (!Array.isArray(cur.bag)) cur.bag = new Array(BACKPACK_SIZE).fill(null);
        this.backpack = cur;
        this.cursor = eq || null;
      } else if (eq) {
        this.cursor = eq;
        this.backpack = null;
      }
      this._renderPanel();
      this._renderHotbar();
    }, this.backpack ? 'bag' : 'bag leer'));
    craftRow.appendChild(armorCol);

    if (this.mode === 'anvil') {
      // Amboss: Ausrüstung einlegen, Upgrades in freie Slots packen, Slots leeren
      craftRow.appendChild(this._slotEl(this.anvilItem, () => {
        const cur = this.cursor;
        // Sockel-Rune aufs eingelegte Teil: +1 Upgrade-Slot (max 6)
        if (cur && cur.id === ITEM.SOCKET_RUNE && this.anvilItem) {
          if ((this.anvilItem.slots || 0) >= 6) return;
          if (!this._ambossBezahlen(AMBOSS_KOSTEN_SOCKEL)) return; // XP-Kosten — sonst kein Sockel
          this.anvilItem.slots = (this.anvilItem.slots || 0) + 1;
          cur.count--;
          if (cur.count <= 0) this.cursor = null;
          this.ctx.sounds.pickup();
          this._renderPanel();
          return;
        }
        if (cur) {
          if (!isEquipment(cur.id)) return;
          const alt = this.anvilItem;
          this.anvilItem = cur;
          this.cursor = alt || null;
        } else if (this.anvilItem) {
          this.cursor = this.anvilItem;
          this.anvilItem = null;
        }
        this._renderPanel();
      }));
      const ups = document.createElement('div');
      ups.className = 'inv-anvil-ups';
      const item = this.anvilItem;
      const nSlots = item ? (item.slots || 0) : 0;
      for (let i = 0; i < Math.max(nSlots, 1); i++) {
        if (!item || i >= nSlots) {
          ups.appendChild(this._slotEl(null, null, 'leer'));
          continue;
        }
        const up = (item.upgrades || [])[i];
        ups.appendChild(this._slotEl(up != null ? { id: up, count: 1 } : null, () => {
          const cur = this.cursor;
          if (up != null || !cur) return; // belegte Slots nur über „leeren“
          if (!UPGRADE_IDS.has(cur.id)) return;
          item.upgrades = item.upgrades || [];
          if (item.upgrades.length >= nSlots) return;
          if (!this._ambossBezahlen(AMBOSS_KOSTEN_UPGRADE)) return; // XP-Kosten — sonst kein Upgrade
          item.upgrades.push(cur.id);
          cur.count--;
          if (cur.count <= 0) this.cursor = null;
          this.ctx.sounds.blockPlace();
          this._renderPanel();
        }, up != null ? '' : 'leer'));
      }
      craftRow.appendChild(ups);
      if (item && (item.upgrades || []).length > 0) {
        const clear = document.createElement('button');
        clear.className = 'inv-clear-btn';
        clear.textContent = t('inv.clearSlots');
        clear.title = t('inv.clearSlotsTip');
        clear.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          item.upgrades = [];
          this.ctx.sounds.blockBreak();
          this._renderPanel();
        });
        craftRow.appendChild(clear);
      }
      // Kosten-Hinweis: Amboss-Arbeit kostet XP-Level (nur im Überleben)
      if (this.ctx.state.mode === 'survival') {
        const hint = document.createElement('div');
        hint.className = 'inv-anvil-hint';
        const lvl = this.ctx.experience?.level ?? 0;
        hint.innerHTML = t('inv.anvilCost', AMBOSS_KOSTEN_SOCKEL, AMBOSS_KOSTEN_UPGRADE, lvl);
        craftRow.appendChild(hint);
      }
    } else if (this.mode === 'enchant') {
      // Verzauberungstisch: Item einlegen, dann 1 von 3 Optionen wählen
      craftRow.appendChild(this._slotEl(this.enchantItem, () => {
        const cur = this.cursor;
        if (cur) {
          if (!canEnchant(cur.id)) return;
          const alt = this.enchantItem;
          this.enchantItem = cur; this.cursor = alt || null;
        } else if (this.enchantItem) {
          this.cursor = this.enchantItem; this.enchantItem = null;
        }
        this._enchOpts = this.enchantItem ? rollOptions(this.enchantItem.id) : null;
        this._renderPanel();
      }, this.enchantItem ? '' : 'leer'));

      const box = document.createElement('div');
      box.className = 'inv-ench-opts';
      const creative = this.ctx.state.mode !== 'survival';
      const lvl = this.ctx.experience?.level ?? 0;
      const em = this.countItem(ITEM.EMERALD), sa = this.countItem(ITEM.SAPPHIRE);
      if (!this.enchantItem) {
        const h0 = document.createElement('div'); h0.className = 'inv-anvil-hint';
        h0.textContent = t('inv.enchantPrompt');
        box.appendChild(h0);
      }
      (this._enchOpts || []).forEach((opt) => {
        const units = Math.ceil(opt.cost / 10);
        const affordX = creative || lvl >= opt.cost;
        const affordG = creative || Math.floor(em / 10) + sa >= units;
        const usable = !!opt.ench && affordX && affordG;
        const row = document.createElement('div');
        row.className = 'inv-ench-opt' + (usable ? '' : ' disabled');
        const name = opt.ench ? `${t('ench.' + opt.ench.key)} ${romanLevel(opt.ench.level)}` : t('inv.enchantNone');
        const nameEl = document.createElement('div'); nameEl.className = 'inv-ench-name';
        nameEl.textContent = `${t('rarity.' + opt.rarity)} — ${name}`;
        const costEl = document.createElement('div'); costEl.className = 'inv-ench-cost';
        costEl.textContent = t('inv.enchantCost', opt.cost, units * 10, units);
        row.appendChild(nameEl); row.appendChild(costEl);
        if (usable) row.addEventListener('mousedown', (e) => { e.stopPropagation(); this._applyEnchant(opt); });
        box.appendChild(row);
      });
      craftRow.appendChild(box);
      if (this.ctx.state.mode === 'survival') {
        const hint = document.createElement('div'); hint.className = 'inv-anvil-hint';
        hint.innerHTML = t('inv.enchantHave', lvl, em, sa);
        craftRow.appendChild(hint);
      }
    } else if (this.mode === 'chest') {
      // Truhe: 27 freie Slots (3×9)
      const grid = document.createElement('div');
      grid.className = 'inv-grid';
      grid.style.gridTemplateColumns = 'repeat(9, 44px)';
      const c = this.chestData;
      for (let i = 0; i < 27; i++) {
        const idx = i;
        grid.appendChild(this._slotEl(c.slots[idx], (btn) => {
          this._clickCell(
            () => c.slots[idx],
            (v) => { c.slots[idx] = v; },
            btn, false
          );
        }, c.slots[idx] ? '' : 'leer'));
      }
      craftRow.appendChild(grid);
    } else if (this.mode === 'backpack') {
      // Rucksack: Slots gebunden an den Inhalt; Stauraum-Verzauberung gibt mehr Reihen
      const size = bagSize(this.backpack);
      const bag = this.backpack?.bag || [];
      while (bag.length < size) bag.push(null);
      const grid = document.createElement('div');
      grid.className = 'inv-grid';
      grid.style.gridTemplateColumns = 'repeat(9, 44px)';
      for (let i = 0; i < size; i++) {
        const idx = i;
        grid.appendChild(this._slotEl(bag[idx], (btn) => {
          this._clickCell(() => bag[idx], (v) => { bag[idx] = v; }, btn, false);
        }, bag[idx] ? '' : 'leer'));
      }
      craftRow.appendChild(grid);
    } else if (this.mode === 'furnace') {
      // Ofen: Eingabe oben, Brennstoff unten, Pfeil mit Fortschritt, Ausgabe
      const f = this.furnace;
      const mkSlot = (key, filter) => this._slotEl(f[key], (btn) => {
        // falsches Material am Cursor: gar nicht erst interagieren (kein Item-Verlust)
        if (this.cursor && filter && !filter(this.cursor.id)) return;
        this._clickCell(
          () => f[key],
          (v) => { f[key] = v; },
          btn, false
        );
        this._renderPanel();
      }, f[key] ? '' : 'leer');
      const colIn = document.createElement('div');
      colIn.className = 'inv-smelt-col';
      colIn.appendChild(mkSlot('input', (id) => !!SMELT[id]));
      const hint = document.createElement('div');
      hint.className = 'inv-smelt-hint';
      hint.textContent = t('inv.fuel');
      colIn.appendChild(hint);
      colIn.appendChild(mkSlot('fuel', (id) => !!FUEL[id]));
      craftRow.appendChild(colIn);

      const mid = document.createElement('div');
      mid.className = 'inv-smelt-col';
      const arrow = document.createElement('div');
      arrow.className = 'inv-arrow';
      arrow.textContent = '→';
      mid.appendChild(arrow);
      const bar = document.createElement('div');
      bar.className = 'inv-smelt-bar';
      const fill = document.createElement('div');
      fill.style.width = (f.progress / 2 * 100).toFixed(0) + '%';
      bar.appendChild(fill);
      mid.appendChild(bar);
      craftRow.appendChild(mid);

      // Ausgabe: nur entnehmen
      craftRow.appendChild(this._slotEl(f.output, () => {
        if (!f.output) return;
        if (!this.cursor) { this.cursor = f.output; f.output = null; }
        else if (this.cursor.id === f.output.id &&
                 this.cursor.count + f.output.count <= stackSizeOf(f.output.id)) {
          this.cursor.count += f.output.count;
          f.output = null;
        }
        this._renderPanel();
      }, f.output ? '' : 'leer'));
    } else if (this.mode === 'brewing') {
      // Braustand: Flaschen | Wasser | ⚗ Fortschritt | Zutat | Zutat
      const b = this.brew;
      const mkSlot = (key, filter) => this._slotEl(b[key], (btn) => {
        if (this.cursor && filter && !filter(this.cursor.id)) return;
        this._clickCell(() => b[key], (v) => { b[key] = v; }, btn, false);
        this._syncBrew();       // Mitspieler bekommen die neuen Slots (Host startet den Timer)
        this._renderPanel();
      }, b[key] ? '' : 'leer');
      const labeled = (label, el) => {
        const col = document.createElement('div'); col.className = 'inv-smelt-col';
        const hint = document.createElement('div'); hint.className = 'inv-smelt-hint'; hint.textContent = label;
        col.appendChild(hint); col.appendChild(el); return col;
      };
      craftRow.appendChild(labeled(t('inv.bottles'), mkSlot('bottles', (id) => id === ITEM.GLASS_BOTTLE)));
      craftRow.appendChild(labeled(t('inv.water'), mkSlot('water', (id) => id === ITEM.WATER_BUCKET)));
      const mid = document.createElement('div'); mid.className = 'inv-smelt-col';
      const arrow = document.createElement('div'); arrow.className = 'inv-arrow'; arrow.textContent = '⚗';
      mid.appendChild(arrow);
      const bar = document.createElement('div'); bar.className = 'inv-smelt-bar';
      const fill = document.createElement('div'); fill.style.width = (b.progress / 6 * 100).toFixed(0) + '%';
      bar.appendChild(fill); mid.appendChild(bar);
      craftRow.appendChild(mid);
      const ingFilter = (id) => id === ITEM.CRIMSON_BLOOD || id === BLOCK.VINE || id === ITEM.SUGAR || id === ITEM.KELP;
      craftRow.appendChild(labeled(t('inv.ingredient'), mkSlot('ing1', ingFilter)));
      craftRow.appendChild(labeled(t('inv.ingredient'), mkSlot('ing2', ingFilter)));
    } else if (this.mode === 'washer') {
      // Washer: Dirty Flux | Wasser | 💧 Fortschritt | Ausgabe (Flux-Staub, nur entnehmen)
      const wa = this.wash;
      const mkSlot = (key, filter) => this._slotEl(wa[key], (btn) => {
        if (this.cursor && filter && !filter(this.cursor.id)) return;
        this._clickCell(() => wa[key], (v) => { wa[key] = v; }, btn, false);
        this._syncWash();
        this._renderPanel();
      }, wa[key] ? '' : 'leer');
      const labeled = (label, el) => {
        const col = document.createElement('div'); col.className = 'inv-smelt-col';
        const hint = document.createElement('div'); hint.className = 'inv-smelt-hint'; hint.textContent = label;
        col.appendChild(hint); col.appendChild(el); return col;
      };
      craftRow.appendChild(labeled('Dirty Flux', mkSlot('input', (id) => id === ITEM.DIRTY_FLUX)));
      craftRow.appendChild(labeled(t('inv.water'), mkSlot('water', (id) => id === ITEM.WATER_BUCKET)));
      const mid = document.createElement('div'); mid.className = 'inv-smelt-col';
      const arrow = document.createElement('div'); arrow.className = 'inv-arrow'; arrow.textContent = '💧';
      mid.appendChild(arrow);
      const bar = document.createElement('div'); bar.className = 'inv-smelt-bar';
      const fill = document.createElement('div'); fill.style.width = (wa.progress / 3 * 100).toFixed(0) + '%';
      bar.appendChild(fill); mid.appendChild(bar);
      craftRow.appendChild(mid);
      craftRow.appendChild(labeled(t('inv.fluxDust'), this._slotEl(wa.output, () => {
        if (!wa.output) return;
        if (!this.cursor) { this.cursor = wa.output; wa.output = null; }
        else if (this.cursor.id === wa.output.id && this.cursor.count + wa.output.count <= stackSizeOf(wa.output.id)) {
          this.cursor.count += wa.output.count; wa.output = null;
        }
        this._syncWash(); this._renderPanel();
      }, wa.output ? '' : 'leer')));
    } else if (this.mode === 'trade') {
      // Handel: Level-Info + Angebote (freigeschaltete klickbar, weitere gesperrt)
      const v = this.trader;
      const pool = v?.trades || [];
      const level = this.ctx.entities.villagerLevel(v);
      const PER = 2; // Trades pro Level (= TRADES_PER_LEVEL)
      const list = document.createElement('div');
      list.className = 'inv-trades';
      const info = document.createElement('div');
      info.className = 'inv-trade-info';
      const nextIn = level < pool.length ? PER - ((v.tradeXp || 0) % PER) : 0;
      info.textContent = t('inv.tradeInfo', level, level, pool.length)
        + (nextIn ? t('inv.tradeNext', nextIn) : t('inv.tradeFull'));
      list.appendChild(info);
      pool.forEach((tr, i) => {
        const unlocked = i < level;
        const afford = unlocked && this.countItem(tr.costId) >= tr.costCount;
        const row = document.createElement('div');
        row.className = 'inv-trade-row' + (!unlocked ? ' locked' : afford ? '' : ' disabled');
        row.appendChild(this._slotEl({ id: tr.costId, count: tr.costCount }, null));
        const arr = document.createElement('div'); arr.className = 'inv-arrow'; arr.textContent = unlocked ? '→' : '🔒'; row.appendChild(arr);
        row.appendChild(this._slotEl({ id: tr.resultId, count: tr.resultCount }, null));
        if (unlocked) row.onclick = () => { if (this._doTrade(tr)) this._renderPanel(); };
        list.appendChild(row);
      });
      craftRow.appendChild(list);
    } else {
      const grid = document.createElement('div');
      grid.className = 'inv-grid';
      grid.style.gridTemplateColumns = `repeat(${this.craftW}, 44px)`;
      for (let i = 0; i < this.craft.length; i++) {
        grid.appendChild(this._slotEl(this.craft[i], (btn) => {
          this._clickCell(
            () => this.craft[i],
            (v) => { this.craft[i] = v; },
            btn, true
          );
        }));
      }
      craftRow.appendChild(grid);
      const arrow = document.createElement('div');
      arrow.className = 'inv-arrow';
      arrow.textContent = '→';
      craftRow.appendChild(arrow);
      craftRow.appendChild(this._slotEl(this.result, () => this._takeResult()));
    }
    panel.appendChild(craftRow);

    // Kreativ-Palette: jeden Block / jedes Item direkt nehmen
    if (this.ctx.state.mode === 'creative') {
      const hc = document.createElement('h3');
      hc.textContent = t('inv.creativeAll');
      panel.appendChild(hc);
      const pal = document.createElement('div');
      pal.className = 'inv-palette';
      const ids = [
        ...Object.keys(BLOCKS).map(Number)
          .filter((id) => !BLOCKS[id].fluid && !BLOCKS[id].hidden).sort((a, b) => a - b),
        ...Object.keys(ITEMS).map(Number).sort((a, b) => a - b),
      ];
      for (const id of ids) {
        pal.appendChild(this._slotEl({ id, count: 1 }, (btn) => {
          const max = stackSizeOf(id);
          if (btn === 2) {
            if (!this.cursor) this.cursor = { id, count: 1 };
            else if (this.cursor.id === id && this.cursor.count < max) this.cursor.count++;
            else this.cursor = { id, count: 1 };
          } else {
            this.cursor = { id, count: max };
          }
          this._renderPanel();
        }));
      }
      panel.appendChild(pal);
    }

    const h2 = document.createElement('h3');
    h2.textContent = t('inv.inventory');
    panel.appendChild(h2);

    const main = document.createElement('div');
    main.className = 'inv-main';
    for (let i = 9; i < 36; i++) {
      main.appendChild(this._slotEl(this.slots[i], (btn) => {
        this._clickCell(() => this.slots[i], (v) => { this.slots[i] = v; }, btn, false);
      }));
    }
    panel.appendChild(main);

    const bar = document.createElement('div');
    bar.className = 'inv-bar';
    for (let i = 0; i < 9; i++) {
      bar.appendChild(this._slotEl(this.slots[i], (btn) => {
        this._clickCell(() => this.slots[i], (v) => { this.slots[i] = v; }, btn, false);
      }));
    }
    panel.appendChild(bar);

    this.overlayEl.appendChild(panel);
    this._renderCursor();
  }

  _renderAll() {
    this._renderHotbar();
    if (this._open) this._renderPanel();
  }
}
