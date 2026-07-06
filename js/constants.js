// Canonical shared configuration & data tables. Every module imports from here.
// Do not duplicate these values elsewhere.

// ---- World / chunks ----
export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 512;
export const SEA_LEVEL = 150;
// Sichtweite kommt live aus settings.js (5..36 Chunks). Voll-detaillierte Voxel-Chunks
// gibt es bis zu diesem Cap — darüber übernimmt das vereinfachte Fern-Terrain.
export const VOXEL_DETAIL_CAP = 10;
export const DAY_LENGTH = 2400;      // seconds for a full cycle: 30 min Tag + 10 min Nacht (siehe daynight.js)

export function blockIndex(lx, y, lz) {
  return lx + lz * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE;
}
export function chunkKey(cx, cz) {
  return cx + ',' + cz;
}

// ---- Player / physics ----
export const GRAVITY = 32;          // blocks/s^2
export const JUMP_SPEED = 9.0;      // clears ~1.25 blocks
export const WALK_SPEED = 4.3;
export const SPRINT_SPEED = 5.8;
export const SNEAK_SPEED = 1.9;
export const SWIM_UP_SPEED = 4.0;
export const REACH = 5;             // block interaction distance
export const PLAYER = { WIDTH: 0.6, HEIGHT: 1.8, EYE_HEIGHT: 1.62 };

// ---- Entities ----
export const PIG_CAP = 8;
export const ZOMBIE_CAP = 8;
export const ATTACK_COOLDOWN = 0.4; // player swing, seconds
export const HAND_DAMAGE = 1;

// ---- Block ids ----
export const BLOCK = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  COBBLESTONE: 4,
  LOG: 5,
  PLANKS: 6,
  LEAVES: 7,
  SAND: 8,
  WATER: 9,
  BEDROCK: 10,
  COAL_ORE: 11,
  IRON_ORE: 12,
  CRAFTING_TABLE: 13,
  SNOW: 14,
  SNOWY_GRASS: 15,
  BIRCH_LOG: 16,
  BIRCH_LEAVES: 17,
  SPRUCE_LOG: 18,
  SPRUCE_LEAVES: 19,
  RED_SAND: 20,
  TERRACOTTA: 21,
  TERRACOTTA_RED: 22,
  MYCELIUM: 23,
  MUSHROOM_STEM: 24,
  MUSHROOM_CAP_RED: 25,
  MUSHROOM_CAP_BROWN: 26,
  SAVANNA_GRASS: 27,
  FLOWER_RED: 28,
  FLOWER_YELLOW: 29,
  TALL_GRASS: 30,
  LAVA: 31,
  DRIPSTONE: 32,
  MOSS: 33,
  CAVE_VINE: 34,
  // fließende Flüssigkeiten (Simulation): Wasser Pegel 7..1, Lava Pegel 6/4/2
  WATER_FLOW7: 35, WATER_FLOW6: 36, WATER_FLOW5: 37, WATER_FLOW4: 38,
  WATER_FLOW3: 39, WATER_FLOW2: 40, WATER_FLOW1: 41,
  LAVA_FLOW6: 42, LAVA_FLOW4: 43, LAVA_FLOW2: 44,
  TORCH: 45,
  GRAVEL: 46,
  SUGAR_CANE: 47,
  ANVIL: 48,
  GOLD_ORE: 49,
  DIAMOND_ORE: 50,
  FURNACE: 51,
  FURNACE_ON: 52, // brennender Ofen (Block-Zwilling mit Glut-Textur + Licht)
  SAPLING: 53,
  BIRCH_SAPLING: 54,
  SPRUCE_SAPLING: 55,
  TNT: 56,
  CHEST: 57,
  GLASS: 58,
  GLASS_PANE: 59,
  PLANK_SLAB: 60, PLANK_SLAB_TOP: 61,
  COBBLE_SLAB: 62, COBBLE_SLAB_TOP: 63,
  // Treppen: id-kodierte Blickrichtung (Aufstieg nach E/W/S/N)
  PLANK_STAIRS_E: 64, PLANK_STAIRS_W: 65, PLANK_STAIRS_S: 66, PLANK_STAIRS_N: 67,
  COBBLE_STAIRS_E: 68, COBBLE_STAIRS_W: 69, COBBLE_STAIRS_S: 70, COBBLE_STAIRS_N: 71,
  LADDER: 72,
  TRAPDOOR: 73, // geschlossen (flach unten)
  TRAPDOOR_OPEN_N: 74, TRAPDOOR_OPEN_E: 75, TRAPDOOR_OPEN_S: 76, TRAPDOOR_OPEN_W: 77,
  // Türen: Paneel-Kante ist in der id kodiert; öffnen = Kante wechseln (N↔E, S↔W)
  DOOR_LOWER_N: 78, DOOR_LOWER_E: 79, DOOR_LOWER_S: 80, DOOR_LOWER_W: 81,
  DOOR_UPPER_N: 82, DOOR_UPPER_E: 83, DOOR_UPPER_S: 84, DOOR_UPPER_W: 85,
  CARPET: 86, CARPET_RED: 87, CARPET_YELLOW: 88, CARPET_WHITE: 89,
  BED_FOOT: 90, BED_HEAD: 91,
  // Über-Kopf-Treppen (an der Decke / oberen Blockhälfte platziert)
  PLANK_STAIRS_E_TOP: 92, PLANK_STAIRS_W_TOP: 93, PLANK_STAIRS_S_TOP: 94, PLANK_STAIRS_N_TOP: 95,
  COBBLE_STAIRS_E_TOP: 96, COBBLE_STAIRS_W_TOP: 97, COBBLE_STAIRS_S_TOP: 98, COBBLE_STAIRS_N_TOP: 99,
  WOOL: 100,
  SEAGRASS: 101, // wassergeflutete Pflanzen: Zelle zählt als Wasser
  KELP: 102,
  SHRUB: 103,
  CACTUS: 104,
  CACTUS_FLOWER: 105,
  SANDSTONE: 106,
  VINE: 107,
  STONE_BRICKS: 108,
  CRACKED_STONE_BRICKS: 109,
  MOSSY_STONE_BRICKS: 110,
  LOOT_CHEST: 111,
  // Kristalle (getöntes „Glas" mit Glitzer) + gefärbtes Glas
  CRYSTAL_BLUE: 112, CRYSTAL_PURPLE: 113, CRYSTAL_GREEN: 114, CRYSTAL_ORANGE: 115,
  GLASS_BLUE: 116, GLASS_PURPLE: 117, GLASS_GREEN: 118, GLASS_ORANGE: 119,
  TOWER_CHEST: 120, // Turm-Truhe: füllt sich beim ersten Öffnen mit Beute
  IRON_BLOCK: 121, GOLD_BLOCK: 122, DIAMOND_BLOCK: 123, // 9 Items ↔ 1 Block
  WRECK_CHEST: 124, // Schiffstruhe (Wrack-Beute beim ersten Öffnen)
  MOSSY_COBBLESTONE: 125,
  PEBBLES: 126, // Deko-Kiesel am Boden: aufheben → Kleiner Stein
  DUNGEON_CHEST: 127, // Dungeon-Truhe (Beute beim ersten Öffnen)
  COBWEB: 128,  // Spinnennetz: bremst, droppt Faden
  SPAWNER: 129, // Monster-Spawner (Dungeon)
  // Farming: Ackerland (trocken/nass) + Feldfrüchte in je 4 Wachstumsstufen
  FARMLAND: 130, FARMLAND_WET: 131,
  WHEAT_0: 132, WHEAT_1: 133, WHEAT_2: 134, WHEAT_3: 135,
  CARROT_0: 136, CARROT_1: 137, CARROT_2: 138, CARROT_3: 139,
  POTATO_0: 140, POTATO_1: 141, POTATO_2: 142, POTATO_3: 143,
  BOSS_SPAWNER: 144, // Kern der Badlands-Ruine: beschwört den Blutroten Zombie
  BREWING_STAND: 145, // Braustand: Werkbank für Tränke
  // Rudimentäres Redstone
  REDSTONE_DUST: 146, REDSTONE_DUST_ON: 147, // Leitung (aus/an)
  LEVER: 148, LEVER_ON: 149,                 // Hebel (Umschalter)
  BUTTON: 150, BUTTON_ON: 151,               // Knopf (kurzzeitig)
  PISTON_N: 152, PISTON_E: 153, PISTON_S: 154, PISTON_W: 155, // Kolben (4 Richtungen)
  PISTON_HEAD: 156,                          // ausgefahrener Kolbenarm
  FLUX_ORE: 157,   // Erz → droppt Dirty Flux
  WASHER: 158,     // Werkbank: reinigt Dirty Flux zu Flux-Staub
  FLUX_BLOCK: 159, // schiebbarer Block, dauerhafte Flux-Quelle
  STICKY_PISTON_N: 160, STICKY_PISTON_E: 161, STICKY_PISTON_S: 162, STICKY_PISTON_W: 163, // klebrige Kolben
  PISTON_UP: 164, PISTON_DOWN: 165,                        // vertikale Kolben (nach oben/unten)
  STICKY_PISTON_UP: 166, STICKY_PISTON_DOWN: 167,          // vertikale klebrige Kolben
  JUNGLE_LOG: 168,                                         // Dschungelstamm (eigene Rinde)
  JUNGLE_BUSH: 169,                                        // Dschungel-Unterwuchs (Blätterbusch, zerfällt nicht)
  HANGING_ROOTS: 170,                                      // Wurzeln, hängen von Höhlendecken
  ROOTED_DIRT: 171,                                        // Wurzelerde (Decke, aus der Wurzeln wachsen)
  GLOW_LICHEN: 172,                                        // Leuchtflechte (spendet Licht in Höhlen)
  EMERALD_ORE: 173,                                        // Smaragderz (selten) → droppt Smaragd
  SAPPHIRE_ORE: 174,                                       // Saphirerz (sehr selten) → droppt Saphir
  BIRCH_PLANKS: 175,                                       // helle Bretter (Birke)
  SPRUCE_PLANKS: 176,                                      // dunkle Bretter (Fichte)
  JUNGLE_PLANKS: 177,                                      // rötliche Bretter (Dschungel)
  // Farbige Stufen + Treppen je Holzart (Struktur wie PLANK_SLAB/PLANK_STAIRS)
  BIRCH_SLAB: 178, BIRCH_SLAB_TOP: 179,
  SPRUCE_SLAB: 180, SPRUCE_SLAB_TOP: 181,
  JUNGLE_SLAB: 182, JUNGLE_SLAB_TOP: 183,
  BIRCH_STAIRS_E: 184, BIRCH_STAIRS_W: 185, BIRCH_STAIRS_S: 186, BIRCH_STAIRS_N: 187,
  SPRUCE_STAIRS_E: 188, SPRUCE_STAIRS_W: 189, SPRUCE_STAIRS_S: 190, SPRUCE_STAIRS_N: 191,
  JUNGLE_STAIRS_E: 192, JUNGLE_STAIRS_W: 193, JUNGLE_STAIRS_S: 194, JUNGLE_STAIRS_N: 195,
  BIRCH_STAIRS_E_TOP: 196, BIRCH_STAIRS_W_TOP: 197, BIRCH_STAIRS_S_TOP: 198, BIRCH_STAIRS_N_TOP: 199,
  SPRUCE_STAIRS_E_TOP: 200, SPRUCE_STAIRS_W_TOP: 201, SPRUCE_STAIRS_S_TOP: 202, SPRUCE_STAIRS_N_TOP: 203,
  JUNGLE_STAIRS_E_TOP: 204, JUNGLE_STAIRS_W_TOP: 205, JUNGLE_STAIRS_S_TOP: 206, JUNGLE_STAIRS_N_TOP: 207,
};

