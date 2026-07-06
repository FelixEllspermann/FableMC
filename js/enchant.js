// Verzauberungen: Definitionen, Seltenheit, Anwendbarkeit und Auswürfeln.
// Importiert NUR aus constants.js (kein Zyklus mit equip.js — dur wird inline geprüft).

import { ITEMS, ITEM } from './constants.js';

const hasDur = (id) => !!(ITEMS[id] && ITEMS[id].dur);

export const RARITIES = ['common', 'uncommon', 'rare'];
export const RARITY_NAME = { common: 'Gewöhnlich', uncommon: 'Ungewöhnlich', rare: 'Selten' };
export const RARITY_COST = { common: 10, uncommon: 20, rare: 30 }; // XP-Level je Option

// Verzauberungen: max Level, worauf anwendbar, welche Level welche Seltenheit haben.
// applies: 'durable' = alles mit Haltbarkeit außer Backpack · 'tool' = Werkzeuge ·
// 'weapon' = Schwerter · 'armorpack' = Rüstung + Backpack · 'backpack' = nur Backpack.
export const ENCHANTS = {
  unbreakable: { name: 'Unzerbrechlich', max: 5, applies: 'durable',   levels: { common: [1, 2], uncommon: [3, 4], rare: [5] } },
  efficiency:  { name: 'Effizienz',      max: 5, applies: 'tool',      levels: { common: [1, 2], uncommon: [3, 4], rare: [5] } },
  sharpness:   { name: 'Schärfe',        max: 5, applies: 'weapon',    levels: { common: [1, 2], uncommon: [3, 4], rare: [5] } },
  protection:  { name: 'Schutz',         max: 5, applies: 'armorpack', levels: { common: [1, 2], uncommon: [3, 4], rare: [5] } },
  space:       { name: 'Stauraum',       max: 3, applies: 'backpack',  levels: { common: [1], uncommon: [2], rare: [3] } },
};

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
export function romanLevel(n) { return ROMAN[n] || String(n); }

// Passt diese Anwendungs-Kategorie auf das Item?
export function appliesTo(kind, id) {
  const d = ITEMS[id];
  if (!d) return false;
  const isPack = id === ITEM.BACKPACK;
  const isArmor = !!d.armor;
  const isTool = !!d.tool;
  const isWeapon = d.damage != null && !isTool && !isArmor && !isPack; // Schwert
  switch (kind) {
    case 'durable': return hasDur(id) && !isPack;
    case 'tool': return isTool;
    case 'weapon': return isWeapon;
    case 'armorpack': return isArmor || isPack;
    case 'backpack': return isPack;
    default: return false;
  }
}

// Kann dieses Item überhaupt verzaubert werden?
export function canEnchant(id) { return hasDur(id) || id === ITEM.BACKPACK; }

// Eine zufällige (Verzauberung, Level) dieser Seltenheit, die aufs Item passt — sonst null.
export function rollEnchant(rarity, id) {
  const pool = [];
  for (const key in ENCHANTS) {
    const e = ENCHANTS[key];
    if (!appliesTo(e.applies, id)) continue;
    for (const lvl of e.levels[rarity]) pool.push({ key, level: lvl });
  }
  if (!pool.length) return null;
  return pool[(Math.random() * pool.length) | 0];
}

// Die 3 Tisch-Optionen (common/uncommon/rare) fürs Item auswürfeln.
export function rollOptions(id) {
  return RARITIES.map((r) => ({ rarity: r, cost: RARITY_COST[r], ench: rollEnchant(r, id) }));
}
