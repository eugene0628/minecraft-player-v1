'use strict';
const logger   = require('../utils/logger');
const config   = require('../../config');
const invUtils = require('../utils/inventory');
const world    = require('../utils/world');
const combat   = require('../skills/combat');
const building = require('../skills/building');
const nav      = require('../skills/navigation');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────────────────────────────────────────────
//  FLEE GOAL  (priority ~100 when threatened and low health)
// ─────────────────────────────────────────────────────────────────────────────
const FleeGoal = {
  name: 'flee',
  maxDurationMs: 12000,

  priority(state) {
    const hostileCount = state.nearbyHostiles.length;
    if (state.health <= config.survival.fleeHealthThreshold) return 100;
    if (state.health <= 8 && hostileCount > 0) return 95;
    return 0;
  },

  canRun(state) {
    return (
      state.health <= config.survival.fleeHealthThreshold ||
      (state.health <= 8 && state.nearbyHostiles.length > 0)
    );
  },

  async run(bot, token, state) {
    const hostiles = world.getNearbyHostiles(bot, 20);
    if (hostiles.length === 0) return;

    // Flee from the nearest threat
    const nearest = hostiles.reduce((a, b) =>
      a.position.distanceTo(bot.entity.position) <
      b.position.distanceTo(bot.entity.position) ? a : b
    );

    logger.warn(`FLEE from ${nearest.name} — health: ${bot.health}`);
    await combat.flee(bot, nearest.position);

    // Try to eat while fleeing
    const food = invUtils.findBestFood(bot);
    if (food && bot.food < 18) {
      try { await bot.equip(food, 'hand'); await bot.consume(); } catch (_) {}
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
//  EAT GOAL  (priority ~80 when hungry)
// ─────────────────────────────────────────────────────────────────────────────
const EatGoal = {
  name: 'eat',
  maxDurationMs: 8000,

  priority(state) {
    if (state.food <= config.survival.criticalFoodThreshold) return 90;
    if (state.food <= config.survival.eatFoodThreshold)      return 80;
    return 0;
  },

  canRun(state) {
    return state.food <= config.survival.eatFoodThreshold;
  },

  async run(bot, token, state) {
    const food = invUtils.findBestFood(bot);
    if (!food) {
      logger.warn('Hungry but no food in inventory!');
      return;
    }

    logger.info(`Eating ${food.name} (food: ${bot.food}/20)`);
    try {
      await bot.equip(food, 'hand');
      await bot.consume();
      logger.success(`Ate ${food.name} — food now ${bot.food}/20`);
    } catch (err) {
      logger.debug(`Eat failed: ${err.message}`);
    }

    // If still hungry, eat another
    if (!token.cancelled && bot.food <= config.survival.eatFoodThreshold) {
      const more = invUtils.findBestFood(bot);
      if (more) {
        try {
          await bot.equip(more, 'hand');
          await bot.consume();
        } catch (_) {}
      }
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
//  SHELTER GOAL  (priority ~70 at night without cover)
// ─────────────────────────────────────────────────────────────────────────────
const ShelterGoal = {
  name: 'build_shelter',
  maxDurationMs: 60000,

  priority(state) {
    if (!state.isNight) return 0;
    if (state.underCover) return 0;
    // Higher priority the later in the night it is
    return 70;
  },

  canRun(state) {
    return state.isNight && !state.underCover && state.health > 6;
  },

  async run(bot, token, state) {
    if (building.hasNearbyRoof(bot)) {
      logger.info('Already under cover — shelter goal done');
      return;
    }

    logger.info('Night time — need shelter!');

    // Try to build if we have materials
    if (building.hasShelterMaterials(bot)) {
      await building.buildShelter(bot, token);
      return;
    }

    // No materials — dig a hole instead
    logger.info('No materials — digging hideout');
    await building.digHideout(bot, token);

    // Worst case: just find any overhang or cave
    if (!building.hasNearbyRoof(bot)) {
      logger.warn('Could not build shelter — staying put and hoping for the best');
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
//  ARMOR GOAL  (priority ~50 — equip best armor when inventory has better)
// ─────────────────────────────────────────────────────────────────────────────
const ArmorGoal = {
  name: 'equip_armor',
  maxDurationMs: 5000,

  priority(state) {
    // Low-priority background task
    return hasUnequippedBetterArmor(state) ? 50 : 0;
  },

  canRun(state) {
    return hasUnequippedBetterArmor(state);
  },

  async run(bot, token, state) {
    // mineflayer-armor-manager handles this automatically when loaded.
    // This goal is a manual fallback.
    const slots = ['head', 'torso', 'legs', 'feet'];
    const tierOrder = ['netherite', 'diamond', 'iron', 'golden', 'chainmail', 'leather'];

    for (const slot of slots) {
      if (token.cancelled) return;
      for (const tier of tierOrder) {
        const piece = armorPieceName(tier, slot);
        const item  = bot.inventory.items().find(i => i.name === piece);
        if (item) {
          try {
            await bot.equip(item, slot);
            logger.info(`Equipped ${piece}`);
          } catch (_) {}
          break;
        }
      }
    }
  },
};

function hasUnequippedBetterArmor(state) {
  // Simple heuristic — just check if there's any armor in inventory at all
  const armorKeywords = ['helmet', 'chestplate', 'leggings', 'boots'];
  return Object.keys(state.inventory.items).some(name =>
    armorKeywords.some(k => name.includes(k))
  );
}

function armorPieceName(tier, slot) {
  const map = { head: 'helmet', torso: 'chestplate', legs: 'leggings', feet: 'boots' };
  return `${tier}_${map[slot]}`;
}

module.exports = { FleeGoal, EatGoal, ShelterGoal, ArmorGoal };