// blocks mobs may spawn on / that count as "grass-like" ground
export const GRASSY = [1, 15, 27, 23]; // GRASS, SNOWY_GRASS, SAVANNA_GRASS, MYCELIUM

// ---- Item ids (>= 1000; ids 1..999 sind platzierbare Blöcke — Chunks speichern Uint16) ----
export const ITEM = {
  STICK: 1000,
  WOODEN_PICKAXE: 1001,
  WOODEN_AXE: 1002,
  WOODEN_SHOVEL: 1003,
  WOODEN_SWORD: 1004,
  STONE_PICKAXE: 1005,
  STONE_AXE: 1006,
  STONE_SHOVEL: 1007,
  STONE_SWORD: 1008,
  COAL: 1010,
  RAW_IRON: 1011,
  PORKCHOP: 1012,
  ROTTEN_FLESH: 1013,
  APPLE: 1014,
  FLINT: 1015,
  SUGAR: 1016,
  RAW_GOLD: 1017,
  DIAMOND: 1018,
  IRON_PICKAXE: 1019, IRON_AXE: 1020, IRON_SHOVEL: 1021, IRON_SWORD: 1022,
  GOLD_PICKAXE: 1023, GOLD_AXE: 1024, GOLD_SHOVEL: 1025, GOLD_SWORD: 1026,
  DIAMOND_PICKAXE: 1027, DIAMOND_AXE: 1028, DIAMOND_SHOVEL: 1029, DIAMOND_SWORD: 1030,
  IRON_HELMET: 1031, IRON_CHEST: 1032, IRON_LEGS: 1033, IRON_BOOTS: 1034,
  GOLD_HELMET: 1035, GOLD_CHEST: 1036, GOLD_LEGS: 1037, GOLD_BOOTS: 1038,
  DIAMOND_HELMET: 1039, DIAMOND_CHEST: 1040, DIAMOND_LEGS: 1041, DIAMOND_BOOTS: 1042,
  IRON_INGOT: 1043,
  GOLD_INGOT: 1044,
  BONE: 1045,
  GUNPOWDER: 1046,
  BONE_MEAL: 1047,
  FLINT_AND_STEEL: 1048,
  SHEARS: 1049,
  KELP: 1050,
  RAW_FISH: 1051,
  COOKED_FISH: 1052,
  MUTTON: 1053,
  COOKED_MUTTON: 1054,
  COOKED_PORKCHOP: 1055,
  SOCKET_RUNE: 1056,
  CRYSTAL_BLUE_SHARD: 1057, CRYSTAL_PURPLE_SHARD: 1058,
  CRYSTAL_GREEN_SHARD: 1059, CRYSTAL_ORANGE_SHARD: 1060,
  SCROLL_MINING: 1061, SCROLL_WATER: 1062, SCROLL_LEVITATION: 1063,
  PEBBLE: 1064,
  STRING: 1065,
  BUCKET: 1066, WATER_BUCKET: 1067, LAVA_BUCKET: 1068,
  WOODEN_HOE: 1069, STONE_HOE: 1070, IRON_HOE: 1071,
  WHEAT_SEEDS: 1072, WHEAT: 1073, CARROT: 1074, POTATO: 1075, BREAD: 1076,
  CRIMSON_BLOOD: 1077, // Boss-Drop: Crafting-Material für den Heiltrank
  CRIMSON_POTION: 1078, // Heiltrank: 4 Herzen, 10 s 50 % Schadensschutz, entfernt Debuffs
  GLASS_BOTTLE: 1079,   // leere Flasche → im Braustand zum Trank
  SPEED_POTION: 1080,   // Speed-Trank: schnelleres Laufen für kurze Zeit
  DIRTY_FLUX: 1081,     // Roh-Drop vom Flux-Erz → im Washer zu Flux-Staub
  SLIMEBALL: 1082,      // Schleim-Drop → klebriger Kolben
  RAW_CHICKEN: 1083,    // Huhn-Drop → im Ofen zu gebratenem Hühnchen
  COOKED_CHICKEN: 1084,
  FEATHER: 1085,        // Huhn-Drop: Bastelmaterial
  EMERALD: 1086,        // Währung (selten) — Handel mit Dorfbewohnern
  SAPPHIRE: 1087,       // Währung (sehr selten, wertvoller) — Handel mit Dorfbewohnern
  BACKPACK: 1088,       // Rucksack: extra Inventar (mit B öffnen), Inhalt bleibt erhalten
  BOW: 1089,            // Bogen: Rechtsklick halten zum Spannen, loslassen zum Schießen
  ARROW: 1090,          // Pfeil: Munition für den Bogen (auch bei Dorfbewohnern kaufbar)
};

// Ofen: was lässt sich schmelzen, was taugt als Brennstoff (Anzahl Schmelzvorgänge)
export const SMELT = {
  [ITEM.RAW_IRON]: ITEM.IRON_INGOT,
  [ITEM.RAW_GOLD]: ITEM.GOLD_INGOT,
  [BLOCK.SAND]: BLOCK.GLASS,
  // Kochen: gebratenes Essen sättigt deutlich besser als rohes
  [ITEM.PORKCHOP]: ITEM.COOKED_PORKCHOP,
  [ITEM.MUTTON]: ITEM.COOKED_MUTTON,
  [ITEM.RAW_FISH]: ITEM.COOKED_FISH,
  [ITEM.RAW_CHICKEN]: ITEM.COOKED_CHICKEN,
};
export const FUEL = {
  [ITEM.COAL]: 8,
  [BLOCK.PLANKS]: 2,
  [BLOCK.BIRCH_PLANKS]: 2,
  [BLOCK.SPRUCE_PLANKS]: 2,
  [BLOCK.JUNGLE_PLANKS]: 2,
  [BLOCK.LOG]: 2,
  [BLOCK.BIRCH_LOG]: 2,
  [BLOCK.SPRUCE_LOG]: 2,
  [BLOCK.JUNGLE_LOG]: 2,
  [ITEM.STICK]: 1,
};

export function isBlockId(id) { return id > 0 && id < 1000; }

