'use strict';

const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL] ?? LOG_LEVELS.INFO;

function timestamp() {
  return new Date().toISOString();
}

function format(level, message, meta) {
  const metaStr = meta ? ' ' + JSON.stringify(meta) : '';
  return `[${timestamp()}] [${level}] ${message}${metaStr}`;
}

const logger = {
  debug(message, meta) {
    if (CURRENT_LEVEL <= LOG_LEVELS.DEBUG) {
      console.debug(format('DEBUG', message, meta));
    }
  },
  info(message, meta) {
    if (CURRENT_LEVEL <= LOG_LEVELS.INFO) {
      console.log(format('INFO ', message, meta));
    }
  },
  warn(message, meta) {
    if (CURRENT_LEVEL <= LOG_LEVELS.WARN) {
      console.warn(format('WARN ', message, meta));
    }
  },
  error(message, meta) {
    if (CURRENT_LEVEL <= LOG_LEVELS.ERROR) {
      const metaStr = meta instanceof Error
        ? { message: meta.message, stack: meta.stack }
        : meta;
      console.error(format('ERROR', message, metaStr));
    }
  },
};

module.exports = logger;
