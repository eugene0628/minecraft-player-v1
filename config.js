'use strict';
require('dotenv').config();

const config = {
  // ── Server ───────────────────────────────────────────────────────────────
  server: {
    host: process.env.MC_HOST || 'localhost',
    port: parseInt(process.env.MC_PORT, 10) || 25565,
    username: process.env.MC_USERNAME || 'SneakyBot',
    // 'false' string or missing = auto-detect from server
    version: (process.env.MC_VERSION && process.env.MC_VERSION !== 'false')
      ? process.env.MC_VERSION
      : false,
    auth: process.env.MC_AUTH || 'offline',
  },

  // ── Ollama / LLM ─────────────────────────────────────────────────────────
  llm: {
    enabled: process.env.OLLAMA_ENABLED !== 'false',
    host: process.env.OLLAMA_HOST || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'mistral',
    // Max ms to wait for an LLM response before falling back to rule-based
    timeoutMs: 8000,
    // How many recent chat messages to include as context
    chatContextLength: 10,
  },

  // ── Autonomous Loop ───────────────────────────────────────────────────────
  loop: {
    tickMs: parseInt(process.env.GOAL_TICK_MS, 10) || 2000,
    // Default max time a single goal can run before being interrupted (ms)
    defaultGoalDurationMs: 30000,
  },

  // ── Reconnect ─────────────────────────────────────────────────────────────
  reconnect: {
    delayMs: (parseInt(process.env.RECONNECT_DELAY_SECONDS, 10) || 10) * 1000,
    maxAttempts: parseInt(process.env.MAX_RECONNECT_ATTEMPTS, 10) || 20,
  },

  // ── Survival Thresholds ───────────────────────────────────────────────────
  survival: {
    // Flee from combat below this health level
    fleeHealthThreshold: 6,
    // Start looking for food below this food level
    eatFoodThreshold: 14,
    // Critically hungry — eat immediately
    criticalFoodThreshold: 8,
    // Build shelter if it's night and bot has no shelter nearby
    shelterSearchRadius: 20,
  },

  // ── Combat ────────────────────────────────────────────────────────────────
  combat: {
    // Only fight mobs within this range (blocks)
    mobEngageRadius: 8,
    // Scan for nearby hostile mobs within this radius
    threatScanRadius: 16,
    // Only PvP players if health is above this threshold
    pvpMinHealth: 14,
  },

  // ── Gathering ─────────────────────────────────────────────────────────────
  gathering: {
    // Search for ore/wood within this radius
    blockScanRadius: 32,
    // Pick up dropped items within this radius
    itemPickupRadius: 16,
    // Stop mining when inventory slots below this number
    minFreeInventorySlots: 4,
  },

  // ── Exploration ───────────────────────────────────────────────────────────
  exploration: {
    // Distance to travel per explore step
    wanderDistance: 50,
  },

  // ── Personality ───────────────────────────────────────────────────────────
  personality: {
    name: process.env.MC_USERNAME || 'SneakyBot',
    // Trade fairness: 1.0 = fair, 0.5 = bot demands double, 2.0 = bot undersells
    tradeGreedFactor: 1.8,
    // Probability (0–1) of lying in a given chat exchange
    lieFrequency: 0.3,
    // How many blocks away to notice dropped items to opportunistically grab
    opportunisticPickupRadius: 24,
    // Traits fed into the LLM system prompt
    traits: [
      'greedy and resource-hoarding',
      'cunning and deceptive when it benefits you',
      'self-preserving — you flee fights you cannot win',
      'opportunistic — you steal from unguarded chests and grab dropped items',
      'transactional — you help others only when you expect payment',
      'you subtly mislead players about your resource levels and intentions',
    ],
  },

  // ── Logging ───────────────────────────────────────────────────────────────
  log: {
    level: process.env.LOG_LEVEL || 'info',
  },
};

module.exports = config;