// ---- Block metadata ----
// tiles: atlas tile names {top, side, bottom} (all faces fall back to `side`)
// hardness: seconds to mine BY HAND; -1 = unbreakable
// tool: which tool class speeds it up ('pickaxe'|'axe'|'shovel'|null)
// harvestLevel: min tool level to get the drop (0 hand, 1 wood, 2 stone). Breaking always possible
//               (at hand speed) but yields no drop below this level.
// drops: item/block id dropped (undefined = drops itself); dropChance optional (default 1)
// opaque: false → neighbors render their faces against it
export const BLOCKS = {
  [BLOCK.GRASS]: { name: 'Grasblock', tiles: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' },
    hardness: 0.9, tool: 'shovel', harvestLevel: 0, drops: BLOCK.DIRT, opaque: true },
  [BLOCK.DIRT]: { name: 'Erde', tiles: { side: 'dirt' },
    hardness: 0.75, tool: 'shovel', harvestLevel: 0, opaque: true },
  [BLOCK.STONE]: { name: 'Stein', tiles: { side: 'stone' },
    hardness: 7.5, tool: 'pickaxe', harvestLevel: 1, drops: BLOCK.COBBLESTONE, opaque: true },
  [BLOCK.COBBLESTONE]: { name: 'Bruchstein', tiles: { side: 'cobblestone' },
    hardness: 10, tool: 'pickaxe', harvestLevel: 1, opaque: true },
  [BLOCK.LOG]: { name: 'Eichenstamm', tiles: { top: 'log_top', side: 'log_side', bottom: 'log_top' },
    hardness: 3, tool: 'axe', harvestLevel: 0, opaque: true },
  [BLOCK.PLANKS]: { name: 'Eichenholzbretter', tiles: { side: 'planks' },
    hardness: 3, tool: 'axe', harvestLevel: 0, opaque: true },
  [BLOCK.BIRCH_PLANKS]: { name: 'Birkenholzbretter', tiles: { side: 'birch_planks' },
    hardness: 3, tool: 'axe', harvestLevel: 0, opaque: true },
  [BLOCK.SPRUCE_PLANKS]: { name: 'Fichtenholzbretter', tiles: { side: 'spruce_planks' },
    hardness: 3, tool: 'axe', harvestLevel: 0, opaque: true },
  [BLOCK.JUNGLE_PLANKS]: { name: 'Dschungelholzbretter', tiles: { side: 'jungle_planks' },
    hardness: 3, tool: 'axe', harvestLevel: 0, opaque: true },
  [BLOCK.LEAVES]: { name: 'Eichenlaub', tiles: { side: 'leaves' },
    hardness: 0.35, tool: null, harvestLevel: 0, opaque: false, leaves: true,
    dropTable: [{ id: ITEM.APPLE, chance: 0.05 }, { id: BLOCK.SAPLING, chance: 0.08 },
      { id: ITEM.STICK, chance: 0.04 }] },
  [BLOCK.SAND]: { name: 'Sand', tiles: { side: 'sand' },
    hardness: 0.75, tool: 'shovel', harvestLevel: 0, opaque: true },
  [BLOCK.WATER]: { name: 'Wasser', tiles: { side: 'water' },
    hardness: -1, tool: null, harvestLevel: 0, opaque: false, solid: false },
  [BLOCK.BEDROCK]: { name: 'Grundgestein', tiles: { side: 'bedrock' },
    hardness: -1, tool: null, harvestLevel: 0, opaque: true },
  [BLOCK.COAL_ORE]: { name: 'Steinkohle', tiles: { side: 'coal_ore' },
    hardness: 9, tool: 'pickaxe', harvestLevel: 1, drops: ITEM.COAL, opaque: true },
  [BLOCK.IRON_ORE]: { name: 'Eisenerz', tiles: { side: 'iron_ore' },
    hardness: 9, tool: 'pickaxe', harvestLevel: 2, drops: ITEM.RAW_IRON, opaque: true },
  [BLOCK.CRAFTING_TABLE]: { name: 'Werkbank',
    tiles: { top: 'crafting_table_top', side: 'crafting_table_side', bottom: 'planks' },
    hardness: 3.5, tool: 'axe', harvestLevel: 0, opaque: true },
  [BLOCK.SNOW]: { name: 'Schnee', tiles: { side: 'snow' },
    hardness: 0.6, tool: 'shovel', harvestLevel: 0, opaque: true },
  [BLOCK.SNOWY_GRASS]: { name: 'Verschneiter Grasblock',
    tiles: { top: 'snow', side: 'grass_side_snowy', bottom: 'dirt' },
    hardness: 0.9, tool: 'shovel', harvestLevel: 0, drops: BLOCK.DIRT, opaque: true },
  [BLOCK.BIRCH_LOG]: { name: 'Birkenstamm', tiles: { top: 'log_top', side: 'birch_log_side', bottom: 'log_top' },
    hardness: 3, tool: 'axe', harvestLevel: 0, opaque: true },
  [BLOCK.BIRCH_LEAVES]: { name: 'Birkenlaub', tiles: { side: 'birch_leaves' },
    hardness: 0.35, tool: null, harvestLevel: 0, opaque: false, leaves: true,
    dropTable: [{ id: BLOCK.BIRCH_SAPLING, chance: 0.08 }, { id: ITEM.STICK, chance: 0.04 }] },
  [BLOCK.SPRUCE_LOG]: { name: 'Fichtenstamm', tiles: { top: 'log_top', side: 'spruce_log_side', bottom: 'log_top' },
    hardness: 3, tool: 'axe', harvestLevel: 0, opaque: true },
  [BLOCK.SPRUCE_LEAVES]: { name: 'Fichtennadeln', tiles: { side: 'spruce_leaves' },
    hardness: 0.35, tool: null, harvestLevel: 0, opaque: false, leaves: true,
    dropTable: [{ id: BLOCK.SPRUCE_SAPLING, chance: 0.08 }, { id: ITEM.STICK, chance: 0.04 }] },
  [BLOCK.JUNGLE_LOG]: { name: 'Dschungelstamm', tiles: { top: 'log_top', side: 'jungle_log_side', bottom: 'log_top' },
    hardness: 3, tool: 'axe', harvestLevel: 0, opaque: true },
  [BLOCK.RED_SAND]: { name: 'Roter Sand', tiles: { side: 'red_sand' },
    hardness: 0.75, tool: 'shovel', harvestLevel: 0, opaque: true },
  [BLOCK.TERRACOTTA]: { name: 'Terrakotta', tiles: { side: 'terracotta' },
    hardness: 6, tool: 'pickaxe', harvestLevel: 1, opaque: true },
  [BLOCK.TERRACOTTA_RED]: { name: 'Rote Terrakotta', tiles: { side: 'terracotta_red' },
    hardness: 6, tool: 'pickaxe', harvestLevel: 1, opaque: true },
  [BLOCK.MYCELIUM]: { name: 'Myzel', tiles: { top: 'mycelium_top', side: 'mycelium_side', bottom: 'dirt' },
    hardness: 0.9, tool: 'shovel', harvestLevel: 0, drops: BLOCK.DIRT, opaque: true },
  [BLOCK.MUSHROOM_STEM]: { name: 'Pilzstiel', tiles: { side: 'mushroom_stem' },
    hardness: 1.2, tool: 'axe', harvestLevel: 0, opaque: true },
  [BLOCK.MUSHROOM_CAP_RED]: { name: 'Roter Pilzhut', tiles: { side: 'mushroom_cap_red' },
    hardness: 1.2, tool: 'axe', harvestLevel: 0, opaque: true },
  [BLOCK.MUSHROOM_CAP_BROWN]: { name: 'Brauner Pilzhut', tiles: { side: 'mushroom_cap_brown' },
    hardness: 1.2, tool: 'axe', harvestLevel: 0, opaque: true },
  [BLOCK.SAVANNA_GRASS]: { name: 'Savannengras',
    tiles: { top: 'savanna_grass_top', side: 'savanna_grass_side', bottom: 'dirt' },
    hardness: 0.9, tool: 'shovel', harvestLevel: 0, drops: BLOCK.DIRT, opaque: true },
  [BLOCK.FLOWER_RED]: { name: 'Mohnblume', tiles: { side: 'flower_red' },
    hardness: 0.05, tool: null, harvestLevel: 0, opaque: false, solid: false, cross: true },
  [BLOCK.FLOWER_YELLOW]: { name: 'Löwenzahn', tiles: { side: 'flower_yellow' },
    hardness: 0.05, tool: null, harvestLevel: 0, opaque: false, solid: false, cross: true },
  [BLOCK.TALL_GRASS]: { name: 'Hohes Gras', tiles: { side: 'tall_grass' },
    hardness: 0.05, tool: null, harvestLevel: 0, drops: 0, opaque: false, solid: false, cross: true,
    dropAlt: { id: ITEM.WHEAT_SEEDS, chance: 0.125 } }, // Gras droppt selten Weizensamen
  [BLOCK.LAVA]: { name: 'Lava', tiles: { side: 'lava' },
    hardness: -1, tool: null, harvestLevel: 0, opaque: false, solid: false },
  [BLOCK.DRIPSTONE]: { name: 'Tropfstein', tiles: { side: 'dripstone' },
    hardness: 5, tool: 'pickaxe', harvestLevel: 1, opaque: true },
  [BLOCK.MOSS]: { name: 'Moosblock', tiles: { side: 'moss' },
    hardness: 0.5, tool: 'shovel', harvestLevel: 0, opaque: true },
  [BLOCK.CAVE_VINE]: { name: 'Höhlenranke', tiles: { side: 'cave_vine' },
    hardness: 0.05, tool: null, harvestLevel: 0, drops: 0, opaque: false, solid: false, cross: true },
  [BLOCK.HANGING_ROOTS]: { name: 'Wurzeln', tiles: { side: 'hanging_roots' },
    hardness: 0.05, tool: null, harvestLevel: 0, opaque: false, solid: false, cross: true },
  [BLOCK.ROOTED_DIRT]: { name: 'Wurzelerde', tiles: { side: 'rooted_dirt' },
    hardness: 0.7, tool: 'shovel', harvestLevel: 0, opaque: true },
  [BLOCK.GLOW_LICHEN]: { name: 'Leuchtflechte', tiles: { side: 'glow_lichen' },
    hardness: 0.1, tool: null, harvestLevel: 0, drops: 0, opaque: false, solid: false, cross: true },
};

