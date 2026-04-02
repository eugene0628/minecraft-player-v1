'use strict';
const { Vec3 } = require('vec3');

// Hostile mob types the bot should treat as threats
const HOSTILE_MOBS = new Set([
  'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider', 'witch',
  'enderman', 'blaze', 'ghast', 'wither_skeleton', 'guardian', 'elder_guardian',
  'hoglin', 'piglin_brute', 'ravager', 'phantom', 'drowned', 'husk', 'stray',
  'slime', 'magma_cube', 'silverfish', 'endermite', 'shulker',
]);

/**
 * Get all entities of a specific type within radius.
 * @param {import('mineflayer').Bot} bot
 * @param {number} radius
 * @param {(entity: object) => boolean} filter
 */
function getNearbyEntities(bot, radius, filter = () => true) {
  const pos = bot.entity.position;
  return Object.values(bot.entities).filter(e => {
    if (e === bot.entity) return false;
    if (!e.position) return false;
    if (e.position.distanceTo(pos) > radius) return false;
    return filter(e);
  });
}

/** Get hostile mobs within radius. */
function getNearbyHostiles(bot, radius = 16) {
  return getNearbyEntities(bot, radius, e => HOSTILE_MOBS.has(e.name));
}

/** Get player entities within radius (excluding the bot itself). */
function getNearbyPlayers(bot, radius = 32) {
  return getNearbyEntities(bot, radius, e => e.type === 'player' && e.username !== bot.username);
}

/** Get dropped item entities within radius. */
function getNearbyDroppedItems(bot, radius = 16) {
  return getNearbyEntities(bot, radius, e => e.name === 'item');
}

/** Returns true if it is currently night time in-game. */
function isNight(bot) {
  // Hostile mobs begin spawning at ~12542 (light levels drop at dusk).
  // Use 12500 as a safe threshold so the bot doesn't mine during dangerous dusk.
  const t = bot.time.timeOfDay;
  return t >= 12500 && t <= 23000;
}

/** Returns a human-readable time of day string. */
function getTimeOfDay(bot) {
  const t = bot.time.timeOfDay;
  if (t < 6000) return 'morning';
  if (t < 12000) return 'day';
  if (t < 13000) return 'dusk';
  if (t < 18000) return 'night';
  return 'late night';
}

/**
 * Find the nearest block matching one of the given block names.
 * @param {import('mineflayer').Bot} bot
 * @param {string[]} names - array of block name strings
 * @param {number} maxDistance
 * @returns {object|null} Block or null
 */
function findNearestBlock(bot, names, maxDistance = 32) {
  const mcData = require('minecraft-data')(bot.version);
  const ids = names
    .map(n => mcData.blocksByName[n])
    .filter(Boolean)
    .map(b => b.id);
  if (ids.length === 0) return null;
  return bot.findBlock({ matching: ids, maxDistance });
}

/**
 * Find multiple blocks matching name within radius.
 * Returns up to `count` blocks sorted by distance.
 */
function findNearbyBlocks(bot, names, maxDistance = 32, count = 5) {
  const mcData = require('minecraft-data')(bot.version);
  const ids = names
    .map(n => mcData.blocksByName[n])
    .filter(Boolean)
    .map(b => b.id);
  if (ids.length === 0) return [];
  return bot.findBlocks({ matching: ids, maxDistance, count });
}

/**
 * Check if a position has a solid block beneath it (safe to build on).
 */
function hasSolidGround(bot, pos) {
  const below = bot.blockAt(pos.offset(0, -1, 0));
  return below && below.boundingBox === 'block';
}

/**
 * Return the nearest solid block at the bot's eye-level area
 * that could serve as shelter (has a roof-like block above).
 */
function isUnderCover(bot) {
  if (!bot.entity) return false;
  const pos = bot.entity.position.floored();
  // Check a few blocks above the bot's head for a ceiling
  for (let dy = 1; dy <= 3; dy++) {
    const above = bot.blockAt(pos.offset(0, dy, 0));
    if (above && above.boundingBox === 'block') return true;
  }
  return false;
}

/** Simple distance helper between two Vec3 positions. */
function distance(a, b) {
  return a.distanceTo(b);
}

/**
 * Get a random Vec3 within `radius` blocks of `origin`,
 * useful for wandering / exploration targets.
 */
function randomNearbyPosition(origin, radius) {
  const angle = Math.random() * Math.PI * 2;
  const dist  = Math.random() * radius + radius * 0.3;
  return new Vec3(
    Math.round(origin.x + Math.cos(angle) * dist),
    origin.y,
    Math.round(origin.z + Math.sin(angle) * dist)
  );
}

/** Build a state snapshot for LLM / goal priority evaluation. */
function buildStateSnapshot(bot, inventoryUtils, extraCounts = {}) {
  return {
    health: bot.health,
    food: bot.food,
    position: bot.entity.position.clone(),
    timeOfDay: getTimeOfDay(bot),
    isNight: isNight(bot),
    underCover: isUnderCover(bot),
    nearbyHostiles: getNearbyHostiles(bot, 16).map(e => e.name),
    nearbyPlayers: getNearbyPlayers(bot, 32).map(e => e.username),
    inventory: inventoryUtils.getSummary(bot),
    // Counts from the world scanner — included so goal logic reads from state, not module globals
    nearbyDropCount: extraCounts.nearbyDropCount || 0,
    nearbyChestCount: extraCounts.nearbyChestCount || 0,
  };
}

module.exports = {
  HOSTILE_MOBS,
  getNearbyEntities,
  getNearbyHostiles,
  getNearbyPlayers,
  getNearbyDroppedItems,
  isNight,
  getTimeOfDay,
  findNearestBlock,
  findNearbyBlocks,
  hasSolidGround,
  isUnderCover,
  distance,
  randomNearbyPosition,
  buildStateSnapshot,
};
