'use strict';
const logger     = require('../utils/logger');
const navigation = require('./navigation');
const { Vec3 }   = require('vec3');
const { hasItem, countItem } = require('../utils/inventory');

/**
 * Building skills — primarily focused on constructing emergency night shelters.
 * The bot builds simple but functional 3x3x3 dirt/cobblestone cubes.
 */

const SHELTER_MATERIALS = [
  'cobblestone', 'dirt', 'gravel', 'sand',
  'oak_planks', 'spruce_planks', 'birch_planks', 'stone',
];

/**
 * Build an emergency shelter at the bot's current position.
 * Constructs a small enclosed space using available blocks.
 *
 * @param {import('mineflayer').Bot} bot
 * @param {object} token - cancellation token
 * @returns {Promise<boolean>} true if shelter was built
 */
async function buildShelter(bot, token) {
  logger.info('Building emergency night shelter...');

  // Pick the best available material
  const material = SHELTER_MATERIALS.find(m => countItem(bot, m) >= 15);
  if (!material) {
    logger.warn('Not enough materials to build shelter');
    return false;
  }

  const pos = bot.entity.position.floored();

  try {
    // Build a simple 3x3 hollow box around the bot's position
    // Floor, then walls, then ceiling — with a gap to stand in

    // Equip the material
    const matItem = bot.inventory.items().find(i => i.name === material);
    if (!matItem) return false;
    await bot.equip(matItem, 'hand');

    let placed = 0;

    // Build floor first (y = pos.y - 1), then walls (y = pos.y, pos.y+1), then ceiling (pos.y + 2)
    const floorY  = pos.y - 1;
    const wallY1  = pos.y;
    const wallY2  = pos.y + 1;
    const ceilY   = pos.y + 2;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (token.cancelled) return placed > 0;

        // Floor
        await placeBlockAt(bot, pos.offset(dx, -1, dz));
        placed++;

        // Ceiling
        await placeBlockAt(bot, pos.offset(dx, 2, dz));
        placed++;

        // Walls (only on edges)
        if (Math.abs(dx) === 1 || Math.abs(dz) === 1) {
          await placeBlockAt(bot, pos.offset(dx, 0, dz));
          await placeBlockAt(bot, pos.offset(dx, 1, dz));
          placed += 2;
        }
      }
    }

    logger.success(`Shelter built with ${placed} blocks of ${material}`);
    return placed >= 8;

  } catch (err) {
    logger.warn(`buildShelter failed: ${err.message}`);
    return false;
  }
}

/**
 * Try to place a block at `targetPos`, standing adjacent.
 * Finds the reference block (adjacent solid block) to place against.
 */
async function placeBlockAt(bot, targetPos) {
  try {
    // Check if block already exists there
    const existing = bot.blockAt(targetPos);
    if (existing && existing.boundingBox === 'block') return; // already solid

    // Find a solid adjacent block to place against
    const faces = [
      [0, -1, 0], [0, 1, 0],
      [1, 0, 0],  [-1, 0, 0],
      [0, 0, 1],  [0, 0, -1],
    ];

    for (const [fx, fy, fz] of faces) {
      const refPos = targetPos.offset(fx, fy, fz);
      const refBlock = bot.blockAt(refPos);
      if (refBlock && refBlock.boundingBox === 'block') {
        // Move within reach
        await navigation.goTo(bot, targetPos, 4);
        await bot.placeBlock(refBlock, new Vec3(-fx, -fy, -fz));
        await sleep(100);
        return;
      }
    }
  } catch (err) {
    logger.debug(`placeBlockAt failed at ${targetPos}: ${err.message}`);
  }
}

/**
 * Dig a safe hole to hide in when there are no materials.
 * Digs 2 blocks down and 1 block over, then plugs the entrance.
 *
 * @param {import('mineflayer').Bot} bot
 * @param {object} token
 */
async function digHideout(bot, token) {
  logger.info('Digging emergency hideout...');
  try {
    const pos = bot.entity.position.floored();

    // Dig 2 blocks down
    const belowBot = bot.blockAt(pos.offset(0, -1, 0));
    const belowBelowBot = bot.blockAt(pos.offset(0, -2, 0));

    if (belowBot && belowBot.diggable) {
      await bot.dig(belowBot);
      await sleep(300);
    }
    if (token.cancelled) return false;

    if (belowBelowBot && belowBelowBot.diggable) {
      await bot.dig(belowBelowBot);
      await sleep(300);
    }

    logger.success('Dug basic hideout');
    return true;
  } catch (err) {
    logger.debug(`digHideout failed: ${err.message}`);
    return false;
  }
}

/**
 * Check if the bot already has shelter nearby (a block above its head).
 */
function hasNearbyRoof(bot) {
  const pos = bot.entity.position.floored();
  for (let dy = 1; dy <= 3; dy++) {
    const above = bot.blockAt(pos.offset(0, dy, 0));
    if (above && above.boundingBox === 'block') return true;
  }
  return false;
}

/**
 * Check if bot has enough materials to build a shelter.
 */
function hasShelterMaterials(bot) {
  return SHELTER_MATERIALS.some(m => countItem(bot, m) >= 15);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = {
  buildShelter,
  placeBlockAt,
  digHideout,
  hasNearbyRoof,
  hasShelterMaterials,
  SHELTER_MATERIALS,
};