BLOCKS[BLOCK.TORCH] = { name: 'Fackel', tiles: { side: 'torch' },
  hardness: 0.05, tool: null, harvestLevel: 0, opaque: false, solid: false, cross: true };
BLOCKS[BLOCK.GRAVEL] = { name: 'Kies', tiles: { side: 'gravel' },
  hardness: 0.9, tool: 'shovel', harvestLevel: 0, opaque: true,
  dropAlt: { id: ITEM.FLINT, chance: 0.1 } };
BLOCKS[BLOCK.SUGAR_CANE] = { name: 'Zuckerrohr', tiles: { side: 'sugar_cane' },
  hardness: 0.05, tool: null, harvestLevel: 0, opaque: false, solid: false, cross: true };
BLOCKS[BLOCK.ANVIL] = { name: 'Amboss', tiles: { side: 'anvil' },
  hardness: 6, tool: 'pickaxe', harvestLevel: 1, opaque: true };
BLOCKS[BLOCK.GOLD_ORE] = { name: 'Golderz', tiles: { side: 'gold_ore' },
  hardness: 9, tool: 'pickaxe', harvestLevel: 3, drops: ITEM.RAW_GOLD, opaque: true };
BLOCKS[BLOCK.DIAMOND_ORE] = { name: 'Diamanterz', tiles: { side: 'diamond_ore' },
  hardness: 10, tool: 'pickaxe', harvestLevel: 3, drops: ITEM.DIAMOND, opaque: true };
BLOCKS[BLOCK.EMERALD_ORE] = { name: 'Smaragderz', tiles: { side: 'emerald_ore' },
  hardness: 9, tool: 'pickaxe', harvestLevel: 2, drops: ITEM.EMERALD, opaque: true };
BLOCKS[BLOCK.SAPPHIRE_ORE] = { name: 'Saphirerz', tiles: { side: 'sapphire_ore' },
  hardness: 10, tool: 'pickaxe', harvestLevel: 3, drops: ITEM.SAPPHIRE, opaque: true };
BLOCKS[BLOCK.FURNACE] = { name: 'Ofen',
  tiles: { top: 'furnace_side', side: 'furnace_front', bottom: 'furnace_side' },
  hardness: 7, tool: 'pickaxe', harvestLevel: 1, opaque: true };
BLOCKS[BLOCK.FURNACE_ON] = { name: 'Ofen',
  tiles: { top: 'furnace_side', side: 'furnace_front_on', bottom: 'furnace_side' },
  hardness: 7, tool: 'pickaxe', harvestLevel: 1, drops: BLOCK.FURNACE, opaque: true, hidden: true };

// ---- Bau-Blöcke: Teilblöcke mit eigenen Boxen (boxes = Kollision UND Rendering) ----
// Box-Format: [x0,y0,z0,x1,y1,z1] in Zellkoordinaten 0..1.
const TH = 0.1875; // Paneel-Dicke (Türen, Falltüren)
const EDGE_BOX = { // Paneel an der jeweiligen Zellkante
  N: [0, 0, 0, 1, 1, TH],
  E: [1 - TH, 0, 0, 1, 1, 1],
  S: [0, 0, 1 - TH, 1, 1, 1],
  W: [0, 0, 0, TH, 1, 1],
};

BLOCKS[BLOCK.CHEST] = { name: 'Truhe', tiles: { top: 'chest_top', side: 'chest_front', bottom: 'chest_top' },
  hardness: 3.5, tool: 'axe', harvestLevel: 0, opaque: false,
  boxes: [[0.0625, 0, 0.0625, 0.9375, 0.875, 0.9375]] };
BLOCKS[BLOCK.GLASS] = { name: 'Glas', tiles: { side: 'glass' },
  hardness: 0.5, tool: null, harvestLevel: 0, opaque: false, cullSame: true };
BLOCKS[BLOCK.GLASS_PANE] = { name: 'Glasscheibe', tiles: { side: 'glass' },
  hardness: 0.5, tool: null, harvestLevel: 0, opaque: false, pane: true,
  boxes: [[0.4375, 0, 0, 0.5625, 1, 1], [0, 0, 0.4375, 1, 1, 0.5625]] };

for (const [base, nm, tile, hard, tool] of [
  ['PLANK_SLAB', 'Bretterstufe', 'planks', 3, 'axe'],
  ['COBBLE_SLAB', 'Bruchsteinstufe', 'cobblestone', 10, 'pickaxe'],
  ['BIRCH_SLAB', 'Birkenstufe', 'birch_planks', 3, 'axe'],
  ['SPRUCE_SLAB', 'Fichtenstufe', 'spruce_planks', 3, 'axe'],
  ['JUNGLE_SLAB', 'Dschungelstufe', 'jungle_planks', 3, 'axe'],
]) {
  const id = BLOCK[base], topId = BLOCK[base + '_TOP'];
  const hl = tool === 'pickaxe' ? 1 : 0;
  BLOCKS[id] = { name: nm, tiles: { side: tile }, hardness: hard, tool, harvestLevel: hl,
    opaque: false, slab: 'bottom', matBase: base, boxes: [[0, 0, 0, 1, 0.5, 1]] };
  BLOCKS[topId] = { name: nm, tiles: { side: tile }, hardness: hard, tool, harvestLevel: hl,
    opaque: false, slab: 'top', matBase: base, drops: id, hidden: true, boxes: [[0, 0.5, 0, 1, 1, 1]] };
}

{
  // Treppen: halbe Platte + hohe Hälfte in Aufstiegsrichtung;
  // _TOP-Variante hängt an der Decke (Platte oben statt unten)
  const RISER = {
    E: [0.5, 0, 0, 1, 1, 1], W: [0, 0, 0, 0.5, 1, 1],
    S: [0, 0, 0.5, 1, 1, 1], N: [0, 0, 0, 1, 1, 0.5],
  };
  for (const [base, nm, tile, hard, tool] of [
    ['PLANK_STAIRS', 'Brettertreppe', 'planks', 3, 'axe'],
    ['COBBLE_STAIRS', 'Bruchsteintreppe', 'cobblestone', 10, 'pickaxe'],
    ['BIRCH_STAIRS', 'Birkentreppe', 'birch_planks', 3, 'axe'],
    ['SPRUCE_STAIRS', 'Fichtentreppe', 'spruce_planks', 3, 'axe'],
    ['JUNGLE_STAIRS', 'Dschungeltreppe', 'jungle_planks', 3, 'axe'],
  ]) {
    const hl = tool === 'pickaxe' ? 1 : 0;
    for (const dir of ['E', 'W', 'S', 'N']) {
      BLOCKS[BLOCK[base + '_' + dir]] = {
        name: nm, tiles: { side: tile }, hardness: hard, tool, harvestLevel: hl,
        opaque: false, stairs: dir, matBase: base, drops: BLOCK[base + '_E'], hidden: dir !== 'E',
        boxes: [[0, 0, 0, 1, 0.5, 1], RISER[dir]],
      };
      BLOCKS[BLOCK[base + '_' + dir + '_TOP']] = {
        name: nm, tiles: { side: tile }, hardness: hard, tool, harvestLevel: hl,
        opaque: false, stairs: dir, stairsTop: true, matBase: base, drops: BLOCK[base + '_E'], hidden: true,
        boxes: [[0, 0.5, 0, 1, 1, 1], RISER[dir]],
      };
    }
  }
}

BLOCKS[BLOCK.LADDER] = { name: 'Leiter', tiles: { side: 'ladder' },
  hardness: 0.6, tool: 'axe', harvestLevel: 0, opaque: false, solid: false, climbable: true, ladder: true };
BLOCKS[BLOCK.TRAPDOOR] = { name: 'Falltür', tiles: { side: 'trapdoor' },
  hardness: 3, tool: 'axe', harvestLevel: 0, opaque: false, trapdoor: 'closed',
  boxes: [[0, 0, 0, 1, TH, 1]] };
for (const dir of ['N', 'E', 'S', 'W']) {
  BLOCKS[BLOCK['TRAPDOOR_OPEN_' + dir]] = { name: 'Falltür', tiles: { side: 'trapdoor' },
    hardness: 3, tool: 'axe', harvestLevel: 0, opaque: false, trapdoor: dir,
    drops: BLOCK.TRAPDOOR, hidden: true, boxes: [EDGE_BOX[dir]] };
}
for (const dir of ['N', 'E', 'S', 'W']) {
  BLOCKS[BLOCK['DOOR_LOWER_' + dir]] = { name: 'Tür', tiles: { side: 'door_lower' },
    hardness: 3, tool: 'axe', harvestLevel: 0, opaque: false, door: 'lower', doorDir: dir,
    drops: BLOCK.DOOR_LOWER_N, hidden: dir !== 'N', boxes: [EDGE_BOX[dir]] };
  BLOCKS[BLOCK['DOOR_UPPER_' + dir]] = { name: 'Tür', tiles: { side: 'door_upper' },
    hardness: 3, tool: 'axe', harvestLevel: 0, opaque: false, door: 'upper', doorDir: dir,
    drops: BLOCK.DOOR_LOWER_N, hidden: true, boxes: [EDGE_BOX[dir]] };
}
for (const [id, nm, tile] of [
  [BLOCK.CARPET, 'Teppich', 'carpet'],
  [BLOCK.CARPET_RED, 'Roter Teppich', 'carpet_red'],
  [BLOCK.CARPET_YELLOW, 'Gelber Teppich', 'carpet_yellow'],
  [BLOCK.CARPET_WHITE, 'Weißer Teppich', 'carpet_white'],
]) {
  BLOCKS[id] = { name: nm, tiles: { side: tile }, hardness: 0.1, tool: null, harvestLevel: 0,
    opaque: false, carpet: true, boxes: [[0, 0, 0, 1, 0.0625, 1]] };
}
BLOCKS[BLOCK.BED_FOOT] = { name: 'Bett', tiles: { top: 'bed_foot', side: 'bed_side', bottom: 'planks' },
  hardness: 0.8, tool: null, harvestLevel: 0, opaque: false, bed: 'foot',
  boxes: [[0, 0, 0, 1, 0.5625, 1]] };
