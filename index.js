'use strict';
require('dotenv').config();

const { createMinecraftBot } = require('./src/bot');
const logger = require('./src/utils/logger');
const config = require('./config');

// ── Bot connection options ────────────────────────────────────────────────────
const BOT_OPTIONS = {
  host:     config.server.host,
  port:     config.server.port,
  username: config.server.username,
  version:  config.server.version,
  auth:     config.server.auth,

  // Hide Mineflayer's own console output — we handle logging ourselves
  hideErrors: false,
};

// ── Reconnect state ───────────────────────────────────────────────────────────
let reconnectDelay   = config.reconnect.delayMs;
let reconnectAttempt = 0;
const MAX_ATTEMPTS   = config.reconnect.maxAttempts;

// ── Entry point ───────────────────────────────────────────────────────────────
logger.info('═══════════════════════════════════════════');
logger.info(` minecraft-player-v1  —  ${config.personality.name}`);
logger.info(`  Server  : ${BOT_OPTIONS.host}:${BOT_OPTIONS.port}`);
logger.info(`  Version : ${BOT_OPTIONS.version}`);
logger.info(`  Auth    : ${BOT_OPTIONS.auth}`);
logger.info(`  LLM     : ${config.llm.enabled ? `${config.llm.model} @ ${config.llm.host}` : 'disabled (rule-based only)'}`);
logger.info('═══════════════════════════════════════════');

function start() {
  logger.info(`Connecting to ${BOT_OPTIONS.host}:${BOT_OPTIONS.port} as "${BOT_OPTIONS.username}"...`);

  let bot;
  try {
    bot = createMinecraftBot(BOT_OPTIONS);
  } catch (err) {
    logger.error(`Failed to create bot: ${err.message}`);
    scheduleReconnect();
    return;
  }

  // ── Connection success ─────────────────────────────────────────────────────
  bot.once('login', () => {
    logger.success('Logged in!');
    reconnectAttempt = 0;
    reconnectDelay   = config.reconnect.delayMs; // reset on success
  });

  // ── Disconnection / end ────────────────────────────────────────────────────
  bot.once('end', (reason) => {
    logger.warn(`Connection ended: ${reason || 'unknown reason'}`);
    scheduleReconnect();
  });

  // ── Unhandled bot errors ───────────────────────────────────────────────────
  bot.on('error', (err) => {
    // Mineflayer emits errors we shouldn't crash on — just log them
    logger.error(`Bot error: ${err.message}`);
  });
}

function scheduleReconnect() {
  reconnectAttempt++;

  if (MAX_ATTEMPTS > 0 && reconnectAttempt > MAX_ATTEMPTS) {
    logger.error(`Reached max reconnect attempts (${MAX_ATTEMPTS}). Exiting.`);
    process.exit(1);
  }

  logger.info(
    `Reconnecting in ${reconnectDelay / 1000}s ` +
    `(attempt ${reconnectAttempt}${MAX_ATTEMPTS > 0 ? `/${MAX_ATTEMPTS}` : ''})`
  );

  setTimeout(() => {
    // Exponential back-off, capped at 2 minutes
    reconnectDelay = Math.min(reconnectDelay * 1.5, 120_000);
    start();
  }, reconnectDelay);
}

// ── Process-level error handling ──────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err.message);
  logger.error(err.stack);
  // Don't exit — try to keep the process alive for reconnects
});

process.on('unhandledRejection', (reason) => {
  logger.warn('Unhandled promise rejection:', String(reason));
});

process.on('SIGINT', () => {
  logger.warn('Shutting down (SIGINT)...');
  process.exit(0);
});

// ── Go ────────────────────────────────────────────────────────────────────────
start();
