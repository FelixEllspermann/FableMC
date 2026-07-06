// Atlas-Layout ohne Abhängigkeiten (nutzbar im Worker): Kachelnamen + UV-Rechtecke.

export const TILE_PX = 16;
export const ATLAS_COLS = 20; // 20×20 Kacheln = 400 Plätze (Reserve)

export const TILE_NAMES = [
  'grass_top', 'grass_side', 'dirt', 'stone', 'cobblestone', 'log_top', 'log_side', 'planks',
  'leaves', 'sand', 'water', 'bedrock', 'coal_ore', 'iron_ore', 'crafting_table_top', 'crafting_table_side',
  'stick', 'wooden_pickaxe', 'wooden_axe', 'wooden_shovel', 'wooden_sword',
  'stone_pickaxe', 'stone_axe', 'stone_shovel', 'stone_sword',
  'porkchop', 'rotten_flesh', 'apple', 'coal', 'raw_iron',
  'snow', 'grass_side_snowy', 'birch_log_side', 'birch_leaves', 'spruce_log_side', 'spruce_leaves',
  'red_sand', 'terracotta', 'terracotta_red', 'mycelium_top', 'mycelium_side',
  'mushroom_stem', 'mushroom_cap_red', 'mushroom_cap_brown',
  'savanna_grass_top', 'savanna_grass_side', 'flower_red', 'flower_yellow', 'tall_grass',
  'lava', 'dripstone', 'moss', 'cave_vine', 'torch',
  'gravel', 'sugar_cane', 'anvil', 'gold_ore', 'diamond_ore',
  'flint', 'sugar', 'raw_gold', 'diamond',
  'iron_pickaxe', 'iron_axe', 'iron_shovel', 'iron_sword',
  'gold_pickaxe', 'gold_axe', 'gold_shovel', 'gold_sword',
  'diamond_pickaxe', 'diamond_axe', 'diamond_shovel', 'diamond_sword',
  'furnace_front', 'furnace_side', 'furnace_front_on', 'iron_ingot', 'gold_ingot',
  'bone', 'gunpowder',
  'iron_helmet', 'iron_chest', 'iron_legs', 'iron_boots',
  'gold_helmet', 'gold_chest', 'gold_legs', 'gold_boots',
  'diamond_helmet', 'diamond_chest', 'diamond_legs', 'diamond_boots',
  'sapling', 'birch_sapling', 'spruce_sapling', 'tnt_side', 'tnt_top',
  'bone_meal', 'flint_and_steel',
  'chest_front', 'chest_top', 'glass', 'door_lower', 'door_upper', 'ladder', 'trapdoor',
  'carpet', 'carpet_red', 'carpet_yellow', 'carpet_white', 'bed_foot', 'bed_head', 'bed_side',
  'shears', 'wool',
  'seagrass', 'kelp', 'raw_fish', 'cooked_fish', 'mutton', 'cooked_mutton', 'cooked_porkchop',
  'kelp_top', 'water_flow', 'lava_flow',
  'shrub', 'cactus_side', 'cactus_top', 'cactus_flower', 'sandstone', 'sandstone_top',
  'vine', 'stone_bricks', 'cracked_stone_bricks', 'mossy_stone_bricks',
  'loot_chest', 'loot_chest_top', 'socket_rune',
  'crystal_blue', 'crystal_purple', 'crystal_green', 'crystal_orange',
  'glass_blue', 'glass_purple', 'glass_green', 'glass_orange',
  'shard_blue', 'shard_purple', 'shard_green', 'shard_orange',
  'scroll_mining', 'scroll_water', 'scroll_levitation',
  'tower_chest', 'tower_chest_top',
  'iron_block', 'gold_block', 'diamond_block', 'wreck_chest', 'wreck_chest_top',
  'mossy_cobblestone', 'pebbles', 'pebble', 'dungeon_chest', 'dungeon_chest_top',
  'cobweb', 'spawner', 'string',
  'bucket', 'water_bucket', 'lava_bucket',
  'farmland', 'farmland_wet',
  'wheat_0', 'wheat_1', 'wheat_2', 'wheat_3',
  'carrot_0', 'carrot_1', 'carrot_2', 'carrot_3',
  'potato_0', 'potato_1', 'potato_2', 'potato_3',
  'wooden_hoe', 'stone_hoe', 'iron_hoe',
  'wheat_seeds', 'wheat', 'carrot', 'potato', 'bread',
  'boss_core', 'crimson_blood', 'crimson_potion',
  'glass_bottle', 'brewing_stand', 'brewing_stand_top', 'speed_potion',
  'redstone_dust', 'redstone_dust_on', 'lever', 'button', 'piston', 'piston_head',
  'flux_ore', 'washer', 'washer_top', 'flux_block', 'dirty_flux',
  'washer_bottom', 'piston_sticky', 'slimeball', 'piston_body',
  'jungle_log_side', 'jungle_bush',
  'raw_chicken', 'cooked_chicken', 'feather',
  'hanging_roots', 'rooted_dirt', 'glow_lichen',
  'emerald', 'sapphire', 'emerald_ore', 'sapphire_ore',
  'backpack', 'bow', 'arrow',
  'birch_planks', 'spruce_planks', 'jungle_planks',
  'berry_bush_red', 'berry_bush_blue', 'berry_bush_yellow',
  'berry_red', 'berry_blue', 'berry_yellow',
  'dark_grass_top', 'dark_grass_side', 'mushroom_red', 'mushroom_brown',
  'leafy_grass_top', 'leafy_grass_side',
  'leather', 'paper', 'book', 'spell_core',
  'obsidian', 'bookshelf', 'ench_table_top', 'ench_table_side',
];

const cache = new Map();

export function uvRect(name) {
  let r = cache.get(name);
  if (r) return r;
  const i = TILE_NAMES.indexOf(name);
  const col = i % ATLAS_COLS, row = Math.floor(i / ATLAS_COLS);
  const W = ATLAS_COLS * TILE_PX;
  const inset = 0.5;
  r = {
    u0: (col * TILE_PX + inset) / W,
    v0: 1 - (row * TILE_PX + TILE_PX - inset) / W,
    u1: (col * TILE_PX + TILE_PX - inset) / W,
    v1: 1 - (row * TILE_PX + inset) / W,
  };
  cache.set(name, r);
  return r;
}
