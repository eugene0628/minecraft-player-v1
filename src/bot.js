'use strict';
const mineflayer = require('mineflayer');
const { pathfinder, Movements } = require('mineflayer-pathfinder');
const logger      = require('./utils/logger');
const world       = require('./utils/world');
const invUtils    = require('./utils/inventory');
const personality = require('./personality/personality');

// Goals
const GoalManager   = require('./goals/goalManager');
const { FleeGoal, EatGoal, ShelterGoal, ArmorGoal } = require('./goals/survivalGoals');
const { PickupDropsGoal, CraftToolsGoal, MineOresGoal, ChopWoodGoal,
        LootChestsGoal, setNearbyDropCount, setNearbyChestCount } = require('./goals/gatherGoals');
const { FightMobsGoal, DefendSelfGoal, PvpGoal, notifyAttacked } = require('./goals/combatGoals');
const { ExploreGoal, FindVillageGoal, ReturnToVillageGoal } = require('./goals/exploreGoals');
const { RespondToChatGoal, GreetPlayersGoal, TradeGoal,
        onChatMessage, onPlayerJoined } = require('./goals/socialGoals');

/**
 * Create and configure the Mineflayer bot.
 * Returns the bot instance after registering all plugins and event handlers.
 *
 * @param {object} options - Mineflayer createBot options
 * @returns {import('mineflayer').Bot}
 */
function createMinecraftBot(options) {
  const bot = mineflayer.createBot(options);

  // ── Load plugins ─────────────────────────────────────────────────────────
  loadPlugins(bot);

  // ── Goal manager (created but not started until spawn) ───────────────────
  const goalManager = new GoalManager(bot);

  // ── Register event handlers ───────────────────────────────────────────────
  registerEvents(bot, goalManager);

  return bot;
}

function loadPlugins(bot) {
  // Pathfinder — required for all navigation
  bot.loadPlugin(pathfinder);
  logger.info('Plugin loaded: mineflayer-pathfinder');

  // Optional plugins — loaded with try/catch so the bot still works if one fails
  tryLoadPlugin(bot, 'mineflayer-pvp',          pkg => {
    const { plugin } = pkg;
    bot.loadPlugin(plugin);
  });

  tryLoadPlugin(bot, 'mineflayer-collectblock',  pkg => {
    const { plugin } = pkg;
    bot.loadPlugin(plugin);
  });

  tryLoadPlugin(bot, 'mineflayer-auto-eat',      pkg => {
    // v5 exports { loader } instead of a direct plugin function
    const fn = pkg.loader || pkg.plugin || pkg;
    bot.loadPlugin(fn);
  });

  tryLoadPlugin(bot, 'mineflayer-armor-manager', pkg => {
    bot.loadPlugin(pkg);
  });
}

function tryLoadPlugin(bot, name, loader) {
  try {
    const pkg = require(name);
    loader(pkg);
    logger.info(`Plugin loaded: ${name}`);
  } catch (err) {
    logger.warn(`Optional plugin "${name}" not loaded: ${err.message}`);
  }
}