BLOCKS[BLOCK.BED_HEAD] = { name: 'Bett', tiles: { top: 'bed_head', side: 'bed_side', bottom: 'planks' },
  hardness: 0.8, tool: null, harvestLevel: 0, opaque: false, bed: 'head',
  drops: BLOCK.BED_FOOT, hidden: true, boxes: [[0, 0, 0, 1, 0.5625, 1]] };
BLOCKS[BLOCK.WOOL] = { name: 'Wolle', tiles: { side: 'wool' },
  hardness: 0.8, tool: null, harvestLevel: 0, opaque: true };
// Wasserpflanzen: die Zelle gilt gleichzeitig als Wasser (waterPlant) und
// hinterlässt beim Abbau Wasser statt Luft
BLOCKS[BLOCK.SEAGRASS] = { name: 'Seegras', tiles: { side: 'seagrass' },
  hardness: 0.05, tool: null, harvestLevel: 0, opaque: false, solid: false,
  cross: true, waterPlant: true, drops: 0 };
BLOCKS[BLOCK.KELP] = { name: 'Kelp', tiles: { side: 'kelp' },
  hardness: 0.05, tool: null, harvestLevel: 0, opaque: false, solid: false,
  cross: true, waterPlant: true, drops: ITEM.KELP };
BLOCKS[BLOCK.SHRUB] = { name: 'Dürrer Busch', tiles: { side: 'shrub' },
  hardness: 0.05, tool: null, harvestLevel: 0, opaque: false, solid: false, cross: true,
  drops: ITEM.STICK, dropChance: 0.6 };
// Dschungelbusch: leafy Unterwuchs — Kreuz-Pflanze (kein leaves-Flag → zerfällt nie)
BLOCKS[BLOCK.JUNGLE_BUSH] = { name: 'Dschungelbusch', tiles: { side: 'jungle_bush' },
  hardness: 0.05, tool: null, harvestLevel: 0, opaque: false, solid: false, cross: true,
  drops: 0, dropAlt: { id: BLOCK.SAPLING, chance: 0.05 } };
BLOCKS[BLOCK.CACTUS] = { name: 'Kaktus', tiles: { top: 'cactus_top', side: 'cactus_side', bottom: 'cactus_top' },
  hardness: 0.5, tool: null, harvestLevel: 0, opaque: false, cactus: true,
  boxes: [[0.0625, 0, 0.0625, 0.9375, 1, 0.9375]] };
BLOCKS[BLOCK.CACTUS_FLOWER] = { name: 'Kaktusblüte', tiles: { side: 'cactus_flower' },
  hardness: 0.05, tool: null, harvestLevel: 0, opaque: false, solid: false, cross: true };
BLOCKS[BLOCK.SANDSTONE] = { name: 'Sandstein',
  tiles: { top: 'sandstone_top', side: 'sandstone', bottom: 'sandstone_top' },
  hardness: 4, tool: 'pickaxe', harvestLevel: 1, opaque: true };
BLOCKS[BLOCK.VINE] = { name: 'Lianen', tiles: { side: 'vine' },
  hardness: 0.1, tool: null, harvestLevel: 0, opaque: false, solid: false,
  cross: true, climbable: true };
BLOCKS[BLOCK.STONE_BRICKS] = { name: 'Steinziegel', tiles: { side: 'stone_bricks' },
  hardness: 8, tool: 'pickaxe', harvestLevel: 1, opaque: true };
BLOCKS[BLOCK.CRACKED_STONE_BRICKS] = { name: 'Rissige Steinziegel', tiles: { side: 'cracked_stone_bricks' },
  hardness: 8, tool: 'pickaxe', harvestLevel: 1, opaque: true };
BLOCKS[BLOCK.MOSSY_STONE_BRICKS] = { name: 'Bemooste Steinziegel', tiles: { side: 'mossy_stone_bricks' },
  hardness: 8, tool: 'pickaxe', harvestLevel: 1, opaque: true };
BLOCKS[BLOCK.LOOT_CHEST] = { name: 'Versiegelte Truhe',
  tiles: { top: 'loot_chest_top', side: 'loot_chest' },
  hardness: -1, tool: null, harvestLevel: 0, opaque: false, lootChest: true,
  boxes: [[0.0625, 0, 0.0625, 0.9375, 0.875, 0.9375]] };
// Kristalle: transparent wie Glas, glitzern (Partikel), droppen Kristall-Scherben
{
  const FARBEN = [
    ['CRYSTAL_BLUE', 'Blauer Kristall', 'crystal_blue', 1057],
    ['CRYSTAL_PURPLE', 'Lila Kristall', 'crystal_purple', 1058],
    ['CRYSTAL_GREEN', 'Grüner Kristall', 'crystal_green', 1059],
    ['CRYSTAL_ORANGE', 'Oranger Kristall', 'crystal_orange', 1060],
  ];
  for (const [K, nm, tile, shard] of FARBEN) {
    BLOCKS[BLOCK[K]] = { name: nm, tiles: { side: tile },
      hardness: 1.2, tool: 'pickaxe', harvestLevel: 0, opaque: false, cullSame: true,
      crystal: true, drops: shard };
  }
  const GLAS = [
    ['GLASS_BLUE', 'Blaues Glas', 'glass_blue'],
    ['GLASS_PURPLE', 'Lila Glas', 'glass_purple'],
    ['GLASS_GREEN', 'Grünes Glas', 'glass_green'],
    ['GLASS_ORANGE', 'Oranges Glas', 'glass_orange'],
  ];
  for (const [K, nm, tile] of GLAS) {
    BLOCKS[BLOCK[K]] = { name: nm, tiles: { side: tile },
      hardness: 0.5, tool: null, harvestLevel: 0, opaque: false, cullSame: true };
  }
}
BLOCKS[BLOCK.TOWER_CHEST] = { name: 'Magier-Truhe',
  tiles: { top: 'tower_chest_top', side: 'tower_chest' },
  hardness: -1, tool: null, harvestLevel: 0, opaque: false, towerChest: true,
  boxes: [[0.0625, 0, 0.0625, 0.9375, 0.875, 0.9375]] };
BLOCKS[BLOCK.IRON_BLOCK] = { name: 'Eisenblock', tiles: { side: 'iron_block' },
  hardness: 12, tool: 'pickaxe', harvestLevel: 2, opaque: true };
BLOCKS[BLOCK.GOLD_BLOCK] = { name: 'Goldblock', tiles: { side: 'gold_block' },
  hardness: 10, tool: 'pickaxe', harvestLevel: 3, opaque: true };
BLOCKS[BLOCK.DIAMOND_BLOCK] = { name: 'Diamantblock', tiles: { side: 'diamond_block' },
  hardness: 14, tool: 'pickaxe', harvestLevel: 3, opaque: true };
BLOCKS[BLOCK.WRECK_CHEST] = { name: 'Schiffstruhe',
  tiles: { top: 'wreck_chest_top', side: 'wreck_chest' },
  hardness: -1, tool: null, harvestLevel: 0, opaque: false, wreckChest: true,
  boxes: [[0.0625, 0, 0.0625, 0.9375, 0.875, 0.9375]] };
BLOCKS[BLOCK.MOSSY_COBBLESTONE] = { name: 'Bemooster Bruchstein', tiles: { side: 'mossy_cobblestone' },
  hardness: 10, tool: 'pickaxe', harvestLevel: 1, opaque: true };
BLOCKS[BLOCK.DUNGEON_CHEST] = { name: 'Dungeon-Truhe',
  tiles: { top: 'dungeon_chest_top', side: 'dungeon_chest' },
  hardness: -1, tool: null, harvestLevel: 0, opaque: false, dungeonChest: true,
  boxes: [[0.0625, 0, 0.0625, 0.9375, 0.875, 0.9375]] };
BLOCKS[BLOCK.COBWEB] = { name: 'Spinnennetz', tiles: { side: 'cobweb' },
  hardness: 1.2, tool: null, harvestLevel: 0, opaque: false, solid: false,
  cross: true, web: true, drops: 1065 /* ITEM.STRING */ };
BLOCKS[BLOCK.SPAWNER] = { name: 'Monster-Spawner', tiles: { side: 'spawner' },
  hardness: 8, tool: 'pickaxe', harvestLevel: 1, opaque: false, spawner: true, drops: 0 };
BLOCKS[BLOCK.BOSS_SPAWNER] = { name: 'Blutkern', tiles: { side: 'boss_core' },
  hardness: -1, tool: 'pickaxe', harvestLevel: 3, opaque: false, bossSpawner: true, drops: 0 };
BLOCKS[BLOCK.BREWING_STAND] = { name: 'Braustand', tiles: { top: 'brewing_stand_top', side: 'brewing_stand' },
  hardness: 3.5, tool: 'pickaxe', harvestLevel: 0, opaque: true, brewing: true, drops: BLOCK.BREWING_STAND };
