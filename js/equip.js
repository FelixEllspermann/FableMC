// Ausrüstungs-System: Upgrade-Slots (beim Craften gewürfelt), Upgrades (am Amboss),
// Effektivität pro Item-Art, Haltbarkeit. Item-Instanzen sind Stacks mit Extra-Feldern:
//   { id, count: 1, slots, upgrades: [itemIds], used }

import { BLOCK, ITEM, ITEMS, nameOf } from './constants.js';
import { ENCHANTS, romanLevel } from './enchant.js';

// Slot-Chance pro verbautem Material (jede Zutat würfelt einen potenziellen Slot)
export const SLOT_CHANCE = {
  [ITEM.STICK]: 0.10,
  [BLOCK.PLANKS]: 0.10,
  [BLOCK.LOG]: 0.10,
  [BLOCK.BIRCH_LOG]: 0.10,
  [BLOCK.SPRUCE_LOG]: 0.10,
  [BLOCK.COBBLESTONE]: 0.25,
  [ITEM.RAW_IRON]: 0.50,
  [ITEM.IRON_INGOT]: 0.50,
  [ITEM.RAW_GOLD]: 0.90,
  [ITEM.GOLD_INGOT]: 0.90,
  [ITEM.DIAMOND]: 0.75,
};

// gültige Upgrade-Materialien (Eisen/Gold als Barren oder roh)
export const UPGRADE_IDS = new Set([
  ITEM.IRON_INGOT, ITEM.RAW_IRON, ITEM.GOLD_INGOT, ITEM.RAW_GOLD,
  ITEM.FLINT, ITEM.DIAMOND, ITEM.SUGAR,
]);

export function isEquipment(id) {
  const d = ITEMS[id];
  return !!(d && d.dur);
}

export function equipKind(id) {
  const d = ITEMS[id];
  if (!d) return null;
  if (d.armor) return 'armor';
  if (d.tool) return 'tool';
  if (d.damage) return 'weapon';
  return null;
}

const BASE_EFF = { armor: 0.75, tool: 1.0, weapon: 1.5 };

// Beim Craften: jede Zutat im Grid würfelt ihre Slot-Chance
export function rollSlots(gridIds) {
  let slots = 0;
  for (const id of gridIds) {
    if (!id) continue;
    const chance = SLOT_CHANCE[id] || 0;
    if (Math.random() < chance) slots++;
  }
  return slots;
}

export function makeInstance(id, gridIds) {
  return { id, count: 1, slots: rollSlots(gridIds || []), upgrades: [], used: 0 };
}

// Effektive Boni einer Instanz (Zucker verdoppelt die Effektivität der anderen Slots)
export function equipStats(stack) {
  const out = {
    durBonus: 0, speedBonus: 0, dmgAll: 0, dmgAnimal: 0,
    harvestBonus: 0, defense: 0, thorns: 0, eff: 1,
    reach: 0, airBonus: 0, kbImmune: false, stepHeight: 0, fallBonus: 0,
  };
  if (!stack) return out;
  // Verzauberungs-Boni (gelten auch für den Rucksack, der kein „isEquipment" ist)
  const ench = stack.ench;
  if (ench) {
    if (ench.efficiency) out.speedBonus += ench.efficiency * 0.4; // Effizienz: schneller abbauen
    if (ench.sharpness) out.dmgAll += ench.sharpness * 1.0;       // Schärfe: mehr Schaden
    if (ench.protection) out.defense += ench.protection * 1.0;    // Schutz: mehr Rüstung
  }
  if (!isEquipment(stack.id)) return out;
  const kind = equipKind(stack.id);
  const ups = stack.upgrades || [];
  const sugar = ups.filter((u) => u === ITEM.SUGAR).length;
  const eff = (BASE_EFF[kind] ?? 1) * (1 + sugar);
  out.eff = eff;
  const armorSlot = ITEMS[stack.id]?.armor?.slot;
  for (const u of ups) {
    if (u === ITEM.RAW_IRON || u === ITEM.IRON_INGOT) out.durBonus += 500 * eff;
    else if (u === ITEM.FLINT) {
      if (kind === 'tool') out.speedBonus += 0.15 * eff;
      else if (kind === 'weapon') out.dmgAnimal += 1 * eff;
      else if (kind === 'armor') out.thorns += 1 * eff;
    } else if (u === ITEM.DIAMOND) {
      if (kind === 'tool') out.harvestBonus += 1 * eff;
      else if (kind === 'weapon') out.dmgAll += 1 * eff;
      else if (kind === 'armor') out.defense += 1 * eff;
    } else if (u === ITEM.RAW_GOLD || u === ITEM.GOLD_INGOT) {
      // Gold = Utility: Reichweite (Werkzeug/Waffe) bzw. slot-spezifisch bei Rüstung
      if (kind === 'tool' || kind === 'weapon') out.reach += 1 * eff;
      else if (armorSlot === 'helmet') out.airBonus += 1 * eff;      // +1s Luft
      else if (armorSlot === 'chest') out.kbImmune = true;           // kein Rückstoß
      else if (armorSlot === 'legs') out.stepHeight += 1;            // Auto-Step (flach: 0.75 Stufen gäbe es nicht)
      else if (armorSlot === 'boots') out.fallBonus += 1 * eff;      // Fallschutz
    }
  }
  return out;
}

