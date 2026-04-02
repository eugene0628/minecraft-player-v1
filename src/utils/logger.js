'use strict';
const config = require('../../config');

// ANSI colour codes
const COLOURS = {
  reset:  '\x1b[0m',
  grey:   '\x1b[90m',
  cyan:   '\x1b[36m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  magenta:'\x1b[35m',
};

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[config.log.level] ?? LEVELS.info;

function timestamp() {
  return new Date().toTimeString().slice(0, 8);
}

function write(level, colour, label, args) {
  if (LEVELS[level] < currentLevel) return;
  const prefix = `${COLOURS.grey}[${timestamp()}]${COLOURS.reset} ${colour}${label}${COLOURS.reset}`;
  // Convert objects to readable strings
  const parts = args.map(a =>
    typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a)
  );
  console.log(`${prefix} ${parts.join(' ')}`);
}

const logger = {
  debug:   (...args) => write('debug',  COLOURS.grey,    '[DBG]', args),
  info:    (...args) => write('info',   COLOURS.cyan,    '[INF]', args),
  success: (...args) => write('info',   COLOURS.green,   '[OK ]', args),
  warn:    (...args) => write('warn',   COLOURS.yellow,  '[WRN]', args),
  error:   (...args) => write('error',  COLOURS.red,     '[ERR]', args),
  goal:    (...args) => write('info',   COLOURS.magenta, '[GOL]', args),
  chat:    (...args) => write('info',   COLOURS.green,   '[CHT]', args),
  llm:     (...args) => write('debug',  COLOURS.grey,    '[LLM]', args),
};

module.exports = logger;
