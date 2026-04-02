'use strict';
const logger   = require('../utils/logger');
const config   = require('../../config');
const invUtils = require('../utils/inventory');
const world    = require('../utils/world');
const mining   = require('../skills/mining');
const crafting = require('../skills/crafting');
const nav      = require('../skills/navigation');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────────────────────────────────────────────
//  PICK UP DROPS GOAL  (opportunistic — grabs any nearby item drops)
// ─────────────────────────────────────────────────────────────────────────────
const PickupDropsGoal = {
  name: 'pickup_drops',
  maxDurationMs: 15000,

  priority(state) {
    const drops = countNearbyDrops(state);
    if (drops === 0) return 0;
    return 65; // Always worth grabbing free items
  },

  canRun(state) {
    return countNearbyDrops(state) > 0 && state.inventory.freeSlots > 0;
  },

  async run(bot, token, state) {
    logger.info('Picking up nearby dropped items...');
    const collected = await mining.collectNearbyDrops(
      bot, token, config.personality.opportunisticPickupRadius
    );
    if (collected > 0) logger.success(`Collected ${collected} item stacks`);
  },
};

function countNearbyDrops(state) {
  // Read from the state snapshot (populated by the world scanner via goalManager)
  return state.nearbyDropCount || 0;
}
let _nearbyDropCount = 0;
function setNearbyDropCount(n) { _nearbyDropCount = n; }
function getNearbyDropCount() { return _nearbyDropCount; }

// ─────────────────────────────────────────────────────────────────────────────
//  CRAFT TOOLS GOAL  (priority ~60 when missing basic tools)
// ─────────────────────────────────────────────────────────────────────────────
const CraftToolsGoal = {
  name: 'craft_tools',
  maxDurationMs: 30000,

  priority(state) {
    // Only pursue crafting if we actually have wood/materials to work with
    if (!hasCraftingMaterials(state)) return 0;
    if (!state.inventory.hasPickaxe) return 60;
    if (canUpgradeTools(state)) return 55;
    return 0;
  },

  canRun(state) {
    return hasCraftingMaterials(state) && (!state.inventory.hasPickaxe || canUpgradeTools(state));
  },

  async run(bot, token, state) {
    logger.info('Crafting tools...');
    await crafting.ensureBasicTools(bot);

    // Craft iron tools if we have enough iron
    if (!token.cancelled && invUtils.countItem(bot, 'iron_ingot') >= 9) {
      await crafting.craftItem(bot, 'iron_pickaxe', 1);
      await crafting.craftItem(bot, 'iron_sword', 1);
      await crafting.craftItem(bot, 'iron_axe', 1);
    }

    // Craft diamond tools if we have diamonds
    if (!token.cancelled && invUtils.countItem(bot, 'diamond') >= 9) {
      await crafting.craftItem(bot, 'diamond_pickaxe', 1);
      await crafting.craftItem(bot, 'diamond_sword', 1);
    }
  },
};

function canUpgradeTools(state) {
  const items = state.inventory.items;
  const hasIronPick = Object.keys(items).some(n => n === 'iron_pickaxe' || n === 'diamond_pickaxe' || n === 'netherite_pickaxe');
  return !hasIronPick && (items.iron_ingot || 0) >= 9;
}

function hasCraftingMaterials(state) {
  const items = state.inventory.items;
  // Has at least some wood/planks/cobblestone to work with
  const woodCount = mining.WOOD_LOGS.reduce((s, log) => {
    const plank = log.replace('_log', '_planks');
    return s + (items[log] || 0) + (items[plank] || 0);
  }, 0);
  const stoneCount = (items.cobblestone || 0) + (items.cobbled_deepslate || 0);
  const ironCount  = (items.iron_ingot  || 0);
  return woodCount > 0 || stoneCount >= 3 || ironCount >= 3;
}