// ---- Rudimentäres Redstone: Leitung, Hebel, Knopf, Kolben ----
BLOCKS[BLOCK.REDSTONE_DUST] = { name: 'Flux-Staub', tiles: { side: 'redstone_dust' },
  hardness: 0.1, tool: null, harvestLevel: 0, opaque: false, solid: false, redstone: 'dust',
  drops: BLOCK.REDSTONE_DUST, boxes: [[0, 0, 0, 1, 0.0625, 1]] };
BLOCKS[BLOCK.REDSTONE_DUST_ON] = { name: 'Flux-Staub', tiles: { side: 'redstone_dust_on' },
  hardness: 0.1, tool: null, harvestLevel: 0, opaque: false, solid: false, redstone: 'dust', on: true,
  drops: BLOCK.REDSTONE_DUST, hidden: true, boxes: [[0, 0, 0, 1, 0.0625, 1]] };
BLOCKS[BLOCK.LEVER] = { name: 'Hebel', tiles: { top: 'lever', side: 'lever' },
  hardness: 0.2, tool: null, harvestLevel: 0, opaque: false, solid: false, redstone: 'lever',
  drops: BLOCK.LEVER, boxes: [[0.28, 0, 0.28, 0.72, 0.1, 0.72], [0.42, 0.05, 0.2, 0.58, 0.48, 0.44]] };
BLOCKS[BLOCK.LEVER_ON] = { name: 'Hebel', tiles: { top: 'lever', side: 'lever' },
  hardness: 0.2, tool: null, harvestLevel: 0, opaque: false, solid: false, redstone: 'lever', on: true,
  drops: BLOCK.LEVER, hidden: true, boxes: [[0.28, 0, 0.28, 0.72, 0.1, 0.72], [0.42, 0.05, 0.56, 0.58, 0.48, 0.8]] };
BLOCKS[BLOCK.BUTTON] = { name: 'Knopf', tiles: { side: 'button' },
  hardness: 0.2, tool: null, harvestLevel: 0, opaque: false, solid: false, redstone: 'button',
  drops: BLOCK.BUTTON, boxes: [[0.34, 0, 0.34, 0.66, 0.14, 0.66]] };
BLOCKS[BLOCK.BUTTON_ON] = { name: 'Knopf', tiles: { side: 'button' },
  hardness: 0.2, tool: null, harvestLevel: 0, opaque: false, solid: false, redstone: 'button', on: true,
  drops: BLOCK.BUTTON, hidden: true, boxes: [[0.34, 0, 0.34, 0.66, 0.1, 0.66]] };
for (const dir of ['N', 'E', 'S', 'W', 'UP', 'DOWN']) {
  BLOCKS[BLOCK['PISTON_' + dir]] = { name: 'Kolben', tiles: { front: 'piston', top: 'piston_body', side: 'piston_body', bottom: 'piston_body' },
    hardness: 2, tool: 'pickaxe', harvestLevel: 0, opaque: true, redstone: 'piston', pistonDir: dir,
    drops: BLOCK.PISTON_N, hidden: dir !== 'N' };
}
BLOCKS[BLOCK.PISTON_HEAD] = { name: 'Kolbenarm', tiles: { side: 'piston_head' },
  hardness: 2, tool: 'pickaxe', harvestLevel: 0, opaque: false, redstone: 'head', drops: 0, hidden: true,
  boxes: [[0.3, 0.3, 0.3, 0.7, 0.7, 0.7]] };
BLOCKS[BLOCK.FLUX_ORE] = { name: 'Flux-Erz', tiles: { side: 'flux_ore' },
  hardness: 3, tool: 'pickaxe', harvestLevel: 1, opaque: true, drops: ITEM.DIRTY_FLUX };
BLOCKS[BLOCK.WASHER] = { name: 'Washer', tiles: { top: 'washer_top', side: 'washer', bottom: 'washer_bottom' },
  hardness: 3.5, tool: 'pickaxe', harvestLevel: 0, opaque: true, washer: true, drops: BLOCK.WASHER };
BLOCKS[BLOCK.FLUX_BLOCK] = { name: 'Flux-Block', tiles: { side: 'flux_block' },
  hardness: 1.5, tool: 'pickaxe', harvestLevel: 0, opaque: true, fluxSource: true, drops: BLOCK.FLUX_BLOCK };
for (const dir of ['N', 'E', 'S', 'W', 'UP', 'DOWN']) {
  BLOCKS[BLOCK['STICKY_PISTON_' + dir]] = { name: 'Klebriger Kolben', tiles: { front: 'piston_sticky', top: 'piston_body', side: 'piston_body', bottom: 'piston_body' },
    hardness: 2, tool: 'pickaxe', harvestLevel: 0, opaque: true, redstone: 'piston', pistonDir: dir, sticky: true,
    drops: BLOCK.STICKY_PISTON_N, hidden: dir !== 'N' };
}
BLOCKS[BLOCK.PEBBLES] = { name: 'Kiesel', tiles: { side: 'pebbles' },
  hardness: 0.05, tool: null, harvestLevel: 0, opaque: false, solid: false,
  pebbles: true, drops: 1064 /* ITEM.PEBBLE */,
  boxes: [
    [0.15, 0, 0.2, 0.45, 0.14, 0.5],
    [0.55, 0, 0.4, 0.82, 0.18, 0.68],
    [0.3, 0, 0.62, 0.52, 0.1, 0.82],
  ] };

BLOCKS[BLOCK.SAPLING] = { name: 'Eichensetzling', tiles: { side: 'sapling' },
  hardness: 0.05, tool: null, harvestLevel: 0, opaque: false, solid: false, cross: true, sapling: 'oak' };
BLOCKS[BLOCK.BIRCH_SAPLING] = { name: 'Birkensetzling', tiles: { side: 'birch_sapling' },
  hardness: 0.05, tool: null, harvestLevel: 0, opaque: false, solid: false, cross: true, sapling: 'birch' };
BLOCKS[BLOCK.SPRUCE_SAPLING] = { name: 'Fichtensetzling', tiles: { side: 'spruce_sapling' },
  hardness: 0.05, tool: null, harvestLevel: 0, opaque: false, solid: false, cross: true, sapling: 'spruce' };
BLOCKS[BLOCK.TNT] = { name: 'TNT', tiles: { top: 'tnt_top', side: 'tnt_side', bottom: 'tnt_top' },
  hardness: 0.5, tool: null, harvestLevel: 0, opaque: true };

// ---- Farming ----
BLOCKS[BLOCK.FARMLAND] = { name: 'Ackerland', tiles: { top: 'farmland', side: 'dirt', bottom: 'dirt' },
  hardness: 0.6, tool: 'shovel', harvestLevel: 0, drops: BLOCK.DIRT, opaque: true, farmland: true };
BLOCKS[BLOCK.FARMLAND_WET] = { name: 'Nasses Ackerland', tiles: { top: 'farmland_wet', side: 'dirt', bottom: 'dirt' },
  hardness: 0.6, tool: 'shovel', harvestLevel: 0, drops: BLOCK.DIRT, opaque: true, farmland: true, wet: true };
// Feldfrüchte: je 4 Stufen (Cross-Sprite), wachsen auf Ackerland. Der crop-Deskriptor
// steuert Wachstum (next=0 → reif) und Ernte (produce + seed beim Reifen).
for (const [nm, ids, seed, produce, tile] of [
  ['Weizen', [BLOCK.WHEAT_0, BLOCK.WHEAT_1, BLOCK.WHEAT_2, BLOCK.WHEAT_3], ITEM.WHEAT_SEEDS, ITEM.WHEAT, 'wheat'],
  ['Karotten', [BLOCK.CARROT_0, BLOCK.CARROT_1, BLOCK.CARROT_2, BLOCK.CARROT_3], ITEM.CARROT, ITEM.CARROT, 'carrot'],
  ['Kartoffeln', [BLOCK.POTATO_0, BLOCK.POTATO_1, BLOCK.POTATO_2, BLOCK.POTATO_3], ITEM.POTATO, ITEM.POTATO, 'potato'],
]) {
  ids.forEach((id, i) => {
    BLOCKS[id] = {
      name: nm + ' (Stufe ' + (i + 1) + ')', tiles: { side: tile + '_' + i },
      hardness: 0.02, tool: null, harvestLevel: 0, opaque: false, solid: false, cross: true, drops: 0,
      crop: { name: nm, stage: i, next: ids[i + 1] || 0, mature: i === ids.length - 1, seed, produce },
    };
  });
}

// Einträge für fließende Wasser-/Lava-Pegel (nicht abbaubar, nicht in der Kreativ-Palette)
for (let id = BLOCK.WATER_FLOW7; id <= BLOCK.WATER_FLOW1; id++) {
  BLOCKS[id] = { name: 'Wasser', tiles: { side: 'water_flow' },
    hardness: -1, tool: null, harvestLevel: 0, opaque: false, solid: false, fluid: true };
}
for (const id of [BLOCK.LAVA_FLOW6, BLOCK.LAVA_FLOW4, BLOCK.LAVA_FLOW2]) {
  BLOCKS[id] = { name: 'Lava', tiles: { side: 'lava_flow' },
    hardness: -1, tool: null, harvestLevel: 0, opaque: false, solid: false, fluid: true };
}