function registerEvents(bot, goalManager) {

  // ── Spawn ─────────────────────────────────────────────────────────────────
  bot.once('spawn', () => {
    logger.success(`Spawned as ${bot.username} in version ${bot.version}`);

    // Set up pathfinder movements
    try {
      const movements = new Movements(bot);
      movements.allowSprinting = true;
      movements.allowParkour   = true;
      bot.pathfinder.setMovements(movements);
    } catch (err) {
      logger.warn(`Pathfinder setup failed: ${err.message}`);
    }

    // Register all goals
    goalManager.registerAll([
      // Survival (highest priority)
      FleeGoal,
      DefendSelfGoal,
      RespondToChatGoal,
      EatGoal,
      ShelterGoal,
      FightMobsGoal,
      ArmorGoal,
      // Gathering & crafting
      PickupDropsGoal,
      CraftToolsGoal,
      ChopWoodGoal,
      MineOresGoal,
      LootChestsGoal,
      // Social
      GreetPlayersGoal,
      TradeGoal,
      PvpGoal,
      // Exploration (lowest priority)
      FindVillageGoal,
      ReturnToVillageGoal,
      ExploreGoal,
    ]);

    // Start the autonomous loop immediately
    goalManager.start().catch(err => {
      logger.error('Goal manager crashed:', err.message);
    });

    // Start the world scanner (updates entity counts for goals)
    startWorldScanner(bot);

    bot.chat('...');
    logger.goal('Bot is live and autonomous!');
  });

  // ── Chat ──────────────────────────────────────────────────────────────────
  bot.on('chat', (username, message) => {
    if (username === bot.username) return; // Ignore own messages
    logger.chat(`[${username}] ${message}`);
    onChatMessage(username, message);
  });

  // ── Player joined (comes into render distance) ────────────────────────────
  bot.on('playerCollect', (collector, itemDrop) => {
    // Someone picked something up nearby — nothing to do
  });

  // Watch for players appearing in entity list
  bot.on('entitySpawn', (entity) => {
    if (entity.type === 'player' && entity.username) {
      onPlayerJoined(entity.username, bot.username);
      logger.info(`Player spotted: ${entity.username}`);

      // Personality reaction to nearby player
      const reaction = personality.reactToPlayerNearby(entity.username);
      logger.debug(reaction);
    }
  });

  // ── Health / damage ───────────────────────────────────────────────────────
  bot.on('health', () => {
    if (bot.health <= 6) {
      logger.warn(`Critical health: ${bot.health}/20`);
    }
  });

  bot.on('entityHurt', (entity) => {
    if (entity !== bot.entity) return;
    // Figure out what hurt us
    const hostiles = world.getNearbyHostiles(bot, 10);
    const nearPlayers = world.getNearbyPlayers(bot, 8);

    if (nearPlayers.length > 0) {
      notifyAttacked(nearPlayers[0]);
    } else if (hostiles.length > 0) {
      notifyAttacked(hostiles[0]);
    }
  });

  // ── Death ─────────────────────────────────────────────────────────────────
  bot.on('death', () => {
    logger.warn('Bot died! Respawning...');
    goalManager.stop();

    const msg = personality.reactToDeath();
    logger.info(`Personality: ${msg}`);

    // Restart goal manager after a brief delay on the next spawn
    bot.once('spawn', () => {
      logger.info('Respawned — restarting goal manager');
      goalManager.running = false;
      goalManager.currentGoal  = null;
      goalManager.currentToken = null;
      startWorldScanner(bot);
      setTimeout(() => goalManager.start(), 2000);
    });
  });

  // ── Kicked / disconnected ─────────────────────────────────────────────────
  bot.on('kicked', (reason) => {
    logger.warn(`Kicked: ${reason}`);
    goalManager.stop();
  });

  bot.on('error', (err) => {
    logger.error('Bot error:', err.message);
  });

  // ── Item pickup notification ──────────────────────────────────────────────
  bot.on('playerCollect', (collector) => {
    if (collector.username === bot.username) {
      logger.debug('Picked up an item');
    }
  });

  // ── Window / chest opened ─────────────────────────────────────────────────
  bot.on('windowOpen', (window) => {
    logger.debug(`Window opened: ${window.title || window.type}`);
  });
}

/**
 * Periodically scan the world and update goal-decision counters.
 * Runs every 3 seconds independently of the goal loop.
 * Returns the interval ID so the caller can clear it on disconnect.
 */
let _scannerInterval = null;
function startWorldScanner(bot) {
  if (_scannerInterval) clearInterval(_scannerInterval);
  _scannerInterval = setInterval(() => {
    try {
      // Update drop count for PickupDropsGoal
      const drops = world.getNearbyDroppedItems(
        bot, personality.opportunisticPickupRadius
      );
      setNearbyDropCount(drops.length);

      // Update chest count for LootChestsGoal
      const chestBlocks = world.findNearbyBlocks(
        bot, ['chest', 'trapped_chest', 'barrel'], 32, 3
      );
      setNearbyChestCount(chestBlocks.length);

    } catch (_) {
      // Bot might be in a weird state — ignore
    }
  }, 3000);

  bot.once('end', () => {
    clearInterval(_scannerInterval);
    _scannerInterval = null;
  });
}

module.exports = { createMinecraftBot };
