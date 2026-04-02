'use strict';
const { goals: { GoalNear, GoalBlock, GoalXZ, GoalFollow } } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const logger = require('../utils/logger');

const GOTO_TIMEOUT_MS = 20000;

/**
 * Navigate to within `range` blocks of a position.
 * @param {import('mineflayer').Bot} bot
 * @param {Vec3} target
 * @param {number} range - how close to get (default 2)
 * @returns {Promise<boolean>} true on success, false on failure
 */
async function goTo(bot, target, range = 2) {
  try {
    const goal = new GoalNear(target.x, target.y, target.z, range);
    await withTimeout(bot.pathfinder.goto(goal), GOTO_TIMEOUT_MS);
    return true;
  } catch (err) {
    logger.debug(`goTo failed: ${err.message}`);
    return false;
  }
}

/**
 * Navigate to stand on top of a specific block.
 */
async function goToBlock(bot, block, range = 2) {
  return goTo(bot, block.position, range);
}

/**
 * Navigate to an XZ position (ignoring Y — pathfinder handles it).
 */
async function goToXZ(bot, x, z) {
  try {
    const goal = new GoalXZ(x, z);
    await withTimeout(bot.pathfinder.goto(goal), GOTO_TIMEOUT_MS);
    return true;
  } catch (err) {
    logger.debug(`goToXZ failed: ${err.message}`);
    return false;
  }
}

/**
 * Follow a player or entity until `stopFn` returns true.
 */
async function followEntity(bot, entity, range = 3, stopFn = () => false, token = null) {
  try {
    const goal = new GoalFollow(entity, range);
    bot.pathfinder.setGoal(goal, true); // true = dynamic
    // Poll until stopFn says to stop or token is cancelled
    while (!stopFn() && !(token && token.cancelled)) {
      await sleep(500);
    }
    bot.pathfinder.stop();
    return true;
  } catch (err) {
    logger.debug(`followEntity failed: ${err.message}`);
    return false;
  }
}

/**
 * Stop any current pathfinding movement.
 */
function stop(bot) {
  try { bot.pathfinder.stop(); } catch (_) {}
}

/**
 * Make the bot look at a position.
 */
async function lookAt(bot, position) {
  await bot.lookAt(position);
}

/**
 * Wander to a random point near the current position.
 * @param {number} radius - max wander distance
 */
async function wander(bot, radius = 50) {
  const pos = bot.entity.position;
  const angle = Math.random() * Math.PI * 2;
  const dist  = radius * (0.5 + Math.random() * 0.5);
  const target = new Vec3(
    Math.round(pos.x + Math.cos(angle) * dist),
    pos.y,
    Math.round(pos.z + Math.sin(angle) * dist)
  );
  logger.debug(`Wandering to ${target}`);
  return goTo(bot, target, 3);
}

/**
 * Promise.race wrapper that rejects after `ms` milliseconds.
 */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Navigation timed out after ${ms}ms`)), ms)
    ),
  ]);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = { goTo, goToBlock, goToXZ, followEntity, stop, lookAt, wander };
