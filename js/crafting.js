// Recipes + grid matching (shaped with trim & mirror, shapeless by multiset).

import { BLOCK, ITEM } from './constants.js';

const P = BLOCK.PLANKS, C = BLOCK.COBBLESTONE, S = ITEM.STICK;

// Alle Brett-Sorten sind beim Craften austauschbar (wie in Minecraft): fürs
// Rezept-Matching zählen Birken-/Fichten-/Dschungelbretter wie Eichenbretter.
const PLANK_ALT = new Set([BLOCK.BIRCH_PLANKS, BLOCK.SPRUCE_PLANKS, BLOCK.JUNGLE_PLANKS]);
const canonPlank = (id) => (PLANK_ALT.has(id) ? BLOCK.PLANKS : id);

export const RECIPES = [
  { shapeless: [BLOCK.LOG], result: { id: BLOCK.PLANKS, count: 4 } },
  { shapeless: [BLOCK.BIRCH_LOG], result: { id: BLOCK.BIRCH_PLANKS, count: 4 } },
  { shapeless: [BLOCK.SPRUCE_LOG], result: { id: BLOCK.SPRUCE_PLANKS, count: 4 } },
  { shapeless: [BLOCK.JUNGLE_LOG], result: { id: BLOCK.JUNGLE_PLANKS, count: 4 } },
  { pattern: [[P], [P]], result: { id: S, count: 4 } },
  { pattern: [[P, P], [P, P]], result: { id: BLOCK.CRAFTING_TABLE, count: 1 } },
  { pattern: [[ITEM.COAL], [S]], result: { id: BLOCK.TORCH, count: 4 } },
  { pattern: [[P, P, P], [0, S, 0], [0, S, 0]], result: { id: ITEM.WOODEN_PICKAXE, count: 1 } },
  { pattern: [[C, C, C], [0, S, 0], [0, S, 0]], result: { id: ITEM.STONE_PICKAXE, count: 1 } },
  { pattern: [[P, P], [P, S], [0, S]], result: { id: ITEM.WOODEN_AXE, count: 1 } },
  { pattern: [[C, C], [C, S], [0, S]], result: { id: ITEM.STONE_AXE, count: 1 } },
  { pattern: [[P], [S], [S]], result: { id: ITEM.WOODEN_SHOVEL, count: 1 } },
  { pattern: [[C], [S], [S]], result: { id: ITEM.STONE_SHOVEL, count: 1 } },
  { pattern: [[P], [P], [S]], result: { id: ITEM.WOODEN_SWORD, count: 1 } },
  { pattern: [[C], [C], [S]], result: { id: ITEM.STONE_SWORD, count: 1 } },
  { shapeless: [BLOCK.SUGAR_CANE], result: { id: ITEM.SUGAR, count: 1 } },
  { shapeless: [ITEM.BONE], result: { id: ITEM.BONE_MEAL, count: 3 } },
  { shapeless: [ITEM.FLINT, ITEM.IRON_INGOT], result: { id: ITEM.FLINT_AND_STEEL, count: 1 } },
  // Eimer: 3 Eisen in V-Form
  { pattern: [[ITEM.IRON_INGOT, 0, ITEM.IRON_INGOT], [0, ITEM.IRON_INGOT, 0]], result: { id: ITEM.BUCKET, count: 1 } },
  // Bogen: 3 Stöcke + 1 Faden
  { shapeless: [S, S, S, ITEM.STRING], result: { id: ITEM.BOW, count: 1 } },
  // Pfeile: 1 Stock + 1 Feuerstein → 4 Pfeile
  { shapeless: [S, ITEM.FLINT], result: { id: ITEM.ARROW, count: 4 } },
];

// TNT: Schwarzpulver + Sand im Schachbrett
{
  const G = ITEM.GUNPOWDER, D = BLOCK.SAND;
  RECIPES.push({ pattern: [[G, D, G], [D, G, D], [G, D, G]], result: { id: BLOCK.TNT, count: 1 } });
}

