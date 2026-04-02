'use strict';
const logger      = require('../utils/logger');
const config      = require('../../config');
const world       = require('../utils/world');
const nav         = require('../skills/navigation');
const invUtils    = require('../utils/inventory');
const personality = require('../personality/personality');
const decisionMaker = require('../llm/decisionMaker');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Shared chat history for LLM context
const _chatHistory = [];
const MAX_HISTORY = 20;

// Pending messages that need responses
const _pendingMessages = [];

// ─────────────────────────────────────────────────────────────────────────────
//  RESPOND TO CHAT GOAL  (high priority when a player directly messages the bot)
// ─────────────────────────────────────────────────────────────────────────────
const RespondToChatGoal = {
  name: 'respond_to_chat',
  maxDurationMs: 10000,

  priority(state) {
    return _pendingMessages.length > 0 ? 88 : 0;
  },

  canRun(state) {
    return _pendingMessages.length > 0;
  },

  async run(bot, token, state) {
    // Drain the pending message queue
    while (_pendingMessages.length > 0 && !token.cancelled) {
      const { username, message } = _pendingMessages.shift();

      logger.chat(`← ${username}: ${message}`);

      // Brief "thinking" delay — feels more human
      await sleep(800 + Math.random() * 1200);

      try {
        const response = await decisionMaker.generateChatResponse(
          state, username, message, _chatHistory
        );

        if (response) {
          bot.chat(response);
          logger.chat(`→ ${response}`);
          _chatHistory.push({ username: bot.username, message: response });
        }
      } catch (err) {
        logger.debug(`Chat response error: ${err.message}`);
      }
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
//  GREET PLAYERS GOAL  (say something when players first come nearby)
// ─────────────────────────────────────────────────────────────────────────────
const GreetPlayersGoal = {
  name: 'greet_players',
  maxDurationMs: 5000,

  priority(state) {
    return _playersToGreet.size > 0 ? 30 : 0;
  },

  canRun(state) {
    return _playersToGreet.size > 0;
  },

  async run(bot, token, state) {
    for (const username of _playersToGreet) {
      _playersToGreet.delete(username);
      if (token.cancelled) return;

      // Selfish greeting — acts like the player is interrupting
      const greetings = [
        `Oh. ${username}. What do you want.`,
        `${username}. You look like you've had a rough time.`,
        `Hey ${username}. Stay out of my stuff.`,
        `${username}. Don't mind me, just minding my own business.`,
      ];
      const msg = greetings[Math.floor(Math.random() * greetings.length)];
      await sleep(500 + Math.random() * 1000);
      bot.chat(msg);
      logger.chat(`→ (greeting) ${msg}`);
    }
  },
};

const _playersToGreet = new Set();
const _knownPlayers   = new Set();

// ─────────────────────────────────────────────────────────────────────────────
//  TRADE GOAL  (negotiate trades with nearby players — unfairly)
// ─────────────────────────────────────────────────────────────────────────────
const TradeGoal = {
  name: 'trade_with_player',
  maxDurationMs: 30000,

  priority(state) {
    // Only trade when idle and a player is nearby
    if (state.nearbyPlayers.length === 0) return 0;
    if (state.isNight || state.nearbyHostiles.length > 0) return 0;
    return _pendingTradeOffer ? 60 : 0;
  },

  canRun(state) {
    return !!_pendingTradeOffer && state.nearbyPlayers.length > 0;
  },

  async run(bot, token, state) {
    const offer = _pendingTradeOffer;
    _pendingTradeOffer = null;
    if (!offer) return;

    const { playerName, give, receive } = offer;
    logger.info(`Evaluating trade with ${playerName}: give ${give}, receive ${receive}`);

    try {
      const result = await decisionMaker.evaluateTrade(state, playerName, {
        give:    [{ item: give.item,    count: give.count,    value: getItemValue(give.item) }],
        receive: [{ item: receive.item, count: receive.count, value: getItemValue(receive.item) }],
      });

      await sleep(1000);

      if (result.decision === 'accept') {
        bot.chat(`Fine, ${playerName}. Deal.`);
      } else if (result.decision === 'counter') {
        bot.chat(result.message || `${playerName}, I need a better deal than that.`);
      } else {
        bot.chat(`No thanks, ${playerName}. Not worth my time.`);
      }
    } catch (err) {
      logger.debug(`Trade evaluation error: ${err.message}`);
      bot.chat(`I'm busy right now, ${playerName}.`);
    }
  },
};

let _pendingTradeOffer = null;

// ─────────────────────────────────────────────────────────────────────────────
//  Public API — called from bot event handlers
// ─────────────────────────────────────────────────────────────────────────────

/** Called by the bot's chat handler for every incoming message. */
function onChatMessage(username, message) {
  // Add to history
  _chatHistory.push({ username, message, time: Date.now() });
  if (_chatHistory.length > MAX_HISTORY) _chatHistory.shift();

  // Check if the message mentions the bot (direct addressing)
  const botName = config.personality.name.toLowerCase();
  const lower   = message.toLowerCase();
  const isDirected = lower.includes(botName) || isTradeMessage(lower) ||
                     isQuestionOrCommand(lower);

  if (isDirected) {
    _pendingMessages.push({ username, message });
  }

  // Check for trade offers: "trade: 5 iron for 2 diamond"
  const tradeOffer = parseTradeOffer(message);
  if (tradeOffer) {
    _pendingTradeOffer = { playerName: username, ...tradeOffer };
  }
}

/** Called when a new player comes into render distance. */
function onPlayerJoined(username, botUsername) {
  if (username === botUsername) return;
  if (!_knownPlayers.has(username)) {
    _knownPlayers.add(username);
    _playersToGreet.add(username);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

function isTradeMessage(msg) {
  return /trade|buy|sell|swap|deal|offer|want/.test(msg);
}

function isQuestionOrCommand(msg) {
  return msg.includes('?') || /^(hey|hi|yo|sup|help|can you|do you|have you|will you)/.test(msg);
}

/**
 * Very simple trade offer parser.
 * Recognises patterns like:
 *   "trade 5 iron for 2 diamond"
 *   "ill give 10 coal for 1 emerald"
 */
function parseTradeOffer(message) {
  const patterns = [
    /(?:trade|swap)\s+(\d+)\s+(\w+)\s+for\s+(\d+)\s+(\w+)/i,
    /(?:give|offer)\s+(\d+)\s+(\w+)\s+for\s+(\d+)\s+(\w+)/i,
    /(\d+)\s+(\w+)\s+for\s+(\d+)\s+(\w+)/i,
  ];

  for (const pattern of patterns) {
    const m = message.match(pattern);
    if (m) {
      return {
        give:    { count: parseInt(m[3]), item: m[4] },   // what they want the bot to give
        receive: { count: parseInt(m[1]), item: m[2] },   // what they offer
      };
    }
  }
  return null;
}

/** Rough item value in "emerald equivalents" for trade evaluation. */
function getItemValue(itemName) {
  const values = {
    diamond: 8, emerald: 1, gold_ingot: 2, iron_ingot: 0.5, netherite_ingot: 32,
    coal: 0.1, wood: 0.05, food: 0.2, arrow: 0.1, string: 0.1,
  };
  for (const [key, val] of Object.entries(values)) {
    if (itemName.includes(key)) return val;
  }
  return 0.5;
}

module.exports = {
  RespondToChatGoal,
  GreetPlayersGoal,
  TradeGoal,
  onChatMessage,
  onPlayerJoined,
};
