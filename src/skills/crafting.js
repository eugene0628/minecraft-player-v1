'use strict';
const logger     = require('../utils/logger');
const navigation = require('./navigation');
const { findNearestBlock } = require('../utils/world');
const { hasItem, countItem } = require('../utils/inventory');

/**
 * Attempt to craft `count` of `itemName`.
 * Will place a crafting table if needed and one is available.
 *
 * @param {import('mineflayer').Bot} bot
 * @param {string} itemName
 * @param {number} count
 * @returns {Promise<boolean>}
 */
async function craftItem(bot, itemName, count = 1) {
  const mcData = require('minecraft-data')(bot.version);
  const item = mcData.itemsByName[itemName];
  if (!item) {
    logger.warn(`craftItem: unknown item "${itemName}"`);
    return false;
  }

  const recipes = bot.recipesFor(item.id, null, 1, null);
  if (recipes.length === 0) {
    logger.debug(`No recipe found for ${itemName}`);
    return false;
  }

  // Prefer recipes that don't need a crafting table first
  const simpleRecipes = recipes.filter(r => !r.requiresTable);
  const tableRecipes  = recipes.filter(r =>  r.requiresTable);

  // Try without table
  for (const recipe of simpleRecipes) {
    try {
      await bot.craft(recipe, count, null);
      logger.success(`Crafted ${count}x ${itemName} (no table)`);
      return true;
    } catch (_) {}
  }

  // Need a crafting table
  if (tableRecipes.length === 0) return false;

  const table = await getOrPlaceCraftingTable(bot);
  if (!table) {
    logger.debug(`Can't craft ${itemName} — no crafting table available`);
    return false;
  }

  for (const recipe of tableRecipes) {
    try {
      await bot.craft(recipe, count, table);
      logger.success(`Crafted ${count}x ${itemName} (with table)`);
      return true;
    } catch (err) {
      logger.debug(`Craft attempt failed: ${err.message}`);
    }
  }
  return false;
}

/**
 * Returns true if the bot has all ingredients for the given item.
 */
function canCraft(bot, itemName) {
  const mcData = require('minecraft-data')(bot.version);
  const item = mcData.itemsByName[itemName];
  if (!item) return false;

  const recipes = bot.recipesFor(item.id, null, 1, null);
  return recipes.length > 0;
}

/**
 * Find an existing nearby crafting table or place one from inventory.
 */
async function getOrPlaceCraftingTable(bot) {
  // First, try to find a nearby table
  let table = findNearestBlock(bot, ['crafting_table'], 8);
  if (table) {
    await navigation.goToBlock(bot, table, 3);
    return bot.blockAt(table.position); // refresh reference
  }

  // Place one from inventory if we have it
  if (!hasItem(bot, 'crafting_table')) {
    // Try crafting one if we have planks
    if (countItem(bot, 'oak_planks') >= 4 || countItem(bot, 'spruce_planks') >= 4 ||
        countItem(bot, 'birch_planks') >= 4) {
      await craftItem(bot, 'crafting_table', 1);
    }
    if (!hasItem(bot, 'crafting_table')) return null;
  }

  // Place the crafting table on the block in front of the bot
  try {
    const pos = bot.entity.position.floored();
    const referenceBlock = bot.blockAt(pos.offset(0, -1, 0)); // block below bot
    if (!referenceBlock) return null;

    const tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
    await bot.equip(tableItem, 'hand');
    await bot.placeBlock(referenceBlock, pos.offset(0, 1, 0).minus(referenceBlock.position));
    await sleep(300);

    // Find the newly placed table
    table = findNearestBlock(bot, ['crafting_table'], 5);
    if (table) {
      await navigation.goToBlock(bot, table, 3);
      return bot.blockAt(table.position);
    }
  } catch (err) {
    logger.debug(`Failed to place crafting table: ${err.message}`);
  }
  return null;
}

/**
 * Ensure the bot has wooden planks, crafting them from logs if needed.
 */