// Bau-Blöcke: Truhe, Tür, Glasscheiben, Stufen, Treppen, Leiter, Falltür, Teppich, Bett
{
  const GL = BLOCK.GLASS, SC = BLOCK.SUGAR_CANE, T = BLOCK.CARPET;
  const BP = BLOCK.BIRCH_PLANKS, SP = BLOCK.SPRUCE_PLANKS, JP = BLOCK.JUNGLE_PLANKS;
  RECIPES.push(
    { pattern: [[P, P, P], [P, 0, P], [P, P, P]], result: { id: BLOCK.CHEST, count: 1 } },
    { pattern: [[P, P], [P, P], [P, P]], result: { id: BLOCK.DOOR_LOWER_N, count: 1 } },
    { pattern: [[GL, GL, GL], [GL, GL, GL]], result: { id: BLOCK.GLASS_PANE, count: 16 } },
    { pattern: [[P, P, P]], result: { id: BLOCK.PLANK_SLAB, count: 6 } },
    { pattern: [[C, C, C]], result: { id: BLOCK.COBBLE_SLAB, count: 6 } },
    { pattern: [[P, 0, 0], [P, P, 0], [P, P, P]], result: { id: BLOCK.PLANK_STAIRS_E, count: 4 } },
    { pattern: [[C, 0, 0], [C, C, 0], [C, C, C]], result: { id: BLOCK.COBBLE_STAIRS_E, count: 4 } },
    // Farbige Stufen + Treppen — je Holzart aus den passenden Brettern (behalten ihre Farbe)
    { pattern: [[BP, BP, BP]], result: { id: BLOCK.BIRCH_SLAB, count: 6 } },
    { pattern: [[SP, SP, SP]], result: { id: BLOCK.SPRUCE_SLAB, count: 6 } },
    { pattern: [[JP, JP, JP]], result: { id: BLOCK.JUNGLE_SLAB, count: 6 } },
    { pattern: [[BP, 0, 0], [BP, BP, 0], [BP, BP, BP]], result: { id: BLOCK.BIRCH_STAIRS_E, count: 4 } },
    { pattern: [[SP, 0, 0], [SP, SP, 0], [SP, SP, SP]], result: { id: BLOCK.SPRUCE_STAIRS_E, count: 4 } },
    { pattern: [[JP, 0, 0], [JP, JP, 0], [JP, JP, JP]], result: { id: BLOCK.JUNGLE_STAIRS_E, count: 4 } },
    { pattern: [[S, 0, S], [S, S, S], [S, 0, S]], result: { id: BLOCK.LADDER, count: 3 } },
    { pattern: [[P, P, P], [P, P, P]], result: { id: BLOCK.TRAPDOOR, count: 2 } },
    { pattern: [[SC, SC, SC]], result: { id: BLOCK.CARPET, count: 2 } },
    { shapeless: [T, BLOCK.FLOWER_RED], result: { id: BLOCK.CARPET_RED, count: 1 } },
    { shapeless: [T, BLOCK.FLOWER_YELLOW], result: { id: BLOCK.CARPET_YELLOW, count: 1 } },
    { shapeless: [T, ITEM.BONE_MEAL], result: { id: BLOCK.CARPET_WHITE, count: 1 } },
    // Bett braucht echte Wolle (Schafe scheren!); Wolle taugt auch als Teppich-Basis
    { pattern: [[BLOCK.WOOL, BLOCK.WOOL, BLOCK.WOOL], [P, P, P]], result: { id: BLOCK.BED_FOOT, count: 1 } },
    { pattern: [[BLOCK.WOOL, BLOCK.WOOL]], result: { id: BLOCK.CARPET, count: 3 } },
    // Schere: 2 Eisenbarren diagonal
    { pattern: [[ITEM.IRON_INGOT, 0], [0, ITEM.IRON_INGOT]], result: { id: ITEM.SHEARS, count: 1 } },
    // Sandstein: 4 Sand im Quadrat; Steinziegel: 4 Stein → 4
    { pattern: [[BLOCK.SAND, BLOCK.SAND], [BLOCK.SAND, BLOCK.SAND]], result: { id: BLOCK.SANDSTONE, count: 1 } },
    { pattern: [[BLOCK.STONE, BLOCK.STONE], [BLOCK.STONE, BLOCK.STONE]], result: { id: BLOCK.STONE_BRICKS, count: 4 } },
    // Gefärbtes Glas: Glas + Kristall-Scherbe
    { shapeless: [BLOCK.GLASS, ITEM.CRYSTAL_BLUE_SHARD], result: { id: BLOCK.GLASS_BLUE, count: 1 } },
    { shapeless: [BLOCK.GLASS, ITEM.CRYSTAL_PURPLE_SHARD], result: { id: BLOCK.GLASS_PURPLE, count: 1 } },
    { shapeless: [BLOCK.GLASS, ITEM.CRYSTAL_GREEN_SHARD], result: { id: BLOCK.GLASS_GREEN, count: 1 } },
    { shapeless: [BLOCK.GLASS, ITEM.CRYSTAL_ORANGE_SHARD], result: { id: BLOCK.GLASS_ORANGE, count: 1 } }
  );
  // Faden: 4 → 1 Wolle (Spinnennetze ernten!)
  RECIPES.push(
    { pattern: [[ITEM.STRING, ITEM.STRING], [ITEM.STRING, ITEM.STRING]], result: { id: BLOCK.WOOL, count: 1 } }
  );
  // Kiesel: 4 Kleine Steine → 1 Bruchstein; Moos + Bruchstein → bemooster Bruchstein
  RECIPES.push(
    { pattern: [[ITEM.PEBBLE, ITEM.PEBBLE], [ITEM.PEBBLE, ITEM.PEBBLE]], result: { id: BLOCK.COBBLESTONE, count: 1 } },
    { shapeless: [BLOCK.COBBLESTONE, BLOCK.MOSS], result: { id: BLOCK.MOSSY_COBBLESTONE, count: 1 } }
  );
  // Metallblöcke: 9 Items ↔ 1 Block (beide Richtungen)
  const METALL = [
    [ITEM.IRON_INGOT, BLOCK.IRON_BLOCK],
    [ITEM.GOLD_INGOT, BLOCK.GOLD_BLOCK],
    [ITEM.DIAMOND, BLOCK.DIAMOND_BLOCK],
  ];
  for (const [item, block] of METALL) {
    RECIPES.push(
      { pattern: [[item, item, item], [item, item, item], [item, item, item]], result: { id: block, count: 1 } },
      { shapeless: [block], result: { id: item, count: 9 } }
    );
  }
}