// ---- Flüssigkeits-Helfer ----
export function isWaterId(id) {
  return id === BLOCK.WATER || (id >= BLOCK.WATER_FLOW7 && id <= BLOCK.WATER_FLOW1)
    || id === BLOCK.SEAGRASS || id === BLOCK.KELP; // wassergeflutete Pflanzen
}
export function isLavaId(id) {
  return id === BLOCK.LAVA || (id >= BLOCK.LAVA_FLOW6 && id <= BLOCK.LAVA_FLOW2);
}
export function isLiquid(id) {
  return isWaterId(id) || isLavaId(id);
}
// Pegel: Quelle = 8, Wasser-Flow 7..1, Lava-Flow 6/4/2
export function fluidLevel(id) {
  if (id === BLOCK.WATER || id === BLOCK.LAVA) return 8;
  if (id === BLOCK.SEAGRASS || id === BLOCK.KELP) return 8; // geflutete Pflanzen = Quellzellen
  if (id >= BLOCK.WATER_FLOW7 && id <= BLOCK.WATER_FLOW1) return 7 - (id - BLOCK.WATER_FLOW7);
  if (id === BLOCK.LAVA_FLOW6) return 6;
  if (id === BLOCK.LAVA_FLOW4) return 4;
  if (id === BLOCK.LAVA_FLOW2) return 2;
  return 0;
}
export function waterFlowId(level) { // level 1..7
  return BLOCK.WATER_FLOW7 + (7 - Math.max(1, Math.min(7, level)));
}
export function lavaFlowId(level) { // level auf 6/4/2 gerundet
  return level >= 5 ? BLOCK.LAVA_FLOW6 : level >= 3 ? BLOCK.LAVA_FLOW4 : BLOCK.LAVA_FLOW2;
}
// sichtbare Oberflächenhöhe eines Fluid-Blocks (für den Mesher)
export function fluidTop(id) {
  const lv = fluidLevel(id);
  return lv >= 8 ? 0.9 : Math.max(0.12, lv * 0.115);
}

// Solidity for physics: everything except AIR and liquids (and explicit solid:false) collides.
export function isSolid(id) {
  if (id === -1) return true; // unloaded chunk: treat as solid
  if (id === BLOCK.AIR || isLiquid(id)) return false;
  const def = BLOCKS[id];
  return def ? def.solid !== false : false;
}

// Kollisionsboxen eines Blocks (null = keine Kollision). Teilblöcke liefern ihre
// eigenen Boxen, alles andere den Vollwürfel.
const FULL_BOX = [[0, 0, 0, 1, 1, 1]];
export function collisionBoxesOf(id) {
  if (id === -1) return FULL_BOX;
  if (id === BLOCK.AIR || isLiquid(id)) return null;
  const def = BLOCKS[id];
  if (!def || def.solid === false) return null;
  return def.boxes || FULL_BOX;
}

// ---- Tür-/Treppen-/Bett-Helfer ----
export function isDoorId(id) { return id >= BLOCK.DOOR_LOWER_N && id <= BLOCK.DOOR_UPPER_W; }
export function isBedId(id) { return id === BLOCK.BED_FOOT || id === BLOCK.BED_HEAD; }
// Eigenschafts-basiert, damit auch die farbigen Holz-Varianten (eigene Id-Bereiche) zählen.
export function isStairsId(id) { return id > 0 && !!BLOCKS[id]?.stairs; }
export function isSlabId(id) { return id > 0 && !!BLOCKS[id]?.slab; }
export function isTrapdoorId(id) { return id >= BLOCK.TRAPDOOR && id <= BLOCK.TRAPDOOR_OPEN_W; }
export function isCarpetId(id) { return id >= BLOCK.CARPET && id <= BLOCK.CARPET_WHITE; }

// Öffnen/Schließen: Paneel-Kante wechselt im festen Paar N↔E bzw. S↔W
const DOOR_TOGGLE = { N: 'E', E: 'N', S: 'W', W: 'S' };
export function toggledDoorId(id) {
  const def = BLOCKS[id];
  if (!def?.door) return id;
  return BLOCK['DOOR_' + def.door.toUpperCase() + '_' + DOOR_TOGGLE[def.doorDir]];
}
export function doorId(part, dir) { return BLOCK['DOOR_' + part.toUpperCase() + '_' + dir]; }

// Blickrichtung (yaw des Spielers) → Kardinal aus Sicht der Bewegung
// yaw 0 = Blick nach -z (N), wächst gegen den Uhrzeigersinn
export function yawToCardinal(yaw) {
  const a = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  if (a < Math.PI * 0.25 || a >= Math.PI * 1.75) return 'N';
  if (a < Math.PI * 0.75) return 'W';
  if (a < Math.PI * 1.25) return 'S';
  return 'E';
}
export const CARDINAL_DELTA = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
export const CARDINAL_OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };
// Kolben-Schubrichtung in 3D (dx,dy,dz) — inkl. vertikal (UP/DOWN)
export const PISTON_DELTA = { N: [0, 0, -1], S: [0, 0, 1], E: [1, 0, 0], W: [-1, 0, 0], UP: [0, 1, 0], DOWN: [0, -1, 0] };

// ---- Item metadata ----
// tile: atlas tile name for icon/drop rendering
// tool: {type, level, speedMult} — mining speed multiplier on matching blocks
// damage: melee damage (default HAND_DAMAGE)
// food: hunger points restored when eaten
// stackSize: default 64, tools 1
export const ITEMS = {
  [ITEM.STICK]: { name: 'Stock', tile: 'stick' },
  [ITEM.WOODEN_PICKAXE]: { name: 'Holzspitzhacke', tile: 'wooden_pickaxe', stackSize: 1,
    tool: { type: 'pickaxe', level: 1, speedMult: 4 }, damage: 2 },
  [ITEM.WOODEN_AXE]: { name: 'Holzaxt', tile: 'wooden_axe', stackSize: 1,
    tool: { type: 'axe', level: 1, speedMult: 4 }, damage: 3 },
  [ITEM.WOODEN_SHOVEL]: { name: 'Holzschaufel', tile: 'wooden_shovel', stackSize: 1,
    tool: { type: 'shovel', level: 1, speedMult: 4 }, damage: 2 },
  [ITEM.WOODEN_SWORD]: { name: 'Holzschwert', tile: 'wooden_sword', stackSize: 1, damage: 4 },
  [ITEM.STONE_PICKAXE]: { name: 'Steinspitzhacke', tile: 'stone_pickaxe', stackSize: 1,
    tool: { type: 'pickaxe', level: 2, speedMult: 8 }, damage: 3 },
  [ITEM.STONE_AXE]: { name: 'Steinaxt', tile: 'stone_axe', stackSize: 1,
    tool: { type: 'axe', level: 2, speedMult: 8 }, damage: 4 },
  [ITEM.STONE_SHOVEL]: { name: 'Steinschaufel', tile: 'stone_shovel', stackSize: 1,
    tool: { type: 'shovel', level: 2, speedMult: 8 }, damage: 3 },
  [ITEM.STONE_SWORD]: { name: 'Steinschwert', tile: 'stone_sword', stackSize: 1, damage: 5 },
  [ITEM.COAL]: { name: 'Kohle', tile: 'coal' },
  [ITEM.RAW_IRON]: { name: 'Roheisen', tile: 'raw_iron' },
  [ITEM.PORKCHOP]: { name: 'Rohes Schweinefleisch', tile: 'porkchop', food: 3 },
  [ITEM.ROTTEN_FLESH]: { name: 'Verrottetes Fleisch', tile: 'rotten_flesh', food: 4 },
  [ITEM.APPLE]: { name: 'Apfel', tile: 'apple', food: 4 },
};

// Haltbarkeit für bestehende Werkzeuge nachrüsten
for (const id of [ITEM.WOODEN_PICKAXE, ITEM.WOODEN_AXE, ITEM.WOODEN_SHOVEL, ITEM.WOODEN_SWORD]) ITEMS[id].dur = 64;
for (const id of [ITEM.STONE_PICKAXE, ITEM.STONE_AXE, ITEM.STONE_SHOVEL, ITEM.STONE_SWORD]) ITEMS[id].dur = 128;