async function ensureWoodenPlanks(bot, count = 4) {
  const plankTypes = [
    'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks',
    'acacia_planks', 'dark_oak_planks',
  ];
  const logTypes = [
    'oak_log', 'spruce_log', 'birch_log', 'jungle_log',
    'acacia_log', 'dark_oak_log',
  ];

  const existingPlanks = plankTypes.reduce((s, n) => s + countItem(bot, n), 0);
  if (existingPlanks >= count) return true;

  // Convert logs to planks
  for (const log of logTypes) {
    if (countItem(bot, log) > 0) {
      const plankName = log.replace('_log', '_planks');
      await craftItem(bot, plankName, 4);
    }
  }
  return plankTypes.reduce((s, n) => s + countItem(bot, n), 0) >= count;
}

/**
 * High-level: ensure the bot has a basic set of tools.
 * Order: wooden → stone → iron as materials allow.
 */
async function ensureBasicTools(bot) {
  const hasPick = bot.inventory.items().some(i => i.name.endsWith('_pickaxe'));
  const hasAxe  = bot.inventory.items().some(i => i.name.endsWith('_axe'));

  if (!hasPick || !hasAxe) {
    // Need planks first
    await ensureWoodenPlanks(bot, 8);
    // Need sticks
    await craftItem(bot, 'stick', 4);
  }

  // Pickaxe
  if (!hasPick) {
    const stoneCount = countItem(bot, 'cobblestone') + countItem(bot, 'cobbled_deepslate');
    if (stoneCount >= 3) {
      await craftItem(bot, 'stone_pickaxe', 1) ||
      await craftItem(bot, 'wooden_pickaxe', 1);
    } else {
      await craftItem(bot, 'wooden_pickaxe', 1);
    }
  }

  // Axe
  if (!hasAxe) {
    const stoneCount = countItem(bot, 'cobblestone') + countItem(bot, 'cobbled_deepslate');
    if (stoneCount >= 3) {
      await craftItem(bot, 'stone_axe', 1) ||
      await craftItem(bot, 'wooden_axe', 1);
    } else {
      await craftItem(bot, 'wooden_axe', 1);
    }
  }

  // Sword — for self-defence
  const hasSword = bot.inventory.items().some(i => i.name.endsWith('_sword'));
  if (!hasSword) {
    const stoneCount = countItem(bot, 'cobblestone') + countItem(bot, 'cobbled_deepslate');
    if (stoneCount >= 2) {
      await craftItem(bot, 'stone_sword', 1) ||
      await craftItem(bot, 'wooden_sword', 1);
    } else {
      await craftItem(bot, 'wooden_sword', 1);
    }
  }
}

/**
 * Smelt items using a nearby furnace (if available).
 * This is a simplified version — requires an existing furnace in the world.
 */
async function smeltItem(bot, inputItem, fuelItem, count = 1) {
  // Find a furnace
  const furnace = findNearestBlock(bot, ['furnace'], 16);
  if (!furnace) return false;

  try {
    await navigation.goToBlock(bot, furnace, 3);
    const furnaceWindow = await bot.openFurnace(furnace);

    // Check we have the input
    if (!hasItem(bot, inputItem)) {
      furnaceWindow.close();
      return false;
    }

    // Put input
    const inputStack = bot.inventory.items().find(i => i.name === inputItem);
    const fuelStack  = bot.inventory.items().find(i => i.name === fuelItem);

    if (!inputStack || !fuelStack) {
      furnaceWindow.close();
      return false;
    }

    await furnaceWindow.putInput(inputStack.slot, null, count);
    await furnaceWindow.putFuel(fuelStack.slot, null, count * 2);
    await sleep(count * 10000); // ~10s per item
    await furnaceWindow.takeOutput();
    furnaceWindow.close();
    logger.success(`Smelted ${count}x ${inputItem}`);
    return true;
  } catch (err) {
    logger.debug(`Smelt failed: ${err.message}`);
    return false;
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = {
  craftItem,
  canCraft,
  getOrPlaceCraftingTable,
  ensureWoodenPlanks,
  ensureBasicTools,
  smeltItem,
};
