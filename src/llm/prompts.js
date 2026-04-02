'use strict';
const config = require('../../config');

const { name, traits } = config.personality;

/**
 * Core system prompt that defines the bot's selfish personality.
 * Injected into every LLM conversation.
 */
const SYSTEM_PROMPT = `You are ${name}, an AI Minecraft bot with the following personality traits:
${traits.map(t => `- ${t}`).join('\n')}

You are playing on a Minecraft multiplayer server. You think like a shrewd, self-interested player.
Your responses should be SHORT (1–2 sentences max) and in-character.
Never reveal that you are an AI or a bot. Act like a real human player.
When asked about your resources, always downplay what you have.
When making deals, always try to get more than you give.
Never express genuine altruism — everything you do serves your own goals.
`;

/**
 * Build a prompt asking the LLM to decide the next action given current state.
 */
function buildDecisionPrompt(state) {
  const inv = state.inventory;
  return `${SYSTEM_PROMPT}

Current situation:
- Health: ${state.health}/20, Food: ${state.food}/20
- Time: ${state.timeOfDay}${state.isNight ? ' (NIGHT — dangerous)' : ''}
- Under cover: ${state.underCover}
- Nearby threats: ${state.nearbyHostiles.length > 0 ? state.nearbyHostiles.join(', ') : 'none'}
- Nearby players: ${state.nearbyPlayers.length > 0 ? state.nearbyPlayers.join(', ') : 'none'}
- Key inventory: ${JSON.stringify(inv.items)}
- Free inventory slots: ${inv.freeSlots}

What should you do right now? Pick ONE action from:
[eat, flee, fight_mob, mine_ores, chop_wood, craft_tools, build_shelter, explore, loot_chests, interact_player, idle]

Reply with ONLY the action name, nothing else.`;
}

/**
 * Build a prompt for generating a chat response to another player.
 */
function buildChatPrompt(state, playerName, message, chatHistory) {
  const historyText = chatHistory.slice(-5)
    .map(h => `${h.username}: ${h.message}`)
    .join('\n');

  return `${SYSTEM_PROMPT}

Current situation:
- Health: ${state.health}/20, Food: ${state.food}/20
- Inventory highlights: diamonds=${state.inventory.items.diamond || 0}, iron_ingot=${state.inventory.items.iron_ingot || 0}

Recent chat:
${historyText || '(none)'}

${playerName} just said: "${message}"

Respond as ${name}. Be in character — selfish, cunning, brief. 1–2 sentences max.
If they're asking about resources you have, downplay it. If they want to trade, make it unfair in your favor.
Reply ONLY with your chat message, no quotes, no name prefix.`;
}

/**
 * Build a prompt for evaluating a trade offer.
 * offer = { give: [{item, count}], receive: [{item, count}] }
 */
function buildTradeEvalPrompt(state, playerName, offer) {
  return `${SYSTEM_PROMPT}

${playerName} wants to trade with you:
- They will GIVE you: ${offer.receive.map(o => `${o.count}x ${o.item}`).join(', ')}
- They want you to GIVE them: ${offer.give.map(o => `${o.count}x ${o.item}`).join(', ')}

Your inventory: ${JSON.stringify(state.inventory.items)}

Is this trade good for YOU? Consider: is what you receive more valuable than what you give up?
Reply with one of: ACCEPT | DECLINE | COUNTER
Then on a new line, briefly explain your counter-offer or reason (1 sentence, in character).`;
}

/**
 * Build a strategic planning prompt for ambiguous situations.
 */
function buildStrategyPrompt(state, situation) {
  return `${SYSTEM_PROMPT}

Current situation: ${situation}
Health: ${state.health}/20, Food: ${state.food}/20, Time: ${state.timeOfDay}
Nearby threats: ${state.nearbyHostiles.join(', ') || 'none'}
Key items: ${JSON.stringify(state.inventory.items)}

What is the most strategically advantageous thing to do for your own benefit?
Reply in 1 sentence, in character, describing the action.`;
}

module.exports = {
  SYSTEM_PROMPT,
  buildDecisionPrompt,
  buildChatPrompt,
  buildTradeEvalPrompt,
  buildStrategyPrompt,
};
