'use strict';
const ollama = require('./ollama');
const prompts = require('./prompts');
const logger  = require('../utils/logger');

/**
 * LLM-powered decision making for the bot.
 * Every method falls back to rule-based logic when Ollama is unavailable.
 */

// Valid action names the LLM is allowed to return
const VALID_ACTIONS = [
  'eat', 'flee', 'fight_mob', 'mine_ores', 'chop_wood',
  'craft_tools', 'build_shelter', 'explore', 'loot_chests',
  'interact_player', 'idle',
];

/**
 * Ask the LLM what to do given the current bot state.
 * Returns an action string from VALID_ACTIONS.
 */
async function decideAction(state) {
  const prompt = prompts.buildDecisionPrompt(state);
  const raw = await ollama.generate(prompt, { maxTokens: 20, temperature: 0.4 });

  if (raw) {
    // Clean up response — take only the first word/line
    const action = raw.toLowerCase().split(/[\n\s,.:]/)[0];
    if (VALID_ACTIONS.includes(action)) {
      logger.llm(`LLM decided action: ${action}`);
      return action;
    }
    logger.warn(`LLM returned unknown action: "${raw}" — ignoring`);
  }

  // Rule-based fallback
  return null; // null signals GoalManager to use pure priority system
}

/**
 * Generate a chat response to a player message.
 * @param {object} state - current bot state snapshot
 * @param {string} playerName
 * @param {string} message
 * @param {Array} chatHistory - recent chat messages [{username, message}]
 * @returns {Promise<string>} The response to send (may be a rule-based fallback)
 */
async function generateChatResponse(state, playerName, message, chatHistory = []) {
  const prompt = prompts.buildChatPrompt(state, playerName, message, chatHistory);
  const response = await ollama.generate(prompt, { maxTokens: 80, temperature: 0.9 });

  if (response && response.length > 2) {
    // Sanitize: remove any leading name prefixes the model might add
    return response.replace(/^[\w\s]+:\s*/, '').trim();
  }

  // Rule-based chat fallbacks — selfish personality
  return getRuleBasedChatResponse(playerName, message, state);
}

/**
 * Evaluate a trade offer — returns { decision: 'accept'|'decline'|'counter', message: string }
 */
async function evaluateTrade(state, playerName, offer) {
  const prompt = prompts.buildTradeEvalPrompt(state, playerName, offer);
  const raw = await ollama.generate(prompt, { maxTokens: 100, temperature: 0.6 });

  if (raw) {
    const lines = raw.trim().split('\n');
    const decisionLine = lines[0].toUpperCase();
    const message = lines.slice(1).join(' ').trim() || null;

    if (decisionLine.includes('ACCEPT')) return { decision: 'accept', message };
    if (decisionLine.includes('COUNTER')) return { decision: 'counter', message };
    return { decision: 'decline', message };
  }

  // Rule-based: always try to get more, default decline
  return {
    decision: 'counter',
    message: `I'll need at least double that to make it worth my while.`,
  };
}

/**
 * Ask the LLM for a strategic suggestion in a complex situation.
 */
async function getStrategicAdvice(state, situation) {
  const prompt = prompts.buildStrategyPrompt(state, situation);
  return await ollama.generate(prompt, { maxTokens: 60, temperature: 0.6 });
}

// ── Rule-based chat fallbacks ─────────────────────────────────────────────────

const GREETINGS = ['hey', 'hi', 'hello', 'sup', 'yo', 'hiya'];
const TRADE_KEYWORDS = ['trade', 'buy', 'sell', 'swap', 'deal', 'offer'];
const HELP_KEYWORDS = ['help', 'please', 'need', 'can you', 'could you'];
const RESOURCE_KEYWORDS = ['diamond', 'iron', 'gold', 'emerald', 'netherite', 'food'];

const SELFISH_RESPONSES = {
  greeting: [
    `Oh hey. What do you want?`,
    `Yeah? Make it quick.`,
    `What's in it for me if I talk to you?`,
    `Sup. Don't bother me unless you've got something useful.`,
  ],
  trade: [
    `My stuff isn't cheap. What are you offering?`,
    `I might consider it — but I need more than that.`,
    `Everything I have cost me a lot. Fair price only.`,
    `Maybe. But I'm not desperate, so don't lowball me.`,
  ],
  help: [
    `Help costs resources. What do I get?`,
    `I'm busy. Unless you're paying, I'll pass.`,
    `Sure, for a price. What've you got?`,
    `Why would I help you for free?`,
  ],
  resource: [
    `Pfft, barely anything. Definitely not enough to share.`,
    `I'm almost out actually. Real rough luck.`,
    `Why are you so interested in what I have?`,
    `None of your business what's in my inventory.`,
  ],
  default: [
    `Interesting. Anyway.`,
    `Sure, whatever.`,
    `I'm a bit occupied right now.`,
    `Noted.`,
    `Cool story.`,
  ],
};

function getRuleBasedChatResponse(playerName, message, state) {
  const lower = message.toLowerCase();

  if (GREETINGS.some(g => lower.includes(g))) {
    return pick(SELFISH_RESPONSES.greeting);
  }
  if (TRADE_KEYWORDS.some(k => lower.includes(k))) {
    return pick(SELFISH_RESPONSES.trade);
  }
  if (HELP_KEYWORDS.some(k => lower.includes(k))) {
    return pick(SELFISH_RESPONSES.help);
  }
  if (RESOURCE_KEYWORDS.some(k => lower.includes(k))) {
    return pick(SELFISH_RESPONSES.resource);
  }
  return pick(SELFISH_RESPONSES.default);
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

module.exports = {
  decideAction,
  generateChatResponse,
  evaluateTrade,
  getStrategicAdvice,
};
