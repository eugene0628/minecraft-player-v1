'use strict';

/**
 * Inventory utility helpers.
 * All functions accept the mineflayer `bot` object.
 */

/** Count how many of a named item the bot has. */
function countItem(bot, itemName) {
  return bot.inventory.items()
    .filter(i => i.name === itemName)
    .reduce((sum, i) => sum + i.count, 0);
}

/** Check whether the bot has at least `count` of a named item. */
function hasItem(bot, itemName, count = 1) {
  return countItem(bot, itemName) >= count;
}

/** Return the first inventory Item object matching a name, or null. */
function getItem(bot, itemName) {
  return bot.inventory.items().find(i => i.name === itemName) || null;
}

/**
 * Find the best food item in inventory (highest food points first).
 * Uses a simple lookup table of common Minecraft food items.
 */
const FOOD_VALUES = {
  golden_apple: 4, cooked_beef: 8, cooked_porkchop: 8, cooked_mutton: 6,
  cooked_chicken: 6, cooked_salmon: 6, cooked_cod: 5, cooked_rabbit: 5,
  bread: 5, baked_potato: 5, mushroom_stew: 6, beetroot_soup: 6,
  pumpkin_pie: 8, cake: 2, cookie: 2, melon_slice: 2,
  apple: 4, carrot: 3, potato: 1, beef: 3, porkchop: 3, chicken: 2,
  rotten_flesh: 4, spider_eye: 2, poisonous_potato: 2,
};

function findBestFood(bot) {
  let best = null;
  let bestVal = -1;
  for (const item of bot.inventory.items()) {
    const val = FOOD_VALUES[item.name] ?? -1;
    if (val > bestVal) {
      bestVal = val;
      best = item;
    }
  }
  return best;
}

/**
 * Find the best weapon in inventory.
 * Priority: sword > axe > pickaxe > shovel > other.
 */
const WEAPON_PRIORITY = {
  netherite_sword: 100, diamond_sword: 90, iron_sword: 70, stone_sword: 50, golden_sword: 40, wooden_sword: 30,
  netherite_axe: 85,   diamond_axe: 75,   iron_axe: 65,   stone_axe: 45,   golden_axe: 35,   wooden_axe: 25,
  netherite_pickaxe: 60, diamond_pickaxe: 55, iron_pickaxe: 45, stone_pickaxe: 30,
};

function findBestWeapon(bot) {
  let best = null;
  let bestScore = -1;
  for (const item of bot.inventory.items()) {
    const score = WEAPON_PRIORITY[item.name] ?? -1;
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return best;
}

/**
 * Find the best tool for a given material type.
 * type: 'pickaxe' | 'axe' | 'shovel' | 'hoe'
 */
const TOOL_TIERS = ['netherite', 'diamond', 'iron', 'stone', 'golden', 'wooden'];

function findBestTool(bot, type) {
  for (const tier of TOOL_TIERS) {
    const name = `${tier}_${type}`;
    const item = bot.inventory.items().find(i => i.name === name);
    if (item) return item;
  }
  return null;
}

/** How many free inventory slots does the bot have? */
function freeSlots(bot) {
  const INVENTORY_SIZE = 36; // 27 main + 9 hotbar (vanilla)
  const used = bot.inventory.items().length;
  return Math.max(0, INVENTORY_SIZE - used);
}

/** Return a summary object for logging / LLM context. */
function getSummary(bot) {
  const items = {};
  for (const item of bot.inventory.items()) {
    items[item.name] = (items[item.name] || 0) + item.count;
  }
  return {
    items,
    freeSlots: freeSlots(bot),
    hasFood: !!findBestFood(bot),
    hasSword: !!bot.inventory.items().find(i => i.name.endsWith('_sword')),
    hasPickaxe: !!bot.inventory.items().find(i => i.name.endsWith('_pickaxe')),
  };
}

/** Get the total count of any "valuable" items (ores, diamonds, etc.). */
function getValueableCount(bot) {
  const valuables = [
    'diamond', 'emerald', 'gold_ingot', 'iron_ingot', 'netherite_ingot',
    'diamond_ore', 'emerald_ore', 'ancient_debris',
  ];
  return valuables.reduce((sum, name) => sum + countItem(bot, name), 0);
}

module.exports = {
  countItem,
  hasItem,
  getItem,
  findBestFood,
  findBestWeapon,
  findBestTool,
  freeSlots,
  getSummary,
  getValueableCount,
};
