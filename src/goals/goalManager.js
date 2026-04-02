'use strict';
const logger = require('../utils/logger');
const config = require('../../config');
const worldUtils = require('../utils/world');
const invUtils   = require('../utils/inventory');

/**
 * CancellationToken — passed to each running goal.
 * Goal functions should check `token.cancelled` and bail early when true.
 */
class CancellationToken {
  constructor() { this.cancelled = false; }
  cancel()      { this.cancelled = true; }
}

/**
 * GoalManager — the brain of the autonomous bot.
 *
 * Goals are registered as plain objects:
 * {
 *   name: string,
 *   priority: (state) => number,   // higher = more urgent
 *   canRun:   (state) => boolean,  // whether this goal is currently executable
 *   run:      (bot, token, state) => Promise<void>,
 *   maxDurationMs?: number,         // defaults to config.loop.defaultGoalDurationMs
 * }
 */
class GoalManager {
  constructor(bot) {
    this.bot          = bot;
    this.goals        = [];
    this.currentGoal  = null;
    this.currentToken = null;
    this.running      = false;
    this.tickMs       = config.loop.tickMs;
  }

  /** Register a goal. */
  register(goal) {
    this.goals.push(goal);
    logger.debug(`Registered goal: ${goal.name}`);
  }

  /** Register multiple goals at once. */
  registerAll(goals) {
    goals.forEach(g => this.register(g));
  }

  /** Build a snapshot of the current world state for goal evaluation. */
  getState() {
    try {
      return worldUtils.buildStateSnapshot(this.bot, invUtils);
    } catch (err) {
      // Bot might not be fully spawned yet
      return {
        health: this.bot.health || 20,
        food: this.bot.food || 20,
        position: this.bot.entity?.position,
        timeOfDay: 'day',
        isNight: false,
        underCover: false,
        nearbyHostiles: [],
        nearbyPlayers: [],
        inventory: { items: {}, freeSlots: 36, hasFood: false, hasSword: false, hasPickaxe: false },
      };
    }
  }

  /** Select the highest-priority goal that can currently run. */
  selectBestGoal(state) {
    let best = null;
    let bestPriority = -Infinity;

    for (const goal of this.goals) {
      try {
        if (!goal.canRun(state)) continue;
        const p = goal.priority(state);
        if (p > bestPriority) {
          bestPriority = p;
          best = goal;
        }
      } catch (err) {
        logger.debug(`Error evaluating goal ${goal.name}: ${err.message}`);
      }
    }
    return best;
  }

  /**
   * Start the autonomous goal loop.
   * Runs forever (until bot disconnects or `stop()` is called).
   */
  async start() {
    this.running = true;
    logger.goal('Autonomous goal loop started — bot is alive!');

    while (this.running) {
      try {
        await this._tick();
      } catch (err) {
        logger.error('Goal loop error:', err.message);
        await sleep(3000);
      }
    }
  }

  async _tick() {
    const state = this.getState();
    const best  = this.selectBestGoal(state);

    if (!best) {
      // Nothing to do — idle
      await sleep(this.tickMs);
      return;
    }

    // If the best goal is already running, wait for the next tick
    if (this.currentGoal && this.currentGoal.name === best.name) {
      await sleep(this.tickMs);
      return;
    }

    // Cancel the current goal and switch to the better one
    if (this.currentGoal) {
      logger.goal(`Interrupting "${this.currentGoal.name}" → switching to "${best.name}"`);
      if (this.currentToken) this.currentToken.cancel();
    }

    this.currentGoal  = best;
    this.currentToken = new CancellationToken();
    const token       = this.currentToken;
    const maxMs       = best.maxDurationMs || config.loop.defaultGoalDurationMs;

    logger.goal(`Running goal: ${best.name} (max ${maxMs / 1000}s)`);

    // Run the goal with a timeout, then clear it
    try {
      await Promise.race([
        best.run(this.bot, token, state),
        sleep(maxMs).then(() => token.cancel()), // soft cancel after timeout
      ]);
    } catch (err) {
      if (err.message !== 'Goal cancelled') {
        logger.warn(`Goal "${best.name}" error: ${err.message}`);
      }
    } finally {
      if (this.currentGoal === best) {
        this.currentGoal  = null;
        this.currentToken = null;
      }
    }

    await sleep(500); // brief pause between goals
  }

  /** Stop the autonomous loop. */
  stop() {
    this.running = false;
    if (this.currentToken) this.currentToken.cancel();
    logger.warn('Goal manager stopped');
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = GoalManager;