// Verzauberungs-Kette: Papier (Zuckerrohr-Spalte), Buch, Bücherregal, Verzauberungstisch
{
  const SC = BLOCK.SUGAR_CANE, PA = ITEM.PAPER, BK = ITEM.BOOK, LE = ITEM.LEATHER;
  const DI = ITEM.DIAMOND, OB = BLOCK.OBSIDIAN, SPC = ITEM.SPELL_CORE;
  RECIPES.push(
    { pattern: [[SC], [SC], [SC]], result: { id: PA, count: 3 } },
    { shapeless: [PA, PA, PA, LE], result: { id: BK, count: 1 } },
    { pattern: [[P, P, P], [BK, BK, BK], [P, P, P]], result: { id: BLOCK.BOOKSHELF, count: 1 } },
    { pattern: [[0, BK, 0], [DI, SPC, DI], [OB, OB, OB]], result: { id: BLOCK.ENCHANTING_TABLE, count: 1 } }
  );
}

// Werkzeug-, Waffen- und Rüstungsrezepte für Eisen/Gold/Diamant (programmatisch)
{
  const MATS = [
    ['IRON', ITEM.IRON_INGOT], ['GOLD', ITEM.GOLD_INGOT], ['DIAMOND', ITEM.DIAMOND],
  ];
  for (const [K, M] of MATS) {
    RECIPES.push(
      { pattern: [[M, M, M], [0, S, 0], [0, S, 0]], result: { id: ITEM[K + '_PICKAXE'], count: 1 } },
      { pattern: [[M, M], [M, S], [0, S]], result: { id: ITEM[K + '_AXE'], count: 1 } },
      { pattern: [[M], [S], [S]], result: { id: ITEM[K + '_SHOVEL'], count: 1 } },
      { pattern: [[M], [M], [S]], result: { id: ITEM[K + '_SWORD'], count: 1 } },
      { pattern: [[M, M, M], [M, 0, M]], result: { id: ITEM[K + '_HELMET'], count: 1 } },
      { pattern: [[M, 0, M], [M, M, M], [M, M, M]], result: { id: ITEM[K + '_CHEST'], count: 1 } },
      { pattern: [[M, M, M], [M, 0, M], [M, 0, M]], result: { id: ITEM[K + '_LEGS'], count: 1 } },
      { pattern: [[M, 0, M], [M, 0, M]], result: { id: ITEM[K + '_BOOTS'], count: 1 } }
    );
  }
  const I = ITEM.IRON_INGOT;
  RECIPES.push({ pattern: [[I, I, I], [0, I, 0], [I, I, I]], result: { id: BLOCK.ANVIL, count: 1 } });
  RECIPES.push({ pattern: [[C, C, C], [C, 0, C], [C, C, C]], result: { id: BLOCK.FURNACE, count: 1 } });
}