// Aggregierte Boni der getragenen Rüstung
export function armorStats(armor) {
  const out = {
    defense: 0, thorns: 0, airBonus: 0, kbImmune: false, stepHeight: 0, fallBonus: 0,
  };
  if (!armor) return out;
  for (const k of ['helmet', 'chest', 'legs', 'boots']) {
    const p = armor[k];
    if (!p) continue;
    const s = equipStats(p);
    out.defense += (ITEMS[p.id]?.armor?.defense || 0) + s.defense;
    out.thorns += s.thorns;
    out.airBonus += s.airBonus;
    out.kbImmune = out.kbImmune || s.kbImmune;
    out.stepHeight += s.stepHeight;
    out.fallBonus += s.fallBonus;
  }
  return out;
}

export function maxDurability(stack) {
  const base = ITEMS[stack.id]?.dur || 0;
  return Math.round(base + equipStats(stack).durBonus);
}

export function durabilityLeft(stack) {
  return maxDurability(stack) - (stack.used || 0);
}

// true → Item ist zerbrochen
export function damageItem(stack, amount = 1) {
  // Unzerbrechlich: Chance level/(level+1), KEINE Haltbarkeit zu verlieren
  const unb = stack.ench?.unbreakable || 0;
  if (unb > 0 && Math.random() < unb / (unb + 1)) return stack.used >= maxDurability(stack);
  stack.used = (stack.used || 0) + amount;
  return stack.used >= maxDurability(stack);
}

// Abbau-Helfer (instanzfähig)
export function toolLevelFor(stack, blockTool) {
  const t = stack ? ITEMS[stack.id]?.tool : null;
  if (!t || t.type !== blockTool) return 0;
  return t.level + Math.floor(equipStats(stack).harvestBonus);
}

export function miningTimeFor(blockDef, stack) {
  if (!blockDef || blockDef.hardness < 0) return Infinity;
  const t = stack ? ITEMS[stack.id]?.tool : null;
  let mult = 1;
  if (t && t.type === blockDef.tool) {
    mult = t.speedMult * (1 + equipStats(stack).speedBonus);
  }
  return blockDef.hardness / mult;
}

export function meleeDamageFor(stack, isAnimal) {
  const base = (stack ? ITEMS[stack.id]?.damage : null) ?? 1;
  const s = equipStats(stack);
  return base + s.dmgAll + (isAnimal ? s.dmgAnimal : 0);
}

// Tooltip-Text (title-Attribut, \n = Zeilenumbruch)
export function tooltipFor(stack) {
  if (!stack) return '';
  let t = nameOf(stack.id);
  if (stack.ench) {
    for (const key in stack.ench) {
      const e = ENCHANTS[key];
      if (e) t += `\n✦ ${e.name} ${romanLevel(stack.ench[key])}`;
    }
  }
  if (!isEquipment(stack.id)) return t;
  const d = ITEMS[stack.id];
  const s = equipStats(stack);
  if (d.armor) t += `\nVerteidigung: ${(d.armor.defense + s.defense).toFixed(1)}`;
  if (s.thorns > 0) t += `\nDornen: ${s.thorns.toFixed(1)}`;
  if (d.damage) {
    t += `\nSchaden: ${(d.damage + s.dmgAll).toFixed(1)}`;
    if (s.dmgAnimal > 0) t += ` (+${s.dmgAnimal.toFixed(1)} gegen Tiere)`;
  }
  if (d.tool) {
    t += `\nAbbaustufe: ${d.tool.level + Math.floor(s.harvestBonus)}`;
    if (s.speedBonus > 0) t += `\nAbbautempo: +${Math.round(s.speedBonus * 100)}%`;
  }
  if (s.reach > 0) t += `\nReichweite: +${s.reach.toFixed(1)}`;
  if (s.airBonus > 0) t += `\nAtemluft: +${s.airBonus.toFixed(1)}s`;
  if (s.kbImmune) t += '\nKein Rückstoß';
  if (s.stepHeight > 0) t += `\nStufenhöhe: +${s.stepHeight.toFixed(1)}`;
  if (s.fallBonus > 0) t += `\nFallschutz: +${s.fallBonus.toFixed(1)} Block`;
  t += `\nHaltbarkeit: ${durabilityLeft(stack)}/${maxDurability(stack)}`;
  const slots = stack.slots || 0;
  const ups = stack.upgrades || [];
  t += `\nUpgrade-Slots: ${slots}`;
  if (slots > 0) {
    t += ` (${slots - ups.length} frei)`;
    if (ups.length) t += `\nUpgrades: ${ups.map((u) => nameOf(u)).join(', ')}`;
  }
  return t;
}