// ─────────────────────────────────────────────────────────────────────────────
//  MINE ORES GOAL  (priority ~45 — the bot's bread-and-butter activity)
// ─────────────────────────────────────────────────────────────────────────────
const MineOresGoal = {
  name: 'mine_ores',
  maxDurationMs: 45000,

  priority(state) {
    if (state.inventory.freeSlots < config.gathering.minFreeInventorySlots) return 0;
    if (!state.inventory.hasPickaxe) return 0; // Need a pickaxe first
    // Higher priority when we have few valuables
    const valuable = countValuables(state);
    if (valuable < 5)  return 50;
    if (valuable < 20) return 40;
    return 30;
  },

  canRun(state) {
    return (
      state.inventory.hasPickaxe &&
      state.inventory.freeSlots >= config.gathering.minFreeInventorySlots &&
      !state.isNight
    );
  },

  async run(bot, token, state) {
    logger.info('Mining ores...');

    // Try to find and mine ore up to 5 times per goal run
    let mined = 0;
    const maxAttempts = 5;

    for (let i = 0; i < maxAttempts && !token.cancelled; i++) {
      const found = await mining.mineOre(
        bot, token, config.gathering.blockScanRadius
      );
      if (found) {
        mined++;
        await sleep(300);
      } else {
        // No ore nearby — wander a bit to find more
        logger.debug('No ore in range, wandering...');
        await nav.wander(bot, 20);
        break;
      }
    }

    logger.info(`Mining run complete — mined ${mined} ore blocks`);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
//  CHOP WOOD GOAL  (priority ~45 when low on wood/planks)
// ─────────────────────────────────────────────────────────────────────────────
const ChopWoodGoal = {
  name: 'chop_wood',
  maxDurationMs: 30000,

  priority(state) {
    const woodCount = countWood(state);
    if (woodCount === 0) return 55; // Critical — can't craft without wood
    if (woodCount < 8)  return 42;
    return 0;
  },

  canRun(state) {
    return countWood(state) < 16;
  },

  async run(bot, token, state) {
    logger.info('Chopping wood...');

    let chopped = 0;
    const target = 8; // logs to chop this run

    while (chopped < target && !token.cancelled) {
      const found = await mining.chopWood(
        bot, token, config.gathering.blockScanRadius
      );
      if (found) {
        chopped++;
        await sleep(200);
      } else {
        logger.debug('No nearby trees — wandering to find some');
        await nav.wander(bot, 40);
        break;
      }
    }

    // Immediately convert logs to planks
    if (!token.cancelled && chopped > 0) {
      for (const logType of mining.WOOD_LOGS) {
        if (invUtils.countItem(bot, logType) > 0) {
          const plankName = logType.replace('_log', '_planks');
          await crafting.craftItem(bot, plankName, invUtils.countItem(bot, logType));
        }
      }
    }

    logger.info(`Chopped ${chopped} logs`);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
//  LOOT CHESTS GOAL  (opportunistic — loot any unguarded container)
// ─────────────────────────────────────────────────────────────────────────────
const LootChestsGoal = {
  name: 'loot_chests',
  maxDurationMs: 20000,

  priority(state) {
    // Only loot when no immediate threats and not at night
    if (state.nearbyHostiles.length > 0) return 0;
    if (state.isNight) return 0;
    return state.nearbyChestCount > 0 ? 35 : 0;
  },

  canRun(state) {
    return (
      state.nearbyChestCount > 0 &&
      state.nearbyHostiles.length === 0 &&
      state.inventory.freeSlots > 4
    );
  },

  async run(bot, token, state) {
    logger.info('Looking for chests to loot...');
    const chest = world.findNearestBlock(bot, ['chest', 'trapped_chest', 'barrel'], 32);
    if (!chest) return;

    try {
      const moved = await nav.goToBlock(bot, chest, 3);
      if (!moved || token.cancelled) return;

      const window = await bot.openChest(chest);
      const items  = window.containerItems();

      if (items.length === 0) {
        logger.debug('Chest is empty');
        window.close();
        return;
      }

      logger.info(`Looting chest with ${items.length} item types...`);

      // Take everything valuable
      for (const item of items) {
        if (token.cancelled) break;
        if (invUtils.freeSlots(bot) <= 1) break;
        try {
          await window.withdraw(item.type, null, item.count);
          logger.success(`Took ${item.count}x ${item.name} from chest`);
          await sleep(200);
        } catch (err) {
          logger.debug(`Could not take ${item.name}: ${err.message}`);
        }
      }
      window.close();
    } catch (err) {
      logger.debug(`Loot chest failed: ${err.message}`);
    }
  },
};

let _nearbyChestCount = 0;
function setNearbyChestCount(n) { _nearbyChestCount = n; }
function getNearbyChestCount() { return _nearbyChestCount; }

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────
function countValuables(state) {
  const items = state.inventory.items;
  const keys = ['diamond', 'emerald', 'gold_ingot', 'iron_ingot', 'netherite_ingot', 'ancient_debris'];
  return keys.reduce((s, k) => s + (items[k] || 0), 0);
}

function countWood(state) {
  const items = state.inventory.items;
  return mining.WOOD_LOGS.reduce((s, log) => {
    const plank = log.replace('_log', '_planks');
    // Use ceil so any planks (even 1–3) count as at least 1 log-equivalent,
    // preventing the bot from treating 3 planks as "critical" (0 wood).
    return s + (items[log] || 0) + Math.ceil((items[plank] || 0) / 4);
  }, 0);
}

module.exports = {
  PickupDropsGoal,
  CraftToolsGoal,
  MineOresGoal,
  ChopWoodGoal,
  LootChestsGoal,
  setNearbyDropCount,
  setNearbyChestCount,
  getNearbyDropCount,
  getNearbyChestCount,
};