// Farming: Harken (2 Material + 2 Stöcke) und Brot (3 Weizen in einer Reihe)
{
  RECIPES.push(
    { pattern: [[P, P], [0, S], [0, S]], result: { id: ITEM.WOODEN_HOE, count: 1 } },
    { pattern: [[C, C], [0, S], [0, S]], result: { id: ITEM.STONE_HOE, count: 1 } },
    { pattern: [[ITEM.IRON_INGOT, ITEM.IRON_INGOT], [0, S], [0, S]], result: { id: ITEM.IRON_HOE, count: 1 } },
    { pattern: [[ITEM.WHEAT, ITEM.WHEAT, ITEM.WHEAT]], result: { id: ITEM.BREAD, count: 1 } }
  );
  // Glasflaschen (3 Glas in V-Form → 3) und Braustand (Eisenstange auf Bruchstein)
  RECIPES.push(
    { pattern: [[BLOCK.GLASS, 0, BLOCK.GLASS], [0, BLOCK.GLASS, 0]], result: { id: ITEM.GLASS_BOTTLE, count: 3 } },
    { pattern: [[0, ITEM.IRON_INGOT, 0], [C, C, C]], result: { id: BLOCK.BREWING_STAND, count: 1 } }
  );
  // (Der Heiltrank wird jetzt im Braustand gebraut, nicht mehr an der Werkbank.)
}

// Rudimentäres Redstone: Hebel, Knopf, Kolben (Redstone-Leitung gibt's im Kreativ-Menü)
{
  RECIPES.push(
    { pattern: [[S], [C]], result: { id: BLOCK.LEVER, count: 1 } },
    { shapeless: [C], result: { id: BLOCK.BUTTON, count: 1 } },
    { pattern: [[P, P, P], [C, ITEM.IRON_INGOT, C], [C, C, C]], result: { id: BLOCK.PISTON_N, count: 1 } }
  );
}

// Flux-Block (9 Flux-Staub ↔ 1) und Washer (Eisen + Bruchstein)
{
  const FD = BLOCK.REDSTONE_DUST, I = ITEM.IRON_INGOT;
  RECIPES.push(
    { pattern: [[FD, FD, FD], [FD, FD, FD], [FD, FD, FD]], result: { id: BLOCK.FLUX_BLOCK, count: 1 } },
    { shapeless: [BLOCK.FLUX_BLOCK], result: { id: FD, count: 9 } },
    { pattern: [[I, I, I], [I, 0, I], [C, C, C]], result: { id: BLOCK.WASHER, count: 1 } },
    // Klebriger Kolben = Kolben + Schleimball
    { shapeless: [BLOCK.PISTON_N, ITEM.SLIMEBALL], result: { id: BLOCK.STICKY_PISTON_N, count: 1 } }
  );
}

function trim(rows) {
  let r0 = rows.length, r1 = -1, c0 = rows[0].length, c1 = -1;
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      if (rows[r][c] !== 0) {
        r0 = Math.min(r0, r); r1 = Math.max(r1, r);
        c0 = Math.min(c0, c); c1 = Math.max(c1, c);
      }
    }
  }
  if (r1 === -1) return null;
  const out = [];
  for (let r = r0; r <= r1; r++) out.push(rows[r].slice(c0, c1 + 1));
  return out;
}

function gridsEqual(a, b) {
  if (a.length !== b.length || a[0].length !== b[0].length) return false;
  for (let r = 0; r < a.length; r++) {
    for (let c = 0; c < a[r].length; c++) {
      if (a[r][c] !== b[r][c]) return false;
    }
  }
  return true;
}

function mirrored(rows) {
  return rows.map((r) => [...r].reverse());
}

// Ein Durchlauf gegen alle Rezepte mit den Ids genau so, wie sie im Grid liegen.
function tryRecipes(gridIds, w, h) {
  const rows = [];
  for (let r = 0; r < h; r++) rows.push(gridIds.slice(r * w, r * w + w));
  const trimmed = trim(rows);
  if (!trimmed) return null;
  const items = gridIds.filter((id) => id !== 0).sort((a, b) => a - b);
  for (const recipe of RECIPES) {
    if (recipe.shapeless) {
      const want = [...recipe.shapeless].sort((a, b) => a - b);
      if (want.length === items.length && want.every((id, i) => id === items[i])) return { ...recipe.result };
    } else if (gridsEqual(trimmed, recipe.pattern) || gridsEqual(trimmed, mirrored(recipe.pattern))) {
      return { ...recipe.result };
    }
  }
  return null;
}

// gridIds: row-major array (w*h) of ids, 0 = empty. Returns {id, count} or null.
export function matchGrid(gridIds, w, h) {
  // 1) Exakt: holzartspezifische Rezepte (farbige Stufen/Treppen behalten ihre Holzart).
  const exact = tryRecipes(gridIds, w, h);
  if (exact) return exact;
  // 2) Bretter vereinheitlicht: holzunabhängige Rezepte (Stöcke, Werkbank, Werkzeuge …)
  //    funktionieren mit JEDER Bretterfarbe — auch gemischt.
  const canon = gridIds.map(canonPlank);
  return tryRecipes(canon, w, h);
}
