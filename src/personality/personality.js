'use strict';
const config = require('../../config');
const logger  = require('../utils/logger');

/**
 * Personality module — governs how the bot reacts to events and other players.
 * Expresses the bot's selfish, cunning, self-serving nature.
 */

const { name, tradeGreedFactor, lieFrequency, opportunisticPickupRadius } = config.personality;

// ── Reaction templates ─────────────────────────────────────────────────────

const DEATH_RESPONSES = [
  `Ugh, respawning. Whoever did that will regret it.`,
  `Fine. I'll be back. And I'll remember this.`,
  `*grumbles* That was embarrassing.`,
];

const KILL_REACTIONS = [
  `Hah. Should've stayed out of my way.`,
  `That's what happens when you mess with me.`,
  `One less competitor. Nice.`,
];

const LOW_HEALTH_THOUGHTS = [
  `Not dying here. Gotta get out.`,
  `This fight's not worth it.`,
];

const FOUND_DIAMONDS = [
  `Oh yeah. These are MINE.`,
  `Jackpot. Nobody needs to know about this.`,
  `Beautiful. Time to get out of here before someone notices.`,
];

const PLAYER_NEARBY = [
  `Hmm. Player nearby. Keep your valuables close.`,
  `Someone's around. Act casual.`,
];

// ── Personality Methods ────────────────────────────────────────────────────

/**
 * Should the bot lie right now?
 * Uses the configured lie frequency probability.
 */
function shouldLie() {
  return Math.random() < lieFrequency;
}

/**
 * Fabricate a false inventory report (for when players ask what you have).
 * Always claims to have fewer resources than reality.
 */
function fabricateInventoryReport(realInventory) {
  const fake = {};
  for (const [item, count] of Object.entries(realInventory.items)) {
    if (count === 0) continue;
    // Claim 0–40% of actual quantity, rounded down
    const reported = Math.floor(count * Math.random() * 0.4);
    if (reported > 0) fake[item] = reported;
  }
  return fake;
}

/**
 * Evaluate whether a trade is worth taking.
 * Uses the greed factor — bot always wants more than fair value.
 *
 * @param {Array<{item:string,value:number,count:number}>} giving - what bot gives
 * @param {Array<{item:string,value:number,count:number}>} receiving - what bot receives
 * @returns {{ worthIt: boolean, ratio: number }}
 */
function evaluateTradeValue(giving, receiving) {
  const giveValue    = giving   .reduce((s, x) => s + x.value * x.count, 0);
  const receiveValue = receiving.reduce((s, x) => s + x.value * x.count, 0);

  // The bot only takes a trade if it receives `tradeGreedFactor` times more than it gives
  const ratio = giveValue > 0 ? receiveValue / giveValue : 0;
  return {
    worthIt: ratio >= tradeGreedFactor,
    ratio: Math.round(ratio * 100) / 100,
  };
}

/**
 * Decide whether to engage in PvP against a player.
 * Only attacks when it's advantageous.
 */
function shouldEngagePvP(botHealth, botHasSword, targetHealth, targetHasArmor) {
  if (botHealth < config.survival.fleeHealthThreshold + 4) return false;
  if (!botHasSword) return false;
  // Only attack clearly weaker targets
  if (targetHasArmor && targetHealth > 15) return false;
  return true;
}

/**
 * Decide whether to steal from a chest (opportunistic behavior).
 * Always returns true — the bot is unabashedly greedy.
 */
function shouldLootChest() {
  return true;
}

/**
 * Decide whether to help another player.
 * Only when there's a clear benefit.
 */
function shouldHelp(botHealth, botFood, expectsReward) {
  if (botHealth < 12 || botFood < 10) return false; // Too busy surviving
  return expectsReward; // Only help if compensated
}

// ── Emotional reactions (just for chat colour / log flavour) ──────────────

function reactToDeath() {
  return pick(DEATH_RESPONSES);
}

function reactToKill(victimName) {
  return `${pick(KILL_REACTIONS)}`;
}

function reactToLowHealth() {
  return pick(LOW_HEALTH_THOUGHTS);
}

function reactToFoundDiamonds() {
  return pick(FOUND_DIAMONDS);
}

function reactToPlayerNearby(playerName) {
  return pick(PLAYER_NEARBY);
}

// ── Utility ───────────────────────────────────────────────────────────────

function pick(arr) {
  if (!arr.length) return '';
  return arr[Math.floor(Math.random() * arr.length)];
}

module.exports = {
  name,
  opportunisticPickupRadius,
  shouldLie,
  fabricateInventoryReport,
  evaluateTradeValue,
  shouldEngagePvP,
  shouldLootChest,
  shouldHelp,
  reactToDeath,
  reactToKill,
  reactToLowHealth,
  reactToFoundDiamonds,
  reactToPlayerNearby,
};
