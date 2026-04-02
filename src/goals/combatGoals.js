'use strict';
const logger      = require('../utils/logger');
const config      = require('../../config');
const world       = require('../utils/world');
const combat      = require('../skills/combat');
const nav         = require('../skills/navigation');
const personality = require('../personality/personality');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────────────────────────────────────────────
//  FIGHT MOBS GOAL  (priority ~75 when hostile mobs are close)
// ─────────────────────────────────────────────────────────────────────────────
const FightMobsGoal = {
  name: 'fight_mobs',
  maxDurationMs: 30000,

  priority(state) {
    const hostiles = state.nearbyHostiles;
    if (hostiles.length === 0) return 0;
    // Only fight if health is OK
    if (state.health <= config.survival.fleeHealthThreshold) return 0; // flee handles this
    if (state.health <= 8) return 0;
    // Scale priority with number of mobs — more mobs = more urgent
    return 75 + Math.min(hostiles.length * 2, 15);
  },

  canRun(state) {
    return (
      state.nearbyHostiles.length > 0 &&
      state.health > config.survival.fleeHealthThreshold + 2 &&
      state.inventory.hasSword
    );
  },

  async run(bot, token, state) {
    // Re-fetch live entities (state snapshot may be stale)
    const hostiles = world.getNearbyHostiles(bot, config.combat.threatScanRadius);
    if (hostiles.length === 0) return;

    // Sort by distance — fight nearest first
    hostiles.sort((a, b) =>
      a.position.distanceTo(bot.entity.position) -
      b.position.distanceTo(bot.entity.position)
    );

    for (const mob of hostiles) {
      if (token.cancelled) return;
      if (!mob.isValid) continue;

      // Check if we should flee instead
      if (combat.shouldFlee(bot.health, world.getNearbyHostiles(bot, 16).length)) {
        logger.warn('Too many mobs — fleeing instead of fighting');
        await combat.flee(bot, mob.position);
        return;
      }

      logger.info(`Fighting ${mob.name} (health: ${bot.health}/20)`);
      const won = await combat.fightEntity(bot, mob, token);

      if (!won && combat.shouldFlee(bot.health, 1)) {
        await combat.flee(bot, mob.position);
        return;
      }

      await sleep(500); // brief pause between fights
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
//  DEFEND SELF GOAL  (priority ~85 — reactive, triggered when attacked)
//  Unlike FightMobsGoal this activates even if the bot only has fists.
// ─────────────────────────────────────────────────────────────────────────────
const DefendSelfGoal = {
  name: 'defend_self',
  maxDurationMs: 20000,

  priority(state) {
    return _underAttack ? 85 : 0;
  },

  canRun(state) {
    return _underAttack && state.health > config.survival.fleeHealthThreshold;
  },

  async run(bot, token, state) {
    _underAttack = false; // reset flag

    // Equip best weapon first
    await combat.equipBestWeapon(bot);

    const attacker = _lastAttacker;
    if (!attacker || !attacker.isValid) return;

    logger.warn(`Defending self against ${attacker.name || attacker.username}`);

    if (combat.shouldFlee(bot.health, 1)) {
      await combat.flee(bot, attacker.position);
      return;
    }

    await combat.fightEntity(bot, attacker, token);
    _lastAttacker = null;
  },
};

let _underAttack  = false;
let _lastAttacker = null;

/** Call this from bot event handlers when the bot takes damage from an entity. */
function notifyAttacked(entity) {
  _underAttack  = true;
  _lastAttacker = entity;
}

// ─────────────────────────────────────────────────────────────────────────────
//  PVP GOAL  (opportunistic — attacks vulnerable players for loot)
//  Only engages when the bot has good health + gear and target is clearly weak.
// ─────────────────────────────────────────────────────────────────────────────
const PvpGoal = {
  name: 'pvp',
  maxDurationMs: 25000,

  priority(state) {
    if (!_pvpTarget) return 0;
    return 72; // High but below immediate defense
  },

  canRun(state) {
    if (!_pvpTarget || !_pvpTarget.isValid) return false;
    // Only attack if we're in good shape
    return (
      state.health >= config.combat.pvpMinHealth &&
      state.inventory.hasSword
    );
  },

  async run(bot, token, state) {
    const target = _pvpTarget;
    _pvpTarget = null;

    if (!target || !target.isValid) return;

    logger.info(`PvP: targeting player ${target.username}`);
    bot.chat(`Nice stuff you got there, ${target.username}. I'll take that.`);
    await sleep(500);

    await combat.fightEntity(bot, target, token);
    // After winning, collect any drops
    await sleep(1000);
  },
};

let _pvpTarget = null;

/** Mark a player as a PvP target. */
function setPvpTarget(entity) {
  _pvpTarget = entity;
}

module.exports = {
  FightMobsGoal,
  DefendSelfGoal,
  PvpGoal,
  notifyAttacked,
  setPvpTarget,
};
