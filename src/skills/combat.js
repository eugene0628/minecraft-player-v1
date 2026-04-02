'use strict';
const logger     = require('../utils/logger');
const navigation = require('./navigation');
const { findBestWeapon } = require('../utils/inventory');
const config     = require('../../config');

/**
 * Combat skills — fighting mobs and PvP.
 * The bot is self-preserving: it flees fights it can't win.
 */

/**
 * Attack the nearest hostile mob within range.
 * Uses mineflayer-pvp if available, otherwise basic melee loop.
 *
 * @param {import('mineflayer').Bot} bot
 * @param {object} entity - the target entity
 * @param {object} token - cancellation token
 * @returns {Promise<boolean>} true if target was defeated
 */
async function fightEntity(bot, entity, token) {
  if (!entity || !entity.isValid) return false;

  // Equip best weapon
  await equipBestWeapon(bot);

  logger.info(`Fighting ${entity.name || entity.username || 'entity'}...`);

  // Use pvp plugin if available
  if (bot.pvp) {
    return fightWithPvpPlugin(bot, entity, token);
  }

  // Fallback: basic melee — walk up and attack in a loop
  return fightManually(bot, entity, token);
}

async function fightWithPvpPlugin(bot, entity, token) {
  return new Promise((resolve) => {
    bot.pvp.attack(entity);

    const cleanup = () => {
      bot.pvp.stop();
      resolve(true);
    };

    bot.once('stoppedAttacking', () => resolve(true));

    // Watch for cancellation
    const interval = setInterval(() => {
      if (token.cancelled) {
        clearInterval(interval);
        cleanup();
      }
      // Check if entity is gone
      if (!entity.isValid || entity.health <= 0) {
        clearInterval(interval);
        cleanup();
      }
      // Flee if health too low
      if (bot.health <= config.survival.fleeHealthThreshold) {
        clearInterval(interval);
        bot.pvp.stop();
        resolve(false); // false = didn't win cleanly
      }
    }, 500);

    // Safety timeout (30s)
    setTimeout(() => {
      clearInterval(interval);
      bot.pvp.stop();
      resolve(false);
    }, 30000);
  });
}

async function fightManually(bot, entity, token) {
  const maxTime = Date.now() + 25000;

  while (!token.cancelled && Date.now() < maxTime) {
    if (!entity.isValid || (entity.health !== undefined && entity.health <= 0)) {
      logger.success(`Defeated ${entity.name || 'entity'}`);
      return true;
    }

    // Check if we should flee
    if (bot.health <= config.survival.fleeHealthThreshold) {
      logger.warn('Health critical — fleeing combat');
      navigation.stop(bot);
      return false;
    }

    try {
      // Move close to entity
      const dist = entity.position.distanceTo(bot.entity.position);
      if (dist > 3) {
        await navigation.goTo(bot, entity.position, 2);
      }

      // Look at the entity and attack
      await bot.lookAt(entity.position.offset(0, entity.height * 0.9, 0));
      bot.attack(entity);
      await sleep(600); // attack cooldown
    } catch (err) {
      logger.debug(`Combat tick error: ${err.message}`);
      await sleep(500);
    }
  }
  return false;
}

/**
 * Flee from danger — sprint away in the opposite direction.
 * @param {import('mineflayer').Bot} bot
 * @param {object} threatPos - Vec3 position of the threat
 */
async function flee(bot, threatPos) {
  navigation.stop(bot);
  logger.warn('Fleeing from threat!');

  const pos  = bot.entity.position;
  const away = pos.plus(pos.minus(threatPos).normalize().scale(30));

  // Sprint away
  bot.setControlState('sprint', true);
  await navigation.goTo(bot, away, 5);
  bot.setControlState('sprint', false);
}

/**
 * Equip the best available weapon.
 */
async function equipBestWeapon(bot) {
  try {
    const weapon = findBestWeapon(bot);
    if (weapon) {
      await bot.equip(weapon, 'hand');
    }
  } catch (err) {
    logger.debug(`equipBestWeapon failed: ${err.message}`);
  }
}

/**
 * Should the bot flee given the current combat situation?
 */
function shouldFlee(botHealth, threatCount) {
  if (botHealth <= config.survival.fleeHealthThreshold) return true;
  if (threatCount >= 3 && botHealth < 15) return true;
  return false;
}

/**
 * Should the bot try to fight this entity?
 * Returns false if the bot is not in a good position to fight.
 */
function shouldEngage(bot, entity) {
  if (bot.health <= config.survival.fleeHealthThreshold + 2) return false;
  // Don't engage players unless they attacked first and we're strong
  if (entity.type === 'player') {
    return bot.health >= config.combat.pvpMinHealth;
  }
  return true;
}

/**
 * Heal up by eating food when health is below max.
 * Not a blocking operation — just triggers if food is available.
 */
async function healIfNeeded(bot) {
  if (bot.health < 18 && bot.food >= 18) {
    // Natural regeneration will kick in — just make sure we're not sprinting
    bot.setControlState('sprint', false);
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = {
  fightEntity,
  flee,
  equipBestWeapon,
  shouldFlee,
  shouldEngage,
  healIfNeeded,
};