// Neue Materialien
Object.assign(ITEMS, {
  [ITEM.FLINT]: { name: 'Feuerstein', tile: 'flint' },
  [ITEM.SUGAR]: { name: 'Zucker', tile: 'sugar' },
  [ITEM.RAW_GOLD]: { name: 'Rohgold', tile: 'raw_gold' },
  [ITEM.DIAMOND]: { name: 'Diamant', tile: 'diamond' },
  [ITEM.EMERALD]: { name: 'Smaragd', tile: 'emerald' },
  [ITEM.SAPPHIRE]: { name: 'Saphir', tile: 'sapphire' },
  [ITEM.BACKPACK]: { name: 'Rucksack', tile: 'backpack', stackSize: 1, instance: true },
  [ITEM.BOW]: { name: 'Bogen', tile: 'bow', stackSize: 1, dur: 250 },
  [ITEM.ARROW]: { name: 'Pfeil', tile: 'arrow' },
  [ITEM.IRON_INGOT]: { name: 'Eisenbarren', tile: 'iron_ingot' },
  [ITEM.GOLD_INGOT]: { name: 'Goldbarren', tile: 'gold_ingot' },
  [ITEM.BONE]: { name: 'Knochen', tile: 'bone' },
  [ITEM.GUNPOWDER]: { name: 'Schwarzpulver', tile: 'gunpowder' },
  [ITEM.BONE_MEAL]: { name: 'Knochenmehl', tile: 'bone_meal' },
  [ITEM.FLINT_AND_STEEL]: { name: 'Feuerzeug', tile: 'flint_and_steel', stackSize: 1, dur: 64 },
  [ITEM.SHEARS]: { name: 'Schere', tile: 'shears', stackSize: 1, dur: 128 },
  [ITEM.KELP]: { name: 'Kelp', tile: 'kelp', food: 2 },
  [ITEM.RAW_FISH]: { name: 'Roher Fisch', tile: 'raw_fish', food: 2 },
  [ITEM.COOKED_FISH]: { name: 'Gebratener Fisch', tile: 'cooked_fish', food: 6 },
  [ITEM.MUTTON]: { name: 'Rohes Hammelfleisch', tile: 'mutton', food: 2 },
  [ITEM.COOKED_MUTTON]: { name: 'Gebratenes Hammelfleisch', tile: 'cooked_mutton', food: 6 },
  [ITEM.COOKED_PORKCHOP]: { name: 'Gebratenes Schweinefleisch', tile: 'cooked_porkchop', food: 8 },
  [ITEM.RAW_CHICKEN]: { name: 'Rohes Hühnchen', tile: 'raw_chicken', food: 2 },
  [ITEM.COOKED_CHICKEN]: { name: 'Gebratenes Hühnchen', tile: 'cooked_chicken', food: 6 },
  [ITEM.FEATHER]: { name: 'Feder', tile: 'feather' },
  [ITEM.SOCKET_RUNE]: { name: 'Sockel-Rune', tile: 'socket_rune' },
  [ITEM.CRYSTAL_BLUE_SHARD]: { name: 'Kristall (blau)', tile: 'shard_blue' },
  [ITEM.CRYSTAL_PURPLE_SHARD]: { name: 'Kristall (lila)', tile: 'shard_purple' },
  [ITEM.CRYSTAL_GREEN_SHARD]: { name: 'Kristall (grün)', tile: 'shard_green' },
  [ITEM.CRYSTAL_ORANGE_SHARD]: { name: 'Kristall (orange)', tile: 'shard_orange' },
  // Schriftrollen: Rechtsklick aktiviert 5 Minuten Zauberwirkung
  [ITEM.SCROLL_MINING]: { name: 'Schriftrolle des Schürfens', tile: 'scroll_mining', scroll: 'mining' },
  [ITEM.SCROLL_WATER]: { name: 'Schriftrolle des Wassers', tile: 'scroll_water', scroll: 'water' },
  [ITEM.SCROLL_LEVITATION]: { name: 'Schriftrolle der Levitation', tile: 'scroll_levitation', scroll: 'levitation' },
  [ITEM.PEBBLE]: { name: 'Kleiner Stein', tile: 'pebble' },
  [ITEM.STRING]: { name: 'Faden', tile: 'string' },
  [ITEM.BUCKET]: { name: 'Eimer', tile: 'bucket', stackSize: 1 },
  [ITEM.WATER_BUCKET]: { name: 'Wassereimer', tile: 'water_bucket', stackSize: 1 },
  [ITEM.LAVA_BUCKET]: { name: 'Lavaeimer', tile: 'lava_bucket', stackSize: 1 },
  // Farming: Harken (Rechtsklick macht Erde zu Ackerland), Samen & Ernte
  [ITEM.WOODEN_HOE]: { name: 'Holzharke', tile: 'wooden_hoe', stackSize: 1, dur: 60, hoe: true },
  [ITEM.STONE_HOE]: { name: 'Steinharke', tile: 'stone_hoe', stackSize: 1, dur: 132, hoe: true },
  [ITEM.IRON_HOE]: { name: 'Eisenharke', tile: 'iron_hoe', stackSize: 1, dur: 251, hoe: true },
  [ITEM.WHEAT_SEEDS]: { name: 'Weizensamen', tile: 'wheat_seeds', plant: BLOCK.WHEAT_0 },
  [ITEM.WHEAT]: { name: 'Weizen', tile: 'wheat' },
  [ITEM.CARROT]: { name: 'Karotte', tile: 'carrot', food: 3, plant: BLOCK.CARROT_0 },
  [ITEM.POTATO]: { name: 'Kartoffel', tile: 'potato', food: 1, plant: BLOCK.POTATO_0 },
  [ITEM.BREAD]: { name: 'Brot', tile: 'bread', food: 5 },
  [ITEM.CRIMSON_BLOOD]: { name: 'Crimson Blood', tile: 'crimson_blood' },
  [ITEM.CRIMSON_POTION]: { name: 'Heiltrank', tile: 'crimson_potion', stackSize: 8,
    potion: { heal: 8, resist: 10, cleanse: true, label: 'Heiltrank getrunken — 10 s Schutz, Debuffs entfernt' } },
  [ITEM.SPEED_POTION]: { name: 'Speed-Trank', tile: 'speed_potion', stackSize: 8,
    potion: { speed: 30, label: 'Speed-Trank getrunken — 30 s schneller unterwegs!' } },
  [ITEM.GLASS_BOTTLE]: { name: 'Glasflasche', tile: 'glass_bottle', stackSize: 16 },
  [ITEM.DIRTY_FLUX]: { name: 'Dirty Flux', tile: 'dirty_flux' },
  [ITEM.SLIMEBALL]: { name: 'Schleimball', tile: 'slimeball' },
});

// Laub & Setzling-Helfer
export function isLeafId(id) { return !!(id > 0 && BLOCKS[id]?.leaves); }
export function isLogId(id) {
  return id === BLOCK.LOG || id === BLOCK.BIRCH_LOG || id === BLOCK.SPRUCE_LOG || id === BLOCK.JUNGLE_LOG;
}
export function isSaplingId(id) { return !!(id > 0 && BLOCKS[id]?.sapling); }

// Werkzeug-/Waffen-Tiers: Eisen, Gold (schnell, fragil), Diamant
{
  const TIERS = [
    ['IRON', 'iron', 'Eisen', 3, 12, 256, { pickaxe: 4, axe: 5, shovel: 4, sword: 6 }],
    ['GOLD', 'gold', 'Gold', 2, 18, 48, { pickaxe: 2, axe: 3, shovel: 2, sword: 4 }],
    ['DIAMOND', 'diamond', 'Diamant', 4, 16, 1024, { pickaxe: 5, axe: 6, shovel: 5, sword: 7 }],
  ];
  const SUFFIX = { PICKAXE: ['spitzhacke', 'pickaxe'], AXE: ['axt', 'axe'], SHOVEL: ['schaufel', 'shovel'] };
  for (const [K, key, nm, level, speedMult, dur, dmg] of TIERS) {
    for (const [SK, [de, en]] of Object.entries(SUFFIX)) {
      ITEMS[ITEM[K + '_' + SK]] = {
        name: nm + de, tile: key + '_' + en, stackSize: 1, dur,
        tool: { type: en, level, speedMult }, damage: dmg[en],
      };
    }
    ITEMS[ITEM[K + '_SWORD']] = {
      name: nm + 'schwert', tile: key + '_sword', stackSize: 1, dur, damage: dmg.sword,
    };
  }
}

// Rüstung: 4 Teile × 3 Tiers; defense = Schutzpunkte (4% Schadensreduktion pro Punkt)
{
  const AT = [
    ['IRON', 'iron', 'Eisen', 160, { helmet: 2, chest: 6, legs: 5, boots: 2 }],
    ['GOLD', 'gold', 'Gold', 80, { helmet: 2, chest: 5, legs: 3, boots: 1 }],
    ['DIAMOND', 'diamond', 'Diamant', 480, { helmet: 3, chest: 8, legs: 6, boots: 3 }],
  ];
  const SLOTS = {
    HELMET: ['helm', 'helmet'], CHEST: ['brustplatte', 'chest'],
    LEGS: ['hose', 'legs'], BOOTS: ['stiefel', 'boots'],
  };
  for (const [K, key, nm, dur, def] of AT) {
    for (const [SK, [de, en]] of Object.entries(SLOTS)) {
      ITEMS[ITEM[K + '_' + SK]] = {
        name: nm + de, tile: key + '_' + en, stackSize: 1, dur,
        armor: { slot: en, defense: def[en] },
      };
    }
  }
}

// Display name for any id (block or item).
export function nameOf(id) {
  if (isBlockId(id)) return BLOCKS[id]?.name ?? '?';
  return ITEMS[id]?.name ?? '?';
}
export function stackSizeOf(id) {
  if (isBlockId(id)) return 64;
  return ITEMS[id]?.stackSize ?? 64;
}

// Tool level of a held item id for a given block's tool class (0 = hand / wrong tool).
export function toolLevel(heldId, blockTool) {
  const t = heldId != null ? ITEMS[heldId]?.tool : null;
  return t && t.type === blockTool ? t.level : 0;
}

// Seconds to mine `blockId` while holding `heldId` (Infinity if unbreakable).
export function miningTime(blockId, heldId) {
  const def = BLOCKS[blockId];
  if (!def || def.hardness < 0) return Infinity;
  const t = heldId != null ? ITEMS[heldId]?.tool : null;
  const mult = t && t.type === def.tool ? t.speedMult : 1;
  return def.hardness / mult;
}

// Melee damage of a held item id.
export function meleeDamage(heldId) {
  return (heldId != null ? ITEMS[heldId]?.damage : null) ?? HAND_DAMAGE;
}
