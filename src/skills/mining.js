'use strict';
const logger     = require('../utils/logger');
const navigation = require('./navigation');
const { findNearestBlock } = require('../utils/world');
const { freeSlots }        = require('../utils/inventory');

// Ore priority — higher value = mine first
const ORE_PRIORITY = [
  { names: ['ancient_debris'],                          value: 100 },
  { names: ['diamond_ore', 'deepslate_diamond_ore'],    value: 90  },
  { names: ['emerald_ore', 'deepslate_emerald_ore'],    value: 80  },
  { names: ['gold_ore',    'deepslate_gold_ore', 'nether_gold_ore'], value: 60 },
  { names: ['iron_ore',    'deepslate_iron_ore'],       value: 40  },
  { names: ['coal_ore',    'deepslate_coal_ore'],       value: 20  },
];

// Preferred wood types
const WOOD_LOGS = [
  'oak_log', 'spruce_log', 'birch_log', 'jungle_log',
  'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log',
];

/**
 * Find the highest-priority ore within range and mine it.
 * @param {import('mineflayer').Bot} bot
 * @param {object} token - cancellation token { cancelled: bool }
 * @param {number} maxDistance
 * @returns {Promise<boolean>} true if something was mined
 */
async function mineOre(bot, token, maxDistance = 32) {
  for (const { names } of ORE_PRIORITY) {
    if (token.cancelled) return false;
    const block = findNearestBlock(bot, names, maxDistance);
    if (block) {
      logger.info(`Mining ${block.name} at ${block.position}`);
      const success = await mineBlock(bot, block, token);
      if (success) return true;
    }
  }
  return false;
}

/**
 * Find and chop the nearest tree log.
 */
async function chopWood(bot, token, maxDistance = 32) {
  const block = findNearestBlock(bot, WOOD_LOGS, maxDistance);
  if (!block) return false;
  logger.info(`Chopping ${block.name} at ${block.position}`);
  return mineBlock(bot, block, token);
}

/**
 * Mine a series of nearby logs (strip-mine a tree column).
 * Follows logs upward after the first one.
 */
async function chopTree(bot, token, maxDistance = 32) {
  let mined = 0;
  while (!token.cancelled && freeSlots(bot) > 2) {
    const block = findNearestBlock(bot, WOOD_LOGS, maxDistance);
    if (!block) break;
    const ok = await mineBlock(bot, block, token);
    if (!ok) break;
    mined++;
    await sleep(200);
  }
  return mined > 0;
}

/**
 * Navigate to a block and mine it.
 * Equips the best tool for the block type first.
 */
async function mineBlock(bot, block, token = { cancelled: false }) {
  if (token.cancelled) return false;

  try {
    // Equip best tool
    await equipBestToolFor(bot, block.name);

    // Navigate close enough to dig
    const moved = await navigation.goToBlock(bot, block, 4);
    if (!moved || token.cancelled) return false;

    // Check the block is still there (might have been mined by someone else)
    const stillThere = bot.blockAt(block.position);
    if (!stillThere || stillThere.name !== block.name) return false;

    await bot.dig(block);
    logger.success(`Mined ${block.name}`);
    return true;

  } catch (err) {
    logger.debug(`mineBlock failed for ${block.name}: ${err.message}`);
    return false;
  }
}

/**
 * Mine a vein of blocks — after mining one, look for adjacent similar blocks.
 * Great for ore veins.
 */
async function mineVein(bot, block, token, maxBlocks = 10) {
  let mined = 0;
  const targetName = block.name;
  const toMine = [block];
  const visited = new Set();

  while (toMine.length > 0 && mined < maxBlocks && !token.cancelled) {
    const current = toMine.pop();
    const key = current.position.toString();
    if (visited.has(key)) continue;
    visited.add(key);

    const ok = await mineBlock(bot, current, token);
    if (ok) {
      mined++;
      // Look for adjacent blocks of the same type
      const offsets = [
        [1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],
      ];
      for (const [dx, dy, dz] of offsets) {
        const adjacent = bot.blockAt(current.position.offset(dx, dy, dz));
        if (adjacent && adjacent.name === targetName) {
          const adjKey = adjacent.position.toString();
          if (!visited.has(adjKey)) toMine.push(adjacent);
        }
      }
    }
    await sleep(100);
  }
  return mined;
}

/**
 * Equip the best tool for a given block type.
 */
async function equipBestToolFor(bot, blockName) {
  try {
    let toolType = 'pickaxe'; // default

    if (WOOD_LOGS.includes(blockName) || blockName.includes('planks') || blockName.includes('log')) {
      toolType = 'axe';
    } else if (blockName.includes('dirt') || blockName.includes('sand') || blockName.includes('gravel')) {
      toolType = 'shovel';
    } else if (blockName.includes('ore') || blockName.includes('stone') || blockName.includes('cobble') || blockName.includes('debris')) {
      toolType = 'pickaxe';
    }

    const tiers = ['netherite', 'diamond', 'iron', 'stone', 'golden', 'wooden'];
    for (const tier of tiers) {
      const toolName = `${tier}_${toolType}`;
      const tool = bot.inventory.items().find(i => i.name === toolName);
      if (tool) {
        await bot.equip(tool, 'hand');
        return;
      }
    }
    // No matching tool — use bare hands or whatever is equipped
  } catch (err) {
    logger.debug(`equipBestToolFor failed: ${err.message}`);
  }
}

/** Collect all dropped items within a radius by walking to them. */
async function collectNearbyDrops(bot, token, radius = 16) {
  const drops = Object.values(bot.entities).filter(e =>
    e.name === 'item' &&
    e.position.distanceTo(bot.entity.position) <= radius
  );

  let collected = 0;
  for (const drop of drops) {
    if (token.cancelled || freeSlots(bot) <= 0) break;
    try {
      await navigation.goTo(bot, drop.position, 1);
      collected++;
      await sleep(100);
    } catch (_) {}
  }
  return collected;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = {
  mineOre,
  chopWood,
  chopTree,
  mineBlock,
  mineVein,
  equipBestToolFor,
  collectNearbyDrops,
  ORE_PRIORITY,
  WOOD_LOGS,
};
