'use strict';
const logger = require('../utils/logger');
const config = require('../../config');
const world  = require('../utils/world');
const nav    = require('../skills/navigation');
const { Vec3 } = require('vec3');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Track visited chunks to avoid revisiting the same areas
const _visitedPositions = new Set();
const VISITED_GRID = 32; // round positions to 32-block grid

function gridKey(pos) {
  return `${Math.floor(pos.x / VISITED_GRID)},${Math.floor(pos.z / VISITED_GRID)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  EXPLORE GOAL  (low-priority fallback when there's nothing urgent to do)
// ─────────────────────────────────────────────────────────────────────────────
const ExploreGoal = {
  name: 'explore',
  maxDurationMs: 30000,

  priority(state) {
    // Only explore during the day when safe and resourced
    if (state.isNight) return 0;
    if (state.health < 12) return 0;
    if (state.nearbyHostiles.length > 0) return 0;
    return 20; // Low — everything else takes precedence
  },

  canRun(state) {
    return (
      !state.isNight &&
      state.health >= 10 &&
      state.food >= 8 &&
      state.nearbyHostiles.length === 0
    );
  },

  async run(bot, token, state) {
    // Pick an unvisited direction to explore
    const pos    = bot.entity.position;
    const target = pickExploreTarget(pos);

    logger.info(`Exploring towards ${target.x}, ${target.z}`);
    _visitedPositions.add(gridKey(pos));

    await nav.goToXZ(bot, target.x, target.z);

    // Scan for interesting things after arriving
    if (!token.cancelled) {
      await scanSurroundings(bot);
      _visitedPositions.add(gridKey(bot.entity.position));
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
//  FIND VILLAGE GOAL  (seeks out villages for trading/looting)
// ─────────────────────────────────────────────────────────────────────────────
const FindVillageGoal = {
  name: 'find_village',
  maxDurationMs: 60000,

  priority(state) {
    if (state.isNight) return 0;
    // Only pursue this when we're already well-equipped
    const items = state.inventory.items;
    const hasSword = state.inventory.hasSword;
    const hasGoodGear = hasSword && (items.iron_ingot || 0) > 5;
    return hasGoodGear && !_foundVillage ? 25 : 0;
  },

  canRun(state) {
    return (
      !state.isNight &&
      state.health > 14 &&
      !_foundVillage
    );
  },

  async run(bot, token, state) {
    logger.info('Searching for a village...');

    // Spiral outward looking for village indicator blocks
    const villageBlocks = ['bell', 'villager', 'hay_block', 'composter', 'cartography_table'];
    const pos = bot.entity.position;

    for (let radius = 64; radius <= 256 && !token.cancelled; radius += 64) {
      const block = world.findNearestBlock(bot, villageBlocks, radius);
      if (block) {
        logger.success(`Found potential village at ${block.position}!`);
        _foundVillage = true;
        _villagePosition = block.position.clone();

        await nav.goToBlock(bot, block, 10);
        bot.chat('Nice little village. Let me see what\'s here...');
        return;
      }

      // Wander in the search direction
      await nav.wander(bot, radius * 0.8);
      await sleep(500);
    }
  },
};

let _foundVillage    = false;
let _villagePosition = null;

// ─────────────────────────────────────────────────────────────────────────────
//  RETURN TO VILLAGE GOAL  (go back to a known village)
// ─────────────────────────────────────────────────────────────────────────────
const ReturnToVillageGoal = {
  name: 'return_to_village',
  maxDurationMs: 30000,

  priority(state) {
    if (!_foundVillage || !_villagePosition) return 0;
    if (state.isNight) return 0;
    const dist = state.position.distanceTo(_villagePosition);
    // Return when far away and low on food/resources
    if (dist > 200 && (state.food < 12 || countItems(state) < 5)) return 28;
    return 0;
  },

  canRun(state) {
    return _foundVillage && !!_villagePosition && !state.isNight;
  },

  async run(bot, token, state) {
    logger.info('Returning to known village...');
    await nav.goTo(bot, _villagePosition, 15);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

function pickExploreTarget(currentPos) {
  // Try to find an unvisited direction
  const angles = [0, 45, 90, 135, 180, 225, 270, 315];
  const dist   = config.exploration.wanderDistance;

  for (const angle of shuffle(angles)) {
    const rad = (angle * Math.PI) / 180;
    const candidate = new Vec3(
      Math.round(currentPos.x + Math.cos(rad) * dist),
      currentPos.y,
      Math.round(currentPos.z + Math.sin(rad) * dist)
    );
    if (!_visitedPositions.has(gridKey(candidate))) {
      return candidate;
    }
  }

  // All directions visited — just wander randomly
  return world.randomNearbyPosition(currentPos, dist);
}

async function scanSurroundings(bot) {
  // Quick 360° look around after arriving somewhere new
  for (let yaw = 0; yaw < Math.PI * 2; yaw += Math.PI / 4) {
    await bot.look(yaw, 0, false);
    await sleep(100);
  }
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function countItems(state) {
  return Object.values(state.inventory.items).reduce((s, v) => s + v, 0);
}

module.exports = {
  ExploreGoal,
  FindVillageGoal,
  ReturnToVillageGoal,
};
